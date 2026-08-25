/**
 * Retrouver une entree de stock, quelle que soit la FORME de sa cle.
 *
 * Le fichier data/by-date/<date>/stock-<type>.json a DEUX producteurs, et ils
 * n'ecrivent pas la meme cle:
 *
 *   la saisie, et le repli base du serveur   ->  « Mbao-Boeuf »
 *   le repli base du cron de copie           ->  « Mbao-Boeuf-stock-matin-4 »
 *                                                (espaces remplaces par « _ »)
 *
 * L'ecran de stock ne connaissait que la premiere forme et cherchait la cle a
 * l'exact. Le 15/08/2026, le stock matin recopie du 14 au soir - 108,3 kg de
 * boeuf - arrivait bien au navigateur, visible dans la reponse reseau, et
 * n'etait affiche nulle part: la grille tombait dans sa branche « pas de
 * donnees », mettait la quantite a zero et prenait le prix du catalogue. La
 * Reconciliation, elle, ITERE sur les entrees au lieu de chercher par cle:
 * elle affichait 835 560 F pendant que la grille affichait des zeros.
 *
 * LA CLE N'EST PAS LA SOURCE DE VERITE. Chaque entree porte deja « Point de
 * Vente » et « Produit ». On indexe donc sur son CONTENU: n'importe quel
 * format de cle, present ou futur, se lit alors sans avoir a le decoder.
 *
 * Servi au navigateur par index.html, comme lib/dates-fr.js et lib/parage.js.
 */
(function (racine, fabrique) {
    if (typeof module === 'object' && module.exports) module.exports = fabrique();
    else racine.stockIndex = fabrique();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * La cle de rapprochement d'un couple (point de vente, produit).
     *
     * Espaces ET underscores sont ramenes a un seul espace: le cron ecrit
     * « Cuisse_de_poulet » la ou la saisie ecrit « Cuisse de poulet ». La
     * casse est ignoree pour la meme raison que partout ailleurs dans ce
     * depot - les ventes portent « Boeuf en détail » et « Boeuf En Détail ».
     *
     * Les accents sont CONSERVES: « Boeuf en détail » et « Boeuf en detail »
     * sont deux produits distincts au catalogue de ce tenant, et les confondre
     * ferait afficher le stock de l'un sur la ligne de l'autre.
     */
    function cleContenu(pointVente, produit) {
        var pv = String(pointVente == null ? '' : pointVente)
            .trim().toLowerCase().replace(/[\s_]+/g, ' ');
        var pr = String(produit == null ? '' : produit)
            .trim().toLowerCase().replace(/[\s_]+/g, ' ');
        return pv + '|' + pr;
    }

    /**
     * Un index { cleContenu -> entree } a partir du dictionnaire recu.
     *
     * Les entrees sans point de vente ou sans produit sont ignorees: elles ne
     * peuvent se rattacher a aucune ligne de la grille, et les garder ferait
     * grossir l'index de bruit.
     *
     * En cas de doublon, la PREMIERE occurrence gagne. Deux entrees pour le
     * meme couple sont une anomalie de donnees; en remplacer une par l'autre
     * en silence ferait dependre l'affichage de l'ordre des cles.
     */
    function construire(donnees) {
        var index = new Map();
        if (!donnees || typeof donnees !== 'object') return index;
        var cles = Object.keys(donnees);
        for (var i = 0; i < cles.length; i++) {
            var e = donnees[cles[i]];
            if (!e || typeof e !== 'object') continue;
            var pv = e['Point de Vente'] || e.pointVente;
            var pr = e.Produit || e.produit;
            if (!pv || !pr) continue;
            var c = cleContenu(pv, pr);
            if (!index.has(c)) index.set(c, e);
        }
        return index;
    }

    /**
     * L'entree d'un couple, cle exacte d'abord puis index par contenu.
     *
     * L'exact passe en premier parce que c'est le cas courant et qu'il ne
     * coute rien; l'index ne sert que de rattrapage.
     */
    function trouver(donnees, index, pointVente, produit) {
        if (donnees) {
            var exact = donnees[pointVente + '-' + produit];
            if (exact) return exact;
        }
        return (index && index.get(cleContenu(pointVente, produit))) || null;
    }

    return { cleContenu: cleContenu, construire: construire, trouver: trouver };
}));
