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
        // Lire le resultat SANS la variation de stock.
        //
        // ATTENTION a ce que ce mode veut dire, et a ce qu'il ne veut PAS dire.
        // La variation de stock n'est pas un gain fictif: elle est dans le PL
        // pour ne pas passer en charge une marchandise achetee mais pas encore
        // vendue. Ce stock partira, et sa marge avec. Le PL AVEC stock reste
        // donc la bonne mesure du mois.
        //
        // Ce mode mesure une EXPOSITION: sur aout, 148 742 F de variation pour
        // un PL de -51 196, soit 175 % du resultat suspendus a un comptage et a
        // une valorisation. Une erreur de 10 % sur l'inventaire deplace le PL
        // de 15 000 F. Le voir sans le stock dit de combien on depend de cette
        // mesure - pas ce que vaut l'exploitation.
        horsStock: false,
        // LA VUE AFFICHEE: 'projection' ou 'scenario'. Les deux repondent a
        // des questions differentes - « ou finit le mois » contre « que se
        // passe-t-il si je bouge ce levier » - et les empiler obligeait a
        // faire defiler tout le scenario pour atteindre la projection.
        //
        // La PROJECTION par defaut: c'est la reponse qu'on vient chercher en
        // ouvrant l'ecran. Le scenario sert ensuite, quand on a vu ou l'on va
        // et qu'on cherche quoi faire.
        //
        // Memorisee comme les autres etats d'affichage: un rendu declenche
        // par une frappe de levier ne doit pas ramener l'autre vue.
        vue: 'projection',
        // Les bandeaux d'information sont REPLIES au chargement. Ils se
        // lisent une fois; les laisser ouverts rendait l'ecran identique a
        // celui d'avant la pastille. Explicite plutot que laisse a undefined:
        // la valeur par defaut est une decision, pas un oubli.
        bandeauxOuverts: false,
        // Parametres de la projection fin de mois, ajustables a l'ecran.
        // coeff null = prendre le calibre sur l'historique, sinon la
        // reference du document.
        proj: {
            coeff: null, poidsReel: 0.7, minJours: 5,
            stockOption: 'garder', depensesOption: 'realise',
            // CA projete: 'derniers' = CA realise + quantites restantes x
            // dernier prix de vente (le choix du proprietaire du produit);
            // 'rythmes' = l'extrapolation P1/P2 seule, aux prix de la periode.
            caMethode: 'derniers',
            // QUANTITES RESTANTES SAISIES A LA MAIN, par cle normalisee.
            // { 'boeuf en gros': { reste: 300 } }. Vide = hypothese de mix,
            // c'est-a-dire le comportement d'avant cette fonctionnalite.
            // Le backtest ayant montre qu'un estimateur par produit degrade le
            // PL, c'est l'exploitant qui apporte l'information que les donnees
            // n'ont pas: une commande de gros annoncee.
            surchargesVolume: {},
            // 'atelier' = la saisie redistribue a CA projete constant (le
            // defaut: elle corrige un MIX). 'ajout' = elle s'ajoute au CA.
            surchargeMode: 'atelier',
            // Combien de fois le rythme mensuel d'un produit on s'autorise a
            // lui demander, dans le plan d'equilibre.
            facteurMax: 3,
            // Ecart de parage teste par les scenarios de la projection, en
            // POINTS de pourcentage (5 % -> 8 % et 2 % a 3 points).
            ecartParage: 3,
            // Prix du boeuf TESTE a la main, en F/kg, pour les jours qui
            // restent. Les deux lignes « au plus haut » et « au plus bas »
            // n'offrent que les bornes deja connues du mois; un prix libre
            // permet de repondre a « et si la carcasse passait a X ». null =
            // le champ part du cout moyen constate, donc a effet nul.
            prixBoeufTeste: null,
            // Taux de parage TESTE a la main sur la ligne de prix libre, en
            // POURCENTAGE absolu (et non en points d'ecart comme
            // `ecartParage`). Le cout et le parage se subissent ensemble - une
            // carcasse plus chere qui rend moins - et les lire separement
            // laissait le boucher additionner deux effets de tete. null = le
            // champ part du taux bovin constate, donc a effet nul.
            parageBoeufTeste: null,
            // LE PL VISE par le plan et par l'ecart en kilos, en FCFA. Zero =
            // l'equilibre, et c'est le defaut. Mais ne pas perdre n'est pas un
            // objectif d'exploitation: celui qui veut degager 100 000 F le
            // saisit ici, et les deux lectures - le plan et les volumes -
            // s'ajustent ensemble.
            plCible: 0,
            // Prix de vente retenu pour les jours qui RESTENT, par produit.
            // Vide = celui que le serveur propose (majoritaire du dernier jour
            // vendu). Une saisie ici le remplace: le tarif courant peut n'avoir
            // jamais ete pratique sur la periode - le boeuf en gros est passe a
            // 5 200 alors que la seule vente du dernier jour etait a 5 100,
            // exceptionnellement consentie a une cliente.
            prixSuite: {},
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
    // LE GRIS ARDOISE DE LA PALETTE FINANCE (--fin-neutral), pas le bleu de
    // Bootstrap, qui ne portait aucune information sur cet ecran. Partage par
    // la bascule de vues et le bouton Calculer, pour qu'ils ne divergent pas.
    // Les jetons --fin-* sont portes par #finance-section, qui englobe cet
    // ecran; le repli couvre le cas ou ce bloc serait rendu ailleurs.
    var STYLE_ARDOISE = 'background:var(--fin-neutral,#475569);'
        + 'border-color:var(--fin-neutral,#475569);color:#fff';

    function injecter() {
        var v1 = document.querySelector('[data-fin-pane="simulation"]');
        if (!v1 || document.getElementById('sim2-boite')) return false;

        // PLUS DE BASCULE v1/v2. Cette fonction n'est appelee que lorsque le
        // reglage `actif` du tenant est vrai (cf. amorcer): dans ce cas la 2.0
        // EST la Simulation, et proposer un retour a l'ancien ecran laissait
        // deux reponses possibles a la meme question. La v1 est simplement
        // masquee - son code reste en place, et desactiver le reglage la
        // ramene telle quelle.
        Array.prototype.slice.call(v1.children).forEach(function (el) {
            el.style.display = 'none';
        });

        var boite = document.createElement('div');
        boite.id = 'sim2-boite';
        boite.innerHTML = gabarit();
        v1.appendChild(boite);
        charger();

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
        + '</div>'
        // LA BARRE D'ACTIONS SUR SA PROPRE LIGNE, hors de la grille. Coincee
        // dans une col-md-3 a cote des quatre champs, elle disposait de 25 %
        // de la largeur pour quatre boutons et deux interrupteurs: les
        // libelles se repliaient (« Export JSON » sur deux lignes, Calculer
        // en pave). text-nowrap interdit le repli DANS un bouton; flex-wrap
        // laisse la barre passer a la ligne ENTRE les boutons sur mobile.
        + '<div class="d-flex gap-2 flex-wrap align-items-center mb-3">'
        +   '<button class="btn btn-sm text-nowrap" id="sim2-calc" style="' + STYLE_ARDOISE + '">'
        +     '<i class="bi bi-calculator"></i> Calculer</button>'
        +   '<button class="btn btn-sm btn-outline-secondary text-nowrap" id="sim2-reset">Réinitialiser</button>'
        +   '<button class="btn btn-sm btn-outline-dark text-nowrap" id="sim2-export-json" '
        +     'title="Télécharger la projection calculée (rythmes, scénarios, volumes, plan équilibre, recommandations) en JSON, structuré pour être lu par un LLM.">'
        +     'Export JSON</button>'
        +   '<div class="btn-group btn-group-sm" role="group">'
        +     '<button class="btn btn-sm btn-outline-dark text-nowrap" id="sim2-analyse" '
        +       'title="Faire commenter la projection par un modèle de langage : où va le mois, hypothèses, risques, action. Le modèle commente les chiffres, il n\'en calcule aucun.">'
        +       '<i class="bi bi-robot"></i> Analyser (IA)</button>'
        +     '<button class="btn btn-sm btn-outline-dark dropdown-toggle dropdown-toggle-split" '
        +       'data-bs-toggle="dropdown" aria-expanded="false" title="Choisir le niveau d\'analyse">'
        +       '<span class="visually-hidden">Niveau d\'analyse</span></button>'
        +     '<ul class="dropdown-menu"><li><a class="dropdown-item small" href="#" id="sim2-analyse-approfondie" '
        +       'title="Modèle à raisonnement complet : plus fin, plus lent, nettement plus cher.">'
        +       '<i class="bi bi-search"></i> Analyse approfondie</a></li></ul>'
        +   '</div>'
        +   '<div class="form-check form-switch ms-1 d-flex align-items-center">'
        +     '<input class="form-check-input" type="checkbox" id="sim2-hors-stock">'
        +     '<label class="form-check-label small ms-1 text-nowrap" for="sim2-hors-stock" '
        +       'title="Retire la variation de stock : montre la part du résultat qui repose '
        +         'sur de la marchandise encore invendue. Ce n\'est pas le résultat réel.">'
        +       'Hors stock</label></div>'
        +   '<div class="form-check form-switch ms-1 d-flex align-items-center">'
        +     '<input class="form-check-input" type="checkbox" id="sim2-debug">'
        +     '<label class="form-check-label small ms-1" for="sim2-debug">Debug</label></div>'
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
        // « Calculer » RECHARGE les donnees, il ne se contente pas de rejouer
        // le scenario sur celles qu'on a deja. Le PL bouge dans la journee -
        // une vente saisie, un stock corrige - et rendre() seul reaffichait
        // alors les chiffres d'avant: il fallait quitter l'onglet et revenir
        // pour voir l'effet, ce qui donne au bouton l'air de ne rien faire.
        //
        // charger() enchaine sur rendre(): un seul chemin, et le meme que
        // celui du changement de periode.
        $('calc').addEventListener('click', charger);
        // EXPORT JSON de la couche calculee. `$` prefixe par 'sim2-'.
        var btnExport = $('export-json');
        if (btnExport) btnExport.addEventListener('click', exporterProjectionJson);
        var btnAnalyse = $('analyse');
        if (btnAnalyse) btnAnalyse.addEventListener('click', function () { analyserProjection(); });
        var btnAnalyseAppro = document.getElementById('sim2-analyse-approfondie');
        if (btnAnalyseAppro) btnAnalyseAppro.addEventListener('click', function (ev) {
            ev.preventDefault();
            analyserProjection('approfondie');
        });
        $('reset').addEventListener('click', function () {
            etat.leviers = {};
            // reinitGlobaux(), PAS null. Poser null laissait nbActifs() lire
            // s.globaux.charges sur null: le bouton levait une TypeError et
            // l'ecran ne bougeait pas - une remise a zero qui ne remettait
            // rien. Et si le rendu avait survecu, globauxDe() aurait lu {},
            // donc com absent, donc un gain fantome egal a TOUTE la
            // commission (+194 139 F sur juillet).
            reinitGlobaux();
            // Les HYPOTHESES testees de la projection repartent elles aussi.
            // Elles vivaient hors de portee du bouton: on remettait les leviers
            // a zero, les cartes revenaient a leur valeur, et la ligne
            // d'hypothese gardait en silence son parage a 20 % et sa carcasse a
            // 6 000 F. Seuls ces deux champs-la sont remis - le reste d'
            // `etat.proj` porte des REGLAGES d'affichage (stockOption,
            // facteurMax...), que personne ne demande a perdre en remettant un
            // scenario a zero.
            etat.proj.prixBoeufTeste = null;
            etat.proj.parageBoeufTeste = null;
            rendre();
        });
        // Le mode debug revele l'etat courant, il n'est pas un levier: il
        // s'affiche immediatement meme en calcul manuel.
        $('debug').addEventListener('change', function () {
            etat.debug = $('debug').checked;
            rendre();
        });
        // Comme le debug: revele une autre lecture du meme resultat, sans
        // toucher aux leviers. S'applique donc immediatement, meme en manuel.
        $('hors-stock').addEventListener('change', function () {
            etat.horsStock = $('hors-stock').checked;
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
        // La periode REELLEMENT interrogee, capturee avant que le snapshot
        // n'ecrase les champs: c'est a elle qu'on compare la periode du
        // snapshot pour savoir s'il faut relancer /simulation.
        var demandee = { debut: d.value, fin: f.value };
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

            // Le snapshot peut porter une AUTRE periode que celle des champs
            // au moment de la requete. On ecrivait alors ses dates dans les
            // champs sans relancer /simulation: les prix d'achat, le catalogue
            // et les volumes vendus restaient ceux du mois affiche, appliques
            // aux volumes figes d'un autre mois. Une seule requete de plus,
            // et seulement quand les periodes different reellement.
            var periodeAutre = fige && snap && (
                snap.periode_debut !== demandee.debut || snap.periode_fin !== demandee.fin
            );
            if (periodeAutre) {
                var qs2 = 'dateDebut=' + encodeURIComponent(snap.periode_debut)
                    + '&dateFin=' + encodeURIComponent(snap.periode_fin);
                jsonOu('/api/finance/simulation?' + qs2, null).then(function (sim2) {
                    preparer(sim2 || sim, payload, cfg, source, true);
                    rendre();
                });
                return;
            }

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
        // PARAGE QUI DIVISE LA MARGE: le taux MESURE du mois quand il existe,
        // le parametre stock_pertes_decoupe_pct sinon.
        //
        // Le parametre vaut 5 % chez tous les tenants. Sur aout 2026 a Mbao le
        // bovin mesure est tout autre, et l'ecart change le SIGNE de la marge:
        // a 4 520 F la carcasse pour 5 400 F de prix moyen, +642 F a 5 % et
        // -79 F a 17,5 %. Diviser par un taux qu'on n'a pas mesure revient a
        // decider du signe a l'avance.
        //
        // Le serveur arrete ce taux a la VEILLE du jour d'analyse: l'inventaire
        // du soir se saisit souvent tard, et une journee dont le stock du soir
        // manque affiche un parage voisin de 100 %.
        var parageBase = nb(stock.pertes_decoupe_pct);
        var pm = sim.parage_mesure || null;
        // ASSISE MINIMALE. Un taux mesure sur une seule journee n'est pas plus
        // fiable que le parametre qu'il remplace - il est seulement plus
        // recent, et il DIVISE la marge. Le cas s'est presente des le premier
        // jour: une fois Laxass sorti du parage, l'ovin est tombe a 0,94 % sur
        // UNE journee mesurable, et ce taux pilotait la marge de l'agneau.
        //
        // Cinq journees, le meme seuil que les rythmes de la projection et
        // pour la meme raison: en dessous, la moyenne tient a une seule
        // observation. Le parametre reprend alors la main, et l'ecran le dit.
        var parageDe = function (espece) {
            return parageRetenu(pm, parageBase, MIN_JOURS_PARAGE, espece);
        };
        etat.contexte = {
            varBovin: nb(stock.variation_bovin),
            varOvin: nb(stock.variation_ovin),
            varAutre: nb(stock.variation_autre_boucherie),
            coeff: nb(stock.coeff),
            parageBase: parageBase,
            // Les deux taux REELLEMENT appliques, par espece, et leur source.
            parageBovin: parageDe('bovin'),
            parageOvin: parageDe('ovin'),
            parageMesure: pm,
            parageMinJours: MIN_JOURS_PARAGE,
            boeuf: { matin: qBoeuf(stock.matin_detail), soir: qBoeuf(stock.soir_detail) },
            commission: nb(pl.commission_maas),
            commissionPct: nb(cfg.commission_pct) || 3,
            // Prix de VENTE catalogue des carcasses: l'assiette de la
            // commission MaaS. Le moteur en a besoin pour faire suivre la
            // commission aux achats que les leviers induisent.
            pv: {
                bovin: sim.catalogue ? sim.catalogue.pv_boeuf : null,
                ovin: sim.catalogue ? sim.catalogue.pv_agneau : null,
                volaille: sim.catalogue ? sim.catalogue.pv_poulet : null,
                // Le prix catalogue de chaque produit qui en a un: c'est lui
                // qui prime sur la carcasse de l'espece.
                par_produit: (sim.catalogue && sim.catalogue.par_produit) || {}
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
        // LES GLOBAUX SONT REPOSES A CHAQUE CHARGEMENT, pas seulement au
        // premier. Ils partent du contexte - taux de parage mesure, taux de
        // commission - et ce contexte vient d'etre remplace par des donnees
        // fraiches. Les garder d'une charge a l'autre laissait un scenario
        // « vide » comparer un levier a 3,96 % contre une reference qui valait
        // encore 5 %: l'ecran annonçait « 1 levier actif » et -7 383 F d'effet
        // sur un scenario que personne n'avait touche.
        //
        // Le prix a payer est assume: un scenario en cours est perdu quand on
        // recharge. C'est preferable a un scenario chiffre contre une
        // reference perimee, qu'aucun ecran ne signale.
        reinitGlobaux();
    }

    // ASSISE MINIMALE d'un parage mesure. Cinq journees, le meme seuil que les
    // rythmes de la projection et pour la meme raison: en dessous, la moyenne
    // tient a une seule observation.
    var MIN_JOURS_PARAGE = 5;

    /**
     * Le taux de parage RETENU pour une espece: le mesure, ou le parametre.
     *
     * Un taux mesure sur une seule journee n'est pas plus fiable que le
     * parametre qu'il remplace - il est seulement plus recent, et il DIVISE la
     * marge. Le cas s'est presente des le premier jour: une fois Laxass sorti
     * du parage, l'ovin est tombe a 0,94 % sur UNE journee mesurable, et ce
     * taux pilotait la marge de l'agneau.
     *
     * @param {object|null} mesure  { bovin, ovin, jours_mesures: {bovin, ovin} }
     * @param {number} base         stock_pertes_decoupe_pct, le repli
     * @param {number} mini         journees mesurables exigees
     */
    function parageRetenu(mesure, base, mini, espece) {
        var v = mesure ? mesure[espece] : null;
        if (v === null || v === undefined) return nb(base);
        var n = (mesure.jours_mesures) ? nb(mesure.jours_mesures[espece]) : 0;
        return n < nb(mini) ? nb(base) : nb(v);
    }

    /**
     * Un taux en pour-cent, au CENTIEME et a la francaise.
     *
     * Deux decimales, sans arrondi a l'entier: un parage mesure a 3,96 %
     * affiche « 4 % » se lit comme une valeur ronde qu'on aurait choisie,
     * alors que c'est le resultat d'une mesure sur onze journees. Et l'ecart
     * n'est pas cosmetique - il porte sur un DIVISEUR: a 4 552 F la carcasse,
     * 3,96 % contre 4 % deplace le cout de 2 F l'unite, soit pres de 700 F sur
     * les 360 kg du mois.
     */
    function pct2(v) {
        return nb(v).toFixed(2).replace('.', ',');
    }

    /**
     * D'OU vient le taux de parage applique, et sur quoi il repose.
     *
     * Un taux mesure sur UNE journee n'est pas plus fiable que le parametre
     * qu'il remplace - il est seulement plus recent. Le dire est la condition
     * pour qu'on puisse s'en servir: c'est l'utilisateur qui sait si sa
     * semaine a ete normale, pas le calcul.
     */
    function sourceDuParage() {
        var c = etat.contexte || {};
        var pm = c.parageMesure || null;
        var base = 'le paramètre ' + pct2(c.parageBase) + ' %';
        var mini = nb(c.parageMinJours) || 5;
        var dit = function (espece, taux, cle) {
            var n = pm && pm.jours_mesures ? nb(pm.jours_mesures[cle]) : 0;
            var jours = n + ' journée' + (n > 1 ? 's' : '') + ' mesurée' + (n > 1 ? 's' : '');
            if (!pm || pm[cle] === null || pm[cle] === undefined) {
                return espece + ' ' + base + ' (aucune journée mesurable)';
            }
            // Sous le seuil, le taux mesure est ECARTE, pas seulement signale:
            // il divise la marge, et une moyenne sur une journee ne vaut pas
            // mieux que le parametre. On montre quand meme ce qu'il vaudrait -
            // c'est ce qui permet de juger quand il redeviendra utilisable.
            if (n < mini) {
                return espece + ' ' + base + ' — le mesuré (' + pct2(pm[cle]) + ' %) '
                    + 'ne repose que sur ' + jours + ', '
                    + '<span class="text-warning-emphasis">trop peu pour être retenu</span>';
            }
            return espece + ' <strong>' + pct2(pm[cle]) + ' %</strong> (' + jours + ')';
        };
        return '<div class="mt-1">Parage appliqué — ' + dit('bœuf', pm && pm.bovin, 'bovin')
            + ' · ' + dit('agneau', pm && pm.ovin, 'ovin')
            + (pm && pm.jusquau ? ', cumulé jusqu\'au <strong>' + esc(dateCourte(pm.jusquau)) + '</strong> '
               + '— la journée en cours est écartée, son inventaire du soir étant souvent saisi tard.' : '')
            + '</div>';
    }

    /**
     * Sept taux de parage centres sur celui en vigueur, jamais negatifs.
     *
     * Le pas suit l'ordre de grandeur: 2 points autour d'un taux modeste, 3
     * au-dela de 10 %. Un pas fixe de 2 sur un parage a 17 % donnerait une
     * matrice de 11 a 23 %, trop serree pour montrer ce qu'un vrai progres
     * rapporterait.
     */
    function echelleParage(taux) {
        var t = Math.max(0, nb(taux));
        var pasHaut = t >= 10 ? 3 : 2;
        // COTE BAS, le pas se resserre. Avec un pas fixe de 2, un taux mesure a
        // 3,96 % donnait trois valeurs negatives ramenees a zero; les
        // dedupliquer raccourcissait la ligne et faisait GLISSER le taux hors
        // du centre - la fonction ne tenait plus la promesse de ce commentaire.
        // On repartit plutot les trois crans entre 0 et le taux: ils restent
        // distincts, la ligne garde ses sept colonnes, et le taux applique
        // reste au milieu.
        var pasBas = Math.min(pasHaut, t / 3);
        var arr = function (v) { return Math.round(Math.max(0, v) * 100) / 100; };
        var out = [];
        for (var i = -3; i < 0; i++) out.push(arr(t + i * pasBas));
        // Le taux EXACT, non arrondi: arrondi a 4 % quand il vaut 3,96, cliquer
        // la colonne du milieu aurait compte comme un levier actif et rendu le
        // scenario « je ne change rien » introuvable.
        out.push(t);
        for (var j = 1; j <= 3; j++) out.push(arr(t + j * pasHaut));
        return out;
    }

    function reinitGlobaux() {
        var c = etat.contexte;
        etat.globaux = {
            charges: 0, dep: 0,
            com: c ? c.commissionPct : 3,
            // Le point de depart des leviers est le taux MESURE de l'espece,
            // pas le parametre: c'est lui qui sert aussi de reference au
            // moteur, et les deux doivent partir du meme endroit sous peine
            // d'afficher un effet de parage sur un scenario vide.
            parBov: c ? nb(c.parageBovin) : 0,
            parOvi: c ? nb(c.parageOvin) : 0,
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

    /**
     * Le resultat de reference, eventuellement PRIVE de la variation de stock.
     *
     * Aucun recalcul: on retranche un poste que le serveur a lui-meme publie
     * (stock.variation_nette), exactement comme les leviers s'ajoutent a ce
     * qu'il a etabli. Le PL brut reste disponible pour le controle de bouclage
     * du mode debug, qui doit continuer a se comparer au chiffre du serveur.
     */
    function plRef() {
        var b = etat.base;
        if (!b) return 0;
        if (!etat.horsStock) return b.pl;
        return b.pl - nb((b.stock || {}).variation_nette);
    }

    function nbActifs(s) {
        var c = etat.contexte, n = 0;
        etat.produits.forEach(function (p) {
            var l = s.leviers[p.nom]; if (l && (l.prix || l.vol)) n++;
        });
        if (nb(s.globaux.charges)) n++;
        if (nb(s.globaux.dep)) n++;
        if (nb(s.globaux.com) !== c.commissionPct) n++;
        if (nb(s.globaux.parBov) !== nb(c.parageBovin)) n++;
        if (nb(s.globaux.parOvi) !== nb(c.parageOvin)) n++;
        if (nb(s.globaux.dPa)) n++;
        return n;
    }

    // ============================================================ RENDU
    function rendre() {
        if (!etat.base) return;
        etat.enAttente = false;
        peindreCalc($('calc'), false);

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
        cablerBandeaux();
        // UNE VUE A LA FOIS. Le scenario garde ce qui le sert - KPI, tableau
        // de sensibilite, equilibre, matrice, liste des produits: tout cela
        // decrit l'effet des leviers. La projection, elle, repond a une autre
        // question et tient seule.
        var vueProjection = etat.vue === 'projection';
        $('corps').innerHTML = basculeVues()
            + (vueProjection
                ? projection()
                : (panneauScenario(s, g)
                    + kpis(total, n)
                    + tableau(s, total)
                    + equilibre(s)
                    + matrice(s)
                    + tousLesProduits(s)))
            + (etat.debug ? debug(s, g, total) : '');
        cablerBasculeVues();
        // TOUJOURS, quelle que soit la vue. cablerLeviers() ne cable pas que
        // les leviers: c'est elle qui branche aussi les .sim2-proj-ctl, donc
        // TOUS les reglages de la projection. La sauter en vue projection -
        // qui est la vue par DEFAUT - laissait coefficient, ponderation,
        // methode de CA, stock et depenses inertes: on changeait la valeur,
        // rien ne se recalculait.
        //
        // Sans danger dans l'autre sens: les selecteurs portent sur des
        // elements absents de la vue courante, et querySelectorAll sur un
        // ensemble vide ne fait rien.
        cablerLeviers();

        // L'ouverture du bloc « Tous les produits » survit au prochain rendu.
        // Le `toggle` est ASYNCHRONE: on lit det.open depuis l'evenement, pas
        // avant, sinon on enregistre l'etat d'avant le clic.
        var det = document.getElementById('sim2-tous-produits');
        if (det) {
            det.addEventListener('toggle', function () { etat.tousProduitsOuverts = det.open; });
        }
    }

    /**
     * LA BASCULE ENTRE LES DEUX VUES, sur le modele de celle qui separait la
     * v1 de la v2: meme btn-group, meme traitement de la couleur.
     *
     * La couleur du texte selectionne est posee EN LIGNE, pas laissee aux
     * classes Bootstrap: le theme de l'application redefinit la couleur de
     * .btn-primary, et le libelle du bouton choisi ressortait bleu sur fond
     * bleu, donc illisible.
     */
    function basculeVues() {
        var bouton = function (vue, libelle) {
            var choisi = etat.vue === vue;
            var style = choisi ? STYLE_ARDOISE
                : 'background:transparent;border-color:var(--fin-border-strong,#cbd5e1);'
                  + 'color:var(--fin-text-secondary,#475569)';
            return '<button type="button" class="btn" data-vue="' + vue + '" style="' + style + '">'
                + libelle + '</button>';
        };
        return '<div class="btn-group btn-group-sm mb-3" id="sim2-vues">'
            + bouton('projection', 'Projection fin de mois')
            + bouton('scenario', 'Scénario')
            + '</div>';
    }

    function cablerBasculeVues() {
        var groupe = document.getElementById('sim2-vues');
        if (!groupe) return;
        groupe.addEventListener('click', function (e) {
            var b = e.target.closest('[data-vue]');
            if (!b || b.dataset.vue === etat.vue) return;
            etat.vue = b.dataset.vue;
            rendre();
        });
    }

    /**
     * TOUS les produits vendus, avec leur prix de vente et leur cout, tels que
     * le calcul les a retenus. Pour information, replie par defaut.
     *
     * Le tableau de sensibilite ne montre que les produits SUIVIS - cinq, plus
     * ceux qu'un admin ajoute. C'est voulu: un tableau dont les lignes vont et
     * viennent d'un mois a l'autre ne se compare pas. Mais du coup rien ne
     * disait ce que le calcul retient pour les AUTRES, alors qu'ils pesent
     * dans le chiffre d'affaires et que leurs couts viennent d'etre corriges.
     *
     * Les deux prix sont des moyennes PONDEREES par les quantites vendues, pas
     * des prix de catalogue: c'est ce que la periode a reellement coute et
     * rapporte. D'ou l'ecart possible avec l'ecran Prix fournisseur, qui
     * montre le prix courant.
     */
    function tousLesProduits(scenario) {
        var liste = (etat.sim && etat.sim.produits_vendus) || [];
        if (!liste.length) return '';

        // L'origine arrive DEJA redigee par lib/prix-achat-date.js - « prix
        // propre », « mappé vers Boeuf × 0,5 », « sources multiples ». Une table
        // de traduction ici serait une seconde definition de la resolution, et
        // c'est exactement celle qui vient de disparaitre.
        // Totaux cumules PENDANT la construction, sur les memes valeurs que
        // les lignes: les recalculer ensuite ferait une seconde definition, et
        // un total qui ne serait pas la somme de ce qu'on voit.
        var totMarge = 0, totCout = 0, totVentes = 0, totQte = 0;
        var lignesSansCout = 0;
        var lignes = liste.slice().sort(function (a, b) { return nb(b.ca) - nb(a.ca); })
            .map(function (p) {
                var pv = (p.prix_moyen === null || p.prix_moyen === undefined) ? null : nb(p.prix_moyen);
                var pa = (p.prix_achat === null || p.prix_achat === undefined) ? null : nb(p.prix_achat);
                // Le MEME diviseur que la marge du tableau de sensibilite: le
                // recalculer ici en ferait une seconde definition, et deux
                // parages differents pour le meme produit sur le meme ecran.
                var div = M.diviseurParage(p, scenario || { leviers: {}, globaux: {} }, etat.contexte);
                var parage = (div === null || div >= 1) ? null : (1 - div) * 100;
                var paPare = (pa === null || parage === null) ? null : pa / div;
                // Marge NETTE de parage, comme partout ailleurs sur cet ecran:
                // c'est le cout de la carcasse qu'il faut acheter pour vendre
                // une unite, pas celui de l'unite elle-meme.
                var m = (pv === null || pa === null) ? null : pv - (paPare === null ? pa : paPare);
                // MARGE de la ligne = marge unitaire x quantite. Le taux par
                // unite ne dit pas ce que le produit rapporte: le Jarret perd
                // 1 564 F par piece, mais sur 11 pieces - a comparer aux
                // 959 F x 390 du boeuf en detail.
                var q = nb(p.quantite);
                var margeLigne = m === null ? null : m * q;
                // COUT de la ligne au prix REELLEMENT soustrait, parage
                // compris: c'est ce qu'il a fallu acheter, pas ce qu'on a
                // vendu.
                var coutLigne = pa === null ? null : (paPare === null ? pa : paPare) * q;
                totQte += q;
                totVentes += nb(p.ca);
                if (margeLigne === null || coutLigne === null) lignesSansCout++;
                else { totMarge += margeLigne; totCout += coutLigne; }
                return '<tr>'
                    + '<td>' + esc(p.nom)
                      + (pa === null
                         ? ' <span class="badge bg-danger-subtle text-danger">coût inconnu</span>' : '')
                    + '</td>'
                    + '<td class="text-end">' + esc(nb(p.quantite).toLocaleString('fr-FR')) + '</td>'
                    + '<td class="text-end">' + esc(fmt(pv)) + '</td>'
                    + '<td class="text-end">' + esc(fmt(pa))
                      + (paPare === null ? ''
                         : ' <span class="text-muted">(' + esc(fmt(paPare)) + ')</span>') + '</td>'
                    + '<td class="text-end text-muted">'
                      + (parage === null ? '—' : esc(pct2(parage)) + ' %') + '</td>'
                    + '<td class="small text-muted">' + esc(p.prix_achat_origine || '—') + '</td>'
                    + '<td class="text-end' + (m !== null && m < 0 ? ' text-danger fw-medium' : '') + '">'
                      + esc(fmt(m)) + '</td>'
                    + '<td class="text-end' + (margeLigne !== null && margeLigne < 0 ? ' text-danger fw-medium' : '') + '">'
                      + esc(fmt(margeLigne)) + '</td>'
                    + '<td class="text-end">' + esc(fmt(p.ca)) + '</td>'
                    + '</tr>';
            }).join('');

        var sansCout = liste.filter(function (p) {
            return p.prix_achat === null || p.prix_achat === undefined;
        }).length;

        // L'etat vit dans une VARIABLE, pas dans le DOM: rendre() reconstruit
        // innerHTML, donc relire l'ouverture au moment du rendu rendrait
        // toujours « ferme » et le bloc se refermerait a chaque changement de
        // levier - exactement le defaut deja corrige sur la composition du
        // parage.
        var ouvert = etat.tousProduitsOuverts === true;
        return '<details class="mb-3"' + (ouvert ? ' open' : '') + ' id="sim2-tous-produits">'
            + '<summary class="fin-subheading" style="cursor:pointer">'
            + 'Tous les produits vendus — prix et coût retenus '
            + '<span class="badge bg-secondary">' + liste.length + '</span>'
            + (sansCout
               ? ' <span class="badge bg-danger-subtle text-danger">' + sansCout + ' sans coût</span>' : '')
            + '</summary>'
            + '<div class="small text-muted mb-2 mt-1">Pour information : ce tableau ne pilote aucun '
            + 'levier. Les deux prix sont des moyennes <strong>pondérées par les quantités vendues</strong> '
            + 'sur la période — ce que la période a réellement coûté et rapporté, et non le prix courant '
            + 'du catalogue. Le second coût entre parenthèses est celui <strong>réellement '
            + 'soustrait</strong> : le prix de la carcasse ÷ (1 − parage), puisqu\'il faut en acheter '
            + 'davantage que ce qu\'on vend. La colonne Parage est vide pour ce qui ne se pare pas — '
            + 'volaille, épicerie. La marge est nette de parage mais <strong>brute de commission</strong>.'
            + '</div>'
            + '<div class="table-responsive"><table class="table table-sm table-hover mb-0">'
            + '<thead><tr><th>Produit</th><th class="text-end">Quantité</th>'
            + '<th class="text-end">Prix de vente pondéré</th><th class="text-end">Coût pondéré</th>'
            + '<th class="text-end">Parage</th>'
            + '<th>Source du coût</th><th class="text-end">Marge nette de parage</th>'
            + '<th class="text-end">Marge</th>'
            + '<th class="text-end">Ventes</th></tr></thead>'
            + '<tbody>' + lignes + '</tbody>'
            // PIED DE TABLEAU. Le total de cout ne porte QUE sur les lignes
            // qui ont un cout: additionner des lignes dont une partie manque
            // donnerait une marge d'apparence complete. Le nombre de lignes
            // ecartees est dit juste a cote.
            + '<tfoot><tr class="fw-semibold border-top">'
            + '<td>Total' + (lignesSansCout
                ? ' <span class="fw-normal text-muted small">('
                  + lignesSansCout + ' ligne(s) sans coût, exclue(s) du coût et de la marge)</span>'
                : '') + '</td>'
            + '<td class="text-end">' + esc(totQte.toLocaleString('fr-FR', { maximumFractionDigits: 2 })) + '</td>'
            + '<td></td>'
            + '<td class="text-end">' + esc(fmt(totCout)) + '</td>'
            + '<td></td><td></td><td></td>'
            + '<td class="text-end' + (totMarge < 0 ? ' text-danger' : '') + '">' + esc(fmt(totMarge)) + '</td>'
            + '<td class="text-end">' + esc(fmt(totVentes)) + '</td>'
            + '</tr></tfoot>'
            + '</table></div></details>';
    }

    function marquerEnAttente() {
        etat.enAttente = true;
        peindreCalc($('calc'), true);
    }

    // LE BOUTON CALCULER, dans ses deux etats.
    //
    // Gris ardoise au repos, comme la bascule de vues: le bleu de Bootstrap
    // ne portait aucune information ici. L'ORANGE de l'attente reste, lui -
    // il ne decore pas, il signale qu'un levier a bouge sans etre recalcule,
    // et c'est la seule couleur de cet ecran qui merite d'attirer l'oeil.
    function peindreCalc(b, enAttente) {
        if (!b) return;
        if (enAttente) {
            b.classList.remove('btn-primary');
            b.classList.add('btn-warning');
            b.removeAttribute('style');
            b.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Calculer (en attente)';
        } else {
            b.classList.remove('btn-warning', 'btn-primary');
            b.setAttribute('style', STYLE_ARDOISE);
            b.innerHTML = '<i class="bi bi-calculator"></i> Calculer';
        }
    }

    function onLevier() {
        if (etat.mode === 'manuel') { marquerEnAttente(); return; }
        rendre();
    }

    /**
     * LES BANDEAUX, COLLECTES PLUTOT QU'EMPILES.
     *
     * Ils occupaient un ecran entier avant le premier chiffre - quatre pavés
     * a lire pour arriver aux boutons. Ils restent indispensables (une source
     * muette ou un cout inconnu changent la lecture du resultat), mais ils se
     * consultent une fois, pas a chaque rendu.
     *
     * Rendus ici en LISTE, avec leur niveau: c'est bandeaux() qui decide de
     * l'emballage - une pastille refermee, ouverte au clic.
     */
    function collecterBandeaux() {
        var b = etat.base, st = b.stock || {}, m = [];
        var src = b.sources && b.sources.avances;
        if (src && src.etat === 'indisponible') {
            m.push({ niveau: 'danger', corps: '<i class="bi bi-exclamation-triangle"></i> '
               + '<strong>Avances MataBanq indisponibles.</strong> ' + esc(src.raison || '')
               + '. Elles comptent pour 0 : le résultat est surévalué d\'autant, et le PL ne peut pas être figé.' });
        } else if (src && src.etat === 'non_configure') {
            m.push({ niveau: 'secondary', corps: '<i class="bi bi-info-circle"></i> '
               + 'MataBanq n\'est pas configuré ici : les avances valent zéro, ce qui est normal sur ce déploiement.' });
        }
        (b.avertissements || []).forEach(function (a) {
            m.push({ niveau: 'warning', corps: '<i class="bi bi-exclamation-triangle"></i> ' + esc(a) });
        });
        // Derniere journee sans vente: la simulation part du meme PL, elle
        // herite donc du meme resultat tronque. Le taire ici ferait raisonner
        // sur des leviers appliques a une periode incomplete.
        var vdf = b.ventesDateFin;
        if (vdf && vdf.aucune_vente === true) {
            m.push({ niveau: 'warning', corps: '<i class="bi bi-calendar-x"></i> '
               + '<strong>Aucune vente saisie le ' + esc(vdf.date) + '</strong>, dernier jour de la période. '
               + (vdf.derniere_date_avec_vente
                   ? 'Dernière journée avec des ventes : ' + esc(vdf.derniere_date_avec_vente) + '. '
                   : 'Aucune vente sur toute la période. ')
               + 'Le résultat de référence est incomplet, et les leviers s\'y appliquent tels quels.' });
        }
        // Un resultat ampute d'un poste ne doit JAMAIS pouvoir se lire comme le
        // PL: le dire est la condition pour offrir cette lecture.
        if (etat.horsStock) {
            m.push({ niveau: 'info', corps: '<i class="bi bi-eye"></i> '
               + '<strong>Lecture hors stock — mesure d\'exposition, pas le résultat.</strong> '
               + 'La variation de stock (' + esc(fmt(nb(st.variation_nette))) + ' F) est retirée. '
               + 'Elle n\'est pas un gain fictif : elle est dans le PL pour ne PAS passer en charge '
               + 'une marchandise achetée mais pas encore vendue — ce stock partira, et sa marge avec. '
               + 'Ce que ce mode montre, c\'est la part de votre résultat qui repose sur une '
               + 'marchandise encore invendue, donc sur un comptage et une valorisation : le PL réel '
               + 'reste <strong>' + esc(fmt(b.pl)) + ' F</strong>.' });
        }
        var poids = b.pl ? Math.abs(nb(st.variation_nette) / b.pl) * 100 : 0;
        m.push({ niveau: 'light', corps: '<i class="bi bi-info-circle"></i> '
           + 'Résultat <strong>' + esc(b.source) + '</strong>, du ' + esc(b.periode.dateDebut || '')
           + ' au ' + esc(b.periode.dateFin || '') + '. '
           + 'Stock du soir au ' + esc(st.soir_date || '—') + ', il pèse ' + esc(fmt(nb(st.variation_nette)))
           + ' F soit ' + poids.toFixed(1) + ' % du résultat. '
           + 'Prix d\'achat : ' + (etat.sim && etat.sim.prix_achat && etat.sim.prix_achat.mode === 'periode'
               ? 'moyenne de la période pondérée par les quantités vendues.'
               : 'figé au dernier jour de la période.')
           // CE BANDEAU DECRIT LE RESULTAT DE REFERENCE, pas la projection.
           //
           // Les deux ne lisent plus le meme prix depuis que la projection est
           // passee au dernier cout connu: laisser une seule phrase pour les
           // deux aurait fait croire que la projection tourne sur la moyenne,
           // exactement le defaut qu'on vient de corriger.
           + ' <span class="text-muted">La projection de fin de mois, elle, part du '
           + '<strong>dernier prix d’achat connu</strong> et du dernier prix de vente '
           + 'constaté — voir « les deux méthodes » sous les scénarios.</span>' });
        var av = (etat.sim && etat.sim.prix_achat && etat.sim.prix_achat.avertissements) || [];
        if (av.length) {
            m.push({ niveau: 'warning', corps: '<i class="bi bi-exclamation-triangle"></i> '
               + av.map(esc).join('<br>') });
        }
        return m;
    }

    /**
     * LA PASTILLE, et les bandeaux derriere elle.
     *
     * Repliee par defaut: ces messages se lisent une fois, pas a chaque
     * rendu, et ils reprenaient tout le haut de l'ecran avant le premier
     * chiffre. Le compte et la couleur du plus grave restent visibles - une
     * source muette ne doit pas pouvoir se cacher derriere un pli.
     */
    var SEVERITE = { danger: 3, warning: 2, info: 1, secondary: 0, light: 0 };

    function bandeaux() {
        var m = collecterBandeaux();
        if (!m.length) return '';
        var pire = m.reduce(function (acc, x) {
            return SEVERITE[x.niveau] > SEVERITE[acc] ? x.niveau : acc;
        }, 'light');
        // 'light' n'a pas de contraste suffisant pour une pastille: on la
        // rend 'secondary' dans ce cas, le fond gris de l'application.
        var ton = pire === 'light' ? 'secondary' : pire;
        var ouvert = etat.bandeauxOuverts === true;
        return '<div class="mb-3">'
            + '<button type="button" class="btn btn-sm btn-outline-' + ton + '" id="sim2-notifs-btn"'
            + ' title="' + m.length + (m.length > 1 ? ' informations' : ' information')
            + ' sur ce résultat — cliquer pour ' + (ouvert ? 'replier' : 'lire') + '"'
            + ' aria-label="' + m.length + (m.length > 1 ? ' informations' : ' information')
            + ' sur ce résultat"'
            + ' aria-expanded="' + (ouvert ? 'true' : 'false') + '" aria-controls="sim2-notifs">'
            // Le COMPTE et un « i », pas le mot: la pastille tient sur une
            // ligne courte et ne prend plus la place qu'elle est censee
            // rendre. Le titre porte le mot pour qui survole, et l'icone de
            // severite reste devant - une source muette ne doit pas se
            // presenter comme une simple information.
            + '<i class="bi bi-' + (pire === 'danger' || pire === 'warning'
                ? 'exclamation-triangle' : 'info-circle') + '"></i> '
            + m.length + ' <span class="fst-italic">i</span>'
            + ' <i class="bi bi-chevron-' + (ouvert ? 'up' : 'down') + '"></i>'
            + '</button>'
            + '<div id="sim2-notifs" class="mt-2"' + (ouvert ? '' : ' style="display:none"') + '>'
            + m.map(function (x) {
                return '<div class="alert alert-' + x.niveau + ' py-2 small mb-2">' + x.corps + '</div>';
            }).join('')
            + '</div></div>';
    }

    function cablerBandeaux() {
        var btn = document.getElementById('sim2-notifs-btn');
        var boite = document.getElementById('sim2-notifs');
        if (!btn || !boite) return;
        btn.addEventListener('click', function () {
            etat.bandeauxOuverts = !(etat.bandeauxOuverts === true);
            var ouvert = etat.bandeauxOuverts;
            boite.style.display = ouvert ? '' : 'none';
            btn.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
            // Le chevron seul change: re-rendre tout l'ecran pour un pli
            // serait payer un recalcul complet pour une fleche.
            var chevron = btn.querySelector('.bi-chevron-down, .bi-chevron-up');
            if (chevron) {
                chevron.classList.toggle('bi-chevron-down', !ouvert);
                chevron.classList.toggle('bi-chevron-up', ouvert);
            }
        });
    }

    function panneauScenario(s, g) {
        var c = etat.contexte;
        var lignes = etat.produits.map(function (p, i) {
            var l = s.leviers[p.nom] || { prix: 0, unite: 'F', vol: 0 };
            var m = margeAvec(p, s);
            var e = effetProduit(p, s);
            return '<tr>'
                + '<td>' + esc(p.nom)
                  // Le cout ne vient pas de la ligne du produit: on le dit sur
                  // la ligne. « Jarret · mappé vers Boeuf × 0,5 » se verifie a
                  // l'oeil, la ou un cout nu laisse croire a un prix saisi.
                  + (p.prix_achat_origine && p.prix_achat_origine !== 'prix propre'
                     ? ' <span class="badge bg-info-subtle text-info">' + esc(p.prix_achat_origine) + '</span>' : '')
                  + (p.prix_achat === null || p.prix_achat === undefined ? ' <span class="badge bg-danger-subtle text-danger">coût inconnu</span>' : '')
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
        var ref = plRef();
        var apres = ref + total;
        var pct = ref ? (total / Math.abs(ref)) * 100 : 0;
        var carte = function (lab, val, hint, c) {
            return '<div class="col-md-4"><div class="card h-100"><div class="card-body text-center py-3">'
                + '<h6 class="card-subtitle mb-2 text-muted">' + lab + '</h6>'
                + '<h3 class="mb-0 ' + (c || '') + '">' + esc(val) + '</h3>'
                + '<div class="small text-muted mt-1">' + hint + '</div></div></div></div>';
        };
        return '<div class="row g-2 mb-3">'
            + carte('Résultat de référence', fmt(ref),
                esc(b.source) + (etat.horsStock ? ' · hors stock' : ''), cls(ref))
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
            // LE COUT REELLEMENT SOUSTRAIT, entre parentheses.
            //
            // La colonne montrait le prix de la carcasse (4 520) alors que la
            // marge divise par (1 - parage) et soustrait donc 4 758. Le
            // tableau ne se reconstituait pas de tete: 5 400 - 4 520 = 880, et
            // la colonne Marge affichait 642. Le second nombre rend les deux
            // colonnes voisines a nouveau compatibles.
            var div = M.diviseurParage(p, s, etat.contexte);
            var paPare = (pa === null || div === null || div >= 1) ? null : pa / div;
            return '<tr' + (p.sans_vente ? ' class="text-muted"' : '') + '>'
                + '<td>' + esc(p.nom) + '</td>'
                + '<td class="text-end">' + esc(q.toLocaleString('fr-FR')) + '</td>'
                + '<td class="text-end">' + esc(fmt(p.prix_moyen)) + '</td>'
                + '<td class="text-end' + (estBoeuf(p) && nb(s.globaux.dPa) ? ' text-danger' : '') + '"'
                  // Le taux au CENTIEME, jamais arrondi a l'entier: 3,96 %
                  // affiche « 4 % » laisse croire a un chiffre rond decide,
                  // alors que c'est une mesure. Et l'infobulle sert justement
                  // a refaire le calcul.
                  + (paPare === null ? '' : ' title="Prix carcasse ' + esc(fmt(pa))
                     + ' F ÷ (1 − ' + esc(pct2((1 - div) * 100)) + ' % de parage)'
                     + ' = ' + esc(fmt(paPare)) + ' F réellement soustraits du prix moyen."')
                  + '>'
                  + esc(pa === null ? '—' : fmt(pa))
                  + (paPare === null ? ''
                     : ' <span class="text-muted">(' + esc(fmt(paPare)) + ')</span>') + '</td>'
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
            + '<strong>Marge</strong> : nette de parage — prix moyen − prix carcasse ÷ (1 − parage). '
            + 'Le second prix entre parenthèses est ce qui est <strong>réellement soustrait</strong> '
            + 'du prix moyen.'
            + sourceDuParage() + '</div>';
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
        var base = plRef() + effetTotal(sansPilote);
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
            // La colonne du MILIEU porte le taux en vigueur - le mesure - pour
            // que la matrice se lise de part et d'autre de l'existant. Une
            // echelle fixe 0..10 aurait place un parage mesure a 17 % hors du
            // tableau, donc invisible la ou il agit.
            parBov: { lib: 'Taux de parage bœuf', vals: echelleParage(nb(c.parageBovin)), u: '%', abs: true,
                      set: function (s, v) { s.globaux.parBov = v; } },
            parOvi: { lib: 'Taux de parage agneau', vals: echelleParage(nb(c.parageOvin)), u: '%', abs: true,
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
                return plRef() + effetTotal(c);
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
        h += '   ' + pad('résultat de référence', 30) + padL(fmt(plRef()), 14) + '\n';
        h += '   ' + pad('case affichée', 30) + padL(fmt(plRef() + ex.total), 14) + '\n';
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
     * La marge d'une unite vendue EN PLUS, nette de la commission qu'elle
     * declenche.
     *
     * Le plan d'equilibre chiffrait son apport a la marge nette de parage
     * seule. Or le moteur du meme ecran facture aussi la COMMISSION INDUITE:
     * vendre une unite de plus fait livrer 1/(1-parage) unite de carcasse,
     * commissionnee au prix catalogue fournisseur (hypothese 2 du moteur).
     * Les deux moities de l'ecran se contredisaient donc: le plan promettait
     * de combler 2 500 000 F la ou le moteur n'en rendait que 2 100 000.
     *
     *     commission par unite = taux x prix catalogue / (1 - parage espece)
     *
     * Quand le prix catalogue de l'espece est inconnu, on ne peut pas chiffrer
     * la ponction: on rend la marge brute de parage plutot que d'inventer un
     * cout, et le plan reste alors optimiste - comme le reste de l'ecran, qui
     * signale deja cette part non chiffree.
     */
    /**
     * Le prix de vente retenu pour les jours qui RESTENT.
     *
     * Le prix moyen explique le passe: il melange les tarifs successifs et les
     * remises consenties. Les jours a venir se vendront au tarif COURANT, et
     * c'est lui qui doit servir a projeter. Par defaut le majoritaire du
     * dernier jour vendu (calcule par le serveur); une saisie a l'ecran le
     * remplace, car un tarif tout juste releve peut n'avoir jamais ete
     * pratique sur la periode.
     */
    function prixSuiteDe(p) {
        var saisi = etat.proj.prixSuite[p.nom];
        if (saisi !== undefined && saisi !== null && saisi !== '' && nb(saisi) > 0) return nb(saisi);
        var pr = p.prix_retenu;
        if (pr && nb(pr.prix) > 0) return nb(pr.prix);
        return (p.prix_moyen === null || p.prix_moyen === undefined) ? null : nb(p.prix_moyen);
    }

    /**
     * Le produit vu aux prix de la SUITE du mois - vente ET achat - plutot
     * qu'aux moyennes du passe.
     *
     * Le prix de VENTE bascule sur le tarif courant depuis l'origine. Le prix
     * d'ACHAT, lui, restait la moyenne ponderee des journees ecoulees: elle
     * melange les lots anciens aux recents et sous-estime le cout des que la
     * carcasse a rencheri. Mesure sur mbao: 4 157 F en projection contre
     * 4 480 F au PL pour le meme boeuf, parce que le PL, lui, valorise au
     * dernier prix connu.
     *
     * Les jours qui RESTENT se paieront au dernier prix connu - pour le boeuf,
     * celui du dernier transfert recu. On bascule donc les deux prix ensemble:
     * tout ce qui projette (marges, Δ equilibre, prix conseille, plan
     * d'equilibre) lit `prix_achat`, et herite du correctif d'un seul coup.
     *
     * Le parage et la commission ne sont PAS inclus ici: `prix_achat` reste le
     * cout carcasse NU. Le moteur applique ensuite le parage (division par
     * 1-parage) et la commission induite comme deux ajustements distincts -
     * les melanger dans un cout unique empecherait de les lire separement.
     */
    /**
     * La cle de surcharge d'un produit. MEME normalisation que le serveur
     * (lib/parage.js normaliserNom): accents retires, espaces coupes,
     * minuscules. Une cle divergente ferait rater sa cible a la saisie, en
     * silence - « Boeuf En Gros » et « Boeuf en gros » sont le meme produit.
     */
    function cleSurcharge(nom) {
        // `norm` fait deja exactement cela (NFD, diacritiques retires, trim,
        // minuscules) et couvre null comme undefined via `s == null`. Le
        // dupliquer creait une seconde definition libre de diverger de celle
        // qui sert partout ailleurs sur cet ecran.
        return norm(nom);
    }

    function auPrixDeLaSuite(p) {
        var px = prixSuiteDe(p);
        var pa = (p.prix_achat_fin === null || p.prix_achat_fin === undefined)
            ? null : nb(p.prix_achat_fin);
        if (px === null && pa === null) return p;
        var copie = {};
        Object.keys(p).forEach(function (k) { copie[k] = p[k]; });
        if (px !== null) copie.prix_moyen = px;
        // Un prix de fin nul ou absent laisse la moyenne en place: mieux vaut
        // un cout approche qu'aucun cout, et prix_achat_origine dit d'ou il
        // vient.
        if (pa !== null && pa > 0) copie.prix_achat = pa;
        return copie;
    }

    /**
     * L'effet, sur les JOURS QUI RESTENT, d'un coût d'achat ou d'un taux de
     * parage différent.
     *
     * Passe par le MOTEUR, pas par une formule recopiée: c'est lui qui sait
     * qu'un point de parage renchérit la carcasse de toutes les unités vendues
     * (1/(1-p)) et que la livraison induite est commissionnée. Réécrire ces
     * règles ici en ferait une seconde source de vérité, qui divergerait.
     *
     * Le contexte est privé de ses termes de STOCK - variation par espèce et
     * écart matin/soir mis à zéro. Ces effets décrivent le stock DÉJÀ constitué
     * sur la période écoulée; la projection les traite à part, par l'option
     * « variation de stock projetée ». Les laisser ici les compterait deux fois.
     *
     * @param {Array} produits  au prix de la suite, quantités de la période
     * @param {number} proportion  part du volume encore à vendre
     * @param {object} globaux  ce qui change: { dPa } ou { parBov, parOvi }
     */
    function effetSurLaSuite(produits, proportion, globaux) {
        if (!M || !etat.contexte || !(proportion > 0)) return 0;
        var c = etat.contexte;
        var ctxSansStock = {};
        Object.keys(c).forEach(function (k) { ctxSansStock[k] = c[k]; });
        ctxSansStock.varBovin = 0;
        ctxSansStock.varOvin = 0;
        ctxSansStock.boeuf = { matin: 0, soir: 0 };

        var restants = produits.map(function (p) {
            var copie = {};
            Object.keys(p).forEach(function (k) { copie[k] = p[k]; });
            copie.quantite = nb(p.quantite) * proportion;
            copie.ca = nb(p.ca) * proportion;
            return copie;
        });
        var base = { charges: 0, dep: 0, com: c.commissionPct,
            parBov: nb(c.parageBovin), parOvi: nb(c.parageOvin), dPa: 0 };
        var sc = { leviers: {}, globaux: Object.assign({}, base, globaux) };
        return M.effetsGlobaux({ produits: restants, contexte: ctxSansStock }, sc).total;
    }

    /**
     * L'ASSIETTE de la commission pour un produit: son prix de vente au
     * catalogue fournisseur.
     *
     * Son propre prix d'abord, la carcasse de son espece ensuite, rien du
     * tout en dernier. L'ancienne regle disait « bovin, sinon ovin, sinon
     * VOLAILLE » - un `else` qui rangeait d'office dans le poulet tout ce
     * qu'elle ne reconnaissait pas. Le Laxass, vendu 200 F, se voyait ainsi
     * commissionne sur les 3 500 F de la carcasse de poulet: 105 F l'unite,
     * de quoi le faire ressortir a -62 F de marge nette quand il en gagne 43.
     * Un produit declare a perte, c'est un produit qu'on arrete.
     *
     * Les noms de decoupe (« Boeuf en detail ») n'ont pas de ligne au
     * catalogue: c'est la carcasse qui porte le prix, d'ou le repli par
     * espece. Les produits qui ont leur PROPRE ligne - Laxass, Foie, Cuisse
     * de poulet - sont desormais servis par elle.
     */
    function prixCatalogueDe(p) {
        var c = etat.contexte || {};
        var pv = c.pv || {};
        var propre = (pv.par_produit || {})[M.normaliserNom(p && p.nom)];
        if (nb(propre) > 0) return nb(propre);
        if (M.estBoeuf(p)) return pv.bovin;
        if (M.estOvin(p)) return pv.ovin;
        if (M.estVolaille(p)) return pv.volaille;
        return null;
    }

    /**
     * Les produits ABSENTS du catalogue fournisseur.
     *
     * Leur marge nette vaut leur marge brute, et c'est EXACT: un produit hors
     * catalogue ne genere aucune commission. routes/finance-creances.js le
     * tranche a la source - `if (!prix) continue;` - et ne facture rien.
     *
     * A NE PAS CONFONDRE avec la regle de lib/valorisation-stock.js, ou un
     * prix d'ACHAT manquant fait retomber sur le prix de vente: la, il faut
     * bien valoriser des kilos qui existent, donc une approximation vaut mieux
     * qu'un zero. Ici la commission n'est pas inconnue, elle est NULLE -
     * substituer le prix de vente inventerait une facture que MaaS n'emet pas.
     *
     * On les nomme quand meme, comme le stock nomme les siens: lire « marge
     * nette » sans savoir qu'aucune commission n'a ete deduite laisse croire
     * a une comparaison a armes egales avec les produits qui, eux, en portent.
     */
    function produitsHorsCatalogue(univers) {
        var vus = {};
        var out = [];
        (univers || []).forEach(function (p) {
            if (p.sans_vente) return;
            if (prixCatalogueDe(p)) return;
            var n = String(p.nom || '');
            if (vus[n]) return;
            vus[n] = true;
            out.push(n);
        });
        return out;
    }

    /** Le bandeau qui NOMME les produits sans commission, ou rien. */
    function noteHorsCatalogue(univers) {
        var noms = produitsHorsCatalogue(univers);
        if (!noms.length) return '';
        return '<div class="small text-muted mb-2">'
            + '<i class="bi bi-info-circle"></i> '
            + noms.map(esc).join(', ')
            + (noms.length > 1 ? ' sont absents' : ' est absent')
            + ' du catalogue fournisseur : aucune commission n\'est facturée sur '
            + (noms.length > 1 ? 'leurs livraisons' : 'ses livraisons')
            + (noms.length > 1 ? ', leur marge nette vaut donc leur marge brute'
                               : ', sa marge nette vaut donc sa marge brute')
            + '. Ce n\'est pas une estimation manquante — c\'est zéro.</div>';
    }

    function margeApresCommission(p) {
        var m = margeBase(p);
        if (m === null) return null;
        var c = etat.contexte || {};
        var pv = c.pv || {};
        var taux = nb(c.commissionPct) / 100;
        if (!taux) return m;
        var prixCatalogue = prixCatalogueDe(p);
        // Prix catalogue inconnu: on rend la marge BRUTE de parage plutot que
        // d'inventer un cout. C'est la regle deja suivie ailleurs pour les
        // prix manquants, et l'ecran signale cette part non chiffree.
        if (!prixCatalogue) return m;
        // Meme diviseur de parage que la marge elle-meme: le taux MESURE de
        // l'espece, pas le parametre. Deux diviseurs differents dans le meme
        // ecran feraient diverger la marge et la commission qu'elle induit.
        var parage = M.estBoeuf(p) ? nb(c.parageBovin)
            : (M.estOvin(p) ? nb(c.parageOvin) : 0);
        var d = 1 - parage / 100;
        if (!(d > 0)) return m;
        return m - taux * nb(prixCatalogue) / d;
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

        // La selection vit dans l'ETAT, pas dans le DOM. rendre() reconstruit
        // innerHTML: toute case cochee etait perdue des qu'un autre controle
        // declenchait un rendu, et « Enregistrer » confirmait alors un
        // enregistrement VIDE sans que rien ne le dise.
        if (!etat.proj.suivis) {
            etat.proj.suivis = {};
            ajoutes.forEach(function (n) { etat.proj.suivis[String(n).trim().toLowerCase()] = true; });
        }
        var choisis = etat.proj.suivis;

        // RECLASSEMENT EN MARGE NETTE DE PARAGE. Le serveur classe sur la
        // marge brute, faute de contexte de parage; l'ecran, lui, l'a. Un
        // produit a +50 F bruts peut sortir a -137 F nets: le proposer comme
        // gisement de marge ferait ajouter au plan un produit qui le creuse.
        cand = cand.map(function (c) {
            var nette = margeApresCommission({
                nom: c.nom, prix_moyen: c.prix_moyen, prix_achat: c.prix_achat
            });
            return Object.assign({}, c, { marge_nette: nette });
        }).filter(function (c) {
            // Marge nette inconnue: on garde et on le dit, plutot que de
            // masquer un produit dont le cout existe.
            return c.marge_nette === null || c.marge_nette > 0;
        }).sort(function (a, b) {
            return (b.marge_nette === null ? -Infinity : b.marge_nette)
                - (a.marge_nette === null ? -Infinity : a.marge_nette);
        });

        // Les produits ajoutes mais ABSENTS des candidats du mois (ils n'ont
        // rien vendu, ou leur cout a disparu) doivent rester cochables: sans
        // eux dans la liste, enregistrer les retirerait en silence.
        var connus = {};
        cand.forEach(function (c) { connus[String(c.nom).trim().toLowerCase()] = true; });
        var lignes = cand.slice();
        ajoutes.forEach(function (n) {
            if (!connus[String(n).trim().toLowerCase()]) {
                lignes.push({ nom: n, marge_nette: null, quantite: null, ca: null, absent: true });
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
            + '<th>Suivi</th><th>Produit</th><th class="text-end">Marge nette</th>'
            + '<th class="text-end">Vendu</th><th class="text-end">CA</th>'
            + '</tr></thead><tbody>'
            + lignes.map(function (c) {
                var coche = choisis[String(c.nom).trim().toLowerCase()] ? ' checked' : '';
                return '<tr><td><input type="checkbox" class="sim2-suivi" value="'
                    + esc(c.nom) + '"' + coche + '></td>'
                    + '<td>' + esc(c.nom)
                    + (c.absent ? ' <span class="badge bg-light text-dark border">aucune vente ce mois-ci</span>' : '')
                    + '</td>'
                    + '<td class="text-end">'
                    + (c.marge_nette === null || c.marge_nette === undefined
                        ? '—' : esc(fmt(c.marge_nette)) + ' F/u')
                    + '</td>'
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

    /**
     * Enregistre - ou efface - la calibration du coefficient P1/P2.
     *
     * Le client envoie la VALEUR et la FENETRE sur laquelle il l'a calculee.
     * Il n'envoie ni l'auteur ni la date: la route les pose elle-meme depuis
     * la session, faute de quoi n'importe qui pourrait signer une calibration
     * au nom d'un autre, ou l'antidater - et la signature ne vaudrait rien.
     *
     * @param {number|null} valeur  null = effacer, retour au calcul en direct
     */
    function enregistrerCalibration(valeur, bouton) {
        var pj = (etat.sim && etat.sim.projection) || {};
        var hi = pj.historique || {};
        var sansDim = etat.proj.exclureDimanche;
        var corps = valeur === null ? { coeffP1P2: null } : {
            coeffP1P2: {
                valeur: valeur,
                fenetre: (hi.debut || '?') + ' → ' + (hi.fin || '?'),
                // Les jours REELLEMENT mesures, pas les jours du calendrier.
                // calibrerCoeff() moyenne sur joursOuvres(..., exclureDimanche):
                // annoncer 92 quand la mesure porte sur 79 decrit un autre
                // echantillon que celui qui a produit le coefficient.
                jours: (hi.debut && hi.fin) ? PJ.joursOuvres(hi.debut, hi.fin, sansDim).length : null,
                // Le reglage sous lequel la mesure a ete faite. Sans lui, deux
                // calibrations menees avec des reglages opposes s'enregistrent
                // sous des signatures indiscernables, et l'alerte de derive
                // compare deux nombres qui ne mesurent pas la meme chose.
                dimanches: sansDim ? 'exclus' : 'comptes'
            }
        };
        var libelle = bouton ? bouton.innerHTML : '';
        if (bouton) { bouton.disabled = true; bouton.textContent = 'Enregistrement…'; }
        fetch('/api/simulation-v2/reglages', {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corps)
        }).then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (j) {
                if (!j || !j.success) {
                    if (bouton) { bouton.disabled = false; bouton.innerHTML = libelle; }
                    if (typeof showToast === 'function') {
                        showToast((j && j.error) || 'Calibration refusée', 'danger');
                    }
                    return;
                }
                // Le serveur rend la calibration telle qu'il l'a ecrite,
                // signature comprise: on la pose dans l'etat et on re-rend,
                // plutot que de recharger toute la simulation pour un nombre.
                // La saisie manuelle est levee, sans quoi elle continuerait de
                // masquer la valeur qu'on vient justement d'enregistrer.
                if (etat.sim && etat.sim.projection) {
                    etat.sim.projection.coeff_enregistre = (j.data && j.data.coeff_p1_p2) || null;
                }
                etat.proj.coeff = null;
                if (typeof showToast === 'function') {
                    showToast(valeur === null
                        ? 'Calibration effacée : coefficient recalculé en direct.'
                        : 'Coefficient calibré à ' + valeur.toFixed(3) + ' et enregistré.', 'success');
                }
                rendre();
            })
            .catch(function (e) {
                if (bouton) { bouton.disabled = false; bouton.innerHTML = libelle; }
                if (typeof showToast === 'function') showToast('Erreur : ' + e.message, 'danger');
            });
    }

    function enregistrerProduitsSuivis() {
        var noms = [];
        document.querySelectorAll('.sim2-suivi').forEach(function (el) {
            if (el.checked) noms.push(el.value);
        });
        var msg = document.getElementById('sim2-suivi-msg');
        // Refus explicite d'un enregistrement qui VIDERAIT la liste sans que
        // ce soit demande. Vider reste possible - il faut decocher, ce que la
        // presence de cases cochees rend visible - mais un panneau qui n'a
        // rendu aucune case ne doit pas pouvoir effacer un reglage.
        if (!noms.length && !document.querySelectorAll('.sim2-suivi').length) {
            if (msg) msg.innerHTML = '<span class="text-danger">Aucune case affichée : '
                + 'rien n\'a été enregistré.</span>';
            return;
        }
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

    /**
     * L'enveloppe: une section a part, visible et repliable.
     *
     * La projection etait un simple sous-titre noye entre la matrice et le
     * debug, alors que c'est la partie qu'on vient consulter. Elle a
     * desormais son propre encadre, avec le CA projete et le PL central
     * lisibles depuis l'entete meme quand le contenu est replie.
     */
    function projection() {
        var corps = projectionCorps();
        if (!corps) return '';
        var resume = etat.projResume || '';
        // PLUS DE REPLI. C'est desormais une VUE, atteinte par son bouton:
        // pouvoir la replier n'offrait qu'un ecran vide sous une bascule qui
        // annonce « Projection fin de mois ». Le resume reste en entete, il
        // portait deja les chiffres cles.
        return carteAnalyseProjection()
            + '<div class="card border-primary mb-3" id="sim2-proj-section">'
            + '<div class="card-header bg-primary bg-opacity-10 fw-medium">'
            + '<i class="bi bi-calendar-check me-1"></i> Projection fin de mois'
            + (resume ? '<span class="small text-muted ms-2">' + resume + '</span>' : '')
            + '</div>'
            + '<div class="card-body py-3">' + corps + '</div>'
            + '</div>';
    }

    /**
     * L'ANALYSE IA de la projection, rendue AU-DESSUS de la carte.
     *
     * Le texte vit dans etat.analyseIA, pas dans le DOM: chaque frappe de
     * levier reconstruit corps.innerHTML, et une carte posee a la main
     * disparaitrait au premier rendu. Marquee perimee (pas effacee) quand la
     * projection a ete recalculee depuis: un commentaire d'hier sur les
     * chiffres d'aujourd'hui, ca se signale.
     */
    function carteAnalyseProjection() {
        var a = etat.analyseIA;
        if (!a) return '';
        if (a.enCours) {
            return '<div class="alert alert-light border small mb-3">'
                + '<i class="bi bi-hourglass-split"></i> '
                + (a.niveau === 'approfondie'
                    ? 'Analyse approfondie en cours — le modèle raisonne, comptez 15 à 30 s…'
                    : 'Analyse en cours…') + '</div>';
        }
        if (a.erreur) {
            return '<div class="alert alert-warning py-2 small mb-3">'
                + '<i class="bi bi-robot"></i> ' + esc(a.erreur) + '</div>';
        }
        var perimee = a.pourResume && etat.projResume && a.pourResume !== etat.projResume;
        return '<div class="card border-secondary mb-3">'
            + '<div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">'
            + '<span class="fw-medium small"><i class="bi bi-robot me-1"></i>Analyse IA de la projection'
            + (a.niveau === 'approfondie' ? ' <span class="badge bg-secondary">approfondie</span>' : '')
            + (perimee ? ' <span class="badge bg-warning text-dark">calculée avant vos derniers réglages</span>' : '')
            + '</span>'
            + '<span class="small text-muted">'
            + (a.cache ? 'déjà calculée à l’instant · servie du cache' : '') + '</span></div>'
            + '<div class="card-body py-2 small" style="white-space:pre-wrap">' + esc(a.texte || '') + '</div>'
            + '<div class="card-footer bg-transparent py-1 small text-muted">'
            + 'Généré par un modèle de langage à partir de la projection affichée : '
            + 'relecture, pas source de vérité. Les montants font foi dans la carte.'
            + '</div></div>';
    }

    function analyserProjection(niveau) {
        // BASCULER ET RENDRE **AVANT** de construire le payload.
        //
        // projCalculee est pose par le rendu de la vue projection - et remis a
        // null par ses gardes. Construire le payload d'abord, depuis la vue
        // Scenario, envoyait au modele la projection du DERNIER rendu: des
        // dates changees entre-temps donnaient une analyse d'une autre
        // periode que celle affichee.
        etat.vue = 'projection';
        etat.analyseIA = { enCours: true, niveau: niveau };
        rendre();
        var payload = construirePayloadProjection();
        if (!payload) {
            etat.analyseIA = null;
            rendre();
            if (typeof window.showToast === 'function') {
                window.showToast('Calcule la projection avant de l’analyser.', 'warning');
            }
            return;
        }
        // Les DEUX declencheurs verrouilles pendant l'appel: l'item
        // « approfondie » restait cliquable pendant une analyse standard, et
        // chaque clic partait en requete OpenAI concurrente - payante. Ils
        // vivent dans la barre d'outils, que rendre() ne reconstruit pas: les
        // references restent valides pendant tout l'appel.
        var verrous = [document.getElementById('sim2-analyse'),
            document.getElementById('sim2-analyse-approfondie')].filter(Boolean);
        var verrouiller = function (on) {
            verrous.forEach(function (el) {
                el.classList.toggle('disabled', on);
                if ('disabled' in el) el.disabled = on;
            });
        };
        verrouiller(true);
        fetch('/api/finance/analyse-ia', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'projection', payload: payload,
                niveau: niveau || 'standard' })
        }).then(function (r) { return r.json().catch(function () { return null; }); })
            .then(function (j) {
                etat.analyseIA = (j && j.success && j.data)
                    ? { texte: j.data.analyse, cache: j.data.cache, niveau: niveau,
                        pourResume: etat.projResume }
                    : { erreur: (j && j.error) || 'analyse indisponible' };
                verrouiller(false);
                rendre();
            })
            .catch(function (e) {
                etat.analyseIA = { erreur: e.message };
                verrouiller(false);
                rendre();
            });
    }

    /**
     * '2026-08-13T09:12:00Z' -> '13/08/2026'.
     *
     * Delegue a lib/dates-fr.js, servi au navigateur par index.html: une
     * quatrieme conversion de date locale a ce depot serait un quatrieme
     * endroit ou les formats pourraient diverger.
     */
    function dateCourte(iso) {
        var s = String(iso || '');
        var r = window.datesFr ? window.datesFr.enFrancais(s) : s;
        return r === s && !/^\d{4}-\d{2}-\d{2}/.test(s) ? '' : r;
    }

    /**
     * Le bouton de calibration, reserve a l'administrateur.
     *
     * Pourquoi un BOUTON alors que le coefficient se calcule deja tout seul:
     * parce qu'il se calculait tout seul DANS CHAQUE NAVIGATEUR, sur une
     * fenetre glissante de trois mois. Personne ne decidait rien, personne ne
     * signait rien, et la valeur changeait sans qu'aucun ecran ne le dise.
     * Calibrer devient un acte: date, auteur, fenetre.
     *
     * Reserve a l'administrateur parce que la valeur enregistree s'applique a
     * TOUT LE TENANT - c'est le meme regime que les produits suivis juste en
     * dessous, et la route PUT /api/simulation-v2/reglages refait le controle.
     */
    function boutonCalibrer(calibre, enr, sansDim) {
        var u = window.currentUser || {};
        if (String(u.role || '').toLowerCase() !== 'admin') return '';

        var h = '<div class="mt-1 d-flex gap-1 align-items-center flex-wrap">';
        if (calibre === null) {
            // Moins de 28 jours d'historique, ou un rythme P2 nul: calibrerCoeff
            // rend null plutot que de diviser par du vide. Le dire, plutot que
            // d'offrir un bouton qui echouerait.
            h += '<button type="button" class="btn btn-sm btn-outline-secondary" disabled '
                + 'title="Historique insuffisant pour calibrer (moins de 28 jours, ou aucune vente en P2).">'
                + '<i class="bi bi-sliders"></i> Recalibrer</button>';
        } else {
            h += '<button type="button" class="btn btn-sm btn-outline-primary" id="sim2-calibrer" '
                + 'data-valeur="' + calibre.toFixed(6) + '" '
                + 'title="Calcule le coefficient sur les 3 derniers mois et l\'enregistre pour tout le point de vente.">'
                + '<i class="bi bi-sliders"></i> Recalibrer (' + calibre.toFixed(3) + ')</button>';
        }
        h += '<span class="badge bg-secondary">admin</span>';
        if (enr) {
            h += '<button type="button" class="btn btn-sm btn-outline-secondary" id="sim2-calibrer-effacer" '
                + 'title="Supprime la calibration enregistrée : le coefficient repasse au calcul en direct.">'
                + 'Effacer</button>';
        }
        h += '</div>';

        // DERIVE. Une calibration enregistree ne se met pas a jour toute seule
        // - c'est tout son interet - mais si la fenetre a bouge au point que
        // le calcul en direct s'en ecarte, il faut le VOIR, sinon on garde des
        // mois durant un coefficient qui ne decrit plus rien.
        //
        // Encore faut-il comparer deux mesures COMPARABLES. Le calcul en
        // direct suit la case « Exclure les dimanches » de l'ecran; la valeur
        // enregistree porte le reglage sous lequel elle a ete faite. Les
        // opposer sans le verifier faisait crier a la derive des qu'on
        // touchait a la case, alors que rien n'avait bouge.
        if (enr && calibre !== null) {
            var memeReglage = !enr.dimanches
                || enr.dimanches === (sansDim ? 'exclus' : 'comptes');
            if (!memeReglage) {
                h += '<div class="form-text text-muted">'
                    + 'calibrée dimanches ' + esc(enr.dimanches)
                    + ' : non comparable au calcul en direct tant que la case ci-dessous diffère.'
                    + '</div>';
            } else {
                var ecart = Math.abs(calibre - nb(enr.valeur)) / Math.max(0.001, Math.abs(nb(enr.valeur)));
                if (ecart > 0.02) {
                    h += '<div class="form-text text-warning-emphasis">'
                        + 'le calcul en direct donne aujourd\'hui ' + calibre.toFixed(3)
                        + ', soit ' + (ecart * 100).toFixed(0) + ' % d\'écart avec la valeur enregistrée.'
                        + '</div>';
                }
            }
        }
        return h;
    }

    /**
     * Ce que la ponderation fait, avec les nombres du mois sous les yeux.
     *
     * Une regle expliquee dans l'abstrait ne se verifie pas. Le tableau montre
     * les deux sources, le resultat, et la phrase qui les relie: on peut y
     * refaire le calcul de tete et constater que le chiffre projete en
     * decoule.
     */
    function explicationPonderation(rythmes, poidsReel, minJours, coeff, pj) {
        var r = rythmes || {};
        var reel = r.reel || { jours: {} };
        var histo = r.histo || {};
        var pct = Math.round(nb(poidsReel) * 100);

        var ligne = function (t, libelle) {
            return '<tr><td>' + libelle + '</td>'
                + '<td class="text-end">' + esc(fmt(reel[t])) + ' F/j'
                + '<span class="text-muted small"> · ' + ((reel.jours || {})[t] || 0) + ' j</span></td>'
                + '<td class="text-end">' + esc(fmt(histo[t])) + ' F/j</td>'
                + '<td class="text-end fw-medium">' + esc(fmt(r[t])) + ' F/j</td>'
                + '<td class="small text-muted">' + esc((r.sources || {})[t] || '—') + '</td></tr>';
        };

        var hi = pj && pj.historique ? pj.historique : {};
        return '<details class="mb-2"><summary class="small fw-medium">'
            + '<i class="bi bi-question-circle"></i> D\'où vient le rythme projeté — pondération et coefficient'
            + '</summary><div class="border rounded p-2 mt-1 small">'

            + '<p class="mb-2">Projeter les jours qui restent demande un <strong>rythme journalier</strong> : '
            + 'ce qu\'une journée rapporte en moyenne. Deux sources le donnent, et aucune ne suffit seule.</p>'
            + '<ul class="mb-2">'
            + '<li><strong>Le réel</strong> — la moyenne des jours déjà écoulés ce mois-ci. Il porte ce que '
            + 'l\'historique ignore : un prix qui a changé, un gros client parti. Mais sur une dizaine de jours, '
            + 'une seule grosse commande le déforme.</li>'
            + '<li><strong>L\'historique</strong> — la même moyenne sur les 3 mois précédents'
            + (hi.debut ? ' (' + esc(dateCourte(hi.debut)) + ' → ' + esc(dateCourte(hi.fin)) + ')' : '')
            + '. Il est stable, mais aveugle à ce qui a changé ce mois-ci.</li>'
            + '</ul>'
            + '<p class="mb-2">La <strong>pondération</strong> dit combien on accorde à chacune : '
            + '<code>rythme = ' + pct + ' % × réel + ' + (100 - pct) + ' % × historique</code>. '
            + 'Le mélange n\'a lieu qu\'à partir de <strong>' + minJours + ' jours observés</strong> dans la période ; '
            + 'en dessous, l\'historique seul — deux jours ne font pas une moyenne.</p>'

            + '<p class="mb-2">Deux rythmes séparés, parce que le mois n\'est pas homogène : '
            + '<strong>P1</strong> = jours 1 à 10 et 25 à la fin (autour des paies, on vend plus), '
            + '<strong>P2</strong> = jours 11 à 24. Le <strong>coefficient P1/P2</strong> ('
            + coeff.toFixed(3) + ') mesure de combien P1 dépasse P2 ; il ne sert qu\'en dernier recours, '
            + 'pour déduire une période de l\'autre quand l\'une n\'a aucune donnée.</p>'

            + '<div class="table-responsive"><table class="table table-sm table-bordered mb-0">'
            + '<thead><tr><th>Période</th><th class="text-end">Réel ce mois</th>'
            + '<th class="text-end">Historique</th><th class="text-end">Retenu</th><th>Source</th></tr></thead>'
            + '<tbody>' + ligne('P1', 'P1 · jours 1-10 et 25-fin') + ligne('P2', 'P2 · jours 11-24')
            + '</tbody></table></div>'
            + '<div class="text-muted mt-1">Les dimanches sont '
            + (etat.proj.exclureDimanche ? 'exclus' : 'comptés')
            + ' des deux moyennes, comme du décompte des jours restants.</div>'
            + '</div></details>';
    }

    // LA COUCHE CALCULEE de la projection, capturee au fil du rendu pour
    // l'export JSON.
    //
    // On MEMORISE ce que l'ecran vient d'afficher plutot que de le recalculer
    // a l'export: refaire les appels en donnerait une seconde lecture, libre
    // de diverger de celle qu'on regarde. Et on exporte cette couche-la, pas
    // `etat.sim` brut - le payload serveur porte des champs internes sans
    // interet, et n'a pas la structure des scenarios ni du plan.
    var projCalculee = null;

    function projectionCorps() {
        // REMIS A ZERO D'ABORD, avant tout retour anticipe.
        //
        // Il n'etait renseigne qu'apres les gardes (periode invalide, plus
        // aucun jour d'ouverture). Un rendu qui sortait par l'une d'elles
        // laissait donc en place la projection du rendu PRECEDENT, et
        // l'export JSON l'aurait telechargee comme si elle etait courante.
        projCalculee = null;
        if (!PJ || !etat.sim || !etat.sim.projection || !etat.base) return '';
        var pj = etat.sim.projection;
        var b = etat.base;
        var debut = b.periode.dateDebut || '';
        var fin = b.periode.dateFin || '';
        var h = '';
        etat.projResume = '';
        if (!/^\d{4}-\d{2}-01$/.test(debut) || fin.slice(0, 7) !== debut.slice(0, 7)) {
            return '<div class="alert alert-secondary py-2 small mb-0">Projection disponible '
                + 'sur une période du 1er du mois au jour d\'analyse.</div>';
        }

        var sansDim = etat.proj.exclureDimanche;
        var calibre = PJ.calibrerCoeff(pj.historique, sansDim);

        // ORDRE DE PRIORITE du coefficient, du plus explicite au plus general:
        // la saisie a la main, puis la calibration ENREGISTREE par un
        // administrateur, puis le calcul en direct, puis la reference du
        // document. Chaque cran est un choix plus delibere que le suivant.
        //
        // La calibration enregistree passe devant le calcul en direct parce
        // que ce dernier repose sur une fenetre de trois mois qui GLISSE: sans
        // elle, le coefficient bougeait tout seul d'un jour a l'autre, sans
        // date ni auteur, et deux personnes comparant leurs projections a une
        // semaine d'ecart ne pouvaient pas savoir laquelle avait raison.
        var enr = (pj.coeff_enregistre && isFinite(parseFloat(pj.coeff_enregistre.valeur)))
            ? pj.coeff_enregistre : null;
        var coeff, origineCoeff;
        if (etat.proj.coeff !== null) {
            coeff = etat.proj.coeff;
            origineCoeff = 'ajusté à la main';
        } else if (enr) {
            coeff = nb(enr.valeur);
            origineCoeff = 'calibration enregistrée'
                + (enr.le ? ' le ' + dateCourte(enr.le) : '')
                + (enr.par ? ' par ' + enr.par : '');
        } else if (calibre !== null) {
            coeff = calibre;
            origineCoeff = 'calibré en direct sur vos 3 derniers mois';
        } else {
            coeff = nb(pj.coeff_defaut);
            origineCoeff = 'référence du document';
        }

        var ca = PJ.projeterCA({
            caParJour: pj.ca_par_jour, debutMois: debut, dateAnalyse: fin,
            histo: pj.historique, coeff: coeff,
            poidsReel: etat.proj.poidsReel, minJours: etat.proj.minJours,
            exclureDimanche: sansDim
        });
        if (ca.restants.P1 === 0 && ca.restants.P2 === 0) {
            // Il reste peut-etre des jours CALENDAIRES, tous fermes. Le dire,
            // et laisser la case a portee de main: sortir ici en la laissant
            // dans le bloc masque enfermait l'utilisateur - le seul reglage
            // capable de reafficher la projection etait invisible.
            var restentCalendaires = PJ.joursOuvres(fin, ca.finMois, false).length - 1;
            return h + '<div class="alert alert-secondary py-2 small mb-0">'
                + (restentCalendaires > 0 && sansDim
                    ? 'Il ne reste que ' + restentCalendaires + ' jour(s) avant la fin du mois, '
                      + 'tous des dimanches : plus rien à projeter à jours d\'ouverture constants. '
                      + '<label class="ms-1"><input type="checkbox" class="sim2-proj-ctl" '
                      + 'data-k="exclureDimanche" checked> Exclure les dimanches</label>'
                    : 'Mois complet : rien à projeter.')
                + '</div>';
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
        //
        // Au moins UN jour ecoule: quand le 1er du mois tombe un dimanche et
        // que l'analyse porte sur cette seule journee, le compte tombait a 0.
        // Le module retombait alors sur un facteur 1 pendant que l'ecran
        // affichait « × 24 » (jours.mois / max(1, 0)): le facteur montre
        // n'etait pas celui applique.
        var jours = {
            ecoules: Math.max(1, PJ.joursOuvres(debut, fin, sansDim).length),
            mois: PJ.joursOuvres(debut, ca.finMois, sansDim).length
        };
        // L'UNIVERS DES PRODUITS, aux prix de la suite (vente ET achat).
        //
        // Remonte ici: le taux de marge courant ci-dessous en a besoin, et il
        // alimente les scenarios - donc tout ce qui suit. Il vivait 70 lignes
        // plus bas, ou seuls les volumes et les sensibilites le lisaient.
        var univSens = ((!b.fige && etat.sim.produits_vendus && etat.sim.produits_vendus.length)
            ? etat.sim.produits_vendus : etat.produits).map(auPrixDeLaSuite);

        // LE TAUX DE MARGE AUX PRIX COURANTS.
        //
        // `taux_marge` du serveur est constate depuis le 1er: il melange les
        // journees ou la carcasse etait a 3 835 F a celles ou elle est a
        // 4 500. Les jours qui RESTENT se paieront au dernier prix connu, et
        // se vendront au dernier tarif constate - c'est ce que ce taux mesure.
        //
        // margeBase et NON margeApresCommission: la commission est deja un
        // poste du PL projete, la compter dans le taux la deduirait deux fois.
        var tauxCourant = PJ.tauxMargeCourant({
            produits: univSens,
            margeDe: margeBase
        });
        // LE CA PROJETE, selon la methode choisie.
        //
        // 'rythmes': l'extrapolation P1/P2 telle quelle - un CA aux prix de
        // la PERIODE, puisque les rythmes moyennent des journees vendues aux
        // anciens tarifs.
        // 'derniers': la meme extrapolation lue comme une proportion de
        // VOLUME, puis revalorisee - CA restant = proportion x
        // Sigma(quantite x dernier prix de vente). C'est la lecture demandee:
        // on connait les quantites qui restent, on les vend au dernier prix.
        // L'identite « Sigma(qte restante x dernier PV) = CA projete - CA
        // realise » devient exacte par construction; le debug la controle.
        var caPlein = PJ.caAuxDerniersPrix(univSens);
        var propVol = (b.ventes > 0 && ca.caProjete !== null)
            ? Math.max(0, (ca.caProjete - b.ventes) / b.ventes) : 0;
        var methodeCA = etat.proj.caMethode === 'rythmes' ? 'rythmes' : 'derniers';
        var caRetenu = ca.caProjete;
        if (methodeCA === 'derniers' && ca.caProjete !== null && caPlein > 0) {
            caRetenu = b.ventes + propVol * caPlein;
        }
        // ---- LA REPARTITION DES RESTES, avec les saisies manuelles.
        //
        // Calculee AVANT les scenarios: c'est elle qui leur fournit la marge
        // des jours restants des qu'une quantite est saisie. Sans saisie,
        // margeRestanteDe rend null et projeterPL retombe sur
        // proportion x marge_totale, a l'identique.
        var surchargesVol = etat.proj.surchargesVolume || {};
        var modeSurcharge = etat.proj.surchargeMode === 'ajout' ? 'ajout' : 'atelier';
        var univParCle = {};
        univSens.forEach(function (pr) { univParCle[cleSurcharge(pr.nom)] = pr; });
        var propDe = function (cible) {
            if (methodeCA === 'derniers' && caPlein > 0) {
                return Math.max(0, (nb(cible) - nb(b.ventes)) / caPlein);
            }
            return b.ventes > 0 ? Math.max(0, (nb(cible) - nb(b.ventes)) / nb(b.ventes)) : 0;
        };
        var repartirA = function (cible) {
            return PJ.repartirRestes({
                produits: univSens, proportion: propDe(cible),
                surcharges: surchargesVol, mode: modeSurcharge, cleDe: cleSurcharge
            });
        };
        var repart = repartirA(caRetenu);
        // La marge de CHAQUE scenario, recalculee a sa propre proportion: la
        // saisie reste ferme, les lignes libres absorbent la variation.
        var margeRestanteDe = !(repart && repart.actif) ? null : function (cible) {
            var r = repartirA(cible);
            return PJ.margeDesRestes(r.lignes, margeBase, univParCle).marge;
        };
        var argsScen = {
            postes: postes, caRealise: b.ventes, caProjete: caRetenu,
            margeRestanteDe: margeRestanteDe,
            chargesMensuel: chargesMensuel, stockOption: etat.proj.stockOption,
            depensesOption: etat.proj.depensesOption, jours: jours,
            tauxCourant: tauxCourant,
            caPleinDerniersPrix: (methodeCA === 'derniers' && caPlein > 0) ? caPlein : null
        };
        var scen = (caRetenu === null) ? null : PJ.scenarios(argsScen);
        projCalculee = {
            genere_le: null, periode: { debut: debut, fin: fin },
            coeff: coeff, origine_coeff: origineCoeff,
            ca: ca, scenarios: scen, jours: jours,
            // La methode de CA et ses termes: sans eux, l'export ne permettait
            // pas de refaire le CA retenu ni de verifier l'identite
            // Sigma(qte restante x dernier PV) = CA projete - CA realise.
            ca_methode: methodeCA,
            ca_plein_derniers_prix: caPlein > 0 ? caPlein : null,
            ca_projete_retenu: caRetenu,
            taux_marge_courant: tauxCourant,
            taux_marge_constate: (etat.plBrut || {}).taux_marge,
            volumes: null, plan_equilibre: null, recommandations: null, confiance: null
        };
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
            + (calibre !== null ? ' · calibré en direct : ' + calibre.toFixed(3) : '')
            + ' · document : ' + nb(pj.coeff_defaut).toFixed(3) + '</div>'
            + boutonCalibrer(calibre, enr, sansDim) + '</div>'
            + '<div class="col-md-3"><label class="form-label small">Pondération réel / historique</label>'
            + '<select class="form-select form-select-sm sim2-proj-ctl" data-k="poidsReel">'
            + '<option value="0.7"' + (etat.proj.poidsReel === 0.7 ? ' selected' : '') + '>70 % réel + 30 % historique</option>'
            + '<option value="0.5"' + (etat.proj.poidsReel === 0.5 ? ' selected' : '') + '>50 / 50</option>'
            + '<option value="1"' + (etat.proj.poidsReel === 1 ? ' selected' : '') + '>100 % réel</option>'
            + '</select>'
            + '<div class="form-text">poids du mois en cours face aux 3 mois précédents</div></div>'
            + '<div class="col-md-3"><label class="form-label small">CA projeté</label>'
            + '<select class="form-select form-select-sm sim2-proj-ctl" data-k="caMethode">'
            + '<option value="derniers"' + (methodeCA === 'derniers' ? ' selected' : '') + '>Volumes × derniers prix</option>'
            + '<option value="rythmes"' + (methodeCA === 'rythmes' ? ' selected' : '') + '>Rythmes P1/P2 (prix de la période)</option>'
            + '</select>'
            + '<div class="form-text">' + (methodeCA === 'derniers'
                ? 'quantités restantes × dernier prix de vente'
                : 'extrapolation seule, prix de la période') + '</div></div>'
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

        h += explicationPonderation(ca.rythmes, etat.proj.poidsReel, etat.proj.minJours, coeff, pj);

        // ---- PARAGE MESURE SUSPECT: le dire AVANT les chiffres qu'il fausse.
        //
        // Le cumul du mois somme des kilos: une seule journee dont le stock
        // du soir manque ou est saisi a zero pese plus lourd que quinze
        // journees saines, et le seuil des 5 journees mesurables ne l'attrape
        // pas. Constate le 19/08/2026 en local: soir du 18 copie a zero,
        // bovin mesure 21,66 % au lieu de 3,90 %, marge du boeuf negative et
        // PL projete effondre - sans un mot a l'ecran. On ne rebascule PAS
        // sur le parametre (une journee soldee a zero est legitime quand tout
        // est vendu): on previent, on nomme la cause probable, et le champ
        // « prix/parage teste » des scenarios permet de forcer la main.
        var ctxP = etat.contexte || {};
        var pmSusp = ctxP.parageMesure || {};
        [['bovin', 'parageBovin', 'bœuf'], ['ovin', 'parageOvin', 'agneau']]
            .forEach(function (e) {
                var applique = nb(ctxP[e[1]]);
                var base = nb(ctxP.parageBase);
                var mesure = pmSusp[e[0]];
                // Suspect: le taux APPLIQUE vient de la mesure, et il vaut au
                // moins le double du parametre avec 5 points d'ecart - le
                // niveau ou la marge d'une carcasse change de signe.
                if (mesure === null || mesure === undefined) return;
                if (nb(mesure) !== applique) return;
                if (!(applique >= 2 * base && applique - base >= 5)) return;
                h += '<div class="alert alert-danger py-2 small mb-2">'
                    + '<strong>Parage ' + e[2] + ' mesuré ' + esc(pct2(applique))
                    + ' %</strong> contre ' + esc(pct2(base)) + ' % de paramètre. '
                    + 'Une journée dont le stock du soir n\u2019est pas encore saisi '
                    + '(ou enregistré à zéro) gonfle la mesure : vérifier le comptage du soir '
                    + 'jusqu\u2019au ' + esc(pmSusp.jusquau || '—') + '. '
                    + 'À ce taux, la marge de la carcasse peut changer de signe — tout le '
                    + 'PL projeté ci-dessous en hérite. Un parage manuel peut être testé '
                    + 'dans les scénarios plus bas.</div>';
            });

        // ---- Le CA projete et ses rythmes, toujours dits.
        h += '<div class="alert alert-light border py-2 small mb-2">'
            + 'CA réalisé au ' + esc(fin) + ' : <strong>' + esc(fmt(ca.caRealise)) + '</strong> F. '
            + 'Restent ' + ca.restants.P1 + ' jours P1 à ' + esc(fmt(ca.rythmes.P1)) + ' F/j ('
            + esc((ca.rythmes.sources || {}).P1 || '—') + ') et '
            + ca.restants.P2 + ' jours P2 à ' + esc(fmt(ca.rythmes.P2)) + ' F/j ('
            + esc((ca.rythmes.sources || {}).P2 || '—') + '). '
            + 'CA estimé fin de mois : <strong>' + esc(fmt(caRetenu)) + '</strong> F'
            + (methodeCA === 'derniers' && caRetenu !== ca.caProjete
                ? ' <span class="text-muted">(volumes × derniers prix · rythmes seuls : '
                    + esc(fmt(ca.caProjete)) + ' F)</span>'
                : '')
            + '.</div>';

        var propSuite = b.ventes > 0 ? (ca.caProjete - b.ventes) / b.ventes : 0;

        // ---- CE QUE LA PROJECTION SUPPOSE EN MARCHANDISE.
        //
        // Le CA projete ne dit pas combien de KILOS il faudra vendre. C'est
        // pourtant ce chiffre-la qui se commande: une projection a 5,4 M F ne
        // se prepare pas, 250 kg de boeuf si.
        //
        // Chaque produit garde sa PART du melange: on n'a aucune raison de
        // croire que le gros progresserait plus vite que le detail d'ici la
        // fin du mois. C'est deja l'hypothese que porte effetSurLaSuite, et en
        // prendre une autre ici ferait diverger deux lectures du meme mois.
        var bovinsVol = univSens.filter(function (p) { return M.estBoeuf(p); });
        // Les bovins ENCORE INVENDUS ce mois-ci sont hors tableau: on ne sait
        // pas extrapoler un rythme depuis zero. L'ecran le NOMME plus bas
        // plutot que de les escamoter - il le fait deja pour les produits hors
        // catalogue, et une ligne absente en silence se lit comme une ligne
        // qui n'existe pas.
        var bovinsMuets = bovinsVol.filter(function (p) { return !(nb(p.quantite) > 0); });
        var bovinsActifs = bovinsVol.filter(function (p) { return nb(p.quantite) > 0; });
        if (projCalculee) projCalculee.confiance = conf;
        // Les restes REELS, saisie comprise: sans eux, le delta d'equilibre et
        // le prix conseille d'une ligne se calculaient sur un volume different
        // de celui affiche juste a cote, et la ligne de total ne sommait plus
        // sa colonne.
        // LES CONTROLES DE SAISIE VIVENT HORS DU TABLEAU.
        //
        // Ils etaient rendus DANS `if (vp)`. Or volumesProjetes rend null des
        // qu'aucun bovin n'a vendu ou que la proportion est nulle (fin de mois,
        // plus de jours ouvres): le bloc disparaissait alors que les surcharges
        // CONTINUAIENT d'agir sur le PL via margeRestanteDe. Plus de bouton
        // pour les effacer, plus de selecteur de mode, et pas un mot pour dire
        // qu'elles etaient encore actives. On les sort donc du tableau, et on
        // les affiche meme sans tableau des que quelque chose est saisi.
        var htmlSurcharge = '<div class="small mb-2">'
            + '<label class="me-2">Une quantité saisie</label>'
            + '<select class="form-select form-select-sm sim2-proj-ctl d-inline-block" '
            + 'data-k="surchargeMode" style="width:auto">'
            + '<option value="atelier"' + (modeSurcharge === 'atelier' ? ' selected' : '') + '>'
            + 'redistribue à CA projeté constant</option>'
            + '<option value="ajout"' + (modeSurcharge === 'ajout' ? ' selected' : '') + '>'
            + 's\'ajoute au CA projeté</option></select>'
            + (repart && repart.actif
                ? ' <span class="badge bg-warning text-dark ms-1">'
                  + repart.totaux.nb_saisies + ' saisie'
                  + (repart.totaux.nb_saisies > 1 ? 's' : '') + '</span>'
                  + ' <button type="button" class="btn btn-sm btn-outline-secondary ms-1" '
                  + 'id="sim2-surcharge-reset">Tout effacer</button>'
                  + (repart.facteur !== null
                    ? ' <span class="text-muted ms-1">les autres lignes × '
                      + esc(nb(repart.facteur).toFixed(3)) + '</span>'
                    : '')
                : '')
            + (repart && repart.sature
                ? '<div class="text-danger mt-1">Les quantités saisies dépassent à elles '
                  + 'seules le CA projeté : les autres lignes tombent à zéro et le total '
                  + 'dépasse la projection. Passez en « s\'ajoute » si c\'est bien une '
                  + 'commande en plus.</div>'
                : '')
            + '</div>';

        var restesReels = {};
        if (repart) repart.lignes.forEach(function (l) { restesReels[l.cle] = l.reste; });
        var vp = PJ.volumesProjetes({
            produits: bovinsActifs,
            proportion: propSuite,
            restes: restesReels,
            cleDe: cleSurcharge,
            margeDe: margeApresCommission,
            // Un PL INCONNU se transmet tel quel. nb() l'aurait converti en
            // zero, et volumesProjetes aurait alors chiffre un ecart vers la
            // cible depuis un equilibre suppose, au lieu de rendre la raison
            // 'sans_pl'. projeterPL declare pl nullable (pl = marge === null
            // ? null : ...) et margeNette s'en garde deja: on tient le meme
            // contrat plutot que d'aplatir le cas ici.
            plCentral: (scen && scen.central
                && scen.central.pl !== null && scen.central.pl !== undefined)
                ? nb(scen.central.pl) : null,
            cible: nb(etat.proj.plCible)
        });
        if (projCalculee) projCalculee.volumes = vp;
        if (vp) {
            // Un delta EXACTEMENT nul n'est pas un coussin: il dit que le mois
            // finit pile a zero. Il garde donc sa couleur neutre, la ou un
            // negatif est vert (on peut vendre moins) et un positif rouge.
            var cellDelta = function (v) {
                if (v === null) return '<td class="text-end">—</td>';
                var cls = v > 0 ? 'text-danger' : (v < 0 ? 'text-success' : 'text-muted');
                return '<td class="text-end fw-bold ' + cls + '">'
                    + (v > 0 ? '+' : '') + esc(fmtDec(v)) + '</td>';
            };
            // La colonne « Reste a vendre » devient SAISISSABLE. Le placeholder
            // porte la valeur du mix: champ vide = hypothese de mix, et le
            // lecteur voit ce qu'il remplacerait avant de taper.
            var repParCle = {};
            if (repart) repart.lignes.forEach(function (l) { repParCle[l.cle] = l; });
            var volLignes = vp.lignes.map(function (l) {
                var cle = cleSurcharge(l.nom);
                var rl = repParCle[cle];
                var saisi = rl && rl.source === 'saisie';
                // vp porte DEJA le reste reel (il recoit `restes`): le relire
                // depuis la repartition en ferait une seconde source, libre de
                // diverger de la colonne Total mois et de la ligne de total.
                var effectif = l.reste;
                return '<tr' + (saisi ? ' class="table-warning"' : '') + '><td>' + esc(l.nom) + '</td>'
                    + '<td class="text-end text-muted">' + esc(fmtDec(l.vendu)) + '</td>'
                    + '<td class="text-end"><input type="number" '
                    + 'class="form-control form-control-sm text-end sim2-surcharge" '
                    + 'style="width:7.5rem;display:inline-block" min="0" step="1" '
                    + 'data-cle="' + esc(cle) + '" '
                    + 'title="Quantité qui reste à vendre. Vide = hypothèse de mix."'
                    // Le placeholder porte le reste EFFECTIF de la ligne, pas
                    // celui du mix: c'est ce qu'on obtient en laissant le champ
                    // vide. Avec une saisie ailleurs, la redistribution a deja
                    // deplace cette ligne, et afficher le mix montrait un
                    // nombre grise qui n'etait pas celui du calcul.
                    // Point DECIMAL, pas la virgule de fmtDec: le champ est un
                    // input type=number, il refuse la virgule. Recopier le
                    // format propose rendait une valeur vide, et le
                    // gestionnaire supprimait alors la surcharge au lieu de
                    // l'enregistrer - l'inverse de l'intention.
                    + ' placeholder="' + esc(String(Math.round(nb(l.reste) * 10) / 10)) + '"'
                    + (saisi ? ' value="' + esc(nb(effectif)) + '"' : '') + '></td>'
                    + '<td class="text-end">' + esc(fmtDec(l.mois)) + '</td>'
                    + cellDelta(l.delta)
                    + '<td class="text-end fw-bold">'
                    + (l.equilibre === null ? '—' : esc(fmtDec(l.equilibre))) + '</td></tr>';
            }).join('');
            var t = vp.totaux;
            // Le TITRE au-dessus du tableau, comme le fait la section
            // equilibre: la colonne des produits le portait, et six colonnes
            // chiffrees repliaient l'entete sur quatre lignes.
            h += '<h6 class="small fw-medium mb-1">Volumes projetés d\'ici la fin du mois</h6>'
                + '<div class="table-responsive"><table class="table table-sm mb-1">'
                + '<thead><tr><th>Produit</th>'
                + '<th class="text-end">Vendu à ce jour</th>'
                + '<th class="text-end">Reste à vendre</th>'
                + '<th class="text-end">Total mois</th>'
                + '<th class="text-end">Δ équilibre</th>'
                + '<th class="text-end">Total à l\'équilibre</th></tr></thead>'
                + '<tbody>' + volLignes
                + (vp.lignes.length > 1
                    ? '<tr class="table-light fw-bold"><td>Total bœuf</td>'
                      + '<td class="text-end">' + esc(fmtDec(t.vendu)) + '</td>'
                      + '<td class="text-end">' + esc(fmtDec(t.reste)) + '</td>'
                      + '<td class="text-end">' + esc(fmtDec(t.mois)) + '</td>'
                      + cellDelta(vp.deltaTotal === null ? null : t.delta)
                      + '<td class="text-end">'
                      + (t.equilibre === null ? '—' : esc(fmtDec(t.equilibre))) + '</td></tr>'
                    : '')
                + '</tbody></table></div>'
                + htmlSurcharge
                + '<div class="small text-muted mb-2">Quantités vendues, au rythme de CA projeté '
                + 'ci-dessus (+' + esc(pct2(propSuite * 100)) + ' % sur les jours qui restent), '
                + '<strong>à prix de vente inchangé</strong> — un tarif relevé pour la suite '
                + 'ferait le même chiffre d\'affaires avec moins de kilos. C\'est de la viande '
                + 'VENDUE : la carcasse à commander est plus lourde du parage. '
                + (vp.raison === null
                    ? '<strong>Δ équilibre</strong> : les kilos à vendre en plus (ou en moins) '
                      + 'pour amener le PL projeté à zéro, répartis au prorata du mélange actuel, '
                      + 'à ' + esc(fmt(vp.margeMoyenne)) + ' F de marge nette le kilo — '
                      + 'commission induite déduite.'
                    : vp.raison === 'sans_pl'
                        ? '<strong>Δ équilibre non chiffré</strong> : le PL projeté n\'a pas pu '
                          + 'être calculé, il n\'y a donc pas d\'écart à combler à afficher.'
                        : '<strong>Δ équilibre non chiffré</strong> : la marge nette au kilo '
                          + 'n\'est pas positive, l\'équilibre ne s\'atteint donc pas en '
                          + 'vendant plus.')
                + (vp.nbSansMarge > 0
                    ? ' Un produit au moins n\'a pas de marge chiffrable : il est exclu du '
                      + 'partage plutôt que compté à zéro.'
                    : '')
                + (bovinsMuets.length
                    ? ' Sans vente depuis le début du mois, donc hors tableau : '
                      + esc(bovinsMuets.map(function (p) { return p.nom; }).join(', ')) + '.'
                    : '')
                + '</div>';

            // Le tableau n'a pas pu etre construit mais des quantites sont
        // saisies: elles agissent toujours sur le PL. Rendre les controles
        // seuls, avec un mot d'explication, plutot que de laisser une saisie
        // active et inatteignable.
        if (!vp && repart && repart.actif) {
            h += '<div class="alert alert-warning py-2 small mb-2">'
                + '<strong>Quantités saisies actives</strong> sans tableau des volumes : '
                + 'aucun produit bovin n\'a vendu ce mois-ci, ou il ne reste plus de jour '
                + 'ouvré. Les saisies continuent de peser sur le PL projeté.</div>'
                + htmlSurcharge;
        }

        // ---- LE PRIX CONSEILLE, meme manque, a volume inchange.
            //
            // Deuxieme lecture du MEME manque, pas un remplacement du Δ
            // equilibre: celui-ci demande "combien de kilos en plus", celui-la
            // "a quel prix vendre ce qui reste". Repartition au meme ratio
            // reel/historique (q/qEq) que le Δ equilibre - deux cles de
            // repartition differentes sur le meme ecran se contrediraient.
            //
            // Le cout n'est pas recalcule ici: margeDe (donc
            // margeApresCommission) divise deja le cout carcasse par
            // (1-parage) et deduit la commission induite. Reecrire cette
            // division ici en ferait une seconde formule, libre de diverger.
            var lignesPrix = vp.lignes.filter(function (l) { return l.prixRequis !== null; });
            if (!lignesPrix.length && vp.raison) {
                // MEME message que le Δ equilibre juste au-dessus: un bloc qui
                // disparait sans un mot se lit comme un bug d'affichage, la ou
                // c'est la consequence normale de l'absence de PL ou de marge.
                h += '<div class="small text-muted mb-2">'
                    + '<strong>Prix conseillé non chiffré</strong> : '
                    + (vp.raison === 'sans_pl'
                        ? 'le PL projeté n\'a pas pu être calculé.'
                        : 'la marge nette au kilo n\'est pas positive.') + '</div>';
            } else if (lignesPrix.length) {
                var cellEcartPx = function (actuel, requis) {
                    var e = requis - actuel;
                    if (Math.abs(e) < 0.5) return '<td class="text-end text-muted">inchangé</td>';
                    var cls = e > 0 ? 'text-danger' : 'text-success';
                    return '<td class="text-end fw-bold ' + cls + '">'
                        + (e > 0 ? '+' : '') + esc(fmt(e)) + ' F/kg</td>';
                };
                h += '<h6 class="small fw-medium mb-1">Prix conseillé, à volume inchangé</h6>'
                    + '<div class="table-responsive"><table class="table table-sm mb-1">'
                    + '<thead><tr><th>Produit</th>'
                    + '<th class="text-end">Reste à vendre</th>'
                    + '<th class="text-end">Prix actuel</th>'
                    + '<th class="text-end">Prix conseillé</th>'
                    + '<th class="text-end">Écart</th></tr></thead><tbody>'
                    + lignesPrix.map(function (l) {
                        return '<tr><td>' + esc(l.nom) + '</td>'
                            + '<td class="text-end">' + esc(fmtDec(l.reste)) + '</td>'
                            + '<td class="text-end text-muted">' + esc(fmt(l.prixMoyen)) + ' F/kg</td>'
                            + '<td class="text-end fw-bold">' + esc(fmt(l.prixRequis)) + ' F/kg</td>'
                            + cellEcartPx(l.prixMoyen, l.prixRequis) + '</tr>';
                    }).join('')
                    + '</tbody></table></div>'
                    + '<div class="small text-muted mb-2">Le prix qu\'il faudrait pratiquer sur le '
                    + 'reste à vendre de <strong>chaque</strong> produit — sans changer les volumes '
                    + '— pour combler le même manque que le Δ équilibre ci-dessus, réparti au même '
                    + 'prorata du mélange. Le coût carcasse est déjà celui du dernier prix connu, '
                    + 'divisé par (1 − parage) : vendre 1 kg en consomme davantage à la découpe.</div>';
            }
        }

        if (!scen || !scen.central) {
            // Regle du document: sans realise exploitable, on ne projette que
            // le CA et on le DIT.
            return h + '<div class="alert alert-warning py-2 small mb-0">'
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

        // ---- D'OU VIENT LA MARGE PROJETEE, et laquelle des deux methodes
        // a servi.
        //
        // Le basculement entre taux constate et taux courant changeait le PL
        // projete SANS RIEN DIRE. C'est contraire a la regle du module - «
        // chaque regle est une hypothese AFFICHEE » - et cela rendait deux
        // captures d'ecran incomparables sans qu'on sache pourquoi.
        var origineTaux = (scen.central && scen.central.tauxMargeOrigine) || 'constate';
        var tauxUtilise = scen.central && scen.central.tauxMarge !== null
            ? scen.central.tauxMarge * 100 : null;
        var tauxConstateAff = (etat.plBrut || {}).taux_marge;
        h += '<div class="small mb-3">'
            + '<span class="text-muted">Marge projetée :</span> '
            + '<strong>' + (tauxUtilise === null ? '—' : esc(pct2(tauxUtilise)) + ' %')
            + '</strong> '
            + (origineTaux === 'courant'
                ? '<span class="badge bg-success-subtle text-success-emphasis border">'
                  + 'aux prix du jour</span>'
                : '<span class="badge bg-secondary-subtle text-secondary-emphasis border">'
                  + 'au taux constaté</span>')
            // LA COUVERTURE INCOMPLETE SE VOIT, sans depliage.
            //
            // Le seuil d'utilisabilite est a 80 %: entre 80 et 100, une part du
            // CA est projetee a la marge moyenne des AUTRES produits, ce qui
            // est une hypothese jamais verifiee. Elle etait ecrite en gris,
            // dans le depliant, au meme niveau que le reste - rien ne
            // distinguait 99,99 % de 80,1 %.
            + (origineTaux === 'courant' && tauxCourant
                && tauxCourant.couverture < 0.99
                ? ' <span class="badge bg-warning-subtle text-warning-emphasis border" '
                  + 'title="Le reste du chiffre d’affaires n’a pas de coût connu : '
                  + 'il ne contribue AUCUNE marge aux jours restants. Le PL projeté est '
                  + 'donc prudent à due concurrence.">'
                  + esc(pct2(tauxCourant.couverture * 100)) + ' % du CA seulement</span>'
                : '')
            + ' <details class="d-inline">'
            + '<summary class="text-primary d-inline" style="cursor:pointer">'
            + 'les deux méthodes</summary>'
            + '<div class="mt-2 border rounded p-2">'
            + '<div class="mb-2"><strong>Taux constaté</strong> — '
            + (tauxConstateAff === null || tauxConstateAff === undefined
                ? 'indisponible' : '<strong>' + esc(pct2(nb(tauxConstateAff))) + ' %</strong>')
            + '<div class="text-muted">'
            + '(chiffre d’affaires − avances − paiements + variation de stock) ÷ chiffre '
            + 'd’affaires, depuis le 1<sup>er</sup>. C’est une mesure de '
            + '<em>trésorerie</em> : une carcasse reçue et pas encore vendue fait sortir '
            + 'l’argent tout de suite et fait plonger le taux, sans qu’aucune '
            + 'rentabilité n’ait changé. Il mélange aussi les lots anciens aux '
            + 'récents.</div></div>'
            + '<div class="mb-2"><strong>Taux aux prix du jour</strong> — '
            + (tauxCourant && tauxCourant.taux_pct !== null && tauxCourant.taux_pct !== undefined
                ? '<strong>' + esc(pct2(tauxCourant.taux_pct)) + ' %</strong>'
                : 'non calculable')
            + '<div class="text-muted">'
            + 'Σ (prix de vente − prix d’achat ÷ (1 − parage)) × quantité, rapporté au '
            + 'CA de ces mêmes volumes aux mêmes prix (Σ vente × quantité) : c’est le '
            + 'taux que porteront les jours restants. Le <strong>dernier prix d’achat connu</strong> et '
            + 'le <strong>dernier prix de vente constaté</strong> — ce que les jours qui '
            + 'restent coûteront et rapporteront vraiment. La commission n’y entre pas : '
            + 'elle est déjà un poste du PL, la compter ici la déduirait deux fois.</div></div>'
            + '<div class="text-muted">'
            + (origineTaux === 'courant'
                ? 'Le mois est coupé en <strong>deux</strong> : ce qui est '
                  + '<strong>déjà vendu</strong> garde sa marge réelle (taux '
                  + 'constaté), et seuls les <strong>jours restants</strong> sont '
                  + 'valorisés aux prix du jour. Réévaluer le passé à '
                  + 'des prix qu’il n’a pas eus aurait gonflé la marge. '
                  + 'Le taux aux prix du jour couvre '
                  + esc(pct2((tauxCourant ? tauxCourant.couverture : 0) * 100))
                  + ' % du chiffre d’affaires.'
                : 'C’est le taux <strong>constaté</strong> qui porte tout le mois : le '
                  + 'taux aux prix du jour ne couvre pas assez de chiffre d’affaires pour '
                  + 'être fiable.')
            + ((tauxCourant && tauxCourant.sans_cout && tauxCourant.sans_cout.length)
                ? ' Sans coût d’achat connu, donc exclus du calcul plutôt que comptés à '
                  + 'zéro : ' + esc(tauxCourant.sans_cout.join(', ')) + '.'
                : '')
            + '</div></div></details></div>';

        // ---- MODE DEBUG: la DERIVATION du taux, produit par produit.
        //
        // Un taux agrege ne se verifie pas: on le croit ou on ne le croit pas.
        // Le detail rend chaque terme - prix de vente retenu, cout d'achat,
        // diviseur de parage, marge unitaire, contribution - et se termine par
        // un CONTROLE: la somme des marges rapportee au CA doit redonner le
        // taux affiche. Meme forme que le debug du resultat de reference.
        if (etat.debug && tauxCourant) {
            var padD = function (t, n) {
                t = String(t); return t + ' '.repeat(Math.max(0, n - t.length));
            };
            var padG = function (t, n) {
                t = String(t); return ' '.repeat(Math.max(0, n - t.length)) + t;
            };
            var dbg = '<h6 class="fin-subheading">Détail du calcul — marge des JOURS RESTANTS, aux derniers prix connus</h6>'
                + '<pre class="small border rounded p-2 mb-3" '
                + 'style="background:#f8fafc;overflow-x:auto">';
            dbg += padD('PRODUIT', 24) + padG('VENTE', 10) + padG('ACHAT', 10)
                + padG('DIVISEUR', 10) + padG('MARGE/u', 11) + padG('QTÉ', 10)
                + padG('MARGE', 14) + '  ' + padD('ORIGINE DU COÛT', 24) + '\n';
            dbg += '─'.repeat(115) + '\n';
            var sMarge = 0, sCa = 0, sCaTotal = 0, sCaSuite = 0;
            // Le CA encaisse, montre A PART apres le tableau: sur la meme
            // ligne que MARGE, il se lisait comme son origine alors que la
            // marge des jours restants ne s'en sert jamais.
            var caLignes = [];
            univSens.forEach(function (pr) {
                var m = margeBase(pr);
                var ca2 = nb(pr.ca);
                sCaTotal += ca2;
                if (m === null || m === undefined) {
                    dbg += esc(padD(String(pr.nom).slice(0, 23), 24))
                        + padG(fmt(pr.prix_moyen), 10) + padG('—', 10) + padG('—', 10)
                        + padG('coût inconnu', 11) + padG(fmtDec(pr.quantite), 10)
                        + padG('exclu', 14) + '  '
                        + esc(padD(String(pr.prix_achat_origine || '—').slice(0, 23), 24)) + '\n';
                    caLignes.push(esc(padD(String(pr.nom).slice(0, 23), 24)) + padG(fmt(ca2), 14));
                    return;
                }
                // LE DIVISEUR VIENT DU MOTEUR, pas d'un recalcul local.
                //
                // Le moteur expose diviseurParage precisement pour ca - son
                // commentaire le dit: « le recalculer la-bas en ferait une
                // seconde definition ». Ma premiere ecriture le redérivait
                // depuis parageBovin/parageOvin, en ignorant le repli sur
                // parageBase quand aucune journee de l'espece n'est mesurable.
                // La colonne aurait alors affiche un diviseur incapable de
                // refaire la marge de sa propre ligne.
                var div = M.diviseurParage(pr, { leviers: {}, globaux: {} }, etat.contexte);
                var q2 = nb(pr.quantite);
                sMarge += m * q2;
                sCa += ca2;
                sCaSuite += nb(pr.prix_moyen) * q2;
                dbg += esc(padD(String(pr.nom).slice(0, 23), 24))
                    + padG(fmt(pr.prix_moyen), 10) + padG(fmt(pr.prix_achat), 10)
                    + padG(div.toFixed(4), 10) + padG(fmt(m), 11)
                    + padG(fmtDec(q2), 10) + padG(fmt(m * q2), 14) + '  '
                    + esc(padD(String(pr.prix_achat_origine || 'prix propre').slice(0, 23), 24)) + '\n';
                caLignes.push(esc(padD(String(pr.nom).slice(0, 23), 24)) + padG(fmt(ca2), 14));
            });
            dbg += '─'.repeat(115) + '\n';
            dbg += padD('TOTAL chiffrable', 24) + padG('', 10) + padG('', 10) + padG('', 10)
                + padG('', 11) + padG('', 10) + padG(fmt(sMarge), 14) + '\n';
            // LE CA PLEIN, la ou ses deux termes sont sous les yeux.
            //
            // C'est l'assiette de la methode « volumes x derniers prix »: la
            // proportion de volume s'y applique pour donner le CA de la suite.
            // Il n'apparaissait que 40 lignes plus bas, sans qu'on puisse
            // verifier qu'il vient bien des colonnes QTE et VENTE de ce
            // tableau-ci.
            dbg += padD('CA plein aux derniers prix = Σ(QTÉ × VENTE)', 75)
                + padG(fmt(sCaSuite), 14) + '\n';
            // Les produits sans cout portent du CA sans porter de marge: leur
            // volume compte dans l'assiette du CA mais pas dans le total des
            // marges ci-dessus. Sans cette ligne, l'assiette utilisee plus bas
            // ne retombait pas sur le tableau.
            // caPlein vient de PJ.caAuxDerniersPrix(univSens), calcule en tete
            // de projectionCorps: le rappeler ici referait le meme parcours et,
            // pire, laisserait deux valeurs libres de diverger.
            if (Math.abs(caPlein - sCaSuite) >= 1) {
                dbg += padD('  dont produits sans coût, hors marge', 75)
                    + padG(fmt(caPlein - sCaSuite), 14) + '\n';
                dbg += padD('CA plein TOUS produits (assiette retenue)', 75)
                    + padG(fmt(caPlein), 14) + '\n';
            }
            dbg += '\n';
            // L'ORIGINE DU COUT, en clair sous le tableau.
            //
            // « Boeuf x 0,5 » sur le Jarret explique qu'il coute 2 250 quand
            // la carcasse est a 4 500: son prix d'achat en DERIVE par un
            // coefficient d'alias, il n'est pas saisi. Sans cette colonne, une
            // marge unitaire negative sur le Jarret passait pour une erreur de
            // saisie alors qu'elle vient du mapping.
            dbg += 'ORIGINE DU COÛT : « prix propre » = prix d\u2019achat saisi pour ce produit.\n';
            dbg += 'Sinon le coût DÉRIVE d\u2019un autre produit par un coefficient d\u2019alias\n';
            dbg += '(« Boeuf × 0,5 » : la moitié du prix de la carcasse). Corriger un coût\n';
            dbg += 'dérivé se fait sur le mapping, pas sur le produit.\n\n';
            dbg += 'taux des jours restants = marge totale ÷ Σ(VENTE × QTÉ) = ' + fmt(sMarge)
                + ' ÷ ' + fmt(sCaSuite)
                + ' = ' + (sCaSuite > 0 ? ((sMarge / sCaSuite) * 100).toFixed(4) : '—') + ' %\n';
            dbg += 'couverture = CA chiffrable ÷ CA total = ' + fmt(sCa) + ' ÷ ' + fmt(sCaTotal)
                + ' = ' + (sCaTotal > 0 ? ((sCa / sCaTotal) * 100).toFixed(2) : '—') + ' %\n';
            // Marge et CA aux MEMES prix: c'est litteralement le taux que
            // porteront les jours restants, quel que soit le volume - la
            // proportion se simplifie entre haut et bas.
            dbg += 'Marge et CA aux mêmes prix : c\u2019est le taux de marge des JOURS\n';
            dbg += 'RESTANTS (marge de la suite ÷ CA de la suite). Le PL projeté part,\n';
            dbg += 'lui, de la marge en francs.\n\n';
            // LE CONTROLE: ce que le module a rendu doit egaler ce qu'on vient
            // de recalculer ici. Un ecart signale que les deux ne lisent pas
            // les memes produits ou la meme marge.
            var attendu = tauxCourant.taux_pct;
            var recalc = sCaSuite > 0 ? (sMarge / sCaSuite) * 100 : null;
            var dTaux = (attendu === null || recalc === null) ? null : recalc - attendu;
            dbg += 'contrôle : recalcul − taux rendu par le module = '
                + (dTaux === null ? '—' : dTaux.toFixed(6))
                + (dTaux !== null && Math.abs(dTaux) < 0.0001 ? '  ✓' : '  ✗ ÉCART') + '\n\n';
            // CE QUE CHAQUE COLONNE EST, exactement.
            //
            // Premiere ecriture: « QTE et CA sont ceux de la periode et ne
            // servent qu'a supposer le mix ». Faux pour CA, qui n'entre pas
            // du tout dans la marge des jours restants: celle-ci ne fait que
            // marge unitaire x quantite restante. CA ne sert qu'a la
            // couverture et au taux affiche juste au-dessus. Le dire
            // separement, sinon la colonne passe pour un terme du calcul.
            dbg += 'VENTE et ACHAT sont les DERNIERS prix connus, ceux auxquels les jours\n';
            dbg += 'restants vont se faire.\n';
            dbg += 'QTÉ est celle de la période. Elle porte l’HYPOTHÈSE DE MIX : on suppose\n';
            dbg += 'que la suite du mois vendra dans les mêmes proportions. Multipliée par la\n';
            dbg += 'proportion restante, elle donne la quantité qu’il reste à vendre, en bas.\n';
            dbg += 'Aucune vente déjà faite n’est revalorisée : le passé garde sa marge\n';
            dbg += 'réellement constatée, reprise plus bas.\n\n';
            dbg += 'marge unitaire = prix de vente − prix d’achat ÷ diviseur\n';
            var ctxD = etat.contexte || {};
            var pmD = ctxD.parageMesure || {};
            var origineParage = function (espece, applique) {
                if (pmD[espece] !== null && pmD[espece] !== undefined
                    && nb(pmD[espece]) === nb(applique)) {
                    // esc: `jusquau` vient du serveur et dbg est insere en
                    // HTML brut dans un <pre>. Meme si la valeur est une date
                    // ISO calculee, on ne fait pas d'exception a la regle.
                    return 'mesuré jusqu\u2019au ' + esc(pmD.jusquau || '—') + ' sur '
                        + nb((pmD.jours_mesures || {})[espece]) + ' j';
                }
                return 'paramètre';
            };
            dbg += 'diviseur = 1 − parage (bovin ' + pct2(nb(ctxD.parageBovin))
                + ' % — ' + origineParage('bovin', ctxD.parageBovin)
                + ' · ovin ' + pct2(nb(ctxD.parageOvin))
                + ' % — ' + origineParage('ovin', ctxD.parageOvin) + ')\n';
            if (nb(ctxD.parageBovin) >= 2 * nb(ctxD.parageBase)
                && nb(ctxD.parageBovin) - nb(ctxD.parageBase) >= 5) {
                dbg += 'ATTENTION : parage bovin très au-dessus du paramètre ('
                    + pct2(nb(ctxD.parageBase)) + ' %). Une journée au stock du soir '
                    + 'manquant ou à zéro gonfle la mesure.\n';
            }
            dbg += 'la commission n’entre PAS ici : elle est déjà un poste du PL.\n';
            // ---- D'OU SORT LE CA PROJETE.
            //
            // La suite divise par le CA projete et en tire la proportion des
            // jours restants, sans jamais dire d'ou il vient: le chiffre
            // tombait du ciel au milieu d'un bloc qui explique tout le reste.
            // Ses seuls termes sont deux rythmes journaliers et le nombre de
            // jours d'ouverture qui restent a les multiplier.
            // Le CA encaisse, comme REPERE et rien d'autre. Separe du
            // tableau des marges a la demande: colonne a colonne avec
            // MARGE, on lui pretait un role qu'il n'a pas.
            dbg += 'CA RÉEL ENCAISSÉ sur la période — repère seulement, n’entre pas\n';
            dbg += 'dans la marge ci-dessus.\n';
            dbg += '─'.repeat(38) + '\n';
            dbg += caLignes.join('\n') + '\n';
            dbg += '─'.repeat(38) + '\n';
            dbg += padD('TOTAL (chiffrable ' + fmt(sCa) + ' + exclu)', 24) + padG(fmt(sCaTotal), 14) + '\n';
            dbg += '\n=== DU CA REALISE AU CA PROJETE ===\n\n';
            dbg += 'Deux rythmes journaliers, un par type de jour.\n';
            dbg += 'P1 = jours 1-10 et 25-fin (autour des paies), P2 = jours 11-24.\n\n';
            var ryth = ca.rythmes || {};
            var rReel = ryth.reel || {};
            var rHist = ryth.histo || {};
            var joursObs = rReel.jours || {};
            dbg += padD('TYPE', 6) + padG('RYTHME/JOUR', 14) + '  '
                + padD('SOURCE', 32) + padG('RÉEL', 12) + padG('ACTIFS', 8)
                + padG('OUVERTS', 9) + padG('HISTORIQUE', 13) + '\n';
            dbg += '─'.repeat(88) + '\n';
            ['P1', 'P2'].forEach(function (t) {
                dbg += padD(t, 6) + padG(fmt(ryth[t]), 14) + '  '
                    + esc(padD(String((ryth.sources || {})[t] || '—').slice(0, 31), 32))
                    + padG(fmt(rReel[t]), 12) + padG(nb(joursObs[t]), 8)
                    + padG(nb((rReel.joursOuverts || {})[t]), 9)
                    + padG(fmt(rHist[t]), 13) + '\n';
            });
            // LES JOURNEES ECARTEES, nommees.
            //
            // Depuis le 19/08/2026 une journee ouvree sans aucune vente sort du
            // denominateur du rythme (erreur sur le niveau du CA projete: 43,4 %
            // -> 17,5 % sur 16 projections et deux sites). Le dire, avec les
            // dates: fermeture reelle ou saisie manquante, ce n'est pas la meme
            // conversation avec l'exploitant.
            var excMois = (rReel.joursExclus || []);
            var excHist = (rHist.joursExclus || []);
            if (excMois.length || excHist.length) {
                dbg += 'journées ÉCARTÉES (ouvertes, aucune vente enregistrée) : '
                    + excMois.length + ' ce mois-ci';
                if (excMois.length) {
                    dbg += ' (' + esc(excMois.slice(0, 8).join(', '))
                        + (excMois.length > 8 ? ', …' : '') + ')';
                }
                dbg += ', ' + excHist.length + ' dans l\u2019historique.\n';
                dbg += 'Fermeture réelle, ou saisie manquante ? Dans le second cas, la saisir\n';
                dbg += 'relève le rythme et donc le CA projeté.\n';
            } else {
                dbg += 'aucune journée écartée : toutes les journées ouvertes ont vendu.\n';
            }
            dbg += '\n';
            var caRealProj = nb(ca.caRealise);
            var aj = ca.ajouts || {};
            // esc APRES le padding: escaper avant gonflerait la chaine des
            // entites HTML et decalerait la colonne.
            dbg += esc(padD('  CA RÉALISÉ du ' + debut + ' au ' + fin, 54))
                + padG(fmt(caRealProj), 14) + '\n';
            ['P1', 'P2'].forEach(function (t) {
                dbg += padD('  + ' + nb((ca.restants || {})[t]) + ' jours ' + t
                        + ' restants × ' + fmt(ryth[t]) + ' F/j', 54)
                    + padG(fmt(nb(aj[t])), 14) + '\n';
            });
            dbg += padD('', 54) + padG('──────────────', 14) + '\n';
            dbg += esc(padD('  = CA PROJETÉ au ' + (ca.finMois || '—'), 54))
                + padG(fmt(ca.caProjete), 14) + '\n\n';
            var caRecalc = caRealProj + nb(aj.P1) + nb(aj.P2);
            var dCa = (ca.caProjete === null || ca.caProjete === undefined)
                ? null : caRecalc - nb(ca.caProjete);
            dbg += 'contrôle : recalcul − CA projeté rendu par le module = '
                + (dCa === null ? '—' : fmt(dCa))
                + (dCa !== null && Math.abs(dCa) < 1 ? '  ✓' : '  ✗ ÉCART') + '\n';
            dbg += 'jours d\u2019ouverture restants comptés jusqu\u2019au '
                + esc(ca.finMois || '—') + ', dimanches '
                + (sansDim ? 'exclus' : 'comptés') + '\n';
            dbg += 'coefficient P1/P2 = ' + (coeff ? nb(coeff).toFixed(3) : '—')
                + ' (' + esc(origineCoeff || '—') + '), pondération '
                + Math.round(nb(etat.proj.poidsReel) * 100) + ' % réel / '
                + Math.round((1 - nb(etat.proj.poidsReel)) * 100) + ' % historique'
                + ' au-delà de ' + nb(etat.proj.minJours) + ' jours observés\n';
            // LA METHODE CHOISIE, appliquee sous les yeux du lecteur.
            //
            // En methode « volumes x derniers prix », le CA des rythmes n'est
            // qu'une etape: il se lit comme une proportion de VOLUME (il est
            // aux prix de la periode, comme les quantites), puis cette
            // proportion se revalorise au dernier prix de vente. Le controle
            // qui ferme le bloc est l'identite demandee par le proprietaire
            // du produit: Sigma(qte restante x dernier PV) = CAproj - CAreel.
            if (methodeCA === 'derniers' && caPlein > 0 && ca.caProjete !== null) {
                // LA FORME DIRECTE, PAS LA FORME FACTORISEE.
                //
                // Le bloc affichait « proportion x Sigma(QTE x VENTE) ». C'est
                // exact - la proportion se distribue dans la somme - mais ca se
                // LIT comme une revalorisation du passe: des quantites d'hier
                // multipliees par des prix de demain. Le modele ne fait pas ca.
                // On montre donc ce qu'il fait vraiment: chaque produit, sa
                // quantite restante, son dernier prix, et le CA qui en sort.
                // La forme abregee reste en bas, comme verification.
                dbg += '\nCe qui reste à vendre, produit par produit, au dernier prix\n';
                dbg += 'de vente. AUCUNE vente déjà faite n\u2019est recalculée ici.\n\n';
                dbg += padD('  proportion de volume = (' + fmt(ca.caProjete) + ' − '
                        + fmt(nb(b.ventes)) + ') ÷ ' + fmt(nb(b.ventes)), 62)
                    + ' = ' + padG(propVol.toFixed(4), 10) + '\n\n';
                dbg += padD('PRODUIT', 24) + padG('QTÉ PÉRIODE', 14)
                    + padG('QTÉ RESTANTE', 14) + padG('DERNIER PV', 12)
                    + padG('CA DE LA SUITE', 17) + '\n';
                dbg += '─'.repeat(81) + '\n';
                var sCaLignes = 0;
                univSens.forEach(function (pr) {
                    var pvL = nb(pr.prix_moyen);
                    if (!(pvL > 0)) return;
                    var qL = nb(pr.quantite);
                    var resteL = qL * propVol;
                    sCaLignes += resteL * pvL;
                    dbg += esc(padD(String(pr.nom).slice(0, 23), 24))
                        + padG(fmtDec(qL), 14) + padG(fmtDec(resteL), 14)
                        + padG(fmt(pvL), 12) + padG(fmt(resteL * pvL), 17) + '\n';
                });
                dbg += '─'.repeat(81) + '\n';
                dbg += padD('  CA DE LA SUITE', 64) + padG(fmt(sCaLignes), 17) + '\n';
                dbg += padD('  + CA RÉALISÉ', 64) + padG(fmt(nb(b.ventes)), 17) + '\n';
                dbg += padD('', 64) + padG('─────────────────', 17) + '\n';
                dbg += padD('  = CA PROJETÉ RETENU', 64) + padG(fmt(caRetenu), 17) + '\n\n';
                // La forme abregee, en verification: elle doit rendre le meme
                // franc, sinon la somme ligne a ligne et le module divergent.
                dbg += 'forme abrégée équivalente : ' + propVol.toFixed(4) + ' × Σ(QTÉ × VENTE) = '
                    + propVol.toFixed(4) + ' × ' + fmt(caPlein) + ' = '
                    + fmt(propVol * caPlein) + '\n';
                var dForme = sCaLignes - propVol * caPlein;
                dbg += 'contrôle : somme ligne à ligne − forme abrégée = ' + fmt(dForme)
                    + (Math.abs(dForme) < 1 ? '  ✓' : '  ✗ ÉCART') + '\n';
                var dIdent = propVol * caPlein - (nb(caRetenu) - nb(b.ventes));
                dbg += 'contrôle : Σ(qté restante × dernier PV) − (CA projeté − CA réalisé) = '
                    + fmt(dIdent) + (Math.abs(dIdent) < 1 ? '  ✓' : '  ✗ ÉCART') + '\n';
            } else if (methodeCA === 'rythmes' && caPlein > 0 && ca.caProjete !== null) {
                var caAlt = nb(b.ventes) + propVol * caPlein;
                dbg += '\nMéthode rythmes retenue : le CA projeté reste aux prix de la période.\n';
                dbg += 'En volumes × derniers prix il vaudrait ' + fmt(caAlt) + ' ('
                    + fmt(caAlt - nb(ca.caProjete)) + ' d\u2019écart, la hausse de prix).\n';
            }
            // Le CA realise du module de projection est la somme des journees,
            // celui du PL est le total des ventes. Les deux doivent coincider:
            // quand ils divergent, c'est une journee absente de ca_par_jour, et
            // la proportion porte l'ecart en silence. Le dire ici.
            var dRe = caRealProj - nb(b.ventes);
            if (Math.abs(dRe) >= 1) {
                dbg += 'ATTENTION : CA réalisé du module (' + fmt(caRealProj)
                    + ') ≠ ventes du PL (' + fmt(nb(b.ventes)) + '), écart '
                    + fmt(dRe) + '\n';
            }

            // LES JOURS RESTANTS, ESTIMES DIRECTEMENT.
            //
            // Le bloc partait du taux du tableau ci-dessus et le presentait
            // comme s'il revalorisait le passe, ce que le modele ne fait pas
            // et ce qu'on ne veut pas qu'il fasse. L'estimation se lit dans
            // l'autre sens: on connait les quantites qui restent a vendre, le
            // dernier cout d'achat, le dernier prix de vente et le parage
            // mesure du 1er a hier. La marge de la suite s'en deduit produit
            // par produit, sans jamais retoucher une vente deja faite.
            //
            // C'est le MEME nombre que prop x sMarge, puisque volumesProjetes
            // pose reste = quantite x proportion: le controle en bas le prouve
            // au lieu de le supposer.
            dbg += '\n=== DES JOURS RESTANTS AU PL PROJETE ===\n\n';
            var caReal = nb(b.ventes);
            // LE SCENARIO CENTRAL, pas les rythmes: en methode « derniers
            // prix », ca.caProjete n'est qu'une etape intermediaire et la
            // proportion du module est en VOLUME. Redecouper ici sur les
            // rythmes aurait fait sortir les controles en ECART permanent.
            var caProj = scen.central ? nb(scen.central.ca) : nb(ca.caProjete);
            // LE TAUX EXACT du module, pas celui arrondi pour l'affichage.
            // `taux_marge` du payload est arrondi au centieme: recalculer
            // dessus faisait sortir le controle a -42 F systematiquement,
            // un faux positif qui aurait fini par etre ignore.
            var tConst = (scen.central && scen.central.tauxMargeConstate !== null
                && scen.central.tauxMargeConstate !== undefined)
                ? nb(scen.central.tauxMargeConstate)
                : nb(tauxConstateAff) / 100;
            var prop = (scen.central && scen.central.proportion !== null
                && scen.central.proportion !== undefined)
                ? nb(scen.central.proportion)
                : (caReal > 0 ? Math.max(0, (caProj - caReal) / caReal) : 0);
            var mReal = caReal * tConst;
            dbg += 'Ce qui reste à vendre est estimé au dernier prix de vente et au dernier\n';
            dbg += 'coût d\u2019achat, parage mesuré du 1er du mois à hier (le tableau ci-dessus).\n';
            dbg += 'Aucune vente déjà faite n\u2019est retouchée.\n\n';
            var assiette = (methodeCA === 'derniers' && scen.central
                && scen.central.caPleinDerniersPrix) ? nb(scen.central.caPleinDerniersPrix) : caReal;
            dbg += padD('  proportion restante = (CA projeté − CA réalisé) ÷ '
                + (assiette === caReal ? 'CA réalisé' : 'CA plein aux derniers prix'), 62) + '\n';
            dbg += padD('    = (' + fmt(caProj) + ' − ' + fmt(caReal) + ') ÷ ' + fmt(assiette), 62)
                + ' = ' + padG(prop.toFixed(4), 10) + '\n\n';
            dbg += padD('PRODUIT', 24) + padG('MARGE/u', 11) + padG('QTÉ PÉRIODE', 14)
                + padG('QTÉ RESTANTE', 14) + padG('MARGE RESTANTE', 17) + '  SOURCE\n';
            dbg += '─'.repeat(90) + '\n';
            // LES RESTES VIENNENT DE LA REPARTITION, jamais d'un q x proportion
            // refait ici: des qu'une quantite est saisie a la main, les deux
            // divergent et c'est la repartition qui a raison. Premiere
            // ecriture: le tableau recalculait le mix et le controle du bas
            // sortait a -48 986 F, un vrai ecart correctement signale.
            var restesParCle = {};
            if (repart) repart.lignes.forEach(function (l) { restesParCle[l.cle] = l; });
            var mRest = 0, mRestMix = 0;
            univSens.forEach(function (pr) {
                var m = margeBase(pr);
                if (m === null || m === undefined) return;
                var q3 = nb(pr.quantite);
                var rl = restesParCle[cleSurcharge(pr.nom)];
                var reste = rl ? rl.reste : q3 * prop;
                mRest += m * reste;
                mRestMix += m * (rl ? rl.reste_mix : q3 * prop);
                dbg += esc(padD(String(pr.nom).slice(0, 23), 24))
                    + padG(fmt(m), 11) + padG(fmtDec(q3), 14)
                    + padG(fmtDec(reste), 14) + padG(fmt(m * reste), 17)
                    + '  ' + (rl && rl.source === 'saisie' ? 'SAISIE' : 'mix') + '\n';
            });
            dbg += '─'.repeat(90) + '\n';
            dbg += padD('  marge de la SUITE', 63) + padG(fmt(mRest), 17) + '\n\n';
            dbg += padD('  marge du PASSÉ = CA réalisé × taux réellement constaté', 63) + '\n';
            dbg += padD('    = ' + fmt(caReal) + ' × ' + pct2(nb(tauxConstateAff)) + ' %', 63)
                + padG(fmt(mReal), 17) + '\n';
            dbg += padD('', 63) + padG('─────────────────', 17) + '\n';
            dbg += padD('  = marge du MOIS', 63) + padG(fmt(mReal + mRest), 17) + '\n\n';
            dbg += 'taux effectif = marge du mois ÷ CA projeté = ' + fmt(mReal + mRest)
                + ' ÷ ' + fmt(caProj) + ' = '
                + (caProj > 0 ? ((mReal + mRest) / caProj * 100).toFixed(2) : '—')
                + ' %   <- celui affiché en tête\n';
            var mModule = scen.central && scen.central.marge !== null
                ? scen.central.marge : null;
            var dM = mModule === null ? null : (mReal + mRest) - mModule;
            dbg += 'contrôle : recalcul − marge rendue par le module = '
                + (dM === null ? '—' : fmt(dM))
                + (dM !== null && Math.abs(dM) < 1 ? '  ✓' : '  ✗ ÉCART') + '\n';
            // SANS saisie, la voie longue (produit par produit) et la voie
            // courte (proportion x marge du mix) doivent tomber au meme franc:
            // c'est la preuve qu'aucune regression n'a ete introduite.
            // AVEC saisie, elles DOIVENT differer - c'est tout l'objet de la
            // saisie - donc on n'affiche plus un controle mais l'ecart, qui
            // chiffre ce que l'exploitant a change en connaissance de cause.
            if (repart && repart.actif) {
                dbg += 'saisie manuelle ACTIVE sur ' + repart.totaux.nb_saisies + ' produit'
                    + (repart.totaux.nb_saisies > 1 ? 's' : '') + ', mode '
                    + (repart.mode === 'ajout' ? '« s\u2019ajoute au CA »' : '« redistribue »')
                    + (repart.facteur !== null
                        ? ', les lignes libres × ' + nb(repart.facteur).toFixed(4) : '')
                    + '\n';
                dbg += 'effet de la saisie sur la marge : ' + fmt(mRest) + ' − ' + fmt(mRestMix)
                    + ' = ' + fmt(mRest - mRestMix) + '\n';
                if (repart.sature) {
                    dbg += 'ATTENTION : les saisies dépassent le CA projeté, les lignes libres '
                        + 'sont à zéro.\n';
                }
                dbg += '\n';
            } else {
                var dEq = mRest - prop * sMarge;
                dbg += 'contrôle : somme produit par produit − (proportion × marge du mix) = '
                    + fmt(dEq) + (Math.abs(dEq) < 1 ? '  ✓' : '  ✗ ÉCART') + '\n\n';
            }
            dbg += 'taux retenu pour la projection : '
                + (origineTaux === 'courant' ? 'CELUI-CI' : 'le taux constaté ('
                    + esc(pct2(nb(tauxConstateAff))) + ' %), faute de couverture suffisante')
                + '\n';
            dbg += '</pre>';
            h += dbg;
        }

        // Le scenario CENTRAL sert a la fois au plan d'equilibre ci-dessous et
        // a la decomposition plus bas: declare ici, avant son premier usage.
        var d0 = scen.central;

        // Le RESUME que l'entete porte, lisible section repliee: on vient ici
        // pour ces deux nombres, ils ne doivent pas exiger un depliage.
        etat.projResume = '· CA ' + fmt(caRetenu) + ' F · PL '
            + fmt(d0.pl) + ' F · confiance ' + conf.niveau;

        // ---- QUATRE SENSIBILITES DE COUT, sur les jours qui restent.
        //
        // Les trois cartes ci-dessus font varier le CHIFFRE D'AFFAIRES. Elles
        // ne disent rien de ce qui se passe si la carcasse renchérit ou si la
        // découpe rend moins - deux aléas que le boucher subit sans les
        // choisir, et qui pèsent plus lourd que 10 % de CA.
        var stats = (etat.sim.prix_achat || {}).boeuf_stats || null;
        var paMoyen = (function () {
            var bd = univSens.filter(function (p) { return M.estBoeuf(p) && nb(p.prix_achat) > 0; })[0];
            return bd ? nb(bd.prix_achat) : null;
        }());
        var ep = nb(etat.proj.ecartParage);
        // Les taux de parage COURANTS, par espece. Ils etaient declares plus
        // bas, dans le bloc « ecart de parage »; la ligne de saisie libre, qui
        // vient avant, en a desormais besoin pour son parage par defaut - et un
        // `var` hoiste s'y serait lu `undefined`.
        var ctxPar = etat.contexte || {};
        // MEME repli que le moteur (simulation-v2-moteur.js, p0B/p0O): un taux
        // absent decrit le PARAMETRE, pas un taux nul. `nb(null)` valait 0, et
        // la ligne de saisie affichait alors « 0 % » en l'annoncant comme le
        // taux constate - une boucherie qui ne parerait rien.
        var parageOu = function (v) {
            return (v === undefined || v === null) ? nb(ctxPar.parageBase) : nb(v);
        };
        var bovin = parageOu(ctxPar.parageBovin), ovin = parageOu(ctxPar.parageOvin);
        var sensis = [];
        if (stats && paMoyen !== null && stats.max > paMoyen) {
            sensis.push({ lib: 'Coût du bœuf au plus haut (' + fmt(stats.max) + ' F)',
                effet: effetSurLaSuite(univSens, propSuite, { dPa: stats.max - paMoyen }) });
        }
        if (stats && paMoyen !== null && stats.min < paMoyen) {
            sensis.push({ lib: 'Coût du bœuf au plus bas (' + fmt(stats.min) + ' F)',
                effet: effetSurLaSuite(univSens, propSuite, { dPa: stats.min - paMoyen }) });
        }
        // LE PRIX DU BOEUF EN SAISIE LIBRE.
        //
        // Les deux lignes ci-dessus n'offrent que les bornes deja connues du
        // mois - « au plus haut », « au plus bas ». Elles ne repondent pas a la
        // question qu'on se pose vraiment devant un fournisseur: « et s'il
        // passait a 5 000 ? ». Ce prix-la n'a jamais ete pratique, donc aucune
        // borne ne le porte.
        //
        // La ligne part du cout moyen constate: a l'ouverture elle affiche donc
        // un effet nul, et c'est voulu - on voit d'ou l'on part avant de bouger.
        // Le PARAGE de cette ligne se regle a cote du prix, et le calcul les
        // applique dans le MEME appel: c'est l'effet croise qu'on cherche, pas
        // la somme de deux lignes. Le taux part du bovin constate, comme le
        // prix part du cout moyen - a l'ouverture la ligne affiche donc un
        // effet nul, et l'on voit d'ou l'on part avant de bouger l'un ou
        // l'autre. Seul le bovin bouge ici: c'est le cout du BOEUF qu'on teste.
        var prixTeste = etat.proj.prixBoeufTeste;
        var parageTeste = etat.proj.parageBoeufTeste;
        if (paMoyen !== null) {
            var pxRef = prixTeste === null ? paMoyen : prixTeste;
            var parRef = parageTeste === null ? bovin : parageTeste;
            sensis.push({
                saisie: true,
                lib: 'Coût du bœuf à',
                valeur: pxRef,
                parage: parRef,
                effet: effetSurLaSuite(univSens, propSuite,
                    { dPa: pxRef - paMoyen, parBov: parRef })
            });
        }

        if (ep > 0) {
            // Chaque espece bouge depuis SON taux. Appliquer un meme
            // pourcentage absolu aux deux revenait, depuis que les taux sont
            // mesures separement, a deplacer l'agneau de plusieurs points sans
            // que personne ne l'ait demande.
            var hautB = Math.min(99, bovin + ep), hautO = Math.min(99, ovin + ep);
            var basB = Math.max(0, bovin - ep), basO = Math.max(0, ovin - ep);
            // Le libelle nomme les DEUX taux, parce que l'effet deplace les
            // deux. N'annoncer que le boeuf laissait attribuer a la seule
            // espece bovine un chiffre qui porte aussi l'agneau.
            sensis.push({ lib: 'Parage +' + fmt(ep) + ' pts (bœuf ' + pct2(hautB)
                    + ' %, agneau ' + pct2(hautO) + ' %)',
                effet: effetSurLaSuite(univSens, propSuite, { parBov: hautB, parOvi: hautO }) });
            sensis.push({ lib: 'Parage −' + fmt(ep) + ' pts (bœuf ' + pct2(basB)
                    + ' %, agneau ' + pct2(basO) + ' %)',
                effet: effetSurLaSuite(univSens, propSuite, { parBov: basB, parOvi: basO }) });
        }
        if (sensis.length) {
            h += '<div class="d-flex align-items-center gap-2 mb-1 small flex-wrap">'
                + '<span class="fw-medium">Et si le coût bougeait, sur les jours qui restent</span>'
                + '<label class="text-muted ms-2">écart de parage testé :</label>'
                + '<input type="number" class="form-control form-control-sm sim2-proj-ctl" '
                + 'data-k="ecartParage" style="width:4.5rem" min="0" max="50" step="0.5" value="'
                + esc(String(ep)) + '"><span class="text-muted">points</span></div>'
                + '<div class="table-responsive"><table class="table table-sm mb-2"><thead><tr>'
                + '<th>Hypothèse sur la suite du mois</th>'
                + '<th class="text-end">Effet</th><th class="text-end">PL projeté</th>'
                + '</tr></thead><tbody>'
                + sensis.map(function (s) {
                    var pl = d0.pl + s.effet;
                    // La ligne de SAISIE porte son champ dans la cellule: le
                    // prix teste se lit et se change au meme endroit que son
                    // effet, sans avoir a le chercher ailleurs sur l'ecran.
                    var libelle = s.saisie
                        ? esc(s.lib)
                          + ' <input type="number" class="form-control form-control-sm d-inline-block sim2-proj-ctl"'
                          + ' data-k="prixBoeufTeste" style="width:7rem" min="1" max="100000" step="10"'
                          + ' value="' + esc(String(Math.round(s.valeur))) + '">'
                          + ' <span class="text-muted">F/kg</span>'
                          + '<span class="text-muted">, parage bœuf</span> '
                          + '<input type="number" class="form-control form-control-sm d-inline-block sim2-proj-ctl"'
                          // step au CENTIEME, pas au dixieme: le taux constate
                          // vaut 3,59 % et pct2() explique plus haut pourquoi
                          // ce centieme compte - il porte sur un DIVISEUR, et
                          // 3,96 contre 4 deplace deja 700 F sur le mois. Au
                          // dixieme, la fleche du spinner ramenait 3,59 a 3,6.
                          + ' data-k="parageBoeufTeste" style="width:5.5rem" min="0" max="99" step="0.01"'
                          + ' title="Videz le champ pour revenir au taux constaté ('
                          + esc(pct2(bovin)) + ' %)."'
                          + ' value="' + esc(String(Math.round(nb(s.parage) * 100) / 100)) + '">'
                          + ' <span class="text-muted">%</span>'
                          + (etat.proj.prixBoeufTeste === null && etat.proj.parageBoeufTeste === null
                             ? ' <span class="text-muted small">— coût et parage constatés, effet nul</span>'
                             : '')
                        : esc(s.lib);
                    return '<tr' + (s.saisie ? ' class="table-light"' : '') + '><td>' + libelle + '</td>'
                        + '<td class="text-end ' + cls(s.effet) + '">' + esc(signe(s.effet)) + '</td>'
                        + '<td class="text-end fw-bold ' + cls(pl) + '">' + esc(fmt(pl)) + '</td></tr>';
                }).join('')
                + '</tbody></table></div>'
                + '<div class="small text-muted mb-2">Le coût et le parage ne portent que sur les '
                + 'unités encore à vendre, au taux de parage : une unité vendue consomme '
                + '1/(1−parage) de carcasse. La commission suit les livraisons induites. '
                + 'L\'effet de stock n\'est pas recompté ici — il relève de l\'option '
                + '<em>variation de stock projetée</em>.</div>';
        }

        // ---- CE QU'IL FAUT FAIRE D'ICI LA FIN DU MOIS pour revenir a zero.
        //
        // Les leviers portent sur le volume RESTANT, pas sur le volume deja
        // vendu: le mois ecoule ne se rejoue pas.
        // Le plan puise dans TOUS les produits vendus, pas dans la seule liste
        // suivie: celle-ci est fermee pour que le tableau de sensibilite se
        // compare d'un mois a l'autre, ce qui n'a aucune raison de priver
        // l'equilibre d'une cuisse de poulet dont le cout est connu. Repli sur
        // la liste suivie si le serveur ne fournit pas encore l'autre.
        //
        // EN MODE FIGE, on reste sur etat.produits: c'est la seule liste qui
        // porte les volumes du SNAPSHOT (superposes dans preparer). Puiser
        // dans produits_vendus - toujours calcule sur la periode vivante -
        // faisait cohabiter sur le meme ecran un tableau de sensibilite fige
        // et un plan d'equilibre bati sur d'autres volumes.
        // Les produits sont vus AU PRIX DE LA SUITE: le prix retenu gouverne
        // les jours qui restent, donc la marge de l'effort ET le prix
        // d'equilibre a atteindre. Le tableau de sensibilite au-dessus garde
        // le prix moyen: lui decrit ce qui s'est passe.
        var universEq = ((!b.fige && etat.sim.produits_vendus && etat.sim.produits_vendus.length)
            ? etat.sim.produits_vendus
            : etat.produits).map(auPrixDeLaSuite);
        var eq = PJ.planEquilibre({
            plCentral: d0.pl, produits: universEq,
            margeDe: margeApresCommission,
            caRealise: b.ventes, caProjete: caRetenu,
            joursRestants: ca.restants.P1 + ca.restants.P2,
            jours: jours, facteurMax: etat.proj.facteurMax,
            principal: 'Boeuf en détail', nbProduits: 5,
            cible: nb(etat.proj.plCible)
        });
        // LE PL VISE se regle ICI, HORS du bloc `if (eq)`.
        //
        // Le mettre a l'interieur l'aurait enferme: des que la cible est
        // atteinte le plan disparait, et avec lui le seul champ permettant de
        // la relever. Un boucher a +45 000 F n'aurait plus jamais pu demander
        // 100 000. Le reglage vit donc au-dessus, toujours visible.
        var plCibleUi = nb(etat.proj.plCible);
        h += '<div class="d-flex align-items-center gap-2 mb-2 small flex-wrap">'
            + '<label class="fw-medium mb-0" for="sim2-pl-cible">'
            + 'Objectif de PL fin de mois</label>'
            + '<input type="number" id="sim2-pl-cible" '
            + 'class="form-control form-control-sm sim2-proj-ctl" '
            + 'data-k="plCible" style="width:9rem" step="10000" value="'
            + esc(String(Math.round(plCibleUi))) + '">'
            + '<span class="text-muted">FCFA — 0 = l\'équilibre</span></div>';

        if (projCalculee) projCalculee.plan_equilibre = eq;
        if (eq) {
            var s0 = eq.seul;
            h += '<h6 class="small fw-medium mb-1">'
                + (plCibleUi === 0
                    ? 'Revenir à l\'équilibre'
                    : 'Atteindre ' + esc(fmt(plCibleUi)) + ' F')
                + ' d\'ici le '
                + esc(ca.finMois) + ' — ' + eq.joursRestants + ' jours restants</h6>'
                + noteHorsCatalogue(universEq)
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
                // LES DEUX cadences, toujours, et nommees. N'en donner qu'une
                // ici et l'autre dans le tableau faisait cohabiter deux « par
                // jour » qui ne mesuraient pas la meme chose.
                + '<div class="small text-muted">soit <strong>' + esc(fmt(s0.volumeTotal))
                + ' u au total</strong> (+' + s0.hausseVolumePct.toFixed(0) + ' %)'
                + ' → ' + esc(fmt(s0.montantVolume)) + ' F'
                + (s0.parJour !== null
                    ? '<br>par jour : <strong>+' + esc(fmtDec(s0.parJour)) + ' u en plus</strong>'
                      + ', soit ' + esc(fmtDec(s0.volumeTotal / eq.joursRestants)) + ' u au total'
                    : '')
                + '</div>'
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
                    + '<span class="text-muted">fois son rythme mensuel — la colonne '
                    + '<em>plafond du total</em> en retire ce qui est déjà vendu, et ne '
                    + 'descend jamais sous ce qui est déjà attendu</span>'
                    + '</div>'
                    + '<div class="table-responsive"><table class="table table-sm mb-1">'
                    + '<thead><tr><th>Produit</th>'
                    + '<th class="text-end">Prix pour la suite</th>'
                    + '<th class="text-end">Marge nette</th>'
                    + '<th class="text-end">Déjà attendu</th>'
                    + '<th class="text-end">À vendre en plus</th>'
                    + '<th class="text-end">Total à vendre</th>'
                    + '<th class="text-end">Par jour<br><span class="fw-normal text-muted">'
                    + 'en plus / total</span></th>'
                    + '<th class="text-end">Plafond du total</th>'
                    + '<th class="text-end">Apport</th></tr></thead><tbody>'
                    + eq.plan.map(function (x) {
                        var total = x.volumeRestant + x.volumeAdditionnel;
                        var totalJour = eq.joursRestants > 0 ? total / eq.joursRestants : null;
                        // Le prix qui gouverne les jours restants, MODIFIABLE.
                        // Le defaut est le majoritaire du dernier jour vendu,
                        // mais un tarif tout juste releve peut n'avoir jamais
                        // ete pratique: le boeuf en gros est passe a 5 200 F
                        // quand la seule vente du dernier jour etait a 5 100,
                        // consentie exceptionnellement a une cliente.
                        var src = (universEq.filter(function (u) { return u.nom === x.nom; })[0]) || {};
                        var pr = src.prix_retenu || null;
                        var saisi = etat.proj.prixSuite[x.nom];
                        var modifie = saisi !== undefined && saisi !== null && saisi !== '';
                        var titre = pr
                            ? 'Majoritaire du ' + pr.date + ' (' + pr.nb_lignes + ' ligne(s)'
                              + (pr.nb_prix_ce_jour > 1 ? ' sur ' + pr.nb_prix_ce_jour + ' prix ce jour-là' : '') + ')'
                            : 'Aucune vente : prix moyen de la période';
                        return '<tr><td>' + esc(x.nom)
                            + (x.plafonne ? ' <span class="badge bg-secondary">plafond atteint</span>' : '')
                            + '</td>'
                            + '<td class="text-end">'
                            + '<input type="number" class="form-control form-control-sm text-end d-inline-block sim2-prix-suite" '
                            + 'style="width:6.5rem" step="50" min="0" data-nom="' + esc(x.nom) + '" '
                            + 'title="' + esc(titre) + '" value="'
                            + esc(String(Math.round(nb(src.prix_moyen)))) + '">'
                            + (modifie
                                ? ' <span class="badge bg-info text-dark">ajusté</span>'
                                : (pr && pr.nb_prix_ce_jour > 1
                                    ? ' <span class="badge bg-light text-dark border" title="'
                                      + esc(titre) + '">majoritaire</span>'
                                    : ''))
                            + '</td>'
                            + '<td class="text-end">' + esc(fmt(x.marge)) + ' F/u</td>'
                            + '<td class="text-end text-muted">' + esc(fmt(x.volumeRestant)) + ' u</td>'
                            + '<td class="text-end"><strong>+' + esc(fmt(x.volumeAdditionnel)) + ' u</strong>'
                            + (x.haussePct !== null ? ' <span class="text-muted">(+' + x.haussePct.toFixed(0) + ' %)</span>' : '')
                            + '</td>'
                            + '<td class="text-end fw-bold">' + esc(fmt(total)) + ' u</td>'
                            // Les DEUX cadences: l'effort quotidien, et
                            // l'objectif quotidien qui l'inclut. La seconde
                            // seule laissait croire que tout etait a vendre en
                            // plus; la premiere seule ne dit pas ou l'on va.
                            + '<td class="text-end">'
                            + (x.parJour !== null
                                ? '<strong>+' + esc(fmtDec(x.parJour)) + '</strong>'
                                  + ' <span class="text-muted">/ ' + esc(fmtDec(totalJour)) + ' u/j</span>'
                                : '—')
                            + '</td>'
                            + '<td class="text-end text-muted">' + esc(fmt(x.plafondReste)) + ' u</td>'
                            + '<td class="text-end">' + esc(fmt(x.part)) + ' F</td></tr>';
                    }).join('')
                    // La SOMME de la colonne, pas le manque. Quand le plan
                    // n'est pas atteignable, les produits sont tous plafonnes
                    // et la colonne somme moins que le manque: afficher le
                    // manque en pied faisait mentir le total de sa propre
                    // colonne, d'un ecart mesure a 1 772 728 F.
                    + '<tr class="table-light fw-bold"><td colspan="8">Total de l\'effort'
                    + (eq.resteACouvrir > 0
                        ? ' <span class="text-danger small">(reste ' + esc(fmt(eq.resteACouvrir))
                          + ' F à trouver ailleurs)</span>'
                        : '')
                    + '</td>'
                    + '<td class="text-end">'
                    + esc(fmt(eq.plan.reduce(function (s, x) { return s + x.part; }, 0)))
                    + ' F</td></tr>'
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
        } else if (d0 && d0.pl !== null && d0.pl !== undefined && nb(d0.pl) >= plCibleUi) {
            // CIBLE DEJA ATTEINTE. L'ecran se taisait completement dans ce cas,
            // et l'absence de plan se lisait comme une panne plutot que comme
            // une bonne nouvelle. On dit l'avance, et on renvoie vers la
            // colonne qui la traduit en marchandise.
            h += '<div class="alert alert-success py-2 small mb-2">'
                + '<i class="bi bi-check-circle"></i> Objectif déjà atteint : le PL projeté de '
                + '<strong>' + esc(fmt(d0.pl)) + ' F</strong> dépasse la cible de '
                + esc(fmt(plCibleUi)) + ' F de <strong>' + esc(fmt(nb(d0.pl) - plCibleUi))
                + ' F</strong>. Aucun effort de volume à demander — la colonne '
                + '<em>Δ équilibre</em> plus haut dit de combien vous pourriez vendre moins '
                + 'tout en tenant l\'objectif. Relevez la cible pour voir l\'effort qu\'un '
                + 'objectif plus ambitieux demanderait.</div>';
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
            plCentral: d0.pl,
            cible: nb(etat.proj.plCible),
            // universEq, le MEME univers que le plan d'equilibre - pas
            // etat.produits. Les deux blocs repondent a la meme question, « que
            // vendre en plus pour combler le manque »: les faire raisonner sur
            // deux listes differentes les faisait se contredire. Mesure sur
            // mbao: le plan retenait la Viande Hachee, sa plus forte marge a
            // 1 295 F/u, pendant que les recommandations juste en dessous
            // designaient le boeuf en detail (916) et le boeuf en gros (733) -
            // le 2e et le 3e - parce qu'elles ne voyaient que la liste suivie.
            produits: universEq,
            margeDe: margeApresCommission,
            // Part du CA restant a faire: c'est l'assiette d'une hausse de
            // prix, pas le volume deja vendu.
            proportion: b.ventes > 0 ? (ca.caProjete - b.ventes) / b.ventes : 0,
            topClients: etat.sim.top_clients || [],
            clientsHistorique: clientsHisto,
            dateAnalyse: fin
        });
        if (projCalculee) projCalculee.recommandations = recos;
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
            if (methodeCA === 'derniers' && caRetenu !== ca.caProjete) {
                dbg += '   CA retenu (volumes × derniers prix) = ' + fmt(nb(b.ventes)) + ' + '
                    + propVol.toFixed(4) + ' × ' + fmt(caPlein) + ' = ' + fmt(caRetenu) + '\n';
            }
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

        // « SUIVIS » NE VOULAIT PAS DIRE « A COUT CONNU ».
        //
        // Ce perimetre est celui des LEVIERS: les produits sur lesquels
        // l'ecran laisse tirer un prix ou un volume. Un produit peut avoir un
        // cout parfaitement connu, entrer dans le calcul de la marge, et ne pas
        // figurer ici - c'est le cas du Foie, du Yell, de la Viande Hachee.
        // L'ancien libelle « produits suivis / hors perimetre » les faisait
        // passer pour ignores du calcul, ce qu'ils ne sont pas.
        h += '2. PÉRIMÈTRE DES LEVIERS DE SIMULATION\n';
        h += '   (produits actionnables dans un scénario. Le calcul de la marge,\n';
        h += '    lui, porte sur TOUT produit dont le coût est connu.)\n';
        var caSuivis = 0;
        etat.produits.forEach(function (p) { caSuivis += nb(p.ca); });
        h += '   ' + pad('chiffre d\'affaires total', 30) + padL(fmt(b.ventes), 14) + '\n';
        h += '   ' + pad('dont actionnables par levier', 30) + padL(fmt(caSuivis), 14)
           + '   ' + (b.ventes > 0 ? ((caSuivis / b.ventes) * 100).toFixed(1) : '0') + ' %\n';
        h += '   ' + pad('sans levier (coût connu quand même)', 30) + padL(fmt(b.ventes - caSuivis), 14) + '\n';
        // CE QUI EST HORS PERIMETRE, NOMME.
        //
        // Le total seul ne se traite pas: « 320 625 F hors perimetre » laisse
        // chercher. La liste dit s'il s'agit de miettes ou d'un produit qui
        // aurait du etre suivi - et c'est la seule facon de decider d'agir.
        var suivis = {};
        etat.produits.forEach(function (p) { suivis[norm(p.nom)] = true; });
        var tousVendus = (etat.sim && etat.sim.produits_vendus) || [];
        var dehors = tousVendus.filter(function (p) {
            return !suivis[norm(p.nom)] && nb(p.ca) > 0;
        }).sort(function (x, y) { return nb(y.ca) - nb(x.ca); });
        if (dehors.length) {
            var sommeDehors = 0;
            dehors.forEach(function (p) {
                sommeDehors += nb(p.ca);
                h += '      ' + esc(pad(String(p.nom).slice(0, 27), 27))
                   + padL(fmt(nb(p.ca)), 14)
                   + '   ' + (b.ventes > 0 ? ((nb(p.ca) / b.ventes) * 100).toFixed(2) : '0')
                   + ' %\n';
            });
            // Controle: la liste doit redonner le total, sinon un produit vendu
            // manque a produits_vendus et le perimetre affiche serait faux.
            var ecartDehors = sommeDehors - (b.ventes - caSuivis);
            h += '      ' + pad('contrôle : somme − sans levier', 27)
               + padL(fmt(ecartDehors), 14)
               + (Math.abs(ecartDehors) < 1 ? '   ✓' : '   ✗ ÉCART') + '\n';
        }
        h += '\n';

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
        h += '   ' + pad('référence', 26) + padL(fmt(plRef()), 14) + '\n';
        h += '   ' + pad('effet du scénario', 26) + padL(signe(total), 14) + '\n';
        h += '   ' + pad('', 26) + padL('──────────────', 14) + '\n';
        h += '   ' + pad('simulé', 26) + padL(fmt(plRef() + total), 14) + '\n';
        return h + '</pre>';
    }

    /**
     * EXPORT JSON de la projection, couche CALCULEE.
     *
     * On exporte ce que l'ecran vient d'afficher - rythmes retenus et leurs
     * sources, scenarios, volumes projetes, plan d'equilibre, prix conseille,
     * recommandations - et NON `etat.sim`, le payload brut du serveur: celui-ci
     * porte des champs internes sans interet et n'a pas la structure des
     * scenarios ni du plan. Un LLM qui lit ce fichier doit trouver les
     * conclusions, pas les avoir a rebatir.
     */
    /** Le payload de la projection, partage par l'export JSON et l'analyse
     *  IA: les deux doivent decrire exactement le meme calcul. */
    function construirePayloadProjection() {
        if (!projCalculee) return null;
        var c = etat.contexte || {};
        return {
            genere_le: new Date().toISOString(),
            a_propos: {
                source: 'Maas App — onglet Finance > Simulation 2.0 > Projection fin de mois',
                methode: 'P1 = jours 1-10 et 25-fin, P2 = jours 11-24. Rythme par periode: '
                    + '70 % du reel + 30 % de l’historique quand au moins 5 jours sont '
                    + 'observes, sinon historique seul, sinon conversion depuis l’autre '
                    + 'periode via le coefficient.',
                ca_projete: 'Methode « derniers » (defaut): CA realise + proportion de volume x '
                    + 'Sigma(quantite x dernier prix de vente), ou la proportion vient de '
                    + 'l\u2019extrapolation P1/P2 lue en volume. Methode « rythmes »: CA realise '
                    + '+ jours P1 restants x rythme P1 + jours P2 restants x rythme P2, aux prix '
                    + 'de la periode. Le champ hypotheses.ca_methode dit laquelle a servi.',
                volumes: 'Quantites vendues projetees a prix de vente INCHANGE. La carcasse a '
                    + 'commander est plus lourde du parage: 1 kg vendu consomme 1/(1-parage) kg.',
                delta_equilibre: 'Kilos a vendre en plus (ou en moins) pour amener le PL projete '
                    + 'a la cible. Reparti au prorata du melange actuel.',
                prix_conseille: 'Prix a pratiquer sur le reste a vendre, a volume inchange, pour '
                    + 'combler le meme manque. Meme repartition que le delta equilibre.',
                marge: 'Les marges sont NETTES: cout carcasse divise par (1-parage) et commission '
                    + 'MaaS induite deduite.'
            },
            hypotheses: {
                ca_methode: etat.proj.caMethode === 'rythmes' ? 'rythmes' : 'derniers',
                // Les deux TERMES, pas seulement la phrase qui les decrit: sans
                // eux, un lecteur de l'export ne peut pas refaire l'identite
                // Somme(qte restante x dernier PV) = CA projete - CA realise.
                ca_plein_derniers_prix: projCalculee.ca_plein_derniers_prix,
                ca_projete_retenu: projCalculee.ca_projete_retenu,
                ponderation_reel: etat.proj.poidsReel,
                min_jours_mesures: etat.proj.minJours,
                exclure_dimanches: etat.proj.exclureDimanche,
                coefficient_p1_p2: projCalculee.coeff,
                origine_coefficient: projCalculee.origine_coeff,
                pl_cible: etat.proj.plCible,
                option_stock: etat.proj.stockOption,
                option_depenses: etat.proj.depensesOption,
                facteur_max_plafond: etat.proj.facteurMax,
                parage_bovin_pct: c.parageBovin,
                parage_ovin_pct: c.parageOvin,
                parage_base_pct: c.parageBase,
                commission_pct: c.commissionPct,
                prix_boeuf_teste: etat.proj.prixBoeufTeste,
                parage_boeuf_teste: etat.proj.parageBoeufTeste,
                ecart_parage_scenarios_pts: etat.proj.ecartParage
            },
            periode: projCalculee.periode,
            jours: projCalculee.jours,
            ca: projCalculee.ca,
            confiance: projCalculee.confiance,
            // Les DEUX taux, pour qu'un lecteur voie lequel a servi et ce que
            // l'autre aurait donne.
            taux_marge_courant: projCalculee.taux_marge_courant,
            taux_marge_constate_pct: projCalculee.taux_marge_constate,
            scenarios: projCalculee.scenarios,
            volumes_et_prix: projCalculee.volumes,
            plan_equilibre: projCalculee.plan_equilibre,
            recommandations: projCalculee.recommandations
        };
    }

    function exporterProjectionJson() {
        var sortie = construirePayloadProjection();
        if (!sortie) {
            if (typeof window.showToast === 'function') {
                window.showToast('Calcule la projection avant d’exporter.', 'warning');
            }
            return;
        }
        var nom = 'projection-' + (projCalculee.periode.debut || '') + '-au-'
            + (projCalculee.periode.fin || '') + '.json';
        var blob = new Blob([JSON.stringify(sortie, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = nom;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
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
        // Chaque case ecrit dans l'etat: la selection survit alors aux rendus
        // declenches par les autres controles.
        document.querySelectorAll('.sim2-suivi').forEach(function (el) {
            el.addEventListener('change', function () {
                if (!etat.proj.suivis) etat.proj.suivis = {};
                etat.proj.suivis[String(el.value).trim().toLowerCase()] = el.checked;
            });
        });
        // Prix de la suite du mois: 'change', comme les autres controles qui
        // declenchent un rendu complet - sinon le champ disparait sous les
        // doigts a la premiere frappe.
        document.querySelectorAll('.sim2-prix-suite').forEach(function (el) {
            el.addEventListener('change', function () {
                var v = el.value;
                if (v === '' || !(nb(v) > 0)) delete etat.proj.prixSuite[el.dataset.nom];
                else etat.proj.prixSuite[el.dataset.nom] = nb(v);
                rendre();
            });
        });
        var sauve = document.getElementById('sim2-suivi-save');
        if (sauve) sauve.addEventListener('click', enregistrerProduitsSuivis);

        // ECRITURE ADMIN STRICT (routes/simulation-v2.js: PUT /reglages exige
        // exactement 'admin', plus severe que checkAdvancedAccess). La
        // Simulation est desormais aussi VISIBLE a un 'user' et reste visible
        // a un superviseur: ni l'un ni l'autre ne doit voir un bouton qui
        // echouera en 403.
        if (String((window.currentUser || {}).role || '').toLowerCase() !== 'admin') {
            [sauve, document.getElementById('sim2-calibrer'), document.getElementById('sim2-calibrer-effacer')]
                .forEach(function (el) { if (el) el.style.display = 'none'; });
        }
        // 'change' et non 'input': ces controles declenchent un rendu complet,
        // qui remplace le champ en cours de saisie. Sur un nombre tape chiffre
        // par chiffre - 1, puis 12 - le focus etait perdu des le premier. Un
        // select emet 'change' des la selection, rien n'y est retarde.
        // La saisie des quantites restantes. 'change' et non 'input': chaque
        // validation redessine tout le bloc, et un rendu par chiffre tape
        // ferait perdre le focus des le premier caractere.
        document.querySelectorAll('.sim2-surcharge').forEach(function (el) {
            el.addEventListener('change', function () {
                var cle = el.dataset.cle;
                if (!cle) return;
                etat.proj.surchargesVolume = etat.proj.surchargesVolume || {};
                // Champ VIDE = retour a l'hypothese de mix. Un ZERO saisi est
                // une information differente et legitime - « on ne vendra plus
                // de gros ce mois-ci » - donc on ne les confond pas.
                if (el.value === '') delete etat.proj.surchargesVolume[cle];
                else etat.proj.surchargesVolume[cle] = { reste: Math.max(0, nb(el.value)) };
                rendre();
            });
        });
        var razSurcharge = document.getElementById('sim2-surcharge-reset');
        if (razSurcharge) {
            razSurcharge.addEventListener('click', function () {
                etat.proj.surchargesVolume = {};
                rendre();
            });
        }
        document.querySelectorAll('.sim2-proj-ctl').forEach(function (el) {
            el.addEventListener('change', function () {
                var k = el.dataset.k;
                if (k === 'stockOption') etat.proj.stockOption = el.value;
                else if (k === 'depensesOption') etat.proj.depensesOption = el.value;
                else if (k === 'facteurMax') etat.proj.facteurMax = Math.max(1, nb(el.value) || 1);
                else if (k === 'ecartParage') etat.proj.ecartParage = Math.max(0, nb(el.value));
                else if (k === 'prixBoeufTeste') {
                    // Champ vide = on revient au cout constate, donc a un effet
                    // nul. Un zero, lui, serait une carcasse gratuite: on le
                    // refuse plutot que de l'afficher comme un gain.
                    // Le max="100000" du champ ne contraint que les fleches du
                    // spinner: une valeur saisie ou collee le franchit sans
                    // rien declencher. On borne donc ici aussi, comme le fait
                    // le champ de parage juste a cote.
                    var pb = nb(el.value);
                    etat.proj.prixBoeufTeste = (el.value === '' || !(pb > 0))
                        ? null
                        : Math.min(100000, pb);
                }
                else if (k === 'plCible') {
                    // Champ vide = l'equilibre, pas « pas de cible ». Et une
                    // cible NEGATIVE est legitime: accepter de perdre 50 000 F
                    // ce mois-ci est un arbitrage, pas une erreur de saisie.
                    etat.proj.plCible = el.value === '' ? 0 : nb(el.value);
                }
                else if (k === 'parageBoeufTeste') {
                    // Contrairement au prix, un parage de ZERO est legitime -
                    // une carcasse qui ne perd rien a la decoupe. On ne revient
                    // donc au taux constate que sur un champ vide, jamais sur
                    // un zero saisi. Borne a 99: a 100 % la carcasse ne rend
                    // plus rien et 1/(1-parage) partirait a l'infini.
                    etat.proj.parageBoeufTeste = el.value === ''
                        ? null
                        : Math.min(99, Math.max(0, nb(el.value)));
                }
                else if (k === 'caMethode') etat.proj.caMethode = el.value;
                else if (k === 'surchargeMode') etat.proj.surchargeMode = el.value;
                else if (k === 'exclureDimanche') etat.proj.exclureDimanche = el.checked;
                else if (k === 'poidsReel') etat.proj.poidsReel = nb(el.value);
                else if (k === 'coeff') etat.proj.coeff = el.value === '' ? null : nb(el.value);
                rendre();
            });
        });
        var btnCal = document.getElementById('sim2-calibrer');
        if (btnCal) {
            btnCal.addEventListener('click', function () {
                enregistrerCalibration(nb(btnCal.dataset.valeur), btnCal);
            });
        }
        var btnCalX = document.getElementById('sim2-calibrer-effacer');
        if (btnCalX) {
            // On CONFIRME avant d'effacer: la calibration vaut pour tout le
            // point de vente, elle porte une signature qu'on ne retrouvera
            // pas, et le bouton est a un centimetre de « Recalibrer ». Un clic
            // de travers ne doit pas defaire une decision prise par quelqu'un
            // d'autre, un autre jour.
            btnCalX.addEventListener('click', function () {
                var question = 'Supprimer la calibration enregistrée ? Le coefficient '
                    + 'repassera au calcul en direct, pour tout le point de vente. '
                    + 'La date et l\'auteur de la calibration actuelle seront perdus.';
                if (typeof showConfirmModal === 'function') {
                    showConfirmModal(question, {
                        title: 'Effacer la calibration', okLabel: 'Effacer', okVariant: 'danger'
                    }).then(function (ok) {
                        if (ok) enregistrerCalibration(null, btnCalX);
                    });
                } else if (confirm(question)) {
                    enregistrerCalibration(null, btnCalX);
                }
            });
        }

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
            //
            // 'user' compris depuis que la Simulation lui est ouverte en
            // lecture: sans lui ici, l'onglet s'affichait mais le moteur v2
            // n'etait jamais injecte, et il tombait sur la v1 - un ecran
            // different de celui que voient les autres roles, pour les memes
            // chiffres. Ses boutons d'ecriture sont masques plus bas.
            if (['admin', 'superviseur', 'user'].indexOf(role) < 0) return;
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
