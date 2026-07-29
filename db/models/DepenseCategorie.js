const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * DepenseCategorie — categories de l'onglet Finance > Depenses, configurables
 * dans ADMIN > Categories depenses. Remplace la liste qui etait figee en dur
 * dans le <select> de index.html.
 *
 * `nom` est la cle technique stockee dans depenses.categorie (ex: 'loyer'):
 * elle ne doit pas changer une fois des depenses saisies, sinon l'historique
 * ne se rattache plus. `libelle` est le texte affiche, librement modifiable.
 *
 * Table par tenant. Seed des 8 categories historiques dans
 * db/update-schema.js, uniquement si la table est vide.
 */
const DepenseCategorie = sequelize.define('DepenseCategorie', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nom: {
        type: DataTypes.STRING(60),
        allowNull: false,
        unique: true
    },
    libelle: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    ordre: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
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
    tableName: 'depense_categories',
    timestamps: false
});

module.exports = DepenseCategorie;
