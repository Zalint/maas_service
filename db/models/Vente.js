const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const Vente = sequelize.define('Vente', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  mois: {
    type: DataTypes.STRING,
    allowNull: false
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  semaine: {
    type: DataTypes.STRING,
    allowNull: true
  },
  pointVente: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'point_vente'
  },
  preparation: {
    type: DataTypes.STRING,
    allowNull: true
  },
  categorie: {
    type: DataTypes.STRING,
    allowNull: false
  },
  produit: {
    type: DataTypes.STRING,
    allowNull: false
  },
  prixUnit: {
    type: DataTypes.FLOAT,
    allowNull: false,
    field: 'prix_unit'
  },
  nombre: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  montant: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  nomClient: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'nom_client'
  },
  numeroClient: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'numero_client'
  },
  adresseClient: {
    // TEXT et non STRING: les adresses des commandes web peuvent depasser
    // 255 caracteres (cf db/update-schema.js, qui convertit la colonne).
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'adresse_client'
  },
  // Vente faite a un "gros client" (case cochee dans le modal de paiement du
  // POS, liste geree dans ADMIN > Gros clients). Sert au reporting: colonne
  // dediee dans le tableau de Visualisation.
  // Reference directe vers le gros client choisi dans le POS. Renseignee au
  // moment de la vente, quand l'identite est connue avec certitude: evite de
  // la redeviner ensuite par telephone/nom. NULL = vente non rattachee
  // (client hors referentiel, ou vente anterieure a cette colonne).
  grosClientId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'gros_client_id'
  },
  grosClient: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'gros_client'
  },
  creance: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  client_abonne_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'client_abonne_id',
    comment: 'ID du client abonné (FK vers clients_abonnes)'
  },
  prix_normal: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'prix_normal',
    comment: 'Prix normal avant rabais abonné'
  },
  rabais_applique: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    field: 'rabais_applique',
    comment: 'Montant du rabais appliqué pour client abonné'
  },
  extension: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'extension',
    comment: 'Extension JSON pour stocker des données supplémentaires (ex: composition des packs)'
  },
  commandeId: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'commande_id',
    comment: 'Numéro de commande (ex: MBA1234567890) pour regrouper les ventes'
  },
  instructionsClient: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'instructions_client',
    comment: 'Instructions spéciales du client pour la commande'
  },
  statutPreparation: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'en_preparation',
    field: 'statut_preparation',
    comment: 'Statut: en_preparation, pret, en_livraison, sur_place'
  },
  livreurAssigne: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: null,
    field: 'livreur_assigne',
    comment: 'Nom du livreur assigné à cette commande'
  },
  montantRestantDu: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: 0,
    field: 'montant_restant_du',
    comment: 'Montant restant dû par le client (créance)'
  }
}, {
  tableName: 'ventes',
  timestamps: true, // Ajoute automatiquement createdAt et updatedAt
  hooks: {
    beforeBulkCreate: async (instances, options) => {
      // Vérifier si les instances ont déjà un ID
      const hasIds = instances.some(instance => instance.id);
      
      // Si certaines instances ont un ID, nous devons nous assurer que la séquence est correctement mise à jour
      if (hasIds) {
        await sequelize.query('SELECT setval(pg_get_serial_sequence(\'ventes\', \'id\'), COALESCE((SELECT MAX(id) FROM ventes) + 1, 1), false)');
      }
    }
  }
});

module.exports = Vente; 