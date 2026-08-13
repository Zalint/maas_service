/**
 * Journees ECARTEES du cumul mensuel de reconciliation.
 *
 * Une journee dont l'inventaire du soir n'a pas ete saisi produit un parage
 * absurde, et le cumul du mois en herite puisqu'il somme les kilos. L'exclure
 * ne corrige pas la donnee: ca dit au calcul de ne pas la lire.
 *
 * POURQUOI COTE SERVEUR. La premiere version rangeait ces exclusions dans le
 * localStorage du navigateur. Trois defauts, tous constates:
 *
 *  1. Deux personnes lisaient deux parages differents pour le meme mois - 3,6 %
 *     pour celle qui avait exclu, 17,5 % pour l'autre - sans qu'aucun ecran ne
 *     puisse le dire.
 *  2. Sur un poste partage, l'exclusion posee par le premier utilisateur
 *     s'appliquait silencieusement aux totaux que lisait le suivant.
 *  3. Une exclusion est un JUGEMENT sur la qualite d'une donnee. Un jugement
 *     s'attribue et se date; un localStorage ne porte ni auteur ni horodatage.
 *
 * Elles vivent donc dans finance_config, comme parage_exclusions et
 * parage_dechets qui sont exactement de la meme nature: une decision
 * d'administration sur ce qui entre dans un calcul. La table vit dans le
 * schema du tenant (db/index.js pose un SET search_path par connexion), donc
 * le reglage est par point de vente sans une ligne de code pour ca.
 *
 * CE QUE CETTE EXCLUSION NE FAIT PAS. Elle ne porte QUE sur les cartes et les
 * totaux de l'ecran « Reconciliation du mois ». Le PL, les snapshots figes et
 * l'export Excel continuent de compter la journee: ils ont leurs propres
 * bornes et leurs propres regles, et les rebrancher ici changerait des
 * chiffres financiers sans que personne ne l'ait demande. Le jour ou cette
 * extension sera voulue, c'est CE module qu'ils liront - la donnee est
 * desormais au bon endroit pour ca.
 */

const CLE = 'reconciliation_exclusions';

// Bornes defensives: la colonne est en TEXT et n'oppose aucune limite. Un mois
// compte au plus 31 jours x quelques points de vente, et on garde une annee
// ou deux de mois - largement en dessous de ces plafonds.
const MAX_MOIS = 60;
const MAX_PAR_MOIS = 400;
const MAX_LONGUEUR_CLE = 120;

/** 'MM-AAAA', la forme utilisee par les deux menus deroulants de l'ecran. */
const FORME_MOIS = /^(0[1-9]|1[0-2])-\d{4}$/;

/**
 * Toutes les exclusions, par mois.
 *
 * Une valeur illisible ne fait jamais echouer la lecture: on rend un objet
 * vide, ce qui revient a n'exclure personne - l'etat par defaut, et le seul
 * qui ne cache rien a l'utilisateur.
 *
 * @returns {Promise<Object<string, Array<{cle: string, par: string|null, le: string|null}>>>}
 */
async function lireExclusions() {
    const { FinanceConfig } = require('../db/models');
    let brut;
    try {
        const row = await FinanceConfig.findOne({ where: { key: CLE } });
        brut = row && row.value;
    } catch (e) {
        console.warn('[reconciliation] exclusions illisibles:', e.message);
        return {};
    }
    if (!brut || !String(brut).trim()) return {};
    let o;
    try { o = JSON.parse(String(brut)); } catch (e) {
        console.warn('[reconciliation] exclusions: JSON invalide, aucune exclusion appliquee');
        return {};
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};

    // On RENORMALISE a la lecture. Une ligne ecrite a la main en base, ou par
    // une version anterieure, ne doit pas pouvoir faire disparaitre une
    // journee des totaux sous une forme que l'ecriture aurait refusee.
    const out = {};
    for (const mois of Object.keys(o)) {
        if (!FORME_MOIS.test(mois)) continue;
        const liste = Array.isArray(o[mois]) ? o[mois] : [];
        const propre = [];
        const vues = new Set();
        for (const e of liste) {
            const cle = typeof e === 'string' ? e : (e && typeof e.cle === 'string' ? e.cle : null);
            if (!cle || cle.length > MAX_LONGUEUR_CLE || vues.has(cle)) continue;
            vues.add(cle);
            propre.push({
                cle,
                par: (e && typeof e.par === 'string') ? e.par : null,
                le: (e && typeof e.le === 'string') ? e.le : null
            });
            if (propre.length >= MAX_PAR_MOIS) break;
        }
        if (propre.length) out[mois] = propre;
    }
    return out;
}

/**
 * Pose ou retire UNE exclusion, et rend l'etat du mois apres coup.
 *
 * Une ecriture par bascule, plutot qu'un remplacement de la liste entiere:
 * deux personnes qui cochent deux journees differentes en meme temps doivent
 * obtenir deux exclusions, pas la derniere ecriture qui gagne.
 *
 * @param {Object} args
 * @param {string} args.mois     'MM-AAAA'
 * @param {string} args.cle      'JJ/MM/AAAA|Point de vente'
 * @param {boolean} args.exclure true = exclure, false = reintegrer
 * @param {string|null} args.par nom de l'utilisateur, pose par la route
 * @param {string} args.le       horodatage ISO, pose par la route
 */
async function basculerExclusion(args) {
    const { mois, cle, exclure, par, le } = args || {};
    if (!FORME_MOIS.test(String(mois || ''))) {
        return { ok: false, erreur: 'mois attendu au format MM-AAAA' };
    }
    const cleStr = String(cle || '').trim();
    if (!cleStr) return { ok: false, erreur: 'cle d\'exclusion vide' };
    if (cleStr.length > MAX_LONGUEUR_CLE) {
        return { ok: false, erreur: `cle d'exclusion trop longue (${MAX_LONGUEUR_CLE} caracteres au maximum)` };
    }

    const toutes = await lireExclusions();
    const liste = (toutes[mois] || []).filter((e) => e.cle !== cleStr);
    if (exclure) {
        if (liste.length >= MAX_PAR_MOIS) {
            return { ok: false, erreur: `${MAX_PAR_MOIS} exclusions au maximum pour un mois` };
        }
        liste.push({ cle: cleStr, par: par || null, le: le || null });
    }
    if (liste.length) toutes[mois] = liste; else delete toutes[mois];

    // Les mois les plus anciens sortent quand le plafond est atteint. Sans
    // cette purge, la ligne grossit indefiniment: personne ne va reintegrer a
    // la main une journee de 2024 pour faire de la place.
    const mois_tries = Object.keys(toutes).sort(parAncienneteCroissante);
    while (mois_tries.length > MAX_MOIS) delete toutes[mois_tries.shift()];

    const { FinanceConfig } = require('../db/models');
    await FinanceConfig.upsert({ key: CLE, value: JSON.stringify(toutes), updated_at: new Date() });
    return { ok: true, mois: toutes[mois] || [] };
}

/** 'MM-AAAA' se trie par l'annee PUIS le mois, jamais lexicalement. */
function parAncienneteCroissante(a, b) {
    return (a.slice(3) + a.slice(0, 2)).localeCompare(b.slice(3) + b.slice(0, 2));
}

module.exports = { lireExclusions, basculerExclusion, CLE, FORME_MOIS, MAX_PAR_MOIS };
