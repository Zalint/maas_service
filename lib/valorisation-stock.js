/**
 * Valorisation d'un stock en FCFA, au prix d'ACHAT quand il est connu.
 *
 * La colonne stocks.total est ecrite A LA SAISIE, quantite x prix_unitaire, ou
 * prix_unitaire est un prix de VENTE - pour le Boeuf, la moyenne ponderee des
 * ventes du jour. Les ecrans PL et Cash et Stock se contentaient d'en faire la
 * somme. Ils valorisaient donc le stock a ce qu'il rapportera, et non a ce
 * qu'il a coute.
 *
 * Regle retenue, telle que demandee:
 *   1. Prix achat fournisseur (colonne "Prix achat fournisseur (FCFA)" de
 *      l'onglet Prix fournisseur), resolu A LA DATE du snapshot.
 *   2. A defaut, on garde la valeur deja stockee - donc le prix de vente - et
 *      le produit est NOMME pour que l'ecran l'affiche avec un asterisque.
 *
 * Le second cas n'est pas un detail: sur les donnees de juillet-aout 2026, le
 * Poulet pese 8 036 000 F a lui seul et n'a aucun prix d'achat renseigne. Le
 * valoriser a zero aurait fait chuter le stock de 35% sans le moindre message.
 *
 * Module sans dependance: les lignes et le resolveur de prix sont fournis par
 * l'appelant, ce qui rend la regle testable sans base ni serveur.
 */

// En dessous, il n'y a pas de quantite exploitable: les stocks se saisissent au
// dixieme d'unite, et une valeur plus petite ne peut etre qu'un residu.
const SEUIL_QUANTITE = 0.0001;

/**
 * @param {Object}   args
 * @param {Array}    args.lignes        [{ produit, quantite, total, prix_unitaire }]
 * @param {Function} args.prixAchat     (produit) => number|null, prix d'achat unitaire
 * @param {Function} [args.estBoucherie] (produit) => bool. Sert a n'appliquer le
 *   coefficient de pertes de decoupe qu'a la viande: on ne pare pas un sachet.
 * @param {Function} [args.categorieDe] (produit) => 'bovin'|'ovin'|null. Ventile
 *   la part boucherie par espece. Le bovin et l'ovin ne se parent pas au meme
 *   taux - lib/parage.js calcule d'ailleurs DEJA deux ratios separes - mais le
 *   PL ne connait qu'un coefficient unique. Rendre la ventilation ici est ce
 *   qui permettra de lui en donner deux sans deviner leur poids respectif.
 *   Mesure juillet 2026: bovin +13 480 F, ovin -6 200 F. Un taux unique
 *   masque que la variation ovin est NEGATIVE, donc qu'augmenter le parage
 *   agneau ameliore le resultat.
 * @returns {{
 *   valeur: number,
 *   valeur_boucherie: number,
 *   valeur_hors_boucherie: number,
 *   valeur_bovin: number,
 *   valeur_ovin: number,
 *   valeur_autre_boucherie: number,
 *   valeur_au_prix_achat: number,
 *   valeur_au_prix_vente: number,
 *   produits_au_prix_de_vente: string[],
 *   lignes_incoherentes: Array<{produit: string, total: number}>,
 *   lignes_negatives: Array<{produit: string, quantite: number, total: number}>,
 *   valeur_negative_ignoree: number,
 *   detail_lignes: Array<{produit: string, base: 'achat'|'vente',
 *     quantite: number, prix_utilise: number|null, valeur: number}>
 * }}
 */
