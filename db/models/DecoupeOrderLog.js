const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

// Journal local des commandes envoyées au centre de découpe Mata.
// Permet d'afficher "Mes commandes" sans dépendre de la disponibilité de Mata.
// On ne stocke pas le statut — il vit côté Mata et peut être consulté via
// le lien "Ouvrir dans Centre de Découpe".
const DecoupeOrderLog = sequelize.define('DecoupeOrderLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  commande_ref: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Référence retournée par Mata (CD-YYYYMMDD-XXXX). Null si Mata n\'a pas renvoyé de ref.'
  },
  point_vente: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  point_vente_executant: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  produits: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  montant_total: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0
  },
  nom_client: { type: DataTypes.STRING(150), allowNull: true },
  numero_client: { type: DataTypes.STRING(50), allowNull: true },
  adresse_client: { type: DataTypes.STRING(255), allowNull: true },
  instructions_client: { type: DataTypes.TEXT, allowNull: true },
  cree_par: { type: DataTypes.STRING(150), allowNull: true },
  mata_response: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Réponse complète de Mata (data.commande). Permet de voir ce que Mata a stocké vs ce qu\'on a envoyé.'
  }
}, {
  tableName: 'decoupe_order_logs',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['point_vente'] },
    { fields: ['created_at'] }
  ]
});

module.exports = DecoupeOrderLog;
