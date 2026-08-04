/**
 * Controle de la table des references de caisse d'un brand-config.json.
 *
 * Extrait de scripts/apply-tenant-config.js pour etre testable: le script
 * appelle process.exit, donc rien de ce qu'il decide ne pouvait etre verifie
 * autrement qu'en le lancant, avec ses effets de bord sur les fichiers.
 *
 * Ce que ce controle empeche: deployer un tenant dont `references_caisse` est
 * absent ou vide. Dans ce cas generateCashReference rend null pour chaque point
 * de vente, server.js fait `if (cashRef)` et saute l'ecriture, et la cloture
 * repond 201 succes SANS enregistrer le cash. Le point de vente disparait de la
 * reconciliation sans qu'aucune erreur ne soit levee nulle part.
 *
 * IMPORTANT - le controle suit la semantique du runtime, pas une plus stricte.
 * config/cash-references.js construit la table par Object.assign sur TOUTES les
 * marques du fichier: c'est une UNION. Exiger la cle sur chaque marque ferait
 * echouer le build d'une configuration qui fonctionne parfaitement, et un
 * garde-fou qui bloque un deploiement legitime coute plus cher que le defaut
 * qu'il surveille.
 */

/**
 * @param {object} brandConfig contenu parse de brand-config.json
 * @returns {{ ok: boolean, problemes: string[], resume: Array<{marque: string, nb: number}>, total: number }}
 */
function validerReferencesCaisse(brandConfig) {
    const problemes = [];
    const resume = [];

    const estObjetSimple = brandConfig
        && typeof brandConfig === 'object'
        && !Array.isArray(brandConfig);
    const marques = estObjetSimple ? Object.entries(brandConfig) : [];

    if (!marques.length) {
        problemes.push('brand-config.json ne declare aucune marque.');
        return { ok: false, problemes, resume, total: 0 };
    }

    // Union, comme le runtime.
    const union = {};

    for (const [cle, marque] of marques) {
        const refs = marque && marque.references_caisse;
        if (refs === undefined || refs === null) continue; // marque sans caisse: legitime

        if (typeof refs !== 'object' || Array.isArray(refs)) {
            problemes.push(`${cle}.references_caisse doit etre un objet `
                + `{ "Point de vente": "CASH_XXX" }, recu: ${Array.isArray(refs) ? 'tableau' : typeof refs}.`);
            continue;
        }

        const noms = Object.keys(refs);
        for (const nom of noms) {
            const valeur = refs[nom];
            if (!String(nom).trim()) {
                problemes.push(`${cle}.references_caisse contient un nom de point de vente vide.`);
                continue;
            }
            // Strictement une chaine non vide: un nombre ou un objet passerait
            // String() sans broncher et finirait tel quel dans
            // cash_payments.payment_reference ("[object Object]" compris).
            if (typeof valeur !== 'string' || !valeur.trim()) {
                problemes.push(`${cle}.references_caisse["${nom}"] n'est pas une reference valide `
                    + `(attendu une chaine non vide, recu: ${valeur === '' ? 'chaine vide' : typeof valeur}).`);
                continue;
            }
            union[nom] = valeur.trim();
        }

        if (noms.length) resume.push({ marque: cle, nb: noms.length });
    }

    const total = Object.keys(union).length;
    if (!total && !problemes.length) {
        problemes.push('references_caisse est absent ou vide sur toutes les marques.');
    }

    return { ok: problemes.length === 0, problemes, resume, total };
}

module.exports = { validerReferencesCaisse };
