/**
 * LE SOLDE DES CREANCES CLIENTS.
 *
 * Contrairement au fournisseur (dont le solde vient de MataBanq, source de
 * verite externe), aucun historique de remboursement client n'existe: le
 * champ `ventes.creance` est ecrit une fois a la vente et n'est plus jamais
 * modifie. Sommer TOUTES les ventes a credit depuis toujours surestimerait
 * donc la creance indefiniment, y compris pour des clients qui ont deja paye
 * de la main a la main sans que le systeme ne l'ait su.
 *
 * Le solde se construit donc comme celui de lib/cash-theorique.js: un point
 * de depart pose une fois (solde_ouverture, a une date_ouverture choisie),
 * puis un FLUX suivi a partir de ce point - les nouvelles ventes a credit
 * l'augmentent, les remboursements enregistres le diminuent.
 *
 * Module PUR: aucune requete, aucune date systeme. Il recoit des listes deja
 * lues et rend le detail.
 */

function nb(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

function round2(v) {
    return Math.round(nb(v) * 100) / 100;
}

/**
 * @param {object} a
 * @param {number} a.soldeOuverture       creance connue a la date_ouverture
 * @param {string} a.dateOuverture        date ISO a partir de laquelle le
 *                                        flux ci-dessous est suivi (exclue -
 *                                        les ventes/remboursements de ce jour
 *                                        meme sont deja dans le solde de
 *                                        depart, sinon ils compteraient deux
 *                                        fois)
 * @param {Array<{date: string, montant: number}>} a.ventesCreance   ventes a
 *        credit strictement posterieures a date_ouverture
 * @param {Array<{date: string, montant: number, commentaire?: string}>}
 *        a.remboursements   remboursements clients enregistres, strictement
 *        posterieurs a date_ouverture
 */
function construireCreancesClient(a) {
    const args = a || {};
    const soldeOuverture = round2(args.soldeOuverture);
    const dateOuverture = args.dateOuverture || null;

    const ventes = (args.ventesCreance || []).map((v) => ({
        date: String(v.date || '').slice(0, 10),
        montant: round2(v.montant)
    }));
    const remboursements = (args.remboursements || []).map((r) => ({
        date: String(r.date || '').slice(0, 10),
        montant: round2(r.montant),
        commentaire: String(r.commentaire || '')
    }));

    const totalVentes = round2(ventes.reduce((s, v) => s + v.montant, 0));
    const totalRemboursements = round2(remboursements.reduce((s, r) => s + r.montant, 0));
    const total = round2(soldeOuverture + totalVentes - totalRemboursements);

    return {
        solde_ouverture: soldeOuverture,
        date_ouverture: dateOuverture,
        ventes_creance: { montant: totalVentes, nb: ventes.length, detail: ventes },
        remboursements: { montant: totalRemboursements, nb: remboursements.length, detail: remboursements },
        total: total,
        // Sans date d'ouverture posee, le total n'est que la somme du flux
        // recu - jamais une vraie creance client. L'appelant doit le dire.
        fiable: !!dateOuverture
    };
}

module.exports = { construireCreancesClient };
