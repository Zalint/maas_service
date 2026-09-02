/**
 * « Commission intégrée » : les produits dont le prix porte DÉJÀ la commission
 * MaaS, et sur lesquels il ne faut donc plus la facturer une seconde fois.
 *
 * L'AUTORITÉ N'EST PAS UN RÉGLAGE, C'EST DATA. Le service qui fixe les prix
 * sait, produit par produit et date par date, s'il a majoré ou non — et le
 * dit explicitement. Une case à cocher côté Maas serait une seconde vérité,
 * à re-régler à chaque évolution du catalogue et fausse dès qu'elle décrocherait
 * de la réalité de DATA. On lit donc la sienne.
 *
 * DEUX SOURCES, parce que DATA calcule les deux prix séparément :
 *
 *   1. Produits du catalogue — GET /api/external/prix-vente-maas
 *      Chaque ligne porte `commissionAppliquee` (booléen) à côté de `prixMaas`.
 *      true  -> prixMaas = prix x (1 + taux/100) : la commission est dedans.
 *      false -> prixMaas = prix tel quel : taux absent à cette date, ou bœuf.
 *
 *   2. Le BŒUF — GET /api/external/achats-boeuf
 *      DATA met délibérément `commissionAppliquee: false` sur le bœuf dans le
 *      catalogue : son prix facturé ne se dérive pas du prix de vente mais du
 *      prix de revient de l'achat du jour, et vit dans `parDateBoeufMaas`
 *      (cf lib/achats-boeuf-client.js). C'est donc de là que vient la réponse
 *      pour lui — et seulement pour les journées où DATA publie ce prix : les
 *      autres retombent sur le catalogue Maas, qui lui ne contient pas la
 *      commission, et doivent continuer à la payer.
 *
 * Le principe qui gouverne tout le module : ne jamais compter la commission
 * deux fois, ne jamais l'oublier. La question posée est toujours « le prix
 * EFFECTIVEMENT retenu pour ce produit à cette date la contient-il ? », et
 * en cas de doute la réponse est non — une commission oubliée se voit dans le
 * solde fournisseur, une commission fantôme se cherche des semaines.
 */

'use strict';

const { normaliserNom } = require('./parage');

// Le seul produit dont le prix facturé vient des achats et non du catalogue.
const PRODUIT_API = 'Boeuf';

// La source DATA à lire pour le prix d'achat du bœuf. Il n'y a plus de choix
// à faire: le prix qui nous intéresse est celui que le fournisseur FACTURE,
// donc parDateBoeufMaas. `parDateBoeuf` (le revient nu) reste accessible au
// client pour qui veut le coût hors commission, mais ce n'est pas la base de
// la dette fournisseur.
const SOURCE_BOEUF = 'maas';

/**
 * L'etat « commission integree » pour une date donnee, tel que DATA le decrit.
 *
 * @param {Map<string, boolean>} commissionParNom  cf lib/prix-vente-maas-client
 * @param {boolean} disponible  false si DATA n'a pas repondu: on ne sait rien,
 *        et « je ne sais pas » vaut « la commission reste due ».
 */
function depuisCatalogueData(commissionParNom, disponible) {
    return {
        disponible: !!disponible,
        parNom: commissionParNom instanceof Map ? commissionParNom : new Map()
    };
}

/** Un etat neutre: rien n'est integre. Sert de repli quand DATA est muet. */
function aucun() {
    return { disponible: false, parNom: new Map() };
}

/**
 * Ce produit porte-t-il deja la commission dans le prix retenu ?
 *
 * Ne repond QUE pour les produits du catalogue: le bœuf est traite par
 * l'appelant via lib/achats-boeuf-client (cf en-tete), parce que la reponse y
 * depend de la DATE et non du seul produit.
 */
function estCommissionIntegree(produit, etat) {
    if (!etat || !etat.parNom) return false;
    return etat.parNom.get(normaliserNom(produit)) === true;
}

/** Le produit dont la reponse vient des achats et non du catalogue ? */
function estProduitApi(produit) {
    return normaliserNom(produit) === normaliserNom(PRODUIT_API);
}

/**
 * LE PRIX FACTURE PAR MATA POUR CE PRODUIT A CETTE DATE, ou null.
 *
 * UNE SEULE FONCTION REPOND AUX DEUX QUESTIONS du chantier - « quel cout
 * retenir ? » et « faut-il encore facturer la commission ? » - parce que ce
 * sont deux formulations de la meme: si ce prix s'applique, il porte la
 * commission et elle ne se refacture pas; s'il ne s'applique pas, le cout
 * retenu est celui du catalogue, qui ne la porte pas, et elle reste due.
 * Les resoudre separement, c'est laisser un cout hors commission cohabiter
 * avec une commission annulee - et perdre la difference sans que rien ne
 * l'affiche.
 *
 * @param {string} produit
 * @param {string} dateISO  la journee valorisee
 * @param {{parNom: Map, depuisParNom: Map}} prixMata  cf prix-vente-maas-client
 * @param {(msg: string) => void} [avertir]  pour dire un refus qui coute
 * @returns {number|null}
 */
function prixMataApplicable(produit, dateISO, prixMata, avertir) {
    if (!prixMata || !prixMata.parNom) return null;
    const cle = normaliserNom(produit);
    const prix = parseFloat(prixMata.parNom.get(cle));
    if (!Number.isFinite(prix) || prix <= 0) return null;

    const depuis = prixMata.depuisParNom ? prixMata.depuisParNom.get(cle) : undefined;
    // DATA connait le produit mais pas la date d'entree en vigueur (version
    // anterieure a ces champs): on REFUSE. Traiter l'absence de donnee comme
    // une autorisation ferait appliquer un tarif d'aujourd'hui a un mois
    // entier - exactement ce que ce garde existe pour empecher.
    if (depuis == null) {
        if (avertir) {
            avertir(
                `Prix d'achat MATA de « ${produit} » : MAAS (DATA) ne dit pas depuis quand `
                + `ce tarif s'applique, le prix enregistré a été utilisé (il ne contient `
                + `pas la commission, qui reste donc facturée).`
            );
        }
        return null;
    }
    if (String(dateISO || '') < depuis) {
        if (avertir) {
            avertir(
                `Prix d'achat MATA de « ${produit} » : le tarif connu s'applique depuis le `
                + `${depuis}, les journées antérieures gardent le prix enregistré et leur `
                + `commission.`
            );
        }
        return null;
    }
    return prix;
}

module.exports = {
    PRODUIT_API,
    SOURCE_BOEUF,
    depuisCatalogueData,
    aucun,
    estCommissionIntegree,
    prixMataApplicable,
    estProduitApi
};
