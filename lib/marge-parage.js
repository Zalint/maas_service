/**
 * Marge sur la matiere, adossee au calcul de parage.
 *
 *   marge = vendu_kg x prix_vente_moyen_pondere
 *         - theorique_kg x prix_achat_moyen_pondere
 *
 * Autrement dit: ce qui a REELLEMENT ete encaisse sur la viande, moins le cout
 * de la matiere sortie du stock. La perte de parage y est donc deja incorporee
 * - les kilos manquants sont payes a l'achat sans jamais etre vendus.
 *
 * Module sans dependance ni acces base: prix et categories sont fournis par
 * l'appelant, ce qui rend le calcul testable a la main.
 */

const { quantiteEnKg, compositionDuPack, normaliserNom, CATEGORIES } = require('./parage');

// Sous ce seuil, aucun prix moyen n'a de sens: diviser un montant par une
// poussiere de kilos produirait un prix au kilo astronomique.
const SEUIL_KG = 0.001;

// Repli quand un produit n'a pas de prix d'achat au catalogue fournisseur
// (le foie, le yell, tant qu'ils n'y sont pas saisis): on le DEDUIT du prix de
// vente en supposant cette marge.
//
// Une estimation ne doit jamais etre indiscernable d'une mesure: chaque prix
// deduit est nomme dans `hypotheses`, avec sa methode et les deux prix, pour
// que l'appelant sache exactement ce qu'il regarde. Sans ca, une marge qui
// bouge parce qu'un prix a ete saisi ressemblerait a une variation reelle.
const MARGE_SUPPOSEE = 0.10;

function creerBloc() {
    return { kg: 0, ca: 0 };
}

/**
 * Repartit le montant d'une vente de pack entre ses composants, au prorata de
 * leur VALEUR CATALOGUE (quantite x prix de vente).
 *
 * Un pack porte un montant unique alors que ses kilos comptent dans plusieurs
 * categories. L'attribuer entier a l'une d'elles gonflerait son prix moyen; le
 * repartir au kilo ferait payer le meme prix a l'oeuf et au filet. Le prorata
 * de valeur est le seul qui respecte le fait qu'un pack est vendu comme une
 * remise sur un panier: chaque composant garde son poids economique relatif.
 *
 * @returns {Array} [{ produit, kg, part }] - part = fraction du montant (0..1)
 */
function repartirMontantPack(composition, prixVente) {
    const lignes = (composition || []).map((c) => ({
        produit: c.produit,
        kg: quantiteEnKg(c),
        // La VALEUR se calcule sur la quantite telle qu'exprimee, pas sur les
        // kilos: une tablette d'oeufs vaut son prix alors qu'elle pese 0 kg au
        // sens du parage. L'ignorer donnerait toute la valeur du pack a la
        // viande, et un prix de vente moyen surestime.
        // Quantite bornee a zero, comme le fait deja quantiteEnKg: une valeur
        // negative attribuerait plus de 100% du montant a une categorie.
        valeur: Math.max(0, parseFloat(c.quantite) || 0) * Math.max(0, parseFloat(prixVente(c.produit)) || 0)
    }));

    const total = lignes.reduce((s, l) => s + l.valeur, 0);
    if (total > 0) {
        return lignes.map((l) => ({ produit: l.produit, kg: l.kg, part: l.valeur / total }));
    }

    // Aucun prix connu: repli sur les kilos, faute de mieux. Mieux vaut une
    // repartition grossiere qu'un montant entier attribue au premier composant.
    const totalKg = lignes.reduce((s, l) => s + l.kg, 0);
    if (totalKg > 0) {
        return lignes.map((l) => ({ produit: l.produit, kg: l.kg, part: l.kg / totalKg }));
    }
    return lignes.map((l) => ({ produit: l.produit, kg: l.kg, part: 0 }));
}

/**
 * @param {Object} args
 * @param {Object} args.parage        sortie de calculerParage pour UN point de vente,
 *                                    ou l'agregat de plusieurs: { bovin: {...}, ovin: {...} }
 * @param {Array}  args.ventes        [{ pointVente, produit, nombre, montant, extension }]
 * @param {Object} [args.packs]       compositions par defaut
 * @param {Function} args.categorieDe (produit) => 'bovin' | 'ovin' | null
 * @param {Function} args.prixVente   (produit) => number | null  (catalogue, type 'vente')
 * @param {Function} args.prixAchat   (produit) => number | null  (propre au produit)
 * @param {Object} args.prixAchatDefaut { bovin: number|null, ovin: number|null }
 * @param {Set}    [args.exclusions]
 * @returns {Object} { bovin: {...}, ovin: {...} }
 */
