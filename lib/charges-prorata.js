/**
 * Decoupage d'une periode en mois calendaires, pour le prorata des charges
 * fixes du PL.
 *
 * Le PL proratisait les charges sur un mois conventionnel de 30 jours
 * (montant x nbJoursPeriode / 30). Juillet, qui compte 31 jours, etait donc
 * facture 31/30e: 420 000 FCFA de charges devenaient 434 000 pour un mois
 * pourtant complet. Le prorata se calcule desormais sur les jours REELS de
 * chaque mois traverse.
 *
 * Module sans dependance: testable sans base ni serveur.
 */

// Nombre de jours du mois 'YYYY-MM'. UTC partout pour eviter qu'un fuseau
// negatif ne fasse basculer une borne sur le mois precedent.
function joursDansLeMois(mois) {
    const [y, m] = String(mois).split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Decoupe [dateDebut, dateFin] (ISO 'YYYY-MM-DD', bornes incluses) en mois.
 *
 * Rend pour chaque mois traverse: son identifiant 'YYYY-MM', le nombre de
 * jours de la periode qui y tombent, et le nombre de jours reels du mois.
 * Un mois entier donne joursCouverts === joursDuMois, donc un prorata de 1.
 *
 * Rend [] si les bornes sont invalides ou inversees.
 */
function decouperEnMois(dateDebut, dateFin) {
    const out = [];
    const debut = new Date(dateDebut + 'T00:00:00Z');
    const fin = new Date(dateFin + 'T00:00:00Z');
    if (isNaN(debut.getTime()) || isNaN(fin.getTime()) || debut > fin) return out;

    let curseur = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth(), 1));
    while (curseur <= fin) {
        const y = curseur.getUTCFullYear();
        const m = curseur.getUTCMonth();
        const premierDuMois = new Date(Date.UTC(y, m, 1));
        const dernierDuMois = new Date(Date.UTC(y, m + 1, 0));

        const bas = debut > premierDuMois ? debut : premierDuMois;
        const haut = fin < dernierDuMois ? fin : dernierDuMois;

        out.push({
            mois: `${y}-${String(m + 1).padStart(2, '0')}`,
            joursCouverts: Math.round((haut - bas) / 86400000) + 1,
            joursDuMois: dernierDuMois.getUTCDate()
        });
        curseur = new Date(Date.UTC(y, m + 1, 1));
    }
    return out;
}

module.exports = { decouperEnMois, joursDansLeMois };
