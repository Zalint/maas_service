/**
 * Gestionnaire des modules côté frontend
 * Gère l'affichage/masquage des onglets et sections selon l'état des modules
 */

// Cache pour l'état des modules
let modulesStatus = null;
let modulesDetails = null;

/**
 * Charger l'état des modules depuis l'API
 * @returns {Promise<Object>} État des modules { moduleId: boolean }
 */
async function loadModulesStatus() {
    try {
        const response = await fetch('/api/modules/status');
        const data = await response.json();
        
        if (data.success) {
            modulesStatus = data.status;
            console.log('✅ État des modules chargé:', modulesStatus);
            return modulesStatus;
        }
        
        console.error('Erreur lors du chargement des modules:', data.message);
        return null;
    } catch (error) {
        console.error('Erreur lors du chargement des modules:', error);
        return null;
    }
}

/**
 * Charger les détails des modules actifs
 * @returns {Promise<Array>} Liste des modules actifs avec leurs détails
 */
async function loadActiveModules() {
    try {
        const response = await fetch('/api/modules/active');
        const data = await response.json();
        
        if (data.success) {
            modulesDetails = data.modules;
            return modulesDetails;
        }
        
        return [];
    } catch (error) {
        console.error('Erreur lors du chargement des modules actifs:', error);
        return [];
    }
}

/**
 * Vérifier si un module est actif
 * @param {string} moduleId - ID du module
 * @returns {boolean} True si le module est actif
 */
function isModuleActive(moduleId) {
    if (!modulesStatus) {
        console.warn('État des modules non chargé');
        return true; // Par défaut, autoriser si pas chargé
    }
    
    // Si le module n'existe pas dans la config, l'autoriser par défaut
    if (modulesStatus[moduleId] === undefined) {
        return true;
    }
    
    return modulesStatus[moduleId];
}

/**
 * Mapping des éléments UI vers les modules
 */
const UI_TO_MODULE_MAP = {
    // Tabs (nav-link IDs)
    'saisie-tab': 'saisie',
    'visualisation-tab': 'visualisation',
    'stock-inventaire-tab': 'stock',
    'copier-stock-tab': 'stock',
    'reconciliation-tab': 'reconciliation',
    'reconciliation-mois-tab': 'reconciliation',
    'stock-alerte-tab': 'audit',
    'cash-payment-tab': 'cash-paiement',
    'suivi-achat-boeuf-tab': 'suivi-achat-boeuf',
    'estimation-tab': 'estimation',
    'precommande-tab': 'precommande',
    'payment-links-tab': 'payment-links',
    
    // Menu items (nav-item IDs)
    'stock-inventaire-item': 'stock',
    'copier-stock-item': 'stock',
    'reconciliation-item': 'reconciliation',
    'reconciliation-mois-item': 'reconciliation',
    'stock-alerte-item': 'audit',
    'cash-payment-item': 'cash-paiement',
    'suivi-achat-boeuf-item': 'suivi-achat-boeuf',
    'estimation-item': 'estimation',
    'precommande-item': 'precommande',
    'payment-links-item': 'payment-links',
    'abonnements-item': 'abonnements',
    
    // Sections
    'saisie-section': 'saisie',
    'visualisation-section': 'visualisation',
    'stock-inventaire-section': 'stock',
    'copier-stock-section': 'stock',
    'reconciliation-section': 'reconciliation',
    'reconciliation-mois-section': 'reconciliation',
    'stock-alerte-section': 'audit',
    'cash-payment-section': 'cash-paiement',
    'suivi-achat-boeuf-section': 'suivi-achat-boeuf',
    'estimation-section': 'estimation',
    'precommande-section': 'precommande',
    'payment-links-section': 'payment-links',

    // POS - Bouton "Decoupe" (envoi commande au Centre de Decoupe)
    'btnOuvrirDecoupe': 'decoupe',
    // POS - Bouton "Commandes inter-PV" (voir les commandes envoyees au CDC)
    'btnInterPV': 'decoupe'
};

/**
 * Obtenir le module associé à un élément UI
 * @param {string} elementId - ID de l'élément
 * @returns {string|null} ID du module ou null
 */
function getModuleForElement(elementId) {
    return UI_TO_MODULE_MAP[elementId] || null;
}

/**
 * Vérifier si un élément UI doit être visible (module actif)
 * @param {string} elementId - ID de l'élément
 * @returns {boolean} True si l'élément doit être visible
 */
function isElementAllowedByModule(elementId) {
    const moduleId = getModuleForElement(elementId);
    
    // Si pas de module associé, autoriser par défaut
    if (!moduleId) {
        return true;
    }
    
    return isModuleActive(moduleId);
}

/**
 * Appliquer la visibilité des modules aux éléments de navigation
 * Cette fonction masque les onglets dont le module est désactivé
 */
function applyModuleVisibility() {
    if (!modulesStatus) {
        console.warn('État des modules non chargé, impossible d\'appliquer la visibilité');
        return;
    }
    
    console.log('🔧 Application de la visibilité des modules...');
    
    // Parcourir tous les éléments mappés
    for (const [elementId, moduleId] of Object.entries(UI_TO_MODULE_MAP)) {
        const element = document.getElementById(elementId);
        
        if (element) {
            const isActive = isModuleActive(moduleId);
            
            if (!isActive) {
                // Module désactivé - masquer l'élément
                element.style.display = 'none';
                element.setAttribute('data-module-disabled', 'true');
                console.log(`🔴 Élément "${elementId}" masqué (module "${moduleId}" désactivé)`);
            } else {
                // Module actif - retirer le flag de désactivation ET reset
                // display pour qu'un element avec style="display:none" initial
                // (anti-FOUC pour module decoupe sur pos.html) redevienne
                // visible. Inline style:'' supprime le inline et laisse les
                // regles CSS reprendre. La visibilite finale depend aussi
                // des droits utilisateur.
                element.removeAttribute('data-module-disabled');
                if (element.style.display === 'none') {
                    element.style.display = '';
                }
            }
        }
    }
    
    console.log('✅ Visibilité des modules appliquée');
}