function valoriserLignes(args) {
    const { lignes = [], prixAchat, estBoucherie, categorieDe } = args || {};

    let valeurAchat = 0;
    let valeurVente = 0;
    let valeurBoucherie = 0;
    let valeurHorsBoucherie = 0;
    // Ventilation de la part boucherie par espece. 'autre' recueille ce qui
    // est de la boucherie sans etre ni bovin ni ovin (volaille, caprin) ou
    // dont la categorie est inconnue: le ranger d'office dans une espece
    // fausserait le taux qu'on lui appliquera.
    let valeurBovin = 0;
    let valeurOvin = 0;
    let valeurAutreBoucherie = 0;
    let valeurNegativeIgnoree = 0;
    const auPrixDeVente = [];
    const incoherentes = [];
    const negatives = [];
    // Detail par produit de ce qui COMPTE dans la valeur, agrege par
    // (produit, base). Un produit peut apparaitre sur les deux bases si
    // certaines de ses lignes ont un prix d'achat et d'autres non - le
    // detail doit le montrer plutot que de moyenner en silence. Les lignes
    // negatives, ECARTEES de la valeur, restent hors du detail: elles sont
    // deja nommees dans lignes_negatives.
    const parProduitBase = new Map();
    const detailler = (produit, base, quantite, valeur) => {
        const cle = `${produit}||${base}`;
        const d = parProduitBase.get(cle) || { produit, base, quantite: 0, valeur: 0 };
        d.quantite += quantite;
        d.valeur += valeur;
        parProduitBase.set(cle, d);
    };

    // Chaque ligne valorisee est ventilee boucherie / hors boucherie, parce que
    // seule la premiere subit le coefficient de pertes de decoupe en aval.
    const compter = (produit, montant) => {
        if (!estBoucherie || estBoucherie(produit)) {
            valeurBoucherie += montant;
            const cat = categorieDe ? categorieDe(produit) : null;
            if (cat === 'bovin') valeurBovin += montant;
            else if (cat === 'ovin') valeurOvin += montant;
            else valeurAutreBoucherie += montant;
        } else {
            valeurHorsBoucherie += montant;
        }
    };

    for (const l of lignes) {
        const produit = String((l && l.produit) || '').trim();
        const quantite = parseFloat(l && l.quantite) || 0;
        const totalStocke = parseFloat(l && l.total) || 0;

        // Un stock NEGATIF ne vaut pas moins que rien: il n'existe pas.
        //
        // Il apparait sur les produits dont le stock du soir est calcule
        // (matin + transferts - ventes) quand les entrees ne sont pas saisies:
        // le calcul rend alors -ventes. Le sommer retrancherait de la valeur du
        // point de vente une marchandise absente, et le montant derive n'a
        // aucune ancre physique pour se corriger. On l'ecarte, et on le compte
        // a part pour que l'ecran puisse le dire.
        if (quantite < 0 || totalStocke < 0) {
            negatives.push({ produit, quantite, total: totalStocke });
            valeurNegativeIgnoree += totalStocke;
            continue;
        }

        // Une quantite nulle ne peut pas etre revalorisee: quantite x prix
        // vaudrait zero et effacerait silencieusement la valeur deja stockee.
        // On garde donc cette derniere, et on le signale si elle n'est pas
        // nulle elle non plus - c'est alors une incoherence de saisie.
        if (quantite <= SEUIL_QUANTITE) {
            valeurVente += totalStocke;
            compter(produit, totalStocke);
            if (Math.abs(totalStocke) > 0) {
                incoherentes.push({ produit, total: totalStocke });
                if (!auPrixDeVente.includes(produit)) auPrixDeVente.push(produit);
                detailler(produit, 'vente', quantite, totalStocke);
            }
            continue;
        }

        const pa = prixAchat ? parseFloat(prixAchat(produit)) : NaN;
        if (Number.isFinite(pa) && pa > 0) {
            valeurAchat += quantite * pa;
            compter(produit, quantite * pa);
            detailler(produit, 'achat', quantite, quantite * pa);
            continue;
        }

        // Pas de prix d'achat connu: on conserve la valeur telle qu'elle a ete
        // saisie plutot que de compter zero, et on nomme le produit.
        valeurVente += totalStocke;
        compter(produit, totalStocke);
        if (!auPrixDeVente.includes(produit)) auPrixDeVente.push(produit);
        detailler(produit, 'vente', quantite, totalStocke);
    }

    // Prix unitaire au sens du detail: la valeur rapportee a la quantite.
    // Pour la base achat c'est exactement le prix d'achat resolu; pour la
    // base vente c'est le prix moyen porte par les lignes conservees. Sans
    // quantite (valeur conservee sur quantite nulle), il n'y a pas de prix.
    const detailLignes = Array.from(parProduitBase.values())
        .map((d) => ({
            produit: d.produit,
            base: d.base,
            quantite: d.quantite,
            prix_utilise: d.quantite > SEUIL_QUANTITE ? d.valeur / d.quantite : null,
            valeur: d.valeur,
            // La ligne subit-elle le coefficient de pertes de decoupe en aval ?
            // Sans ce drapeau, un ecran qui detaille le stock ne peut pas
            // expliquer pourquoi la somme des lignes ne fait pas le net: le
            // coefficient ne porte que sur la viande.
            boucherie: !estBoucherie || !!estBoucherie(d.produit)
        }))
        .sort((a, b) => Math.abs(b.valeur) - Math.abs(a.valeur));

    return {
        valeur: valeurAchat + valeurVente,
        // Ventilation qui porte le coefficient de pertes de decoupe en aval.
        valeur_boucherie: valeurBoucherie,
        valeur_hors_boucherie: valeurHorsBoucherie,
        // valeur_bovin + valeur_ovin + valeur_autre_boucherie == valeur_boucherie,
        // par construction. L'invariant est teste.
        valeur_bovin: valeurBovin,
        valeur_ovin: valeurOvin,
        valeur_autre_boucherie: valeurAutreBoucherie,
        valeur_negative_ignoree: valeurNegativeIgnoree,
        lignes_negatives: negatives,
        valeur_au_prix_achat: valeurAchat,
        valeur_au_prix_vente: valeurVente,
        produits_au_prix_de_vente: auPrixDeVente.sort(),
        lignes_incoherentes: incoherentes,
        detail_lignes: detailLignes
    };
}

module.exports = { valoriserLignes, SEUIL_QUANTITE };