function calculerMarge(args) {
    const {
        parage = {},
        ventes = [],
        packs = {},
        categorieDe,
        prixVente = () => null,
        prixAchat = () => null,
        prixAchatDefaut = {},
        margeSupposee = MARGE_SUPPOSEE,
        exclusions = new Set()
    } = args || {};

    const exclusionsNormalisees = new Set(Array.from(exclusions || []).map(normaliserNom));
    const exclu = (p) => exclusionsNormalisees.has(normaliserNom(p));

    const acc = {};
    for (const cat of CATEGORIES) {
        acc[cat] = { horsPack: creerBloc(), pack: creerBloc() };
    }

    // --- Chiffre d'affaires, ventile par origine ------------------------
    for (const v of ventes) {
        const nombre = parseFloat(v.nombre) || 0;
        const montant = parseFloat(v.montant) || 0;
        const composition = compositionDuPack(v, packs);

        if (!composition) {
            if (exclu(v.produit)) continue;
            const cat = categorieDe(v.produit);
            if (!cat || !acc[cat]) continue;
            acc[cat].horsPack.kg += nombre;
            acc[cat].horsPack.ca += montant;
            continue;
        }

        // `nombre` est le NOMBRE DE PACKS; le montant couvre la totalite de la
        // ligne, donc tous les packs vendus.
        for (const part of repartirMontantPack(composition, prixVente)) {
            if (exclu(part.produit)) continue;
            const cat = categorieDe(part.produit);
            if (!cat || !acc[cat]) continue;
            acc[cat].pack.kg += part.kg * nombre;
            acc[cat].pack.ca += montant * part.part;
        }
    }

    // --- Cout de la matiere theorique -----------------------------------
    const resultat = {};
    for (const cat of CATEGORIES) {
        const p = parage[cat] || { theorique: 0, vendu: 0, perte: null, parProduit: {} };
        const parProduit = p.parProduit || {};

        let cout = 0;
        let kgCoutes = 0;
        const sansPrix = [];
        const hypotheses = [];
        for (const [produit, l] of Object.entries(parProduit)) {
            const theo = parseFloat(l.theorique) || 0;
            if (!theo) continue;

            // 1. Prix propre au produit, s'il est saisi au catalogue fournisseur.
            let prix = parseFloat(prixAchat(produit));
            let origine = 'catalogue fournisseur';

            // 2. Sinon, deduit du prix de vente en supposant une marge. C'est
            //    le cas du foie et du yell tant qu'ils n'ont pas de prix
            //    d'achat: ils sont vendus separement, donc leur cout ne peut
            //    pas etre celui de la carcasse entiere.
            if (!Number.isFinite(prix) || prix <= 0) {
                const pv = parseFloat(prixVente(produit));
                if (Number.isFinite(pv) && pv > 0) {
                    prix = pv * (1 - margeSupposee);
                    origine = `deduit du prix de vente, marge supposee de ${Math.round(margeSupposee * 100)}%`;
                    hypotheses.push({
                        produit,
                        prix_vente: pv,
                        prix_achat_estime: prix,
                        methode: origine
                    });
                }
            }

            // 3. Sinon, le prix de la matiere premiere de la categorie: le veau
            //    est un boeuf vendu plus cher, il sort de la meme carcasse.
            if (!Number.isFinite(prix) || prix <= 0) {
                prix = parseFloat(prixAchatDefaut[cat]);
                origine = 'prix de la matiere premiere de la categorie';
            }

            if (!Number.isFinite(prix) || prix <= 0) {
                sansPrix.push(produit);
                continue;
            }
            cout += theo * prix;
            kgCoutes += theo;
        }

        // Mesurable = le parage a pu etre calcule, donc le stock theorique
        // existe, donc le cout a un sens.
        // On accepte l'un ou l'autre champ: calculerParage rend toujours les
        // deux, mais un appelant qui n'en fournit qu'un ne doit pas se voir
        // refuser sa marge en silence.
        const mesurable = (p.perte !== null && p.perte !== undefined)
            || (p.ratio !== null && p.ratio !== undefined);

        const horsPack = acc[cat].horsPack;
        const pack = acc[cat].pack;
        const venduKg = horsPack.kg + pack.kg;
        const ca = horsPack.ca + pack.ca;
        const moyen = (bloc) => (bloc.kg > SEUIL_KG ? bloc.ca / bloc.kg : null);

        resultat[cat] = {
            vendu_kg: venduKg,
            theorique_kg: parseFloat(p.theorique) || 0,
            parage_pct: p.perte === null || p.perte === undefined ? null : p.perte * 100,

            ca_vendu: ca,
            prix_vente_moyen: venduKg > SEUIL_KG ? ca / venduKg : null,

            cout_theorique: cout,
            // Pondere par les kilos reellement coutes: un produit sans prix
            // connu ne doit pas tirer la moyenne vers le bas en comptant pour
            // zero. Il est nomme dans produits_sans_prix_achat.
            prix_achat_moyen: kgCoutes > SEUIL_KG ? cout / kgCoutes : null,
            kg_sans_prix_achat: (parseFloat(p.theorique) || 0) - kgCoutes,
            produits_sans_prix_achat: sansPrix,
            // Prix d'achat DEDUITS et non mesures. Vide = tout est mesure.
            hypotheses,

            // Marge INCONNUE, et non nulle, quand le parage n'est pas
            // mesurable: sans stock theorique, la boucle de cout ci-dessus ne
            // coute rien, et `ca - 0` publierait 100% de marge. Le cumul du
            // mois applique deja cette regle; le jour la manquait, et la meme
            // reponse portait alors deux verdicts opposes sur la meme journee.
            marge: mesurable ? ca - cout : null,
            cout_connu: mesurable,

            details: {
                hors_pack: {
                    vendu_kg: horsPack.kg,
                    ca_vendu: horsPack.ca,
                    prix_vente_moyen: moyen(horsPack)
                },
                pack: {
                    vendu_kg: pack.kg,
                    ca_vendu: pack.ca,
                    prix_vente_moyen: moyen(pack)
                }
            }
        };
    }

    return resultat;
}

module.exports = { calculerMarge, repartirMontantPack, SEUIL_KG, MARGE_SUPPOSEE };
