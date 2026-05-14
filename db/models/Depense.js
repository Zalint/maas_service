const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Depense — entrees comptables saisies depuis l'onglet Finance.
 * Le justificatif est stocke en binaire dans la BDD (pas de filesystem,
 * Render etant ephemere). Types autorises cote upload: JPEG/PNG/PDF/DOC/DOCX.
 */
const Depense = sequelize.define('Depense', {
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
    categorie: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    description: {
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
    tableName: 'depenses',
    timestamps: false
});

module.exports = Depense;
