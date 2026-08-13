/**
 * Reglages de Simulation 2.0.
 *
 * PROPRIETAIRE EXCLUSIF de ses cles dans finance_config. Elles sont
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
    prixPouletDefaut: 3000,
    // Produits SUIVIS par l'onglet Simulation, en plus des cinq d'origine.
    //
    // La liste de base reste fermee et codee en dur cote route: un tableau de
    // sensibilite dont les lignes apparaissent et disparaissent d'un mois a
    // l'autre ne se compare pas. Ce reglage AJOUTE, il ne remplace pas.
    //
    // Condition d'entree, posee par le proprietaire du produit: le nom vendu
    // doit etre AUSSI un nom de stock. Sans ligne de stock, le produit n'a ni
    // borne matin ni borne soir, donc aucune variation ni parage a lui
    // opposer - il entrerait dans la simulation en n'y apportant qu'un prix.
    produitsSuivis: [],
    // Coefficient P1/P2 CALIBRE et enregistre, avec sa signature.
    //
    // Le coefficient etait jusqu'ici recalcule dans chaque navigateur, a
    // chaque rendu, sur une fenetre de trois mois qui GLISSE. Deux
    // consequences: la valeur bougeait toute seule d'un jour a l'autre sans
    // que personne ne l'ait decide, et rien ne disait sur quelle fenetre ni a
    // quelle date elle avait ete etablie. Un chiffre qui pilote une projection
    // doit pouvoir se dater et s'attribuer.
    //
    // null = rien d'enregistre: le calcul en direct reprend la main, donc un
    // tenant qui n'a jamais calibre ne voit rien changer.
    coeffP1P2: null
};

const CLES = {
    actif: 'simulation_v2_enabled',
    famillePoulet: 'famille_poulet',
    prixPouletDefaut: 'prix_achat_defaut_poulet',
    produitsSuivis: 'produits_simulation',
    coeffP1P2: 'simulation_coeff_p1_p2'
};

// Bornes du coefficient. En dessous de 0,5 ou au-dela de 3, ce n'est plus une
// saisonnalite mais une erreur de fenetre: les references du document vont de
// 1,24 a 1,39, et une calibration mesuree sur un tenant reel est descendue a
// 0,96. Les memes bornes que le champ de saisie a l'ecran, pour qu'un
// coefficient refuse par l'un le soit par l'autre.
const COEFF_MIN = 0.5;
const COEFF_MAX = 3;

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
        // Le tableau est CLONE: le rendre par reference exposait la constante
        // du module, qu'un appelant pouvait muter pour tout le processus.
        return {
            ...DEFAUTS,
            famillePoulet: DEFAUTS.famillePoulet.slice(),
            produitsSuivis: DEFAUTS.produitsSuivis.slice(),
            avertissements
        };
    }

    const brut = {};
    for (const r of rows) brut[r.key] = r.value;

    // Le drapeau n'accepte QUE '1'. Tout le reste, y compris une valeur
    // inattendue, vaut inactif: sur un interrupteur qui ouvre un ecran, le
    // doute doit fermer, jamais ouvrir.
    const actif = String(brut[CLES.actif] || '').trim() === '1';

    // Clone, pour la meme raison que plus haut: la constante du module ne doit
    // jamais sortir par reference.
    let famillePoulet = DEFAUTS.famillePoulet.slice();
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

    let produitsSuivis = DEFAUTS.produitsSuivis.slice();
    if (brut[CLES.produitsSuivis] !== undefined) {
        const liste = parseListe(brut[CLES.produitsSuivis]);
        if (liste === null) {
            avertissements.push(`${CLES.produitsSuivis} illisible : aucun produit ajoute.`);
        } else {
            produitsSuivis = liste;
        }
    }

    // La calibration enregistree. Stockee en JSON parce qu'elle porte une
    // valeur ET sa provenance - date, auteur, fenetre. Les separer en quatre
    // cles aurait permis a l'une d'etre ecrite sans les autres, et un
    // coefficient sans sa date ne vaut pas mieux qu'un coefficient sans nom.
    let coeffP1P2 = DEFAUTS.coeffP1P2;
    // Une valeur VIDE est un effacement volontaire, pas une valeur illisible:
    // c'est ainsi que l'ecran annule une calibration. La signaler comme une
    // anomalie ferait douter d'un geste parfaitement legitime.
    if (brut[CLES.coeffP1P2] !== undefined && String(brut[CLES.coeffP1P2]).trim() !== '') {
        const lu = lireCoeffEnregistre(brut[CLES.coeffP1P2]);
        if (lu === null) {
            avertissements.push(
                `${CLES.coeffP1P2} illisible : coefficient recalculé en direct.`
            );
        } else {
            coeffP1P2 = lu;
        }
    }

    return { actif, famillePoulet, prixPouletDefaut, produitsSuivis, coeffP1P2, avertissements };
}

/**
 * Le JSON stocke -> objet exploitable, ou null si la valeur ne tient pas.
 *
 * La VALEUR est la seule partie obligatoire: une calibration dont on aurait
 * perdu l'auteur reste un coefficient utilisable, et le refuser en entier
 * ferait retomber la projection en direct pour une metadonnee manquante.
 */
