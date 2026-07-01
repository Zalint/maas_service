const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * LivreurConfig — table cle/valeur (JSONB) pour la config des livreurs
 * (ecran kanban SUIVI DES COMMANDES + envoi vers l'API de livraison externe).
 * Cles connues:
 *   - api_url          URL du backend livreur (matix-livreur-backend), string | null
 *   - livreurs_actifs  liste des noms de livreurs actifs, array de strings
 *
 * Remplace l'ancien fichier livreurs_actifs.json (FS ephemere sur Render).
 * value est JSONB: Sequelize (de)serialise automatiquement (pas de getter/setter).
 * Cree/seede par db/update-schema.js (comme finance_config), par schema tenant.
 */
const LivreurConfig = sequelize.define('LivreurConfig', {
    key: {
        type: DataTypes.STRING(50),
        primaryKey: true
    },
    value: {
        type: DataTypes.JSONB,
        allowNull: false
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'livreur_config',
    timestamps: false
});

module.exports = LivreurConfig;
