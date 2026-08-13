/**
 * Prix d'achat effectifs A UNE DATE, pour le calcul de marge.
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
 * Le prix varie DANS le mois: sur juillet 2026 le boeuf va de 3735 a 4435 F/kg.
 * Un resolveur unique fige a la date demandee valoriserait les 31 journees au
 * prix du dernier jour - jusqu'a 40% d'ecart sur la marge du mois, mesure sur
 * juin. D'ou la forme adoptee: on charge les sources UNE fois, puis on resout
 * jour par jour. C'est aussi ce que fait deja routes/finance-creances.js, qui
 * appelle lookupPrixAchatAtDate(produit, venteDateISO) par vente.
 *
 * Regle metier explicite: le VEAU prend le prix du BOEUF. Le veau est un boeuf
 * vendu plus cher - meme carcasse, meme cout; la prime se voit cote vente. La
 * regle vit ici, pas dans le calcul generique, pour rester visible et
 * modifiable sans toucher aux formules.
 */

// Sequelize est requis DANS la fonction, pas en tete de module: charge au
// niveau du fichier, il tirait toute la pile base dans Jest et cassait les
// tests qui n'ont besoin que de la constante FAMILLE_BOEUF. Les modules lib/
// de ce projet restent sans dependance pour rester testables.

// Produits qui partagent le cout de la carcasse de boeuf.
const FAMILLE_BOEUF = /^(boeuf|veau)/i;

// Importee, pas recopiee: voir lib/parage-contexte.js.
const { normaliserNom: normaliser } = require('./parage');

/**
 * Charge les sources une fois, et rend un resolveur par date.
 *
 * @param {string} dateMaxIso  borne haute des dates qui seront demandees
 * @returns {Promise<{pourDate: Function, avertissements: string[]}>}
 */
