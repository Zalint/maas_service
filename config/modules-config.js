/**
 * Configuration des modules de l'application
 * Chaque module regroupe des fonctionnalités liées (menus, sections UI, routes API)
 * 
 * Structure d'un module:
 * - id: Identifiant unique du module
 * - name: Nom affiché
 * - description: Description du module
 * - active: Si le module est activé ou non
 * - tabs: Liste des IDs des onglets HTML liés
 * - sections: Liste des IDs des sections HTML liées
 * - menuItems: Liste des IDs des éléments de menu liés
 * - apiPrefixes: Préfixes des routes API appartenant à ce module
 */

const fs = require('fs');
const path = require('path');

// Chemin vers le fichier de configuration persistant
const CONFIG_FILE_PATH = path.join(__dirname, 'modules-state.json');

// Configuration par défaut des modules
const DEFAULT_MODULES = {
    saisie: {
        id: 'saisie',
        name: 'Saisie',
        description: 'Saisie des ventes quotidiennes',
        active: true,
        isCore: true, // Module essentiel, ne peut pas être désactivé
        tabs: ['saisie-tab'],
        sections: ['saisie-section'],
        menuItems: [],
        apiPrefixes: [
            '/api/ventes',
            '/api/produits',
            '/api/points-vente'
        ]
    },
    visualisation: {
        id: 'visualisation',
        name: 'Visualisation',
        description: 'Visualisation et analyse des données de ventes',
        active: true,
        isCore: false,
        tabs: ['visualisation-tab'],
        sections: ['visualisation-section'],
        menuItems: [],
        apiPrefixes: [
            '/api/visualisation',
            '/api/analytics',
            '/api/dashboard'
        ]
    },
    stock: {
        id: 'stock',
        name: 'Stock',
        description: 'Gestion des stocks (inventaire et copie)',
        active: true,
        isCore: false,
        tabs: ['stock-inventaire-tab', 'copier-stock-tab'],
        sections: ['stock-inventaire-section', 'copier-stock-section'],
        menuItems: ['stock-inventaire-item', 'copier-stock-item'],
        apiPrefixes: [
            '/api/stock',
            '/api/stocks',
            '/api/inventaire',
            '/api/copier-stock',
            '/api/transferts'
        ]
    },
    reconciliation: {
        id: 'reconciliation',
        name: 'Réconciliation',
        description: 'Réconciliation quotidienne et mensuelle',
        active: true,
        isCore: false,
        tabs: ['reconciliation-tab', 'reconciliation-mois-tab'],
        sections: ['reconciliation-section', 'reconciliation-mois-section'],
        menuItems: ['reconciliation-item', 'reconciliation-mois-item'],
        apiPrefixes: [
            '/api/reconciliation',
            '/api/reconciliations'
        ]
    },
    audit: {
        id: 'audit',
        name: 'Audit',
        description: 'Audit et alertes de stock',
        active: true,
        isCore: false,
        tabs: ['stock-alerte-tab'],
        sections: ['stock-alerte-section'],
        menuItems: ['stock-alerte-item'],
        apiPrefixes: [
            '/api/audit',
            '/api/stock-alerte',
            '/api/alertes'
        ]
    },
    'cash-paiement': {
        id: 'cash-paiement',
        name: 'Cash Paiement',
        description: 'Gestion des paiements en espèces',
        active: true,
        isCore: false,
        tabs: ['cash-payment-tab'],
        sections: ['cash-payment-section'],
        menuItems: ['cash-payment-item'],
        apiPrefixes: [
            '/api/cash-payment',
            '/api/cash-payments'
        ]
    },
    'suivi-achat-boeuf': {
        id: 'suivi-achat-boeuf',
        name: 'Suivi Achat Boeuf',
        description: 'Suivi des achats de boeuf et performance',
        active: true,
        isCore: false,
        tabs: ['suivi-achat-boeuf-tab'],
        sections: ['suivi-achat-boeuf-section'],
        menuItems: ['suivi-achat-boeuf-item'],
        apiPrefixes: [
            '/api/achat-boeuf',
            '/api/achats-boeuf',
            '/api/depenses',
            '/api/weight-params',
            '/api/performance-achat'
        ]
    },
    estimation: {
        id: 'estimation',
        name: 'Estimation',
        description: 'Estimations et prévisions',
        active: true,
        isCore: false,
        tabs: ['estimation-tab'],
        sections: ['estimation-section'],
        menuItems: ['estimation-item'],
        apiPrefixes: [
            '/api/estimation',
            '/api/estimations'
        ]
    },
    precommande: {
        id: 'precommande',
        name: 'Pré-commande Clients',
        description: 'Gestion des pré-commandes clients',
        active: true,
        isCore: false,
        tabs: ['precommande-tab'],
        sections: ['precommande-section'],
        menuItems: ['precommande-item'],
        apiPrefixes: [
            '/api/precommande',
            '/api/precommandes'
        ]
    },
    'payment-links': {
        id: 'payment-links',
        name: 'Générer Paiement',
        description: 'Génération de liens de paiement',
        active: true,
        isCore: false,
        tabs: ['payment-links-tab'],
        sections: ['payment-links-section'],
        menuItems: ['payment-links-item'],
        apiPrefixes: [
            '/api/payment-links',
            '/api/payments'
        ]
    },
    abonnements: {
        id: 'abonnements',
        name: 'Abonnements',
        description: 'Gestion des abonnements clients',
        active: true,
        isCore: false,
        tabs: [],
        sections: [],
        menuItems: ['abonnements-item'],
        apiPrefixes: [
            '/api/abonnements',
            '/api/clients-abonnes'
        ]
    },
    decoupe: {
        id: 'decoupe',
        name: 'Centre de Découpe',
        description: 'Bouton "Découpe" dans le POS + envoi de commandes au Centre de Découpe',
        active: false,
        isCore: false,
        tabs: [],
        sections: [],
        menuItems: [],
        apiPrefixes: [
            '/api/decoupe'
        ]
    }
};

