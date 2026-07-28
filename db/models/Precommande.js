const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const Precommande = sequelize.define('Precommande', {
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
  dateEnregistrement: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'date_enregistrement'
  },
  dateReception: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'date_reception'
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
    // TEXT et non STRING: meme raison que Vente.adresseClient (adresses des
    // commandes web pouvant depasser 255 caracteres).
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'adresse_client'
  },
  commentaire: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  label: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Label pour filtrer les pré-commandes liées à un événement'
  },
  statut: {
    type: DataTypes.ENUM('ouvert', 'convertie', 'annulee', 'archivee'),
    allowNull: false,
    defaultValue: 'ouvert',
    comment: 'Statut de la pré-commande'
  },
  commentaireStatut: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'commentaire_statut',
    comment: 'Commentaire pour annulation ou archivage'
  }
}, {
  tableName: 'precommandes',
  timestamps: true, // Ajoute automatiquement createdAt et updatedAt
  createdAt: 'createdAt',
  updatedAt: 'updatedAt', // S'assurer que Sequelize utilise le bon nom de colonne
  hooks: {
    beforeBulkCreate: async (instances, options) => {
      // Vérifier si les instances ont déjà un ID
      const hasIds = instances.some(instance => instance.id);
      
      // Si certaines instances ont un ID, nous devons nous assurer que la séquence est correctement mise à jour
      if (hasIds) {
        await sequelize.query('SELECT setval(pg_get_serial_sequence(\'precommandes\', \'id\'), COALESCE((SELECT MAX(id) FROM precommandes) + 1, 1), false)');
      }
    }
  }
});

module.exports = Precommande;
