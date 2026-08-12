/**
 * Projection du PL de fin de mois — module PUR, sans DOM, sans reseau.
 *
 * Implemente la methode du document "Instructions - Estimation du P&L de fin
 * de mois", adaptee a la structure du PL de Maas:
 *
 *  SAISONNALITE. Deux periodes par mois: P1 = jours 1-10 et 25-fin (les
 *  lendemains et veilles de paie vendent plus), P2 = jours 11-24. Un
 *  coefficient journalier dit combien une journee P1 vend de plus qu'une
 *  journee P2. Valeurs de reference du document: O.Foire 1,336, Mbao 1,243,
 *  Keur Massar 1,280, Sacre Coeur 1,392 — mais le coefficient est d'abord
 *  CALIBRE sur l'historique du tenant lui-meme, et reste ajustable.
 *
 *  RYTHMES. Pour chaque periode: si au moins minJours (5) jours sont
 *  observes, rythme = 70 % du reel + 30 % de l'historique comparable; sinon
 *  historique seul; a defaut d'historique, conversion depuis l'autre periode
 *  via le coefficient. La source retenue est toujours DITE.
 *
 *  CA estime = realise + jours P1 restants x rythme P1
 *                       + jours P2 restants x rythme P2
 *
 *  PL PROJETE, poste par poste, chaque regle etant une hypothese AFFICHEE:
 *    - ventes                -> le CA estime;
 *    - commission, avances,
 *      marge CDC             -> proportionnels au CA (ils suivent l'activite:
 *                               c'est l'hypothese du moteur de simulation);
 *    - depenses, paiements   -> montants REALISES a date, non extrapoles (ce
 *                               sont des actes ponctuels, pas des flux);
 *    - charges fixes         -> le mois COMPLET (plus de prorata);
 *    - variation de stock    -> une photo, pas un flux: 'garder' la variation
 *                               actuelle ou la poser a 'zero', au choix.
 *
 *  SCENARIOS. Prudent (CA -10 %), central, haut (+10 %). Les postes
 *  proportionnels au CA sont recalcules dans chaque scenario; les charges
 *  fixes, depenses et paiements ne bougent pas — regle du document.
 *
 *  CONFIANCE. 'bon' si les periodes touchees ont >= minJours observes et un
 *  historique; 'moyen' si une seule source manque; 'faible' si une source de
 *  donnees du PL est indisponible ou si un rythme vient d'une conversion.
 *  Regle du document: sans donnees de cout fiables, on ne projette QUE le CA.
 *
 * Le module ne rend que des projections DERIVEES de ce que le serveur a deja
 * etabli: il ne recalcule jamais le PL realise.
 */
