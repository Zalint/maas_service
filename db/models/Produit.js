const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const Produit = sequelize.define('Produit', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  nom: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  categorie_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // NULL pour les produits inventaire sans catégorie
    references: {
      model: 'categories',
      key: 'id'
    },
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE'
  },
  type_catalogue: {
    type: DataTypes.ENUM('vente', 'abonnement', 'inventaire'),
    allowNull: false,
    comment: 'Type de catalogue: vente (normal), abonnement (prix réduit), inventaire'
  },
  prix_defaut: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    field: 'prix_defaut'
  },
  prix_alternatifs: {
    type: DataTypes.ARRAY(DataTypes.DECIMAL(10, 2)),
    allowNull: true,
    defaultValue: [],
    field: 'prix_alternatifs',
    comment: 'Liste des prix alternatifs possibles'
  },
  mode_stock: {
    type: DataTypes.ENUM('manuel', 'automatique'),
    allowNull: false,
    defaultValue: 'manuel',
    field: 'mode_stock',
    comment: 'Mode de gestion du stock: manuel (pesée quotidienne) ou automatique (décrément par vente)'
  },
  unite_stock: {
    type: DataTypes.ENUM('unite', 'kilo'),
    allowNull: false,
    defaultValue: 'unite',
    field: 'unite_stock',
    comment: 'Unité de mesure pour le stock automatique: unite (pièces) ou kilo (poids)'
  },
  categorie_affichage: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'categorie_affichage',
    comment: 'Catégorie personnalisée pour l\'affichage dans l\'admin inventaire (ex: Conserve, Boissons)'
  },
  ventes: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: true,
    defaultValue: [],
    field: 'ventes',
    comment: 'Inventaire uniquement: noms des produits de vente (type_catalogue=vente) que ce produit alimente. Ex: Boeuf -> ["Boeuf en gros", "Boeuf en détail"]'
  },
  prix_personnalise: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'prix_personnalise',
    comment: 'Vente uniquement: true si le prix a été personnalisé par l\'admin et ne doit plus être propagé depuis le parent inventaire'
  },
  ventilation_poids: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'ventilation_poids',
    comment: 'Inventaire: si TRUE, les transferts de ce produit acceptent une ventilation par calibre (poids_kg + quantite) dans transferts.extension.calibres'
  }
}, {
  tableName: 'produits',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['nom', 'type_catalogue'],
      name: 'produits_nom_type_unique'
    },
    {
      fields: ['categorie_id']
    },
    {
      fields: ['type_catalogue']
    }
  ]
});

module.exports = Produit;

