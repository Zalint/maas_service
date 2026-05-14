const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Historique point-in-time des modifications de
 * fournisseur_prix.prix_vente (prix vente catalogue fournisseur).
 *
 * Sert au calcul de commission 3% sur les ventes boucherie :
 * dette = commission_pct * prix_vente_effective * qte. Chaque vente
 * resout le prix_vente effectif a sa date pour ne pas re-ecrire le
 * passe en cas de modification.
 *
 * Genesis: entry avec created_at = epoch 1970 seedee a la migration.
 */
const PrixVenteHistory = sequelize.define('PrixVenteHistory', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    produit: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'produit'
    },
    prix_vente: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        field: 'prix_vente'
    },
    changed_by: {
        type: DataTypes.STRING(150),
        allowNull: true,
        field: 'changed_by'
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at'
    }
}, {
    tableName: 'prix_vente_history',
    timestamps: false
});

module.exports = PrixVenteHistory;
