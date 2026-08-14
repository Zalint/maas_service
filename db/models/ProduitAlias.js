const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * ProduitAlias — mapping explicite d'un libelle de vente (tel que saisi
 * dans le POS, ex: "Boeuf en gros", "Boeuf en détail", "Boeuf En Gros")
 * vers une entree du catalogue prix `fournisseur_prix.produit`.
 *
 * Remplace le matching prefix (startsWith) qui etait fragile. Lookup
 * order dans routes/finance-creances.js#computeCreances :
 *   1. match exact sur fournisseur_prix.produit
 *   2. resolution via produit_alias.alias_produit -> produit_catalog
 *   3. fallback prefix (a phase out)
 *
 * Gere depuis l'UI Mapping produits (5eme sous-onglet Finance).
 *
 * ON DELETE CASCADE en BDD: supprimer une ligne du catalogue retire
 * automatiquement ses aliases.
 */
const ProduitAlias = sequelize.define('ProduitAlias', {
    alias_produit: {
        type: DataTypes.STRING(150),
        primaryKey: true,
        field: 'alias_produit'
    },
    produit_catalog: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'produit_catalog'
    },
    /**
     * Combien d'unites de l'entree catalogue vaut UNE unite du libelle de
     * vente. Conversion d'unite, PAS imputation de cout: la carcasse est
     * achetee une seule fois, sous « Boeuf », et sa commission avec elle.
     *
     *   1    le libelle se compte comme la carcasse (« Boeuf en detail », au kilo)
     *   0.5  un Jarret se vend a la PIECE et pese environ 500 g
     */
    coefficient: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        defaultValue: 1,
        field: 'coefficient'
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'produit_alias',
    timestamps: false
});

module.exports = ProduitAlias;
