/**
 * Reglages de Simulation 2.0.
 *
 * PROPRIETAIRE EXCLUSIF de ses trois cles dans finance_config. Elles sont
 * volontairement HORS de la liste blanche de PUT /api/finance/config
 * (routes/finance.js): cette route est gardee par checkAdvancedAccess, qui
 * laisse passer admin, superutilisateur ET superviseur. Y ouvrir le drapeau
 * donnerait a un superviseur le pouvoir de basculer le moteur de simulation du
 * tenant. La demande dit "un setting de admin", donc l'ecriture passe par
 * routes/simulation-v2.js et son controle strict sur role === 'admin'.
 *
 * Pourquoi finance_config plutot qu'une colonne dediee: la table existe, elle
 * vit dans le schema du tenant (db/index.js pose un SET search_path par
 * connexion), donc le reglage est par tenant sans une ligne de code pour ca,
 * et sans migration. C'est aussi la ou vivent deja parage_exclusions et
 * parage_dechets, qui sont exactement des listes de noms de produits editees
 * en administration.
 *
 * INACTIF PAR DEFAUT: une cle absente vaut off. Un tenant qui n'a jamais rien
 * regle ne voit donc rien changer.
 */

// Valeurs par defaut quand la cle est absente ou illisible.
const DEFAUTS = {
    // Drapeau simple, actif ou inactif. Pas de liste de roles: la demande est
    // un interrupteur. Le passage a une liste par role reste possible plus
    // tard sans casser cette forme, '1' se lisant comme "tous les roles
    // autorises par les gardes de route".
    actif: false,
    // Produits qui prennent le prix d'achat de la carcasse de poulet.
    // 'Cuisse de poulet' en est DELIBEREMENT absente: elle porte son propre
    // prix d'achat (1 800 F, hors Mata) et lui imposer celui de la carcasse
    // serait faux. C'est la raison d'etre d'une liste explicite plutot que
    // d'un motif sur le mot "poulet", qui avalerait aussi 'Merguez poulet'.
    famillePoulet: ['Poulet en détail', 'Poulet en gros'],
    // Repli quand la ligne 'Poulet' du catalogue fournisseur ne porte aucun
    // prix d'achat. Le catalogue reste la source: ce nombre ne sert que
    // lorsqu'il est muet.
    prixPouletDefaut: 3000
};

const CLES = {
    actif: 'simulation_v2_enabled',
    famillePoulet: 'famille_poulet',
    prixPouletDefaut: 'prix_achat_defaut_poulet'
};

/**
 * Liste CSV -> tableau de noms propres, sans vides ni doublons.
 *
 * La deduplication utilise la MEME normalisation que la resolution des prix
 * (accents et casse ignores). Avec un simple toLowerCase, 'Poulet en détail'
 * et 'POULET EN DETAIL' passaient pour deux produits differents et
 * s'affichaient tous deux dans l'ecran d'administration, alors qu'ils
 * resolvent vers le meme cout. Un doublon qui n'en est pas un fait douter du
 * reglage.
 */
function parseListe(csv) {
    if (typeof csv !== 'string') return null;
    const { normaliserNom } = require('../parage');
    const vus = new Set();
    const out = [];
    for (const brut of csv.split(',')) {
        const nom = brut.trim();
        if (!nom) continue;
        const cle = normaliserNom(nom);
        if (vus.has(cle)) continue;
        vus.add(cle);
        out.push(nom);
    }
    return out;
}

/**
 * Les reglages courants du tenant.
 *
 * Une valeur illisible ne fait jamais echouer la lecture: on retombe sur le
 * defaut et on le SIGNALE dans `avertissements`, pour que l'ecran puisse le
 * dire au lieu de laisser croire a un reglage volontaire.
 */
