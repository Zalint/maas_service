const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * Composition par defaut d'un pack: une ligne par produit contenu.
 *
 * Cette table etait auparavant un fichier de configuration, recopie a
 * l'identique dans trois fichiers du depot. Les copies ont diverge quatre
 * fois - noms de produits differents, poids_unitaire manquant - et chaque
 * divergence produisait des kilos rattaches a aucune categorie, donc un
 * parage faux. En base, la table est sauvegardee avec le reste des donnees,
 * modifiable depuis ADMIN sans redeploiement, et propre a chaque tenant.
 *
 * config/pack-compositions.js ne sert plus qu'a l'amorcage: la migration y
 * puise les compositions initiales si la table est vide, puis ne la relit
 * jamais.
 *
 * Une vente conserve SA composition dans ventes.extension: modifier la
 * composition par defaut ici ne reecrit pas le passe.
 */
const PackComposition = sequelize.define('PackComposition', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    // Nom du produit-pack tel qu'il apparait au catalogue ("Pack75000").
    pack: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'pack'
    },
    ordre: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'ordre'
    },
    produit: {
        type: DataTypes.STRING(150),
        allowNull: false,
        field: 'produit'
    },
    quantite: {
        type: DataTypes.DECIMAL(10, 3),
        allowNull: false,
        field: 'quantite'
    },
    // 'kg' | 'piece' | 'tablette'
    unite: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'kg',
        field: 'unite'
    },
    // Obligatoire quand unite = 'piece': sans lui, la ligne ne peut pas etre
    // convertie en kilos et disparait silencieusement du calcul de parage.
    poids_unitaire: {
        type: DataTypes.DECIMAL(10, 3),
        allowNull: true,
        field: 'poids_unitaire'
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'pack_compositions',
    timestamps: false
});

module.exports = PackComposition;