/**
 * Appliquer la visibilité des éléments spécifiques aux modules
 * (colonnes cash, éléments stock, etc.)
 */
function applyModuleSpecificVisibility() {
    if (!modulesStatus) {
        console.warn('État des modules non chargé, impossible d\'appliquer la visibilité spécifique');
        return;
    }
    
    // Gérer les éléments cash-paiement
    const cashModuleActive = modulesStatus['cash-paiement'] === true;
    const cashElements = document.querySelectorAll('.cash-module-col, .cash-module-card');
    cashElements.forEach(el => {
        if (cashModuleActive) {
            el.classList.remove('cash-module-hidden');
        } else {
            el.classList.add('cash-module-hidden');
            console.log('🔴 Élément cash masqué:', el.textContent?.substring(0, 30) || el.className);
        }
    });
    
    // Gérer les éléments stock/inventaire
    const stockModuleActive = modulesStatus['stock'] === true;
    const stockElements = document.querySelectorAll('.stock-module-element');
    stockElements.forEach(el => {
        if (stockModuleActive) {
            el.classList.remove('stock-module-hidden');
        } else {
            el.classList.add('stock-module-hidden');
            console.log('🔴 Élément stock masqué:', el.id || el.className);
        }
    });
    
    // Gérer les éléments audit
    const auditModuleActive = modulesStatus['audit'] === true;
    const auditElements = document.querySelectorAll('.audit-module-element');
    auditElements.forEach(el => {
        if (auditModuleActive) {
            el.classList.remove('audit-module-hidden');
        } else {
            el.classList.add('audit-module-hidden');
            console.log('🔴 Élément audit masqué:', el.id || el.className);
        }
    });
    
    // Gérer les éléments abonnements
    const abonnementModuleActive = modulesStatus['abonnements'] === true;
    const abonnementElements = document.querySelectorAll('.abonnement-module-element');
    abonnementElements.forEach(el => {
        if (abonnementModuleActive) {
            el.style.display = '';
            el.classList.remove('abonnement-module-hidden');
        } else {
            el.style.display = 'none';
            el.classList.add('abonnement-module-hidden');
            console.log('🔴 Élément abonnement masqué:', el.id || el.className);
        }
    });
    
    console.log(`✅ Visibilité spécifique appliquée (cash: ${cashModuleActive}, stock: ${stockModuleActive}, audit: ${auditModuleActive}, abonnement: ${abonnementModuleActive})`);
}

/**
 * Initialiser le gestionnaire de modules
 * À appeler au chargement de la page
 */
async function initModulesHandler() {
    console.log('🚀 Initialisation du gestionnaire de modules...');
    
    // Charger l'état des modules
    await loadModulesStatus();
    
    // Appliquer la visibilité initiale des menus
    applyModuleVisibility();
    
    // Appliquer la visibilité des éléments spécifiques (colonnes cash, etc.)
    applyModuleSpecificVisibility();
    
    console.log('✅ Gestionnaire de modules initialisé');
}

/**
 * Rafraîchir l'état des modules
 * À appeler après une modification de l'état d'un module
 */
async function refreshModulesStatus() {
    await loadModulesStatus();
    applyModuleVisibility();
    applyModuleSpecificVisibility();
}

/**
 * Fonction utilitaire pour intégrer la vérification des modules
 * dans la fonction afficherOngletsSuivantDroits existante
 * @param {HTMLElement} element - L'élément à vérifier
 * @param {boolean} hasPermission - Si l'utilisateur a la permission
 * @returns {string} 'block' ou 'none'
 */
function getDisplayForElement(elementId, hasPermission) {
    const element = document.getElementById(elementId);
    
    // Si le module est désactivé, toujours masquer
    if (!isElementAllowedByModule(elementId)) {
        return 'none';
    }
    
    // Sinon, se baser sur la permission utilisateur
    return hasPermission ? 'block' : 'none';
}

/**
 * Version améliorée de la gestion de visibilité
 * Combine la vérification des modules ET des permissions utilisateur
 * @param {string} elementId - ID de l'élément
 * @param {boolean} hasUserPermission - Si l'utilisateur a la permission
 */
function setElementVisibility(elementId, hasUserPermission) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const moduleAllowed = isElementAllowedByModule(elementId);
    
    // L'élément est visible uniquement si le module est actif ET l'utilisateur a la permission
    const shouldShow = moduleAllowed && hasUserPermission;
    
    element.style.display = shouldShow ? 'block' : 'none';
    
    if (!moduleAllowed) {
        element.setAttribute('data-module-disabled', 'true');
    } else {
        element.removeAttribute('data-module-disabled');
    }
}

// Exporter les fonctions pour utilisation globale
window.ModulesHandler = {
    init: initModulesHandler,
    loadStatus: loadModulesStatus,
    isModuleActive: isModuleActive,
    isElementAllowed: isElementAllowedByModule,
    applyVisibility: applyModuleVisibility,
    applySpecificVisibility: applyModuleSpecificVisibility,
    refresh: refreshModulesStatus,
    getDisplayForElement: getDisplayForElement,
    setElementVisibility: setElementVisibility,
    getModulesStatus: () => modulesStatus
};

// Auto-initialiser le gestionnaire de modules au chargement du DOM
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔄 Auto-initialisation du gestionnaire de modules...');
    await initModulesHandler();
});

