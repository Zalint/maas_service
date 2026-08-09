/**
 * Parage (perte de decoupe) par categorie, pour un jour et un point de vente.
 *
 *   rendement = ventesNombreAjustePack / ventesTheoriquesNombre
 *   parage    = 1 - rendement          <- c'est la PERTE, ce qu'on affiche
 *
 * avec, EN QUANTITE et non en valeur:
 *   ventesTheoriquesNombre = stock matin + transferts - stock soir
 *   ventesNombreAjustePack = quantite vendue + quantite contenue dans les
 *                            packs vendus
 *
 * Deux colonnes sont produites: 'bovin' et 'ovin'. Boeuf et veau sont
 * interchangeables et tombent tous deux dans 'bovin'.
 *
 * Les produits exclus (reglage ADMIN) sortent des DEUX cotes du rapport:
 * retirer un produit du stock theorique sans le retirer des ventes
 * comparerait deux perimetres differents. Cela vaut aussi pour les kilos
 * venant des packs.
 *
 * Module sans dependance: la resolution produit -> categorie est fournie par
 * l'appelant, ce qui rend le calcul testable sans base.
 */

const CATEGORIES = ['bovin', 'ovin'];

// L'inventaire et le catalogue n'ecrivent pas les noms de la meme facon
// ('Patte de mouton' contre 'Patte de Mouton'). La resolution de categorie
// normalise deja; les exclusions doivent le faire AUSSI, sinon un produit
// sort d'un seul cote du rapport - exactement le perimetre asymetrique que
// cette fonctionnalite existe pour empecher.
function normaliserNom(nom) {
    return String(nom || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim().toLowerCase();
}

// Une composition de pack s'exprime en kg, en piece (avec un poids unitaire)
// ou en tablette. Seul le poids nous interesse: une tablette d'oeufs n'a pas
// d'equivalent en kilos de viande, et de toute facon l'oeuf n'est ni bovin ni
// ovin, donc la ligne est ecartee en amont par la categorie.
// Unites acceptees. 'tablette' vaut deliberement 0 kg (des oeufs ne sont ni
// bovin ni ovin), mais elle est CONNUE: une unite hors de cette liste est une
// faute de frappe, et quantiteEnKg rendrait 0 sans rien signaler - donc un
// theorique sous-estime et un parage faux, silencieusement.
const UNITES_CONNUES = ['kg', 'piece', 'pièce', 'tablette'];

// Un gramme. En dessous, il n'y a rien a mesurer: les stocks se saisissent au
// dixieme de kilo, et une difference plus petite ne peut etre qu'un residu de
// virgule flottante. Comparer a zero laissait passer 5.55e-17, qui s'affichait
// "0 kg" tout en produisant un parage de 100%.
const SEUIL_KG = 0.001;

function quantiteEnKg(composant) {
    const quantite = parseFloat(composant && composant.quantite) || 0;
    if (quantite <= 0) return 0;

    const unite = String((composant && composant.unite) || '').toLowerCase();
    if (unite === 'kg') return quantite;
    if (unite === 'piece' || unite === 'pièce') {
        const poids = parseFloat(composant.poids_unitaire);
        // Sans poids unitaire connu, on ne peut pas convertir: on prefere ne
        // rien compter plutot que d'inventer un poids et fausser le ratio.
        return Number.isFinite(poids) && poids > 0 ? quantite * poids : 0;
    }
    return 0; // tablette, ou unite inconnue
}

function ligneProduit(acc, cat, produit) {
    const p = acc[cat].parProduit;
    if (!p[produit]) {
        p[produit] = {
            matin: 0, transferts: 0, soir: 0, theorique: 0,
            venduDirect: 0, venduPack: 0, vendu: 0
        };
    }
    return p[produit];
}

function creerAccumulateur() {
    const acc = {};
    for (const c of CATEGORIES) {
        // matin / transferts / soir sont conserves separement, en plus de leur
        // somme: l'export de detail en a besoin ligne a ligne, et un theorique
        // seul ne permet pas de voir LAQUELLE des trois saisies manque quand
        // le chiffre parait faux.
        acc[c] = {
            matin: 0, transferts: 0, soir: 0,
            theorique: 0, vendu: 0, ratio: null, perte: null,
            // Bilan de la FAMILLE dechet (les produits qui portent le dechet
            // de decoupe: son stock, sa vente, son jete). Le dechet a QUATRE
            // mouvements, pas deux - il est produit par la decoupe, vendu,
            // jete, ou reste en stock - et la formule matin + transferts - soir
            // rendait des ventes negatives des qu'on en produisait plus qu'on
            // n'en sortait. Son bilan se ferme donc a part:
            //   produit = soir + vendu + jete - matin - transferts
            // et vient decomposer la perte globale en parage reel (dechet
            // produit) + deperdition inexpliquee.
            dechet: { matin: 0, transferts: 0, soir: 0, vendu: 0, jete: 0, produit: 0 },
            taux_dechet: null, taux_deperdition: null,
            // Detail par produit, indispensable au calcul de marge: le prix
            // d'achat n'est pas le meme pour tous les produits d'une categorie
            // (le foie a le sien, le reste suit celui du boeuf), et le prix de
            // vente moyen doit etre pondere par ce qui a REELLEMENT ete vendu.
            // Une categorie agregee ne permet ni l'un ni l'autre.
            //
            // vendu est aussi ventile selon son ORIGINE: une vente directe
            // porte son propre montant, alors qu'un pack a un montant unique a
            // repartir entre ses composants. Les deux ne se ponderent pas de
            // la meme facon, et les melanger rendrait le prix moyen ininspectable.
            parProduit: {}
        };
    }
    return acc;
}

/**
 * @param {Object} args
 * @param {Array}  args.stocksMatin   [{ pointVente, produit, quantite }]
 * @param {Array}  args.stocksSoir    idem
 * @param {Array}  args.transferts    [{ pointVente, produit, quantite, impact }]
 * @param {Array}  args.ventes        [{ pointVente, produit, nombre, extension }]
 * @param {Function} args.categorieDe (produit) => 'bovin' | 'ovin' | null
 * @param {Set}    [args.exclusions]  noms de produits a ignorer des deux cotes
 * @param {Set}    [args.stockDerive] noms de produits dont le stock est CALCULE
 *   a partir des ventes (mode automatique). Leur stock est ignore, leurs ventes
 *   sont conservees. Voir le commentaire de `stockIgnore` plus bas.
 * @param {Object} [args.packs]       compositions par defaut, { [nomPack]: [composants] }
 * @returns {Object} { [pointVente]: { bovin: {theorique,vendu,ratio}, ovin: {...} } }
 */
function calculerParage(args) {
    const {
        stocksMatin = [],
        stocksSoir = [],
        transferts = [],
        ventes = [],
        categorieDe,
        exclusions = new Set(),
        stockDerive = new Set(),
        familleDechet = new Set(),
        packs = {}
    } = args || {};

    const parPv = {};
    const pour = (pv) => {
        if (!parPv[pv]) parPv[pv] = creerAccumulateur();
        return parPv[pv];
    };
    // Une exclusion vaut pour le produit qui porte ce nom ET pour ceux qui le
    // prolongent par un mot: "Dechet" ecarte "Déchet 400" et "Déchet 2000".
    //
    // L'egalite stricte ne les attrapait pas. Il existe un produit nomme
    // "Dechet", que la liste visait a l'epoque; "Déchet 400" et "Déchet 2000"
    // ont ete crees plus tard sans que la liste suive. Resultat: 446 kg de
    // parage pese entraient dans le stock du soir, donc SORTAIENT du theorique,
    // et le taux affiche tombait a 2,0% la ou il vaut 3,8%.
    //
    // La limite de mot est deliberee: sans elle, "Yell" ecarterait un futur
    // "Yellowfin". Un prefixe ne vaut que suivi d'un espace.
    const exclusionsNormalisees = Array.from(exclusions || [])
        .map(normaliserNom)
        .filter(Boolean);
    const exclu = (produit) => {
        const cle = normaliserNom(produit);
        return exclusionsNormalisees.some((e) => cle === e || cle.startsWith(e + ' '));
    };

    // Exclusion ASYMETRIQUE, et c'est voulu.
    //
    // La regle generale de ce module est qu'un produit sort des DEUX cotes du
    // rapport, sans quoi on compare deux perimetres. Une seule exception: les
    // produits dont le stock du soir est CALCULE a partir des ventes
    // (mode automatique, cf db/utils.js#recomputeStockSoirForAuto).
    //
    // Pour eux, theorique = matin + transferts - soir vaut exactement les
    // ventes: leur inclure le stock revient a comparer les ventes a
    // elles-memes. Pire, la marchandise entre en stock sous un nom ("Boeuf",
    // la carcasse) et en sort sous un autre ("Boeuf en detail", les decoupes):
    // compter le stock derive des decoupes ajoute leurs ventes au theorique
    // alors qu'elles sont deja au numerateur.
    //
    // On ignore donc leur STOCK et on garde leurs VENTES. Le perimetre commun
    // reste la categorie - c'est elle qui relie la carcasse a ses decoupes.
    const stockDeriveNormalise = new Set(
        Array.from(stockDerive || []).map(normaliserNom)
    );
    const stockIgnore = (produit) => stockDeriveNormalise.has(normaliserNom(produit));

    // La FAMILLE dechet (config admin parage_dechets): rapprochement par nom
    // EXACT normalise, pas par prefixe - l'ecran coche des produits precis.
    // L'appartenance vaut retrait du flux principal, meme si l'utilisateur
    // retire ces produits de la liste d'exclusions: sans quoi le meme kilo
    // entrerait dans le theorique ET dans le bilan dechet, compte deux fois.
    const familleNormalisee = new Set(
        Array.from(familleDechet || []).map(normaliserNom)
    );
    const estDechet = (produit) => familleNormalisee.has(normaliserNom(produit));
    // Un transfert marque "jete" n'est PAS un mouvement de marchandise: c'est
    // la pesee du dechet mis a la poubelle (extension.dechet_jete, pose par la
    // case a cocher de l'ecran des transferts).
    const estJete = (t) => !!(t && t.extension && t.extension.dechet_jete);

    // --- Denominateur ---------------------------------------------------
    for (const s of stocksMatin) {
        // La famille dechet se teste AVANT les exclusions: ses membres sont
        // presque toujours aussi exclus, et l'exclusion les ferait disparaitre
        // avant que leur bilan ne les voie.
        if (estDechet(s.produit)) {
            const cat = categorieDe(s.produit);
            if (cat) pour(s.pointVente)[cat].dechet.matin += parseFloat(s.quantite) || 0;
            continue;
        }
        if (exclu(s.produit)) continue;
        if (stockIgnore(s.produit)) continue;
        const cat = categorieDe(s.produit);
        if (!cat) continue;
        const q = parseFloat(s.quantite) || 0;
        const acc = pour(s.pointVente);
        acc[cat].matin += q;
        acc[cat].theorique += q;
        const l = ligneProduit(acc, cat, s.produit);
        l.matin += q;
        l.theorique += q;
    }

    for (const t of transferts) {
        // Le signe vient d'impact: transferts.quantite est toujours positive.
        const impact = parseInt(t.impact, 10);
        const signe = Number.isFinite(impact) ? impact : 1;
        const q = signe * (parseFloat(t.quantite) || 0);

        if (estDechet(t.produit)) {
            const cat = categorieDe(t.produit);
            if (!cat) continue;
            const bilan = pour(t.pointVente)[cat].dechet;
            // Jete: sortie sans recette, comptee en valeur absolue. Un vrai
            // transfert de dechet vers un autre point de vente reste un
            // mouvement du bilan, signe comme les autres.
            if (estJete(t)) bilan.jete += Math.abs(q);
            else bilan.transferts += q;
            continue;
        }
        if (estJete(t)) {
            // Marchandise jetee et PESEE (de la viande a la poubelle, hors
            // famille dechet): ce n'est pas un mouvement de marchandise, le
            // theorique ne doit pas baisser - sinon cocher "jete" ferait
            // disparaitre la perte du parage. La pesee compte comme dechet
            // PRODUIT: c'est une perte expliquee, elle passe du cote parage
            // de la decomposition et sort de la deperdition.
            if (exclu(t.produit)) continue;
            const cat = categorieDe(t.produit);
            if (!cat) continue;
            pour(t.pointVente)[cat].dechet.jete += Math.abs(q);
            continue;
        }
        if (exclu(t.produit)) continue;
        if (stockIgnore(t.produit)) continue;
        const cat = categorieDe(t.produit);
        if (!cat) continue;
        const acc = pour(t.pointVente);
        acc[cat].transferts += q;
        acc[cat].theorique += q;
        const l = ligneProduit(acc, cat, t.produit);
        l.transferts += q;
        l.theorique += q;
    }

    for (const s of stocksSoir) {
        if (estDechet(s.produit)) {
            const cat = categorieDe(s.produit);
            if (cat) pour(s.pointVente)[cat].dechet.soir += parseFloat(s.quantite) || 0;
            continue;
        }
        if (exclu(s.produit)) continue;
        if (stockIgnore(s.produit)) continue;
        const cat = categorieDe(s.produit);
        if (!cat) continue;
        const q = parseFloat(s.quantite) || 0;
        const acc = pour(s.pointVente);
        acc[cat].soir += q;
        acc[cat].theorique -= q;
        const l = ligneProduit(acc, cat, s.produit);
        l.soir += q;
        l.theorique -= q;
    }

    // --- Numerateur -----------------------------------------------------
    for (const v of ventes) {
        const nombre = parseFloat(v.nombre) || 0;
        const composition = compositionDuPack(v, packs);

        if (!composition) {
            // Vente ordinaire.
            if (estDechet(v.produit)) {
                // La vente de dechet est du chiffre d'affaires (PL), mais pas
                // de la viande vendue: elle nourrit le bilan dechet, jamais le
                // numerateur du parage.
                const cat = categorieDe(v.produit);
                if (cat) pour(v.pointVente)[cat].dechet.vendu += nombre;
                continue;
            }
            if (exclu(v.produit)) continue;
            const cat = categorieDe(v.produit);
            if (!cat) continue;
            const acc = pour(v.pointVente);
            acc[cat].vendu += nombre;
            const l = ligneProduit(acc, cat, v.produit);
            l.venduDirect += nombre;
            l.vendu += nombre;
            continue;
        }

        // Vente de pack: on repartit son contenu entre les categories.
        // `nombre` est le NOMBRE DE PACKS, chaque composant est donc
        // multiplie par ce nombre.
        for (const composant of composition) {
            // Meme routage que la vente directe, et dans le meme ordre
            // (appartenance AVANT exclusion): un composant de la famille
            // dechet nourrit le bilan dechet, jamais le numerateur du parage
            // - sinon le meme kilo compterait comme viande vendue alors que
            // son stock n'est pas dans le theorique.
            if (estDechet(composant.produit)) {
                const catDechet = categorieDe(composant.produit);
                const kgDechet = quantiteEnKg(composant);
                if (catDechet && kgDechet > 0) {
                    pour(v.pointVente)[catDechet].dechet.vendu += kgDechet * nombre;
                }
                continue;
            }
            if (exclu(composant.produit)) continue;
            const cat = categorieDe(composant.produit);
            if (!cat) continue;
            const kg = quantiteEnKg(composant);
            if (kg <= 0) continue;
            const acc = pour(v.pointVente);
            acc[cat].vendu += kg * nombre;
            const l = ligneProduit(acc, cat, composant.produit);
            l.venduPack += kg * nombre;
            l.vendu += kg * nombre;
        }
    }

    // --- Ratio ----------------------------------------------------------
    for (const acc of Object.values(parPv)) {
        for (const cat of CATEGORIES) {
            const d = acc[cat];
            // Comparaison a un SEUIL et non a zero.
            //
            // theorique = matin + transferts - soir. Quand le stock du soir
            // egale celui du matin mais n'a pas ete saisi avec le meme
            // decoupage - plusieurs lignes le matin, une seule le soir - la
            // soustraction laisse un residu de virgule flottante:
            //   0.1 + 0.2 - 0.3 = 5.55e-17
            // Ce residu est > 0, donc le ratio valait 0/5.55e-17 = 0 et le
            // parage 100%, affiche en rouge, sur une journee ou RIEN n'avait
            // bouge. L'infobulle annoncait "0 kg / 0 kg = 100%", ce qui etait
            // vrai a l'affichage et faux dans la machine.
            //
            // Au-dela du seuil, un theorique sans vente donne bien 100% - et
            // cette valeur doit rester VISIBLE: des kilos sont sortis sans
            // qu'aucune vente ne soit enregistree. C'est le signal d'un vol ou
            // d'une saisie manquante, pas du bruit a masquer.
            const t = tauxDePerte(d.vendu, d.theorique);
            d.ratio = t.ratio;
            d.perte = t.perte;

            // Bilan dechet: ce que la decoupe a PRODUIT. Les quatre mouvements
            // se ferment - jamais de vente negative, contrairement a l'ancienne
            // lecture matin + transferts - soir qui n'en connaissait que deux.
            const b = d.dechet;
            b.produit = b.soir + b.vendu + b.jete - b.matin - b.transferts;

            // Decomposition de la perte globale, au MEME denominateur que le
            // taux principal pour que les pourcentages s'additionnent:
            //   perte = taux_dechet + taux_deperdition, exactement.
            // La deperdition peut sortir NEGATIVE - plus de dechet pese que de
            // perte globale. C'est le signal d'une pesee decalee d'un jour ou
            // d'un mouvement manquant: on l'affiche, on ne le rabote pas a
            // zero. Une decomposition qui ne peut jamais accuser ses donnees
            // ne sert a rien.
            d.taux_dechet = d.theorique > SEUIL_KG ? b.produit / d.theorique : null;
            d.taux_deperdition = (d.perte === null || d.taux_dechet === null)
                ? null
                : d.perte - d.taux_dechet;
        }
    }

    return parPv;
}

// Produits VERROUILLES: jamais excluables du parage, jamais membres de la
// famille dechet. En dur, et c'est voulu.
//
// "Boeuf" est la carcasse: c'est sous ce nom que le stock entre, il porte
// l'essentiel du denominateur. L'exclure - un clic dans l'ecran admin -
// effondrerait le parage sans message d'erreur, et le prefixe aggraverait
// tout: exclure "Boeuf" exclurait aussi "Boeuf en detail" et "Boeuf en gros"
// par la regle du prefixe de mot.
//
// Le verrou compare le nom EXACT normalise: "Boeuf sur pied" reste excluable
// (il l'est deja sur les quatre tenants), seul "Boeuf" est bloque.
const PRODUITS_VERROUILLES = ['Boeuf'];
const verrouillesNormalises = PRODUITS_VERROUILLES.map(normaliserNom);
function estProduitVerrouille(nom) {
    return verrouillesNormalises.includes(normaliserNom(nom));
}

/**
 * Rendement et perte d'un couple (vendu, theorique), avec le seuil du gramme.
 *
 * C'est LA definition du taux de parage, ecrite une seule fois. Elle existait
 * en cinq exemplaires - ici, deux fois dans parage-periode.js, et deux fois
 * cote client dans script.js (cartes du mois, export Excel) - chacun avec sa
 * copie du seuil et son commentaire "meme seuil qu'en lib/parage.js" qui
 * documentait la duplication sans l'empecher. Cinq copies d'une formule
 * finissent toujours par diverger, et un ecran du mois qui contredit l'ecran
 * du jour ne se debogue pas.
 *
 * ratio et perte valent null - jamais 0 - quand le theorique est sous le
 * seuil: un residu de virgule flottante (0.1 + 0.2 - 0.3 = 5.55e-17) rendait
 * un parage de 100% sur une journee ou rien n'avait bouge. Au-dela du seuil,
 * un theorique sans vente donne bien 100%, et cette valeur doit rester
 * VISIBLE: des kilos sont sortis sans qu'aucune vente ne soit enregistree.
 */
function tauxDePerte(vendu, theorique) {
    const t = parseFloat(theorique) || 0;
    const v = parseFloat(vendu) || 0;
    // Le parage est une PERTE: ce qui est sorti du stock sans etre vendu.
    // Un rendement de 96,6% se lit donc 3,4% de parage.
    const ratio = t > SEUIL_KG ? v / t : null;
    return { ratio, perte: ratio === null ? null : 1 - ratio };
}

/**
 * Composition d'une vente de pack, ou null si ce n'en est pas un.
 * Priorite a la composition enregistree avec la vente; a defaut la
 * composition par defaut du pack.
 */
function compositionDuPack(vente, packs) {
    const ext = vente && vente.extension;
    if (ext && Array.isArray(ext.composition) && ext.composition.length) {
        return ext.composition;
    }
    // Rapprochement NORMALISE, comme partout ailleurs dans ce module. C'etait
    // le seul acces par cle brute: "Pack25000" et "PACK25000" ne trouvaient pas
    // la meme composition, et une vente de pack non reconnue n'est pas eclatee
    // en ses composants - elle disparait du numerateur du parage sans le dire.
    if (!packs) return null;
    const cible = normaliserNom(vente && vente.produit);
    let parDefaut = packs[vente && vente.produit];
    if (!Array.isArray(parDefaut) || !parDefaut.length) {
        for (const [nom, composition] of Object.entries(packs)) {
            if (normaliserNom(nom) === cible) { parDefaut = composition; break; }
        }
    }
    return Array.isArray(parDefaut) && parDefaut.length ? parDefaut : null;
}

// Le meme module sert Node (Jest, serveur) ET le navigateur: les cartes de
// parage du mois et l'export Excel recalculaient la formule cote client avec
// leur propre copie du seuil. Ce fichier n'a aucune dependance, il se charge
// donc tel quel par une balise <script> (index.html), et script.js lit
// window.parageLib au lieu de recopier. Chaque export est garde: `module`
// n'existe pas dans un navigateur, `window` n'existe pas dans Node.
const parageExports = {
    calculerParage, quantiteEnKg, compositionDuPack, normaliserNom,
    tauxDePerte, estProduitVerrouille, PRODUITS_VERROUILLES,
    CATEGORIES, UNITES_CONNUES, SEUIL_KG
};
if (typeof module !== 'undefined' && module.exports) {
    module.exports = parageExports;
}
if (typeof window !== 'undefined') {
    window.parageLib = parageExports;
}
