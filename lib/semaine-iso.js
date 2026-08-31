'use strict';

/**
 * Semaine ISO 8601 d'une date: son numero, et le lundi/dimanche qui
 * l'encadrent.
 *
 * Point unique - avant ce module, le meme calcul vivait en double
 * (lib/decoupe-as-ventes.js et lib/parage-rapport.js), ecrit differemment
 * (un raccourci "+4 - (jour||7)" ici, un detour explicite par le lundi
 * la-bas) mais resolvant le meme algorithme: le jeudi de la semaine
 * determine son annee ISO, et diviser par 7 les jours ecoules depuis le
 * 1er janvier de cette annee donne le numero.
 */

/**
 * @param {Date|string} date  un objet Date, ou une date ISO 'AAAA-MM-JJ'
 * @returns {{numero: number, debut: string, fin: string}}
 */
function semaineIso(date) {
    const d = typeof date === 'string'
        ? new Date(date + 'T00:00:00Z')
        : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    const jourSemaine = (d.getUTCDay() + 6) % 7; // 0 = lundi
    const lundi = new Date(d);
    lundi.setUTCDate(d.getUTCDate() - jourSemaine);
    const dimanche = new Date(lundi);
    dimanche.setUTCDate(lundi.getUTCDate() + 6);

    const jeudi = new Date(lundi);
    jeudi.setUTCDate(lundi.getUTCDate() + 3);
    const premierJanvier = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 1));
    const numero = Math.ceil((((jeudi - premierJanvier) / 86400000) + 1) / 7);

    return {
        numero,
        debut: lundi.toISOString().slice(0, 10),
        fin: dimanche.toISOString().slice(0, 10)
    };
}

module.exports = { semaineIso };
