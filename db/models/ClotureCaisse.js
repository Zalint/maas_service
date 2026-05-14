const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const ClotureCaisse = sequelize.define('ClotureCaisse', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: 'Date de la clôture (YYYY-MM-DD)'
    },
    point_de_vente: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'Nom du point de vente'
    },
    montant_especes: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        comment: 'Montant espèces comptées physiquement'
    },
    fond_de_caisse: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        defaultValue: 0,
        comment: 'Fond de caisse laissé pour le lendemain'
    },
    montant_estimatif: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Montant estimatif calculé (ventes - paiements Bictorys)'
    },
    montant_total_caisse: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Total espèces physiquement présentes dans la caisse à la clôture (incluant fond de caisse). Optionnel, utilisé par Finance > Cash et Stock.'
    },
    commercial: {
        type: DataTypes.STRING(150),
        allowNull: false,
        comment: 'Nom du/de la commercial(e) qui clôture'
    },
    commentaire: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Commentaire libre'
    },
    created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Username de l\'utilisateur session'
    },
    is_latest: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        comment: 'Indique si c\'est la dernière clôture du jour pour ce PdV (utilisée pour réconciliation)'
    }
}, {
    tableName: 'clotures_caisse',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['date'] },
        { fields: ['point_de_vente'] },
        { fields: ['date', 'point_de_vente'] },
        { fields: ['created_at'] }
    ]
});

module.exports = ClotureCaisse;