(function (racine, fabrique) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrique();
    else racine.Sim2Projection = fabrique();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var nb = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
    var fmt = function (v) {
        if (v === null || v === undefined || isNaN(v)) return '—';
        var s = Math.abs(Math.round(v)).toLocaleString('fr-FR');
        return (v < 0 ? '−' : '') + s;
    };

    /** Coefficients de reference du document, par tenant. */
    var COEFFS_DOCUMENT = {
        o_foire: 1.336, mbao: 1.243, keur_massar: 1.280, sacre_coeur: 1.392
    };

    /** P1 = jours 1-10 et 25-fin; P2 = jours 11-24. */
    function typeJour(iso) {
        var j = parseInt(String(iso).slice(8, 10), 10);
        return (j >= 11 && j <= 24) ? 'P2' : 'P1';
    }

    function finDuMois(iso) {
        var a = parseInt(iso.slice(0, 4), 10), m = parseInt(iso.slice(5, 7), 10);
        var d = new Date(Date.UTC(a, m, 0)); // jour 0 du mois suivant
        return d.toISOString().slice(0, 10);
    }

    /** Tous les jours ISO d'un intervalle inclusif. */
    function joursEntre(debut, fin) {
        var out = [];
        var d = new Date(debut + 'T00:00:00Z');
        var f = new Date(fin + 'T00:00:00Z');
        while (d <= f) {
            out.push(d.toISOString().slice(0, 10));
            d.setUTCDate(d.getUTCDate() + 1);
        }
        return out;
    }

    /**
     * Moyenne journaliere par type de jour sur un intervalle: les jours SANS
     * vente comptent zero — un jour ouvert sans vente est une information,
     * pas un trou.
     */
    function rythmeParType(caParJour, debut, fin) {
        var somme = { P1: 0, P2: 0 }, jours = { P1: 0, P2: 0 };
        joursEntre(debut, fin).forEach(function (j) {
            var t = typeJour(j);
            jours[t] += 1;
            somme[t] += nb((caParJour || {})[j]);
        });
        return {
            P1: jours.P1 > 0 ? somme.P1 / jours.P1 : null,
            P2: jours.P2 > 0 ? somme.P2 / jours.P2 : null,
            jours: jours, somme: somme
        };
    }

    /**
     * Coefficient P1/P2 CALIBRE sur l'historique du tenant. Null si moins de
     * 28 jours d'historique ou si le rythme P2 est nul: on ne calibre pas sur
     * du vide.
     */
    function calibrerCoeff(histo) {
        if (!histo || !histo.debut || !histo.fin) return null;
        if (joursEntre(histo.debut, histo.fin).length < 28) return null;
        var r = rythmeParType(histo.ca_par_jour, histo.debut, histo.fin);
        if (!r.P2 || r.P2 <= 0 || !r.P1) return null;
        return r.P1 / r.P2;
    }

    /**
     * Les rythmes journaliers retenus pour la projection, avec leur SOURCE.
     *
     * Regle du document: >= minJours observes -> 70 % reel + 30 % historique;
     * sinon historique; a defaut, conversion depuis l'autre periode via le
     * coefficient. La ponderation est un parametre, 0,7 par defaut.
     */
    function rythmesRetenus(args) {
        var minJours = args.minJours === undefined ? 5 : args.minJours;
        var poidsReel = args.poidsReel === undefined ? 0.7 : args.poidsReel;
        var coeff = nb(args.coeff) || 1;
        var reel = rythmeParType(args.caParJour, args.debutMois, args.dateAnalyse);
        var histo = args.histo
            ? rythmeParType(args.histo.ca_par_jour, args.histo.debut, args.histo.fin)
            : { P1: null, P2: null };

        var retenu = { P1: null, P2: null, sources: {}, reel: reel, histo: histo };
        ['P1', 'P2'].forEach(function (t) {
            var observes = reel.jours[t];
            if (observes >= minJours && reel[t] !== null) {
                if (histo[t] !== null) {
                    retenu[t] = poidsReel * reel[t] + (1 - poidsReel) * histo[t];
                    retenu.sources[t] = Math.round(poidsReel * 100) + ' % réel + '
                        + Math.round((1 - poidsReel) * 100) + ' % historique';
                } else {
                    retenu[t] = reel[t];
                    retenu.sources[t] = 'réel seul (pas d\'historique)';
                }
            } else if (histo[t] !== null) {
                retenu[t] = histo[t];
                retenu.sources[t] = 'historique (' + observes + ' j observés < ' + minJours + ')';
            }
        });
        // Conversion croisee en dernier recours: P1 = P2 x coeff, P2 = P1 / coeff.
        if (retenu.P1 === null && retenu.P2 !== null) {
            retenu.P1 = retenu.P2 * coeff;
            retenu.sources.P1 = 'converti depuis P2 × coefficient ' + coeff.toFixed(3);
        }
        if (retenu.P2 === null && retenu.P1 !== null) {
            retenu.P2 = retenu.P1 / coeff;
            retenu.sources.P2 = 'converti depuis P1 ÷ coefficient ' + coeff.toFixed(3);
        }
        return retenu;
    }

    /** CA estime de fin de mois = realise + jours restants x rythmes. */
    function projeterCA(args) {
        var fin = finDuMois(args.dateAnalyse);
        var rythmes = rythmesRetenus(args);
        var restants = { P1: 0, P2: 0 };
        if (args.dateAnalyse < fin) {
            joursEntre(joursEntre(args.dateAnalyse, args.dateAnalyse)[0], fin).slice(1)
                .forEach(function (j) { restants[typeJour(j)] += 1; });
        }
        var projetables = (rythmes.P1 !== null || restants.P1 === 0)
            && (rythmes.P2 !== null || restants.P2 === 0);
        var caRealise = 0;
        Object.keys(args.caParJour || {}).forEach(function (j) {
            if (j >= args.debutMois && j <= args.dateAnalyse) caRealise += nb(args.caParJour[j]);
        });
        var ajoutP1 = restants.P1 * (rythmes.P1 || 0);
        var ajoutP2 = restants.P2 * (rythmes.P2 || 0);
        return {
            finMois: fin,
            caRealise: caRealise,
            restants: restants,
            rythmes: rythmes,
            projetable: projetables,
            caProjete: projetables ? caRealise + ajoutP1 + ajoutP2 : null,
            ajouts: { P1: ajoutP1, P2: ajoutP2 }
        };
    }

    /**
     * PL projete a fin de mois pour UN CA cible.
     *
     * `postes` vient du PL realise (payload serveur), jamais recalcule ici.
     */
    function projeterPL(args) {
        var p = args.postes;
        var caRealise = nb(args.caRealise);
        var caCible = nb(args.caCible);
        if (caRealise <= 0) return null; // regle du document: on n'invente pas
        var r = caCible / caRealise;
        var stock = args.stockOption === 'zero' ? 0 : nb(p.stock_variation_nette);

        // DEPENSES: trois lectures possibles, et le choix change le resultat.
        //
        //  'realise' - ce qui est deja sorti, sans rien y ajouter. Honnete mais
        //              structurellement SOUS-ESTIME des qu'il reste des jours:
        //              on projette un CA de fin de mois contre des depenses
        //              arretees au jour d'analyse.
        //  'jours'   - extrapolation lineaire dans le TEMPS: une depense
        //              courante (carburant, glace, petit entretien) tombe a
        //              rythme regulier, pas au rythme des ventes.
        //  'ca'      - proportionnelle a l'ACTIVITE, comme la commission. Pour
        //              une depense qui suit les volumes.
        //
        // Aucun facteur n'est applique aux PAIEMENTS FOURNISSEUR: l'argent qui
        // sort revient en marchandise, donc en variation de stock. Les
        // extrapoler compterait la meme sortie deux fois.
        var joursEcoules = nb(args.jours && args.jours.ecoules);
        var joursMois = nb(args.jours && args.jours.mois);
        var facteurDepenses = 1;
        if (args.depensesOption === 'jours') {
            facteurDepenses = joursEcoules > 0 ? joursMois / joursEcoules : 1;
        } else if (args.depensesOption === 'ca') {
            facteurDepenses = r;
        }

        var d = {
            ca: caCible,
            avances: nb(p.total_avances) * r,
            commission: nb(p.commission_maas) * r,
            margeCdc: nb(p.marge_cdc) * r,
            charges: nb(args.chargesMensuel),
            depenses: nb(p.depenses_periode) * facteurDepenses,
            depensesFacteur: facteurDepenses,
            paiements: nb(p.paiements_fournisseur),
            stock: stock
        };
        d.pl = d.ca - d.avances - d.commission + d.margeCdc
            - d.charges - d.depenses - d.paiements + d.stock;
        d.margeNette = caCible > 0 ? d.pl / caCible : null;
        return d;
    }

    /** Les trois scenarios du document: prudent -10 %, central, haut +10 %. */
    function scenarios(args) {
        var ca = args.caProjete;
        if (ca === null || ca === undefined) return null;
        var faire = function (cible) {
            return projeterPL({
                postes: args.postes, caRealise: args.caRealise, caCible: cible,
                chargesMensuel: args.chargesMensuel, stockOption: args.stockOption,
                depensesOption: args.depensesOption, jours: args.jours
            });
        };
        return {
            prudent: faire(ca * 0.9),
            central: faire(ca),
            haut: faire(ca * 1.1)
        };
    }

    /** 'bon' | 'moyen' | 'faible', regles du document. */
    function confiance(args) {
        var notes = [];
        var niveau = 'bon';
        var abaisser = function (n, note) {
            notes.push(note);
            if (n === 'faible' || niveau === 'faible') niveau = 'faible';
            else niveau = 'moyen';
        };
        ['P1', 'P2'].forEach(function (t) {
            var src = (args.rythmes.sources || {})[t] || '';
            if ((args.restants[t] || 0) === 0) return; // periode finie: sans objet
            if (src.indexOf('converti') === 0) abaisser('faible', 'rythme ' + t + ' obtenu par conversion, jamais observé');
            else if (src.indexOf('historique (') === 0) abaisser('moyen', 'rythme ' + t + ' pris sur l\'historique, période trop peu observée');
            else if (src.indexOf('réel seul') === 0) abaisser('moyen', 'pas d\'historique pour lisser le rythme ' + t);
        });
        if (args.sourcesFiables === false) abaisser('faible', 'une source du PL est indisponible : le réalisé lui-même est incomplet');
        if (!args.histoDisponible) abaisser('moyen', 'aucun historique : coefficient non calibré');
        return { niveau: niveau, notes: notes };
    }

    /**
     * Recommandations OPERATIONNELLES, chiffrees depuis les donnees — jamais
     * des generalites. Chaque entree dit le geste, le produit ou le client,
     * et le montant en jeu.
     */
    function recommandations(args) {
        var out = [];
        var plCentral = args.plCentral;
        var produits = (args.produits || []).filter(function (p) { return !p.sans_vente; });

        // Le manque a combler, traduit en gestes concrets sur les meilleurs
        // leviers. margeDe(p) est la marge NETTE du moteur de simulation.
        if (plCentral !== null && plCentral < 0) {
            var gap = -plCentral;
            var margees = produits
                .map(function (p) { return { p: p, m: args.margeDe(p) }; })
                .filter(function (x) { return x.m !== null && x.m > 0; })
                .sort(function (a, b) { return b.m - a.m; });
            margees.slice(0, 2).forEach(function (x) {
                out.push({
                    type: 'volume', priorite: 1,
                    titre: 'Pousser ' + x.p.nom,
                    detail: 'marge nette ' + fmt(x.m) + ' F/u : environ '
                        + fmt(gap / x.m) + ' u de plus d\'ici la fin du mois comblent l\'écart de '
                        + fmt(gap) + ' F'
                });
            });
            var gros = produits.slice().sort(function (a, b) { return nb(b.ca) - nb(a.ca); })[0];
            if (gros && nb(gros.quantite) > 0) {
                out.push({
                    type: 'prix', priorite: 2,
                    titre: 'Ou ajuster le prix de ' + gros.nom,
                    detail: '+' + fmt(gap / nb(gros.quantite)) + ' F par unité sur le volume '
                        + 'actuel effacerait l\'écart — à confronter à la concurrence'
                });
            }
        }

        produits.forEach(function (p) {
            var m = args.margeDe(p);
            if (m !== null && m < 0) {
                out.push({
                    type: 'prix', priorite: 1,
                    titre: p.nom + ' vend à perte',
                    detail: 'marge nette ' + fmt(m) + ' F/u sur ' + fmt(p.quantite)
                        + ' u : revoir le prix, ou promo assumée d\'écoulement'
                });
            } else if (m === null && nb(p.ca) > 0) {
                out.push({
                    type: 'donnee', priorite: 3,
                    titre: 'Coût inconnu pour ' + p.nom,
                    detail: fmt(p.ca) + ' F de ventes sans prix d\'achat : la marge et la '
                        + 'projection l\'ignorent — renseigner le catalogue'
                });
            }
        });

        // Fidelisation: les gros clients de la periode qu'on n'a pas revus.
        (args.topClients || []).forEach(function (c) {
            if (!c.dernier || !args.dateAnalyse) return;
            var ecart = Math.round((new Date(args.dateAnalyse) - new Date(c.dernier)) / 86400000);
            if (ecart >= 7 && nb(c.ca) > 0) {
                out.push({
                    type: 'client', priorite: 2,
                    titre: 'Relancer ' + c.nom,
                    detail: fmt(c.ca) + ' F d\'achats sur la période, aucun passage depuis '
                        + ecart + ' jours'
                });
            }
        });

        out.sort(function (a, b) { return a.priorite - b.priorite; });
        return out;
    }

    /**
     * Les commandes qui generent le plus de PL — et la matiere pour les
     * MULTIPLIER.
     *
     * Une commande = les lignes de vente partageant un commande_id. Son PL
     * estime = somme(marge nette du produit x quantite); une ligne au cout
     * inconnu compte zero et fait baisser la `couverture`, qui est DITE. Le
     * classement se fait par MARGE, pas par chiffre d'affaires: une grosse
     * commande d'un produit sans marge n'est pas un modele a repliquer.
     *
     * `commandesClient` compte les commandes du meme client sur la periode:
     * 1 = un panier a faire repasser (relance), plusieurs = une recurrence a
     * securiser.
     */
    function commandesRentables(args) {
        var parClient = {};
        (args.commandes || []).forEach(function (cde) {
            var n = String(cde.client || '').trim().toLowerCase();
            if (n) parClient[n] = (parClient[n] || 0) + 1;
        });
        var evaluees = (args.commandes || []).map(function (cde) {
            var marge = 0, caCouvert = 0;
            (cde.lignes || []).forEach(function (l) {
                var m = args.margeDe({ nom: l.produit });
                if (m !== null && m !== undefined) {
                    marge += m * nb(l.quantite);
                    caCouvert += nb(l.ca);
                }
            });
            var ca = nb(cde.ca);
            var n = String(cde.client || '').trim().toLowerCase();
            return {
                id: cde.id, client: cde.client || null, date: cde.date || null,
                ca: ca, marge: marge,
                couverture: ca > 0 ? caCouvert / ca : 0,
                produits: (cde.lignes || []).map(function (l) { return l.produit; }),
                commandesClient: n ? (parClient[n] || 1) : 1
            };
        }).filter(function (c) { return c.marge > 0; });
        evaluees.sort(function (a, b) { return b.marge - a.marge; });
        return evaluees.slice(0, args.limite || 3);
    }

    return {
        COEFFS_DOCUMENT: COEFFS_DOCUMENT,
        typeJour: typeJour,
        finDuMois: finDuMois,
        joursEntre: joursEntre,
        rythmeParType: rythmeParType,
        calibrerCoeff: calibrerCoeff,
        rythmesRetenus: rythmesRetenus,
        projeterCA: projeterCA,
        projeterPL: projeterPL,
        scenarios: scenarios,
        confiance: confiance,
        recommandations: recommandations,
        commandesRentables: commandesRentables
    };
}));
