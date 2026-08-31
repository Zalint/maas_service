const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

const ClotureCaisse = sequelize.define('ClotureCaisse', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: 'Date de la clôture (YYYY-MM-DD)'
    },
    point_de_vente: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'Nom du point de vente'
    },
    montant_especes: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        comment: 'Montant espèces comptées physiquement'
    },
    fond_de_caisse: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        defaultValue: 0,
        comment: 'Fond de caisse laissé pour le lendemain'
    },
    montant_estimatif: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Montant estimatif calculé (ventes - paiements Bictorys)'
    },
    montant_total_caisse: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Total espèces physiquement présentes dans la caisse à la clôture (incluant fond de caisse). Optionnel, utilisé par Finance > Cash et Stock.'
    },
    depot_mata: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Montant versé à Mata ce jour-là. Compté APRÈS le comptage de '
            + 'la caisse (donc encore inclus dans montant_total_caisse), et '
            + 'déduit à ce titre par Finance > Cash et Stock. NULL = non '
            + 'renseigné, à ne pas confondre avec 0 = aucun dépôt.'
    },
    depot_precedent_recupere: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        comment: 'Le dépôt Mata précédent a-t-il été récupéré ? Demandé (et '
            + 'obligatoire) dès qu\'un dépôt est saisi, quand un dépôt antérieur '
            + 'existe. NULL = question non posée ou sans objet, à ne pas '
            + 'confondre avec false = non récupéré. Traçabilité seule : '
            + 'n\'entre dans AUCUN calcul de Finance > Cash et Stock.'
    },
    depot_precedent_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: 'Date de la clôture dont le dépôt est visé par '
            + 'depot_precedent_recupere. Sans elle, la réponse ne désigne rien : '
            + '"le dépôt précédent" se résout au moment de la saisie, et une '
            + 'clôture insérée rétroactivement entre deux dates ferait pointer '
            + 'un oui/non déjà enregistré vers un AUTRE dépôt. Écrite par le '
            + 'serveur, qui retrouve lui-même la clôture visée.'
    },
    montant_wave: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Solde Wave de ce point de vente à la clôture. NULL = non '
            + 'renseigné, à ne pas confondre avec 0 = aucun solde.'
    },
    montant_om: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Solde Orange Money de ce point de vente à la clôture. NULL '
            + '= non renseigné, à ne pas confondre avec 0 = aucun solde.'
    },
    commercial: {
        type: DataTypes.STRING(150),
        allowNull: false,
        comment: 'Nom du/de la commercial(e) qui clôture'
    },
    commentaire: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Commentaire libre'
    },
    created_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Username de l\'utilisateur session'
    },
    is_latest: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        comment: 'Indique si c\'est la dernière clôture du jour pour ce PdV (utilisée pour réconciliation)'
    }
}, {
    tableName: 'clotures_caisse',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['date'] },
        { fields: ['point_de_vente'] },
        { fields: ['date', 'point_de_vente'] },
        { fields: ['created_at'] }
    ]
});

module.exports = ClotureCaisse;
