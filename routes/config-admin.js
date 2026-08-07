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
// La MEME normalisation que le parage, importee et non recopiee.
const { normaliserNom } = require('../lib/parage');

// Tables qui designent un produit par son NOM, sans cle etrangere. Rien
// n'empeche donc de supprimer ou renommer un produit en laissant ces lignes
// pointer dans le vide - c'est ainsi qu'un "OIGNON BLANC" traine 30 lignes de
// stock sans produit au catalogue. Toute fusion doit les renommer TOUTES.
//
// Liste fermee et ecrite en dur: ces noms partent dans du SQL, ils ne doivent
// jamais venir d'une entree utilisateur. Ils sont recoupes avec
// information_schema au moment de l'appel, les tenants n'ayant pas tous le
// meme schema.
const TABLES_PRODUIT_PAR_NOM = [
    'stocks', 'transferts', 'ventes', 'pack_compositions', 'precommandes',
    'fournisseur_prix', 'prix_achat_history', 'prix_vente_history',
    'prix_vente_cdc_history'
];

async function tablesProduitPresentes() {
    const rows = await sequelize.query(
        `SELECT table_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND column_name = 'produit'
           AND table_name IN (:tables)`,
        { type: sequelize.QueryTypes.SELECT, replacements: { tables: TABLES_PRODUIT_PAR_NOM } }
    );
    return rows.map((r) => r.table_name);
}

// Cles "reservees" du config produit inventaire qui ne doivent jamais
// etre traitees comme un prix par point de vente. Le filtre est applique
// dans le POST /produits-inventaire pour eviter qu'un champ booleen ou
// chaine comme 'archived' / 'categorie_affichage' soit converti en prix
// si typeof verification passe par hasard. Hoiste au module-scope pour
// eviter l'allocation N fois dans la boucle traiterProduit.
const INVENTAIRE_RESERVED_CONFIG_KEYS = [
    'prixDefault', 'alternatives', 'mode_stock', 'unite_stock',
    'ventes', 'ventilation_poids', 'archived', 'categorie_affichage'
];

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

