/**
 * Routes d'administration pour la gestion de la configuration
 * 
 * Ces routes permettent de gérer via API:
 * - Les utilisateurs
 * - Les points de vente
 * - Les catégories
 * - Les produits et leurs prix
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const configService = require('../db/config-service');
const { sequelize } = require('../db');
const { User, PointVente, Category, InventaireCategory, Produit, PrixPointVente, PrixHistorique } = require('../db/models');
const { Op } = require('sequelize');

// Middleware pour vérifier que l'utilisateur est admin
const requireAdmin = (req, res, next) => {
  // Vérifier si l'utilisateur est authentifié et est admin
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Non authentifié' });
  }
  
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Accès réservé aux administrateurs' });
  }
  
  next();
};

// Middleware pour vérifier que l'utilisateur est admin OU superviseur (lecture produits)
const requireAdminOrSupervisor = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Non authentifié' });
  }
  
  const allowedRoles = ['admin', 'superutilisateur', 'superviseur'];
  if (!allowedRoles.includes(req.session.user.role)) {
    return res.status(403).json({ success: false, error: 'Accès réservé aux administrateurs et superviseurs' });
  }
  
  next();
};

// =====================================================
// POINTS DE VENTE
// =====================================================

/**
 * GET /api/admin/points-vente
 * Liste tous les points de vente
 */
