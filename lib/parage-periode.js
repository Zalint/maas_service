/**
 * Agregation du parage sur une periode: dates, formats, cumul du mois.
 *
 * Isole du serveur pour etre testable sans base ni HTTP - c'est ici que se
 * jouent les deux pieges du projet: les quatre formats de date qui cohabitent,
 * et la regle de cumul qui doit rester identique a celle de l'ecran.
 */

const { CATEGORIES, SEUIL_KG, tauxDePerte } = require('./parage');

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
        // LA definition du taux, importee et non recopiee (cf lib/parage.js).
        const taux = tauxDePerte(t.vendu, t.theorique);
        t.ratio = taux.ratio;
        t.perte = taux.perte;
    }
    return total;
}

/**
 * Additionne les points de vente d'une meme journee.
 * L'API repond pour le tenant entier; le detail par produit est conserve, il
 * porte le calcul de marge.
 *
 * RESERVE, a trancher le jour ou un tenant aura plusieurs points de vente
 * (aujourd'hui il y en a un seul, donc le cas ne se produit pas): les kilos
 * sont additionnes AVANT le test de mesurabilite. Un point de vente qui vend
 * sans stock saisi verse donc ses kilos vendus dans un total dont il ne nourrit
 * pas le denominateur, et le parage du tenant s'en trouve minore. Interroges un
 * par un, ces points de vente rendraient "non mesurable" la ou le total affiche
 * un taux: total et somme des details ne diraient pas la meme chose, sans que
 * rien ne le signale. Le cumul du MOIS traite deja ce cas (jours_ignores /
 * ca_ignore); il faudra l'equivalent ici, ou assumer explicitement le contraire.
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

    for (const cat of CATEGORIES) {
        const t = total[cat];
        // LA definition du taux, importee et non recopiee (cf lib/parage.js).
        const taux = tauxDePerte(t.vendu, t.theorique);
        t.ratio = taux.ratio;
        t.perte = taux.perte;
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
            hypotheses: [], produits_sans_prix_achat: [], kgNegatifs: [],
            // Ce qui a ete ECARTE. Une journee non mesurable n'entre pas dans
            // la marge - son cout est inconnu - mais son chiffre d'affaires
            // existe bel et bien. Le passer sous silence ferait lire "marge du
            // mois : 0 F" sur des centaines de milliers de francs encaisses.
            jours_ignores: 0, ca_ignore: 0, vendu_kg_ignore: 0,
            // Kilos theoriques qu'aucun prix n'a pu couter. Sans lui,
            // l'appelant ne peut pas recouper theorique_kg x prix_achat_moyen
            // contre cout_theorique.
            kg_sans_prix_achat: 0
        };
    }

    (margesParJour || []).forEach((marge, i) => {
        const parage = (parageParJour || [])[i] || {};
        for (const cat of CATEGORIES) {
            const p = parage[cat];
            // Meme regle d'admission que le parage: si la journee n'est pas
            // mesurable, elle n'entre pas non plus dans la marge.
            const m = (marge || {})[cat];
            if (!p || p.ratio === null || p.ratio === undefined) {
                // Journee ecartee: on retient quand meme ce qu'elle pesait,
                // pour que l'appelant sache ce qui manque au total.
                if (m) {
                    total[cat].jours_ignores += 1;
                    total[cat].ca_ignore += m.ca_vendu || 0;
                    total[cat].vendu_kg_ignore += m.vendu_kg || 0;
                }
                continue;
            }
            if (!m) continue;
            const t = total[cat];
            t.jours_mesures_marge = (t.jours_mesures_marge || 0) + 1;
            t.vendu_kg += m.vendu_kg || 0;
            t.ca_vendu += m.ca_vendu || 0;
            t.cout_theorique += m.cout_theorique || 0;
            // Les kilos coutes tels que la journee les a comptes. Ils etaient
            // reconstruits par difference, ce qui supposait que le theorique ne
            // se divise qu'en deux - coute et sans prix. L'arrivee d'un
            // troisieme cas, le theorique negatif, a rendu cette hypothese
            // fausse sans qu'aucun test ne le voie.
            t.kg_coutes += m.kg_coutes || 0;
            t.kg_sans_prix_achat += m.kg_sans_prix_achat || 0;
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
            // Les kilos s'ADDITIONNENT sur le mois. Garder la premiere journee
            // rencontree afficherait "-4 kg" pour un produit qui en a accumule
            // quarante, et le chiffre ne se rattacherait a aucune date.
            for (const n of (m.kgNegatifs || [])) {
                const dejaVu = t.kgNegatifs.find((x) => x.produit === n.produit);
                if (dejaVu) dejaVu.kg += n.kg;
                else t.kgNegatifs.push({ produit: n.produit, kg: n.kg });
            }
        }
    });

    // Prix moyens recalcules sur les cumuls: une moyenne de moyennes
    // journalieres donnerait le meme poids a une journee de 2 kg qu'a une
    // journee de 200 kg.
    for (const cat of CATEGORIES) {
        const t = total[cat];
        t.prix_vente_moyen = t.vendu_kg > SEUIL_KG ? t.ca_vendu / t.vendu_kg : null;
        t.prix_achat_moyen = t.kg_coutes > SEUIL_KG ? t.cout_theorique / t.kg_coutes : null;
        // Aucune journee mesurable: la marge est INCONNUE, pas nulle. Rendre 0
        // se lirait "on n'a rien gagne" alors qu'on n'a simplement pas pu
        // calculer le cout, faute de stock saisi.
        t.marge = t.jours_mesures_marge > 0 ? t.ca_vendu - t.cout_theorique : null;
        t.details.hors_pack.prix_vente_moyen = t.details.hors_pack.vendu_kg > SEUIL_KG
            ? t.details.hors_pack.ca_vendu / t.details.hors_pack.vendu_kg : null;
        t.details.pack.prix_vente_moyen = t.details.pack.vendu_kg > SEUIL_KG
            ? t.details.pack.ca_vendu / t.details.pack.vendu_kg : null;
    }
    return total;
}

module.exports = {
    parseDateIso, datesJusquA, formesDeDate, isoDepuisForme,
    grouperParDate, cumulerMois, cumulerMarge, agregerPointsDeVente
};
