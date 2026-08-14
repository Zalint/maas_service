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
    const { FournisseurPrix, PrixAchatHistory, ProduitAlias } = require('../db/models');
    const avertissements = [];

    const rows = await FournisseurPrix.findAll({ raw: true });

    // LE MAPPING PRODUITS decide desormais quel libelle de vente correspond a
    // quelle entree du catalogue, et dans quelle unite.
    //
    // C'etait la SEULE notion du depot a exister en double: l'ecran Mapping
    // produits la reglait pour la commission, pendant que deux listes -
    // famille_poulet, famille_boeuf - la reglaient pour le cout, avec des
    // regles differentes. Une seule source, desormais, et un ecran deja fait.
    //
    // Le COEFFICIENT est une conversion d'unite, jamais une imputation: la
    // carcasse est achetee une seule fois, sous « Boeuf », et sa commission
    // avec elle. Un Jarret vaut 0,5 parce qu'il se vend a la piece et qu'une
    // piece pese environ 500 g - pas parce qu'on le rachete.
    let aliasParNom = new Map();
    try {
        const alias = await ProduitAlias.findAll({ raw: true });
        for (const a of alias) {
            const c = parseFloat(a.coefficient);
            aliasParNom.set(normaliser(a.alias_produit), {
                cible: a.produit_catalog,
                coefficient: Number.isFinite(c) && c > 0 ? c : 1
            });
        }
    } catch (e) {
        // Un mapping illisible ne doit pas priver le PL de tous ses couts: on
        // retombe sur la resolution d'avant - nom propre, puis famille bovine.
        avertissements.push(
            `Mapping produits illisible (${e.message}) : les coûts sont résolus par nom seul.`
        );
        aliasParNom = new Map();
    }

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
    // On garde AUSSI le dernier prix retenu et sa date. Une fourchette dit ce
    // qu'on a paye sur la periode; elle ne dit pas ce qu'on paie AUJOURD'HUI,
    // qui est le chiffre a partir duquel on decide la suite du mois.
    const suiviBoeuf = {
        mata: [], catalogue: [],
        dernier: { mata: null, catalogue: null }
    };
    const noterPrixBoeuf = (source, valeur, dateIso) => {
        const v = parseFloat(valeur);
        if (!Number.isFinite(v) || v <= 0) return;
        const liste = suiviBoeuf[source];
        if (liste && liste.indexOf(v) < 0) liste.push(v);
        // Le plus RECENT, pas le dernier appele: pourDate peut etre invoque
        // dans n'importe quel ordre (la moyenne ponderee de la simulation
        // parcourt les lignes de vente, pas le calendrier).
        const d = suiviBoeuf.dernier[source];
        if (dateIso && (!d || dateIso > d.date)) {
            suiviBoeuf.dernier[source] = { prix: v, date: dateIso };
        }
    };
    /**
     * La fourchette des prix bovins REELLEMENT retenus, toutes sources
     * confondues, et le plus recent d'entre eux.
     *
     * Sert aux scenarios de la projection: « et si la suite du mois se payait
     * au plus haut / au plus bas de ce qu'on a connu ». Les deux sources sont
     * fusionnees parce qu'une journee donnee n'en utilise qu'une: leur union
     * est exactement l'ensemble des prix pratiques.
     */
    const statsPrixBoeuf = () => {
        const tous = suiviBoeuf.mata.concat(suiviBoeuf.catalogue);
        if (!tous.length) return null;
        const derniers = [suiviBoeuf.dernier.mata, suiviBoeuf.dernier.catalogue]
            .filter(Boolean)
            .sort((a, b) => (a.date < b.date ? 1 : -1));
        return {
            min: Math.min.apply(null, tous),
            max: Math.max.apply(null, tous),
            dernier: derniers[0] || null,
            nb_prix: tous.length
        };
    };

    /** Une phrase par source, ou null si la source n'a rien servi. */
    const resumePrixBoeuf = () => {
        const phrases = [];
        const f = (n) => Math.round(n).toLocaleString('fr-FR');
        const dire = (liste) => {
            const min = Math.min.apply(null, liste);
            const max = Math.max.apply(null, liste);
            return min === max ? `${f(min)} F` : `de ${f(min)} à ${f(max)} F`;
        };
        // JJ-MM-AAAA, la graphie que le reste de l'ecran utilise pour les
        // dates de stock.
        const enJour = (iso) => {
            const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
            return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
        };
        const dernier = (src) => {
            const d = suiviBoeuf.dernier[src];
            return d ? ` Dernier connu : ${f(d.prix)} F au ${enJour(d.date)}.` : '';
        };
        if (suiviBoeuf.mata.length) {
            phrases.push(
                `Prix d'achat du boeuf retenu depuis MATA (prix de revient du lot) : `
                + `${dire(suiviBoeuf.mata)}.${dernier('mata')}`
            );
        }
        if (suiviBoeuf.catalogue.length) {
            phrases.push(
                `Prix d'achat du boeuf retenu depuis le catalogue fournisseur : `
                + `${dire(suiviBoeuf.catalogue)}.${dernier('catalogue')}`
            );
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
                noterPrixBoeuf('mata', p, dateIso);
            } else {
                noterPrixBoeuf('catalogue', prixBoeuf, dateIso);
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
            noterPrixBoeuf('catalogue', prixBoeuf, dateIso);
        }
        const prixAgneau = depuisHistorique('Agneau', dateIso);

        /**
         * Le prix ET sa provenance, resolus d'un seul parcours.
         *
         * Les separer en deux fonctions laisserait l'ecran nommer une source
         * que le calcul n'a pas prise - le desaccord le plus difficile a voir,
         * puisque les deux chiffres restent plausibles.
         *
         * @returns {{prix: number|null, origine: string|null}}
         */
        /**
         * Le prix d'une entree du catalogue, famille bovine COMPRISE.
         *
         * Sert aux deux bouts: au produit demande, et a la CIBLE d'un mapping.
         * Sans cela, « Jarret » mappe vers « Boeuf » lisait le nombre fige du
         * catalogue (4 500) pendant que « Boeuf » lui-meme prenait le prix du
         * lot du jour (4 057): la meme carcasse a deux prix dans le meme PL,
         * et un coefficient applique a la mauvaise base.
         */
        const prixDeBase = (nom) => (
            FAMILLE_BOEUF.test(normaliser(nom)) ? prixBoeuf : depuisHistorique(nom, dateIso)
        );

        const resoudre = (produit) => {
            // 1. LA FAMILLE BOVINE PASSE EN PREMIER, et ce rang n'est pas
            //    negociable.
            //
            //    prixBoeuf est le prix du JOUR: quand la case « Prix API
            //    (DATA) » est cochee sur la ligne Boeuf, il vient du lot MATA
            //    et bouge chaque jour - de 3 735 a 4 435 F sur juillet - la ou
            //    le catalogue porte un nombre fige. Reléguer cette regle apres
            //    le prix propre suffisait a annuler tout le mecanisme: la
            //    ligne « Boeuf » PORTE un prix_achat au catalogue (4 500 F),
            //    donc l'etape « prix propre » l'aurait emporte et le prix de
            //    revient reel n'aurait plus jamais ete lu - dans le PL, dans
            //    Cash et Stock et dans la marge du Centre de Decoupe, qui
            //    passent tous par ce module. resumePrixBoeuf aurait continue
            //    d'AFFICHER le prix MATA sans qu'il serve a rien.
            //
            //    C'est une identite d'espece - « Boeuf en detail » EST du
            //    boeuf, le veau est un boeuf vendu plus cher - la ou les deux
            //    etapes suivantes expriment des choix propres a un point de
            //    vente. Elle ne recouvre RIEN d'autre: Foie, Yell et Jarret ne
            //    commencent ni par « boeuf » ni par « veau », donc leur prix
            //    propre et leur mapping gardent toute leur portee.
            if (FAMILLE_BOEUF.test(normaliser(produit))) {
                return { prix: prixBoeuf, origine: 'famille bovine' };
            }

            // 2. Le prix PROPRE du produit. Foie et Yell sont achetes
            //    separement de la carcasse: leur ligne au catalogue est la
            //    verite, aucun mapping ne doit la couvrir.
            const propre = depuisHistorique(produit, dateIso);
            if (propre != null) return { prix: propre, origine: 'prix propre' };

            // 3. Le MAPPING PRODUITS: le libelle designe une entree du
            //    catalogue, dans une unite qui peut differer de la sienne.
            const a = aliasParNom.get(normaliser(produit));
            if (a) {
                // prixDeBase, pas depuisHistorique: la cible suit les MEMES
                // regles que si on l'avait demandee directement, prix du lot
                // du jour compris.
                const base = prixDeBase(a.cible);
                if (base != null) {
                    // L'origine porte le coefficient quand il n'est pas 1:
                    // « mappé vers Boeuf » et « mappé vers Boeuf × 0,5 » ne
                    // donnent pas le meme cout, et l'ecart se verifie a l'oeil
                    // sur la ligne meme.
                    const coef = a.coefficient === 1
                        ? ''
                        : ` × ${String(a.coefficient).replace('.', ',')}`;
                    return { prix: base * a.coefficient, origine: `mappé vers ${a.cible}${coef}` };
                }
            }

            return { prix: null, origine: null };
        };

        return {
            prixAchat: (produit) => resoudre(produit).prix,
            origine: (produit) => resoudre(produit).origine,
            prixAchatDefaut: { bovin: prixBoeuf, ovin: prixAgneau },
            origineBoeuf
        };
    };

    return { pourDate, avertissements, resumePrixBoeuf, statsPrixBoeuf };
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
