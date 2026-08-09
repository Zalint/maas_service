/**
 * Contexte commun du calcul de parage: categories, exclusions, compositions.
 *
 * Deux routes calculent le parage - l'ecran de reconciliation et l'API externe.
 * Elles doivent partir des MEMES categories et des MEMES exclusions, sinon
 * elles rendent deux chiffres pour la meme journee. Ce projet a deja paye trois
 * fois le prix d'une logique recopiee: compositions de packs dans trois
 * fichiers, deux rendus de tableau, deux totaux de parage. On ne recommence pas.
 */

// La MEME normalisation que le calcul, importee et non recopiee: trois copies
// coexistaient, toutes avec des caracteres combinants BRUTS - invisibles dans
// un editeur, et ce depot a deja perdu un fichier a un accident d'encodage.
const { normaliserNom } = require('./parage');

/**
 * @param {Object} sequelize instance Sequelize
 * @returns {Promise<{categorieDe: Function, exclusions: Set, avertissements: string[]}>}
 */
async function chargerContexteParage(sequelize) {
    const { FinanceConfig } = require('../db/models');
    const avertissements = [];

    // Produit -> bovin | ovin, depuis le catalogue.
    //
    // La comparaison ignore la casse et les accents: l'inventaire contient
    // 'Patte de mouton' la ou le catalogue dit 'Patte de Mouton', et une
    // comparaison stricte perdait la ligne.
    // La categorie EFFECTIVE d'un produit: celle qui est stockee sur lui
    // (categorie_affichage, renseignee pour l'inventaire) sinon celle de son
    // categorie_id. Un seul mecanisme, resolu a l'ECRITURE.
    //
    // C'est ce qui remplace l'ancien empilement - jointure, puis fichier
    // d'alias, puis heuristique de nom cote ecran. Trois sources pour une
    // meme question finissaient toujours par diverger, et aucune ne disait
    // laquelle avait parle.
    // L'ORDRE n'est pas decoratif. Les maps ci-dessous gardent la PREMIERE
    // ligne vue pour un nom normalise, et plusieurs lignes peuvent porter le
    // meme nom: le catalogue contient des doublons de casse ("Citron Liquide"
    // / "CITRON LIQUIDE") et un meme produit existe en 'vente' ET en
    // 'inventaire'. Sans ORDER BY, le gagnant dependait de l'ordre de
    // restitution de Postgres - six noms resolvaient vers deux categories
    // differentes selon l'execution.
    //
    // Regle d'arbitrage, alignee sur celle du reste du refactor: la categorie
    // ECRITE sur le produit prime sur celle heritee par categorie_id, puis le
    // plus petit id tranche. Deterministe, et explicable.
    const produitsCat = await sequelize.query(
        `SELECT p.nom,
                COALESCE(NULLIF(TRIM(p.categorie_affichage), ''), c.nom) AS categorie
         FROM produits p
         LEFT JOIN categories c ON c.id = p.categorie_id
         WHERE p.archived = false
           AND COALESCE(NULLIF(TRIM(p.categorie_affichage), ''), c.nom) IS NOT NULL
         ORDER BY CASE WHEN NULLIF(TRIM(p.categorie_affichage), '') IS NOT NULL
                       THEN 0 ELSE 1 END,
                  p.id`,
        { type: sequelize.QueryTypes.SELECT }
    );

    // Un meme nom normalise renvoyant PLUSIEURS categories distinctes est une
    // incoherence du catalogue, pas un cas a arbitrer en silence. L'ORDER BY
    // ci-dessus rend le choix reproductible; cet inventaire le rend VISIBLE.
    // Un arbitrage muet est exactement ce qui laisse une erreur de categorie
    // survivre des mois dans un chiffre financier.
    const categoriesVues = new Map();
    for (const r of produitsCat) {
        const cle = normaliserNom(r.nom);
        const cat = String(r.categorie || '').trim();
        if (!categoriesVues.has(cle)) categoriesVues.set(cle, new Set());
        categoriesVues.get(cle).add(cat);
    }
    const ambigus = [...categoriesVues.entries()].filter(([, s]) => s.size > 1);
    if (ambigus.length) {
        avertissements.push(
            `${ambigus.length} produit(s) portent plusieurs categories selon la ligne de `
            + `catalogue lue; la categorie ECRITE sur le produit a ete retenue: `
            + ambigus.slice(0, 6).map(([cle, s]) => `${cle} (${[...s].join(' / ')})`).join(', ')
            + (ambigus.length > 6 ? ', ...' : ''));
    }

    // bovin / ovin pour le parage. Le nom de categorie est compare en
    // minuscules: la table dit 'Bovin', le calcul attend 'bovin'.
    const parProduit = new Map();
    for (const r of produitsCat) {
        const cat = String(r.categorie || '').trim().toLowerCase();
        if (cat !== 'bovin' && cat !== 'ovin') continue;
        const cle = normaliserNom(r.nom);
        if (!parProduit.has(cle)) parProduit.set(cle, cat);
    }

    const categorieDe = (produit) => parProduit.get(normaliserNom(produit)) || null;

    // FAMILLE (Boucherie / Epicerie / Autres), portee par categories.famille.
    // C'est la notion metier qui separe la viande du reste - et elle range la
    // Volaille et le Caprin AVEC le bovin et l'ovin, ce que "bovin ou ovin"
    // ne fait pas. Les produits d'INVENTAIRE n'ont pas de categorie_id: on
    // resout par le nom normalise vers le produit du catalogue de vente, comme
    // pour la categorie.
    const parFamille = new Map();
    try {
        // famille de la CATEGORIE EFFECTIVE. La jointure se fait sur le NOM de
        // categorie et non sur categorie_id, pour que categorie_affichage -
        // qui ne porte qu'un nom - donne la meme famille que la relation.
        const famParCategorie = new Map();
        const cats = await sequelize.query(
            'SELECT nom, famille FROM categories WHERE famille IS NOT NULL',
            { type: sequelize.QueryTypes.SELECT }
        );
        for (const c of cats) famParCategorie.set(String(c.nom).trim().toLowerCase(), c.famille);

        for (const r of produitsCat) {
            const fam = famParCategorie.get(String(r.categorie || '').trim().toLowerCase());
            if (!fam) continue;
            const cle = normaliserNom(r.nom);
            if (!parFamille.has(cle)) parFamille.set(cle, fam);
        }
    } catch (e) {
        avertissements.push(`Familles de categories non chargees: ${e.message}`);
    }
    const familleDe = (produit) => parFamille.get(normaliserNom(produit)) || null;
    // Plus de repli: la categorie stockee sur le produit repond directement.
    // Un produit sans famille est un ORPHELIN, et c'est une information - pas
    // un cas a rattraper en silence par une seconde source.
    const estBoucherie = (produit) => familleDe(produit) === 'Boucherie';

    // Produits dont le stock du soir est DERIVE (mode_stock = 'automatique'):
    // soir = matin + transferts - ventes, cf db/utils.js#recomputeStockSoirForAuto.
    //
    // Leur stock ne doit JAMAIS entrer dans un theorique qu'on compare ensuite
    // aux ventes: le theorique vaut matin + transferts - soir, donc pour eux il
    // vaut exactement les ventes. On comparerait les ventes a elles-memes.
    //
    // Concretement, sans cette exclusion: le stock est tenu sous "Boeuf" (la
    // carcasse) et les ventes se font sous "Boeuf en detail" (les decoupes).
    // Compter le stock derive des decoupes ajoute leurs ventes au theorique
    // alors qu'elles sont deja au numerateur - le parage de juillet passerait
    // de 18,5% a 55%.
    const stockDerive = new Set();
    try {
        const auto = await sequelize.query(
            `SELECT nom FROM produits
             WHERE mode_stock = 'automatique' AND type_catalogue = 'inventaire'`,
            { type: sequelize.QueryTypes.SELECT }
        );
        for (const r of auto) stockDerive.add(r.nom);
    } catch (e) {
        avertissements.push(`Produits a stock derive non identifies (${e.message}): `
            + `leur stock entre dans le theorique, le parage est sous-estime.`);
    }

    // Exclusions: liste de produits retires des DEUX cotes du rapport.
    const cfg = await FinanceConfig.findOne({ where: { key: 'parage_exclusions' } });
    const exclusions = new Set(
        String((cfg && cfg.value) || '').split(',').map((s) => s.trim()).filter(Boolean)
    );

    // Famille dechet: les produits qui PORTENT le dechet de decoupe - ceux qui
    // le stockent (Déchet 400, Déchet 2000) et celui qui le vend (Dechet).
    // Leur bilan mesure le dechet PRODUIT: soir + vendu + jete - matin.
    // Configuree dans l'ecran admin du parage (finance_config.parage_dechets),
    // jamais en dur: les noms different d'un tenant a l'autre.
    //
    // Rapprochement par nom EXACT normalise, et non par prefixe comme les
    // exclusions: l'ecran coche des produits precis, la famille est fermee.
    const cfgDechets = await FinanceConfig.findOne({ where: { key: 'parage_dechets' } });
    const familleDechet = new Set(
        String((cfgDechets && cfgDechets.value) || '')
            .split(',').map((s) => normaliserNom(s)).filter(Boolean)
    );

    return { categorieDe, familleDe, estBoucherie, stockDerive, exclusions, familleDechet, avertissements };
}

module.exports = { chargerContexteParage, normaliserNom };
