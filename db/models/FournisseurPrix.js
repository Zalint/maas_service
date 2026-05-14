const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * FournisseurPrix — catalogue editable des produits boucherie cote
 * fournisseur. prix_vente = prix auquel le fournisseur me vend (utilise
 * pour le calcul de commission 3%). prix_achat = cout d'achat du
 * fournisseur (utilise pour calculer "ce qu'il me doit" sur les commandes
 * livrees via Centre de Decoupe).
 */
const FournisseurPrix = sequelize.define('FournisseurPrix', {
    produit: {
        type: DataTypes.STRING(100),
        primaryKey: true
    },
    prix_vente: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
        field: 'prix_vente'
    },
    prix_achat: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        field: 'prix_achat'
    },
    // Prix de vente convenu pour les ventes via Centre de Decoupe.
    // Different de prix_vente (= ce que le fournisseur facture a Maas);
    // sert au calcul de marge "Il me doit" sur les commandes CDC.
    // Editable depuis l'UI Finance > Centre de Decoupe, chaque
    // modification est historisee dans prix_vente_cdc_history.
    prix_vente_cdc: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        field: 'prix_vente_cdc'
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at'
    }
}, {
    tableName: 'fournisseur_prix',
    timestamps: false
});

module.exports = FournisseurPrix;
