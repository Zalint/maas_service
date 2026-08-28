const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * FournisseurPaiement — chaque versement effectue AU fournisseur. Permet
 * de calculer "ce que je dois encore" = creances - sum(paiements) sur la
 * periode. Inclus dans la reponse de l'API publique /api/external/creance.
 *
 * Le justificatif est stocke en binaire dans la BDD, meme choix que Depense
 * (pas de filesystem, Render etant ephemere). Types autorises cote upload:
 * JPEG/PNG/PDF/DOC/DOCX.
 */
const FournisseurPaiement = sequelize.define('FournisseurPaiement', {
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
    mode: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    reference: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    commentaire: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    justificatif_filename: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: 'justificatif_filename'
    },
    justificatif_mime: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'justificatif_mime'
    },
    justificatif_data: {
        type: DataTypes.BLOB('long'),
        allowNull: true,
        field: 'justificatif_data'
    },
    justificatif_size: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'justificatif_size'
    },
    hors_boucherie: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'hors_boucherie'
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
    tableName: 'fournisseur_paiements',
    timestamps: false
});

module.exports = FournisseurPaiement;
