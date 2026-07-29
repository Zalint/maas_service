const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * GrosClient — clients importants du point de vente (restaurants, bouchers,
 * traiteurs, ambassadrices...). Configures dans ADMIN > Gros clients, et
 * proposes dans le POS via la case "Gros client" du modal de paiement pour
 * preremplir nom/telephone/adresse en un clic.
 *
 * Table par tenant (schema-per-tenant). Seed initial par tenant dans
 * db/update-schema.js (uniquement si la table est vide).
 */
const GrosClient = sequelize.define('GrosClient', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nom: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    telephone: {
        // STRING et pas INTEGER: certains clients ont plusieurs numeros
        // ("775695986 / 775729327") et les zeros de tete comptent.
        type: DataTypes.STRING(60),
        allowNull: true
    },
    adresse: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    type: {
        // Libre: Restaurant, Consommateur, Boucher, Ambassadrice, Traiteur,
        // Maison + restaurant...
        type: DataTypes.STRING(60),
        allowNull: true
    },
    actif: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at'
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'gros_clients',
    timestamps: false
});

module.exports = GrosClient;
