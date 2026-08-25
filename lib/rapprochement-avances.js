/**
 * LE DETAIL PAR DATE CONFRONTE AUX AVANCES DU PARTENAIRE.
 *
 * « Detail par date » dit ce que Maas a RECU et valorise au prix d'achat
 * fournisseur. MataBanq, de son cote, enregistre une AVANCE le jour ou la
 * marchandise part. Les deux decrivent la meme livraison par deux bouts, et
 * doivent donc tomber sur le meme montant.
 *
 * Verifie sur aout 2026 a Mbao, et l'accord est exact au franc:
 *   17/08  Boeuf 688 500 + Yell 8 000                     = 696 500 = avance
 *   14/08  393 344 + 90 000 + 8 000 + 5 625               = 496 969 = avance
 *   22/08  Boeuf 347 136                                  = 347 136 = avance
 *
 * LA COMPARAISON EST PAR DATE, pas par ligne. Une journee porte plusieurs
 * produits et une seule avance: confronter une ligne isolee a l'avance du jour
 * crierait a l'ecart sur toutes les journees a plusieurs produits.
 *
 * Module PUR: aucune requete, aucune date systeme.
 */

// 5 francs. La valorisation arrondit au centime a plusieurs endroits (quantite
// affichee x prix affiche), et le partenaire saisit des montants entiers: sous
// ce seuil, l'ecart ne dit rien d'autre que l'arrondi.
const TOLERANCE_PAR_DEFAUT = 5;

function nb(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

function round2(v) {
    return Math.round(nb(v) * 100) / 100;
}

/**
 * @param {object} a
 * @param {Array}  a.detailParDate  [{date, produit, montant_achat}] - montant_achat
 *                                  peut etre null quand le prix d'achat est inconnu
 * @param {Array}  a.avances        [{date, montant}] cote partenaire
 * @param {number} [a.tolerance=5]
 * @returns {{par_date: object, resume: object, tolerance: number}}
 */
function rapprocherAvances(a) {
    const args = a || {};
    const tol = Number.isFinite(parseFloat(args.tolerance))
        ? Math.abs(parseFloat(args.tolerance))
        : TOLERANCE_PAR_DEFAUT;

    // Plusieurs avances le meme jour s'additionnent: c'est une seule livraison
    // saisie en deux fois, pas deux verites concurrentes.
    const avanceParDate = new Map();
    for (const av of (args.avances || [])) {
        const d = String((av && av.date) || '').slice(0, 10);
        if (!d) continue;
        avanceParDate.set(d, round2((avanceParDate.get(d) || 0) + nb(av.montant)));
    }

    const parDate = {};
    for (const l of (args.detailParDate || [])) {
        const d = String((l && l.date) || '').slice(0, 10);
        if (!d) continue;
        if (!parDate[d]) {
            parDate[d] = { date: d, montant_achat: 0, nb_produits: 0, nb_sans_prix: 0 };
        }
        const e = parDate[d];
        e.nb_produits += 1;
        // UN PRODUIT SANS PRIX D'ACHAT ne vaut pas zero: il vaut inconnu. Le
        // compter a zero ferait manquer la journee a l'avance et afficherait un
        // ecart qui ne decrit qu'une donnee absente.
        if (l.montant_achat === null || l.montant_achat === undefined) e.nb_sans_prix += 1;
        else e.montant_achat += nb(l.montant_achat);
    }

    for (const d of Object.keys(parDate)) {
        const e = parDate[d];
        e.montant_achat = round2(e.montant_achat);
        const aUneAvance = avanceParDate.has(d);
        e.avance = aUneAvance ? avanceParDate.get(d) : null;
        e.ecart = aUneAvance ? round2(e.montant_achat - e.avance) : null;
        if (e.nb_sans_prix > 0) {
            // Incomplet PRIME sur tout le reste: sans un des prix, ni l'accord
            // ni le desaccord ne peuvent etre affirmes.
            e.statut = 'incomplet';
        } else if (!aUneAvance) {
            e.statut = 'sans_avance';
        } else {
            e.statut = Math.abs(e.ecart) <= tol ? 'correspond' : 'ecart';
        }
    }

    // Une avance SANS aucune ligne de detail ce jour-la: la marchandise est
    // partie de chez MATA sans etre recue cote Maas, ou l'a ete sous une date
    // differente. Le taire laisserait croire au rapprochement complet.
    const datesDetail = new Set(Object.keys(parDate));
    const avancesSansDetail = Array.from(avanceParDate.entries())
        .filter(([d]) => !datesDetail.has(d))
        .map(([date, montant]) => ({ date: date, montant: montant }))
        .sort((x, y) => y.date.localeCompare(x.date));

    const toutes = Object.values(parDate);
    const compter = (s) => toutes.filter((e) => e.statut === s).length;
    return {
        par_date: parDate,
        tolerance: tol,
        resume: {
            nb_dates: toutes.length,
            nb_correspond: compter('correspond'),
            nb_ecart: compter('ecart'),
            nb_sans_avance: compter('sans_avance'),
            nb_incomplet: compter('incomplet'),
            // La somme des ecarts NON tolerés: c'est le montant sur lequel les
            // deux comptabilites ne s'accordent pas.
            ecart_total: round2(toutes
                .filter((e) => e.statut === 'ecart')
                .reduce((s, e) => s + e.ecart, 0)),
            avances_sans_detail: avancesSansDetail
        }
    };
}

module.exports = { rapprocherAvances, TOLERANCE_PAR_DEFAUT };
