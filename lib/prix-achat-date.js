/**
 * Prix d'achat effectifs A UNE DATE, pour le calcul de marge.
 *
 * Trois sources, dans cet ordre, et chacune tracee dans les avertissements:
 *
 *  1. /api/external/achats-boeuf de DATA, quand la case "Prix API (DATA)" est
 *     cochee sur la ligne Boeuf. Le MEME resolveur que la marge du Centre de
 *     Decoupe: en recalculer un ici produirait deux prix d'achat differents
 *     pour la meme journee.
 *
 *     DATA expose DEUX prix par date et c'est TOUJOURS le prix FACTURE qui est
 *     lu (parDateBoeufMaas): le revient du lot majore de la commission, soit
 *     ce que MaaS paie reellement. L'autre, le revient nu, ne vaut que comme
 *     cout hors commission et n'est pas la base de la dette fournisseur.
 *     La commission etant deja dans ce prix, elle n'est plus refacturee sur
 *     les livraisons de bœuf des journees ainsi valorisees
 *     (cf lib/commission-integree.js).
 *     Quand la source ne rend rien, le client le DIT - ses avertissements sont
 *     remontes ici - et la journee retombe sur le catalogue, qui lui ne porte
 *     aucune commission: elle y reste donc due.
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

// La ligne du catalogue qui PORTE la carcasse, et donc le prix du lot du jour
// quand la case « Prix API (DATA) » y est cochee. Un nom exact, pas un motif.
const CLE_CARCASSE = 'boeuf';

// CE QUE LE PRIX VENU DE DATA CONTIENT, en clair, pour chacune des deux
// sources de lib/achats-boeuf-client. La meme phrase nomme la source sur la
// ligne (origineBoeuf) et dans le resume affiche a l'ecran: deux formulations
// pour un seul chiffre laisseraient croire a deux prix. Les cles sont les
// valeurs de source acceptees par getBoeufPrixAchatResolver().
const LIBELLE_SOURCE_BOEUF = {
    maas: 'prix MaaS, commission comprise',
    revient: 'prix de revient du lot'
};

/**
 * Conservee pour les appelants existants, et DEPRECIEE.
 *
 * Elle decidait quels libelles partagent le cout de la carcasse. Plus aucune
 * resolution de prix ne l'utilise: le Mapping produits le dit desormais ligne
 * par ligne. Voir resoudre() pour ce qu'elle cassait.
 * @deprecated
 */
const FAMILLE_BOEUF = /^(boeuf|veau)/i;

// Importee, pas recopiee: voir lib/parage-contexte.js.
const { normaliserNom: normaliser } = require('./parage');
// La regle « ce prix MATA s'applique-t-il a cette journee ? », partagee avec
// le calcul de commission: cf lib/commission-integree.js.
const { prixMataApplicable } = require('./commission-integree');

/**
 * Une date de transfert -> ISO, ou null.
 *
 * Les transferts sont stockes en JJ-MM-AAAA (parfois JJ/MM/AAAA), les ventes en
 * ISO. Comparer sans convertir donnerait un ordre alphabetique, ou « 02-09 »
 * precederait « 14-08 ».
 */