async function creerResolveurPrixAchat(dateMaxIso) {
    const { Op } = require('sequelize');
    const { FournisseurPrix, PrixAchatHistory } = require('../db/models');
    const avertissements = [];

    const rows = await FournisseurPrix.findAll({ raw: true });

    // Tout l'historique jusqu'a la borne, trie: `pourDate` y retrouvera la
    // derniere ecriture <= la date voulue, sans rappeler la base.
    const borne = new Date(dateMaxIso + 'T23:59:59.999Z');
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

    const catalogue = {};
    let boeufDynamique = false;
    for (const r of rows) {
        const cle = normaliser(r.produit);
        const v = parseFloat(r.prix_achat);
        if (Number.isFinite(v) && v > 0) catalogue[cle] = v;
        if (cle === 'boeuf' && r.prix_achat_dynamique === true) boeufDynamique = true;
    }

    // Resolveur DATA, charge une seule fois lui aussi: ses lignes sont en
    // memoire et atDate() n'est qu'une recherche.
    let marcheBoeuf = null;
    if (boeufDynamique) {
        try {
            const { getBoeufPrixAchatResolver } = require('./achats-boeuf-client');
            const r = await getBoeufPrixAchatResolver();
            if (r && typeof r.atDate === 'function') marcheBoeuf = r;
        } catch (e) {
            avertissements.push(
                `Prix d'achat du boeuf: DATA injoignable (${e.message}), `
                + 'le prix du catalogue a ete utilise.'
            );
        }
    }

    /** Derniere valeur de l'historique <= date, sinon le catalogue courant. */
    const depuisHistorique = (nom, dateIso) => {
        const cle = normaliser(nom);
        const borneJour = new Date(dateIso + 'T23:59:59.999Z').getTime();
        let valeur = null;
        for (const h of historique) {
            if (normaliser(h.produit) !== cle) continue;
            if (new Date(h.created_at).getTime() > borneJour) break;
            const v = parseFloat(h.prix_achat);
            if (Number.isFinite(v) && v > 0) valeur = v;
        }
        if (valeur !== null) return valeur;
        return Number.isFinite(catalogue[cle]) && catalogue[cle] > 0 ? catalogue[cle] : null;
    };

    const sansLotSignale = new Set();

    // SUIVI DU PRIX BOVIN REELLEMENT RETENU, journee par journee.
    //
    // Dire "le prix du catalogue a ete utilise" sans dire LEQUEL laisse
    // l'utilisateur sans le chiffre qui explique son cout. Et quand MATA
    // repond, le prix qui en vient merite d'etre affiche au meme endroit:
    // c'est la meme question - "sur quel prix ce resultat repose-t-il".
    const suiviBoeuf = { mata: [], catalogue: [] };
    const noterPrixBoeuf = (source, valeur) => {
        const v = parseFloat(valeur);
        if (!Number.isFinite(v) || v <= 0) return;
        const liste = suiviBoeuf[source];
        if (liste && liste.indexOf(v) < 0) liste.push(v);
    };
    /** Une phrase par source, ou null si la source n'a rien servi. */
    const resumePrixBoeuf = () => {
        const phrases = [];
        const dire = (liste) => {
            const min = Math.min.apply(null, liste);
            const max = Math.max.apply(null, liste);
            const f = (n) => Math.round(n).toLocaleString('fr-FR');
            return min === max ? `${f(min)} F` : `de ${f(min)} à ${f(max)} F`;
        };
        if (suiviBoeuf.mata.length) {
            phrases.push(`Prix d'achat du boeuf retenu depuis MATA (prix de revient du lot) : ${dire(suiviBoeuf.mata)}.`);
        }
        if (suiviBoeuf.catalogue.length) {
            phrases.push(`Prix d'achat du boeuf retenu depuis le catalogue fournisseur : ${dire(suiviBoeuf.catalogue)}.`);
        }
        return phrases;
    };

    /**
     * Les prix effectifs a UNE date.
     * @returns {{prixAchat: Function, prixAchatDefaut: Object, origineBoeuf: string}}
     */
    const pourDate = (dateIso) => {
        let prixBoeuf = depuisHistorique('Boeuf', dateIso);
        let origineBoeuf = 'catalogue fournisseur';
        if (marcheBoeuf) {
            const p = parseFloat(marcheBoeuf.atDate(dateIso));
            if (Number.isFinite(p) && p > 0) {
                prixBoeuf = p;
                origineBoeuf = 'achats-boeuf (DATA), prix de revient du lot';
                noterPrixBoeuf('mata', p);
            } else {
                noterPrixBoeuf('catalogue', prixBoeuf);
                if (!sansLotSignale.has('x')) {
                    // Un seul avertissement, pas un par journee du mois.
                    sansLotSignale.add('x');
                    avertissements.push(
                        "Prix d'achat du boeuf: MATA n'a renvoye aucun lot pour au moins "
                        + 'une journee, le prix du catalogue y a ete utilise.'
                    );
                }
            }
        } else {
            // Prix non dynamique: le catalogue est la source normale, pas un
            // repli. On le suit quand meme, pour pouvoir l'afficher.
            noterPrixBoeuf('catalogue', prixBoeuf);
        }
        const prixAgneau = depuisHistorique('Agneau', dateIso);

        const prixAchat = (produit) => {
            // Regle metier: toute la famille boeuf/veau partage le cout de la
            // carcasse, y compris "Boeuf en detail", "Boeuf en gros", "Veau...".
            if (FAMILLE_BOEUF.test(normaliser(produit))) return prixBoeuf;
            const propre = depuisHistorique(produit, dateIso);
            return propre != null ? propre : null;
        };

        return {
            prixAchat,
            prixAchatDefaut: { bovin: prixBoeuf, ovin: prixAgneau },
            origineBoeuf
        };
    };

    return { pourDate, avertissements, resumePrixBoeuf };
}

/** Compatibilite: les prix d'UNE date, sans resolveur a gerer. */
async function prixAchatALaDate(dateIso) {
    const { pourDate, avertissements } = await creerResolveurPrixAchat(dateIso);
    const r = pourDate(dateIso);
    if (r.prixAchatDefaut.bovin == null) {
        avertissements.push("Aucun prix d'achat connu pour le boeuf: le cout bovin sera incomplet.");
    }
    if (r.prixAchatDefaut.ovin == null) {
        avertissements.push("Aucun prix d'achat connu pour l'agneau: le cout ovin sera incomplet.");
    }
    return { ...r, avertissements };
}

module.exports = { creerResolveurPrixAchat, prixAchatALaDate, FAMILLE_BOEUF };
