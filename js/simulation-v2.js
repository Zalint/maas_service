/**
 * Simulation 2.0 — ecran client.
 *
 * ISOLE A DESSEIN. Ce fichier n'est charge que par une balise <script> dans
 * index.html; il n'exporte rien, ne modifie aucune fonction de js/finance.js,
 * et construit son onglet et son pane par le DOM plutot que par du markup
 * statique. Le supprimer, c'est retirer une ligne d'index.html et ce fichier.
 *
 * TROIS REGLES qui rendent cette isolation reelle:
 *
 *  1. Aucun identifiant en "fin-sim-". Tout est prefixe "sim2-". Sans cette
 *     regle, ensureDefaultDates() de la v1 - qui remplit une liste d'ids
 *     codee en dur incluant fin-sim-date-debut - ecrirait dans les champs de
 *     la v2 sans que rien ne le signale.
 *  2. Un pane a part, jamais celui de la v1. Ses ecouteurs restent branches
 *     sur son propre pane et ne peuvent pas muter l'etat d'ici.
 *  3. Aucun recalcul du resultat. Le PL vient de /api/finance/pl, la
 *     sensibilite de /api/finance/simulation. Cet ecran ne fait que de
 *     l'arithmetique sur ce que le serveur a deja etabli.
 *
 * L'onglet n'apparait que si le drapeau d'administration est ouvert ET si le
 * role a droit au PL. Le drapeau seul n'a jamais valu droit d'acces: les
 * routes refont le controle.
 */