function versIso(brut) {
    const t = String(brut || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

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

    /**
     * Un avertissement, et une seule fois.
     *
     * pourDate() est appele une fois par journee de la periode, et les
     * avertissements du client boeuf peuvent arriver par deux chemins (le
     * chargement, puis un repli constate jour apres jour). Sans ce filtre,
     * l'ecran affiche trente et une fois la meme phrase - ce qui la rend
     * illisible et fait passer les autres a la trappe.
     */
    const avertir = (message) => {
        if (message && avertissements.indexOf(message) < 0) avertissements.push(message);
    };

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
        // Un mapping illisible coute les couts MAPPES, et il faut le dire.
        // Il n'y a plus de regle de nommage pour rattraper: ce qui tenait son
        // cout d'une ligne de mapping n'en a plus. Ce qui porte son propre
        // prix - la carcasse, Foie, Yell - continue de valoriser le PL.
        avertir(
            `Mapping produits illisible (${e.message}) : les produits qui tenaient `
            + `leur coût d'un mapping n'en ont plus. Seuls les prix propres s'appliquent.`
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
        avertir(
            `Historique des prix d'achat illisible (${e.message}): prix courants du catalogue utilises.`
        );
    }

    const catalogue = {};
    let boeufDynamique = false;
    for (const r of rows) {
        const cle = normaliser(r.produit);
        const v = parseFloat(r.prix_achat);
        if (Number.isFinite(v) && v > 0) catalogue[cle] = v;
        if (cle === CLE_CARCASSE && r.prix_achat_dynamique === true) boeufDynamique = true;
    }

    // LES DATES OU DU BOEUF EST REELLEMENT ARRIVE.
    //
    // Le prix du lot est demande a MATA pour une DATE. Utiliser la date
    // courante revient a valoriser le stock au cours du jour, alors que la
    // viande en rayon a ete payee a la reception. Sur aout 2026 l'ecart est
    // massif: le boeuf passe de 3 835 a 4 500 F/kg, et 29 % de la variation
    // de stock devient une pure reevaluation - du benefice affiche sans
    // qu'un kilo ait ete vendu.
    //
    // On retient donc la date du DERNIER TRANSFERT ENTRANT de boeuf <= a la
    // journee demandee, et c'est cette date qu'on presente a l'API.
    let receptionsBoeuf = [];
    if (boeufDynamique) {
        try {
            const { Transfert } = require('../db/models');
            const lignes = await Transfert.findAll({ raw: true });
            const vues = new Set();
            for (const t of lignes) {
                if (String(t.impact) === '-1') continue;          // sortie, pas une reception
                if (!FAMILLE_BOEUF.test(normaliser(t.produit))) continue;
                if (!(Math.abs(parseFloat(t.quantite) || 0) > 0)) continue;
                const iso = versIso(t.date);
                if (iso && !vues.has(iso)) { vues.add(iso); receptionsBoeuf.push(iso); }
            }
            receptionsBoeuf.sort();
        } catch (e) {
            avertir(
                `Transferts illisibles (${e.message}) : le prix du boeuf suit la date `
                + 'demandee au lieu de la derniere reception.'
            );
            receptionsBoeuf = [];
        }
    }
    /** La derniere reception de boeuf <= dateIso, ou null si aucune. */
    const receptionAvant = (dateIso) => {
        let trouvee = null;
        for (const d of receptionsBoeuf) {
            if (d <= dateIso) trouvee = d; else break;
        }
        return trouvee;
    };

    // CE QUE MATA FACTURE, par produit. Charge UNE fois pour la borne haute de
    // la periode: le catalogue MaaS est un instantane date, et l'interroger
    // journee par journee couterait un appel HTTP par jour traverse (trente et
    // un sur un mois) la ou un seul suffit dans l'immense majorite des cas.
    // `depuis` permet a pourDate() de refuser ce tarif aux journees qu'il ne
    // couvre pas, plutot que de revaloriser le passe en silence.
    //
    // Ce prix REMPLACE la valeur enregistree au catalogue pour les produits du
    // circuit MATA: c'est lui que MaaS paie, commission comprise, et c'est donc
    // lui qui doit valoriser le stock et les marges. Sans quoi la commission
    // que MATA a integree a son prix ne serait comptee nulle part - ni dans le
    // cout, ni en dette fournisseur, puisqu'on cesse justement de la facturer.
    let prixMata = { parNom: new Map(), depuisParNom: new Map() };
    try {
        const { getPrixVenteMaasParNom } = require('./prix-vente-maas-client');
        const pvm = await getPrixVenteMaasParNom(dateMaxIso);
        if (pvm.disponible) {
            prixMata = {
                parNom: pvm.parNom || new Map(),
                depuisParNom: pvm.depuisParNom || new Map()
            };
        } else {
            avertir(
                'Prix d’achat MATA : le catalogue MAAS (DATA) n’a pas répondu — les prix '
                + 'enregistrés au catalogue Prix fournisseur ont été utilisés, et ils ne '
                + 'contiennent pas la commission.'
            );
        }
    } catch (e) {
        avertir(
            `Prix d’achat MATA : catalogue MAAS (DATA) injoignable (${e.message}) — les prix `
            + 'enregistrés au catalogue Prix fournisseur ont été utilisés.'
        );
    }

    // Resolveur DATA, charge une seule fois lui aussi: ses lignes sont en
    // memoire et atDate() n'est qu'une recherche.
    let marcheBoeuf = null;
    // Ce que le prix retenu contient, une fois la source connue: sert a
    // l'origine de la ligne et au resume. Null tant que DATA n'a rien donne.
    let libelleSourceBoeuf = null;
    if (boeufDynamique) {
        // QUELLE SOURCE LIRE CHEZ DATA. Le prix qui compte pour valoriser une
        // carcasse est celui que le fournisseur FACTURE, commission comprise
        // (parDateBoeufMaas). Ce n'est pas un choix laisse a la configuration:
        // c'est la meme valeur qui sert de base a la dette fournisseur, et les
        // deux ne peuvent pas diverger sans produire un cout faux d'un cote ou
        // une commission comptee deux fois de l'autre.
        const { SOURCE_BOEUF: source } = require('./commission-integree');

        try {
            const { getBoeufPrixAchatResolver } = require('./achats-boeuf-client');
            const r = await getBoeufPrixAchatResolver({ source });
            if (r && typeof r.atDate === 'function') {
                marcheBoeuf = r;
                libelleSourceBoeuf = LIBELLE_SOURCE_BOEUF[source] || null;
            }
            // LES AVERTISSEMENTS DU CLIENT REMONTENT ICI. C'est le canal deja
            // branche a l'ecran (routes/finance.js concatene
            // resolveurPrix.avertissements): DATA non configure, injoignable,
            // ou muet sur la source demandee, tout cela fait retomber le PL sur
            // le prix du catalogue - et le taire donnerait un cout faux presente
            // comme un prix MATA.
            for (const a of (r && r.avertissements) || []) avertir(a);
        } catch (e) {
            avertir(
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

    // Une cible sans prix n'est signalee qu'UNE fois PAR PRODUIT, et sur le nom
    // NORMALISE: le message cite le libelle tel qu'il a ete demande, donc
    // « Filet De Boeuf » et « FILET DE BOEUF » formeraient deux phrases
    // distinctes qu'avertir() ne saurait pas rapprocher.
    const cibleSansPrix = new Set();

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
                `Prix d'achat du boeuf retenu depuis MATA `
                + `(${libelleSourceBoeuf || 'prix du lot'}) : `
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
            // La date de la derniere RECEPTION, pas la journee demandee: le
            // stock vaut ce qu'il a coute, pas ce que couterait une carcasse
            // achetee aujourd'hui. Sans reception connue on retombe sur la
            // journee elle-meme - c'etait le comportement d'avant.
            const dateLot = receptionAvant(dateIso) || dateIso;
            const p = parseFloat(marcheBoeuf.atDate(dateLot));
            if (Number.isFinite(p) && p > 0) {
                prixBoeuf = p;
                // La source est NOMMEE, parce que les deux ne valent pas la
                // meme chose: le prix MaaS porte deja la commission, le prix de
                // revient non. Lire « DATA » sans savoir lequel des deux ne dit
                // pas si le cout affiche est complet.
                origineBoeuf = `achats-boeuf (DATA), ${libelleSourceBoeuf || 'prix du lot'}`;
                noterPrixBoeuf('mata', p, dateIso);
            } else {
                noterPrixBoeuf('catalogue', prixBoeuf, dateIso);
                // Un seul avertissement, pas un par journee du mois: avertir()
                // s'en charge, la phrase est constante.
                avertir(
                    "Prix d'achat du boeuf: MATA n'a renvoye aucun lot pour au moins "
                    + 'une journee, le prix du catalogue y a ete utilise.'
                );
            }
        } else {
            // Prix non dynamique: le catalogue est la source normale, pas un
            // repli. On le suit quand meme, pour pouvoir l'afficher.
            noterPrixBoeuf('catalogue', prixBoeuf, dateIso);
        }
        // Le prix FACTURE par MATA pour cette journee, ou null. La regle vit
        // dans lib/commission-integree.js et sert AUSSI a decider si la
        // commission reste due (routes/finance-creances.js): un cout et une
        // commission qui ne repondraient pas a la meme question feraient
        // disparaitre la difference des deux cotes a la fois.
        const prixMataDe = (nom) => prixMataApplicable(nom, dateIso, prixMata, avertir);

        // MEME ORDRE DE SOURCES que prixDeBase ci-dessous, et pas seulement
        // l'historique: ce prix alimente prixAchatDefaut.ovin, le cout de
        // reference de l'agneau. Le laisser sur l'historique seul donnait a la
        // meme journee deux couts pour le meme produit - celui de prixDeBase,
        // commission comprise, et celui-ci sans elle.
        const prixAgneau = prixMataDe('Agneau') ?? depuisHistorique('Agneau', dateIso);

        /**
         * Le prix d'une entree du CATALOGUE, prix du lot du jour compris.
         *
         * Sert aux deux bouts: au produit demande, et a la CIBLE d'un mapping.
         * Sans cela, « Jarret » mappe vers « Boeuf » lisait le nombre fige du
         * catalogue (4 500) pendant que « Boeuf » prenait le lot du jour
         * (4 057): la meme carcasse a deux prix dans le meme PL, et un
         * coefficient applique a la mauvaise base.
         *
         * C'est ICI que vit le prix dynamique, et non dans une regle de
         * famille. La case « Prix API (DATA) » est une propriete de la LIGNE
         * « Boeuf »: la rattacher a la ligne, plutot qu'a un motif sur les
         * libelles, est ce qui permet de supprimer la famille sans perdre le
         * prix de revient reel.
         */
        const prixDeBase = (nom) => {
            // Le bœuf garde SA source: achats-boeuf rend un prix PAR DATE
            // d'achat, la ou le catalogue n'en donne qu'un par instantane. Le
            // meme chiffre, mais resolu plus finement sur un mois entier.
            if (normaliser(nom) === CLE_CARCASSE) return prixBoeuf;
            // Ce que MATA facture, quand elle le facture: c'est le cout reel
            // de l'achat, commission comprise. La valeur enregistree au
            // catalogue n'est plus qu'un repli - pour les produits hors
            // circuit MATA, et pour les journees anterieures au tarif connu.
            return prixMataDe(nom) ?? depuisHistorique(nom, dateIso);
        };

        /**
         * Le prix ET sa provenance, resolus d'un seul parcours.
         *
         * Les separer en deux fonctions laisserait l'ecran nommer une source
         * que le calcul n'a pas prise - le desaccord le plus difficile a voir,
         * puisque les deux chiffres restent plausibles.
         *
         * PLUS AUCUNE REGLE DE NOMMAGE. Une regex /^(boeuf|veau)/ decidait
         * naguere quels libelles partagent le cout de la carcasse. Elle
         * tranchait au mauvais endroit, dans les deux sens: elle attrapait
         * « Boeuf sur pied » - une bete VIVANTE, comptee a la tete - pour lui
         * imposer le prix d'un kilo de viande, et elle laissait filer « Filet
         * De Boeuf » ou « Tete de Boeuf », qui viennent pourtant du meme
         * animal, au seul motif que le nom y figure en dernier. Deux produits
         * de la meme carcasse recevaient un traitement oppose selon l'ordre
         * des mots.
         *
         * Toute relation est desormais une LIGNE que quelqu'un a ecrite et
         * peut relire: le Mapping produits, ou le prix du produit lui-meme.
         *
         * @returns {{prix: number|null, origine: string|null}}
         */
        const resoudre = (produit) => {
            const cle = normaliser(produit);

            // 1. LE MAPPING PRODUITS, l'enonce le plus explicite du systeme.
            //
            //    Il passe avant le prix propre parce qu'une ligne de mapping
            //    est un acte: quelqu'un a ouvert l'ecran et declare que ce
            //    libelle se paie comme cette entree-la. « Veau » porte son
            //    propre prix au catalogue (4 035) mais coute ce que coute la
            //    carcasse - c'est ce que dit sa ligne « Veau -> Boeuf x 1 »,
            //    et c'est elle qui doit gagner.
            //
            //    Foie et Yell restent proteges: ils ne sont mappes nulle part,
            //    donc rien ne recouvre leur ligne.
            const a = aliasParNom.get(cle);
            if (a) {
                // prixDeBase, pas depuisHistorique: la cible suit les MEMES
                // regles que si on l'avait demandee directement.
                const base = prixDeBase(a.cible);
                if (base != null) {
                    // L'origine porte le coefficient quand il n'est pas 1:
                    // « mappé vers Boeuf » et « mappé vers Boeuf × 0,5 » ne
                    // donnent pas le meme cout, et l'ecart se verifie a
                    // l'oeil sur la ligne meme.
                    const coef = a.coefficient === 1
                        ? ''
                        : ` × ${String(a.coefficient).replace('.', ',')}`;
                    return {
                        prix: base * a.coefficient,
                        origine: `mappé vers ${a.cible}${coef}`,
                        cible: a.cible,
                        coefficient: a.coefficient
                    };
                }
                // La cible n'a PAS de prix. On tombe sur le prix propre, mais
                // on le DIT: sinon le mapping que l'admin vient d'ecrire reste
                // sans effet, etiquete « prix propre », indiscernable d'un
                // produit qui n'a jamais ete mappe. Le menu deroulant propose
                // des cibles hors catalogue, auto-creees avec prix_achat null:
                // ce cas arrive par le flux normal de l'ecran.
                if (!cibleSansPrix.has(cle)) {
                    cibleSansPrix.add(cle);
                    avertir(
                        `Mapping sans effet : « ${produit} » pointe vers « ${a.cible} », `
                        + `qui ne porte aucun prix d'achat. Renseignez le prix de `
                        + `« ${a.cible} » dans Prix fournisseur.`
                    );
                }
            }

            // 2. Le prix PROPRE du produit, lot du jour compris pour la
            //    carcasse elle-meme.
            const propre = prixDeBase(produit);
            if (propre != null) {
                // Sa propre ligne est sa cible: un produit non mappe se coute
                // lui-meme, dans son unite.
                return { prix: propre, origine: 'prix propre', cible: produit, coefficient: 1 };
            }

            // 3. Rien ne le declare. Le cout est INCONNU et sera nomme, pas
            //    devine: c'est tout ce que la regex faisait de mal.
            return { prix: null, origine: null, cible: null, coefficient: 1 };
        };

        return {
            prixAchat: (produit) => resoudre(produit).prix,
            origine: (produit) => resoudre(produit).origine,
            /**
             * L'entree de CATALOGUE qui porte le cout, et le coefficient qui
             * y mene. Deux decoupes d'une meme carcasse rendent la MEME cible:
             * c'est ce qui permet de leur donner le meme cout pondere au lieu
             * de laisser chacune moyenner sur son propre calendrier de vente.
             * @returns {{cible: string|null, coefficient: number}}
             */
            cibleDuCout: (produit) => {
                const r = resoudre(produit);
                return { cible: r.cible, coefficient: r.coefficient };
            },
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
