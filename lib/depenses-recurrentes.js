/**
 * Detection du double compte potentiel entre les DEPENSES ponctuelles
 * (onglet Finance > Depenses, table `depenses`) et les CHARGES FIXES
 * mensuelles proratisees (table `finance_charges`) dans le calcul du PL.
 *
 * Contexte: les deux buckets sont soustraits du PL. Une depense saisie dans
 * une categorie qui recouvre une charge fixe deja proratisee (ex: le loyer
 * du mois saisi en depense alors que la charge "Loyer" est deja comptee)
 * serait donc deduite DEUX FOIS.
 *
 * Choix delibere: on NE retire PAS ces depenses du total.
 * Sur les donnees reelles, la depense de categorie `electricite` est un
 * "Courant d'urgence" ponctuel qui S'AJOUTE a l'abonnement mensuel de la
 * charge fixe "Electricite" — l'exclure supprimerait un cout reel sans que
 * personne s'en apercoive. La categorie ne dit pas si la depense est le
 * paiement de l'abonnement ou un surcout. On se contente donc de SIGNALER
 * le montant a risque pour que l'utilisateur tranche.
 *
 * NB: les cles ne correspondent pas d'un cote a l'autre (charge `elec` /
 * `masse_salariale` vs categorie `electricite` / `salaire`), d'ou le
 * rapprochement par mots-cles normalises plutot que par egalite de nom.
 */

'use strict';

/** Categorie de depense -> mots-cles identifiant la charge fixe equivalente. */
const RECOUVREMENTS = {
    loyer: ['loyer'],
    salaire: ['salaire', 'masse salariale', 'massesalariale'],
    electricite: ['elec', 'electricite'],
    eau: ['eau'],
    internet: ['internet']
};

/** minuscules, sans accents ni separateurs: "Masse salariale" -> "massesalariale". */
function normaliser(s) {
    return String(s == null ? '' : s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

/**
 * @param {Array} depenses - lignes {categorie, montant} de la periode
 * @param {Array} charges  - lignes {nom, libelle} des charges fixes actives
 * @returns {{montant:number, categories:string[]}} montant a risque de double
 *   compte et categories concernees (vide si aucun recouvrement).
 */
function detecterDoubleCompte(depenses, charges) {
    const clesCharges = new Set();
    for (const c of charges || []) {
        if (c && c.nom) clesCharges.add(normaliser(c.nom));
        if (c && c.libelle) clesCharges.add(normaliser(c.libelle));
    }
    // Une categorie recouvre une charge si un de ses mots-cles est contenu
    // dans une cle de charge (ou l'inverse): "elec" ⊂ "electricite".
    const categoriesEnDouble = new Set();
    let montant = 0;
    for (const d of depenses || []) {
        const cat = normaliser(d && d.categorie);
        const motsCles = RECOUVREMENTS[cat];
        if (!motsCles) continue;
        const recouvre = motsCles.some((mot) => {
            const m = normaliser(mot);
            for (const cle of clesCharges) {
                if (cle.includes(m) || m.includes(cle)) return true;
            }
            return false;
        });
        if (recouvre) {
            categoriesEnDouble.add(cat);
            montant += parseFloat(d.montant) || 0;
        }
    }
    return {
        montant: Math.round(montant * 100) / 100,
        categories: Array.from(categoriesEnDouble).sort()
    };
}

module.exports = { detecterDoubleCompte, _internals: { normaliser, RECOUVREMENTS } };