(function () {
    'use strict';

    // ---------------------------------------------------------------- outils
    var esc = function (s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    var nb = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
    var fmt = function (v) {
        if (v === null || v === undefined || isNaN(v)) return '—';
        var s = Math.abs(Math.round(v)).toLocaleString('fr-FR');
        return (v < 0 ? '−' : '') + s;
    };
    // UN chiffre apres la virgule au minimum, deux si le premier ne suffit
    // pas a sortir du zero. Une cadence de 0,17 u/jour arrondie a l'entier
    // s'affichait « 0 », ce qui se lit comme « rien a faire » alors qu'il
    // faut bien vendre 3 unites d'ici la fin du mois.
    var fmtDec = function (v) {
        if (v === null || v === undefined || isNaN(v)) return '—';
        var s = Math.abs(v).toLocaleString('fr-FR', {
            minimumFractionDigits: 1, maximumFractionDigits: 2
        });
        return (v < 0 ? '−' : '') + s;
    };
    var signe = function (v) { return (v > 0 ? '+' : '') + fmt(v); };
    var cls = function (v) { return v > 0 ? 'text-success' : (v < 0 ? 'text-danger' : ''); };
    var $ = function (id) { return document.getElementById('sim2-' + id); };
    // Meme normalisation que le serveur (lib/parage.js): accents et casse
    // ignores. Sert a rapprocher un libelle de stock d'un nom de produit.
    var norm = function (s) {
        return String(s == null ? '' : s).normalize('NFD')
            .replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    };
    var jsonOu = function (url, defaut) {
        return fetch(url, { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) { return (j && j.success) ? j.data : defaut; })
            .catch(function () { return defaut; });
    };

    // ---------------------------------------------------------------- etat
    var etat = {
        base: null,        // { pl, ventes, source, periode, ... }
        produits: [],      // sensibilite par produit
        leviers: {},       // cle produit -> { prix, unite, vol }
        globaux: null,     // { charges, dep, com, comBase, parBov, parOvi, dPa }
        contexte: null,    // { varBovin, varOvin, coeff, parageBase, boeuf:{matin,soir}, commission }
        figes: [],         // liste des PL figes
        mode: 'auto',
        enAttente: false,
        debug: false,
        chargement: false,
        // Parametres de la projection fin de mois, ajustables a l'ecran.
        // coeff null = prendre le calibre sur l'historique, sinon la
        // reference du document.
        proj: {
            coeff: null, poidsReel: 0.7, minJours: 5,
            stockOption: 'garder', depensesOption: 'realise',
            // Combien de fois le rythme mensuel d'un produit on s'autorise a
            // lui demander, dans le plan d'equilibre.
            facteurMax: 3,
            // La boucherie ne vend pas le dimanche: le compter comme une
            // journee a zero diluerait le rythme et gonflerait les jours
            // restants. Actif par defaut, decochable ici.
            exclureDimanche: true
        }
    };

    // ============================================================ INJECTION
    /**
     * DANS l'onglet Simulation existant, pas a cote.
     *
     * Un second onglet aurait ajoute une dixieme entree a une barre qui en
     * porte deja neuf, dont deux nommees "Simulation": la comparaison v1/v2
     * ne vaut pas cette confusion. Une bascule en tete du pane la permet
     * quand meme, a un clic pres.
     *
     * L'isolation ne change pas: on n'ajoute rien a la barre, on ne touche
     * pas au markup de la v1, et ses enfants sont simplement MASQUES - leur
     * display d'origine est memorise et restitue. La v1 continue de rendre
     * dans #fin-sim-result, qui reste son enfant a elle.
     */
    function injecter() {
        var v1 = document.querySelector('[data-fin-pane="simulation"]');
        if (!v1 || document.getElementById('sim2-bascule')) return false;

        // Capture AVANT insertion: la bascule et la boite ne doivent pas se
        // masquer elles-memes.
        var enfantsV1 = Array.prototype.slice.call(v1.children).map(function (el) {
            return { el: el, display: el.style.display };
        });

        var bascule = document.createElement('div');
        bascule.id = 'sim2-bascule';
        bascule.className = 'btn-group btn-group-sm mb-3';
        // La couleur du texte selectionne est posee EN LIGNE, pas laissee aux
        // classes Bootstrap: le theme de l'application redefinit la couleur de
        // .btn-primary et de .active, et le libelle du bouton choisi
        // ressortait bleu sur fond bleu, donc illisible.
        bascule.innerHTML =
            '<button type="button" class="btn btn-primary" data-v="1" style="color:#fff">Version actuelle</button>'
            + '<button type="button" class="btn btn-outline-primary" data-v="2">Simulation 2.0</button>';

        var boite = document.createElement('div');
        boite.id = 'sim2-boite';
        boite.style.display = 'none';
        boite.innerHTML = gabarit();

        v1.insertBefore(bascule, v1.firstChild);
        v1.appendChild(boite);

        bascule.addEventListener('click', function (e) {
            var b = e.target.closest('[data-v]');
            if (!b) return;
            var versDeux = b.dataset.v === '2';
            bascule.querySelectorAll('[data-v]').forEach(function (x) {
                var choisi = x === b;
                x.classList.toggle('btn-primary', choisi);
                x.classList.toggle('btn-outline-primary', !choisi);
                x.style.color = choisi ? '#fff' : '';
            });
            enfantsV1.forEach(function (o) {
                o.el.style.display = versDeux ? 'none' : o.display;
            });
            boite.style.display = versDeux ? '' : 'none';
            if (versDeux) charger();
        });

        cabler();
        return true;
    }

    function gabarit() {
        return ''
        + '<div class="alert alert-light border small mb-3">'
        +   '<i class="bi bi-sliders"></i> <strong>Simulation 2.0.</strong> '
        +   'Plusieurs leviers à la fois, sur un résultat de référence au choix. '
        +   'Le résultat vient du PL et n\'est jamais recalculé ici.'
        + '</div>'
        + '<div id="sim2-bandeaux"></div>'
        + '<div class="row g-2 mb-3 align-items-end">'
        +   '<div class="col-md-2"><label class="form-label">Date début</label>'
        +     '<input type="date" id="sim2-debut" class="form-control form-control-sm"></div>'
        +   '<div class="col-md-2"><label class="form-label">Date fin</label>'
        +     '<input type="date" id="sim2-fin" class="form-control form-control-sm"></div>'
        +   '<div class="col-md-3"><label class="form-label">Résultat de référence</label>'
        +     '<select id="sim2-ref" class="form-select form-select-sm"><option value="calcul">Calculé maintenant</option></select></div>'
        +   '<div class="col-md-2"><label class="form-label">Mode de calcul</label>'
        +     '<select id="sim2-mode" class="form-select form-select-sm">'
        +       '<option value="auto">Automatique</option><option value="manuel">Manuel</option></select></div>'
        +   '<div class="col-md-3"><label class="form-label">&nbsp;</label><div class="d-flex gap-2">'
        +     '<button class="btn btn-sm btn-primary" id="sim2-calc"><i class="bi bi-calculator"></i> Calculer</button>'
        +     '<button class="btn btn-sm btn-outline-secondary" id="sim2-reset">Réinitialiser</button>'
        +     '<div class="form-check form-switch ms-1 d-flex align-items-center">'
        +       '<input class="form-check-input" type="checkbox" id="sim2-debug">'
        +       '<label class="form-check-label small ms-1" for="sim2-debug">Debug</label></div>'
        +   '</div></div>'
        + '</div>'
        + '<div id="sim2-corps"><div class="text-muted"><i class="bi bi-hourglass-split"></i> Chargement…</div></div>';
    }

    function cabler() {
        $('debut').addEventListener('change', charger);
        $('fin').addEventListener('change', charger);
        $('ref').addEventListener('change', charger);
        $('mode').addEventListener('change', function () {
            etat.mode = $('mode').value;
            if (etat.mode === 'auto') rendre();
        });
        $('calc').addEventListener('click', rendre);
        $('reset').addEventListener('click', function () {
            etat.leviers = {};
            // reinitGlobaux(), PAS null. Poser null laissait nbActifs() lire
            // s.globaux.charges sur null: le bouton levait une TypeError et
            // l'ecran ne bougeait pas - une remise a zero qui ne remettait
            // rien. Et si le rendu avait survecu, globauxDe() aurait lu {},
            // donc com absent, donc un gain fantome egal a TOUTE la
            // commission (+194 139 F sur juillet).
            reinitGlobaux();
            rendre();
        });
        // Le mode debug revele l'etat courant, il n'est pas un levier: il
        // s'affiche immediatement meme en calcul manuel.
        $('debug').addEventListener('change', function () {
            etat.debug = $('debug').checked;
            rendre();
        });
    }

    // ============================================================ CHARGEMENT
    function charger() {
        if (etat.chargement) return;
        var d = $('debut'), f = $('fin');
        if (!d.value || !f.value) {
            // Periode par defaut: on herite de celle du PL si elle est posee,
            // sinon 1er du mois -> aujourd'hui.
            var plD = document.getElementById('fin-pl-date-debut');
            var plF = document.getElementById('fin-pl-date-fin');
            var t = new Date();
            // Construite depuis les composants LOCAUX, jamais par
            // toISOString(): celui-ci serialise en UTC une date creee a minuit
            // local, donc a Paris en ete le 1er du mois ressortait au 31 du
            // mois precedent, et la periode par defaut englobait un jour de
            // juillet dans « le mois en cours ». A Dakar (UTC+0) les deux
            // formes coincident, ce qui rendait le defaut invisible ici.
            var iso = function (x) {
                return x.getFullYear() + '-'
                    + String(x.getMonth() + 1).padStart(2, '0') + '-'
                    + String(x.getDate()).padStart(2, '0');
            };
            if (!d.value) d.value = (plD && plD.value) || iso(new Date(t.getFullYear(), t.getMonth(), 1));
            if (!f.value) f.value = (plF && plF.value) || iso(t);
        }
        etat.chargement = true;
        var corps = $('corps');
        corps.innerHTML = '<div class="text-muted"><i class="bi bi-hourglass-split"></i> Calcul en cours…</div>';

        var fige = $('ref').value !== 'calcul' ? $('ref').value : null;
        var qs = 'dateDebut=' + encodeURIComponent(d.value) + '&dateFin=' + encodeURIComponent(f.value);

        Promise.all([
            jsonOu('/api/finance/simulation?' + qs, null),
            jsonOu('/api/finance/pl?' + qs, null),
            jsonOu('/api/finance/config', {}),
            jsonOu('/api/finance/pl/snapshots', []),
            fige ? jsonOu('/api/finance/pl/snapshots/' + encodeURIComponent(fige), null) : Promise.resolve(null)
        ]).then(function (r) {
            etat.chargement = false;
            var sim = r[0], pl = r[1], cfg = r[2] || {}, snaps = r[3] || [], snap = r[4];
            if (!sim || !pl) {
                corps.innerHTML = '<div class="alert alert-danger">Chiffres indisponibles. '
                    + 'Vérifiez la période, ou vos droits sur le PL.</div>';
                return;
            }
            etat.figes = snaps;
            remplirSelecteurFiges(snaps, fige);

            var payload = pl;
            var source = 'Calculé maintenant';
            if (fige) {
                if (!snap || !snap.payload) {
                    corps.innerHTML = '<div class="alert alert-warning">Ce PL figé est illisible.</div>';
                    return;
                }
                // Un PL fige AVANT le socle ne porte pas ses volumes: rejouer
                // la simulation dessus melangerait un resultat fige et des
                // volumes d'aujourd'hui. On refuse plutot que de melanger.
                if (!snap.payload.volumes) {
                    corps.innerHTML = '<div class="alert alert-warning">'
                        + 'Le PL figé du ' + esc(snap.date) + ' ne porte pas ses volumes vendus : '
                        + 'il a été figé avant que le socle ne les y grave. '
                        + 'La simulation ne peut pas être rejouée dessus sans mélanger '
                        + 'un résultat figé et des volumes d\'aujourd\'hui.</div>';
                    return;
                }
                payload = snap.payload;
                source = 'PL figé du ' + snap.date;
                $('debut').value = snap.periode_debut;
                $('fin').value = snap.periode_fin;
            }
            $('debut').disabled = $('fin').disabled = !!fige;

            preparer(sim, payload, cfg, source, !!fige);
            rendre();
        }).catch(function (e) {
            etat.chargement = false;
            corps.innerHTML = '<div class="alert alert-danger">Erreur : ' + esc(e.message) + '</div>';
        });
    }

    function remplirSelecteurFiges(snaps, courant) {
        var sel = $('ref');
        var val = courant || 'calcul';
        sel.innerHTML = '<option value="calcul">Calculé maintenant</option>'
            + snaps.slice(0, 60).map(function (s) {
                return '<option value="' + esc(s.date) + '">PL figé du ' + esc(s.date) + '</option>';
            }).join('');
        sel.value = val;
    }

    function preparer(sim, pl, cfg, source, estFige) {
        var stock = pl.stock || {};
        // Quantite de carcasse bovine aux deux bornes. Le prix d'achat du
        // boeuf valorise ces deux photos: seule leur DIFFERENCE bouge le
        // resultat.
        // Seules les lignes valorisees AU PRIX D'ACHAT comptent: une ligne
        // restee au prix de vente (cout inconnu a cette borne) n'est pas
        // revalorisee par un changement de prix d'achat. Et la famille est
        // bovine, pas la seule graphie 'boeuf': le stock de Veau y entre.
        var qBoeuf = function (detail) {
            var t = 0;
            (detail || []).forEach(function (l) {
                if (l.base === 'achat' && /^(boeuf|veau)/.test(norm(l.produit))) t += nb(l.quantite);
            });
            return t;
        };
        etat.base = {
            pl: nb(pl.pl), ventes: nb(pl.total_ventes), source: source, fige: estFige,
            periode: pl.periode || {}, sources: pl.sources || null, stock: stock,
            postes: postesDe(pl),
            ventesDateFin: pl.ventes_date_fin || null
        };
        // Le payload BRUT sert a la projection fin de mois: elle a besoin des
        // postes nommes et du total mensuel des charges, pas du tableau
        // d'affichage.
        etat.plBrut = pl;
        var produits = (sim.produits || []).map(function (p) { return p; });
        if (estFige && pl.volumes && Array.isArray(pl.volumes.produits)) {
            // MODE FIGE: les volumes viennent du SNAPSHOT, jamais du calcul
            // vivant. Sans cette superposition, la garde sur payload.volumes
            // ne protegeait RIEN: les quantites affichees venaient de
            // /simulation d'aujourd'hui, melees a un resultat fige. Les prix
            // d'achat, eux, restent ceux resolus pour la meme periode.
            var figes = {};
            pl.volumes.produits.forEach(function (v) { figes[v.cle] = v; });
            produits = produits.map(function (p) {
                var v = figes[norm(p.nom)];
                if (!v) {
                    return Object.assign({}, p, {
                        quantite: 0, ca: 0, prix_moyen: null, nb_lignes: 0, sans_vente: true
                    });
                }
                return Object.assign({}, p, {
                    quantite: nb(v.quantite), ca: nb(v.ca),
                    prix_moyen: (v.prix_moyen === null || v.prix_moyen === undefined) ? null : nb(v.prix_moyen),
                    nb_lignes: v.nb_lignes, sans_vente: nb(v.quantite) === 0
                });
            });
        }
        etat.produits = produits;
        etat.sim = sim;
        var parageBase = nb(stock.pertes_decoupe_pct);
        etat.contexte = {
            varBovin: nb(stock.variation_bovin),
            varOvin: nb(stock.variation_ovin),
            varAutre: nb(stock.variation_autre_boucherie),
            coeff: nb(stock.coeff),
            parageBase: parageBase,
            boeuf: { matin: qBoeuf(stock.matin_detail), soir: qBoeuf(stock.soir_detail) },
            commission: nb(pl.commission_maas),
            commissionPct: nb(cfg.commission_pct) || 3,
            // Prix de VENTE catalogue des carcasses: l'assiette de la
            // commission MaaS. Le moteur en a besoin pour faire suivre la
            // commission aux achats que les leviers induisent.
            pv: {
                bovin: sim.catalogue ? sim.catalogue.pv_boeuf : null,
                ovin: sim.catalogue ? sim.catalogue.pv_agneau : null,
                volaille: sim.catalogue ? sim.catalogue.pv_poulet : null
            }
        };
        etat.base.avertissements = [];
        if (estFige && stock.variation_bovin === undefined) {
            // Snapshot fige entre l'arrivee des volumes et celle de la
            // ventilation par espece: les effets stock du parage valent 0,
            // et le dire vaut mieux que laisser croire a un zero mesure.
            etat.base.avertissements.push(
                'Ce PL figé ne porte pas la ventilation du stock par espèce : '
                + 'les effets stock des taux de parage ne sont pas chiffrables dessus.'
            );
        }
        if (!etat.globaux) reinitGlobaux();
    }

    function reinitGlobaux() {
        var c = etat.contexte;
        etat.globaux = {
            charges: 0, dep: 0,
            com: c ? c.commissionPct : 3,
            parBov: c ? c.parageBase : 0,
            parOvi: c ? c.parageBase : 0,
            dPa: 0
        };
    }

    function postesDe(pl) {
        var ch = pl.charges || {};
        return [
            { lib: 'Chiffre d\'affaires', s: 1, v: nb(pl.total_ventes) },
            { lib: 'Avances MataBanq', s: -1, v: nb(pl.total_avances) },
            { lib: 'Commission MaaS', s: -1, v: nb(pl.commission_maas) },
            { lib: 'Marge Centre de Découpe', s: 1, v: nb(pl.marge_cdc) },
            { lib: 'Charges fixes au prorata', s: -1, v: nb(ch.total_prorata) },
            { lib: 'Dépenses', s: -1, v: nb(pl.depenses_periode) },
            { lib: 'Paiements fournisseur', s: -1, v: nb(pl.paiements_fournisseur) },
            { lib: 'Variation de stock nette', s: 1, v: nb((pl.stock || {}).variation_nette) }
        ];
    }

    // ============================================================ CALCUL
    // TOUT le calcul vit dans js/simulation-v2-moteur.js, un module PUR teste
    // par Jest (tests/simulation-v2-moteur.test.js). Ces enrobages ne font
    // que lui passer les donnees de la periode: aucune formule n'est ecrite
    // ici, donc ce que l'ecran affiche est exactement ce que les tests
    // verifient.
    var M = (typeof window !== 'undefined' && window.Sim2Moteur) || null;

    function donnees() { return { produits: etat.produits, contexte: etat.contexte }; }
    function estBoeuf(p) { return M.estBoeuf(p); }
    function margeAvec(p, s) { return M.margeAvec(p, s, etat.contexte); }
    function effetProduit(p, s) { return M.effetProduit(p, s, etat.contexte); }
    function effetsGlobaux(s) { return M.effetsGlobaux(donnees(), s); }
    function effetTotal(s) { return M.effetTotal(donnees(), s); }


    function snapshotEtat() {
        return {
            leviers: JSON.parse(JSON.stringify(etat.leviers)),
            globaux: JSON.parse(JSON.stringify(etat.globaux))
        };
    }

    function nbActifs(s) {
        var c = etat.contexte, n = 0;
        etat.produits.forEach(function (p) {
            var l = s.leviers[p.nom]; if (l && (l.prix || l.vol)) n++;
        });
        if (nb(s.globaux.charges)) n++;
        if (nb(s.globaux.dep)) n++;
        if (nb(s.globaux.com) !== c.commissionPct) n++;
        if (nb(s.globaux.parBov) !== c.parageBase) n++;
        if (nb(s.globaux.parOvi) !== c.parageBase) n++;
        if (nb(s.globaux.dPa)) n++;
        return n;
    }

    // ============================================================ RENDU
    function rendre() {
        if (!etat.base) return;
        etat.enAttente = false;
        var b = $('calc');
        if (b) { b.classList.remove('btn-warning'); b.classList.add('btn-primary'); b.innerHTML = '<i class="bi bi-calculator"></i> Calculer'; }

        var s = snapshotEtat();
        // La matrice et son detail au clic doivent decrire le MEME scenario:
        // en mode manuel, des saisies en attente ne sont pas encore rendues,
        // et cliquer une case doit expliquer la case affichee, pas l'etat
        // des champs.
        etat.scenarioRendu = s;
        var g = effetsGlobaux(s);
        var total = effetTotal(s);
        var n = nbActifs(s);

        $('bandeaux').innerHTML = bandeaux();
        $('corps').innerHTML = ''
            + panneauScenario(s, g)
            + kpis(total, n)
            + tableau(s, total)
            + equilibre(s)
            + matrice(s)
            + projection()
            + (etat.debug ? debug(s, g, total) : '');
        cablerLeviers();
    }

    function marquerEnAttente() {
        etat.enAttente = true;
        var b = $('calc');
        if (b) { b.classList.remove('btn-primary'); b.classList.add('btn-warning'); b.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Calculer (en attente)'; }
    }

    function onLevier() {
        if (etat.mode === 'manuel') { marquerEnAttente(); return; }
        rendre();
    }

    function bandeaux() {
        var b = etat.base, st = b.stock || {}, h = '';
        var src = b.sources && b.sources.avances;
        if (src && src.etat === 'indisponible') {
            h += '<div class="alert alert-danger py-2 small mb-2"><i class="bi bi-exclamation-triangle"></i> '
               + '<strong>Avances MataBanq indisponibles.</strong> ' + esc(src.raison || '')
               + '. Elles comptent pour 0 : le résultat est surévalué d\'autant, et le PL ne peut pas être figé.</div>';
        } else if (src && src.etat === 'non_configure') {
            h += '<div class="alert alert-secondary py-2 small mb-2"><i class="bi bi-info-circle"></i> '
               + 'MataBanq n\'est pas configuré ici : les avances valent zéro, ce qui est normal sur ce déploiement.</div>';
        }
        (b.avertissements || []).forEach(function (a) {
            h += '<div class="alert alert-warning py-2 small mb-2"><i class="bi bi-exclamation-triangle"></i> '
               + esc(a) + '</div>';
        });
        // Derniere journee sans vente: la simulation part du meme PL, elle
        // herite donc du meme resultat tronque. Le taire ici ferait raisonner
        // sur des leviers appliques a une periode incomplete.
        var vdf = b.ventesDateFin;
        if (vdf && vdf.aucune_vente === true) {
            h += '<div class="alert alert-warning py-2 small mb-2"><i class="bi bi-calendar-x"></i> '
               + '<strong>Aucune vente saisie le ' + esc(vdf.date) + '</strong>, dernier jour de la période. '
               + (vdf.derniere_date_avec_vente
                   ? 'Dernière journée avec des ventes : ' + esc(vdf.derniere_date_avec_vente) + '. '
                   : 'Aucune vente sur toute la période. ')
               + 'Le résultat de référence est incomplet, et les leviers s\'y appliquent tels quels.</div>';
        }
        var poids = b.pl ? Math.abs(nb(st.variation_nette) / b.pl) * 100 : 0;
        h += '<div class="alert alert-light border py-2 small mb-3"><i class="bi bi-info-circle"></i> '
           + 'Résultat <strong>' + esc(b.source) + '</strong>, du ' + esc(b.periode.dateDebut || '')
           + ' au ' + esc(b.periode.dateFin || '') + '. '
           + 'Stock du soir au ' + esc(st.soir_date || '—') + ', il pèse ' + esc(fmt(nb(st.variation_nette)))
           + ' F soit ' + poids.toFixed(1) + ' % du résultat. '
           + 'Prix d\'achat : ' + (etat.sim && etat.sim.prix_achat && etat.sim.prix_achat.mode === 'periode'
               ? 'moyenne de la période pondérée par les quantités vendues.'
               : 'figé au dernier jour de la période.')
           + '</div>';
        var av = (etat.sim && etat.sim.prix_achat && etat.sim.prix_achat.avertissements) || [];
        if (av.length) {
            h += '<div class="alert alert-warning py-2 small mb-3"><i class="bi bi-exclamation-triangle"></i> '
               + av.map(esc).join('<br>') + '</div>';
        }
        return h;
    }

    function panneauScenario(s, g) {
        var c = etat.contexte;
        var lignes = etat.produits.map(function (p, i) {
            var l = s.leviers[p.nom] || { prix: 0, unite: 'F', vol: 0 };
            var m = margeAvec(p, s);
            var e = effetProduit(p, s);
            return '<tr>'
                + '<td>' + esc(p.nom)
                  + (p.prix_achat_origine === 'famille_poulet' ? ' <span class="badge bg-success-subtle text-success">famille poulet</span>' : '')
                  + (p.prix_achat_origine === 'repli_poulet' ? ' <span class="badge bg-warning-subtle text-warning">prix de repli</span>' : '')
                  + (m !== null && m < 0 ? ' <span class="badge bg-danger-subtle text-danger">marge négative</span>' : '')
                  + (p.sans_vente ? ' <span class="badge bg-light text-muted">aucune vente</span>' : '')
                + '</td>'
                + '<td class="text-end"><div class="input-group input-group-sm" style="width:11rem;margin-left:auto">'
                  + '<input type="number" class="form-control sim2-lev" data-p="' + i + '" data-k="prix" value="' + l.prix + '" step="50">'
                  + '<select class="form-select sim2-lev" data-p="' + i + '" data-k="unite" style="max-width:4rem">'
                    + '<option>F</option><option' + (l.unite === '%' ? ' selected' : '') + '>%</option></select>'
                + '</div></td>'
                + '<td class="text-end"><input type="number" class="form-control form-control-sm sim2-lev" '
                  + 'data-p="' + i + '" data-k="vol" value="' + l.vol + '" step="10" style="width:7rem;margin-left:auto"></td>'
                + '<td class="text-end ' + cls(e) + '">' + (e ? esc(signe(e)) : '0') + '</td>'
                + '</tr>';
        }).join('');

        var glob = function (id, lib, val, step, suffixe, effet, note) {
            var bornes = (id === 'parBov' || id === 'parOvi') ? ' min="0" max="99"' : '';
            return '<tr><td>' + lib + (note ? ' <span class="text-muted small">' + note + '</span>' : '') + '</td>'
                + '<td class="text-end" colspan="2"><input type="number" class="form-control form-control-sm sim2-glob" '
                + 'data-g="' + id + '" value="' + val + '" step="' + step + '"' + bornes + ' style="width:9rem;margin-left:auto"></td>'
                + '<td class="text-end ' + cls(effet) + '">' + (effet ? esc(signe(effet)) : '0')
                + ' <span class="text-muted small">' + suffixe + '</span></td></tr>';
        };

        return '<details class="mb-3" open><summary class="fw-medium mb-2">Scénario '
            + '<span class="badge bg-secondary">' + nbActifs(s) + ' levier(s)</span></summary>'
            + '<div class="table-responsive"><table class="table table-sm mb-0">'
            + '<thead><tr><th>Levier</th><th class="text-end">Prix de vente</th>'
            + '<th class="text-end">Volume (unités)</th><th class="text-end">Effet</th></tr></thead>'
            + '<tbody>' + lignes
            + '<tr><td colspan="4" class="p-0"><hr class="my-1"></td></tr>'
            + glob('charges', 'Charges fixes', s.globaux.charges, 25000, 'FCFA', g.ch)
            + glob('dep', 'Dépenses', s.globaux.dep, 10000, 'FCFA', g.dp)
            + glob('com', 'Commission fournisseur', s.globaux.com, 0.5, '%', g.co)
            + glob('parBov', 'Taux de parage bœuf', s.globaux.parBov, 0.5, '%', g.pab,
                   fmt(g.det.qBovins) + ' u vendues · stock ' + fmt(etat.contexte.varBovin) + ' F')
            + glob('parOvi', 'Taux de parage agneau', s.globaux.parOvi, 0.5, '%', g.pao,
                   fmt(g.det.qOvins) + ' u vendues · stock ' + fmt(etat.contexte.varOvin) + ' F')
            + glob('dPa', 'Prix d\'achat du bœuf', s.globaux.dPa, 100, 'FCFA', g.pb,
                   fmt(g.det.qBovins) + ' unités bovines vendues · carcasse '
                   + fmt(etat.contexte.boeuf.matin) + ' → ' + fmt(etat.contexte.boeuf.soir))
            + '</tbody></table></div>'
            + '<div class="small text-muted mt-2"><strong>Hypothèse du modèle</strong> : les achats '
            + 'suivent les ventes, au taux de parage — vendre une unité consomme 1/(1−parage) de '
            + 'carcasse. Le prix d\'achat et les taux de parage agissent donc d\'abord sur le coût '
            + 'de <strong>toutes</strong> les unités vendues de leur espèce, ensuite sur le stock. '
            + 'La marge affichée est <strong>nette de parage</strong> ; la version actuelle affiche '
            + 'la marge brute (prix moyen − prix carcasse). Les taux simulés sont par espèce : '
            + 'la volaille et le reste de la boucherie restent au taux actuel. '
            + 'La commission suit les livraisons que les leviers induisent.</div>'
            + '</details>';
    }

    function kpis(total, n) {
        var b = etat.base;
        var apres = b.pl + total;
        var pct = b.pl ? (total / Math.abs(b.pl)) * 100 : 0;
        var carte = function (lab, val, hint, c) {
            return '<div class="col-md-4"><div class="card h-100"><div class="card-body text-center py-3">'
                + '<h6 class="card-subtitle mb-2 text-muted">' + lab + '</h6>'
                + '<h3 class="mb-0 ' + (c || '') + '">' + esc(val) + '</h3>'
                + '<div class="small text-muted mt-1">' + hint + '</div></div></div></div>';
        };
        return '<div class="row g-2 mb-3">'
            + carte('Résultat de référence', fmt(b.pl), esc(b.source), cls(b.pl))
            + carte('Effet du scénario', total ? signe(total) : '0',
                    n === 0 ? 'scénario vide' : n + ' levier(s) actif(s)', cls(total))
            + carte('Résultat simulé', fmt(apres), pct.toFixed(2) + ' % de variation', cls(apres))
            + '</div>';
    }

    function tableau(s, total) {
        var b = etat.base;
        var totCa = 0, tot100 = 0;
        var lignes = etat.produits.map(function (p) {
            var q = nb(p.quantite), ca = nb(p.ca), c100 = 100 * q;
            var m = margeAvec(p, s);
            var e = effetProduit(p, s);
            totCa += ca; tot100 += c100;
            var part = b.ventes > 0 ? (ca / b.ventes) * 100 : 0;
            var pa = p.prix_achat === null || p.prix_achat === undefined
                ? null : p.prix_achat + (estBoeuf(p) ? nb(s.globaux.dPa) : 0);
            return '<tr' + (p.sans_vente ? ' class="text-muted"' : '') + '>'
                + '<td>' + esc(p.nom) + '</td>'
                + '<td class="text-end">' + esc(q.toLocaleString('fr-FR')) + '</td>'
                + '<td class="text-end">' + esc(fmt(p.prix_moyen)) + '</td>'
                + '<td class="text-end' + (estBoeuf(p) && nb(s.globaux.dPa) ? ' text-danger' : '') + '">'
                  + esc(pa === null ? '—' : fmt(pa)) + '</td>'
                + '<td class="text-end' + (m !== null && m < 0 ? ' text-danger' : '') + '">'
                  + esc(m === null ? '—' : fmt(m)) + '</td>'
                + '<td class="text-end">' + esc(fmt(ca)) + '</td>'
                + '<td class="text-end">' + part.toFixed(1) + ' %</td>'
                + '<td class="text-end text-success">' + esc(fmt(c100)) + '</td>'
                + '<td class="text-end ' + cls(e) + '">' + (e ? esc(signe(e)) : '0') + '</td>'
                + '</tr>';
        }).join('');
        return '<h6 class="fin-subheading">Sensibilité par produit</h6>'
            + '<div class="table-responsive mb-3"><table class="table table-sm mb-0">'
            + '<thead><tr><th>Produit</th><th class="text-end">Quantité</th><th class="text-end">Prix moyen</th>'
            + '<th class="text-end">Prix d\'achat</th><th class="text-end">Marge</th><th class="text-end">Ventes</th>'
            + '<th class="text-end">% ventes</th><th class="text-end">CFA 100</th><th class="text-end">Effet</th></tr></thead>'
            + '<tbody>' + lignes + '</tbody>'
            + '<tfoot><tr class="table-light"><th colspan="5">Total des produits suivis</th>'
            + '<th class="text-end">' + esc(fmt(totCa)) + '</th>'
            + '<th class="text-end">' + (b.ventes > 0 ? ((totCa / b.ventes) * 100).toFixed(1) : '0') + ' %</th>'
            + '<th class="text-end text-success">' + esc(fmt(tot100)) + '</th>'
            + '<th class="text-end ' + cls(total) + '">' + esc(signe(total)) + '</th></tr></tfoot>'
            + '</table></div>'
            + '<div class="small text-muted mb-3"><strong>CFA 100</strong> : ce que rapporterait 100 FCFA '
            + 'de plus sur le prix unitaire, à quantités inchangées. '
            + '<strong>Marge</strong> : nette de parage — prix moyen − prix carcasse ÷ (1 − parage).</div>';
    }

    function equilibre(s) {
        var nomPilote = (etat.sim && etat.sim.produit_equilibre) || '';
        var p = etat.produits.filter(function (x) { return x.nom === nomPilote; })[0];
        if (!p || p.sans_vente) {
            return '<h6 class="fin-subheading">Point d\'équilibre — ' + esc(nomPilote) + '</h6>'
                + '<div class="alert alert-secondary py-2 small">Pas de vente sur la période : '
                + 'ce produit ne peut pas servir de levier.</div>';
        }
        // Le resultat A COMPENSER est celui obtenu sous toutes les AUTRES
        // hypotheses, le pilote remis a zero.
        var sansPilote = snapshotEtat();
        sansPilote.leviers[p.nom] = { prix: 0, unite: 'F', vol: 0 };
        var base = etat.base.pl + effetTotal(sansPilote);
        var q = nb(p.quantite), m = margeAvec(p, s);
        var hausse = -base / q, prixEq = nb(p.prix_moyen) + hausse;
        var dq = (m === null || m === 0) ? null : -base / m;

        var carte = function (lab, val, hint, c) {
            return '<div class="col-md-4"><div class="card h-100"><div class="card-body text-center py-3">'
                + '<h6 class="card-subtitle mb-2 text-muted">' + lab + '</h6>'
                + '<h3 class="mb-0 ' + (c || '') + '">' + esc(val) + '</h3>'
                + '<div class="small text-muted mt-1">' + hint + '</div></div></div></div>';
        };
        // Un seul levier ne ramene pas toujours a zero: un prix negatif ou une
        // baisse de volume superieure a ce qui a ete vendu sont des reponses
        // arithmetiques sans realite commerciale.
        var cPrix = prixEq < 0
            ? carte('Prix d\'équilibre', 'hors d\'atteinte',
                    'il faudrait un prix négatif', 'text-muted fs-5')
            : carte('Prix d\'équilibre', fmt(prixEq), 'par unité, à volume inchangé',
                    hausse < 0 ? 'text-success' : 'text-danger');
        var cVol = (dq === null)
            ? carte('Volume d\'équilibre', '—', 'marge inconnue ou nulle')
            : (dq < -q
                ? carte('Volume d\'équilibre', 'hors d\'atteinte',
                        'il faudrait vendre ' + fmt(-dq) + ' de moins pour ' + fmt(q) + ' vendues', 'text-muted fs-5')
                : carte('Volume d\'équilibre', signe(dq), 'à prix inchangé, via la marge nette',
                        m < 0 ? 'text-danger' : (dq > 0 ? 'text-danger' : 'text-success')));

        return '<h6 class="fin-subheading">Point d\'équilibre — ' + esc(p.nom) + '</h6>'
            + '<div class="row g-2 mb-3">'
            + carte('Résultat à compenser', fmt(base), 'sous les autres leviers', cls(base))
            + cPrix + cVol + '</div>'
            + (m !== null && m < 0
                ? '<div class="alert alert-warning py-2 small">Marge unitaire ' + esc(fmt(m))
                  + ' : chaque unité vendue en plus fait <strong>baisser</strong> le résultat.</div>' : '');
    }

    // ---- Matrice de risque. Chaque case reevalue le scenario ENTIER: les
    // termes croises sont donc exacts, jamais supposes nuls.
    // RECONSTRUITS a chaque appel, jamais mis en cache.
    //
    // Les memoiser capturait le produit et le contexte de la periode chargee
    // au premier rendu: changer de periode laissait la matrice calculer ses
    // volumes sur les quantites de l'ANCIENNE, et son taux de parage de
    // reference sur l'ancien aussi. Les cases devenaient fausses sans que rien
    // ne le signale. Six objets litteraux par rendu ne coutent rien.
    function axes() {
        var c = etat.contexte;
        var p0 = etat.produits[0];
        if (!c || !p0) return {};
        return {
            pv: { lib: 'Prix de vente ' + (p0 ? p0.nom : ''), vals: [-300, -200, -100, 0, 100, 200, 300], u: 'F',
                  set: function (s, v) { s.leviers[p0.nom] = { prix: v, unite: 'F', vol: (s.leviers[p0.nom] || {}).vol || 0 }; } },
            vol: { lib: 'Volume ' + (p0 ? p0.nom : ''), vals: [-30, -20, -10, 0, 10, 20, 30], u: '%',
                   set: function (s, v) { var l = s.leviers[p0.nom] || { prix: 0, unite: 'F', vol: 0 }; l.vol = nb(p0.quantite) * v / 100; s.leviers[p0.nom] = l; } },
            pa: { lib: 'Prix d\'achat bœuf', vals: [-400, -200, -100, 0, 100, 200, 400], u: 'F',
                  set: function (s, v) { s.globaux.dPa = v; } },
            parBov: { lib: 'Taux de parage bœuf', vals: [0, 2, 4, c.parageBase, 6, 8, 10], u: '%', abs: true,
                      set: function (s, v) { s.globaux.parBov = v; } },
            parOvi: { lib: 'Taux de parage agneau', vals: [0, 2, 4, c.parageBase, 6, 8, 10], u: '%', abs: true,
                      set: function (s, v) { s.globaux.parOvi = v; } },
            com: { lib: 'Commission', vals: [1, 2, 3, 4, 5, 6, 7], u: '%', abs: true,
                   set: function (s, v) { s.globaux.com = v; } }
        };
    }

    function matrice(s) {
        var A = axes();
        var xk = (etat.matX && A[etat.matX]) ? etat.matX : 'pa';
        var yk = (etat.matY && A[etat.matY]) ? etat.matY : 'vol';
        etat.matX = xk; etat.matY = yk;
        var ax = A[xk], ay = A[yk];
        var etiq = function (a, v) { return (a.abs ? v : (v > 0 ? '+' + v : v)) + ' ' + a.u; };
        var opt = function (sel) {
            return Object.keys(A).map(function (k) {
                return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(A[k].lib) + '</option>';
            }).join('');
        };
        var h = '<h6 class="fin-subheading">Matrice de risque</h6>'
            + '<div class="row g-2 mb-2"><div class="col-md-4"><label class="form-label small">Axe horizontal</label>'
            + '<select id="sim2-matx" class="form-select form-select-sm">' + opt(xk) + '</select></div>'
            + '<div class="col-md-4"><label class="form-label small">Axe vertical</label>'
            + '<select id="sim2-maty" class="form-select form-select-sm">' + opt(yk) + '</select></div></div>'
            + '<div class="table-responsive mb-2"><table class="table table-sm table-bordered mb-0" style="width:auto;font-size:.8rem">'
            + '<thead><tr><th class="text-muted small">' + esc(ay.lib) + ' \\ ' + esc(ax.lib) + '</th>';
        ax.vals.forEach(function (x) { h += '<th class="text-end small">' + esc(etiq(ax, x)) + '</th>'; });
        h += '</tr></thead><tbody>';
        ay.vals.forEach(function (y, j) {
            h += '<tr><th class="small">' + esc(etiq(ay, y)) + '</th>';
            var vals = ax.vals.map(function (x) {
                var c = snapshotEtat();
                ay.set(c, y); ax.set(c, x);
                return etat.base.pl + effetTotal(c);
            });
            var best = 0;
            vals.forEach(function (v, k) { if (Math.abs(v) < Math.abs(vals[best])) best = k; });
            vals.forEach(function (v, k) {
                var style = (k === best ? 'outline:2px solid var(--bs-primary);outline-offset:-2px;' : '')
                    + (etat.debug ? 'cursor:pointer;' : '');
                h += '<td class="text-end ' + (v >= 0 ? 'text-success' : 'text-danger')
                   + (etat.debug ? ' sim2-case' : '') + '" data-mi="' + j + '" data-mj="' + k + '"'
                   + (style ? ' style="' + style + '"' : '')
                   + (etat.debug ? ' title="Cliquer pour le détail du calcul"' : '')
                   + '>' + esc(fmt(v)) + '</td>';
            });
            h += '</tr>';
        });
        return h + '</tbody></table></div>'
            + '<div class="small text-muted mb-2">Chaque case rejoue le scénario entier sous les deux '
            + 'leviers croisés, en plus de ceux du panneau. La case cerclée est la plus proche de '
            + 'l\'équilibre sur sa ligne.'
            + (etat.debug ? ' <strong>Mode debug : cliquez une case pour la dérivation complète de son calcul.</strong>' : '')
            + '</div>'
            + '<div id="sim2-mat-detail" class="mb-3"></div>';
    }

    // Le detail d'UNE case, au clic: la meme derivation que le bloc debug,
    // mais pour le scenario de la case — le panneau courant PLUS les deux
    // axes. C'est la reponse a "d'ou sort ce nombre ?" sans avoir a
    // reproduire la case dans le panneau. Les formules viennent du moteur:
    // ce qui est montre est ce qui a ete calcule, pas une reconstitution.
    function detailCase(j, k) {
        var A = axes();
        var ax = A[etat.matX], ay = A[etat.matY];
        if (!ax || !ay) return;
        var x = ax.vals[k], y = ay.vals[j];
        var c = etat.scenarioRendu
            ? JSON.parse(JSON.stringify(etat.scenarioRendu))
            : snapshotEtat();
        ay.set(c, y); ax.set(c, x);
        var ex = M.expliquer(donnees(), c);
        var b = etat.base;
        var pad = function (t, n) { t = String(t); return t + ' '.repeat(Math.max(0, n - t.length)); };
        var padL = function (t, n) { t = String(t); return ' '.repeat(Math.max(0, n - t.length)) + t; };
        var h = 'CASE  ' + ay.lib + ' = ' + y + ' ' + ay.u + '   ×   ' + ax.lib + ' = ' + x + ' ' + ax.u + '\n\n';
        if (!ex.lignes.length) {
            h += '   aucun levier actif : la case vaut le résultat de référence\n\n';
        } else {
            ex.lignes.forEach(function (l) {
                h += '   ' + pad(l.libelle, 30) + pad(l.formule, 52) + padL(signe(l.valeur), 13) + '\n';
            });
            h += '   ' + pad('', 82) + padL('─────────────', 13) + '\n';
            h += '   ' + pad('effet total', 82) + padL(signe(ex.total), 13) + '\n\n';
        }
        h += '   ' + pad('résultat de référence', 30) + padL(fmt(b.pl), 14) + '\n';
        h += '   ' + pad('case affichée', 30) + padL(fmt(b.pl + ex.total), 14) + '\n';
        h += '   contrôle de bouclage : ' + ex.controle.ecart.toFixed(2) + ' F'
           + (ex.controle.ok ? '  ✓' : '  ✗ ÉCART — formules et explication ont divergé') + '\n';
        var zone = document.getElementById('sim2-mat-detail');
        if (zone) {
            zone.innerHTML = '<pre class="small border rounded p-2 mb-0" style="background:#f8fafc;overflow-x:auto">'
                + esc(h) + '</pre>';
            zone.scrollIntoView({ block: 'nearest' });
        }
    }


    // ============================================================ PROJECTION
    // Fin de mois, methode P1/P2 du document d'estimation. TOUTES les regles
    // vivent dans js/simulation-v2-projection.js, un module pur teste par
    // Jest: cet ecran ne fait que les brancher et les afficher.
    var PJ = (typeof window !== 'undefined' && window.Sim2Projection) || null;

    // Marge nette SANS scenario: les recommandations decrivent la realite du
    // moment, pas l'hypothese en cours de test dans le panneau.
    function margeBase(p) {
        return M.margeAvec(p, { leviers: {}, globaux: {} }, etat.contexte);
    }

    /**
     * Reglage ADMIN des produits suivis, a l'endroit ou l'on constate le
     * besoin: on voit ici qu'un produit manque au plan, on l'ajoute ici.
     *
     * Les candidats viennent du serveur, deja filtres (nom present AUSSI en
     * stock, cout connu) et classes par marge decroissante. Le tri par marge
     * est le seul qui reponde a la question posee: ou aller chercher de la
     * marge en plus.
     */
    function panneauProduitsSuivis() {
        var u = window.currentUser || {};
        if (String(u.role || '').toLowerCase() !== 'admin') return '';
        var cand = (etat.sim && etat.sim.produits_candidats) || [];
        var ajoutes = (etat.sim && etat.sim.produits_suivis_ajoutes) || [];
        if (!cand.length && !ajoutes.length) return '';

        var choisis = {};
        ajoutes.forEach(function (n) { choisis[String(n).trim().toLowerCase()] = true; });

        // Les produits ajoutes mais ABSENTS des candidats du mois (ils n'ont
        // rien vendu, ou leur cout a disparu) doivent rester cochables: sans
        // eux dans la liste, enregistrer les retirerait en silence.
        var connus = {};
        cand.forEach(function (c) { connus[String(c.nom).trim().toLowerCase()] = true; });
        var lignes = cand.slice();
        ajoutes.forEach(function (n) {
            if (!connus[String(n).trim().toLowerCase()]) {
                lignes.push({ nom: n, marge_unitaire: null, quantite: null, ca: null, absent: true });
            }
        });

        var h = '<details class="mb-3"><summary class="small fw-medium">'
            + '<i class="bi bi-gear"></i> Produits du plan d\'équilibre — '
            + ajoutes.length + ' ajouté(s) aux 5 d\'origine'
            + ' <span class="badge bg-secondary">admin</span></summary>'
            + '<div class="border rounded p-2 mt-1">'
            + '<div class="small text-muted mb-2">'
            + '<strong>Boeuf en détail, Boeuf en gros, Poulet en détail, Poulet en gros et Agneau '
            + 'sont toujours suivis</strong> et n\'apparaissent pas ici — ils ne se retirent pas. '
            + 'Cochez ci-dessous les produits à leur ajouter, puis enregistrez : '
            + 'une case cochée = produit suivi, décochée = retiré. '
            + 'Seuls les produits vendus dont le nom existe <strong>aussi en stock</strong> '
            + 'sont proposés — sans ligne de stock, un produit n\'a ni borne matin ni borne soir, '
            + 'donc aucun parage à lui opposer. Classés par marge décroissante.'
            + '</div>';

        // Ce qui EMPECHE les autres produits d'entrer. Un panneau vide se lit
        // comme une panne; la meme liste, motivee, se lit comme une liste de
        // choses a faire — et c'est le cas le plus frequent en production.
        var ecartes = (etat.sim && etat.sim.produits_ecartes) || [];
        var motifs = {
            sans_prix_achat: 'prix d\'achat absent du catalogue fournisseur',
            sans_stock: 'aucune ligne de stock à ce nom',
            sans_prix_vente: 'aucun prix de vente constaté',
            marge_nulle: 'marge nulle ou négative'
        };
        var parMotif = {};
        ecartes.forEach(function (e) {
            (parMotif[e.motif] = parMotif[e.motif] || []).push(e.nom);
        });
        var bloc = Object.keys(parMotif).map(function (m) {
            return '<li><strong>' + esc(motifs[m] || m) + '</strong> : '
                + parMotif[m].slice(0, 6).map(esc).join(', ')
                + (parMotif[m].length > 6 ? ' (+' + (parMotif[m].length - 6) + ')' : '') + '</li>';
        }).join('');

        if (!lignes.length) {
            return h + '<div class="small text-muted mb-1">'
                + 'Aucun produit éligible sur cette période.'
                + (bloc ? ' Ceux-ci se vendent mais ne peuvent pas entrer :' : '')
                + '</div>'
                + (bloc ? '<ul class="small text-muted mb-0">' + bloc + '</ul>' : '')
                + '</div></details>';
        }

        h += '<div class="table-responsive"><table class="table table-sm mb-2"><thead><tr>'
            + '<th>Suivi</th><th>Produit</th><th class="text-end">Marge brute</th>'
            + '<th class="text-end">Vendu</th><th class="text-end">CA</th>'
            + '</tr></thead><tbody>'
            + lignes.map(function (c) {
                var coche = choisis[String(c.nom).trim().toLowerCase()] ? ' checked' : '';
                return '<tr><td><input type="checkbox" class="sim2-suivi" value="'
                    + esc(c.nom) + '"' + coche + '></td>'
                    + '<td>' + esc(c.nom)
                    + (c.absent ? ' <span class="badge bg-light text-dark border">aucune vente ce mois-ci</span>' : '')
                    + '</td>'
                    + '<td class="text-end">' + (c.marge_unitaire === null ? '—' : esc(fmt(c.marge_unitaire)) + ' F/u') + '</td>'
                    + '<td class="text-end">' + (c.quantite === null ? '—' : esc(fmt(c.quantite)) + ' u') + '</td>'
                    + '<td class="text-end">' + (c.ca === null ? '—' : esc(fmt(c.ca)) + ' F') + '</td></tr>';
            }).join('')
            + '</tbody></table></div>'
            + '<button type="button" class="btn btn-sm btn-primary" id="sim2-suivi-save" style="color:#fff">'
            + '<i class="bi bi-save"></i> Enregistrer la sélection</button>'
            + ' <span id="sim2-suivi-msg" class="small ms-2"></span>'
            + (bloc
                ? '<div class="small text-muted mt-2">Ces produits se vendent aussi mais ne '
                  + 'peuvent pas entrer :<ul class="mb-0">' + bloc + '</ul></div>'
                : '')
            + '</div></details>';
        return h;
    }

    function enregistrerProduitsSuivis() {
        var noms = [];
        document.querySelectorAll('.sim2-suivi').forEach(function (el) {
            if (el.checked) noms.push(el.value);
        });
        var msg = document.getElementById('sim2-suivi-msg');
        if (msg) msg.textContent = 'Enregistrement…';
        fetch('/api/simulation-v2/reglages', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ produitsSuivis: noms })
        }).then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (j) {
                if (!j || !j.success) {
                    if (msg) msg.innerHTML = '<span class="text-danger">'
                        + esc((j && j.error) || 'Enregistrement refusé') + '</span>';
                    return;
                }
                if (msg) msg.innerHTML = '<span class="text-success">Enregistré. Recalcul…</span>';
                // Le serveur recompose la liste suivie: seul un rechargement
                // rend le tableau coherent avec le reglage.
                charger();
            })
            .catch(function (e) {
                if (msg) msg.innerHTML = '<span class="text-danger">' + esc(e.message) + '</span>';
            });
    }

    function projection() {
        if (!PJ || !etat.sim || !etat.sim.projection || !etat.base) return '';
        var pj = etat.sim.projection;
        var b = etat.base;
        var debut = b.periode.dateDebut || '';
        var fin = b.periode.dateFin || '';
        var h = '<h6 class="fin-subheading">Projection fin de mois</h6>';
        if (!/^\d{4}-\d{2}-01$/.test(debut) || fin.slice(0, 7) !== debut.slice(0, 7)) {
            return h + '<div class="alert alert-secondary py-2 small mb-3">Projection disponible '
                + 'sur une période du 1er du mois au jour d\'analyse.</div>';
        }

        var sansDim = etat.proj.exclureDimanche;
        var calibre = PJ.calibrerCoeff(pj.historique, sansDim);
        var coeff = etat.proj.coeff !== null ? etat.proj.coeff
            : (calibre !== null ? calibre : nb(pj.coeff_defaut));
        var origineCoeff = etat.proj.coeff !== null ? 'ajusté à la main'
            : (calibre !== null ? 'calibré sur vos 3 derniers mois' : 'référence du document');

        var ca = PJ.projeterCA({
            caParJour: pj.ca_par_jour, debutMois: debut, dateAnalyse: fin,
            histo: pj.historique, coeff: coeff,
            poidsReel: etat.proj.poidsReel, minJours: etat.proj.minJours,
            exclureDimanche: sansDim
        });
        if (ca.restants.P1 === 0 && ca.restants.P2 === 0) {
            return h + '<div class="alert alert-secondary py-2 small mb-3">Mois complet : rien à projeter.</div>';
        }

        var plBrut = etat.plBrut || {};
        var postes = {
            total_avances: plBrut.total_avances, commission_maas: plBrut.commission_maas,
            marge_cdc: plBrut.marge_cdc, depenses_periode: plBrut.depenses_periode,
            paiements_fournisseur: plBrut.paiements_fournisseur,
            stock_variation_nette: (plBrut.stock || {}).variation_nette
        };
        var chargesMensuel = (plBrut.charges || {}).total_mensuel;
        // Jours ECOULES du mois, pas jours observes avec vente: une depense
        // court aussi les jours creux. Jours d'OUVERTURE quand les dimanches
        // sont exclus, pour que le prorata des depenses et le plafond du plan
        // comptent la meme chose que les rythmes.
        var jours = {
            ecoules: PJ.joursOuvres(debut, fin, sansDim).length,
            mois: PJ.joursOuvres(debut, ca.finMois, sansDim).length
        };
        var argsScen = {
            postes: postes, caRealise: b.ventes, caProjete: ca.caProjete,
            chargesMensuel: chargesMensuel, stockOption: etat.proj.stockOption,
            depensesOption: etat.proj.depensesOption, jours: jours
        };
        var scen = (ca.caProjete === null) ? null : PJ.scenarios(argsScen);
        var conf = PJ.confiance({
            rythmes: ca.rythmes, restants: ca.restants,
            sourcesFiables: !(b.sources && b.sources.fiable === false),
            histoDisponible: calibre !== null
        });

        // ---- Controles: chaque parametre du document est ajustable.
        h += '<div class="row g-2 mb-2">'
            + '<div class="col-md-3"><label class="form-label small">Coefficient P1/P2</label>'
            + '<input type="number" class="form-control form-control-sm sim2-proj-ctl" data-k="coeff" '
            + 'value="' + (Math.round(coeff * 1000) / 1000) + '" step="0.01" min="0.5" max="3">'
            + '<div class="form-text">' + esc(origineCoeff)
            + (calibre !== null ? ' · calibré : ' + calibre.toFixed(3) : '')
            + ' · document : ' + nb(pj.coeff_defaut).toFixed(3) + '</div></div>'
            + '<div class="col-md-3"><label class="form-label small">Pondération réel / historique</label>'
            + '<select class="form-select form-select-sm sim2-proj-ctl" data-k="poidsReel">'
            + '<option value="0.7"' + (etat.proj.poidsReel === 0.7 ? ' selected' : '') + '>70 % réel + 30 % historique</option>'
            + '<option value="0.5"' + (etat.proj.poidsReel === 0.5 ? ' selected' : '') + '>50 / 50</option>'
            + '<option value="1"' + (etat.proj.poidsReel === 1 ? ' selected' : '') + '>100 % réel</option>'
            + '</select></div>'
            + '<div class="col-md-3"><label class="form-label small">Variation de stock projetée</label>'
            + '<select class="form-select form-select-sm sim2-proj-ctl" data-k="stockOption">'
            + '<option value="garder"' + (etat.proj.stockOption === 'garder' ? ' selected' : '') + '>Garder la variation actuelle</option>'
            + '<option value="zero"' + (etat.proj.stockOption === 'zero' ? ' selected' : '') + '>La poser à zéro</option>'
            + '</select></div>'
            + '<div class="col-md-3"><label class="form-label small">Dépenses d\'ici la fin du mois</label>'
            + '<select class="form-select form-select-sm sim2-proj-ctl" data-k="depensesOption">'
            + '<option value="realise"' + (etat.proj.depensesOption === 'realise' ? ' selected' : '') + '>Réalisées à date (aucun ajout)</option>'
            + '<option value="jours"' + (etat.proj.depensesOption === 'jours' ? ' selected' : '') + '>Extrapolées au prorata des jours</option>'
            + '<option value="ca"' + (etat.proj.depensesOption === 'ca' ? ' selected' : '') + '>Proportionnelles au chiffre d\'affaires</option>'
            + '</select>'
            + '<div class="form-text">' + jours.ecoules + ' j écoulés sur ' + jours.mois
            + (etat.proj.depensesOption === 'jours'
                ? ' · × ' + (jours.mois / Math.max(1, jours.ecoules)).toFixed(2)
                : (etat.proj.depensesOption === 'realise' ? ' · poste figé, donc sous-estimé' : ' · suit l\'activité'))
            + '</div></div>'
            + '<div class="col-md-3"><label class="form-label small">Jours d\'ouverture</label>'
            + '<div class="form-check"><input class="form-check-input sim2-proj-ctl" type="checkbox" '
            + 'data-k="exclureDimanche" id="sim2-sans-dim"' + (sansDim ? ' checked' : '') + '>'
            + '<label class="form-check-label small" for="sim2-sans-dim">Exclure les dimanches</label></div>'
            + '<div class="form-text">' + jours.ecoules + ' j ouvrés écoulés sur ' + jours.mois
            + (sansDim ? ' · dimanches non comptés' : ' · tous les jours comptés') + '</div></div>'
            + '<div class="col-md-3"><label class="form-label small">Confiance</label><div>'
            + '<span class="badge bg-' + (conf.niveau === 'bon' ? 'success' : (conf.niveau === 'moyen' ? 'warning text-dark' : 'danger'))
            + '">' + conf.niveau + '</span></div></div>'
            + '</div>';

        // ---- Le CA projete et ses rythmes, toujours dits.
        h += '<div class="alert alert-light border py-2 small mb-2">'
            + 'CA réalisé au ' + esc(fin) + ' : <strong>' + esc(fmt(ca.caRealise)) + '</strong> F. '
            + 'Restent ' + ca.restants.P1 + ' jours P1 à ' + esc(fmt(ca.rythmes.P1)) + ' F/j ('
            + esc((ca.rythmes.sources || {}).P1 || '—') + ') et '
            + ca.restants.P2 + ' jours P2 à ' + esc(fmt(ca.rythmes.P2)) + ' F/j ('
            + esc((ca.rythmes.sources || {}).P2 || '—') + '). '
            + 'CA estimé fin de mois : <strong>' + esc(fmt(ca.caProjete)) + '</strong> F.</div>';

        if (!scen || !scen.central) {
            // Regle du document: sans realise exploitable, on ne projette que
            // le CA et on le DIT.
            return h + '<div class="alert alert-warning py-2 small mb-3">'
                + 'P&L incomplet — données de coût insuffisantes : seule la projection de CA est rendue.</div>';
        }

        // ---- Les trois scenarios du document.
        var carte = function (lab, d, note) {
            return '<div class="col-md-4"><div class="card h-100"><div class="card-body text-center py-3">'
                + '<h6 class="card-subtitle mb-2 text-muted">' + lab + '</h6>'
                + '<h3 class="mb-0 ' + cls(d.pl) + '">' + esc(fmt(d.pl)) + '</h3>'
                + '<div class="small text-muted mt-1">CA ' + esc(fmt(d.ca)) + ' · marge nette '
                + (d.margeNette === null ? '—' : (d.margeNette * 100).toFixed(1) + ' %') + note + '</div>'
                + '</div></div></div>';
        };
        h += '<div class="row g-2 mb-2">'
            + carte('Prudent (CA −10 %)', scen.prudent, '')
            + carte('Central', scen.central, '')
            + carte('Haut (CA +10 %)', scen.haut, '')
            + '</div>';

        // Le scenario CENTRAL sert a la fois au plan d'equilibre ci-dessous et
        // a la decomposition plus bas: declare ici, avant son premier usage.
        var d0 = scen.central;

        // ---- CE QU'IL FAUT FAIRE D'ICI LA FIN DU MOIS pour revenir a zero.
        //
        // Les leviers portent sur le volume RESTANT, pas sur le volume deja
        // vendu: le mois ecoule ne se rejoue pas.
        // Le plan puise dans TOUS les produits vendus, pas dans la seule liste
        // suivie: celle-ci est fermee pour que le tableau de sensibilite se
        // compare d'un mois a l'autre, ce qui n'a aucune raison de priver
        // l'equilibre d'une cuisse de poulet dont le cout est connu. Repli sur
        // la liste suivie si le serveur ne fournit pas encore l'autre.
        var universEq = (etat.sim.produits_vendus && etat.sim.produits_vendus.length)
            ? etat.sim.produits_vendus
            : etat.produits;
        var eq = PJ.planEquilibre({
            plCentral: d0.pl, produits: universEq, margeDe: margeBase,
            caRealise: b.ventes, caProjete: ca.caProjete,
            joursRestants: ca.restants.P1 + ca.restants.P2,
            jours: jours, facteurMax: etat.proj.facteurMax,
            principal: 'Boeuf en détail', nbProduits: 5
        });
        if (eq) {
            var s0 = eq.seul;
            h += '<h6 class="small fw-medium mb-1">Revenir à l\'équilibre d\'ici le '
                + esc(ca.finMois) + ' — ' + eq.joursRestants + ' jours restants</h6>'
                + '<div class="alert alert-light border py-2 small mb-2">'
                + 'Manque à combler : <strong>' + esc(fmt(eq.manque)) + ' F</strong>. '
                + 'Sur ces ' + eq.joursRestants + ' jours, on attend encore <strong>'
                + esc(fmt(s0.volumeRestant)) + ' u</strong> de ' + esc(s0.nom)
                + ' (marge nette actuelle ' + esc(fmt(s0.marge)) + ' F/u).</div>';

            h += '<div class="small text-muted mb-1">'
                + '<strong>Plan A</strong> — tout jouer sur le ' + esc(s0.nom)
                + ', de deux façons possibles :</div>'
                + '<div class="row g-2 mb-2">'
                + '<div class="col-md-6"><div class="card h-100"><div class="card-body py-2">'
                + '<div class="small text-muted mb-1">À volume inchangé — monter la marge</div>'
                + '<div class="h5 mb-1">' + esc(fmt(s0.margeRequise)) + ' F/u</div>'
                // La DERIVATION, pas seulement le resultat: sans elle,
                // « 1 714 F/u » tombe du ciel.
                + '<div class="small text-muted">'
                + esc(fmt(s0.marge)) + ' F/u aujourd\'hui <strong>+ '
                + esc(fmt(s0.hausseMarge)) + ' F</strong> (' + esc(fmt(eq.manque))
                + ' F ÷ ' + esc(fmt(s0.volumeRestant)) + ' u attendues)'
                + (s0.prixRequis !== null
                    ? '<br>soit un prix de vente porté de <strong>' + esc(fmt(s0.prixMoyen))
                      + '</strong> à <strong>' + esc(fmt(s0.prixRequis)) + ' F/u</strong>'
                      + (s0.prixMoyen > 0
                          ? ' (+' + (s0.hausseMarge / s0.prixMoyen * 100).toFixed(0) + ' %)'
                          : '')
                    : '')
                + '</div>'
                + '</div></div></div>'
                + '<div class="col-md-6"><div class="card h-100"><div class="card-body py-2">'
                + '<div class="small text-muted mb-1">À marge inchangée — vendre plus</div>'
                + '<div class="h5 mb-1">+' + esc(fmt(s0.volumeAdditionnel)) + ' u</div>'
                + '<div class="small text-muted">soit <strong>' + esc(fmt(s0.volumeTotal))
                + ' u au total</strong> (+' + s0.hausseVolumePct.toFixed(0) + ' %)'
                + (s0.parJour !== null ? ', ' + esc(fmtDec(s0.parJour)) + ' u/jour de plus' : '')
                + ' → ' + esc(fmt(s0.montantVolume)) + ' F</div>'
                + '</div></div></div>'
                + '</div>';

            if (eq.plan.length > 1) {
                var nbPlafonnes = eq.plan.filter(function (x) { return x.plafonne; }).length;
                h += '<details class="mb-2" open><summary class="small fw-medium">'
                    + 'Plan B — répartir l\'effort sur ' + eq.plan.length + ' produits'
                    + '</summary>'

                    // Ce que le tableau raconte, en une phrase, AVANT le
                    // tableau. La version precedente annoncait "+166 u de
                    // chacun" puis affichait +68 et +4 sur les lignes
                    // plafonnees: le titre contredisait le contenu.
                    + '<div class="alert alert-light border py-2 small mb-2">'
                    + 'Plutôt que de tout demander au ' + esc(s0.nom) + ', on répartit les '
                    + '<strong>' + esc(fmt(eq.manque)) + ' F</strong> à combler sur plusieurs produits. '
                    + 'Chacun vend déjà un certain volume d\'ici la fin du mois (colonne '
                    + '<em>déjà attendu</em>) ; la colonne <em>à vendre en plus</em> est l\'effort '
                    + 'demandé, et <em>total à vendre</em> est l\'objectif final. '
                    + 'L\'effort est réparti <strong>proportionnellement à la marge</strong> : à nombre '
                    + 'd\'unités égal, le produit qui rapporte le plus porte la plus grosse part.'
                    + (nbPlafonnes
                        ? ' ' + nbPlafonnes + ' produit(s) atteignent leur <strong>plafond</strong> '
                          + '— on ne peut pas leur en demander plus, donc le reste retombe sur les autres.'
                        : '')
                    + '</div>'

                    + '<div class="d-flex align-items-center gap-2 mb-2 small flex-wrap">'
                    + '<label class="text-muted">Plafond par produit : au plus</label>'
                    + '<input type="number" class="form-control form-control-sm sim2-proj-ctl" '
                    + 'data-k="facteurMax" style="width:5rem" min="1" max="20" step="0.5" value="'
                    + esc(String(eq.facteurMax)) + '">'
                    + '<span class="text-muted">fois son rythme mensuel — soit '
                    + '<em>vendu × (' + jours.mois + ' j ÷ ' + jours.ecoules + ' j) × '
                    + esc(String(eq.facteurMax)) + '</em></span>'
                    + '</div>'
                    + '<div class="table-responsive"><table class="table table-sm mb-1">'
                    + '<thead><tr><th>Produit</th>'
                    + '<th class="text-end">Marge nette</th>'
                    + '<th class="text-end">Déjà attendu</th>'
                    + '<th class="text-end">À vendre en plus</th>'
                    + '<th class="text-end">Total à vendre</th>'
                    + '<th class="text-end">Total par jour</th>'
                    + '<th class="text-end">Plafond du total</th>'
                    + '<th class="text-end">Apport</th></tr></thead><tbody>'
                    + eq.plan.map(function (x) {
                        var total = x.volumeRestant + x.volumeAdditionnel;
                        var totalJour = eq.joursRestants > 0 ? total / eq.joursRestants : null;
                        return '<tr><td>' + esc(x.nom)
                            + (x.plafonne ? ' <span class="badge bg-secondary">plafond atteint</span>' : '')
                            + '</td>'
                            + '<td class="text-end">' + esc(fmt(x.marge)) + ' F/u</td>'
                            + '<td class="text-end text-muted">' + esc(fmt(x.volumeRestant)) + ' u</td>'
                            + '<td class="text-end"><strong>+' + esc(fmt(x.volumeAdditionnel)) + ' u</strong>'
                            + (x.haussePct !== null ? ' <span class="text-muted">(+' + x.haussePct.toFixed(0) + ' %)</span>' : '')
                            + '</td>'
                            + '<td class="text-end fw-bold">' + esc(fmt(total)) + ' u</td>'
                            + '<td class="text-end">' + (totalJour !== null ? esc(fmtDec(totalJour)) + ' u/j' : '—') + '</td>'
                            + '<td class="text-end text-muted">' + esc(fmt(x.plafondReste)) + ' u</td>'
                            + '<td class="text-end">' + esc(fmt(x.part)) + ' F</td></tr>';
                    }).join('')
                    + '<tr class="table-light fw-bold"><td colspan="7">Total de l\'effort</td>'
                    + '<td class="text-end">' + esc(fmt(eq.manque)) + ' F</td></tr>'
                    + '</tbody></table></div>'
                    + '</details>';
            }
            if (!eq.atteignable) {
                h += '<div class="alert alert-danger py-2 small mb-2"><i class="bi bi-exclamation-octagon"></i> '
                    + 'Même au plafond, ces produits ne dégagent que '
                    + esc(fmt(eq.capaciteTotale)) + ' F : il manque encore '
                    + esc(fmt(eq.resteACouvrir)) + ' F. '
                    + 'L\'équilibre ne se joue pas sur le seul volume ce mois-ci — '
                    + 'il faut agir sur les prix, les charges ou les dépenses.</div>';
            }
        }

        h += panneauProduitsSuivis();

        // ---- La decomposition du scenario central, chaque regle nommee.
        var lig = function (lib, v, regle) {
            return '<tr><td>' + lib + ' <span class="text-muted small">' + regle + '</span></td>'
                + '<td class="text-end">' + esc(fmt(v)) + '</td></tr>';
        };
        h += '<details class="mb-2"><summary class="small fw-medium">Décomposition du scénario central</summary>'
            + '<div class="table-responsive"><table class="table table-sm mb-1">'
            + '<tbody>'
            + lig('+ Chiffre d\'affaires', d0.ca, 'projection P1/P2')
            + lig('− Avances', d0.avances, 'suivent le CA')
            + lig('− Commission', d0.commission, 'suit le CA')
            + lig('+ Marge CDC', d0.margeCdc, 'suit le CA')
            + lig('− Charges fixes', d0.charges, 'mois complet')
            // Le REGLAGE est pose ici, sur la ligne qu'il gouverne. Il vit
            // aussi en haut de la section, mais personne ne fait le lien entre
            // « non extrapolées » ecrit ici et une liste deroulante situee
            // trois blocs plus haut: la question « ou est le setting ? » est
            // venue de la.
            + '<tr><td>− Dépenses <span class="text-muted small">'
            + '<select class="form-select form-select-sm d-inline-block sim2-proj-ctl" '
            + 'data-k="depensesOption" style="width:auto">'
            + '<option value="realise"' + (etat.proj.depensesOption === 'realise' ? ' selected' : '') + '>réalisées à date, non extrapolées</option>'
            + '<option value="jours"' + (etat.proj.depensesOption === 'jours' ? ' selected' : '') + '>extrapolées au prorata des jours</option>'
            + '<option value="ca"' + (etat.proj.depensesOption === 'ca' ? ' selected' : '') + '>proportionnelles au chiffre d\'affaires</option>'
            + '</select>'
            + (etat.proj.depensesOption !== 'realise'
                ? ' × ' + nb(d0.depensesFacteur).toFixed(2) : '')
            + '</span></td>'
            + '<td class="text-end">' + esc(fmt(d0.depenses)) + '</td></tr>'
            + lig('− Paiements fournisseur', d0.paiements, 'réalisés à date — jamais extrapolés : l\'argent sorti revient en stock')
            + lig('+ Variation de stock', d0.stock, etat.proj.stockOption === 'zero' ? 'posée à zéro' : 'photo actuelle conservée')
            + '<tr class="table-light fw-bold"><td>PL projeté fin de mois</td>'
            + '<td class="text-end ' + cls(d0.pl) + '">' + esc(fmt(d0.pl)) + '</td></tr>'
            + '</tbody></table></div></details>';

        // ---- SENSIBILITE DES DEUX HYPOTHESES DISCRETIONNAIRES.
        //
        // Le stock et les depenses ne se projettent pas, ils se POSTULENT: la
        // valeur de fin de mois n'est pas observable aujourd'hui. Plutot que
        // de laisser croire a une precision qui n'existe pas, on montre de
        // combien le PL bouge entre les choix — c'est la vraie barre d'erreur,
        // et elle est souvent plus large que l'ecart prudent/haut.
        var varStock = nb(postes.stock_variation_nette);
        var ecartDepenses = nb(postes.depenses_periode)
            * (jours.ecoules > 0 ? jours.mois / jours.ecoules : 1) - nb(postes.depenses_periode);
        if (varStock || ecartDepenses) {
            h += '<div class="alert alert-secondary py-2 small mb-2"><i class="bi bi-rulers"></i> '
                + '<strong>Ce que ces deux choix valent.</strong> ';
            if (varStock) {
                h += 'Variation de stock : ' + esc(fmt(Math.abs(varStock)))
                    + ' F d\'écart entre « garder » et « zéro ». ';
            }
            if (ecartDepenses) {
                h += 'Dépenses : ' + esc(fmt(Math.abs(ecartDepenses)))
                    + ' F d\'écart entre « réalisées » et « extrapolées ». ';
            }
            h += 'À comparer aux ' + esc(fmt(Math.abs(scen.haut.pl - scen.prudent.pl)))
                + ' F qui séparent le scénario prudent du haut.</div>';
        }

        if (conf.notes.length) {
            h += '<div class="small text-muted mb-2">' + conf.notes.map(esc).join(' · ') + '</div>';
        }

        // ---- Les recommandations: des gestes chiffres.
        var clientsHisto = (etat.sim.clients_historique || {}).clients || [];
        var recos = PJ.recommandations({
            plCentral: d0.pl, produits: etat.produits, margeDe: margeBase,
            topClients: etat.sim.top_clients || [],
            clientsHistorique: clientsHisto,
            dateAnalyse: fin
        });
        if (recos.length) {
            var ico = { volume: 'graph-up-arrow', prix: 'tag', client: 'person-heart', donnee: 'database-exclamation' };
            h += '<div class="list-group mb-3">' + recos.slice(0, 6).map(function (r) {
                return '<div class="list-group-item py-2"><i class="bi bi-' + (ico[r.type] || 'lightbulb')
                    + ' me-2 text-muted"></i><strong>' + esc(r.titre) + '</strong>'
                    + '<span class="small text-muted"> — ' + esc(r.detail) + '</span></div>';
            }).join('') + '</div>';
        }

        // ---- Les gros clients du MOIS DERNIER restes muets ce mois-ci.
        //
        // Classement par ce qui est en jeu (leur CA du mois dernier), avec la
        // frequence en garde-fou: un client qui achete tous les deux mois
        // n'est pas perdu, il n'est pas encore revenu. On le montre quand
        // meme, marque « pas encore en retard » — c'est a l'humain de juger.
        var perdus = PJ.clientsPerdus({ clients: clientsHisto, dateAnalyse: fin, limite: 5 });
        if (perdus.length) {
            h += '<h6 class="small fw-medium mb-1">Gros clients du mois dernier, rien ce mois-ci</h6>'
                + '<div class="list-group mb-3">' + perdus.map(function (c) {
                    var rythme = c.habitudeEtablie
                        ? 'vient environ tous les ' + fmt(c.intervalle) + ' j (' + c.nbVisites + ' passages)'
                        : 'habitude non établie (' + c.nbVisites + ' passage' + (c.nbVisites > 1 ? 's' : '') + ')';
                    return '<div class="list-group-item py-2">'
                        + '<i class="bi bi-person-dash me-2 text-muted"></i>'
                        + '<strong>' + esc(c.nom) + '</strong>'
                        + '<span class="small text-muted"> — ' + esc(fmt(c.caMoisDernier))
                        + ' F le mois dernier, rien ce mois-ci · ' + esc(rythme)
                        + (c.silence !== null ? ' · silence de ' + c.silence + ' j' : '')
                        + '</span>'
                        // Trois etats, pas deux. Afficher « pas encore en
                        // retard » a un client muet depuis 36 jours dont on
                        // ignore l'habitude serait faux: on ne sait pas, et
                        // c'est cela qu'il faut dire.
                        + (!c.habitudeEtablie
                            ? ' <span class="badge bg-light text-dark border">habitude inconnue</span>'
                            : (c.premature
                                ? ' <span class="badge bg-secondary">pas encore en retard</span>'
                                : ' <span class="badge bg-warning text-dark">à relancer</span>'))
                        + '</div>';
                }).join('') + '</div>';
        }

        // ---- Les commandes qui rapportent le plus, classees par MARGE (pas
        // par CA), et le geste pour les multiplier: relancer un panier unique,
        // securiser une recurrence deja installee. Les lignes des commandes ne
        // portent qu'un NOM: la marge se lit sur la ligne produit complete du
        // tableau, quand elle existe — un produit hors simulation (Dorade,
        // Beurre...) reste au cout inconnu et pese sur la couverture.
        var parNom = {};
        (etat.produits || []).forEach(function (p) {
            parNom[String(p.nom || '').trim().toLowerCase()] = p;
        });
        var cdes = PJ.commandesRentables({
            commandes: etat.sim.commandes || [],
            margeDe: function (l) {
                var p = parNom[String(l.nom || '').trim().toLowerCase()];
                return p ? margeBase(p) : null;
            },
            limite: 3
        });
        if (cdes.length) {
            h += '<h6 class="small fw-medium mb-1">Commandes qui rapportent le plus — à multiplier</h6>'
                + '<div class="list-group mb-3">' + cdes.map(function (c) {
                    var geste = c.commandesClient > 1
                        ? (c.client ? esc(c.client) + ' en a passé ' + c.commandesClient
                            + ' sur la période : sécuriser la récurrence (rappel, jour fixe de livraison)' : '')
                        : (c.client ? 'relancer ' + esc(c.client)
                            + ' et proposer la même sélection à vos autres gros clients'
                            : 'proposer cette sélection en avant à vos gros clients');
                    return '<div class="list-group-item py-2"><i class="bi bi-bag-check me-2 text-muted"></i>'
                        + '<strong>' + esc(c.client || ('Commande #' + c.id))
                        + (c.date ? ' · ' + esc(c.date) : '') + '</strong>'
                        + '<span class="small text-muted"> — PL estimé +' + esc(fmt(c.marge))
                        + ' F sur ' + esc(fmt(c.ca)) + ' F de CA ('
                        + esc(c.produits.slice(0, 3).join(', ')) + (c.produits.length > 3 ? ', …' : '') + ')'
                        + (c.couverture < 0.999 ? ' · coûts connus sur ' + Math.round(c.couverture * 100) + ' % du panier' : '')
                        + ' · ' + geste + '</span></div>';
                }).join('') + '</div>';
        }

        // ---- Derivation en mode debug: le meme niveau d'exigence que le
        // reste, chiffres et controle de coherence compris.
        if (etat.debug) {
            var sommeJours = 0;
            Object.keys(pj.ca_par_jour || {}).forEach(function (j) {
                if (j >= debut && j <= fin) sommeJours += nb(pj.ca_par_jour[j]);
            });
            var pad2 = function (t, n) { t = String(t); return t + ' '.repeat(Math.max(0, n - t.length)); };
            var dbg = 'PROJECTION — DERIVATION\n';
            dbg += '   coefficient P1/P2         ' + coeff.toFixed(3) + '  (' + origineCoeff + ')\n';
            dbg += '   rythme P1 retenu          ' + fmt(ca.rythmes.P1) + ' F/j  (' + ((ca.rythmes.sources || {}).P1 || '—') + ')\n';
            dbg += '   rythme P2 retenu          ' + fmt(ca.rythmes.P2) + ' F/j  (' + ((ca.rythmes.sources || {}).P2 || '—') + ')\n';
            dbg += '   CA estimé = ' + fmt(ca.caRealise) + ' + ' + ca.restants.P1 + ' j × ' + fmt(ca.rythmes.P1)
                + ' + ' + ca.restants.P2 + ' j × ' + fmt(ca.rythmes.P2) + ' = ' + fmt(ca.caProjete) + '\n';
            dbg += '   contrôle : somme du CA journalier − total ventes du PL = '
                + fmt(sommeJours - b.ventes) + ' F'
                + (Math.abs(sommeJours - b.ventes) < 1 ? '  ✓' : '  (ventes à date illisible exclues)') + '\n';
            h += '<pre class="small border rounded p-2 mb-3" style="background:#f8fafc;overflow-x:auto">' + esc(dbg) + '</pre>';
        }
        return h;
    }

    // ---- Mode debug. Il ne recalcule RIEN: il imprime la derivation du
    // chiffre deja affiche. Un mode debug qui referait le calcul par un autre
    // chemin controlerait son propre chemin, pas celui de l'ecran.
    function debug(s, g, total) {
        var b = etat.base, c = etat.contexte;
        var somme = 0;
        var pad = function (t, n) { t = String(t); return t + ' '.repeat(Math.max(0, n - t.length)); };
        var padL = function (t, n) { t = String(t); return ' '.repeat(Math.max(0, n - t.length)) + t; };
        var h = '<h6 class="fin-subheading">Détail du calcul</h6><pre class="small border rounded p-2 mb-3" '
              + 'style="background:#f8fafc;overflow-x:auto">';

        h += '1. RÉSULTAT DE RÉFÉRENCE, POSTE PAR POSTE\n';
        b.postes.forEach(function (p) {
            somme += p.s * p.v;
            h += '   ' + (p.s > 0 ? '+' : '−') + ' ' + pad(p.lib, 30) + padL(fmt(p.v), 14) + '\n';
        });
        h += '   ' + pad('', 32) + padL('──────────────', 14) + '\n';
        h += '   = ' + pad('somme', 30) + padL(fmt(somme), 14) + '\n';
        var ecart = somme - b.pl;
        h += '   contrôle : somme − PL rendu = ' + fmt(ecart)
           + (Math.abs(ecart) < 1 ? '  ✓' : '  ✗ ÉCART') + '\n\n';

        h += '2. VOLUMES ET PÉRIMÈTRE\n';
        var caSuivis = 0;
        etat.produits.forEach(function (p) { caSuivis += nb(p.ca); });
        h += '   ' + pad('chiffre d\'affaires total', 30) + padL(fmt(b.ventes), 14) + '\n';
        h += '   ' + pad('dont produits suivis', 30) + padL(fmt(caSuivis), 14)
           + '   ' + (b.ventes > 0 ? ((caSuivis / b.ventes) * 100).toFixed(1) : '0') + ' %\n';
        h += '   ' + pad('hors périmètre', 30) + padL(fmt(b.ventes - caSuivis), 14) + '\n\n';

        h += '3. PRIX D\'ACHAT RETENUS\n';
        etat.produits.forEach(function (p) {
            h += '   ' + pad(p.nom, 24) + padL(p.prix_achat === null || p.prix_achat === undefined ? 'aucun' : fmt(p.prix_achat), 10)
               + '   ' + (p.prix_achat_origine || '—') + '\n';
        });
        h += '\n4. STOCK PAR ESPÈCE\n';
        h += '   ' + pad('bovin', 24) + padL(fmt(c.varBovin), 12) + '\n';
        h += '   ' + pad('ovin', 24) + padL(fmt(c.varOvin), 12) + '\n';
        h += '   ' + pad('autre boucherie', 24) + padL(fmt(c.varAutre), 12) + '\n';
        h += '   ' + pad('coefficient de parage', 24) + padL(c.coeff, 12) + '\n\n';

        h += '5. EFFET DE CHAQUE LEVIER\n';
        var ex = M.expliquer(donnees(), s);
        if (!ex.lignes.length) {
            h += nbActifs(s)
                ? '   leviers actifs sans effet chiffrable (marge ou prix inconnus)\n'
                : '   scénario vide\n';
        }
        else {
            ex.lignes.forEach(function (l) {
                h += '   ' + pad(l.libelle, 30) + pad(l.formule, 52) + padL(signe(l.valeur), 13) + '\n';
            });
            h += '   ' + pad('', 82) + padL('─────────────', 13) + '\n';
            h += '   ' + pad('total', 82) + padL(signe(ex.total), 13) + '\n';
            h += '   contrôle : somme des lignes − effet appliqué = ' + ex.controle.ecart.toFixed(2)
               + (ex.controle.ok ? '  ✓' : '  ✗') + '\n';
        }

        h += '\n6. RÉSULTAT SIMULÉ\n';
        h += '   ' + pad('référence', 26) + padL(fmt(b.pl), 14) + '\n';
        h += '   ' + pad('effet du scénario', 26) + padL(signe(total), 14) + '\n';
        h += '   ' + pad('', 26) + padL('──────────────', 14) + '\n';
        h += '   ' + pad('simulé', 26) + padL(fmt(b.pl + total), 14) + '\n';
        return h + '</pre>';
    }

    function cablerLeviers() {
        // 'change' et non 'input' sur TOUS les controles qui declenchent un
        // rendu: rendre() reconstruit $('corps').innerHTML, donc il DETRUIT le
        // champ en cours de saisie. En mode automatique - le mode par defaut -
        // taper « 12 » dans un levier de prix perdait le focus des le « 1 », et
        // le « 2 » partait dans le vide: le levier valait 1 au lieu de 12.
        document.querySelectorAll('.sim2-lev').forEach(function (el) {
            el.addEventListener('change', function () {
                var p = etat.produits[+el.dataset.p];
                if (!p) return;
                var l = etat.leviers[p.nom] || { prix: 0, unite: 'F', vol: 0 };
                l[el.dataset.k] = el.dataset.k === 'unite' ? el.value : nb(el.value);
                etat.leviers[p.nom] = l;
                onLevier();
            });
        });
        document.querySelectorAll('.sim2-glob').forEach(function (el) {
            el.addEventListener('change', function () {
                var v = nb(el.value);
                // Un parage a 100 % ou plus n'a pas de sens (rien n'est
                // vendable) et faisait s'effondrer le cout au lieu de
                // l'exploser: borne a 99, coherente avec le garde du moteur.
                if (el.dataset.g === 'parBov' || el.dataset.g === 'parOvi') {
                    v = Math.min(99, Math.max(0, v));
                }
                etat.globaux[el.dataset.g] = v;
                onLevier();
            });
        });
        var sauve = document.getElementById('sim2-suivi-save');
        if (sauve) sauve.addEventListener('click', enregistrerProduitsSuivis);
        // 'change' et non 'input': ces controles declenchent un rendu complet,
        // qui remplace le champ en cours de saisie. Sur un nombre tape chiffre
        // par chiffre - 1, puis 12 - le focus etait perdu des le premier. Un
        // select emet 'change' des la selection, rien n'y est retarde.
        document.querySelectorAll('.sim2-proj-ctl').forEach(function (el) {
            el.addEventListener('change', function () {
                var k = el.dataset.k;
                if (k === 'stockOption') etat.proj.stockOption = el.value;
                else if (k === 'depensesOption') etat.proj.depensesOption = el.value;
                else if (k === 'facteurMax') etat.proj.facteurMax = Math.max(1, nb(el.value) || 1);
                else if (k === 'exclureDimanche') etat.proj.exclureDimanche = el.checked;
                else if (k === 'poidsReel') etat.proj.poidsReel = nb(el.value);
                else if (k === 'coeff') etat.proj.coeff = el.value === '' ? null : nb(el.value);
                rendre();
            });
        });
        // Le detail au clic n'existe qu'en mode debug: c'est un outil de
        // verification, pas un element de l'ecran courant.
        document.querySelectorAll('.sim2-case').forEach(function (el) {
            el.addEventListener('click', function () {
                detailCase(+el.dataset.mi, +el.dataset.mj);
            });
        });
        var mx = document.getElementById('sim2-matx'), my = document.getElementById('sim2-maty');
        if (mx) mx.addEventListener('change', function () { etat.matX = mx.value; rendre(); });
        if (my) my.addEventListener('change', function () { etat.matY = my.value; rendre(); });
    }

    // ============================================================ BOOTSTRAP
    // window.currentUser est pose par checkAuth() (script.js), asynchrone et
    // hors du controle de ce fichier - son propre commentaire dit "environ
    // deux secondes en local, davantage sur Render". Un setTimeout fixe a
    // 1200 ms lisait donc le role AVANT qu'il soit connu sur Render: le role
    // retombait a '', la bascule ne s'injectait jamais, et comme `demande`
    // passait a true des la premiere tentative, meme un clic ulterieur sur
    // Finance ne retentait rien - l'echec etait definitif pour toute la
    // page. On attend le role au lieu de deviner combien de temps il met.
    var demande = false;
    function amorcer() {
        if (demande) return;
        // Sans moteur (script non charge), ne rien injecter: la v1 reste
        // seule, intacte. Ce cas ne depend d'aucune attente.
        if (!M) { demande = true; return; }
        attendreRole(function (role) {
            demande = true;
            // Le drapeau n'a JAMAIS valu droit d'acces: on ne demande meme
            // pas les reglages a un role qui ne peut pas lire le PL. Les
            // routes refont le controle de toute facon.
            if (['admin', 'superviseur'].indexOf(role) < 0) return;
            jsonOu('/api/simulation-v2/reglages', null).then(function (d) {
                if (d && d.actif) injecter();
            });
        });
    }

    /**
     * Attend que checkAuth() ait pose window.currentUser avant de lire le
     * role. Sonde toutes les 250 ms jusqu'a 20 s - un cold start Render peut
     * largement depasser l'ancien delai fixe de 1200 ms; au-dela, rend le
     * role tel quel (vide si l'utilisateur n'a toujours pas ete identifie).
     */
    function attendreRole(suite) {
        var tentatives = 0;
        (function essayer() {
            var u = window.currentUser;
            if (u || tentatives >= 80) {
                suite(String((u && u.role) || '').toLowerCase());
                return;
            }
            tentatives++;
            setTimeout(essayer, 250);
        }());
    }

    document.addEventListener('DOMContentLoaded', function () {
        var lien = document.querySelector('[data-section="finance"], #finance-item, [data-page="finance"]');
        if (lien) lien.addEventListener('click', amorcer);
        // Filet: si l'onglet Finance est deja ouvert (retour arriere, lien
        // direct), le sous-menu existe deja et personne ne cliquera dessus.
        // finance-subnav est un element STATIQUE du markup: cette condition
        // est vraie a CHAQUE chargement de page, donc ce n'est pas un cas
        // rare mais le chemin normal - attendreRole() est ce qui rend cet
        // appel systematique sans risque de course.
        if (document.getElementById('finance-subnav')) amorcer();
    });
})();
