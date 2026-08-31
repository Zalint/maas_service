const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * CreanceClientPaiement — chaque remboursement recu D'UN client sur ses
 * ventes a credit. Miroir reduit de FournisseurPaiement (le sens du flux est
 * invense: ici on ENCAISSE), utilise pour suivre le solde des creances
 * clients depuis un solde d'ouverture (cf lib/creances-client.js) puisqu'
 * aucun historique de remboursement n'existait avant ce suivi.
 *
 * Pas de justificatif ni de mode/reference: contrairement au fournisseur,
 * il n'y a ici qu'un flux global (pas de rapprochement par facture) - on
 * reste au plus simple tant que le besoin ne se precise pas.
 */
const CreanceClientPaiement = sequelize.define('CreanceClientPaiement', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    date: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    montant: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false
    },
    commentaire: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'created_by'
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at'
    }
}, {
    tableName: 'creance_client_paiements',
    timestamps: false
});

module.exports = CreanceClientPaiement;
