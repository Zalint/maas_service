const Vente = require('./Vente');
const Stock = require('./Stock');
const Transfert = require('./Transfert');
const Reconciliation = require('./Reconciliation');
const CashPayment = require('./CashPayment');
const AchatBoeuf = require('./AchatBoeuf');
const WeightParams = require('./WeightParams');
const Precommande = require('./Precommande');
const ClientAbonne = require('./ClientAbonne');
const PaiementAbonnement = require('./PaiementAbonnement');
const PerformanceAchat = require('./PerformanceAchat');
const AuditClientLog = require('./AuditClientLog');

// Nouveaux modèles pour la gestion centralisée
const User = require('./User');
const PointVente = require('./PointVente');
const UserPointVente = require('./UserPointVente');
const Category = require('./Category');
const InventaireCategory = require('./InventaireCategory');
const Produit = require('./Produit');
const DecoupeOrderLog = require('./DecoupeOrderLog');
const PrixPointVente = require('./PrixPointVente');
const PrixHistorique = require('./PrixHistorique');

// Modèle pour l'historique des imports OCR
const OcrImport = require('./OcrImport');

// Modèle pour les infos et crédits des commandes
const CommandeInfo = require('./CommandeInfo');

// Modèle pour les commandes web (weborders)
const WebOrder = require('./WebOrder');

// Modèle pour la clôture de caisse (POS cash-up)
// Doit être enregistré ici pour que sequelize.sync() crée la table
// `clotures_caisse` au moment de l'init d'un nouveau tenant. Sans ça,
// le premier appel à /api/clotures plante avec "relation does not exist".
const ClotureCaisse = require('./ClotureCaisse');

// Modeles Finance (onglet Finance: depenses + creances fournisseur)
const Depense = require('./Depense');
const FournisseurPrix = require('./FournisseurPrix');
const FinanceConfig = require('./FinanceConfig');
const FournisseurPaiement = require('./FournisseurPaiement');
const ProduitAlias = require('./ProduitAlias');
const PrixVenteCdcHistory = require('./PrixVenteCdcHistory');
const PrixAchatHistory = require('./PrixAchatHistory');
const PrixVenteHistory = require('./PrixVenteHistory');
const FinanceCharge = require('./FinanceCharge');

const { sequelize } = require('../index');

// =====================================================
// RELATIONS EXISTANTES
// =====================================================

// Relations pour les abonnements
ClientAbonne.hasMany(PaiementAbonnement, {
  foreignKey: 'client_id',
  as: 'paiements'
});

PaiementAbonnement.belongsTo(ClientAbonne, {
  foreignKey: 'client_id',
  as: 'client'
});

// =====================================================
// NOUVELLES RELATIONS - Gestion centralisée
// =====================================================

// User <-> PointVente (Many-to-Many via UserPointVente)
User.belongsToMany(PointVente, {
  through: UserPointVente,
  foreignKey: 'user_id',
  otherKey: 'point_vente_id',
  as: 'pointsVente'
});

PointVente.belongsToMany(User, {
  through: UserPointVente,
  foreignKey: 'point_vente_id',
  otherKey: 'user_id',
  as: 'users'
});

// Category <-> Produit (One-to-Many)
Category.hasMany(Produit, {
  foreignKey: 'categorie_id',
  as: 'produits'
});

Produit.belongsTo(Category, {
  foreignKey: 'categorie_id',
  as: 'categorie'
});

// Produit <-> PointVente (Many-to-Many via PrixPointVente)
Produit.belongsToMany(PointVente, {
  through: PrixPointVente,
  foreignKey: 'produit_id',
  otherKey: 'point_vente_id',
  as: 'pointsVenteAvecPrix'
});

PointVente.belongsToMany(Produit, {
  through: PrixPointVente,
  foreignKey: 'point_vente_id',
  otherKey: 'produit_id',
  as: 'produitsAvecPrix'
});

// PrixPointVente relations directes
PrixPointVente.belongsTo(Produit, {
  foreignKey: 'produit_id',
  as: 'produit'
});

PrixPointVente.belongsTo(PointVente, {
  foreignKey: 'point_vente_id',
  as: 'pointVente'
});

Produit.hasMany(PrixPointVente, {
  foreignKey: 'produit_id',
  as: 'prixParPointVente'
});

PointVente.hasMany(PrixPointVente, {
  foreignKey: 'point_vente_id',
  as: 'prixProduits'
});

// PrixHistorique relations
PrixHistorique.belongsTo(Produit, {
  foreignKey: 'produit_id',
  as: 'produit'
});

PrixHistorique.belongsTo(PointVente, {
  foreignKey: 'point_vente_id',
  as: 'pointVente'
});

Produit.hasMany(PrixHistorique, {
  foreignKey: 'produit_id',
  as: 'historiquePrix'
});

// =====================================================
// SYNCHRONISATION
// =====================================================

// Fonction pour synchroniser les modèles avec la base de données
async function syncDatabase(force = false) {
  try {
    await sequelize.sync({ force });
    console.log('Base de données synchronisée avec succès');
    return true;
  } catch (error) {
    console.error('Erreur lors de la synchronisation de la base de données:', error);
    return false;
  }
}

// Fonction pour synchroniser seulement les nouveaux modèles (sans toucher aux existants)
async function syncNewModels(options = { alter: true }) {
  try {
    // Synchroniser les nouvelles tables dans l'ordre des dépendances
    await User.sync(options);
    await PointVente.sync(options);
    await UserPointVente.sync(options);
    await Category.sync(options);
    await InventaireCategory.sync(options);
    await Produit.sync(options);
    await PrixPointVente.sync(options);
    await PrixHistorique.sync(options);
    await DecoupeOrderLog.sync(options);

    console.log('Nouveaux modèles synchronisés avec succès');
    return true;
  } catch (error) {
    console.error('Erreur lors de la synchronisation des nouveaux modèles:', error);
    return false;
  }
}

module.exports = {
  // Modèles existants
  Vente,
  Stock,
  Transfert,
  Reconciliation,
  CashPayment,
  AchatBoeuf,
  WeightParams,
  Precommande,
  ClientAbonne,
  PaiementAbonnement,
  PerformanceAchat,
  AuditClientLog,
  
  // Nouveaux modèles
  User,
  PointVente,
  UserPointVente,
  Category,
  InventaireCategory,
  Produit,
  DecoupeOrderLog,
  PrixPointVente,
  PrixHistorique,
  
  // Modèle historique imports OCR
  OcrImport,
  
  // Modèle infos et crédits des commandes
  CommandeInfo,
  
  // Modèle commandes web
  WebOrder,

  // Modèle clôture de caisse
  ClotureCaisse,

  // Modeles Finance
  Depense,
  FournisseurPrix,
  FinanceConfig,
  FournisseurPaiement,
  ProduitAlias,
  PrixVenteCdcHistory,
  PrixAchatHistory,
  PrixVenteHistory,
  FinanceCharge,

  // Fonctions utilitaires
  syncDatabase,
  syncNewModels,
  sequelize
};