router.get('/points-vente', requireAdmin, async (req, res) => {
  try {
    const pointsVente = await PointVente.findAll({ order: [['nom', 'ASC']] });
    
    // Formater pour le frontend
    const result = {};
    for (const pv of pointsVente) {
      result[pv.nom] = { 
        id: pv.id,
        active: pv.active, 
        payment_ref: pv.payment_ref 
      };
    }
    
    res.json({ success: true, pointsVente: result });
  } catch (error) {
    console.error('Erreur récupération points de vente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/points-vente
 * Crée un nouveau point de vente
 */
router.post('/points-vente', requireAdmin, async (req, res) => {
  try {
    const { nom, active = true, payment_ref } = req.body;
    
    if (!nom || nom.trim() === '') {
      return res.status(400).json({ success: false, error: 'Le nom est requis' });
    }
    
    const [pointVente, created] = await PointVente.upsert({
      nom: nom.trim(),
      active,
      payment_ref: payment_ref ? payment_ref.trim().toUpperCase() : null
    }, { returning: true });
    
    configService.invalidateCache();
    res.json({ success: true, data: pointVente, created });
  } catch (error) {
    console.error('Erreur création point de vente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/points-vente/:id
 * Met à jour un point de vente
 */
router.put('/points-vente/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nom, active, payment_ref } = req.body;
    
    const pointVente = await PointVente.findByPk(id);
    if (!pointVente) {
      return res.status(404).json({ success: false, error: 'Point de vente non trouvé' });
    }
    
    await pointVente.update({ 
      nom, 
      active,
      payment_ref: payment_ref ? payment_ref.trim().toUpperCase() : null
    });
    configService.invalidateCache();
    
    res.json({ success: true, data: pointVente });
  } catch (error) {
    console.error('Erreur mise à jour point de vente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/points-vente/:id
 * Supprime un point de vente
 */
router.delete('/points-vente/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const pointVente = await PointVente.findByPk(id);
    if (!pointVente) {
      return res.status(404).json({ success: false, error: 'Point de vente non trouvé' });
    }
    
    await pointVente.destroy();
    configService.invalidateCache();
    
    res.json({ success: true, message: 'Point de vente supprimé' });
  } catch (error) {
    console.error('Erreur suppression point de vente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// UTILISATEURS
// =====================================================

/**
 * GET /api/admin/users
 * Liste tous les utilisateurs
 */
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await configService.getAllUsers();
    // Ne pas renvoyer les mots de passe
    const safeUsers = users.map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      acces_tous_points: u.acces_tous_points,
      active: u.active,
      pointsVente: u.pointsVente,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }));
    res.json({ success: true, data: safeUsers });
  } catch (error) {
    console.error('Erreur récupération utilisateurs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/users
 * Crée un nouvel utilisateur
 */
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, role, pointsVente, accesTousPoints } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username et password requis' });
    }
    
    // Vérifier si l'utilisateur existe déjà
    const existing = await User.findOne({ where: { username } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Ce nom d\'utilisateur existe déjà' });
    }
    
    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await configService.createUser({
      username,
      password: hashedPassword,
      role: role || 'user',
      pointsVente: pointsVente || [],
      accesTousPoints: accesTousPoints || false
    });
    
    res.json({ 
      success: true, 
      data: {
        id: user.id,
        username: user.username,
        role: user.role,
        acces_tous_points: user.acces_tous_points,
        active: user.active
      }
    });
  } catch (error) {
    console.error('Erreur création utilisateur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/users/:id
 * Met à jour un utilisateur
 */
router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, role, pointsVente, accesTousPoints, active } = req.body;
    
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }
    
    // Empêcher de désactiver le dernier admin
    if (role !== 'admin' || active === false) {
      const adminCount = await User.count({ where: { role: 'admin', active: true } });
      if (user.role === 'admin' && adminCount <= 1) {
        return res.status(400).json({ 
          success: false, 
          error: 'Impossible de rétrograder ou désactiver le dernier administrateur' 
        });
      }
    }
    
    const updateData = { username, role, active };
    
    if (accesTousPoints !== undefined) {
      updateData.acces_tous_points = accesTousPoints;
    }
    
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }
    
    if (pointsVente !== undefined) {
      updateData.pointsVente = pointsVente;
      updateData.accesTousPoints = accesTousPoints;
    }
    
    await configService.updateUser(id, updateData);
    
    const updatedUser = await User.findByPk(id, {
      include: [{ model: PointVente, as: 'pointsVente' }]
    });
    
    res.json({ 
      success: true, 
      data: {
        id: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
        acces_tous_points: updatedUser.acces_tous_points,
        active: updatedUser.active,
        pointsVente: updatedUser.pointsVente
      }
    });
  } catch (error) {
    console.error('Erreur mise à jour utilisateur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Supprime un utilisateur
 */
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }
    
    // Empêcher de supprimer le dernier admin
    if (user.role === 'admin') {
      const adminCount = await User.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        return res.status(400).json({ 
          success: false, 
          error: 'Impossible de supprimer le dernier administrateur' 
        });
      }
    }
    
    await user.destroy();
    res.json({ success: true, message: 'Utilisateur supprimé' });
  } catch (error) {
    console.error('Erreur suppression utilisateur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// CATÉGORIES
// =====================================================

/**
 * GET /api/admin/categories
 * Liste toutes les catégories
 */
router.get('/categories', requireAdmin, async (req, res) => {
  try {
    const categories = await configService.getCategories();
    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('Erreur récupération catégories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/categories
 * Crée une nouvelle catégorie
 */
router.post('/categories', requireAdmin, async (req, res) => {
  try {
    const { nom, ordre = 0 } = req.body;
    
    if (!nom || nom.trim() === '') {
      return res.status(400).json({ success: false, error: 'Le nom est requis' });
    }
    
    const category = await Category.create({ nom: nom.trim(), ordre });
    configService.invalidateCache();
    
    res.json({ success: true, data: category });
  } catch (error) {
    console.error('Erreur création catégorie:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/categories/:id
 * Met à jour une catégorie
 */
router.put('/categories/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nom, ordre, famille } = req.body;

    const category = await Category.findByPk(id);
    if (!category) {
      return res.status(404).json({ success: false, error: 'Catégorie non trouvée' });
    }

    const updates = {};
    if (nom !== undefined) updates.nom = nom;
    if (ordre !== undefined) updates.ordre = ordre;
    if (famille !== undefined) {
      if (!['Boucherie', 'Epicerie', 'Autres'].includes(famille)) {
        return res.status(400).json({ success: false, error: 'Famille invalide (attendu: Boucherie, Epicerie, Autres)' });
      }
      updates.famille = famille;
    }

    await category.update(updates);
    configService.invalidateCache();

    res.json({ success: true, data: category });
  } catch (error) {
    console.error('Erreur mise à jour catégorie:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// CATEGORIES D'INVENTAIRE (famille mapping)
// =====================================================

/**
 * GET /api/admin/config/inventaire-categories
 * Renvoie la liste des familles par catégorie d'inventaire
 * (table inventaire_categories). Format: { "Viandes": "Boucherie", ... }
 */
router.get('/inventaire-categories', requireAdminOrSupervisor, async (req, res) => {
  try {
    const rows = await InventaireCategory.findAll();
    const map = {};
    for (const r of rows) {
      map[r.nom] = r.famille;
    }
    res.json({ success: true, familles: map });
  } catch (error) {
    console.error('Erreur récupération inventaire-categories:', error);
    res.status(500).json({ success: false, error: error.message, familles: {} });
  }
});

/**
 * PUT /api/admin/config/inventaire-categories/:nom
 * Upsert: stocke ou met à jour la famille d'une catégorie d'inventaire.
 * Body: { famille: 'Boucherie' | 'Epicerie' | 'Autres' }
 */
router.put('/inventaire-categories/:nom', requireAdmin, async (req, res) => {
  try {
    const { nom } = req.params;
    const { famille } = req.body;
    if (!['Boucherie', 'Epicerie', 'Autres'].includes(famille)) {
      return res.status(400).json({ success: false, error: 'Famille invalide (attendu: Boucherie, Epicerie, Autres)' });
    }
    const [row] = await InventaireCategory.upsert({ nom, famille });
    res.json({ success: true, data: row });
  } catch (error) {
    console.error('Erreur upsert inventaire-categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// PRODUITS
// =====================================================

/**
 * GET /api/admin/config/produits
 * Liste les produits de vente formatés pour l'interface admin
 */
router.get('/produits', requireAdmin, async (req, res) => {
  try {
    const { type_catalogue } = req.query;
    const catalogueType = type_catalogue || 'vente';
    
    const produits = await Produit.findAll({
      where: { type_catalogue: catalogueType },
      include: [
        { model: Category, as: 'categorie' },
        {
          model: PrixPointVente,
          as: 'prixParPointVente',
          include: [{ model: PointVente, as: 'pointVente' }]
        }
      ],
      order: [['nom', 'ASC']]
    });

    // Indexer les parents inventaire pour exposer inventaire_parent sur chaque vente.
    // Calcul léger: une seule requête sur les inventaires de ce tenant.
    let parentByVenteName = {};
    if (catalogueType === 'vente') {
      const inventaires = await Produit.findAll({
        where: { type_catalogue: 'inventaire' },
        attributes: ['nom', 'ventes']
      });
      for (const inv of inventaires) {
        if (Array.isArray(inv.ventes)) {
          for (const venteNom of inv.ventes) {
            parentByVenteName[venteNom] = inv.nom;
          }
        }
      }
    }

    // Construire l'objet structuré par catégories
    const produitsResult = {};

    for (const produit of produits) {
      const categorieName = produit.categorie ? produit.categorie.nom : 'Autres';

      if (!produitsResult[categorieName]) {
        produitsResult[categorieName] = {};
      }

      const config = {
        default: parseFloat(produit.prix_defaut) || 0,
        alternatives: produit.prix_alternatifs ? produit.prix_alternatifs.map(p => parseFloat(p)) : []
      };

      // Ajouter les prix par point de vente
      if (produit.prixParPointVente) {
        for (const prix of produit.prixParPointVente) {
          if (prix.pointVente) {
            config[prix.pointVente.nom] = parseFloat(prix.prix);
          }
        }
      }

      // Lien inventaire: exposer le parent et le flag de détachement sur les produits vente
      if (catalogueType === 'vente') {
        config.prix_personnalise = !!produit.prix_personnalise;
        if (parentByVenteName[produit.nom]) {
          config.inventaire_parent = parentByVenteName[produit.nom];
        }
      }

      produitsResult[categorieName][produit.nom] = config;
    }
    
    // Méta-données par catégorie (famille de regroupement haut niveau).
    // Une seule requête sur Category ici, payload léger; permet au frontend de
    // filtrer Tous / Boucherie / Epicerie / Autres sans round-trip supplémentaire.
    const allCategories = await Category.findAll({ attributes: ['id', 'nom', 'famille', 'ordre'] });
    const categoriesMeta = {};
    for (const c of allCategories) {
      categoriesMeta[c.nom] = { id: c.id, famille: c.famille || 'Autres', ordre: c.ordre };
    }

    console.log('📋 GET /api/admin/config/produits - Catégories:', Object.keys(produitsResult));
    res.json({ success: true, produits: produitsResult, categoriesMeta });
  } catch (error) {
    console.error('Erreur récupération produits:', error);
    res.status(500).json({ success: false, error: error.message, produits: {} });
  }
});

/**
 * GET /api/admin/config/produits-inventaire
 * Liste les produits d'inventaire formatés pour l'interface admin
 * Accessible aux admin, superutilisateur et superviseur
 */
router.get('/produits-inventaire', requireAdminOrSupervisor, async (req, res) => {
  try {
    const produits = await Produit.findAll({
      where: { type_catalogue: 'inventaire' },
      include: [{ 
        model: PrixPointVente, 
        as: 'prixParPointVente',
        include: [{ model: PointVente, as: 'pointVente' }]
      }],
      order: [['nom', 'ASC']]
    });
    
    const inventaireResult = {};
    const categoriesPersonnalisees = new Set();
    
    for (const produit of produits) {
      const config = {
        prixDefault: parseFloat(produit.prix_defaut) || 0,
        alternatives: produit.prix_alternatifs ? produit.prix_alternatifs.map(p => parseFloat(p)) : [],
        mode_stock: produit.mode_stock || 'manuel',
        unite_stock: produit.unite_stock || 'unite',
        ventes: Array.isArray(produit.ventes) ? produit.ventes : [],
        ventilation_poids: !!produit.ventilation_poids
      };
      
      if (produit.prixParPointVente) {
        for (const prix of produit.prixParPointVente) {
          if (prix.pointVente) {
            config[prix.pointVente.nom] = parseFloat(prix.prix);
          }
        }
      }
      
      // Si le produit a une catégorie d'affichage personnalisée, le placer dedans
      if (produit.categorie_affichage) {
        const catName = produit.categorie_affichage;
        categoriesPersonnalisees.add(catName);
        
        if (!inventaireResult[catName]) {
          inventaireResult[catName] = {};
        }
        inventaireResult[catName][produit.nom] = config;
      } else {
        // Produit sans catégorie personnalisée - au niveau racine
        inventaireResult[produit.nom] = config;
      }
    }
    
    console.log('📋 GET /api/admin/config/produits-inventaire - Produits:', produits.length, '- Catégories perso:', [...categoriesPersonnalisees]);
    res.json({ 
      success: true, 
      produitsInventaire: inventaireResult,
      categoriesPersonnalisees: [...categoriesPersonnalisees]
    });
  } catch (error) {
    console.error('Erreur récupération produits inventaire:', error);
    res.status(500).json({ success: false, error: error.message, produitsInventaire: {} });
  }
});

/**
 * GET /api/admin/config/produits-abonnement
 * Liste les produits d'abonnement formatés pour l'interface admin
 */
router.get('/produits-abonnement', requireAdmin, async (req, res) => {
  try {
    const produits = await Produit.findAll({
      where: { type_catalogue: 'abonnement' },
      include: [
        { model: Category, as: 'categorie' },
        { 
          model: PrixPointVente, 
          as: 'prixParPointVente',
          include: [{ model: PointVente, as: 'pointVente' }]
        }
      ],
      order: [['nom', 'ASC']]
    });
    
    const abonnementResult = {};
    
    for (const produit of produits) {
      const categorieName = produit.categorie ? produit.categorie.nom : 'Autres';
      
      if (!abonnementResult[categorieName]) {
        abonnementResult[categorieName] = {};
      }
      
      const config = {
        default: parseFloat(produit.prix_defaut) || 0,
        alternatives: produit.prix_alternatifs ? produit.prix_alternatifs.map(p => parseFloat(p)) : []
      };
      
      if (produit.prixParPointVente) {
        for (const prix of produit.prixParPointVente) {
          if (prix.pointVente) {
            config[prix.pointVente.nom] = parseFloat(prix.prix);
          }
        }
      }
      
      abonnementResult[categorieName][produit.nom] = config;
    }
    
    console.log('📋 GET /api/admin/config/produits-abonnement - Catégories:', Object.keys(abonnementResult));
    res.json({ success: true, produitsAbonnement: abonnementResult });
  } catch (error) {
    console.error('Erreur récupération produits abonnement:', error);
    res.status(500).json({ success: false, error: error.message, produitsAbonnement: {} });
  }
});

/**
 * POST /api/admin/config/produits
 * Sauvegarde la configuration complète des produits de vente
 */
router.post('/produits', requireAdmin, async (req, res) => {
  try {
    const { produits } = req.body;

    if (!produits || typeof produits !== 'object') {
      return res.status(400).json({ success: false, error: 'Configuration produits invalide' });
    }

    const username = req.session.user?.username || 'admin';
    let updated = 0;
    let created = 0;

    // Pré-charger en mémoire ce dont on a besoin pour éviter les N+1 dans la
    // boucle ci-dessous: une map nom→PointVente, et un Set des noms de produits
    // vente liés à un parent inventaire (via la colonne ARRAY ventes). Le coût
    // est de 2 SELECT au lieu de N×M (où N = produits postés, M = clés prix-spéciaux).
    const pointsVenteList = await PointVente.findAll();
    const pointsVenteByNom = new Map(pointsVenteList.map((pv) => [pv.nom, pv]));

    const parentsInventaire = await Produit.findAll({
      where: { type_catalogue: 'inventaire' },
      attributes: ['ventes']
    });
    const ventesAvecParent = new Set();
    for (const inv of parentsInventaire) {
      if (Array.isArray(inv.ventes)) {
        for (const v of inv.ventes) ventesAvecParent.add(v);
      }
    }

    // Pour chaque catégorie
    for (const [categorieName, produitsCategorie] of Object.entries(produits)) {
      if (typeof produitsCategorie !== 'object') continue;
      
      // Trouver ou créer la catégorie
      let [category] = await Category.findOrCreate({
        where: { nom: categorieName },
        defaults: { ordre: 99 }
      });
      
      // Pour chaque produit dans la catégorie
      for (const [produitName, config] of Object.entries(produitsCategorie)) {
        if (typeof config !== 'object') continue;
        
        const prixDefaut = config.default || 0;
        const alternatives = config.alternatives || [];
        
        // Trouver le produit existant ou en créer un nouveau
        let [produit, wasCreated] = await Produit.findOrCreate({
          where: { nom: produitName, type_catalogue: 'vente' },
          defaults: {
            categorie_id: category.id,
            prix_defaut: prixDefaut,
            prix_alternatifs: alternatives
          }
        });
        
        if (wasCreated) {
          created++;
        } else {
          // Mettre à jour si les valeurs ont changé
          const oldPrix = parseFloat(produit.prix_defaut);
          const oldAlternatives = produit.prix_alternatifs || [];
          const priceDiffers = oldPrix !== prixDefaut;
          const altsDiffers = JSON.stringify(oldAlternatives) !== JSON.stringify(alternatives);
          if (priceDiffers || altsDiffers) {
            // Enregistrer l'historique si le prix change
            if (priceDiffers) {
              await PrixHistorique.create({
                produit_id: produit.id,
                ancien_prix: oldPrix,
                nouveau_prix: prixDefaut,
                modifie_par: username
              });
            }

            // Si le produit est lié à un parent inventaire, marquer le prix
            // comme personnalisé pour stopper la propagation automatique.
            // Lookup en mémoire dans le Set préchargé en haut — évite un
            // SELECT par produit posté.
            const updatePayload = {
              categorie_id: category.id,
              prix_defaut: prixDefaut,
              prix_alternatifs: alternatives
            };
            const hasParent = ventesAvecParent.has(produitName);
            if (hasParent && !produit.prix_personnalise) {
              updatePayload.prix_personnalise = true;
              console.log(`  🔒 ${produitName}: prix détaché du parent inventaire`);
            }

            await produit.update(updatePayload);
            updated++;
          }
        }
        
        // Gérer les prix par point de vente — lookup via la map en mémoire
        // pour éviter un SELECT par clé.
        for (const [key, value] of Object.entries(config)) {
          if (key !== 'default' && key !== 'alternatives' && typeof value === 'number') {
            const pointVente = pointsVenteByNom.get(key);
            if (pointVente) {
              await PrixPointVente.upsert({
                produit_id: produit.id,
                point_vente_id: pointVente.id,
                prix: value
              });
            }
          }
        }
      }
    }

    configService.invalidateCache();
    console.log(`✅ Configuration produits sauvegardée: ${created} créés, ${updated} mis à jour`);
    res.json({ success: true, message: `${created} produits créés, ${updated} mis à jour` });
  } catch (error) {
    console.error('Erreur sauvegarde config produits:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/config/produits-inventaire
 * Sauvegarde la configuration complète des produits d'inventaire
 */
router.post('/produits-inventaire', requireAdmin, async (req, res) => {
  try {
    const { produitsInventaire } = req.body;

    if (!produitsInventaire || typeof produitsInventaire !== 'object') {
      return res.status(400).json({ success: false, error: 'Configuration produitsInventaire invalide' });
    }

    // Pré-charger les PointVente et tous les produits vente en mémoire pour
    // éviter les N+1 dans la propagation et les prix par PV.
    const pointsVenteList = await PointVente.findAll();
    const pointsVenteByNom = new Map(pointsVenteList.map((pv) => [pv.nom, pv]));

    const ventesAll = await Produit.findAll({ where: { type_catalogue: 'vente' } });
    const ventesByNom = new Map(ventesAll.map((p) => [p.nom, p]));

    const username = req.session.user?.username || 'admin';
    let updated = 0;
    let created = 0;
    
    let propagated = 0;

    // Fonction helper pour traiter un produit
    async function traiterProduit(produitName, config, categorieAffichage = null) {
      if (typeof config !== 'object' || config.prixDefault === undefined) return;

      const prixDefaut = config.prixDefault || 0;
      const alternatives = config.alternatives || [];
      const modeStock = config.mode_stock || 'manuel';
      const uniteStock = config.unite_stock || 'unite';
      const ventilationPoids = !!config.ventilation_poids;
      const ventesList = Array.isArray(config.ventes)
        ? config.ventes.filter((v) => typeof v === 'string' && v.trim().length > 0)
        : [];

      let [produit, wasCreated] = await Produit.findOrCreate({
        where: { nom: produitName, type_catalogue: 'inventaire' },
        defaults: {
          prix_defaut: prixDefaut,
          prix_alternatifs: alternatives,
          mode_stock: modeStock,
          unite_stock: uniteStock,
          categorie_affichage: categorieAffichage,
          ventes: ventesList,
          ventilation_poids: ventilationPoids
        }
      });

      let priceChanged = false;

      if (wasCreated) {
        created++;
        priceChanged = true;
        console.log(`  ✅ Produit créé: ${produitName}${categorieAffichage ? ` (catégorie: ${categorieAffichage})` : ''}`);
      } else {
        const oldPrix = parseFloat(produit.prix_defaut);
        // DECIMAL[] revient de Postgres comme tableau de strings.
        // On normalise en numbers avant comparaison sinon JSON.stringify(["3700.00"]) !== JSON.stringify([3700])
        // déclenche faussement priceChanged à chaque save.
        const oldAlternatives = (produit.prix_alternatifs || []).map((p) => parseFloat(p));
        const newAlternatives = (alternatives || []).map((p) => parseFloat(p));
        const oldVentes = Array.isArray(produit.ventes) ? produit.ventes : [];
        const needsUpdate = oldPrix !== prixDefaut ||
          JSON.stringify(oldAlternatives) !== JSON.stringify(newAlternatives) ||
          produit.mode_stock !== modeStock ||
          produit.unite_stock !== uniteStock ||
          produit.categorie_affichage !== categorieAffichage ||
          JSON.stringify(oldVentes) !== JSON.stringify(ventesList) ||
          !!produit.ventilation_poids !== ventilationPoids;

        if (needsUpdate) {
          if (oldPrix !== prixDefaut) {
            await PrixHistorique.create({
              produit_id: produit.id,
              ancien_prix: oldPrix,
              nouveau_prix: prixDefaut,
              modifie_par: username
            });
            priceChanged = true;
          }
          if (JSON.stringify(oldAlternatives) !== JSON.stringify(newAlternatives)) {
            priceChanged = true;
          }

          await produit.update({
            prix_defaut: prixDefaut,
            prix_alternatifs: alternatives,
            mode_stock: modeStock,
            unite_stock: uniteStock,
            categorie_affichage: categorieAffichage,
            ventes: ventesList,
            ventilation_poids: ventilationPoids
          });
          updated++;
          console.log(`  🔄 Produit mis à jour: ${produitName}`);
        }
      }

      // Propagation du prix vers les produits vente liés non détachés.
      // Ne déclenche que si prix_defaut ou alternatives ont effectivement changé.
      // Utilise la map ventesByNom préchargée + bulkCreate/UPDATE pour éviter
      // les N+1 quand plusieurs produits inventaire sont sauvegardés en une fois.
      if (priceChanged && ventesList.length > 0) {
        const enfantsAttachs = ventesList
          .map((nom) => ventesByNom.get(nom))
          .filter((p) => p && !p.prix_personnalise);
        if (enfantsAttachs.length > 0) {
          const historiqueRows = [];
          const enfantsIdsToUpdate = [];
          for (const enfant of enfantsAttachs) {
            const oldEnfantPrix = parseFloat(enfant.prix_defaut);
            if (oldEnfantPrix !== prixDefaut) {
              historiqueRows.push({
                produit_id: enfant.id,
                ancien_prix: oldEnfantPrix,
                nouveau_prix: prixDefaut,
                modifie_par: `${username} (propagation depuis ${produitName})`
              });
            }
            enfantsIdsToUpdate.push(enfant.id);
            // Refléter en mémoire pour cohérence si une autre itération relit
            enfant.prix_defaut = prixDefaut;
            enfant.prix_alternatifs = alternatives;
            propagated++;
            console.log(`    🔗 Propagation: ${produitName} → ${enfant.nom} (prix=${prixDefaut})`);
          }
          if (historiqueRows.length > 0) {
            await PrixHistorique.bulkCreate(historiqueRows);
          }
          await Produit.update(
            { prix_defaut: prixDefaut, prix_alternatifs: alternatives },
            { where: { id: enfantsIdsToUpdate } }
          );
        }
      }
      
      // Prix par point de vente — lookup via map en mémoire.
      for (const [key, value] of Object.entries(config)) {
        if (!['prixDefault', 'alternatives', 'mode_stock', 'unite_stock', 'ventes'].includes(key) && typeof value === 'number') {
          const pointVente = pointsVenteByNom.get(key);
          if (pointVente) {
            await PrixPointVente.upsert({
              produit_id: produit.id,
              point_vente_id: pointVente.id,
              prix: value
            });
          }
        }
      }
    }
    
    for (const [key, config] of Object.entries(produitsInventaire)) {
      if (typeof config !== 'object') continue;
      
      // Vérifier si c'est un produit direct (a prixDefault) ou une catégorie personnalisée
      if (config.prixDefault !== undefined) {
        // C'est un produit direct (catégorie logique)
        await traiterProduit(key, config, null);
      } else {
        // C'est une catégorie personnalisée - traiter les sous-produits
        console.log(`📁 Catégorie personnalisée détectée: ${key}`);
        for (const [subProduitName, subConfig] of Object.entries(config)) {
          if (typeof subConfig === 'object' && subConfig.prixDefault !== undefined) {
            await traiterProduit(subProduitName, subConfig, key);
          }
        }
      }
    }
    
    configService.invalidateCache();
    const propagSuffix = propagated > 0 ? `, ${propagated} prix propagés vers les ventes liées` : '';
    console.log(`✅ Configuration inventaire sauvegardée: ${created} créés, ${updated} mis à jour${propagSuffix}`);
    res.json({
      success: true,
      message: `${created} produits créés, ${updated} mis à jour${propagSuffix}`,
      propagated
    });
  } catch (error) {
    console.error('Erreur sauvegarde config inventaire:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/config/produits/:nom/reattach
 * Réattache un produit vente à son parent inventaire: remet
 * prix_personnalise=false et resynchronise prix_defaut + prix_alternatifs
 * depuis le parent (si présent).
 */
router.post('/produits/:nom/reattach', requireAdmin, async (req, res) => {
  try {
    const nom = req.params.nom;
    const username = req.session.user?.username || 'admin';

    const produit = await Produit.findOne({
      where: { nom, type_catalogue: 'vente' }
    });
    if (!produit) {
      return res.status(404).json({ success: false, error: 'Produit vente introuvable' });
    }

    // Requête brute pour éviter le souci de cast TEXT[] avec Op.contains.
    const parentRows = await sequelize.query(
      `SELECT id FROM produits WHERE type_catalogue = 'inventaire' AND :nom = ANY(ventes) LIMIT 1`,
      { replacements: { nom }, type: sequelize.QueryTypes.SELECT }
    );
    const parent = parentRows && parentRows.length > 0
      ? await Produit.findByPk(parentRows[0].id)
      : null;
    if (!parent) {
      return res.status(400).json({
        success: false,
        error: `Le produit "${nom}" n'est lié à aucun produit inventaire — rien à réattacher.`
      });
    }

    const oldPrix = parseFloat(produit.prix_defaut);
    const newPrix = parseFloat(parent.prix_defaut);
    if (oldPrix !== newPrix) {
      await PrixHistorique.create({
        produit_id: produit.id,
        ancien_prix: oldPrix,
        nouveau_prix: newPrix,
        modifie_par: `${username} (réattachement à ${parent.nom})`
      });
    }

    await produit.update({
      prix_defaut: newPrix,
      prix_alternatifs: parent.prix_alternatifs || [],
      prix_personnalise: false
    });

    configService.invalidateCache();
    console.log(`🔓 ${nom} réattaché à ${parent.nom} (prix=${newPrix})`);
    res.json({
      success: true,
      message: `"${nom}" réattaché à "${parent.nom}". Prix resynchronisé à ${newPrix}.`,
      parent: parent.nom,
      prix_defaut: newPrix
    });
  } catch (error) {
    console.error('Erreur réattachement produit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/config/produits-abonnement
 * Sauvegarde la configuration complète des produits d'abonnement
 */
router.post('/produits-abonnement', requireAdmin, async (req, res) => {
  try {
    const { produitsAbonnement } = req.body;
    
    if (!produitsAbonnement || typeof produitsAbonnement !== 'object') {
      return res.status(400).json({ success: false, error: 'Configuration produitsAbonnement invalide' });
    }
    
    const username = req.session.user?.username || 'admin';
    let updated = 0;
    let created = 0;
    
    for (const [categorieName, produitsCategorie] of Object.entries(produitsAbonnement)) {
      if (typeof produitsCategorie !== 'object') continue;
      
      let [category] = await Category.findOrCreate({
        where: { nom: categorieName },
        defaults: { ordre: 99 }
      });
      
      for (const [produitName, config] of Object.entries(produitsCategorie)) {
        if (typeof config !== 'object') continue;
        
        const prixDefaut = config.default || 0;
        const alternatives = config.alternatives || [];
        
        let [produit, wasCreated] = await Produit.findOrCreate({
          where: { nom: produitName, type_catalogue: 'abonnement' },
          defaults: {
            categorie_id: category.id,
            prix_defaut: prixDefaut,
            prix_alternatifs: alternatives
          }
        });
        
        if (wasCreated) {
          created++;
        } else {
          const oldPrix = parseFloat(produit.prix_defaut);
          if (oldPrix !== prixDefaut || JSON.stringify(produit.prix_alternatifs) !== JSON.stringify(alternatives)) {
            if (oldPrix !== prixDefaut) {
              await PrixHistorique.create({
                produit_id: produit.id,
                ancien_prix: oldPrix,
                nouveau_prix: prixDefaut,
                modifie_par: username
              });
            }
            
            await produit.update({
              categorie_id: category.id,
              prix_defaut: prixDefaut,
              prix_alternatifs: alternatives
            });
            updated++;
          }
        }
        
        for (const [key, value] of Object.entries(config)) {
          if (key !== 'default' && key !== 'alternatives' && typeof value === 'number') {
            const pointVente = await PointVente.findOne({ where: { nom: key } });
            if (pointVente) {
              await PrixPointVente.upsert({
                produit_id: produit.id,
                point_vente_id: pointVente.id,
                prix: value
              });
            }
          }
        }
      }
    }
    
    configService.invalidateCache();
    console.log(`✅ Configuration abonnement sauvegardée: ${created} créés, ${updated} mis à jour`);
    res.json({ success: true, message: `${created} produits créés, ${updated} mis à jour` });
  } catch (error) {
    console.error('Erreur sauvegarde config abonnement:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/produits/:id
 * Récupère un produit avec son historique de prix
 */
router.get('/produits/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const produit = await Produit.findByPk(id, {
      include: [
        { model: Category, as: 'categorie' },
        { 
          model: PrixPointVente, 
          as: 'prixParPointVente',
          include: [{ model: PointVente, as: 'pointVente' }]
        },
        { 
          model: PrixHistorique, 
          as: 'historiquePrix',
          include: [{ model: PointVente, as: 'pointVente' }],
          order: [['created_at', 'DESC']],
          limit: 50
        }
      ]
    });
    
    if (!produit) {
      return res.status(404).json({ success: false, error: 'Produit non trouvé' });
    }
    
    res.json({ success: true, data: produit });
  } catch (error) {
    console.error('Erreur récupération produit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/produits
 * Crée un nouveau produit
 */
router.post('/produits', requireAdmin, async (req, res) => {
  try {
    const { nom, categorie_id, type_catalogue, prix_defaut, prix_alternatifs } = req.body;
    
    if (!nom || !type_catalogue) {
      return res.status(400).json({ success: false, error: 'Nom et type_catalogue requis' });
    }
    
    const produit = await configService.createProduit({
      nom,
      categorieId: categorie_id,
      typeCatalogue: type_catalogue,
      prixDefaut: prix_defaut || 0,
      prixAlternatifs: prix_alternatifs || []
    }, req.session.user?.username);
    
    res.json({ success: true, data: produit });
  } catch (error) {
    console.error('Erreur création produit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/admin/produits/:id
 * Met à jour un produit
 */
router.put('/produits/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nom, categorie_id, prix_defaut, prix_alternatifs } = req.body;
    
    const produit = await Produit.findByPk(id);
    if (!produit) {
      return res.status(404).json({ success: false, error: 'Produit non trouvé' });
    }
    
    // Si le prix par défaut change, enregistrer dans l'historique
    if (prix_defaut !== undefined && prix_defaut !== parseFloat(produit.prix_defaut)) {
      await configService.updatePrixProduit(
        id, 
        prix_defaut, 
        null, 
        req.session.user?.username
      );
    }
    
    await produit.update({ 
      nom, 
      categorie_id,
      prix_alternatifs: prix_alternatifs || produit.prix_alternatifs
    });
    
    configService.invalidateCache();
    
    const updatedProduit = await Produit.findByPk(id, {
      include: [
        { model: Category, as: 'categorie' },
        { model: PrixPointVente, as: 'prixParPointVente' }
      ]
    });
    
    res.json({ success: true, data: updatedProduit });
  } catch (error) {
    console.error('Erreur mise à jour produit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/config/produits/by-name
 * Supprime un produit par son nom et type_catalogue
 * Accepte les paramètres via query string OU body
 * ⚠️ IMPORTANT: Cette route DOIT être AVANT /produits/:id pour éviter le conflit de paramètres
 */
router.delete('/produits/by-name', requireAdmin, async (req, res) => {
  try {
    // Accepter les paramètres via query string ou body
    const nom = req.query.nom || req.body?.nom;
    const type_catalogue = req.query.type_catalogue || req.body?.type_catalogue;

    if (!nom || !type_catalogue) {
      return res.status(400).json({ success: false, error: 'Nom et type_catalogue requis' });
    }

    const produit = await Produit.findOne({
      where: { nom, type_catalogue }
    });

    if (!produit) {
      return res.status(404).json({ success: false, error: `Produit "${nom}" non trouvé dans ${type_catalogue}` });
    }

    // Supprimer les enregistrements liés AVANT de supprimer le produit
    await PrixHistorique.destroy({ where: { produit_id: produit.id } });
    await PrixPointVente.destroy({ where: { produit_id: produit.id } });

    // Supprimer le produit
    await produit.destroy();
    configService.invalidateCache();

    console.log(`🗑️ Produit supprimé: ${nom} (${type_catalogue}) par ${req.session.user?.username}`);
    res.json({ success: true, message: `Produit "${nom}" supprimé` });
  } catch (error) {
    console.error('Erreur suppression produit par nom:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/produits/:id
 * Supprime un produit par ID
 */
router.delete('/produits/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const produit = await Produit.findByPk(id);
    if (!produit) {
      return res.status(404).json({ success: false, error: 'Produit non trouvé' });
    }
    
    await produit.destroy();
    configService.invalidateCache();
    
    res.json({ success: true, message: 'Produit supprimé' });
  } catch (error) {
    console.error('Erreur suppression produit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// PRIX PAR POINT DE VENTE
// =====================================================

/**
 * POST /api/admin/produits/:id/prix
 * Ajoute ou met à jour un prix spécifique pour un point de vente
 */
router.post('/produits/:id/prix', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { point_vente_id, prix } = req.body;
    
    if (!point_vente_id || prix === undefined) {
      return res.status(400).json({ success: false, error: 'point_vente_id et prix requis' });
    }
    
    const result = await configService.updatePrixProduit(
      id, 
      prix, 
      point_vente_id, 
      req.session.user?.username
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Erreur mise à jour prix:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/admin/produits/:id/prix/:pointVenteId
 * Supprime un prix spécifique pour un point de vente
 */
router.delete('/produits/:id/prix/:pointVenteId', requireAdmin, async (req, res) => {
  try {
    const { id, pointVenteId } = req.params;
    
    const prixPv = await PrixPointVente.findOne({
      where: { produit_id: id, point_vente_id: pointVenteId }
    });
    
    if (!prixPv) {
      return res.status(404).json({ success: false, error: 'Prix non trouvé' });
    }
    
    // Enregistrer la suppression dans l'historique
    await PrixHistorique.create({
      produit_id: id,
      point_vente_id: pointVenteId,
      ancien_prix: prixPv.prix,
      nouveau_prix: 0,
      type_modification: 'suppression',
      modifie_par: req.session.user?.username
    });
    
    await prixPv.destroy();
    configService.invalidateCache();
    
    res.json({ success: true, message: 'Prix supprimé' });
  } catch (error) {
    console.error('Erreur suppression prix:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/config/produits/by-name
 * Récupère un produit par nom et type_catalogue
 */
router.get('/produits/by-name', requireAdmin, async (req, res) => {
  try {
    const { nom, type_catalogue } = req.query;
    
    if (!nom || !type_catalogue) {
      return res.status(400).json({ success: false, error: 'Nom et type_catalogue requis' });
    }
    
    const produit = await Produit.findOne({
      where: { nom, type_catalogue },
      include: [
        { model: Category, as: 'categorie' },
        {
          model: PrixPointVente,
          as: 'prixParPointVente',
          include: [{ model: PointVente, as: 'pointVente' }]
        }
      ]
    });
    
    if (!produit) {
      return res.status(404).json({ success: false, error: 'Produit non trouvé' });
    }
    
    res.json({ success: true, data: produit });
  } catch (error) {
    console.error('Erreur récupération produit par nom:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// HISTORIQUE
// =====================================================

/**
 * GET /api/admin/historique
 * Récupère l'historique global des modifications de prix
 */
router.get('/historique', requireAdmin, async (req, res) => {
  try {
    const { limit = 100, offset = 0, startDate, endDate } = req.query;
    
    const result = await configService.getHistoriqueGlobal({
      limit: parseInt(limit),
      offset: parseInt(offset),
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null
    });
    
    res.json({ 
      success: true, 
      data: result.rows,
      total: result.count
    });
  } catch (error) {
    console.error('Erreur récupération historique:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

