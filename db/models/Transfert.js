const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const Transfert = sequelize.define('Transfert', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  pointVente: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'point_vente'
  },
  produit: {
    type: DataTypes.STRING,
    allowNull: false
  },
  quantite: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  prixUnitaire: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0,
    field: 'prix_unitaire'
  },
  total: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  impact: {
    type: DataTypes.STRING,
    allowNull: false
  },
  commentaire: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  horsMata: {
    // Ce transfert n'apporte PAS de marchandise MATA: achat local, depannage
    // entre points de vente, autre fournisseur. Il entre par le meme ecran
    // mais ne doit pas porter la commission 3% (cf routes/finance-creances.js,
    // etape 3a, qui l'ecarte de transfertsEntrants).
    //
    // NOT NULL DEFAULT FALSE: l'immense majorite des transferts vient bien de
    // MATA, et un null se lirait comme « on ne sait pas » alors qu'on sait.
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'hors_mata'
  },
  extension: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: null,
    comment: 'Données enrichies. Pour les produits avec ventilation_poids=true, contient { calibres: [{ poids_kg, quantite }] }'
  }
}, {
  tableName: 'transferts',
  timestamps: true
});

module.exports = Transfert; 