/**
 * Charge l'état des modules depuis le fichier de configuration
 * @returns {Object} État des modules (fusionné avec la config par défaut)
 */
function loadModulesState() {
    try {
        if (fs.existsSync(CONFIG_FILE_PATH)) {
            const savedState = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
            
            // Fusionner avec la configuration par défaut
            const mergedModules = { ...DEFAULT_MODULES };
            
            for (const moduleId in savedState) {
                if (mergedModules[moduleId]) {
                    mergedModules[moduleId] = {
                        ...mergedModules[moduleId],
                        active: savedState[moduleId].active
                    };
                }
            }
            
            return mergedModules;
        }
    } catch (error) {
        console.error('Erreur lors du chargement de l\'état des modules:', error);
    }
    
    return { ...DEFAULT_MODULES };
}

/**
 * Sauvegarde l'état des modules dans le fichier de configuration
 * @param {Object} modules - État des modules à sauvegarder
 */
function saveModulesState(modules) {
    try {
        // Ne sauvegarder que l'état actif de chaque module
        const stateToSave = {};
        for (const moduleId in modules) {
            stateToSave[moduleId] = {
                active: modules[moduleId].active
            };
        }
        
        fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(stateToSave, null, 2), 'utf8');
        console.log('✅ État des modules sauvegardé');
        return true;
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de l\'état des modules:', error);
        return false;
    }
}

// Charger l'état des modules au démarrage
let modules = loadModulesState();

/**
 * Obtenir tous les modules (recharge depuis le fichier pour avoir les données fraîches)
 * @returns {Object} Tous les modules
 */
function getAllModules() {
    // Recharger depuis le fichier pour avoir les données à jour
    modules = loadModulesState();
    return modules;
}

/**
 * Obtenir un module par son ID
 * @param {string} moduleId - ID du module
 * @returns {Object|null} Le module ou null s'il n'existe pas
 */
function getModule(moduleId) {
    return modules[moduleId] || null;
}

/**
 * Vérifier si un module est actif
 * @param {string} moduleId - ID du module
 * @returns {boolean} True si le module est actif
 */
function isModuleActive(moduleId) {
    const module = modules[moduleId];
    return module ? module.active : false;
}

/**
 * Activer un module
 * @param {string} moduleId - ID du module
 * @returns {boolean} Succès de l'opération
 */
function activateModule(moduleId) {
    if (modules[moduleId]) {
        modules[moduleId].active = true;
        saveModulesState(modules);
        console.log(`✅ Module "${moduleId}" activé`);
        return true;
    }
    return false;
}

/**
 * Désactiver un module
 * @param {string} moduleId - ID du module
 * @returns {boolean} Succès de l'opération
 */
function deactivateModule(moduleId) {
    const module = modules[moduleId];
    if (module) {
        // Ne pas permettre la désactivation des modules essentiels
        if (module.isCore) {
            console.warn(`⚠️ Le module "${moduleId}" est essentiel et ne peut pas être désactivé`);
            return false;
        }
        module.active = false;
        saveModulesState(modules);
        console.log(`🔴 Module "${moduleId}" désactivé`);
        return true;
    }
    return false;
}

/**
 * Basculer l'état d'un module (activer/désactiver)
 * @param {string} moduleId - ID du module
 * @returns {boolean} Nouvel état du module (true = actif)
 */
function toggleModule(moduleId) {
    const module = modules[moduleId];
    if (module) {
        if (module.isCore && module.active) {
            console.warn(`⚠️ Le module "${moduleId}" est essentiel et ne peut pas être désactivé`);
            return true;
        }
        module.active = !module.active;
        saveModulesState(modules);
        console.log(`${module.active ? '✅' : '🔴'} Module "${moduleId}" ${module.active ? 'activé' : 'désactivé'}`);
        return module.active;
    }
    return false;
}

/**
 * Obtenir la liste des modules actifs
 * @returns {Array} Liste des modules actifs
 */
function getActiveModules() {
    return Object.values(modules).filter(m => m.active);
}

/**
 * Obtenir la liste des modules inactifs
 * @returns {Array} Liste des modules inactifs
 */
function getInactiveModules() {
    return Object.values(modules).filter(m => !m.active);
}

/**
 * Trouver le module qui gère une route API donnée
 * @param {string} apiPath - Chemin de la route API
 * @returns {Object|null} Le module ou null
 */
function findModuleForApiPath(apiPath) {
    for (const moduleId in modules) {
        const module = modules[moduleId];
        for (const prefix of module.apiPrefixes) {
            if (apiPath.startsWith(prefix)) {
                return module;
            }
        }
    }
    return null;
}

/**
 * Vérifier si une route API est autorisée (module actif)
 * @param {string} apiPath - Chemin de la route API
 * @returns {boolean} True si la route est autorisée
 */
function isApiPathAllowed(apiPath) {
    const module = findModuleForApiPath(apiPath);
    
    // Si aucun module ne correspond, autoriser par défaut (routes système)
    if (!module) {
        return true;
    }
    
    return module.active;
}

/**
 * Recharger la configuration des modules depuis le fichier
 */
function reloadModules() {
    modules = loadModulesState();
    console.log('🔄 Configuration des modules rechargée');
    return modules;
}

module.exports = {
    getAllModules,
    getModule,
    isModuleActive,
    activateModule,
    deactivateModule,
    toggleModule,
    getActiveModules,
    getInactiveModules,
    findModuleForApiPath,
    isApiPathAllowed,
    reloadModules,
    saveModulesState,
    DEFAULT_MODULES
};