// Authentification simple: tout utilisateur connecte (lecteur, user, super*,
// admin). Utilise pour les endpoints de lecture qui exposent uniquement des
// metadonnees de configuration (mode_stock, unite_stock, ventilation_poids,
// prix par defaut) necessaires aux UI cote utilisateur sans expos de donnees
// sensibles.
const requireAuthenticated = (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Non authentifié' });
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
        alternatives: produit.prix_alternatifs ? produit.prix_alternatifs.map(p => parseFloat(p)) : [],
        // Soft-delete flag pour la transition de taxonomie. Inclus dans la
        // reponse admin pour que l'UI puisse afficher/cacher les archives
        // et toggler l'etat. Les endpoints publics (POS/stock) excluent les
        // archives directement via SQL (cf. config-service).
        archived: !!produit.archived
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
router.get('/produits-inventaire', requireAuthenticated, async (req, res) => {
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
        ventilation_poids: !!produit.ventilation_poids,
        // Soft-delete flag pour la transition (cf. GET /produits ci-dessus).
        archived: !!produit.archived,
        // La categorie voyage DANS la config du produit, et non plus seulement
        // comme cle d'imbrication. Un produit et une categorie pouvaient porter
        // le meme nom - il existe un produit "Autres" et une categorie "Autres" -
        // et l'imbrication seule les ecrasait l'un l'autre: le client tranchait
        // "c'est un produit" et les 74 produits de la categorie disparaissaient
        // de l'ecran. Le champ explicite leve l'ambiguite.
        categorie_affichage: produit.categorie_affichage || null
      };

      if (produit.prixParPointVente) {
        for (const prix of produit.prixParPointVente) {
          if (prix.pointVente) {
            config[prix.pointVente.nom] = parseFloat(prix.prix);
          }
        }
      }
      
      // Structure PLATE: une entree par produit, la categorie voyage dans le
      // config (cf. categorie_affichage ci-dessus).
      //
      // L'imbrication par categorie a ete retiree parce qu'elle rendait le
      // payload AMBIGU: une cle pouvait etre un nom de produit ou un nom de
      // categorie, et ce depot contient les deux fois "Autres". Les configs se
      // melangeaient en un objet hybride, et le POST - qui tranche sur la
      // presence de prixDefault - traitait alors 52 produits sur 122: les 70
      // ranges sous "Autres" etaient ignores a CHAQUE sauvegarde, sans erreur.
      if (produit.categorie_affichage) {
        categoriesPersonnalisees.add(produit.categorie_affichage);
      }
      inventaireResult[produit.nom] = config;
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
        // Soft-delete flag pour la transition de taxonomie. On accepte
        // boolean OU undefined. undefined = on ne touche pas au flag
        // existant (admin a post sans le champ — ne pas re-activer un
        // produit archive accidentellement).
        const archivedRequested = (typeof config.archived === 'boolean')
          ? config.archived
          : undefined;

        // Trouver le produit existant ou en créer un nouveau
        let [produit, wasCreated] = await Produit.findOrCreate({
          where: { nom: produitName, type_catalogue: 'vente' },
          defaults: {
            categorie_id: category.id,
            prix_defaut: prixDefaut,
            prix_alternatifs: alternatives,
            archived: archivedRequested === true
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
          const archivedDiffers = (archivedRequested !== undefined) && (!!produit.archived !== archivedRequested);
          if (priceDiffers || altsDiffers || archivedDiffers) {
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
            if (archivedDiffers) {
              updatePayload.archived = archivedRequested;
            }
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

    // Fonction helper pour traiter un produit.
    //
    // categorieCle est la categorie DEDUITE DE L'IMBRICATION (forme historique
    // { Categorie: { Produit: config } }). Elle ne sert plus que de repli: la
    // categorie est desormais portee par le produit lui-meme, dans son config.
    //
    // Cette distinction n'est pas cosmetique. Tant que la categorie ne venait
    // que de la cle, un produit poste a la racine se voyait ecrire
    // categorie_affichage = NULL en base (cf. updatePayload plus bas), en
    // silence et avec success:true. Un client qui envoie une structure plate
    // effacait donc la categorie de TOUS les produits d'un coup.
    async function traiterProduit(produitName, config, categorieCle = null) {
      if (typeof config !== 'object' || config.prixDefault === undefined) return;

      // Le champ present sur le produit fait autorite; s'il est absent (ancien
      // client), on retombe sur la cle d'imbrication. Un champ present mais
      // vide vaut "pas de categorie" et doit pouvoir en effacer une.
      const categorieAffichage = Object.prototype.hasOwnProperty.call(config, 'categorie_affichage')
        ? (config.categorie_affichage || null)
        : categorieCle;

      const prixDefaut = config.prixDefault || 0;
      const alternatives = config.alternatives || [];
      const modeStock = config.mode_stock || 'manuel';
      const uniteStock = config.unite_stock || 'unite';
      const ventilationPoids = !!config.ventilation_poids;
      const ventesList = Array.isArray(config.ventes)
        ? config.ventes.filter((v) => typeof v === 'string' && v.trim().length > 0)
        : [];
      // Soft-delete flag pour la transition. undefined = ne pas toucher.
      const archivedRequested = (typeof config.archived === 'boolean')
        ? config.archived
        : undefined;

      let [produit, wasCreated] = await Produit.findOrCreate({
        where: { nom: produitName, type_catalogue: 'inventaire' },
        defaults: {
          prix_defaut: prixDefaut,
          prix_alternatifs: alternatives,
          mode_stock: modeStock,
          unite_stock: uniteStock,
          categorie_affichage: categorieAffichage,
          ventes: ventesList,
          ventilation_poids: ventilationPoids,
          archived: archivedRequested === true
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
        const archivedDiffers = (archivedRequested !== undefined) && (!!produit.archived !== archivedRequested);
        const needsUpdate = oldPrix !== prixDefaut ||
          JSON.stringify(oldAlternatives) !== JSON.stringify(newAlternatives) ||
          produit.mode_stock !== modeStock ||
          produit.unite_stock !== uniteStock ||
          produit.categorie_affichage !== categorieAffichage ||
          JSON.stringify(oldVentes) !== JSON.stringify(ventesList) ||
          !!produit.ventilation_poids !== ventilationPoids ||
          archivedDiffers;

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

          const updatePayload = {
            prix_defaut: prixDefaut,
            prix_alternatifs: alternatives,
            mode_stock: modeStock,
            unite_stock: uniteStock,
            categorie_affichage: categorieAffichage,
            ventes: ventesList,
            ventilation_poids: ventilationPoids
          };
          if (archivedDiffers) {
            updatePayload.archived = archivedRequested;
          }
          await produit.update(updatePayload);
          updated++;
          console.log(`  🔄 Produit mis à jour: ${produitName}${archivedDiffers ? ` (archived=${archivedRequested})` : ''}`);
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
      // Skip set hoiste au module-scope (INVENTAIRE_RESERVED_CONFIG_KEYS).
      for (const [key, value] of Object.entries(config)) {
        if (!INVENTAIRE_RESERVED_CONFIG_KEYS.includes(key) && typeof value === 'number') {
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
    
    // Le GET emet desormais une structure PLATE. Cette boucle accepte encore la
    // forme imbriquee pour ne pas casser un onglet laisse ouvert avant le
    // deploiement, ou un client tiers: la cle sert alors de repli de categorie.
    for (const [key, config] of Object.entries(produitsInventaire)) {
      if (typeof config !== 'object') continue;

      // Vérifier si c'est un produit direct (a prixDefault) ou une catégorie personnalisée
      if (config.prixDefault !== undefined) {
        // Produit: sa categorie est dans son config, pas dans la cle.
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

// ATTENTION A L'ORDRE. GET '/produits/doublons' doit rester AVANT
// router.get('/produits/:id'): Express retient la premiere route qui
// correspond, et '/produits/doublons' matche '/produits/:id' avec
// id = 'doublons'. Declaree apres, elle ne serait jamais atteinte - c'est
// deja le sort de GET '/produits/by-name', declaree bien plus bas.
//
// Le POST '/produits/doublons/fusionner' n'a pas ce probleme: la seule route
// POST a trois segments declaree avant lui est '/produits/:nom/reattach', et
// son troisieme segment est le litteral 'reattach'. Il est reste plus bas
// dans le fichier, apres les routes /produits/:id.
/**
 * GET /api/admin/config/produits/doublons
 *
 * Detecte les produits en double: meme nom a la normalisation pres (casse et
 * accents ignores) DANS LE MEME catalogue. Lecture seule.
 *
 * Attention a ce qui n'est PAS un doublon: un meme nom present en 'vente' ET
 * en 'inventaire' est le modele normal de ce catalogue - le produit vendu et
 * la matiere stockee portent le meme nom. Les confondre proposerait de
 * fusionner 117 paires parfaitement saines.
 */
router.get('/produits/doublons', requireAdmin, async (req, res) => {
  try {
    const produits = await sequelize.query(
      `SELECT id, nom, type_catalogue, categorie_affichage, archived,
              COALESCE(prix_defaut, 0) AS prix_defaut
       FROM produits ORDER BY id`,
      { type: sequelize.QueryTypes.SELECT }
    );

    // Regroupement par nom normalise PUIS par catalogue. Deux niveaux de Map
    // plutot qu'une cle composite: pas de separateur a choisir, donc pas de
    // caractere a redouter dans un nom de produit.
    const parNom = new Map();
    for (const p of produits) {
      if (p.archived) continue;
      const cle = normaliserNom(p.nom);
      if (!parNom.has(cle)) parNom.set(cle, new Map());
      const parCatalogue = parNom.get(cle);
      if (!parCatalogue.has(p.type_catalogue)) parCatalogue.set(p.type_catalogue, []);
      parCatalogue.get(p.type_catalogue).push(p);
    }
    const enDouble = [];
    for (const parCatalogue of parNom.values()) {
      for (const rows of parCatalogue.values()) {
        if (rows.length > 1) enDouble.push(rows);
      }
    }

    if (!enDouble.length) {
      return res.json({ success: true, groupes: [], tables: await tablesProduitPresentes() });
    }

    // Les graphies distinctes concernees, tous groupes confondus. Le comptage
    // des references se fait par GRAPHIE et non par ligne produit: les tables
    // ci-dessous ne connaissent que le nom, pas le catalogue.
    const graphies = [...new Set(enDouble.flatMap((rows) => rows.map((r) => r.nom)))];

    const tables = await tablesProduitPresentes();
    const refs = new Map();   // graphie -> { table: n }
    for (const table of tables) {
      const rows = await sequelize.query(
        `SELECT produit, COUNT(*)::int AS n FROM "${table}"
         WHERE produit IN (:graphies) GROUP BY produit`,
        { type: sequelize.QueryTypes.SELECT, replacements: { graphies } }
      );
      for (const r of rows) {
        if (!refs.has(r.produit)) refs.set(r.produit, {});
        if (r.n > 0) refs.get(r.produit)[table] = r.n;
      }
    }

    // Liens portes par la colonne ventes (TEXT[]) des produits d'inventaire.
    const liens = await sequelize.query(
      `SELECT v AS graphie, COUNT(*)::int AS n
       FROM produits p, unnest(p.ventes) AS v
       WHERE v IN (:graphies) GROUP BY v`,
      { type: sequelize.QueryTypes.SELECT, replacements: { graphies } }
    );
    for (const l of liens) {
      if (!refs.has(l.graphie)) refs.set(l.graphie, {});
      refs.get(l.graphie)['liens ventes'] = l.n;
    }

    // Prix par point de vente et historique: rattaches par produit_id.
    const parId = await sequelize.query(
      `SELECT p.id,
              (SELECT COUNT(*)::int FROM prix_point_vente pv WHERE pv.produit_id = p.id) AS prix_pv,
              (SELECT COUNT(*)::int FROM prix_historique ph WHERE ph.produit_id = p.id) AS historique
       FROM produits p WHERE p.id IN (:ids)`,
      {
        type: sequelize.QueryTypes.SELECT,
        replacements: { ids: enDouble.flatMap((rows) => rows.map((r) => r.id)) }
      }
    );
    const parIdMap = new Map(parId.map((r) => [r.id, r]));

    const resultat = enDouble.map((rows) => {
      const catalogue = rows[0].type_catalogue;
      const variantes = rows.map((r) => {
        const ref = refs.get(r.nom) || {};
        const idInfo = parIdMap.get(r.id) || { prix_pv: 0, historique: 0 };
        return {
          id: r.id,
          nom: r.nom,
          categorie: r.categorie_affichage || null,
          prix: Number(r.prix_defaut) || 0,
          references: ref,
          total_references: Object.values(ref).reduce((a, b) => a + b, 0),
          prix_pv: idInfo.prix_pv,
          historique: idInfo.historique
        };
      });
      // Suggestion: la graphie la plus referencee. A egalite, la plus ancienne
      // (id le plus petit), qui est celle que les saisies historiques ont
      // utilisee. C'est une SUGGESTION - le choix reste a l'utilisateur.
      const suggestion = variantes.slice().sort((a, b) =>
        (b.total_references - a.total_references) || (a.id - b.id))[0].nom;
      return {
        cle: normaliserNom(rows[0].nom),
        catalogue,
        variantes,
        suggestion,
        categories_divergentes:
          new Set(variantes.map((v) => v.categorie || '')).size > 1
      };
    }).sort((a, b) => a.cle.localeCompare(b.cle) || a.catalogue.localeCompare(b.catalogue));

    res.json({ success: true, groupes: resultat, tables });
  } catch (error) {
    console.error('Erreur detection doublons:', error);
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
/**
 * POST /api/admin/config/produits/doublons/fusionner
 * Body: { cle, catalogue, canonique }
 *
 * Fusionne un groupe vers la graphie canonique. Destructif et transactionnel:
 * soit tout passe, soit rien. La reponse detaille CE QUI A ETE DEPLACE, ligne
 * par table - une fusion qui ne dit pas ce qu'elle a bouge est invérifiable.
 */
router.post('/produits/doublons/fusionner', requireAdmin, async (req, res) => {
  const { cle, catalogue, canonique } = req.body || {};
  if (!cle || !catalogue || !canonique) {
    return res.status(400).json({ success: false, error: 'cle, catalogue et canonique requis' });
  }

  const t = await sequelize.transaction();
  try {
    const rows = await sequelize.query(
      `SELECT id, nom FROM produits
       WHERE type_catalogue = :catalogue AND archived = false ORDER BY id`,
      { type: sequelize.QueryTypes.SELECT, replacements: { catalogue }, transaction: t }
    );
    const groupe = rows.filter((r) => normaliserNom(r.nom) === normaliserNom(cle));

    if (groupe.length < 2) {
      await t.rollback();
      return res.status(404).json({ success: false, error: 'Groupe introuvable ou deja fusionne' });
    }
    if (!groupe.some((r) => r.nom === canonique)) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        error: `"${canonique}" n'est pas une des graphies du groupe`
      });
    }

    const aFusionner = groupe.filter((r) => r.nom !== canonique);
    const autresGraphies = [...new Set(aFusionner.map((r) => r.nom))];
    const deplacements = {};

    // 1. Les tables qui referencent par NOM. Elles ignorent le catalogue: si
    //    la meme graphie existe aussi dans un autre catalogue, ce renommage la
    //    sert aussi, et c'est voulu - le nom est la seule cle qu'elles ont.
    if (autresGraphies.length) {
      for (const table of await tablesProduitPresentes()) {
        const [, meta] = await sequelize.query(
          `UPDATE "${table}" SET produit = :canonique WHERE produit IN (:autres)`,
          { replacements: { canonique, autres: autresGraphies }, transaction: t }
        );
        const n = (meta && meta.rowCount) || 0;
        if (n) deplacements[table] = n;
      }

      // 2. Les liens ventes portes par les produits d'inventaire.
      //
      // La colonne est character varying(255)[], pas text[]: sans cast explicite
      // des DEUX cotes, l'operateur && ne trouve aucune signature et Postgres
      // rejette la requete ("operator does not exist: character varying[] && text[]").
      const [, metaLiens] = await sequelize.query(
        `UPDATE produits SET ventes = (
            SELECT ARRAY(SELECT DISTINCT CASE WHEN v = ANY(ARRAY[:autres]::text[])
                                              THEN :canonique ELSE v END
                         FROM unnest(ventes) AS v))::character varying(255)[]
         WHERE ventes::text[] && ARRAY[:autres]::text[]`,
        { replacements: { canonique, autres: autresGraphies }, transaction: t }
      );
      const nLiens = (metaLiens && metaLiens.rowCount) || 0;
      if (nLiens) deplacements['liens ventes'] = nLiens;
    }

    // 3. Les lignes produits redondantes. On rattache d'abord leurs prix par
    //    point de vente et leur historique a la ligne conservee, sinon la
    //    suppression les emporterait en silence.
    const garde = groupe.find((r) => r.nom === canonique);
    let supprimees = 0;
    for (const r of aFusionner) {
      const [, mPv] = await sequelize.query(
        `UPDATE prix_point_vente pv SET produit_id = :garde
         WHERE pv.produit_id = :perdu
           AND NOT EXISTS (SELECT 1 FROM prix_point_vente x
                            WHERE x.produit_id = :garde
                              AND x.point_vente_id = pv.point_vente_id)`,
        { replacements: { garde: garde.id, perdu: r.id }, transaction: t }
      );
      if (mPv && mPv.rowCount) deplacements['prix par point de vente'] =
        (deplacements['prix par point de vente'] || 0) + mPv.rowCount;

      await sequelize.query(
        `UPDATE prix_historique SET produit_id = :garde WHERE produit_id = :perdu`,
        { replacements: { garde: garde.id, perdu: r.id }, transaction: t }
      );
      // Ce qui n'a pas pu etre rattache (meme point de vente des deux cotes)
      // disparait avec la ligne: on le dit plutot que de le taire.
      const [{ n: pvPerdus }] = await sequelize.query(
        `SELECT COUNT(*)::int AS n FROM prix_point_vente WHERE produit_id = :perdu`,
        { type: sequelize.QueryTypes.SELECT, replacements: { perdu: r.id }, transaction: t }
      );
      if (pvPerdus) deplacements['prix par PV abandonnes (doublon exact)'] =
        (deplacements['prix par PV abandonnes (doublon exact)'] || 0) + pvPerdus;

      await sequelize.query('DELETE FROM prix_point_vente WHERE produit_id = :perdu',
        { replacements: { perdu: r.id }, transaction: t });
      await sequelize.query('DELETE FROM produits WHERE id = :perdu',
        { replacements: { perdu: r.id }, transaction: t });
      supprimees++;
    }

    await t.commit();
    configService.invalidateCache();
    console.log(`Fusion doublons: ${cle} (${catalogue}) -> "${canonique}", `
      + `${supprimees} ligne(s) produit supprimee(s), `
      + `${JSON.stringify(deplacements)} par ${req.session.user?.username}`);

    res.json({
      success: true,
      canonique,
      graphies_fusionnees: autresGraphies,
      lignes_produits_supprimees: supprimees,
      deplacements
    });
  } catch (error) {
    await t.rollback();
    console.error('Erreur fusion doublons:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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

