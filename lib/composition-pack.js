/**
 * Validation d'une composition de pack avant ecriture.
 *
 * Extrait du gestionnaire PUT pour etre testable sans base ni serveur: les
 * defauts que cette fonction arrete ne provoquent aucune erreur visible, ils
 * faussent le parage en silence. C'est precisement le genre de regle qu'il
 * faut tenir par des tests plutot que par la relecture.
 *
 * Les trois pieges, tous constates sur ce projet:
 *  - une unite hors liste vaut 0 kg au calcul: les kilos sortent du parage;
 *  - une piece sans poids unitaire ne peut pas etre convertie, meme effet;
 *  - une composition VIDE efface le pack, car l'ecriture remplace les lignes
 *    du pack en entier.
 */
const { UNITES_CONNUES } = require('./parage');

/**
 * @returns {{ ok: true, valides: Array }} ou {{ ok: false, message: string }}
 */
function validerCompositionPack(pack, lignes) {
    const nom = String(pack || '').trim();
    if (!nom || !Array.isArray(lignes)) {
        return { ok: false, message: 'pack et lignes requis' };
    }

    const valides = [];
    for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i] || {};
        const produit = String(l.produit || '').trim();
        const quantite = parseFloat(l.quantite);
        const unite = String(l.unite || 'kg').trim().toLowerCase();

        // Ligne laissee vide par l'ecran: on l'ignore, elle n'exprime rien.
        if (!produit) continue;

        if (!(quantite > 0)) {
            return { ok: false, message: `${produit}: quantite invalide` };
        }
        const poids = parseFloat(l.poids_unitaire);
        if (!UNITES_CONNUES.includes(unite)) {
            return {
                ok: false,
                message: `${produit}: unite "${l.unite}" inconnue `
                    + `(attendu: ${UNITES_CONNUES.join(', ')})`
            };
        }
        if ((unite === 'piece' || unite === 'pièce') && !(poids > 0)) {
            return { ok: false, message: `${produit}: une unite "pièce" exige un poids unitaire` };
        }

        valides.push({
            pack: nom,
            ordre: valides.length,
            produit,
            quantite,
            unite,
            poids_unitaire: poids > 0 ? poids : null
        });
    }

    // Le test porte sur "valides" et non sur les lignes recues: des lignes
    // toutes sans produit sont ecartees par le continue ci-dessus et donnent
    // le meme resultat qu'un tableau vide - l'effacement du pack.
    if (!valides.length) {
        return {
            ok: false,
            message: `${nom}: une composition doit contenir au moins une ligne. `
                + `Enregistrer une composition vide effacerait ce pack, sans moyen `
                + `de le recreer depuis cet ecran.`
        };
    }

    return { ok: true, valides };
}

module.exports = { validerCompositionPack };
