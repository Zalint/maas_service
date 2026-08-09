const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * PlSnapshot — photo figee du PL, une par date (la derniere ecrase).
 *
 * La periode figee est celle de l'ecran par defaut: du 1er du mois au jour
 * du snapshot. Ecrite par le bouton "Figer le PL du jour" (source manuel)
 * et par le cron du soir de 23h35 (source cron), qui passent tous deux par
 * le MEME calcul que l'ecran (routes/finance.js#computePl).
 *
 * payload = la reponse complete de /api/finance/pl telle quelle: le bouton
 * Historique re-rend un snapshot avec le meme code d'affichage que le PL
 * courant, et l'export Excel fonctionne dessus sans conversion.
 */
const PlSnapshot = sequelize.define('PlSnapshot', {
    date: {
        type: DataTypes.DATEONLY,
        primaryKey: true
    },
    periode_debut: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'periode_debut'
    },
    periode_fin: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'periode_fin'
    },
    pl: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: false
    },
    total_ventes: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
        field: 'total_ventes'
    },
    source: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'manuel'
    },
    created_by: {
        type: DataTypes.STRING(150),
        allowNull: true,
        field: 'created_by'
    },
    payload: {
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
    tableName: 'pl_snapshots',
    timestamps: false
});

module.exports = PlSnapshot;
