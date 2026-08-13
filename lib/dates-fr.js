/**
 * Les trois lectures d'une date que font les ecrans, ecrites UNE fois.
 *
 * Ce depot porte deja plusieurs conventions de date - texte mixte ISO et
 * JJ-MM-AAAA selon les tables - et son historique compte au moins deux bugs
 * nes de formateurs divergents: parseDate rendait une date fausse sur l'ISO,
 * formatDate rendait le 1er janvier 1970. Chaque conversion recopiee dans un
 * fichier est un endroit ou la prochaine divergence pourra naitre.
 *
 * Servi au navigateur par index.html, comme lib/parage.js l'est deja pour la
 * formule du parage: meme motif, meme raison.
 *
 * AUCUN new Date() ici. Ces champs designent des JOURS, pas des instants, et
 * passer par Date les expose au fuseau: minuit local dans une zone en avance
 * sur UTC rend la VEILLE une fois converti en ISO. On lit les chiffres la ou
 * ils sont ecrits.
 */
(function (racine, fabrique) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrique();
    else racine.datesFr = fabrique();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var ISO = /^(\d{4})-(\d{2})-(\d{2})/;

    /**
     * Le JOUR d'une valeur ISO: '2026-08-12' ou '2026-08-12T09:30:00Z' -> '2026-08-12'.
     * Rend '' pour tout le reste - un tiret a l'ecran se voit, un jour faux non.
     */
    function jourISO(v) {
        if (typeof v !== 'string') return '';
        var m = v.match(ISO);
        return m ? m[0] : '';
    }

    /**
     * '2026-08-12' -> '12/08/2026'.
     *
     * Rend l'entree INCHANGEE quand elle n'est pas lisible: c'est le
     * comportement des formateurs qu'elle remplace, et il vaut mieux afficher
     * une valeur brute que rien du tout dans une cellule de tableau.
     */
    function enFrancais(v) {
        if (typeof v !== 'string') return v;
        var m = v.match(ISO);
        return m ? m[3] + '/' + m[2] + '/' + m[1] : v;
    }

    /**
     * Jours calendaires de `a` a `b`, ou null si l'une des deux est illisible.
     * Positif quand `b` est apres `a`.
     */
    function ecartEnJours(a, b) {
        var ja = jourISO(a), jb = jourISO(b);
        if (!ja || !jb) return null;
        var ta = Date.parse(ja + 'T00:00:00Z');
        var tb = Date.parse(jb + 'T00:00:00Z');
        if (!isFinite(ta) || !isFinite(tb)) return null;
        return Math.round((tb - ta) / 86400000);
    }

    return { jourISO: jourISO, enFrancais: enFrancais, ecartEnJours: ecartEnJours };
}));
