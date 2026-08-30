'use strict';

/**
 * Le rapport de parage d'un mois, pour UNE categorie (bovin ou ovin).
 *
 * Module PUR: aucune requete, aucune date systeme. L'appelant (la route
 * GET /api/reconciliation/parage-rapport) a deja boucle jour par jour comme
 * lib/parage-mois.js le fait pour le cumul simple, et lui fournit ici le
 * DETAIL par jour au lieu de le jeter.
 *
 * Le but n'est pas de re-rediger l'analyse: c'est de poser les chiffres que
 * le modele de langage (POST /api/finance/analyse-ia, type 'parage') va
 * ensuite commenter SANS calcul supplementaire - meme discipline que le PL.
 */

const { SEUIL_KG, tauxDePerte } = require('./parage');

const MOIS_FR = [
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'
];

function round1(v) {
    return Math.round((parseFloat(v) || 0) * 10) / 10;
}

function round2(v) {
    return Math.round((parseFloat(v) || 0) * 100) / 100;
}

/** Taux pondere (perte en %) sur un GROUPE de jours - jamais une moyenne de
 *  pourcentages journaliers, cf lib/parage-periode.js:cumulerMois. */
function tauxGroupe(jours) {
    const theorique = jours.reduce((s, j) => s + j.theorique, 0);
    const vendu = jours.reduce((s, j) => s + j.vendu, 0);
    const { perte } = tauxDePerte(vendu, theorique);
    return {
        n_jours: jours.length,
        kg_theorique: round1(theorique),
        kg_vendu: round1(vendu),
        taux_pondere_pct: perte === null ? null : round1(perte * 100)
    };
}

/**
 * Numero de semaine ISO 8601 d'une date, et le lundi/dimanche qui l'encadrent.
 * Algorithme standard (jeudi de la semaine determine l'annee ISO) - la
 * definition importe peu ici, seul compte que deux dates du meme lundi-
 * dimanche tombent TOUJOURS dans le meme groupe.
 */
function semaineIso(dateIso) {
    const d = new Date(dateIso + 'T00:00:00Z');
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

function libellePeriode(debutIso, finIso) {
    const [, mDeb, jDeb] = debutIso.split('-').map(Number);
    const [, mFin, jFin] = finIso.split('-').map(Number);
    const moisFin = MOIS_FR[mFin - 1];
    return mDeb === mFin
        ? `${jDeb}-${jFin} ${moisFin}`
        : `${jDeb} ${MOIS_FR[mDeb - 1]} - ${jFin} ${moisFin}`;
}

/** Coefficient de correlation de Pearson entre deux series de meme longueur.
 *  null si moins de 2 points ou variance nulle sur l'un des deux axes -
 *  une correlation n'a pas de sens sur une droite verticale ou horizontale. */
function correlationPearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    const moyX = xs.reduce((s, v) => s + v, 0) / n;
    const moyY = ys.reduce((s, v) => s + v, 0) / n;
    let cov = 0, varX = 0, varY = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - moyX;
        const dy = ys[i] - moyY;
        cov += dx * dy;
        varX += dx * dx;
        varY += dy * dy;
    }
    if (varX <= 0 || varY <= 0) return null;
    return round2(cov / Math.sqrt(varX * varY));
}

/**
 * @param {object} args
 * @param {Array<{date: string, theorique: number, vendu: number, a_livraison: boolean}>} args.jours
 *   Un jour par entree. Les jours NON MESURABLES (theorique <= SEUIL_KG,
 *   rien a mesurer ce jour-la) sont filtres ICI, pas chez l'appelant - meme
 *   regle d'admission que lib/parage-periode.js:cumulerMois.
 * @param {number} [args.cible=5]        taux cible en %, la ligne pointillee du poster
 * @param {number|null} [args.prixParKg] prix d'achat moyen du kg (resolveur
 *   partage avec le PL/Cash et Stock), pour valoriser l'enjeu. null si
 *   inconnu: l'enjeu FCFA sort alors a null plutot qu'a un chiffre invente.
 * @returns {object|null} null si aucun jour mesurable ce mois-ci (categorie
 *   sans volume - l'appelant doit alors omettre la page).
 */
function construireRapportParage(args) {
    const a = args || {};
    const cible = Number.isFinite(a.cible) ? a.cible : 5;
    const prixParKg = Number.isFinite(a.prixParKg) ? a.prixParKg : null;

    const jours = (a.jours || [])
        .filter((j) => Number.isFinite(j.theorique) && j.theorique > SEUIL_KG)
        .map((j) => ({
            date: j.date,
            theorique: parseFloat(j.theorique) || 0,
            vendu: parseFloat(j.vendu) || 0,
            a_livraison: !!j.a_livraison
        }))
        .sort((x, y) => x.date.localeCompare(y.date));

    if (!jours.length) return null;

    const avecLivraison = jours.filter((j) => j.a_livraison);
    const sansLivraison = jours.filter((j) => !j.a_livraison);

    const parSemaine = new Map();
    for (const j of jours) {
        const sem = semaineIso(j.date);
        const cle = sem.numero;
        if (!parSemaine.has(cle)) {
            parSemaine.set(cle, { numero: sem.numero, debut: sem.debut, fin: sem.fin, jours: [] });
        }
        parSemaine.get(cle).jours.push(j);
    }
    const semaines = Array.from(parSemaine.values())
        .sort((x, y) => x.numero - y.numero)
        .map((s) => ({
            label: `S${s.numero}`,
            periode: libellePeriode(s.debut, s.fin),
            ...tauxGroupe(s.jours)
        }));

    const correlation = correlationPearson(
        jours.map((j) => j.theorique),
        jours.map((j) => tauxDePerte(j.vendu, j.theorique).perte * 100)
    );

    const joursNotables = jours
        .map((j) => ({
            date: j.date,
            theorique_kg: round1(j.theorique),
            vendu_kg: round1(j.vendu),
            kg_perte: round1(j.theorique - j.vendu),
            taux_pct: round1(tauxDePerte(j.vendu, j.theorique).perte * 100),
            a_livraison: j.a_livraison
        }))
        .sort((x, y) => y.kg_perte - x.kg_perte)
        .slice(0, 5);

    const ensemble = tauxGroupe(jours);
    const ecartPct = Math.max(0, (ensemble.taux_pondere_pct || 0) - cible);
    const kgGagnablesMois = round1(ensemble.kg_theorique * (ecartPct / 100));
    const fcfaMois = prixParKg != null ? Math.round(kgGagnablesMois * prixParKg) : null;

    return {
        cible_pct: cible,
        ensemble,
        avec_livraison: tauxGroupe(avecLivraison),
        sans_livraison: tauxGroupe(sansLivraison),
        semaines,
        correlation,
        jours_notables: joursNotables,
        enjeu: {
            ecart_pct: round1(ecartPct),
            kg_gagnables_mois: kgGagnablesMois,
            prix_par_kg: prixParKg,
            fcfa_mois: fcfaMois,
            fcfa_an: fcfaMois != null ? fcfaMois * 12 : null
        }
    };
}

module.exports = { construireRapportParage, correlationPearson, semaineIso };
