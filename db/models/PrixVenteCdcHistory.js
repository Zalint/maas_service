const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Historique des modifications de fournisseur_prix.prix_vente_cdc.
 * Chaque sauvegarde depuis l'UI Finance > Centre de Decoupe insere
 * une ligne avec la nouvelle valeur + qui l'a fait. Permet de
 * retracer les renegociations B2B du prix convenu avec le centre.
 *
 * Note: on stocke la NOUVELLE valeur apres save (pas l'ancienne).
 * La sequence chronologique des created_at donne l'historique complet.
 *
 * FK CASCADE: si un produit disparait du catalogue, son historique
 * disparait avec lui (cf produit_alias).
 */
const PrixVenteCdcHistory = sequelize.define('PrixVenteCdcHistory', {
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
    prix_vente_cdc: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        field: 'prix_vente_cdc'
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
    tableName: 'prix_vente_cdc_history',
    timestamps: false
});

module.exports = PrixVenteCdcHistory;