async function lireReglages() {
    const { FinanceConfig } = require('../../db/models');
    const avertissements = [];
    let rows = [];
    try {
        rows = await FinanceConfig.findAll({
            where: { key: Object.values(CLES) },
            raw: true
        });
    } catch (e) {
        avertissements.push(`finance_config illisible (${e.message}) : réglages par défaut appliqués.`);
        return { ...DEFAUTS, avertissements };
    }

    const brut = {};
    for (const r of rows) brut[r.key] = r.value;

    // Le drapeau n'accepte QUE '1'. Tout le reste, y compris une valeur
    // inattendue, vaut inactif: sur un interrupteur qui ouvre un ecran, le
    // doute doit fermer, jamais ouvrir.
    const actif = String(brut[CLES.actif] || '').trim() === '1';

    let famillePoulet = DEFAUTS.famillePoulet;
    if (brut[CLES.famillePoulet] !== undefined) {
        const liste = parseListe(brut[CLES.famillePoulet]);
        // Une liste VIDE est un choix legitime: elle desactive la famille.
        // On ne retombe sur le defaut que si la valeur n'est pas lisible.
        if (liste === null) {
            avertissements.push(`${CLES.famillePoulet} illisible : liste par défaut appliquée.`);
        } else {
            famillePoulet = liste;
        }
    }

    let prixPouletDefaut = DEFAUTS.prixPouletDefaut;
    if (brut[CLES.prixPouletDefaut] !== undefined) {
        const v = parseFloat(brut[CLES.prixPouletDefaut]);
        if (Number.isFinite(v) && v > 0) prixPouletDefaut = v;
        else avertissements.push(
            `${CLES.prixPouletDefaut} invalide (${brut[CLES.prixPouletDefaut]}) : ${DEFAUTS.prixPouletDefaut} appliqué.`
        );
    }

    return { actif, famillePoulet, prixPouletDefaut, avertissements };
}

/** Validation SEULE, sans ecriture. Rend { ok, erreurs, aEcrire }. */
function valider(corps) {
    const erreurs = [];
    const aEcrire = [];

    if (corps.actif !== undefined) {
        if (typeof corps.actif !== 'boolean') {
            erreurs.push('actif doit être un booléen');
        } else {
            aEcrire.push({ key: CLES.actif, value: corps.actif ? '1' : '0' });
        }
    }

    if (corps.famillePoulet !== undefined) {
        // La branche tableau repasse par parseListe, elle aussi. Sans cela,
        // elle contournait la deduplication ET la borne implicite: un nom
        // contenant une virgule etait stocke tel quel puis RELU comme deux
        // produits, sans qu'aucune erreur ne le dise.
        const liste = parseListe(
            Array.isArray(corps.famillePoulet)
                ? corps.famillePoulet.map((n) => String(n)).join(',')
                : corps.famillePoulet
        );
        if (liste === null) {
            erreurs.push('famillePoulet doit être une liste de noms ou une chaîne séparée par des virgules');
        } else if (liste.length > 50) {
            // Borne defensive: la valeur est stockee en TEXT, mais une liste
            // de mille noms saisie par erreur rendrait l'ecran illisible.
            erreurs.push('famillePoulet : 50 produits au maximum');
        } else if (liste.some((n) => n.length > 120)) {
            // Un nom de produit du catalogue tient tres largement dans 120
            // caracteres. Borner chaque entree evite qu'une valeur collee par
            // erreur - un paragraphe, un JSON - parte en base et deborde
            // l'affichage: la colonne est en TEXT et n'oppose aucune limite.
            erreurs.push('famillePoulet : 120 caractères au maximum par produit');
        } else {
            aEcrire.push({ key: CLES.famillePoulet, value: liste.join(',') });
        }
    }

    if (corps.prixPouletDefaut !== undefined) {
        const v = parseFloat(corps.prixPouletDefaut);
        // Plafond de bon sens: une faute de frappe a 30000 rendrait une marge
        // unitaire tres negative sans que rien ne le dise.
        if (!Number.isFinite(v) || v <= 0 || v > 100000) {
            erreurs.push('prixPouletDefaut doit être un nombre entre 1 et 100000');
        } else {
            aEcrire.push({ key: CLES.prixPouletDefaut, value: String(v) });
        }
    }

    if (!aEcrire.length && !erreurs.length) erreurs.push('aucun réglage fourni');
    return { ok: erreurs.length === 0, erreurs, aEcrire };
}

/**
 * Ecrit les reglages. TOUT est valide avant que RIEN ne soit ecrit, et les
 * ecritures passent dans une seule transaction: meme motif que
 * PUT /api/finance/config, ou un premier passage pouvait persister les
 * premieres cles puis echouer sur la suivante, laissant un etat partiel sous
 * une reponse 400.
 */
async function ecrireReglages(corps) {
    const { ok, erreurs, aEcrire } = valider(corps || {});
    if (!ok) return { ok: false, erreurs };

    const { FinanceConfig } = require('../../db/models');
    const { sequelize } = require('../../db/index');
    const now = new Date();
    await sequelize.transaction(async (t) => {
        for (const { key, value } of aEcrire) {
            await FinanceConfig.upsert({ key, value, updated_at: now }, { transaction: t });
        }
    });
    return { ok: true, ecrites: aEcrire.map((e) => e.key) };
}

module.exports = { lireReglages, ecrireReglages, valider, parseListe, CLES, DEFAUTS };
