const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * PosConfig — table cle/valeur (JSONB) pour les settings pilotant l'affichage
 * du POS, par tenant (schema courant).
 * Cles connues:
 *   - boucherie_categories  array ordonne des categories affichees sous
 *                           "Boucherie" dans le POS (pilote les chips + l'ordre)
 *
 * value est JSONB: Sequelize (de)serialise automatiquement.
 * Cree/seede par db/update-schema.js (comme livreur_config / finance_config).
 */
const PosConfig = sequelize.define('PosConfig', {
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
    tableName: 'pos_config',
    timestamps: false
});

module.exports = PosConfig;
