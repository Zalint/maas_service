/**
 * Contexte commun du calcul de parage: categories, exclusions, compositions.
 *
 * Deux routes calculent le parage - l'ecran de reconciliation et l'API externe.
 * Elles doivent partir des MEMES categories et des MEMES exclusions, sinon
 * elles rendent deux chiffres pour la meme journee. Ce projet a deja paye trois
 * fois le prix d'une logique recopiee: compositions de packs dans trois
 * fichiers, deux rendus de tableau, deux totaux de parage. On ne recommence pas.
 */

const normaliserNom = (nom) => String(nom || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

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
    const produitsCat = await sequelize.query(
        `SELECT p.nom, LOWER(c.nom) AS categorie
         FROM produits p JOIN categories c ON c.id = p.categorie_id
         WHERE LOWER(c.nom) IN ('bovin', 'ovin')`,
        { type: sequelize.QueryTypes.SELECT }
    );
    const parProduit = new Map(produitsCat.map((r) => [normaliserNom(r.nom), r.categorie]));

    // Puis les alias de config, pour les noms d'inventaire que le catalogue ne
    // categorise pas ('Boeuf', 'Veau'). Sans eux, le stock de viande n'etait
    // rattache a rien: denominateur nul alors que des dizaines de kilos etaient
    // vendus. Le catalogue reste prioritaire.
    try {
        const alias = require('../config/parage-categories.json').aliases || {};
        for (const [nom, cat] of Object.entries(alias)) {
            const cle = normaliserNom(nom);
            if (!parProduit.has(cle)) parProduit.set(cle, cat);
        }
    } catch (e) {
        avertissements.push(`Alias de categories non charges: ${e.message}`);
    }

    const categorieDe = (produit) => parProduit.get(normaliserNom(produit)) || null;

    // Exclusions: liste de produits retires des DEUX cotes du rapport.
    const cfg = await FinanceConfig.findOne({ where: { key: 'parage_exclusions' } });
    const exclusions = new Set(
        String((cfg && cfg.value) || '').split(',').map((s) => s.trim()).filter(Boolean)
    );

    return { categorieDe, exclusions, avertissements };
}

module.exports = { chargerContexteParage, normaliserNom };
