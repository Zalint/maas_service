/**
 * Agregation du parage sur une periode: dates, formats, cumul du mois.
 *
 * Isole du serveur pour etre testable sans base ni HTTP - c'est ici que se
 * jouent les deux pieges du projet: les quatre formats de date qui cohabitent,
 * et la regle de cumul qui doit rester identique a celle de l'ecran.
 */

const { CATEGORIES } = require('./parage');

/** Valide une date et la rend en ISO, ou null. Accepte YYYYMMDD et YYYY-MM-DD. */
function parseDateIso(valeur) {
    const v = String(valeur || '').trim();
    const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if (!m) return null;
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    const dt = new Date(iso + 'T00:00:00Z');
    // Le controle d'existence est indispensable: '28072026' (JJMMAAAA saisi
    // par erreur) satisfait la regex et deviendrait '2807-20-26'. Sans lui,
    // l'appelant recevrait un resultat vide au lieu d'une erreur.
    if (isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
    return iso;
}

/**
 * Les dates du 1er du mois JUSQU'A la date fournie, incluse.
 *
 * Cumul a date, et non mois calendaire entier: appelee le 12, l'API doit
 * decrire le mois tel qu'il est, pas un mois dont les deux tiers n'existent
 * pas encore.
 */
function datesJusquA(dateIso) {
    const [a, m, j] = dateIso.split('-').map(Number);
    const out = [];
    for (let d = 1; d <= j; d++) {
        out.push(`${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return out;
}

/**
 * Les formes sous lesquelles une date peut etre stockee.
 * ventes = YYYY-MM-DD, stocks et transferts = DD-MM-YYYY, et des DD/MM/YYYY
 * trainent selon l'anciennete des lignes. Interroger une seule forme ferait
 * tomber le numerateur a zero en gardant le denominateur, soit 100% de parage.
 */
function formesDeDate(iso) {
    const [a, m, j] = iso.split('-');
    return [iso, `${j}-${m}-${a}`, `${j}/${m}/${a}`];
}

/** Ramene n'importe laquelle de ces formes a l'ISO, ou null. */
function isoDepuisForme(valeur) {
    const v = String(valeur || '').trim().slice(0, 10);
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = v.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}

/** Range des lignes par date ISO. */
function grouperParDate(lignes, champ) {
    const par = {};
    for (const l of lignes || []) {
        const iso = isoDepuisForme(l[champ || 'date']);
        if (!iso) continue;
        (par[iso] = par[iso] || []).push(l);
    }
    return par;
}

function bloc() {
    return {
        matin: 0, transferts: 0, soir: 0, theorique: 0, vendu: 0,
        ratio: null, perte: null, parProduit: {}, joursMesures: 0
    };
}

/**
 * Cumule les journees d'un mois, sur le meme principe que les cartes de
 * l'ecran: SOMME des kilos, et non moyenne des taux journaliers - une journee
 * a 2 kg y pesait autant qu'une journee a 200 kg.
 *
 * Les journees non mesurables (ratio null: rien a mesurer, ou residu de
 * virgule flottante sous le seuil) n'entrent ni au numerateur ni au
 * denominateur. Les compter ferait deriver le taux du mois.
 *
 * @param {Array<Object>} parageParJour  sorties de calculerParage deja agregees
 *                                       par categorie: [{ bovin, ovin }, ...]
 */
function cumulerMois(parageParJour) {
    const total = {};
    for (const cat of CATEGORIES) total[cat] = bloc();

    for (const jour of parageParJour || []) {
        for (const cat of CATEGORIES) {
            const d = jour && jour[cat];
            if (!d || d.ratio === null || d.ratio === undefined) continue;
            const t = total[cat];
            t.matin += d.matin || 0;
            t.transferts += d.transferts || 0;
            t.soir += d.soir || 0;
            t.theorique += d.theorique || 0;
            t.vendu += d.vendu || 0;
            t.joursMesures += 1;
            for (const [produit, l] of Object.entries(d.parProduit || {})) {
                const cible = t.parProduit[produit] = t.parProduit[produit]
                    || { matin: 0, transferts: 0, soir: 0, theorique: 0, venduDirect: 0, venduPack: 0, vendu: 0 };
                for (const k of ['matin', 'transferts', 'soir', 'theorique', 'venduDirect', 'venduPack', 'vendu']) {
                    cible[k] += l[k] || 0;
                }
            }
        }
    }

    for (const cat of CATEGORIES) {
        const t = total[cat];
        t.ratio = t.theorique > 0 ? t.vendu / t.theorique : null;
        t.perte = t.ratio === null ? null : 1 - t.ratio;
    }
    return total;
}

/**
 * Additionne les points de vente d'une meme journee.
 * L'API repond pour le tenant entier; le detail par produit est conserve, il
 * porte le calcul de marge.
 */
function agregerPointsDeVente(parPv, filtrePointVente) {
    const total = {};
    for (const cat of CATEGORIES) total[cat] = bloc();

    for (const [pv, acc] of Object.entries(parPv || {})) {
        if (filtrePointVente && pv !== filtrePointVente) continue;
        for (const cat of CATEGORIES) {
            const d = acc[cat];
            if (!d) continue;
            const t = total[cat];
            t.matin += d.matin || 0;
            t.transferts += d.transferts || 0;
            t.soir += d.soir || 0;
            t.theorique += d.theorique || 0;
            t.vendu += d.vendu || 0;
            for (const [produit, l] of Object.entries(d.parProduit || {})) {
                const cible = t.parProduit[produit] = t.parProduit[produit]
                    || { matin: 0, transferts: 0, soir: 0, theorique: 0, venduDirect: 0, venduPack: 0, vendu: 0 };
                for (const k of ['matin', 'transferts', 'soir', 'theorique', 'venduDirect', 'venduPack', 'vendu']) {
                    cible[k] += l[k] || 0;
                }
            }
        }
    }

    // Meme seuil qu'en lib/parage.js: sous un gramme, rien a mesurer.
    for (const cat of CATEGORIES) {
        const t = total[cat];
        t.ratio = t.theorique > 0.001 ? t.vendu / t.theorique : null;
        t.perte = t.ratio === null ? null : 1 - t.ratio;
    }
    return total;
}

/**
 * Cumule les MARGES journalieres, sur exactement les memes journees que le
 * parage: celles ou la categorie etait mesurable.
 *
 * Calculer la marge d'un bloc sur tout le mois donnerait un vendu_kg different
 * de celui du parage - une journee a theorique nul apporte des ventes sans
 * denominateur. Deux chiffres pour la meme grandeur dans une seule reponse
 * sont pires que pas de chiffre du tout.
 *
 * @param {Array<Object>} margesParJour  sorties de calculerMarge, une par jour
 * @param {Array<Object>} parageParJour  sorties de parage, meme ordre
 */
function cumulerMarge(margesParJour, parageParJour) {
    const total = {};
    for (const cat of CATEGORIES) {
        total[cat] = {
            vendu_kg: 0, ca_vendu: 0, cout_theorique: 0, kg_coutes: 0,
            details: {
                hors_pack: { vendu_kg: 0, ca_vendu: 0 },
                pack: { vendu_kg: 0, ca_vendu: 0 }
            },
            hypotheses: [], produits_sans_prix_achat: []
        };
    }

    (margesParJour || []).forEach((marge, i) => {
        const parage = (parageParJour || [])[i] || {};
        for (const cat of CATEGORIES) {
            const p = parage[cat];
            // Meme regle d'admission que le parage: si la journee n'est pas
            // mesurable, elle n'entre pas non plus dans la marge.
            if (!p || p.ratio === null || p.ratio === undefined) continue;
            const m = (marge || {})[cat];
            if (!m) continue;
            const t = total[cat];
            t.vendu_kg += m.vendu_kg || 0;
            t.ca_vendu += m.ca_vendu || 0;
            t.cout_theorique += m.cout_theorique || 0;
            t.kg_coutes += (m.theorique_kg || 0) - (m.kg_sans_prix_achat || 0);
            t.details.hors_pack.vendu_kg += m.details ? m.details.hors_pack.vendu_kg : 0;
            t.details.hors_pack.ca_vendu += m.details ? m.details.hors_pack.ca_vendu : 0;
            t.details.pack.vendu_kg += m.details ? m.details.pack.vendu_kg : 0;
            t.details.pack.ca_vendu += m.details ? m.details.pack.ca_vendu : 0;
            for (const h of (m.hypotheses || [])) {
                if (!t.hypotheses.some((x) => x.produit === h.produit)) t.hypotheses.push(h);
            }
            for (const n of (m.produits_sans_prix_achat || [])) {
                if (!t.produits_sans_prix_achat.includes(n)) t.produits_sans_prix_achat.push(n);
            }
        }
    });

    // Prix moyens recalcules sur les cumuls: une moyenne de moyennes
    // journalieres donnerait le meme poids a une journee de 2 kg qu'a une
    // journee de 200 kg.
    const SEUIL = 0.001;
    for (const cat of CATEGORIES) {
        const t = total[cat];
        t.prix_vente_moyen = t.vendu_kg > SEUIL ? t.ca_vendu / t.vendu_kg : null;
        t.prix_achat_moyen = t.kg_coutes > SEUIL ? t.cout_theorique / t.kg_coutes : null;
        t.marge = t.ca_vendu - t.cout_theorique;
        t.details.hors_pack.prix_vente_moyen = t.details.hors_pack.vendu_kg > SEUIL
            ? t.details.hors_pack.ca_vendu / t.details.hors_pack.vendu_kg : null;
        t.details.pack.prix_vente_moyen = t.details.pack.vendu_kg > SEUIL
            ? t.details.pack.ca_vendu / t.details.pack.vendu_kg : null;
    }
    return total;
}

module.exports = {
    parseDateIso, datesJusquA, formesDeDate, isoDepuisForme,
    grouperParDate, cumulerMois, cumulerMarge, agregerPointsDeVente
};
