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
     * Moyenne journaliere par type de jour sur un intervalle.
     *
     * LES JOURS SANS AUCUNE VENTE SONT EXCLUS DU DENOMINATEUR.
     *
     * L'ecriture precedente les comptait, au motif qu'« un jour ouvert sans
     * vente est une information, pas un trou ». Sur les donnees reelles c'est
     * faux: une boucherie ouverte qui ne vend rien de la journee n'existe pas.
     * Ces jours sont des fermetures ou des saisies manquantes - Mbao en a 4 en
     * mai (les 27, 28, 29 et 30, consecutifs), 4 en juin. Chacun divisait le
     * rythme sans rien ajouter au numerateur, et comme la fenetre d'historique
     * de 92 jours en contient toujours, l'effet contaminait meme les mois sains.
     *
     * Backtest sur juin et juillet 2026, 16 projections, deux sites:
     *   avec les jours a zero  : 43,4 % d'erreur absolue, biais -41,4 %
     *   sans les jours a zero  : 17,5 % d'erreur absolue, biais -10,8 %
     * Gain confirme independamment sur chaque site (Mbao 46,3 -> 15,7 %,
     * Keur Massar 40,5 -> 19,2 %). Aucun parametre n'a ete ajuste: c'est la
     * correction d'un defaut, pas un reglage.
     *
     * `joursExclus` est rendu pour que l'ecran DISE combien de journees ont ete
     * ecartees. Si la boutique etait vraiment fermee, c'est une information de
     * gestion; si la saisie manque, il faut la faire plutot que la masquer.
     */
    function rythmeParType(caParJour, debut, fin, exclureDimanche) {
        var somme = { P1: 0, P2: 0 }, jours = { P1: 0, P2: 0 };
        var ouverts = { P1: 0, P2: 0 };
        var exclus = [];
        joursOuvres(debut, fin, exclureDimanche).forEach(function (j) {
            var t = typeJour(j);
            ouverts[t] += 1;
            var v = nb((caParJour || {})[j]);
            if (!(v > 0)) { exclus.push(j); return; }
            jours[t] += 1;
            somme[t] += v;
        });
        return {
            P1: jours.P1 > 0 ? somme.P1 / jours.P1 : null,
            P2: jours.P2 > 0 ? somme.P2 / jours.P2 : null,
            // `jours` = journees ACTIVES, le denominateur de la moyenne. C'est
            // aussi, DELIBEREMENT, ce que rythmesRetenus compte pour son seuil
            // des 5 journees observees: le seuil garde contre une moyenne
            // batie sur trop peu d'observations, et une journee sans vente
            // n'en est pas une. Le backtest qui valide l'exclusion (17,5 %
            // d'erreur contre 43,4 %) a ete mesure avec ce couplage en place.
            jours: jours, somme: somme,
            // Les journees OUVERTES, pour que l'ecran puisse dire « 7 actives
            // sur 8 ouvertes » plutot que de laisser croire a un mois court.
            joursOuverts: ouverts,
            joursExclus: exclus
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
    /**
     * LE TAUX DE MARGE AUX PRIX COURANTS, pour projeter les jours qui restent.
     *
     * `taux_marge` rendu par le serveur est le taux CONSTATE depuis le 1er: il
     * melange les journees ou la carcasse etait a 3 835 F a celles ou elle est
     * a 4 500. Projeter dessus revient a supposer que le mois qui reste se
     * paiera au prix moyen du mois ecoule - il se paiera au dernier prix.
     *
     * On recalcule donc le taux a partir des DEUX prix courants:
     *   - le dernier prix d'ACHAT connu   (prix_achat, deja bascule par
     *     auPrixDeLaSuite sur prix_achat_fin);
     *   - le dernier prix de VENTE constate (prix_moyen, deja bascule sur le
     *     tarif de la suite).
     *
     *   marge unitaire = prix vente − prix achat / (1 − parage)
     *   taux courant   = Σ(marge × quantite) / Σ(CA)
     *
     * Le parage divise le cout d'achat et RIEN d'autre: la commission n'entre
     * pas ici, elle est deja un poste du PL et la compter dans le taux la
     * ferait deduire deux fois.
     *
     * Les produits dont le cout est INCONNU sont exclus du calcul, pas comptes
     * a zero - les inclure a marge pleine gonflerait le taux. La couverture en
     * CA est rendue: en dessous de `couvertureMin`, on refuse et l'appelant
     * retombe sur le taux constate, en le DISANT.
     */
    function tauxMargeCourant(args) {
        var produits = (args && args.produits) || [];
        var margeDe = (args && args.margeDe) || null;
        var couvertureMin = (args && args.couvertureMin !== undefined)
            ? nb(args.couvertureMin) : 0.8;

        var caTotal = 0, caChiffre = 0, margeTotale = 0, caDerniers = 0;
        var sansCout = [];
        produits.forEach(function (p) {
            var ca = nb(p.ca);
            caTotal += ca;
            var m = margeDe ? margeDe(p) : null;
            if (m === null || m === undefined) { sansCout.push(p.nom); return; }
            caChiffre += ca;
            margeTotale += nb(m) * nb(p.quantite);
            // Le CA de ces memes volumes aux prix PORTES par les produits -
            // les derniers connus, puisque l'ecran passe des produits deja
            // au prix de la suite. C'est le denominateur du taux.
            caDerniers += nb(p.prix_moyen) * nb(p.quantite);
        });

        var couverture = caTotal > 0 ? caChiffre / caTotal : 0;
        // LE TAUX DES JOURS RESTANTS: marge et CA aux MEMES prix.
        //
        // L'ancienne ecriture divisait la marge aux derniers prix par le CA de
        // la PERIODE - numerateur aux prix de demain, denominateur aux prix
        // d'hier. L'hybride surevaluait le taux des que les prix montaient, et
        // ne servait a rien: le PL part de marge_totale, en francs. Divise par
        // le CA des memes volumes aux memes prix, le taux redevient une vraie
        // grandeur: marge de la suite / CA de la suite, quel que soit le
        // volume restant (la proportion se simplifie).
        var taux = caDerniers > 0 ? margeTotale / caDerniers : null;
        return {
            taux: taux,
            taux_pct: taux === null ? null : taux * 100,
            couverture: couverture,
            ca_total: caTotal,
            ca_chiffre: caChiffre,
            // Le denominateur du taux, rendu pour que l'ecran puisse refaire
            // la division sous les yeux du lecteur.
            ca_derniers: caDerniers,
            // La marge ABSOLUE que les volumes REALISES degageraient aux prix
            // courants. C'est elle qui sert a projeter les jours restants:
            // le taux, lui, ne sert plus qu'a l'affichage.
            marge_totale: margeTotale,
            sans_cout: sansCout,
            // Utilisable seulement si assez de CA est chiffre. Sinon le taux
            // decrit une minorite de l'activite et ne doit pas piloter le PL.
            utilisable: taux !== null && couverture >= couvertureMin
        };
    }

    /**
     * Les quantites restant a vendre par produit, avec SURCHARGE manuelle.
     *
     * POURQUOI CE N'EST PAS UN ESTIMATEUR. Le backtest sur mai-juillet 2026 a
     * mesure qu'une projection statistique par produit (rythmes P1/P2 par
     * produit, regle 70/30) est MOINS precise que l'hypothese de mix qu'elle
     * remplacerait: erreur de mix 38,4 % contre 35,8 %, defavorable sur les
     * quatre mois testes. Trois raisons, toutes verifiees sur les donnees:
     *   - trois produits seulement ont du signal (boeuf detail 97 jours de
     *     vente, gros 72, poulet detail 70 sur 99 jours); la Dorade en a UN;
     *   - le coefficient P1/P2 reel oscille de 0,767 (juin) a 1,533 (juillet)
     *     quand le document en pose 1,243: rien de stable a calibrer;
     *   - une seule commande - 189 u de boeuf en gros le 20/06/2026, 774 900 F,
     *     21 % du CA du mois - fait la moitie de l'erreur de mix de juin.
     * Cette derniere ligne resume tout: aucun rythme ne predit cet evenement,
     * mais l'exploitant le connait d'avance. D'ou une SAISIE, pas un modele.
     *
     * MODE 'atelier' (defaut): le CA total projete ne bouge pas, la saisie ne
     * fait que redistribuer. C'est le mode juste pour corriger un MIX, seul
     * defaut que les mesures imputent a l'hypothese actuelle: les lignes non
     * saisies absorbent la difference au prorata de leur propre reste.
     * MODE 'ajout': la saisie s'ajoute, le CA projete grossit d'autant. Pour
     * une commande qui vient EN PLUS de l'activite habituelle.
     *
     * Sans aucune surcharge, les deux modes rendent exactement q x proportion,
     * l'hypothese de mix actuelle, au flottant pres. Aucune regression possible.
     *
     * @param {Array}  args.produits    {nom, quantite, prix_moyen}, au prix de la suite
     * @param {number} args.proportion  part du volume encore a vendre
     * @param {object} args.surcharges  { cle: {reste: nombre} }, saisie utilisateur
     * @param {string} [args.mode]      'atelier' (defaut) | 'ajout'
     * @param {Function} [args.cleDe]   normalisation du nom -> cle de surcharge
     */
    function repartirRestes(args) {
        var produits = (args && args.produits) || [];
        var proportion = Math.max(0, nb(args && args.proportion));
        var surcharges = (args && args.surcharges) || {};
        var mode = (args && args.mode) === 'ajout' ? 'ajout' : 'atelier';
        var cleDe = (args && args.cleDe)
            || function (n) { return String(n === null || n === undefined ? '' : n).trim().toLowerCase(); };

        var notes = [];
        var vues = {};
        var lignes = produits.map(function (p) {
            var q = nb(p.quantite);
            var pv = (p.prix_moyen === null || p.prix_moyen === undefined) ? null : nb(p.prix_moyen);
            var cle = cleDe(p.nom);
            // Deux produits qui rendent la MEME cle ne se fusionnent pas: leurs
            // prix different, et une surcharge ne saurait pas a qui elle
            // s'applique. On la refuse sur ces lignes et on le dit.
            var dupliquee = Object.prototype.hasOwnProperty.call(vues, cle);
            if (dupliquee && notes.indexOf('cle_dupliquee') < 0) notes.push('cle_dupliquee');
            vues[cle] = true;
            var s = dupliquee ? null : surcharges[cle];
            // parseFloat DIRECT, pas nb(): nb rend 0 sur une entree illisible,
            // donc isFinite(nb(x)) est toujours vrai et le garde ne gardait
            // rien. 'abc', NaN, [] et {} devenaient une surcharge a ZERO, ce
            // qui dans ce modele est une instruction VALIDE (« plus rien de ce
            // produit ce mois-ci »). Une saisie corrompue se lisait donc comme
            // une decision. Non finie = pas de surcharge, la ligne garde le mix.
            var lu = (s && s.reste !== null && s.reste !== undefined)
                ? parseFloat(s.reste) : NaN;
            var brut = isFinite(lu) ? Math.max(0, lu) : null;
            var resteMix = q * proportion;
            return {
                nom: p.nom, cle: cle, quantite: q, prix: pv,
                reste_mix: resteMix,
                reste: brut === null ? resteMix : brut,
                source: brut === null ? 'mix' : 'saisie'
            };
        });

        var caDe = function (l, r) { return (l.prix === null || !(l.prix > 0)) ? 0 : l.prix * r; };
        var facteur = null;
        var sature = false;
        if (mode === 'atelier') {
            // Le CA que l'atelier autorise pour la suite, inchange par la saisie.
            var cible = 0, caSaisi = 0, caLibre = 0;
            lignes.forEach(function (l) {
                cible += caDe(l, l.reste_mix);
                if (l.source === 'saisie') caSaisi += caDe(l, l.reste);
                else caLibre += caDe(l, l.reste_mix);
            });
            var residuel = cible - caSaisi;
            if (residuel < 0) {
                // Les saisies depassent a elles seules le CA projete. On ne les
                // rogne PAS - l'exploitant sait ce qu'il annonce - mais les
                // lignes libres tombent a zero et le total depasse la cible.
                // L'ecran doit le dire plutot que de rendre des negatifs.
                sature = true;
                residuel = 0;
                notes.push('saisies_au_dela_du_ca');
            }
            if (caLibre > 0) {
                facteur = residuel / caLibre;
                lignes.forEach(function (l) {
                    if (l.source === 'mix') l.reste = l.reste_mix * facteur;
                });
            } else if (lignes.some(function (l) { return l.source === 'mix'; })) {
                // Des lignes libres existent mais ne portent aucun CA (prix
                // absent): rien a redistribuer, elles restent au mix.
                notes.push('libres_sans_prix');
            } else if (lignes.length) {
                notes.push('toutes_saisies');
            }
        }

        var tot = { vendu: 0, reste: 0, mois: 0, ca_reste: 0, ca_reste_mix: 0, nb_saisies: 0 };
        lignes.forEach(function (l) {
            l.mois = l.quantite + l.reste;
            l.ca_reste = caDe(l, l.reste);
            tot.vendu += l.quantite;
            tot.reste += l.reste;
            tot.mois += l.mois;
            tot.ca_reste += l.ca_reste;
            tot.ca_reste_mix += caDe(l, l.reste_mix);
            if (l.source === 'saisie') tot.nb_saisies += 1;
        });

        return {
            lignes: lignes,
            totaux: tot,
            mode: mode,
            // Ce qu'il a fallu appliquer aux lignes libres pour tenir le CA.
            // 1 = la saisie n'a rien deplace; < 1 = elle a pris de la place aux
            // autres; > 1 = elle leur en a rendu.
            facteur: facteur,
            sature: sature,
            // Le CA de la suite EFFECTIF: egal a celui du mix en mode atelier
            // (hors saturation), superieur en mode ajout.
            ca_suite: tot.ca_reste,
            ca_suite_mix: tot.ca_reste_mix,
            actif: tot.nb_saisies > 0,
            notes: notes
        };
    }

    /**
     * Marge des jours restants, produit par produit, depuis une repartition.
     * Somme(marge unitaire x reste). C'est ce qui remplace
     * proportion x marge_totale des que des quantites sont saisies a la main.
     */
    function margeDesRestes(lignesRepartition, margeDe, produitsParCle) {
        var total = 0;
        var sansMarge = [];
        (lignesRepartition || []).forEach(function (l) {
            var src = (produitsParCle && produitsParCle[l.cle]) || l;
            var m = margeDe ? margeDe(src) : null;
            if (m === null || m === undefined) { sansMarge.push(l.nom); return; }
            total += nb(m) * nb(l.reste);
        });
        return { marge: total, sans_marge: sansMarge };
    }

    /**
     * CA d'un « mois-equivalent » aux prix portes par les produits passes:
     * Sigma(quantite x prix_moyen). L'ecran l'appelle avec des produits AU
     * PRIX DE LA SUITE (auPrixDeLaSuite), il rend donc ce que les volumes de
     * la periode feraient au DERNIER prix de vente connu. Aucun cout requis:
     * les produits sans prix d'achat comptent aussi, un CA n'a pas besoin de
     * marge. C'est l'assiette de la methode « volumes x derniers prix ».
     */
    function caAuxDerniersPrix(produits) {
        var total = 0;
        (produits || []).forEach(function (p) {
            var pv = (p && p.prix_moyen !== null && p.prix_moyen !== undefined)
                ? nb(p.prix_moyen) : null;
            if (pv === null || !(pv > 0)) return;
            total += pv * nb(p.quantite);
        });
        return total;
    }

    function projeterPL(args) {
        var p = args.postes;
        var caRealise = nb(args.caRealise);
        var caCible = nb(args.caCible);
        if (caRealise <= 0) return null; // regle du document: on n'invente pas
        var r = caCible / caRealise;
        var stock = args.stockOption === 'zero' ? 0 : nb(p.stock_variation_nette);

        // LA PROPORTION DES JOURS RESTANTS - en VOLUME.
        //
        // Sans caPleinDerniersPrix (methode rythmes), caCible est aux prix de
        // la periode: la part de ce qui reste se lit sur le CA realise.
        // Avec (methode volumes x derniers prix), caCible contient la hausse
        // des prix de vente: diviser par le CA realise compterait cette
        // hausse comme du volume en plus. On divise par le CA plein aux
        // derniers prix - Sigma(quantite x dernier prix de vente) - et la
        // proportion redevient purement du volume. L'identite qui en decoule,
        // verifiable a l'ecran: caCible - caRealise = proportion x caPlein.
        var caPlein = nb(args.caPleinDerniersPrix);
        var proportion = caPlein > 0
            ? Math.max(0, (caCible - caRealise) / caPlein)
            : Math.max(0, (caCible - caRealise) / caRealise);

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

        // ON PROJETTE LE TAUX DE MARGE, PAS LES AVANCES.
        //
        // Les avances et les paiements sont de la TRESORERIE d'achat: une
        // partie repart en stock. Les extrapoler comme un cout sans
        // extrapoler le stock qu'ils creent comptait tout l'achat du mois
        // comme consomme. Mesure sur aout 2026: la marge implicite tombait a
        // 0,5 % du CA quand la marge reelle est de 10,4 %, et le PL projete
        // affichait -341 053 F pour une activite qui gagne de l'argent.
        //
        // Le serveur rend desormais `taux_marge`, constate depuis le debut du
        // mois. C'est le proxy retenu par le proprietaire du produit: les
        // receptions sont regulieres - tous les deux jours - donc le taux ne
        // depend pas du calendrier des livraisons.
        var tauxMarge = p.taux_marge !== null && p.taux_marge !== undefined
            ? nb(p.taux_marge) / 100
            : null;
        // Repli: reconstituer le taux depuis les postes, pour un PL fige
        // anterieur a ce champ.
        if (tauxMarge === null && caRealise > 0) {
            var coutR = nb(p.total_avances) + nb(p.paiements_fournisseur)
                - nb(p.stock_variation_nette);
            tauxMarge = (caRealise - coutR) / caRealise;
        }
        // LE TAUX COURANT PRIME, quand l'appelant le fournit et qu'il couvre
        // assez de CA.
        //
        // Le taux ci-dessus est CONSTATE depuis le 1er: il melange les
        // journees ou la carcasse etait a 3 835 F a celles ou elle est a
        // 4 500. Projeter les jours qui RESTENT dessus revient a supposer
        // qu'ils se paieront au prix moyen du passe. Le taux courant, lui,
        // est bati sur le dernier prix d'achat connu et le dernier prix de
        // vente constate - ce que ces jours-la coutent vraiment.
        //
        // `origine` est rendu pour que l'ecran DISE lequel il a utilise: un
        // PL projete sur deux taux differents selon la couverture, sans le
        // dire, serait indefendable.
        //
        // LE MOIS SE COUPE EN DEUX, chaque moitie a SON prix.
        //
        // Appliquer un taux unique a `caCible` traite tout le mois de la meme
        // facon. Avec le taux constate, on projette les jours restants au prix
        // moyen du passe. Avec le taux courant, pire: on REEVALUE le passe
        // deja vendu a des prix qu'il n'a pas eus - une vente faite a 5 282 F
        // recomptee a 5 400 F.
        //
        //   marge = marge REALISEE          (un fait: CA realise x taux constate)
        //         + marge des jours RESTANTS (volumes restants x marge unitaire
        //                                     aux prix courants)
        //
        // Les volumes restants sont proportionnels aux volumes realises - meme
        // hypothese de melange que partout ailleurs - donc:
        //   marge restante = proportion x marge_totale(prix courants)
        // ou proportion = (caCible - caRealise) / caRealise.
        //
        // `marge_totale` est la marge ABSOLUE des volumes realises aux prix
        // courants: la rapporter au CA realise donnerait un taux qui melange
        // deux niveaux de prix, et c'est exactement ce qu'on evite ici.
        var origineTaux = 'constate';
        // D'ou vient la marge des jours restants: 'proportion' (hypothese de
        // mix) ou 'produits' (quantites saisies). Rendu pour que l'ecran le
        // dise au lieu de le laisser deviner.
        var origineMarge = 'proportion';
        var marge = tauxMarge === null ? null : caCible * tauxMarge;
        var tc = args.tauxCourant;
        var mrd = args.margeRestanteDirecte;
        var directe = (mrd !== null && mrd !== undefined && isFinite(nb(mrd)));
        // LA SAISIE PRIME, MEME SANS TAUX COURANT UTILISABLE.
        //
        // Elle etait auparavant lue A L'INTERIEUR du test sur tc.utilisable:
        // sur un point de vente dont plus de 20 % du CA n'a pas de prix
        // d'achat, le taux courant est declare inutilisable, la branche etait
        // sautee, et une quantite saisie a la main n'avait AUCUN effet sur le
        // PL - alors que le tableau des volumes la montrait appliquee. Silence
        // total. La saisie est une decision explicite de l'exploitant: elle ne
        // depend pas de la couverture des couts, qui ne conditionne que le
        // repli statistique.
        if (directe && tauxMarge !== null) {
            marge = caRealise * tauxMarge + nb(mrd);
            origineMarge = 'produits';
            origineTaux = 'courant';
        } else if (tc && tc.utilisable && tc.marge_totale !== null
            && tc.marge_totale !== undefined && tauxMarge !== null) {
            // Un scenario qui finirait SOUS le realise n'a pas de sens: il n'y
            // a pas de vente negative. Le plancher « plus rien vendu » est
            // deja dans la proportion, calculee plus haut.
            marge = caRealise * tauxMarge + proportion * nb(tc.marge_totale);
            origineMarge = 'proportion';
            origineTaux = 'courant';
        }

        var d = {
            ca: caCible,
            // Le taux EFFECTIF, celui que la marge retenue represente. Rendu
            // apres coup pour que l'affichage et le calcul ne divergent pas.
            tauxMarge: (marge === null || caCible === 0) ? tauxMarge : marge / caCible,
            tauxMargeConstate: tauxMarge,
            tauxMargeOrigine: origineTaux,
            margeOrigine: origineMarge,
            marge: marge,
            // Rendues pour l'affichage: la proportion effectivement utilisee
            // et son assiette. Sans elles, l'ecran redivisait par le CA
            // realise et ses controles sortaient faux en methode volumes.
            proportion: proportion,
            caPleinDerniersPrix: caPlein > 0 ? caPlein : null,
            // En methode « derniers prix », r = caCible/caRealise contient la
            // hausse du prix de VENTE. La commission se calcule sur le prix
            // CATALOGUE des livraisons et la marge CDC comme les avances
            // suivent la marchandise: tous suivent le VOLUME, pas le tarif en
            // vitrine. En methode rythmes, (1 + proportion) egale r et rien
            // ne change.
            commission: nb(p.commission_maas) * (caPlein > 0 ? 1 + proportion : r),
            margeCdc: nb(p.marge_cdc) * (caPlein > 0 ? 1 + proportion : r),
            charges: nb(args.chargesMensuel),
            depenses: nb(p.depenses_periode) * facteurDepenses,
            depensesFacteur: facteurDepenses,
            // Rendus pour l'affichage du detail: ils n'entrent PLUS dans le
            // calcul, la marge les contient deja.
            avances: nb(p.total_avances) * (caPlein > 0 ? 1 + proportion : r),
            paiements: nb(p.paiements_fournisseur),
            stock: stock
        };
        d.pl = d.marge === null ? null
            : d.marge - d.commission + d.margeCdc - d.charges - d.depenses;
        d.margeNette = (caCible > 0 && d.pl !== null) ? d.pl / caCible : null;
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
                depensesOption: args.depensesOption, jours: args.jours,
                // Le MEME taux pour les trois scenarios: ils ne different que
                // par le CA, jamais par la structure de cout.
                tauxCourant: args.tauxCourant,
                caPleinDerniersPrix: args.caPleinDerniersPrix,
                // LA SAISIE VAUT DANS LES TROIS SCENARIOS.
                //
                // Une commande annoncee est un FAIT: elle ne devient pas plus
                // petite parce qu'on regarde le scenario prudent. Ce sont les
                // lignes NON saisies qui absorbent la variation de volume.
                // Premiere ecriture: un scalaire fige au seul central. Elle
                // cassait la monotonie des trois colonnes - une saisie sous le
                // mix donnait un PL prudent SUPERIEUR au central, ce qu'aucun
                // lecteur ne peut interpreter. Un callback, evalue a la cible
                // de chaque scenario, garde la saisie ferme et le reste souple.
                margeRestanteDirecte: (typeof args.margeRestanteDe === 'function')
                    ? args.margeRestanteDe(cible)
                    : null
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
        // MEME cible que planEquilibre et volumesProjetes. Sans elle, ces
        // conseils continuaient d'annoncer « comblent l'ecart de 15 920 F »
        // sous un bandeau disant que l'objectif est atteint, ou de se taire
        // alors qu'un objectif de 100 000 F reclame encore un effort. Trois
        // lectures du meme mois doivent viser le meme chiffre.
        var gap = (plCentral === null || plCentral === undefined)
            ? 0 : nb(args.cible) - plCentral;
        if (gap > 0) {
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
            // Une hausse de prix ne s'applique qu'aux unites ENCORE A VENDRE:
            // le mois ecoule ne se refacture pas. Diviser par la quantite
            // deja vendue rendait une hausse trop FAIBLE - d'autant plus
            // trompeuse qu'on est loin dans le mois - et le geste propose ne
            // comblait pas l'ecart annonce. `proportion` est la part du CA
            // restant a faire; a defaut, on retombe sur l'ancienne assiette
            // en le DISANT.
            var gros = produits.slice().sort(function (a, b) { return nb(b.ca) - nb(a.ca); })[0];
            var proportionCA = nb(args.proportion);
            if (gros && nb(gros.quantite) > 0) {
                var assiette = proportionCA > 0
                    ? nb(gros.quantite) * proportionCA : nb(gros.quantite);
                out.push({
                    type: 'prix', priorite: 2,
                    titre: 'Ou ajuster le prix de ' + gros.nom,
                    detail: '+' + fmt(gap / assiette) + ' F par unité sur les '
                        + fmt(assiette) + ' u ' + (proportionCA > 0
                            ? 'encore attendues d\'ici la fin du mois'
                            : 'du volume actuel')
                        + ' effacerait l\'écart — à confronter à la concurrence'
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
                    + ' jours — soit ' + c.retard.toFixed(1) + '× son rythme. '
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
     * PUIS UN PLAN CUMULE sur plusieurs produits, pris par MARGE UNITAIRE
     * decroissante et portant chacun une part proportionnelle a sa MARGE.
     * Consequence: le nombre d'unites supplementaires est le meme pour tous
     * tant qu'aucun plafond ne mord, et a effort egal ce sont les fortes
     * marges qui rapportent le plus. Un produit plafonne cede son reliquat
     * aux autres, par paliers.
     *
     * @param {object} args
     * @param {number} args.plCentral      PL projete (negatif = manque)
     * @param {Array}  args.produits       lignes de sensibilite
     * @param {Function} args.margeDe      (produit) => marge nette F/u ou null.
     *   DOIT etre nette de tout ce que l'unite vendue en plus declenche -
     *   commission MaaS induite comprise - sinon le plan promet un apport que
     *   le moteur ne rend pas.
     * @param {number} args.caRealise
     * @param {number} args.caProjete
     * @param {number} args.joursRestants
     * @param {object} [args.jours]        { ecoules, mois } en jours OUVRES
     * @param {number} [args.facteurMax]   plafond, en multiples du rythme mensuel
     * @param {string} [args.principal]    produit mis en avant
     * @param {number} [args.nbProduits]   taille du plan cumule (defaut 5)
     */

    /**
     * Le PRIX qu'il faudrait pratiquer, a VOLUME INCHANGE, pour degager `manque`
     * F de marge supplementaire sur `volumeRestant` unites.
     *
     * Une seule ecriture pour les deux endroits qui posent la meme question -
     * planEquilibre (un seul produit) et volumesProjetes (chaque produit) -
     * pour qu'une correction future (la commission induite par une hausse de
     * prix, par exemple) ne se fasse pas a un seul des deux endroits.
     */
    function prixPourCombler(prixActuel, manque, volumeRestant) {
        if (prixActuel === null || prixActuel === undefined) return null;
        if (!(volumeRestant > 0)) return null;
        return nb(prixActuel) + nb(manque) / volumeRestant;
    }
    function planEquilibre(args) {
        var plCentral = args.plCentral;
        if (plCentral === null || plCentral === undefined) return null;
        // LE PL VISE. Zero par defaut - l'equilibre - mais ce n'en est qu'un
        // cas particulier: un boucher qui veut degager 100 000 F ne se
        // contente pas de ne pas perdre, et le plan doit alors chiffrer
        // l'effort vers CE chiffre-la. Tout ce qui suit ne connait que
        // `manque`, donc la generalisation ne coute rien de plus.
        var cible = nb(args.cible);
        var manque = cible - plCentral;
        // Cible deja atteinte: il n'y a pas d'effort a demander. On se tait
        // plutot que d'afficher un plan a effort negatif, qui se lirait comme
        // une consigne de vendre moins.
        if (!(manque > 0)) return null;
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
        // MEME normalisation que partout ailleurs dans la chaine (accents ET
        // casse). Sans le retrait des diacritiques, « Boeuf en detail » vendu
        // sans accent ne rejoignait pas le pilote « Boeuf en détail », et le
        // plan se rabattait silencieusement sur un autre produit.
        var cle = function (s) {
            return String(s == null ? '' : s).normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        };
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
            prixRequis: prixPourCombler(principal.prixMoyen, manque, principal.volumeRestant),
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
            //
            // JAMAIS sous le volume deja attendu. Le plafond vient du rythme
            // par JOURS, le volume attendu de la proportion de CA: les deux
            // bases peuvent diverger, et le plafond passait alors SOUS un
            // total qu'il etait cense contenir - l'ecran affichait « total
            // 70 u » sous un « plafond 60 u ». Un plafond ne peut pas
            // interdire ce qui arrive sans rien faire; il ne borne que
            // l'EFFORT qu'on ajoute par-dessus.
            var plafondReste = Math.max(plafondMois - x.quantiteActuelle, x.volumeRestant);
            // L'effort n'occupe que la place laissee au-dessus du volume deja
            // attendu. Positif ou nul par construction, desormais.
            var effortMax = plafondReste - x.volumeRestant;
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

    /**
     * LES VOLUMES qu'une projection suppose, et l'ecart a l'equilibre en
     * quantite.
     *
     * Le CA projete ne dit pas combien de MARCHANDISE il faudra vendre. C'est
     * pourtant ce chiffre-la qui se commande: une projection a 5,4 M F ne se
     * prepare pas, 250 kg de boeuf si.
     *
     * Chaque produit garde sa PART du melange - meme hypothese que
     * effetSurLaSuite, qui multiplie deja les quantites par la proportion des
     * jours restants. En prendre une autre ici ferait diverger deux lectures
     * du meme mois.
     *
     * L'ECART A L'EQUILIBRE garde son SIGNE: un PL projete positif autorise a
     * vendre moins, et un nombre negatif le dit mieux qu'un zero. La marge
     * retenue est celle passee en `margeDe` - la meme que planEquilibre, donc
     * commission induite deduite. Un produit dont la marge est inconnue ne
     * participe ni a la moyenne ni au partage: l'inclure au denominateur
     * diluerait la moyenne et gonflerait les kilos demandes, sur un chiffre
     * qu'on ne sait pas etablir.
     *
     * `raison` nomme pourquoi l'ecart n'est pas chiffre, plutot que de laisser
     * l'ecran deviner: 'sans_pl' n'est PAS 'marge_non_positive', et les deux
     * ne se disent pas a l'utilisateur de la meme facon.
     */
    function volumesProjetes(args) {
        var produits = (args && args.produits) || [];
        var proportion = nb(args && args.proportion);
        var margeDe = (args && args.margeDe) || function () { return null; };
        var plCentral = args ? args.plCentral : null;
        if (!produits.length || !(proportion > 0)) return null;
        // LES RESTES PEUVENT VENIR DU DEHORS.
        //
        // Des qu'une quantite est saisie a la main, q x proportion n'est plus
        // le reste de cette ligne. Sans cette entree, le tableau affichait le
        // reste saisi mais calculait son delta d'equilibre et son prix
        // conseille sur le reste du mix - deux volumes differents sur la meme
        // ligne, et une ligne de total qui ne sommait plus sa propre colonne.
        var restesFournis = (args && args.restes) || null;
        var cleDeV = (args && args.cleDe)
            || function (n) { return String(n === null || n === undefined ? '' : n); };
        var resteDe = function (p, q) {
            if (!restesFournis) return q * proportion;
            // Meme piege qu'au-dessus: nb() ne rend jamais NaN, donc le test
            // laissait passer n'importe quoi a zero. parseFloat direct.
            var lu = parseFloat(restesFournis[cleDeV(p.nom)]);
            return isFinite(lu) ? lu : q * proportion;
        };

        var margeParNom = {};
        produits.forEach(function (p) { margeParNom[p.nom] = margeDe(p); });
        var chiffrables = produits.filter(function (p) {
            return margeParNom[p.nom] !== null && margeParNom[p.nom] !== undefined;
        });
        var qEq = 0, margePonderee = 0;
        chiffrables.forEach(function (p) {
            var q = nb(p.quantite);
            qEq += q;
            margePonderee += q * nb(margeParNom[p.nom]);
        });
        var margeMoy = qEq > 0 ? margePonderee / qEq : 0;

        var raison = null;
        if (plCentral === null || plCentral === undefined) raison = 'sans_pl';
        else if (!(margeMoy > 0)) raison = 'marge_non_positive';
        // MEME cible que planEquilibre: les deux repondent a la meme question
        // - combien pour atteindre ce PL-la - et deux cibles differentes sur
        // le meme ecran se contrediraient. Zero reste le defaut, et l'ecart
        // garde son signe: au-dessus de la cible, on peut vendre moins.
        var manqueTotal = raison ? null : (nb(args.cible) - nb(plCentral));
        var deltaTotal = manqueTotal === null ? null : manqueTotal / margeMoy;

        var tot = { vendu: 0, reste: 0, mois: 0, delta: 0 };
        var lignes = produits.map(function (p) {
            var q = nb(p.quantite);
            var reste = resteDe(p, q);
            var mois = q + reste;
            var chiffrable = margeParNom[p.nom] !== null && margeParNom[p.nom] !== undefined;
            var delta = (deltaTotal !== null && chiffrable && qEq > 0)
                ? deltaTotal * (q / qEq) : null;
            tot.vendu += q;
            tot.reste += reste;
            tot.mois += mois;
            if (delta !== null) tot.delta += delta;
            // LE PRIX AU LIEU DU VOLUME: meme manque, meme repartition au
            // prorata du melange (q/qEq) - la question demandee n'est pas
            // "combien de kilos en plus" mais "a quel prix vendre CE QUI
            // RESTE". Le cout est deja net de parage: margeDe() (donc
            // margeApresCommission cote ecran) divise le cout carcasse par
            // (1-parage) en interne, ce n'est pas reecrit ici.
            //
            // prix requis = prix actuel + (part du manque) / (kilos restants):
            // une marge qui doit monter de X F/kg fait monter le prix du
            // meme X, le cout ne bougeant pas. Meme principe que le Plan A
            // "a volume inchange" du plan d'equilibre, applique ici a chaque
            // produit plutot qu'a un seul.
            var prixMoyen = (p.prix_moyen === null || p.prix_moyen === undefined)
                ? null : nb(p.prix_moyen);
            var manquePart = (manqueTotal !== null && chiffrable && qEq > 0)
                ? manqueTotal * (q / qEq) : null;
            var prixRequis = manquePart === null ? null
                : prixPourCombler(prixMoyen, manquePart, reste);
            return {
                nom: p.nom, vendu: q, reste: reste, mois: mois,
                delta: delta, equilibre: delta === null ? null : mois + delta,
                marge: chiffrable ? nb(margeParNom[p.nom]) : null,
                prixMoyen: prixMoyen, prixRequis: prixRequis
            };
        });
        tot.equilibre = deltaTotal === null ? null : tot.mois + tot.delta;
        return {
            lignes: lignes, totaux: tot, margeMoyenne: margeMoy,
            deltaTotal: deltaTotal, raison: raison,
            nbSansMarge: produits.length - chiffrables.length
        };
    }

    return {
        COEFFS_DOCUMENT: COEFFS_DOCUMENT,
        volumesProjetes: volumesProjetes,
        tauxMargeCourant: tauxMargeCourant,
        typeJour: typeJour,
        finDuMois: finDuMois,
        joursEntre: joursEntre,
        joursOuvres: joursOuvres,
        estDimanche: estDimanche,
        rythmeParType: rythmeParType,
        calibrerCoeff: calibrerCoeff,
        rythmesRetenus: rythmesRetenus,
        projeterCA: projeterCA,
        caAuxDerniersPrix: caAuxDerniersPrix,
        repartirRestes: repartirRestes,
        margeDesRestes: margeDesRestes,
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
