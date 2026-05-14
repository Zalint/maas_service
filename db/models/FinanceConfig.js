const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * FinanceConfig — table cle/valeur pour les parametres de l'onglet Finance.
 * Cles connues:
 *   - commission_pct           pourcentage de commission fournisseur (defaut "3.0")
 *   - categories_eligibles     liste CSV des categories de Vente prises en
 *                              compte pour le calcul de commission
 *                              (defaut "Bovin,Ovin,Caprin,Volaille,Poisson")
 */
const FinanceConfig = sequelize.define('FinanceConfig', {
    key: {
        type: DataTypes.STRING(50),
        primaryKey: true
    },
    value: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'finance_config',
    timestamps: false
});

module.exports = FinanceConfig;
