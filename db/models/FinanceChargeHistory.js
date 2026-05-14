const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Historique des modifications des charges mensuelles fixes.
 * Meme pattern que prix_vente_cdc_history etc. : chaque sauvegarde
 * insere une ligne (uniquement si valeur change cote bulk save),
 * permettant de retracer l'evolution des charges fixes du tenant.
 *
 * Genesis: entree avec created_at = epoch 1970 seedee a la migration
 * pour chaque charge existante.
 */
const FinanceChargeHistory = sequelize.define('FinanceChargeHistory', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nom: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'nom'
    },
    libelle: {
        type: DataTypes.STRING(150),
        allowNull: true,
        field: 'libelle'
    },
    montant_mensuel: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        field: 'montant_mensuel'
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
    tableName: 'finance_charges_history',
    timestamps: false
});

module.exports = FinanceChargeHistory;
