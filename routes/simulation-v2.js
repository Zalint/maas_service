/**
 * Simulation 2.0 — routeur independant.
 *
 * Monte sous son PROPRE prefixe, /api/simulation-v2, et non sous
 * /api/finance. Deux raisons, toutes deux verifiees dans le code:
 *
 *  1. Les gardes par prefixe de routes/finance.js sont poses par
 *     router.use('/simulation', ...). Ils ne couvrent PAS '/simulation-v2':
 *     une route v2 rangee la-bas aurait l'air gardee sans l'etre.
 *  2. Un prefixe de premier niveau rend la v2 lisible dans server.js et
 *     supprimable d'un bloc. C'est ce que veut la demande: du code isole.
 *
 * La v2 ne recalcule JAMAIS le resultat. Le PL vient de computePl, exporte par
 * routes/finance.js, et de nulle part ailleurs. Tout module ajoute ici doit
 * respecter cet invariant, sous peine de recreer la seconde source de verite
 * que ce depot interdit par ecrit a deux endroits.
 */

const express = require('express');
const router = express.Router();

const reglages = require('../lib/simulation-v2/reglages');

/**
 * Admin STRICT. Volontairement plus severe que checkAdvancedAccess, qui
 * laisse aussi passer superutilisateur et superviseur: basculer le moteur de
 * simulation du tenant n'est pas une operation de supervision.
 *
 * Recopie de checkAdminStrict (server.js) plutot qu'importe: server.js
 * require ce fichier, l'importer en sens inverse creerait un cycle.
 */
function adminStrict(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: 'Non authentifié' });
    }
    // Passe par role(), donc insensible a la casse, comme la lecture juste en
    // dessous. Comparer la valeur brute faisait diverger les deux: un role
    // stocke 'Admin' voyait tous les reglages mais ne pouvait pas les ecrire.
    if (role(req) !== 'admin') {
        return res.status(403).json({ success: false, error: 'Accès réservé aux administrateurs' });
    }
    next();
}

/** Le role de la session, en minuscules, ou '' si absent. */
function role(req) {
    return String((req.session && req.session.user && req.session.user.role) || '').toLowerCase();
}

/** Le nom de l'utilisateur connecte, pour signer une calibration. */
function utilisateur(req) {
    return String((req.session && req.session.user && req.session.user.username) || '') || null;
}

/**
 * GET /api/simulation-v2/reglages
 *
 * Lisible par tout utilisateur authentifie, mais PAS au meme niveau de detail:
 * un non-admin ne recoit que { actif }, dont il a besoin pour savoir s'il doit
 * afficher l'onglet. Lui rendre la liste des produits ou le prix de repli
 * exposerait des reglages qu'il ne peut pas modifier, sans qu'il en ait
 * l'usage.
 */
router.get('/reglages', async (req, res) => {
    try {
        const r = await reglages.lireReglages();
        if (role(req) !== 'admin') {
            return res.json({ success: true, data: { actif: r.actif } });
        }
        res.json({
            success: true,
            data: {
                actif: r.actif,
                famille_poulet: r.famillePoulet,
                prix_achat_defaut_poulet: r.prixPouletDefaut,
                produits_simulation: r.produitsSuivis,
                coeff_p1_p2: r.coeffP1P2,
                avertissements: r.avertissements
            }
        });
    } catch (e) {
        console.error('GET /api/simulation-v2/reglages:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * PUT /api/simulation-v2/reglages
 * Body: { actif?: boolean, famillePoulet?: string[]|string,
 *         prixPouletDefaut?: number, produitsSuivis?: string[]|string }
 */
router.put('/reglages', adminStrict, async (req, res) => {
    try {
        const corps = Object.assign({}, req.body || {});

        // SIGNATURE DE LA CALIBRATION, posee par le serveur.
        //
        // Le client envoie la valeur qu'il vient de calculer et la fenetre sur
        // laquelle il l'a calculee; il n'envoie NI l'auteur NI la date. Les
        // accepter de lui permettrait de signer une calibration au nom d'un
        // autre, et de l'antidater - alors que le seul interet de les stocker
        // est de pouvoir s'y fier.
        if (corps.coeffP1P2 !== undefined && corps.coeffP1P2 !== null) {
            const recu = (typeof corps.coeffP1P2 === 'object' && !Array.isArray(corps.coeffP1P2))
                ? corps.coeffP1P2
                : { valeur: corps.coeffP1P2 };
            corps.coeffP1P2 = {
                valeur: recu.valeur,
                fenetre: recu.fenetre,
                jours: recu.jours,
                par: utilisateur(req),
                le: new Date().toISOString()
            };
        }

        const r = await reglages.ecrireReglages(corps);
        if (!r.ok) {
            return res.status(400).json({ success: false, error: r.erreurs.join(' ; ') });
        }

        // Les reglages entrent dans le calcul de la simulation (famille
        // poulet, prix de repli): les caches derives de Finance doivent
        // tomber, sinon l'ecran garde jusqu'a 60 s un chiffre calcule sous
        // l'ancien reglage.
        try {
            const finance = require('./finance');
            if (typeof finance.invalidateFinanceDerivedCaches === 'function') {
                finance.invalidateFinanceDerivedCaches();
            }
        } catch (e) {
            console.warn('[simulation-v2] invalidation des caches Finance impossible:', e.message);
        }

        // Trace: un drapeau qui ouvre un ecran de resultat merite de laisser
        // une trace nominative, comme les autres ecritures de Finance.
        try {
            const audit = require('../lib/finance-audit');
            if (typeof audit.log === 'function') {
                audit.log(req, 'simulation_v2.reglages', { cles: r.ecrites });
            }
        } catch (e) { /* la trace ne doit jamais faire echouer l'ecriture */ }

        const apres = await reglages.lireReglages();
        res.json({
            success: true,
            data: {
                actif: apres.actif,
                famille_poulet: apres.famillePoulet,
                prix_achat_defaut_poulet: apres.prixPouletDefaut,
                // Rendu au client pour qu'il affiche la signature - date et
                // auteur - sans avoir a recharger l'ecran.
                coeff_p1_p2: apres.coeffP1P2,
                avertissements: apres.avertissements
            }
        });
    } catch (e) {
        console.error('PUT /api/simulation-v2/reglages:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
