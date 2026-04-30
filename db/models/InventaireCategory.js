const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

// Famille de regroupement pour les catégories d'inventaire (Viandes, Œufs et
// Produits Laitiers, etc., plus les catégories personnalisées créées par
// l'admin via la colonne categorie_affichage de Produit). Les catégories
// d'inventaire ne sont pas des FK — c'est juste un mapping nom -> famille
// partagé entre tous les utilisateurs de ce tenant.
const InventaireCategory = sequelize.define('InventaireCategory', {
  nom: {
    type: DataTypes.STRING(100),
    primaryKey: true,
    allowNull: false
  },
  famille: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'Autres',
    validate: {
      isIn: [['Boucherie', 'Epicerie', 'Autres']]
    }
  }
}, {
  tableName: 'inventaire_categories',
  timestamps: true,
  underscored: true
});

module.exports = InventaireCategory;
