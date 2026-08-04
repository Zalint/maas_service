const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Montant d'une charge fixe pour un mois donne.
 *
 * finance_charges porte le catalogue (libelle, ordre) et le montant courant.
 * Cette table porte les montants DATES: une ligne par (mois, charge).
 *
 * Resolution pour un mois M (cf resolveChargesPourMois dans routes/finance.js):
 *   1. la ligne la plus recente avec mois <= M pour cette charge;
 *   2. a defaut, finance_charges.montant_mensuel (valeur courante).
 *
 * Le report en avant est voulu: une charge saisie pour 2026-07 vaut aussi
 * pour aout, septembre... jusqu'a la prochaine saisie. Sans cela il faudrait
 * ressaisir les quatre charges chaque mois.
 *
 * Le repli sur finance_charges garantit qu'un PL anterieur a la premiere
 * saisie mensuelle rend exactement le meme resultat qu'avant cette table.
 */
const FinanceChargeMois = sequelize.define('FinanceChargeMois', {
    // 'YYYY-MM'. Texte et non DATE: l'ordre lexicographique vaut l'ordre
    // chronologique, et la comparaison mois <= M est directe.
    mois: {
        type: DataTypes.STRING(7),
        primaryKey: true,
        allowNull: false,
        field: 'mois'
    },
    nom: {
        type: DataTypes.STRING(100),
        primaryKey: true,
        allowNull: false,
        field: 'nom'
    },
    montant_mensuel: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'montant_mensuel'
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'finance_charges_mois',
    timestamps: false
});

module.exports = FinanceChargeMois;
