const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const Category = sequelize.define('Category', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  nom: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
    }
  },
  ordre: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Ordre d\'affichage dans l\'interface'
  },
  famille: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'Autres',
    comment: 'Famille de regroupement haut niveau dans Produits Généraux: Boucherie / Epicerie / Autres'
  }
}, {
  tableName: 'categories',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['nom']
    }
  ]
});

module.exports = Category;

