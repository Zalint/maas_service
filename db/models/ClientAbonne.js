const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const ClientAbonne = sequelize.define('ClientAbonne', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    abonne_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
        comment: 'Format: [Lettre Point Vente][YYMMDD][Incrément] ex: M241006001'
    },
    prenom: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    nom: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    telephone: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true
    },
    adresse: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    position_gps: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Coordonnées GPS (latitude,longitude)'
    },
    lien_google_maps: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    point_vente_defaut: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: 'Point de vente par défaut du client'
    },
    statut: {
        type: DataTypes.ENUM('actif', 'inactif'),
        allowNull: false,
        defaultValue: 'actif'
    },
    date_inscription: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'clients_abonnes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        {
            unique: true,
            fields: ['abonne_id']
        },
        {
            unique: true,
            fields: ['telephone']
        },
        {
            fields: ['point_vente_defaut']
        },
        {
            fields: ['statut']
        },
        {
            fields: ['date_inscription']
        }
    ]
});

/**
 * Génère un ID abonné unique
 * Format: [Lettre Point Vente][YYMMDD][Incrément]
 * Exemple: M241006001 pour Mbao, date 06/10/2024, 1er client du jour
 */
ClientAbonne.generateAbonneId = async function(pointVente, dateInscription = new Date()) {
    // Mapping des points de vente vers leur lettre
    const POINT_VENTE_LETTERS = {
        'Mbao': 'M',
        'O.Foire': 'O',
        'Keur Massar': 'K',
        'Linguere': 'L',
        'Sacre Coeur': 'S',
        'Dahra': 'D',
        'Abattage': 'A',
        'Dépôt central': 'A'
    };
    
    const letter = POINT_VENTE_LETTERS[pointVente];
    if (!letter) {
        throw new Error(`Point de vente non reconnu: ${pointVente}`);
    }
    
    // Format de la date: YYMMDD
    const date = new Date(dateInscription);
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    
    // Chercher le dernier numéro pour ce point de vente et cette date
    const prefix = `${letter}${dateStr}`;
    
    // Trouver tous les abonnés avec ce préfixe
    const existingClients = await ClientAbonne.findAll({
        where: {
            abonne_id: {
                [sequelize.Sequelize.Op.like]: `${prefix}%`
            }
        },
        order: [['abonne_id', 'DESC']],
        limit: 1
    });
    
    let increment = 1;
    if (existingClients.length > 0) {
        // Extraire le numéro d'incrément du dernier ID
        const lastId = existingClients[0].abonne_id;
        const lastIncrement = parseInt(lastId.slice(-3));
        increment = lastIncrement + 1;
    }
    
    // Générer le nouvel ID avec incrément sur 3 chiffres
    const incrementStr = String(increment).padStart(3, '0');
    return `${prefix}${incrementStr}`;
};

/**
 * Hook avant création pour générer automatiquement l'abonne_id
 */
ClientAbonne.beforeCreate(async (client, options) => {
    if (!client.abonne_id) {
        client.abonne_id = await ClientAbonne.generateAbonneId(
            client.point_vente_defaut,
            client.date_inscription || new Date()
        );
    }
});

module.exports = ClientAbonne;

