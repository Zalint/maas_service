const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Historique point-in-time des modifications de
 * fournisseur_prix.prix_achat.
 *
 * Meme pattern que PrixVenteCdcHistory: chaque sauvegarde insere une
 * ligne; le calcul de marge resout le prix_achat effectif a la date
 * de la vente (= derniere entree history avec created_at <= vente_date).
 *
 * Genesis: une entree avec created_at = epoch 1970 est seedee au moment
 * de la migration pour garantir qu'aucune vente n'a besoin de fallback.
 */
const PrixAchatHistory = sequelize.define('PrixAchatHistory', {
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
    prix_achat: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        field: 'prix_achat'
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
    tableName: 'prix_achat_history',
    timestamps: false
});

module.exports = PrixAchatHistory;
