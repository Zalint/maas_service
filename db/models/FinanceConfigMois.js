const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Valeur d'un parametre de Finance pour un mois donne.
 *
 * finance_config porte la valeur courante, qui sert d'ancrage; cette table
 * porte les valeurs DATEES. Meme mecanique que finance_charges_mois:
 *
 *   1. la ligne la plus recente avec mois <= M pour cette cle;
 *   2. a defaut, finance_config.value.
 *
 * Utilisee aujourd'hui pour stock_pertes_decoupe_pct. La table est volontairement
 * generique (colonne `key`) pour qu'y ajouter un autre parametre ne demande
 * pas une nouvelle table.
 *
 * Non seedee: sans ligne, la resolution rend la valeur courante, donc les PL
 * anterieurs a toute saisie mensuelle sont inchanges.
 */
const FinanceConfigMois = sequelize.define('FinanceConfigMois', {
    // 'YYYY-MM'. Texte: l'ordre lexicographique vaut l'ordre chronologique.
    mois: {
        type: DataTypes.STRING(7),
        primaryKey: true,
        allowNull: false,
        field: 'mois'
    },
    key: {
        type: DataTypes.STRING(60),
        primaryKey: true,
        allowNull: false,
        field: 'key'
    },
    value: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'value'
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'finance_config_mois',
    timestamps: false
});

module.exports = FinanceConfigMois;
