/**
 * Middleware de gestion des modules
 * Vérifie si un module est actif avant d'autoriser l'accès aux routes
 */

const { 
    isModuleActive, 
    findModuleForApiPath, 
    isApiPathAllowed,
    getModule
} = require('../config/modules-config');

/**
 * Middleware générique pour vérifier si le module correspondant à la route est actif
 * À utiliser sur les routes API
 */
const checkModuleActive = (req, res, next) => {
    const apiPath = req.path;
    
    // Vérifier si la route est autorisée
    if (isApiPathAllowed(apiPath)) {
        return next();
    }
    
    // Trouver le module pour donner un message d'erreur précis
    const module = findModuleForApiPath(apiPath);
    const moduleName = module ? module.name : 'inconnu';
    
    return res.status(403).json({
        success: false,
        message: `Module "${moduleName}" désactivé`,
        moduleId: module ? module.id : null,
        moduleDisabled: true
    });
};

/**
 * Factory pour créer un middleware qui vérifie un module spécifique
 * @param {string} moduleId - ID du module à vérifier
 * @returns {Function} Middleware Express
 */
const requireModule = (moduleId) => {
    return (req, res, next) => {
        if (isModuleActive(moduleId)) {
            return next();
        }
        
        const module = getModule(moduleId);
        const moduleName = module ? module.name : moduleId;
        
        return res.status(403).json({
            success: false,
            message: `Module "${moduleName}" désactivé`,
            moduleId: moduleId,
            moduleDisabled: true
        });
    };
};

/**
 * Middleware pour les routes de saisie
 */
const checkSaisieModule = requireModule('saisie');

/**
 * Middleware pour les routes de visualisation
 */
const checkVisualisationModule = requireModule('visualisation');

/**
 * Middleware pour les routes de stock (inventaire + copie)
 */
const checkStockModule = requireModule('stock');

/**
 * Middleware pour les routes de réconciliation
 */
const checkReconciliationModule = requireModule('reconciliation');

/**
 * Middleware pour les routes d'audit
 */
const checkAuditModule = requireModule('audit');

/**
 * Middleware pour les routes de cash paiement
 */
const checkCashPaiementModule = requireModule('cash-paiement');

/**
 * Middleware pour les routes de suivi achat boeuf
 */
const checkSuiviAchatBoeufModule = requireModule('suivi-achat-boeuf');

/**
 * Middleware pour les routes d'estimation
 */
const checkEstimationModule = requireModule('estimation');

/**
 * Middleware pour les routes de pré-commande
 */
const checkPrecommandeModule = requireModule('precommande');

/**
 * Middleware pour les routes de payment links
 */
const checkPaymentLinksModule = requireModule('payment-links');

/**
 * Middleware pour les routes d'abonnements
 */
const checkAbonnementsModule = requireModule('abonnements');

/**
 * Middleware pour les routes de Centre de Decoupe (envoi commandes au CDC)
 */
const checkDecoupeModule = requireModule('decoupe');

module.exports = {
    checkModuleActive,
    requireModule,
    checkSaisieModule,
    checkVisualisationModule,
    checkStockModule,
    checkReconciliationModule,
    checkAuditModule,
    checkCashPaiementModule,
    checkSuiviAchatBoeufModule,
    checkEstimationModule,
    checkPrecommandeModule,
    checkPaymentLinksModule,
    checkAbonnementsModule,
    checkDecoupeModule
};

