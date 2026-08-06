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
 * @param {Array}    args.lignes      [{ produit, quantite, total, prix_unitaire }]
 * @param {Function} args.prixAchat   (produit) => number|null, prix d'achat unitaire
 * @returns {{
 *   valeur: number,
 *   valeur_au_prix_achat: number,
 *   valeur_au_prix_vente: number,
 *   produits_au_prix_de_vente: string[],
 *   lignes_incoherentes: Array<{produit: string, total: number}>
 * }}
 */
function valoriserLignes(args) {
    const { lignes = [], prixAchat } = args || {};

    let valeurAchat = 0;
    let valeurVente = 0;
    const auPrixDeVente = [];
    const incoherentes = [];

    for (const l of lignes) {
        const produit = String((l && l.produit) || '').trim();
        const quantite = parseFloat(l && l.quantite) || 0;
        const totalStocke = parseFloat(l && l.total) || 0;

        // Une quantite nulle ne peut pas etre revalorisee: quantite x prix
        // vaudrait zero et effacerait silencieusement la valeur deja stockee.
        // On garde donc cette derniere, et on le signale si elle n'est pas
        // nulle elle non plus - c'est alors une incoherence de saisie.
        if (quantite <= SEUIL_QUANTITE) {
            valeurVente += totalStocke;
            if (Math.abs(totalStocke) > 0) {
                incoherentes.push({ produit, total: totalStocke });
                if (!auPrixDeVente.includes(produit)) auPrixDeVente.push(produit);
            }
            continue;
        }

        const pa = prixAchat ? parseFloat(prixAchat(produit)) : NaN;
        if (Number.isFinite(pa) && pa > 0) {
            valeurAchat += quantite * pa;
            continue;
        }

        // Pas de prix d'achat connu: on conserve la valeur telle qu'elle a ete
        // saisie plutot que de compter zero, et on nomme le produit.
        valeurVente += totalStocke;
        if (!auPrixDeVente.includes(produit)) auPrixDeVente.push(produit);
    }

    return {
        valeur: valeurAchat + valeurVente,
        valeur_au_prix_achat: valeurAchat,
        valeur_au_prix_vente: valeurVente,
        produits_au_prix_de_vente: auPrixDeVente.sort(),
        lignes_incoherentes: incoherentes
    };
}

module.exports = { valoriserLignes, SEUIL_QUANTITE };
