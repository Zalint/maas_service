const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Charges mensuelles fixes utilisées pour le calcul du PL (Profit/Loss).
 * Au prorata des jours linéaires (30 jours conventionnels).
 *
 * Editables depuis l'UI Finance > Charges. Defaults seedés a la
 * migration: Masse salariale, Loyer, Électricité, Internet.
 */
const FinanceCharge = sequelize.define('FinanceCharge', {
    nom: {
        type: DataTypes.STRING(100),
        primaryKey: true,
        field: 'nom'
    },
    libelle: {
        type: DataTypes.STRING(150),
        allowNull: false,
        field: 'libelle'
    },
    montant_mensuel: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'montant_mensuel'
    },
    ordre: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'ordre'
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'finance_charges',
    timestamps: false
});

module.exports = FinanceCharge;