function lireCoeffEnregistre(texte) {
    let o;
    try { o = JSON.parse(String(texte)); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    const v = parseFloat(o.valeur);
    if (!Number.isFinite(v) || v < COEFF_MIN || v > COEFF_MAX) return null;
    return {
        valeur: v,
        le: typeof o.le === 'string' ? o.le : null,
        par: typeof o.par === 'string' ? o.par : null,
        fenetre: typeof o.fenetre === 'string' ? o.fenetre : null,
        jours: Number.isFinite(parseInt(o.jours, 10)) ? parseInt(o.jours, 10) : null
    };
}

/**
 * Valide une liste de noms de produits destinee au stockage CSV.
 *
 * Ecrite UNE fois et partagee par famillePoulet et produitsSuivis: deux copies
 * de ces regles auraient diverge des la premiere correction faite d'un cote.
 */
function validerListeDeNoms(brutInitial, libelle) {
    let brut = brutInitial;
    let typeInvalide = false;
    if (Array.isArray(brut)) {
        typeInvalide = brut.some((n) => typeof n !== 'string' || n.includes(','));
        brut = typeInvalide ? null : brut.join(',');
    }
    const liste = typeInvalide ? null : parseListe(brut);
    if (liste === null) {
        return { erreur: `${libelle} doit être une liste de noms, sans virgule dans un nom` };
    }
    // Borne defensive: la valeur est stockee en TEXT, mais une liste de mille
    // noms saisie par erreur rendrait l'ecran illisible.
    if (liste.length > 50) return { erreur: `${libelle} : 50 produits au maximum` };
    // Un nom de produit du catalogue tient tres largement dans 120 caracteres.
    // Borner chaque entree evite qu'une valeur collee par erreur - un
    // paragraphe, un JSON - parte en base et deborde l'affichage: la colonne
    // est en TEXT et n'oppose aucune limite.
    if (liste.some((n) => n.length > 120)) {
        return { erreur: `${libelle} : 120 caractères au maximum par produit` };
    }
    return { liste };
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
        //
        // Un element qui n'est pas une chaine est REFUSE, jamais converti:
        // String({nom:'Poulet'}) rend '[object Object]', qui passait la
        // validation, s'affichait comme un produit de la famille et ne
        // resolvait evidemment rien.
        //
        // Un element qui CONTIENT une virgule est refuse lui aussi. Le joindre
        // puis le redecouper transformait 'Poulet, gros' en DEUX produits sans
        // qu'aucune erreur ne le dise - exactement le defaut que cette branche
        // pretendait corriger. La virgule etant le separateur du stockage, un
        // nom qui en porte une n'est pas representable: mieux vaut le refuser
        // que le scinder.
        const r = validerListeDeNoms(corps.famillePoulet, 'famillePoulet');
        if (r.erreur) erreurs.push(r.erreur);
        else aEcrire.push({ key: CLES.famillePoulet, value: r.liste.join(',') });
    }

    if (corps.produitsSuivis !== undefined) {
        // MEME regime que famillePoulet: c'est une liste de noms de produits
        // stockee en CSV, donc les memes pieges - element non-chaine, virgule
        // dans un nom, liste sans fin. Les reecrire ici les aurait laisses
        // diverger a la premiere correction faite d'un seul cote.
        const r = validerListeDeNoms(corps.produitsSuivis, 'produitsSuivis');
        if (r.erreur) erreurs.push(r.erreur);
        else aEcrire.push({ key: CLES.produitsSuivis, value: r.liste.join(',') });
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

    if (corps.coeffP1P2 !== undefined) {
        // null EFFACE la calibration: la projection repasse au calcul en
        // direct. C'est la sortie de secours quand une calibration s'avere
        // faite sur une fenetre aberrante.
        if (corps.coeffP1P2 === null) {
            aEcrire.push({ key: CLES.coeffP1P2, value: '' });
        } else if (typeof corps.coeffP1P2 !== 'object' || Array.isArray(corps.coeffP1P2)) {
            erreurs.push('coeffP1P2 doit être un objet { valeur, ... } ou null');
        } else {
            const v = parseFloat(corps.coeffP1P2.valeur);
            if (!Number.isFinite(v) || v < COEFF_MIN || v > COEFF_MAX) {
                erreurs.push(`coeffP1P2.valeur doit être un nombre entre ${COEFF_MIN} et ${COEFF_MAX}`);
            } else {
                // On ne recopie PAS l'objet recu: seuls ces cinq champs
                // partent en base. Sans ce filtre, un client pourrait faire
                // grossir la ligne de config a volonte.
                const c = corps.coeffP1P2;
                const txt = (x, max) => (typeof x === 'string' ? x.slice(0, max) : null);
                aEcrire.push({
                    key: CLES.coeffP1P2,
                    value: JSON.stringify({
                        valeur: Math.round(v * 1e6) / 1e6,
                        le: txt(c.le, 40),
                        par: txt(c.par, 80),
                        fenetre: txt(c.fenetre, 60),
                        jours: Number.isFinite(parseInt(c.jours, 10)) ? parseInt(c.jours, 10) : null
                    })
                });
            }
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

module.exports = {
    lireReglages, ecrireReglages, valider, parseListe,
    validerListeDeNoms, CLES, DEFAUTS
};
