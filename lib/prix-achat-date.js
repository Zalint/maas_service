/**
 * Prix d'achat effectifs a une date, pour le calcul de marge.
 *
 * Trois sources, dans cet ordre, et chacune tracee dans les avertissements:
 *
 *  1. /api/external/achats-boeuf de DATA, quand la case "Prix API (DATA)" est
 *     cochee sur la ligne Boeuf. C'est le prix de revient du lot du jour,
 *     Sigma(prix - abats + frais) / Sigma(kg), deja pondere par les kilos.
 *     Le MEME resolveur que la marge du Centre de Decoupe: en recalculer un
 *     ici produirait deux prix d'achat differents pour la meme journee.
 *  2. L'historique prix_achat_history, derniere valeur <= date (point-in-time).
 *  3. Le catalogue fournisseur courant, faute de mieux.
 *
 * Regle metier explicite: le VEAU prend le prix du BOEUF. Le veau est un boeuf
 * vendu plus cher - meme carcasse, meme cout; la prime se voit cote vente. La
 * regle vit ici, pas dans le calcul generique, pour rester visible et
 * modifiable sans toucher aux formules.
 */

const { Op } = require('sequelize');

// Produits qui partagent le cout de la carcasse de boeuf.
const FAMILLE_BOEUF = /^(boeuf|veau)/i;

const normaliser = (n) => String(n || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * @param {string} dateIso  'YYYY-MM-DD'
 * @returns {Promise<{prixAchat: Function, prixAchatDefaut: Object, avertissements: string[]}>}
 */
async function prixAchatALaDate(dateIso) {
    const { FournisseurPrix, PrixAchatHistory } = require('../db/models');
    const avertissements = [];

    const rows = await FournisseurPrix.findAll({ raw: true });

    // Point-in-time: la derniere ecriture <= fin de la journee gagne.
    const borne = new Date(dateIso + 'T23:59:59.999Z');
    let historique = [];
    try {
        historique = await PrixAchatHistory.findAll({
            where: { created_at: { [Op.lte]: borne } },
            order: [['created_at', 'ASC']],
            raw: true
        });
    } catch (e) {
        avertissements.push(
            `Historique des prix d'achat illisible (${e.message}): prix courants du catalogue utilises.`
        );
    }
    const aLaDate = {};
    for (const h of historique) aLaDate[normaliser(h.produit)] = parseFloat(h.prix_achat);

    const catalogue = {};
    let boeufDynamique = false;
    for (const r of rows) {
        const cle = normaliser(r.produit);
        const v = parseFloat(r.prix_achat);
        if (Number.isFinite(v) && v > 0) catalogue[cle] = v;
        if (cle === 'boeuf' && r.prix_achat_dynamique === true) boeufDynamique = true;
    }

    const depuisCatalogue = (nom) => {
        const cle = normaliser(nom);
        const h = aLaDate[cle];
        if (Number.isFinite(h) && h > 0) return h;
        return Number.isFinite(catalogue[cle]) && catalogue[cle] > 0 ? catalogue[cle] : null;
    };

    // --- Prix du boeuf: DATA en priorite quand la case est cochee ---------
    let prixBoeuf = depuisCatalogue('Boeuf');
    let origineBoeuf = 'catalogue fournisseur';
    if (boeufDynamique) {
        try {
            const { getBoeufPrixAchatResolver } = require('./achats-boeuf-client');
            const resolveur = await getBoeufPrixAchatResolver();
            const p = resolveur && typeof resolveur.atDate === 'function' ? resolveur.atDate(dateIso) : null;
            if (Number.isFinite(parseFloat(p)) && parseFloat(p) > 0) {
                prixBoeuf = parseFloat(p);
                origineBoeuf = 'achats-boeuf (DATA), prix de revient du lot';
            } else {
                avertissements.push(
                    "Prix d'achat du boeuf: DATA n'a renvoye aucun lot a cette date, "
                    + 'le prix du catalogue a ete utilise.'
                );
            }
        } catch (e) {
            avertissements.push(
                `Prix d'achat du boeuf: DATA injoignable (${e.message}), `
                + 'le prix du catalogue a ete utilise.'
            );
        }
    }

    const prixAgneau = depuisCatalogue('Agneau');
    if (prixBoeuf == null) {
        avertissements.push("Aucun prix d'achat connu pour le boeuf: le cout bovin sera incomplet.");
    }
    if (prixAgneau == null) {
        avertissements.push("Aucun prix d'achat connu pour l'agneau: le cout ovin sera incomplet.");
    }

    /**
     * Prix d'achat d'un produit, ou null si l'appelant doit se rabattre sur
     * une hypothese (deduction depuis le prix de vente).
     */
    const prixAchat = (produit) => {
        const nom = String(produit || '');
        // Regle metier: toute la famille boeuf/veau partage le cout de la
        // carcasse, y compris "Boeuf en detail", "Boeuf en gros", "Veau en gros".
        if (FAMILLE_BOEUF.test(normaliser(nom))) return prixBoeuf;
        const propre = depuisCatalogue(nom);
        return propre != null ? propre : null;
    };

    return {
        prixAchat,
        prixAchatDefaut: { bovin: prixBoeuf, ovin: prixAgneau },
        origineBoeuf,
        avertissements
    };
}

module.exports = { prixAchatALaDate, FAMILLE_BOEUF };
