'use strict';

/**
 * Conversion des dates de saisie. Module SANS DEPENDANCE, donc testable.
 *
 * Ces deux fonctions vivaient dans db/utils.js, qui charge Sequelize au
 * premier require: elles etaient de fait intestables, et c'est ainsi qu'un
 * parseDate silencieusement faux a pu vivre longtemps (cf ci-dessous).
 * db/utils.js les reexporte, les appelants existants ne changent pas.
 */

/**
 * Date -> 'JJ-MM-AAAA', le format de la colonne stocks.date.
 *
 * Rend null pour une date absente ou invalide, JAMAIS une date de repli.
 * formatDate(null) valait '01-01-1970' - new Date(null) est l'epoch - et
 * comme parseDate rend null sur une entree illisible, le couple
 * formatDate(parseDate(x)) rangeait silencieusement la donnee au 1er janvier
 * 1970. Il est utilise a neuf endroits, dont trois qui font un destroy suivi
 * d'un bulkCreate. Avec null, un `where: { date: null }` ne matche rien - donc
 * ne supprime rien - et une ecriture echoue franchement sur la contrainte
 * NOT NULL au lieu de reussir au mauvais endroit.
 */
function formatDate(date) {
    if (date === null || date === undefined) return null;
    // Une CHAINE passe par parseDate, jamais par new Date().
    //
    // new Date('2026-08-02') lit une date ISO en UTC, alors que les getters
    // ci-dessous sont locaux: sur un fuseau negatif le jour reculait d'un.
    // Mesure a America/New_York: formatDate('2026-08-02') rendait
    // '01-08-2026'. Et une chaine JJ-MM-AAAA etait pire encore,
    // formatDate('02-08-2026') rendant '08-02-2026'. Les appelants passent
    // bien des chaines (db/utils.js#getTransfertsByDateRange,
    // server.js#formattedStartDate), donc le cas n'est pas theorique - il
    // n'echappait qu'a la production, qui tourne en UTC.
    //
    // parseDate, lui, construit une date LOCALE a partir des composants, ce
    // qui est exactement ce que ces getters attendent.
    const d = typeof date === 'string' ? parseDate(date) : new Date(date);
    if (!d || isNaN(d.getTime())) return null;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

/**
 * Parse une date de saisie vers un objet Date.
 * Formats acceptes: JJ/MM/AAAA, JJ-MM-AAAA et AAAA-MM-JJ (ISO).
 *
 * L'ISO doit etre teste EN PREMIER. Sans lui, '2026-08-02' tombait dans la
 * branche JJ-MM-AAAA: jour='2026', mois='08', annee='02' -> '2002', puis
 * new Date(2002, 7, 2026) debordait de 2026 jours et rendait le 16 fevrier
 * 2008 - une date parfaitement valide, donc AUCUN appelant ne pouvait s'en
 * apercevoir. C'est ce qui faisait ecrire des stock-soir.json vides:
 * syncStockJsonFromBDD interrogeait la base sur une date inexistante, ne
 * trouvait rien, et ecrivait {} au bon chemin (getPathByDate, lui, gere
 * l'ISO). Neuf journees en portent encore la trace, dont huit ou la table
 * contenait pourtant 85 a 90 lignes.
 *
 * Un debordement rend desormais null plutot qu'une date plausible: mieux
 * vaut un appelant qui echoue franchement qu'un calcul mene sur 2008.
 */
function parseDate(dateStr) {
    if (!dateStr) return null;

    const s = String(dateStr).trim();
    let jour, mois, annee;

    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        // Format ISO AAAA-MM-JJ (eventuellement suivi d'une heure).
        [annee, mois, jour] = s.slice(0, 10).split('-');
    } else if (s.includes('/')) {
        [jour, mois, annee] = s.split('/');
    } else if (s.includes('-')) {
        [jour, mois, annee] = s.split('-');
    } else {
        return null;
    }

    if (!jour || !mois || !annee) return null;
    // S'assurer que l'annee est au format 4 chiffres
    if (annee.length === 2) {
        annee = '20' + annee;
    }

    const a = Number(annee);
    const m = Number(mois);
    const j = Number(jour);
    if (!Number.isFinite(a) || !Number.isFinite(m) || !Number.isFinite(j)) return null;

    const d = new Date(a, m - 1, j);
    // Garde anti-debordement: new Date(2002, 7, 2026) ne leve pas, il glisse
    // de plusieurs annees. On refuse ce que JavaScript a silencieusement
    // reinterprete plutot que de le propager.
    if (d.getFullYear() !== a || d.getMonth() !== m - 1 || d.getDate() !== j) {
        return null;
    }
    return d;
}

module.exports = { formatDate, parseDate };
