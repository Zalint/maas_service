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

    /** Dimanche = jour 0. Lu en UTC, comme toutes les dates de ce module. */
    function estDimanche(iso) {
        return new Date(String(iso) + 'T00:00:00Z').getUTCDay() === 0;
    }

    /**
     * Les jours OUVRES d'un intervalle.
     *
     * Une boucherie fermee le dimanche n'a pas un mauvais dimanche, elle n'a
     * pas de dimanche du tout. Le compter comme une journee a zero divise le
     * rythme par un denominateur trop grand - le meme defaut que la derniere
     * journee sans vente - et fait projeter un CA trop bas d'environ un
     * septieme. Le retirer des DEUX cotes, numerateur et denominateur, rend
     * un rythme par jour d'ouverture, qu'on multiplie ensuite par les jours
     * d'ouverture restants.
     */
    function joursOuvres(debut, fin, exclureDimanche) {
        var tous = joursEntre(debut, fin);
        return exclureDimanche ? tous.filter(function (j) { return !estDimanche(j); }) : tous;
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
    function rythmeParType(caParJour, debut, fin, exclureDimanche) {
        var somme = { P1: 0, P2: 0 }, jours = { P1: 0, P2: 0 };
        joursOuvres(debut, fin, exclureDimanche).forEach(function (j) {
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
    function calibrerCoeff(histo, exclureDimanche) {
        if (!histo || !histo.debut || !histo.fin) return null;
        if (joursEntre(histo.debut, histo.fin).length < 28) return null;
        var r = rythmeParType(histo.ca_par_jour, histo.debut, histo.fin, exclureDimanche);
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
        var sansDim = !!args.exclureDimanche;
        var reel = rythmeParType(args.caParJour, args.debutMois, args.dateAnalyse, sansDim);
        var histo = args.histo
            ? rythmeParType(args.histo.ca_par_jour, args.histo.debut, args.histo.fin, sansDim)
            : { P1: null, P2: null };

        // `sources` est ce qui s'AFFICHE, `genres` ce qui se DECIDE. Les deux
        // etaient confondus: confiance() reclassifiait par indexOf sur les
        // libelles, donc reformuler une phrase a l'ecran aurait change le
        // niveau de confiance sans que rien ne le dise.
        var retenu = {
            P1: null, P2: null, sources: {}, genres: {}, reel: reel, histo: histo
        };
        ['P1', 'P2'].forEach(function (t) {
            var observes = reel.jours[t];
            if (observes >= minJours && reel[t] !== null) {
                if (histo[t] !== null) {
                    retenu[t] = poidsReel * reel[t] + (1 - poidsReel) * histo[t];
                    retenu.genres[t] = 'melange';
                    retenu.sources[t] = Math.round(poidsReel * 100) + ' % réel + '
                        + Math.round((1 - poidsReel) * 100) + ' % historique';
                } else {
                    retenu[t] = reel[t];
                    retenu.genres[t] = 'reel_seul';
                    retenu.sources[t] = 'réel seul (pas d\'historique)';
                }
            } else if (histo[t] !== null) {
                retenu[t] = histo[t];
                retenu.genres[t] = 'historique';
                retenu.sources[t] = 'historique (' + observes + ' j observés < ' + minJours + ')';
            }
        });
        // Conversion croisee en dernier recours: P1 = P2 x coeff, P2 = P1 / coeff.
        if (retenu.P1 === null && retenu.P2 !== null) {
            retenu.P1 = retenu.P2 * coeff;
            retenu.genres.P1 = 'converti';
            retenu.sources.P1 = 'converti depuis P2 × coefficient ' + coeff.toFixed(3);
        }
        if (retenu.P2 === null && retenu.P1 !== null) {
            retenu.P2 = retenu.P1 / coeff;
            retenu.genres.P2 = 'converti';
            retenu.sources.P2 = 'converti depuis P1 ÷ coefficient ' + coeff.toFixed(3);
        }
        return retenu;
    }

    /** CA estime de fin de mois = realise + jours restants x rythmes. */
    function projeterCA(args) {
        var fin = finDuMois(args.dateAnalyse);
        var rythmes = rythmesRetenus(args);
        // Jours d'OUVERTURE restants: le rythme etant par jour ouvre, c'est
        // par des jours ouvres qu'il doit etre multiplie.
        // Filtre explicite sur la date d'analyse plutot qu'un slice(1): quand
        // les dimanches sont exclus et que l'analyse TOMBE un dimanche, le
        // premier element n'est deja plus la date d'analyse, et retirer le
        // premier aurait supprime un vrai jour ouvre.
        var restants = { P1: 0, P2: 0 };
        joursOuvres(args.dateAnalyse, fin, !!args.exclureDimanche)
            .filter(function (j) { return j > args.dateAnalyse; })
            .forEach(function (j) { restants[typeJour(j)] += 1; });
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
        // Classement sur `genres`, jamais sur les libelles d'affichage: une
        // phrase reformulee a l'ecran ne doit pas deplacer le niveau de
        // confiance. Repli sur les libelles pour un rythmes construit par un
        // appelant plus ancien, qui ne porte pas encore `genres`.
        ['P1', 'P2'].forEach(function (t) {
            if ((args.restants[t] || 0) === 0) return; // periode finie: sans objet
            var src = (args.rythmes.sources || {})[t] || '';
            var genre = (args.rythmes.genres || {})[t]
                || (src.indexOf('converti') === 0 ? 'converti'
                    : (src.indexOf('historique (') === 0 ? 'historique'
                        : (src.indexOf('réel seul') === 0 ? 'reel_seul' : 'melange')));
            if (genre === 'converti') abaisser('faible', 'rythme ' + t + ' obtenu par conversion, jamais observé');
            else if (genre === 'historique') abaisser('moyen', 'rythme ' + t + ' pris sur l\'historique, période trop peu observée');
            else if (genre === 'reel_seul') abaisser('moyen', 'pas d\'historique pour lisser le rythme ' + t);
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

        // FIDELISATION, au rythme de chaque client.
        //
        // Un seuil fixe de 7 jours se trompait des deux cotes: il relancait le
        // client bimensuel a peine reparti, et ne disait rien de
        // l'hebdomadaire ayant saute deux tours. On compare desormais le
        // silence a l'habitude mesuree sur la fenetre longue.
        clientsARelancer({
            clients: args.clientsHistorique,
            dateAnalyse: args.dateAnalyse,
            limite: 3
        }).forEach(function (c) {
            out.push({
                type: 'client', priorite: 2,
                titre: 'Relancer ' + c.nom,
                detail: 'vient environ tous les ' + fmt(c.intervalle) + ' jours ('
                    + c.nbVisites + ' passages), et rien depuis ' + c.silence
                    + ' — soit ' + c.retard.toFixed(1) + '× son rythme. '
                    + fmt(c.ca) + ' F sur la fenêtre.'
            });
        });

        out.sort(function (a, b) { return a.priorite - b.priorite; });
        return out;
    }

    /**
     * CE QU'IL FAUT FAIRE D'ICI LA FIN DU MOIS POUR REVENIR A L'EQUILIBRE.
     *
     * Le manque a combler est le PL projete (negatif). Il ne se rattrape que
     * sur les jours qui RESTENT: c'est donc au volume restant, pas au volume
     * deja vendu, que les leviers s'appliquent - une erreur d'assiette
     * classique qui rendrait l'effort trop facile a l'ecran.
     *
     * Volume attendu d'ici la fin, par produit: on fait suivre au produit la
     * meme proportion que le CA, seule hypothese deja portee par le reste du
     * moteur (les leviers globaux marchent ainsi).
     *
     * DEUX LECTURES du meme manque, sur le produit principal:
     *   - a volume inchange, de combien monter la MARGE au kilo;
     *   - a marge inchangee, combien de KILOS vendre en plus.
     *
     * PUIS UN PLAN CUMULE sur plusieurs produits, chacun portant une part
     * proportionnelle a ce qu'il peut reellement porter - sa marge FOIS son
     * volume attendu. Cette ponderation a une propriete utile: la hausse
     * relative demandee est alors la MEME pour tous ("vendre X % de plus sur
     * ces cinq produits"), ce qui se transmet a une equipe, la ou cinq
     * objectifs differents ne se retiennent pas.
     *
     * @param {object} args
     * @param {number} args.plCentral      PL projete (negatif = manque)
     * @param {Array}  args.produits       lignes de sensibilite
     * @param {Function} args.margeDe      (produit) => marge nette F/u ou null
     * @param {number} args.caRealise
     * @param {number} args.caProjete
     * @param {number} args.joursRestants
     * @param {string} [args.principal]    produit mis en avant
     * @param {number} [args.nbProduits]   taille du plan cumule (defaut 5)
     */
    function planEquilibre(args) {
        var plCentral = args.plCentral;
        if (plCentral === null || plCentral === undefined || plCentral >= 0) return null;
        var manque = -plCentral;
        var caRealise = nb(args.caRealise);
        var caRestant = nb(args.caProjete) - caRealise;
        if (caRealise <= 0 || caRestant <= 0) return null;
        var proportion = caRestant / caRealise;

        // Un produit ne peut porter l'effort que si sa marge est connue ET
        // positive: vendre plus a marge nulle ou negative creuse le trou.
        var eligibles = (args.produits || [])
            .map(function (p) {
                var m = args.margeDe(p);
                return {
                    nom: p.nom, marge: m,
                    volumeRestant: nb(p.quantite) * proportion,
                    quantiteActuelle: nb(p.quantite),
                    // Le prix de vente moyen constate: c'est LUI qu'on releve
                    // pour gagner de la marge, et c'est le chiffre que le
                    // boucher manipule. Une marge cible sans le prix qui va
                    // avec n'est pas un geste.
                    prixMoyen: (p.prix_moyen === null || p.prix_moyen === undefined)
                        ? null : nb(p.prix_moyen)
                };
            })
            .filter(function (x) {
                return x.marge !== null && x.marge > 0 && x.volumeRestant > 0;
            });
        if (!eligibles.length) return null;

        var nomPrincipal = args.principal || 'Boeuf en détail';
        var cle = function (s) { return String(s || '').trim().toLowerCase(); };
        var principal = eligibles.filter(function (x) { return cle(x.nom) === cle(nomPrincipal); })[0]
            || eligibles.slice().sort(function (a, b) {
                return (b.marge * b.volumeRestant) - (a.marge * a.volumeRestant);
            })[0];

        // ---- Les deux leviers sur le produit principal.
        var margeRequise = principal.marge + manque / principal.volumeRestant;
        var volumeRequis = manque / principal.marge;

        var seul = {
            nom: principal.nom,
            marge: principal.marge,
            volumeRestant: principal.volumeRestant,
            prixMoyen: principal.prixMoyen,
            // Le prix de vente qu'il faudrait pratiquer pour degager la marge
            // requise, a cout inchange: c'est la meme hausse, exprimee sur le
            // chiffre que le boucher affiche.
            prixRequis: principal.prixMoyen === null
                ? null : principal.prixMoyen + manque / principal.volumeRestant,
            // (a) meme volume, marge plus haute.
            margeRequise: margeRequise,
            hausseMarge: margeRequise - principal.marge,
            // Le montant que cette marge supplementaire degage: c'est le
            // manque lui-meme, et l'ecrire evite d'avoir a le recalculer de
            // tete pour verifier que le compte tombe juste.
            montantMarge: manque,
            // (b) meme marge, volume plus haut.
            volumeAdditionnel: volumeRequis,
            volumeTotal: principal.volumeRestant + volumeRequis,
            hausseVolumePct: (volumeRequis / principal.volumeRestant) * 100,
            montantVolume: manque,
            parJour: nb(args.joursRestants) > 0
                ? volumeRequis / nb(args.joursRestants) : null
        };

        // ---- Le plan cumule, sur les PLUS FORTES MARGES.
        //
        // Le classement se fait sur la marge UNITAIRE, pas sur la capacite
        // marge x volume: pondérer par le volume revenait a designer les
        // produits qui se vendent deja beaucoup, alors que l'effort doit aller
        // la ou chaque unite vendue rapporte le plus. Le produit principal
        // reste en tete, c'est celui qu'on a choisi de piloter.
        var choisis = eligibles.slice().sort(function (a, b) {
            if (a === principal) return -1;
            if (b === principal) return 1;
            return b.marge - a.marge;
        }).slice(0, args.nbProduits || 5);

        // Part de chacun PROPORTIONNELLE A SA MARGE, sous PLAFOND DE REALISME.
        //
        // A marge egale de traitement, le nombre d'unites supplementaires est
        // le meme pour tous et ce sont les fortes marges qui rapportent le
        // plus: un seul chiffre a transmettre, et l'argent suit la marge sans
        // qu'on ait a l'expliquer.
        //
        // Mais classer sur la seule marge unitaire fait remonter des produits
        // qui ne se vendent presque pas - une demi-unite de "Viande boeuf
        // Avant" a la plus forte marge du catalogue. Lui demander +197 u n'est
        // pas un plan. Chaque produit est donc plafonne a facteurMax fois son
        // volume attendu (1 = au plus doubler), et ce qu'il ne peut pas porter
        // est redistribue sur les autres - un remplissage par paliers, jusqu'a
        // ce que le manque soit couvert ou que tout soit plafonne.
        // PLAFOND = volume vendu ramene au MOIS ENTIER, puis multiplie par
        // facteurMax (3 par defaut).
        //
        //   plafond = vendu x (jours du mois / jours ecoules) x facteurMax
        //
        // Le ramener au mois avant de le multiplier est ce qui rend le plafond
        // juste en debut de mois: 0,5 u vendue en 13 jours ne vaut pas 0,5 u
        // de potentiel, elle vaut 1,2 u sur le mois - et on accepte d'en
        // demander jusqu'a trois fois autant. Plafonner sur le seul volume
        // RESTANT punissait au contraire les produits observes tot, dont le
        // reliquat de mois est court.
        var facteurMax = args.facteurMax === undefined ? 3 : args.facteurMax;
        var joursEcoules = nb(args.jours && args.jours.ecoules);
        var joursMois = nb(args.jours && args.jours.mois);
        var facteurMois = (joursEcoules > 0 && joursMois > 0) ? joursMois / joursEcoules : null;
        var etats = choisis.map(function (x) {
            // Le plafond borne le TOTAL DU MOIS, pas le seul effort. Le poser
            // sur l'effort laissait afficher un total superieur au plafond
            // cense le contenir - une contradiction visible a l'ecran.
            //
            // Sans calendrier exploitable, on retombe sur le volume attendu
            // d'ici la fin: une borne connue vaut mieux qu'aucune borne.
            var plafondMois = facteurMois !== null
                ? x.quantiteActuelle * facteurMois * facteurMax
                : x.quantiteActuelle + x.volumeRestant * facteurMax;
            // Ce qu'il reste vendable sous ce plafond, une fois retire ce qui
            // est DEJA vendu: c'est sur cette base que le tableau raisonne.
            var plafondReste = Math.max(0, plafondMois - x.quantiteActuelle);
            // Et l'effort ne peut occuper que la place laissee par le volume
            // deja attendu sans rien faire.
            var effortMax = Math.max(0, plafondReste - x.volumeRestant);
            return {
                p: x, plafond: effortMax, plafondReste: plafondReste,
                plafondMois: plafondMois, unites: 0, plafonne: false
            };
        });
        var reste = manque;
        var unitesCommunes = null;
        for (var tour = 0; tour < etats.length + 1; tour++) {
            var libres = etats.filter(function (e) { return !e.plafonne; });
            if (!libres.length || reste <= 0) break;
            var sommeMarges = libres.reduce(function (s, e) { return s + e.p.marge; }, 0);
            if (sommeMarges <= 0) break;
            var u = reste / sommeMarges;
            var depassent = libres.filter(function (e) { return u > e.plafond; });
            if (!depassent.length) {
                libres.forEach(function (e) { e.unites = u; });
                unitesCommunes = u;
                reste = 0;
                break;
            }
            depassent.forEach(function (e) {
                e.unites = e.plafond;
                e.plafonne = true;
                reste -= e.plafond * e.p.marge;
            });
        }

        var plan = etats.map(function (e) {
            var x = e.p;
            return {
                nom: x.nom, marge: x.marge,
                volumeRestant: x.volumeRestant,
                volumeAdditionnel: e.unites,
                part: e.unites * x.marge,
                haussePct: x.volumeRestant > 0 ? (e.unites / x.volumeRestant) * 100 : null,
                parJour: nb(args.joursRestants) > 0 ? e.unites / nb(args.joursRestants) : null,
                // Le produit donne tout ce qu'il peut raisonnablement donner:
                // c'est le signe que l'effort doit aller ailleurs.
                plafonne: e.plafonne,
                // Ce que l'effort peut au plus valoir...
                plafond: e.plafond,
                // ...et le TOTAL vendable d'ici la fin sous le meme plafond,
                // celui auquel la colonne "total a vendre" se compare.
                plafondReste: e.plafondReste,
                plafondMois: e.plafondMois,
                // Le volume vendu ramene au mois entier: la base du plafond,
                // affichee pour que le chiffre se verifie a l'ecran.
                volumeMois: facteurMois !== null ? x.quantiteActuelle * facteurMois : null
            };
        }).sort(function (a, b) { return b.part - a.part; });

        // Ce que les produits retenus peuvent porter au plafond: au-dela,
        // l'equilibre ne se joue pas sur le volume. Lit les MEMES plafonds que
        // l'allocation, sinon les deux se contrediraient.
        var capaciteTotale = etats.reduce(function (s, e) {
            return s + e.p.marge * e.plafond;
        }, 0);

        return {
            manque: manque,
            joursRestants: nb(args.joursRestants),
            proportion: proportion,
            seul: seul,
            plan: plan,
            // Meme nombre d'unites pour tous ceux qui ne sont pas plafonnes:
            // le chiffre a retenir pour l'equipe. Null si tout est plafonne.
            unitesCommunes: unitesCommunes,
            capaciteTotale: capaciteTotale,
            facteurMax: facteurMax,
            // Ce qui reste a trouver ailleurs quand le volume ne suffit pas.
            resteACouvrir: reste > 0 ? reste : 0,
            // Le plan ne suffit pas si meme au plafond le manque tient: on le
            // DIT plutot que d'afficher un objectif intenable.
            atteignable: reste <= 0
        };
    }

    /**
     * L'HABITUDE d'achat d'un client, lue sur ses passages.
     *
     * Un delai fixe se trompe des deux cotes: il harcele le client bimensuel
     * et laisse filer l'hebdomadaire qui a saute deux tours. Ce qui compte,
     * c'est le silence rapporte a SON rythme.
     *
     * L'intervalle retenu est la MEDIANE, pas la moyenne: un client regulier
     * qui a pris trois semaines de vacances garde une mediane fidele a son
     * habitude, la ou la moyenne se laisse tirer par ce seul trou.
     *
     * @param {Array} passages [{date:'AAAA-MM-JJ', ca:number}] tries ou non
     * @param {string} dateAnalyse
     */
    function habitude(passages, dateAnalyse) {
        var jours = (passages || [])
            .map(function (p) { return String(p && p.date || ''); })
            .filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); })
            .sort();
        // Deux achats le meme jour sont UNE visite.
        var uniques = [];
        jours.forEach(function (j) { if (uniques[uniques.length - 1] !== j) uniques.push(j); });

        var ecarts = [];
        for (var i = 1; i < uniques.length; i++) {
            ecarts.push(Math.round(
                (new Date(uniques[i] + 'T00:00:00Z') - new Date(uniques[i - 1] + 'T00:00:00Z')) / 86400000
            ));
        }
        var mediane = null;
        if (ecarts.length) {
            var tri = ecarts.slice().sort(function (a, b) { return a - b; });
            var m = Math.floor(tri.length / 2);
            mediane = tri.length % 2 ? tri[m] : (tri[m - 1] + tri[m]) / 2;
        }
        var dernier = uniques.length ? uniques[uniques.length - 1] : null;
        var silence = (dernier && dateAnalyse)
            ? Math.round((new Date(dateAnalyse + 'T00:00:00Z') - new Date(dernier + 'T00:00:00Z')) / 86400000)
            : null;

        return {
            nbVisites: uniques.length,
            intervalleMedian: mediane,
            dernier: dernier,
            silence: silence,
            // En dessous de 3 visites il n'y a pas d'habitude a constater: deux
            // passages donnent UN intervalle, dont on ne peut rien conclure.
            // On le DIT plutot que d'inventer un rythme.
            habitudeEtablie: uniques.length >= 3 && mediane !== null && mediane > 0,
            // Combien de rendez-vous manques, au sens de son propre rythme.
            retardRelatif: (uniques.length >= 3 && mediane > 0 && silence !== null)
                ? silence / mediane : null
        };
    }

    /**
     * Les clients a relancer: ceux dont le silence depasse NETTEMENT leur
     * habitude. Le seuil est en nombre de rendez-vous manques, pas en jours.
     */
    function clientsARelancer(args) {
        var seuil = args.seuil === undefined ? 2 : args.seuil;
        var out = [];
        (args.clients || []).forEach(function (c) {
            var h = habitude(c.passages, args.dateAnalyse);
            if (!h.habitudeEtablie || h.retardRelatif === null) return;
            if (h.retardRelatif < seuil) return;
            out.push({
                nom: c.nom, ca: nb(c.ca_fenetre),
                silence: h.silence, intervalle: h.intervalleMedian,
                retard: h.retardRelatif, nbVisites: h.nbVisites
            });
        });
        // Le plus en retard d'abord a chiffre d'affaires comparable: on trie
        // sur ce qui est en jeu, pondere par l'anomalie.
        out.sort(function (a, b) { return (b.ca * b.retard) - (a.ca * a.retard); });
        return out.slice(0, args.limite || 5);
    }

    /**
     * Les gros clients du MOIS DERNIER qui n'ont rien pris ce mois-ci.
     *
     * La frequence sert ici de garde-fou: un client qui achete une fois tous
     * les deux mois n'est pas perdu au 13, il n'est simplement pas encore
     * revenu. On le rend quand meme, mais marque `premature`, plutot que de le
     * cacher — c'est a l'humain de trancher.
     */
    function clientsPerdus(args) {
        var dateAnalyse = String(args.dateAnalyse || '');
        var moisCourant = dateAnalyse.slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(moisCourant)) return [];
        // Mois precedent, sans bricolage de fin de mois.
        var d = new Date(moisCourant + '-01T00:00:00Z');
        d.setUTCMonth(d.getUTCMonth() - 1);
        var moisDernier = d.toISOString().slice(0, 7);

        var out = [];
        (args.clients || []).forEach(function (c) {
            var caDernier = 0, caCourant = 0;
            (c.passages || []).forEach(function (p) {
                var mois = String(p && p.date || '').slice(0, 7);
                if (mois === moisDernier) caDernier += nb(p.ca);
                else if (mois === moisCourant) caCourant += nb(p.ca);
            });
            if (caDernier <= 0 || caCourant > 0) return;
            var h = habitude(c.passages, dateAnalyse);
            out.push({
                nom: c.nom,
                caMoisDernier: caDernier,
                silence: h.silence,
                intervalle: h.intervalleMedian,
                nbVisites: h.nbVisites,
                // Trop tot pour s'alarmer: son SILENCE n'a pas encore atteint
                // son intervalle habituel.
                //
                // Comparer l'habitude aux jours ecoules DANS LE MOIS serait
                // faux: le dernier passage est souvent anterieur au 1er. Un
                // client vu le 14 juillet et muet depuis 42 jours ressortait
                // ainsi « pas encore en retard » le 25 aout, parce que 30 j
                // d'habitude depassent les 25 jours du mois entame.
                premature: h.habitudeEtablie ? (h.silence < h.intervalleMedian) : true,
                habitudeEtablie: h.habitudeEtablie
            });
        });
        out.sort(function (a, b) { return b.caMoisDernier - a.caMoisDernier; });
        return out.slice(0, args.limite || 5);
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
        joursOuvres: joursOuvres,
        estDimanche: estDimanche,
        rythmeParType: rythmeParType,
        calibrerCoeff: calibrerCoeff,
        rythmesRetenus: rythmesRetenus,
        projeterCA: projeterCA,
        projeterPL: projeterPL,
        scenarios: scenarios,
        confiance: confiance,
        recommandations: recommandations,
        commandesRentables: commandesRentables,
        habitude: habitude,
        clientsARelancer: clientsARelancer,
        clientsPerdus: clientsPerdus,
        planEquilibre: planEquilibre
    };
}));
