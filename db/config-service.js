/**
 * Service de configuration centralisé
 * 
 * Ce service fournit une interface unifiée pour accéder aux données de configuration
 * stockées en base de données. Il expose des méthodes compatibles avec les anciens
 * fichiers JS pour faciliter la transition.
 * 
 * Usage:
 *   const configService = require('./db/config-service');
 *   
 *   // Récupérer les produits (comme l'ancien produits.js)
 *   const produits = await configService.getProduits('vente');
 *   
 *   // Récupérer les points de vente
 *   const pointsVente = await configService.getPointsVente();
 */

const {
  User,
  PointVente,
  UserPointVente,
  Category,
  Produit,
  PrixPointVente,
  PrixHistorique,
  sequelize
} = require('./models');
const { Op } = require('sequelize');

// Cache en mémoire pour les données fréquemment accédées
let cache = {
  produits: {},
  pointsVente: null,
  categories: null,
  lastRefresh: null
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Invalide le cache
 */
function invalidateCache() {
  cache = {
    produits: {},
    pointsVente: null,
    categories: null,
    lastRefresh: null
  };
}

/**
 * Vérifie si le cache est valide
 */
function isCacheValid() {
  return cache.lastRefresh && (Date.now() - cache.lastRefresh < CACHE_TTL);
}

// =====================================================
// POINTS DE VENTE
// =====================================================

/**
 * Récupère tous les points de vente
 * @param {boolean} activeOnly - Si true, retourne seulement les actifs
 * @returns {Promise<Array>}
 */
async function getPointsVente(activeOnly = true) {
  const where = activeOnly ? { active: true } : {};
  return await PointVente.findAll({ where, order: [['nom', 'ASC']] });
}

/**
 * Récupère les points de vente au format de l'ancien fichier points-vente.js
 * @returns {Promise<Object>}
 */
async function getPointsVenteAsLegacy() {
  if (isCacheValid() && cache.pointsVente) {
    return cache.pointsVente;
  }
  
  const pointsVente = await PointVente.findAll();
  const result = {};
  
  for (const pv of pointsVente) {
    result[pv.nom] = { active: pv.active, payment_ref: pv.payment_ref };
  }
  
  cache.pointsVente = result;
  cache.lastRefresh = Date.now();
  
  return result;
}

/**
 * Récupère le mapping des références de paiement vers les noms de points de vente
 * @returns {Promise<Object>} - { 'V_KB': 'Keur Bali', 'V_ABATS': 'Abattage' }
 */
async function getPaymentRefMapping() {
  const pointsVente = await PointVente.findAll({
    where: { active: true },
    attributes: ['nom', 'payment_ref']
  });
  
  const result = {};
  for (const pv of pointsVente) {
    if (pv.payment_ref) {
      result[pv.payment_ref] = pv.nom;
    }
  }
  
  return result;
}

/**
 * Récupère le mapping inverse: nom du point de vente vers code de référence
 * @returns {Promise<Object>} - { 'Keur Bali': 'V_KB', 'Abattage': 'V_ABATS' }
 */
async function getPointVenteToRefMapping() {
  const pointsVente = await PointVente.findAll({
    where: { active: true },
    attributes: ['nom', 'payment_ref']
  });
  
  const result = {};
  for (const pv of pointsVente) {
    if (pv.payment_ref) {
      result[pv.nom] = pv.payment_ref;
    }
  }
  
  return result;
}

/**
 * Crée ou met à jour un point de vente
 */
async function upsertPointVente(nom, active = true) {
  const [pointVente, created] = await PointVente.upsert(
    { nom, active },
    { returning: true }
  );
  invalidateCache();
  return { pointVente, created };
}

// =====================================================
// UTILISATEURS
// =====================================================

/**
 * Récupère un utilisateur par username
 */
async function getUserByUsername(username) {
  return await User.findOne({
    where: { username },
    include: [{
      model: PointVente,
      as: 'pointsVente'
    }]
  });
}

/**
 * Récupère tous les utilisateurs
 */
async function getAllUsers(activeOnly = false) {
  const where = activeOnly ? { active: true } : {};
  return await User.findAll({
    where,
    include: [{
      model: PointVente,
      as: 'pointsVente'
    }],
    order: [['username', 'ASC']]
  });
}

/**
 * Récupère les utilisateurs au format de l'ancien users.json
 */
async function getUsersAsLegacy() {
  const users = await getAllUsers();
  return users.map(user => ({
    username: user.username,
    password: user.password,
    role: user.role,
    pointVente: user.acces_tous_points 
      ? 'tous' 
      : user.pointsVente.map(pv => pv.nom),
    active: user.active
  }));
}

/**
 * Vérifie si un utilisateur a accès à un point de vente
 */
async function userHasAccessToPointVente(userId, pointVenteNom) {
  const user = await User.findByPk(userId, {
    include: [{ model: PointVente, as: 'pointsVente' }]
  });
  
  if (!user) return false;
  if (user.acces_tous_points) return true;
  
  return user.pointsVente.some(pv => pv.nom === pointVenteNom);
}

/**
 * Crée un nouvel utilisateur
 */
async function createUser(userData) {
  const { username, password, role, pointsVente, accesTousPoints } = userData;
  
  const user = await User.create({
    username,
    password,
    role,
    acces_tous_points: accesTousPoints || false,
    active: true
  });
  
  // Associer les points de vente si nécessaire
  if (!accesTousPoints && pointsVente && pointsVente.length > 0) {
    const pvs = await PointVente.findAll({
      where: { nom: { [Op.in]: pointsVente } }
    });
    
    for (const pv of pvs) {
      await UserPointVente.create({
        user_id: user.id,
        point_vente_id: pv.id
      });
    }
  }
  
  return user;
}

/**
 * Met à jour un utilisateur
 */
async function updateUser(userId, userData) {
  const user = await User.findByPk(userId);
  if (!user) throw new Error('Utilisateur non trouvé');
  
  await user.update(userData);
  
  // Mettre à jour les points de vente si fournis
  if (userData.pointsVente !== undefined) {
    // Supprimer les anciennes associations
    await UserPointVente.destroy({ where: { user_id: userId } });
    
    // Créer les nouvelles si pas accès à tous
    if (!userData.accesTousPoints && userData.pointsVente.length > 0) {
      const pvs = await PointVente.findAll({
        where: { nom: { [Op.in]: userData.pointsVente } }
      });
      
      for (const pv of pvs) {
        await UserPointVente.create({
          user_id: userId,
          point_vente_id: pv.id
        });
      }
    }
  }
  
  return user;
}

// =====================================================
// CATÉGORIES
// =====================================================

/**
 * Récupère toutes les catégories
 */
async function getCategories() {
  if (isCacheValid() && cache.categories) {
    return cache.categories;
  }
  
  const categories = await Category.findAll({ order: [['ordre', 'ASC']] });
  cache.categories = categories;
  return categories;
}

// =====================================================
// PRODUITS
// =====================================================

/**
 * Récupère les produits au format de l'ancien fichier produits.js
 * @param {string} typeCatalogue - 'vente', 'abonnement', ou 'inventaire'
 */
async function getProduitsAsLegacy(typeCatalogue = 'vente') {
  if (isCacheValid() && cache.produits[typeCatalogue]) {
    return cache.produits[typeCatalogue];
  }
  
  const produits = await Produit.findAll({
    where: { type_catalogue: typeCatalogue },
    include: [
      { model: Category, as: 'categorie' },
      { 
        model: PrixPointVente, 
        as: 'prixParPointVente',
        include: [{ model: PointVente, as: 'pointVente' }]
      }
    ]
  });
  
  const result = {};
  
  if (typeCatalogue === 'inventaire') {
    // Format plat pour l'inventaire
    for (const produit of produits) {
      const config = {
        prixDefault: parseFloat(produit.prix_defaut),
        alternatives: produit.prix_alternatifs ? produit.prix_alternatifs.map(p => parseFloat(p)) : [],
        ventes: Array.isArray(produit.ventes) ? produit.ventes : []
      };
      
      // Ajouter les prix par point de vente
      for (const prix of produit.prixParPointVente) {
        config[prix.pointVente.nom] = parseFloat(prix.prix);
      }
      
      result[produit.nom] = config;
    }
    
    // Ajouter les fonctions utilitaires comme dans l'ancien fichier
    result.getPrixDefaut = function(produit, pointVente = null) {
      if (this[produit]) {
        const produitConfig = this[produit];
        if (pointVente && produitConfig[pointVente] !== undefined) {
          return produitConfig[pointVente];
        }
        return produitConfig.prixDefault;
      }
      return 0;
    };
    
    result.getPrixAlternatifs = function(produit) {
      if (this[produit]) {
        return this[produit].alternatives;
      }
      return [];
    };
    
    result.getTousLesProduits = function() {
      return Object.keys(this).filter(key => 
        typeof this[key] === 'object' && this[key] !== null && this[key].prixDefault !== undefined
      );
    };
    
    result.produitExiste = function(produit) {
      return this[produit] && typeof this[produit] === 'object' && this[produit].prixDefault !== undefined;
    };
    
    result.getSimpleValue = function(produit, pointVente = null) {
      return this.getPrixDefaut(produit, pointVente);
    };
    
  } else {
    // Format avec catégories pour vente/abonnement
    for (const produit of produits) {
      const categorieName = produit.categorie ? produit.categorie.nom : 'Autres';
      
      if (!result[categorieName]) {
        result[categorieName] = {};
      }
      
      const config = {
        default: parseFloat(produit.prix_defaut),
        alternatives: produit.prix_alternatifs ? produit.prix_alternatifs.map(p => parseFloat(p)) : []
      };
      
      // Ajouter les prix par point de vente
      for (const prix of produit.prixParPointVente) {
        config[prix.pointVente.nom] = parseFloat(prix.prix);
      }
      
      result[categorieName][produit.nom] = config;
    }
    
    // Ajouter les fonctions utilitaires comme dans l'ancien fichier
    result.getPrixDefaut = function(categorie, produit, pointVente = null) {
      if (this[categorie] && this[categorie][produit]) {
        const produitConfig = this[categorie][produit];
        if (pointVente && produitConfig[pointVente] !== undefined) {
          return produitConfig[pointVente];
        }
        return produitConfig.default;
      }
      return 0;
    };
    
    result.getPrixAlternatifs = function(categorie, produit) {
      if (this[categorie] && this[categorie][produit]) {
        return this[categorie][produit].alternatives;
      }
      return [];
    };
    
    result.getPrixPreferePour = function(categorie, produit) {
      if (this[categorie] && this[categorie][produit]) {
        const alternatives = this[categorie][produit].alternatives;
        return alternatives.length > 0 ? alternatives[0] : this[categorie][produit].default;
      }
      return 0;
    };
    
    result.getSimpleValue = function(categorie, produit, pointVente = null) {
      return this.getPrixDefaut(categorie, produit, pointVente);
    };
  }
  
  cache.produits[typeCatalogue] = result;
  cache.lastRefresh = Date.now();
  
  return result;
}

/**
 * Récupère le prix d'un produit
 */
async function getPrixProduit(produitNom, typeCatalogue, pointVenteNom = null) {
  const produit = await Produit.findOne({
    where: { nom: produitNom, type_catalogue: typeCatalogue },
    include: [{
      model: PrixPointVente,
      as: 'prixParPointVente',
      include: [{ model: PointVente, as: 'pointVente' }]
    }]
  });
  
  if (!produit) return 0;
  
  // Chercher un prix spécifique au point de vente
  if (pointVenteNom) {
    const prixSpecifique = produit.prixParPointVente.find(
      p => p.pointVente.nom === pointVenteNom
    );
    if (prixSpecifique) return parseFloat(prixSpecifique.prix);
  }
  
  return parseFloat(produit.prix_defaut);
}

/**
 * Met à jour le prix d'un produit
 */
async function updatePrixProduit(produitId, nouveauPrix, pointVenteId = null, modifiePar = null) {
  const produit = await Produit.findByPk(produitId);
  if (!produit) throw new Error('Produit non trouvé');
  
  let ancienPrix;
  
  if (pointVenteId) {
    // Mettre à jour un prix spécifique
    const [prixPv, created] = await PrixPointVente.findOrCreate({
      where: { produit_id: produitId, point_vente_id: pointVenteId },
      defaults: { prix: nouveauPrix }
    });
    
    if (!created) {
      ancienPrix = prixPv.prix;
      await prixPv.update({ prix: nouveauPrix });
    }
  } else {
    // Mettre à jour le prix par défaut
    ancienPrix = produit.prix_defaut;
    await produit.update({ prix_defaut: nouveauPrix });
  }
  
  // Enregistrer dans l'historique
  await PrixHistorique.create({
    produit_id: produitId,
    point_vente_id: pointVenteId,
    ancien_prix: ancienPrix || null,
    nouveau_prix: nouveauPrix,
    type_modification: ancienPrix ? 'modification' : 'creation',
    modifie_par: modifiePar
  });
  
  invalidateCache();
  
  return { ancienPrix, nouveauPrix };
}

/**
 * Crée un nouveau produit
 */
async function createProduit(data, modifiePar = null) {
  const { nom, categorieId, typeCatalogue, prixDefaut, prixAlternatifs } = data;
  
  const produit = await Produit.create({
    nom,
    categorie_id: categorieId,
    type_catalogue: typeCatalogue,
    prix_defaut: prixDefaut || 0,
    prix_alternatifs: prixAlternatifs || []
  });
  
  // Enregistrer dans l'historique
  await PrixHistorique.create({
    produit_id: produit.id,
    point_vente_id: null,
    ancien_prix: null,
    nouveau_prix: prixDefaut || 0,
    type_modification: 'creation',
    modifie_par: modifiePar
  });
  
  invalidateCache();
  
  return produit;
}

// =====================================================
// HISTORIQUE DES PRIX
// =====================================================

/**
 * Récupère l'historique des prix d'un produit
 */
async function getHistoriquePrix(produitId, limit = 50) {
  return await PrixHistorique.findAll({
    where: { produit_id: produitId },
    include: [{ model: PointVente, as: 'pointVente' }],
    order: [['created_at', 'DESC']],
    limit
  });
}

/**
 * Récupère l'historique global des modifications de prix
 */
async function getHistoriqueGlobal(options = {}) {
  const { limit = 100, offset = 0, startDate, endDate } = options;
  
  const where = {};
  if (startDate || endDate) {
    where.created_at = {};
    if (startDate) where.created_at[Op.gte] = startDate;
    if (endDate) where.created_at[Op.lte] = endDate;
  }
  
  return await PrixHistorique.findAndCountAll({
    where,
    include: [
      { model: Produit, as: 'produit' },
      { model: PointVente, as: 'pointVente' }
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset
  });
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  // Cache
  invalidateCache,
  
  // Points de vente
  getPointsVente,
  getPointsVenteAsLegacy,
  upsertPointVente,
  
  // Utilisateurs
  getUserByUsername,
  getAllUsers,
  getUsersAsLegacy,
  userHasAccessToPointVente,
  createUser,
  updateUser,
  
  // Catégories
  getCategories,
  
  // Produits
  getProduitsAsLegacy,
  getPrixProduit,
  updatePrixProduit,
  createProduit,
  
  // Historique
  getHistoriquePrix,
  getHistoriqueGlobal,
  
  // Accès direct aux modèles (pour cas avancés)
  models: {
    User,
    PointVente,
    UserPointVente,
    Category,
    Produit,
    PrixPointVente,
    PrixHistorique
  }
};

