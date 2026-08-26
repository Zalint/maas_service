/**
 * UI de l'onglet Finance.
 *
 * Sections:
 *   - creances : affiche les chiffres (ce que je dois, il me doit, paiements),
 *                detail par produit, et permet d'enregistrer un paiement au
 *                fournisseur.
 *   - depenses : saisie d'une depense (avec justificatif uploade), liste
 *                filtrable, suppression, telechargement du justificatif.
 *   - prix     : edition du catalogue prix fournisseur + commission_pct.
 *
 * Toutes les routes appelees sont gates server-side par checkAdvancedAccess.
 */

(function () {
    'use strict';

    const fmtMoney = (n) => (Math.round(parseFloat(n) || 0)).toLocaleString('fr-FR') + ' FCFA';
    // Variante HTML qui separe le suffixe FCFA en span muted (utilise dans
    // les valeurs KPI pour mettre l'accent sur le chiffre).
    const fmtAmount = (n) => {
        const num = (Math.round(parseFloat(n) || 0)).toLocaleString('fr-FR');
        return `${num}<span class="fin-kpi-currency">FCFA</span>`;
    };
    // Une QUANTITE, a la francaise et au dixieme au moins. Le pendant de
    // fmtMoney pour ce qui se compte en kilos et non en francs.
    //
    // js/simulation-v2.js porte un helper du meme nom (ligne 44) et la meme
    // implementation; ce fichier-ci n'en avait pas, et l'emprunter sans le
    // definir levait « fmtDec is not defined » a l'ouverture du panneau. Les
    // deux fichiers sont des scripts independants: rien ne circule de l'un a
    // l'autre.
    const fmtDec = (v) => {
        if (v === null || v === undefined || isNaN(v)) return '—';
        const s = Math.abs(v).toLocaleString('fr-FR', {
            minimumFractionDigits: 1, maximumFractionDigits: 2
        });
        return (v < 0 ? '−' : '') + s;
    };
    // Lecture numerique tolerante: une absence vaut zero, jamais NaN.
    //
    // AU NIVEAU DU MODULE, et non dans renderPl ou il vivait: rendreEcartJour
    // s'en sert aussi, et un helper enferme dans une autre fonction s'emprunte
    // sans erreur a l'ecriture pour lever « nb is not defined » a l'execution -
    // que les tests ne voient pas, puisqu'ils n'exercent pas le rendu.
    const nb = (v) => {
        const x = parseFloat(v);
        return Number.isFinite(x) ? x : 0;
    };
    // Les GUILLEMETS aussi: sans eux, une valeur placee dans un attribut
    // pourrait en sortir. Aucun gabarit n'en met aujourd'hui, mais les
    // libelles rendus viennent de la base - categorie de depense, commentaire
    // de versement - et il suffirait d'un `title="${...}"` ajoute plus tard.
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // Construit le markup d'une carte KPI Finance.
    // tone: 'warning' | 'success' | 'danger' | 'info' | 'neutral'
    function kpiCard(tone, icon, label, valueHtml, trendHtml) {
        const trend = trendHtml ? `<div class="fin-kpi-trend">${trendHtml}</div>` : '';
        return `
            <div class="col-md-3 mb-2">
                <div class="card fin-kpi-card h-100 border-0">
                    <div class="card-body">
                        <div class="d-flex align-items-start gap-3">
                            <div class="fin-kpi-icon fin-kpi-icon--${tone}">
                                <i class="bi bi-${icon}"></i>
                            </div>
                            <div class="flex-grow-1" style="min-width:0">
                                <div class="fin-kpi-label">${label}</div>
                                <div class="fin-kpi-value">${valueHtml}</div>
                                ${trend}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ===== Setup au DOMContentLoaded =====
    document.addEventListener('DOMContentLoaded', () => {
        const financeTab = document.getElementById('finance-tab');
        const financeSection = document.getElementById('finance-section');
        if (!financeTab || !financeSection) return;

        financeTab.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof hideAllSections === 'function') hideAllSections();
            financeSection.style.display = 'block';
            // Active la nav-link
            document.querySelectorAll('.nav-link.active').forEach((n) => n.classList.remove('active'));
            financeTab.classList.add('active');
            // Charger le pane par defaut (creances)
            ensureDefaultDates();
            activatePane('creances');
            loadCreances();
        });

        // Subnav (creances / cdc / depenses / prix / mapping / charges / pl)
        document.querySelectorAll('#finance-subnav [data-fin-tab]').forEach((link) => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = link.dataset.finTab;
                activatePane(target);
                if (target === 'creances') loadCreances();
                if (target === 'cdc') loadCdc();
                if (target === 'depenses') loadDepenses();
                if (target === 'prix') loadPrix();
                if (target === 'mapping') loadMapping();
                if (target === 'charges') loadCharges();
                if (target === 'pl') loadPl();
                if (target === 'cashstock') loadCashStock();
                if (target === 'simulation') loadSimulation();
            });
        });

        // Visibilité onglet PL: gerée cote script.js updateMenuVisibility
        // (meme pattern que finance-item et les autres elements menu).
        // Voir script.js apres "Onglet Finance - reserve a admin..."

        // Boutons Charges + PL
        const chargesSave = document.getElementById('fin-charges-save');
        if (chargesSave) chargesSave.addEventListener('click', onChargesSave);
        const chargesAdd = document.getElementById('fin-charges-add');
        if (chargesAdd) chargesAdd.addEventListener('click', () => addChargeRow('', '', 0, 99));
        // Changer de mois recharge les montants applicables a ce mois.
        const chargesMois = document.getElementById('fin-charges-mois');
        if (chargesMois) chargesMois.addEventListener('change', loadCharges);
        // Actualiser = recalcul FORCE; l'entree par l'onglet, elle, reutilise
        // le resultat deja affiche tant que la periode n'a pas change.
        const plRefresh = document.getElementById('fin-pl-refresh');
        if (plRefresh) plRefresh.addEventListener('click', () => loadPl(true));
        const cashStockRefresh = document.getElementById('fin-cashstock-refresh');
        if (cashStockRefresh) cashStockRefresh.addEventListener('click', () => loadCashStock(true));
        const simRefresh = document.getElementById('fin-sim-refresh');
        if (simRefresh) simRefresh.addEventListener('click', () => loadSimulation(true));
        // Export Excel + snapshots du PL.
        const plExport = document.getElementById('fin-pl-export');
        if (plExport) plExport.addEventListener('click', exporterPlExcel);
        const plExportJson = document.getElementById('fin-pl-export-json');
        if (plExportJson) plExportJson.addEventListener('click', () => exporterPlJson(plExportJson));
        const plSnapshotBtn = document.getElementById('fin-pl-snapshot');
        if (plSnapshotBtn) plSnapshotBtn.addEventListener('click', figerPlDuJour);
        const plHistorique = document.getElementById('fin-pl-historique');
        if (plHistorique) plHistorique.addEventListener('click', basculerHistoriquePl);
        // Changer le montant simule ne doit rien retelecharger: tout le calcul
        // est de l'arithmetique sur des donnees deja en memoire.
        const simBump = document.getElementById('fin-sim-bump');
        if (simBump) simBump.addEventListener('input', () => {
            if (simDernieresDonnees) renderSimulation(simDernieresDonnees);
        });
        // Cases a cocher: delegation sur le conteneur, car innerHTML les
        // reconstruit a chaque rendu et des listeners directs seraient perdus.
        const simResultEl = document.getElementById('fin-sim-result');
        if (simResultEl) simResultEl.addEventListener('change', (e) => {
            const c = e.target;
            if (c && c.id === 'fin-sim-tout') {
                simResultEl.querySelectorAll('[data-sim-produit]').forEach((box) => {
                    if (c.checked) simProduitsExclus.delete(box.dataset.simProduit);
                    else simProduitsExclus.add(box.dataset.simProduit);
                });
            } else if (c && c.dataset && c.dataset.simProduit) {
                if (c.checked) simProduitsExclus.delete(c.dataset.simProduit);
                else simProduitsExclus.add(c.dataset.simProduit);
            } else {
                return;
            }
            if (simDernieresDonnees) {
                // Le rendu detruit la case qui vient d'etre basculee. Sans
                // remise du focus sur son equivalente re-rendue, la barre
                // Espace au clavier ne fonctionne qu'une seule fois.
                const cibleFocus = c.id === 'fin-sim-tout'
                    ? '#fin-sim-tout'
                    : `[data-sim-produit="${CSS.escape(c.dataset.simProduit)}"]`;
                renderSimulation(simDernieresDonnees);
                const caseRendue = simResultEl.querySelector(cibleFocus);
                if (caseRendue) caseRendue.focus();
            }
        });
        const stockPertesSave = document.getElementById('fin-stock-pertes-save');
        if (stockPertesSave) stockPertesSave.addEventListener('click', onStockPertesSave);
        const stockPertesInput = document.getElementById('fin-stock-pertes-pct');
        if (stockPertesInput) {
            stockPertesInput.addEventListener('input', () => {
                const v = parseFloat(stockPertesInput.value);
                if (Number.isFinite(v)) updateStockCoeffDisplay(v);
            });
        }

        // Form paiement
        const paiementForm = document.getElementById('fin-paiement-form');
        if (paiementForm) paiementForm.addEventListener('submit', onPaiementSubmit);

        // Bouton refresh creances
        const creancesRefresh = document.getElementById('fin-creances-refresh');
        if (creancesRefresh) creancesRefresh.addEventListener('click', loadCreances);

        // Bouton refresh Centre de Decoupe
        const cdcRefresh = document.getElementById('fin-cdc-refresh');
        if (cdcRefresh) cdcRefresh.addEventListener('click', loadCdc);

        // Form depense
        const depenseForm = document.getElementById('fin-depense-form');
        if (depenseForm) depenseForm.addEventListener('submit', onDepenseSubmit);

        const depenseRefresh = document.getElementById('fin-depense-refresh');
        if (depenseRefresh) depenseRefresh.addEventListener('click', loadDepenses);

        // Boutons prix
        const prixSave = document.getElementById('fin-prix-save');
        if (prixSave) prixSave.addEventListener('click', onPrixSave);

        const prixAdd = document.getElementById('fin-prix-add');
        if (prixAdd) prixAdd.addEventListener('click', () => addPrixRow('', '', ''));

        // Sélecteur de date "voir les prix au ..." : recharge le catalogue en
        // mode as-of (lecture seule) quand une date est choisie, ou en mode
        // édition (prix courants) quand la date est vidée / "Aujourd'hui".
        const prixDate = document.getElementById('fin-prix-date');
        if (prixDate) prixDate.addEventListener('change', loadPrix);
        const prixDateToday = document.getElementById('fin-prix-date-today');
        if (prixDateToday) prixDateToday.addEventListener('click', () => {
            if (prixDate) prixDate.value = '';
            loadPrix();
        });

        const configSave = document.getElementById('fin-config-save');
        if (configSave) configSave.addEventListener('click', onConfigSave);

        // Export Excel du tableau "Detail par date (commission 3%)"
        const detailDateExport = document.getElementById('fin-detail-date-export');
        if (detailDateExport) detailDateExport.addEventListener('click', exportDetailParDateExcel);

        // Bascule "Grouper par date" du tableau Detail par date (re-rend sans
        // refaire d'appel reseau, a partir du dernier payload memorise).
        const detailDateGroup = document.getElementById('fin-detail-date-group');
        if (detailDateGroup) detailDateGroup.addEventListener('change', () => {
            if (_lastLocalData) renderDetailParDate(_lastLocalData);
        });

        // Boutons Mapping produits
        const mappingRefresh = document.getElementById('fin-mapping-refresh');
        if (mappingRefresh) mappingRefresh.addEventListener('click', loadMapping);
        const mappingBulk = document.getElementById('fin-mapping-bulk');
        if (mappingBulk) mappingBulk.addEventListener('click', onMappingBulkFromPrefix);
    });

    function ensureDefaultDates() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const todayISO = `${yyyy}-${mm}-${dd}`;
        const firstISO = `${yyyy}-${mm}-01`;
        for (const id of ['fin-creances-date-debut', 'fin-cdc-date-debut', 'fin-depense-date-debut', 'fin-pl-date-debut', 'fin-sim-date-debut']) {
            const el = document.getElementById(id);
            if (el && !el.value) el.value = firstISO;
        }
        for (const id of ['fin-creances-date-fin', 'fin-cdc-date-fin', 'fin-depense-date-fin', 'fin-pl-date-fin', 'fin-sim-date-fin']) {
            const el = document.getElementById(id);
            if (el && !el.value) el.value = todayISO;
        }
    }

    function activatePane(name) {
        document.querySelectorAll('#finance-subnav [data-fin-tab]').forEach((n) => {
            n.classList.toggle('active', n.dataset.finTab === name);
        });
        document.querySelectorAll('[data-fin-pane]').forEach((p) => {
            p.style.display = (p.dataset.finPane === name) ? 'block' : 'none';
        });
    }

    // ===== Créances =====

    async function loadCreances() {
        try {
            const dateDebut = document.getElementById('fin-creances-date-debut').value;
            const dateFin = document.getElementById('fin-creances-date-fin').value;
            const url = `/api/finance/creances?dateDebut=${encodeURIComponent(dateDebut)}&dateFin=${encodeURIComponent(dateFin)}`;
            const res = await fetch(url, { credentials: 'include' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Erreur');
            // Nouvelle structure: { local, cdb, cdb_error }
            // Defensif: passer la plage demandee a renderCdb pour pouvoir
            // filtrer cote UI les operations renvoyees par MataBanq
            // (l'endpoint /external/api/creance ignore actuellement
            // dateDebut/dateFin pour la liste operations + summary.date_selected).
            renderCdb(json.data.cdb, json.data.cdb_error, { dateDebut, dateFin });
            // Le rapprochement des avances vit sur le payload RACINE, pas sur
            // `local`: il croise les deux sources. renderDetailParDate ne
            // recevant que `local`, il faut le garder a part - sinon la
            // colonne « Avance partenaire » resterait vide en permanence.
            _lastRapprochement = json.data.rapprochement_avances || null;
            renderLocal(json.data.local);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur creances: ' + e.message, 'danger');
        }
    }

    // ===== Bloc 1: Créance officielle CDB (depuis MataBanq) =====
    function renderCdb(cdb, cdbError, range) {
        const status = document.getElementById('fin-cdb-status');
        const cards = document.getElementById('fin-cdb-cards');
        const tbody = document.querySelector('#fin-cdb-operations tbody');
        const totalBadge = document.getElementById('fin-cre-acc-cdb-total');
        if (!status || !cards || !tbody) return;

        if (!cdb) {
            status.className = 'fin-pill fin-pill--warning ms-2';
            status.textContent = cdbError ? ('Erreur: ' + cdbError) : 'API non configurée';
            cards.innerHTML = '';
            tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center">Données CDB indisponibles</td></tr>';
            if (totalBadge) totalBadge.textContent = '';
            return;
        }

        // L'API MataBanq retourne details[0].status[0] pour le client matche.
        const detail = (cdb.details && cdb.details[0]) || null;
        const clientStatus = (detail && detail.status && detail.status[0]) || null;
        const operationsRaw = (detail && detail.operations) || [];
        const summary = cdb.summary || null;
        const meta = cdb.metadata || {};

        // Defensif: MataBanq /external/api/creance retourne actuellement des
        // operations hors de la plage [dateDebut, dateFin] demandee (filtre
        // pas applique cote serveur, summary.date_selected force a today).
        // On re-filtre ici pour garantir un affichage coherent avec les
        // selecteurs de date. Comparaison lexicographique sur YYYY-MM-DD =
        // comparaison chronologique correcte. Ne touche PAS aux KPI (solde,
        // avances, remb, diff) qui sont calcules par MataBanq sur sa propre
        // fenetre — recomputer la somme des operations ici donnerait des
        // chiffres faux (solde_final est cumule, pas peripheral).
        const dd = range && range.dateDebut;
        const df = range && range.dateFin;
        const operations = (dd && df)
            ? operationsRaw.filter((op) => {
                const d = (op.date_operation || '').slice(0, 10);
                return d && d >= dd && d <= df;
              })
            : operationsRaw;

        const label = meta.label || (clientStatus && clientStatus.client_name) || '?';
        const director = (detail && detail.assigned_director) || '—';
        // Pill affiche la dateFin DEMANDEE (et non summary.date_selected
        // renvoyee par MataBanq qui peut etre incorrecte — souvent "today").
        // Si l'API renvoie un date_selected != dateFin demandee, on ajoute
        // un petit badge "!" non bloquant pour visibilite operationnelle:
        // les KPI peuvent refleter la mauvaise periode tant que le bug
        // upstream MataBanq n'est pas corrige.
        const requestedFin = df || (summary && summary.date_selected) || '';
        const apiDateSel = (summary && summary.date_selected) || '';
        const dateMismatch = df && apiDateSel && apiDateSel !== df;
        const mismatchBadge = dateMismatch
            ? ` <span class="badge bg-warning text-dark" title="L'API a renvoyé date_selected=${esc(apiDateSel)} pour dateFin demandée=${esc(df)}. Les KPI (solde, avances, remb) peuvent refléter la mauvaise période.">!</span>`
            : '';
        status.className = 'fin-pill fin-pill--success ms-2';
        status.innerHTML = `${esc(label)} • ${esc(requestedFin)}${mismatchBadge} • Resp: ${esc(director)}`;

        const solde = clientStatus ? clientStatus.solde_final : (summary ? summary.totals.current_balance : 0);
        const avances = clientStatus ? clientStatus.total_avances : 0;
        const remb = clientStatus ? clientStatus.total_remboursements : 0;
        const diff = summary ? (summary.totals.total_difference || 0) : 0;

        // Totaux SUR LA PERIODE choisie, sommes depuis `operations` (deja
        // filtree sur [dateDebut, dateFin] plus haut, comme le tableau).
        // A ne pas confondre avec total_avances / total_remboursements de
        // MataBanq juste au-dessus, qui sont des CUMULS ANNEE: verifie, le
        // service renvoie les memes valeurs qu'on lui demande 2 jours ou
        // l'annee entiere (metadata.year_filter). D'ou ces deux tuiles en
        // plus, qui elles suivent bien les selecteurs de date.
        const sumOpsPeriode = (match) => operations.reduce((s, op) => {
            const t = String(op.type || '').toLowerCase();
            return s + (match(t) ? (parseFloat(op.montant) || 0) : 0);
        }, 0);
        const avancesPeriode = sumOpsPeriode((t) => t === 'avance');
        const rembPeriode = sumOpsPeriode((t) => t.startsWith('rembours'));
        // Sous-titre des 2 tuiles: rappelle la plage pour lever l'ambiguite
        // avec les cumuls (JJ/MM -> JJ/MM).
        const jjmm = (iso) => {
            const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
            return m ? `${m[3]}/${m[2]}` : '';
        };
        const periodeLabel = (dd && df) ? `${jjmm(dd)} → ${jjmm(df)}` : 'période choisie';

        // Badge total dans le header de l'accordeon (visible meme replie)
        if (totalBadge) totalBadge.textContent = 'Solde ' + fmtMoney(solde);

        const diffSign = diff > 0 ? '+' : '';
        const trendCls = diff > 0 ? 'fin-kpi-trend--up'
                       : diff < 0 ? 'fin-kpi-trend--down'
                       : '';
        const trendIcon = diff > 0 ? 'arrow-up-right'
                        : diff < 0 ? 'arrow-down-right'
                        : 'dash';
        const trendLabel = diff === 0 ? 'Inchangé vs veille' : `${diffSign}${fmtMoney(diff)} vs veille`;

        cards.innerHTML = [
            kpiCard('warning', 'cash-stack',       'Solde dû au fournisseur', fmtAmount(solde),
                `<span class="${trendCls}"><i class="bi bi-${trendIcon} me-1"></i>${esc(trendLabel)}</span>`),
            kpiCard('danger',  'arrow-down-circle', 'Total avances',           fmtAmount(avances)),
            kpiCard('success', 'arrow-up-circle',   'Total remboursements',    fmtAmount(remb)),
            kpiCard('info',    'graph-up',          'Δ vs veille',             `${diffSign}${fmtAmount(diff)}`),
            kpiCard('danger',  'arrow-down-circle', 'Total avances (période)', fmtAmount(avancesPeriode),
                `<span class="text-muted">${esc(periodeLabel)}</span>`),
            kpiCard('success', 'arrow-up-circle',   'Total remboursements (période)', fmtAmount(rembPeriode),
                `<span class="text-muted">${esc(periodeLabel)}</span>`)
        ].join('');

        // Operations: tri descendant (timestamp si dispo, sinon date)
        const sorted = operations.slice().sort((a, b) => {
            const ta = a.timestamp || a.date_operation || '';
            const tb = b.timestamp || b.date_operation || '';
            return tb.localeCompare(ta);
        });
        tbody.innerHTML = sorted.map((op) => {
            const isAvance = String(op.type).toLowerCase() === 'avance';
            const badge = isAvance
                ? '<span class="fin-op fin-op--avance"><i class="bi bi-arrow-down-right"></i>Avance</span>'
                : '<span class="fin-op fin-op--remboursement"><i class="bi bi-arrow-up-right"></i>Remboursement</span>';
            return `
                <tr>
                    <td>${esc(op.date_operation || '')}</td>
                    <td>${badge}</td>
                    <td class="text-end">${esc(fmtMoney(op.montant))}</td>
                    <td>${esc(op.description || '')}</td>
                    <td><small class="text-muted">${esc(op.created_by || '')}</small></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="5" class="text-muted text-center">Aucune opération sur la période</td></tr>';
    }

    // ===== Bloc 2: Calcul Maas local (commission 3%) =====
    // Solde theorique recalcul cote UI sans la marge CDC pour matcher la
    // semantique du nouvel onglet separe (Solde = Je dois - Paiements).
    // Dernier payload local (Calcul Maas) rendu — sert a l'export Excel du
    // tableau "Detail par date" sans refaire d'appel reseau.
    let _lastLocalData = null;
    let _lastRapprochement = null;

    // Export Excel (.xlsx) du tableau "Detail par date (commission 3%)".
    // Exporte exactement les lignes affichees (dette > 0) + une ligne TOTAL.
    // Reutilise la lib SheetJS (XLSX) deja chargee globalement.
    function exportDetailParDateExcel() {
        if (typeof XLSX === 'undefined') {
            if (typeof showToast === 'function') showToast('Librairie Excel indisponible', 'danger');
            return;
        }
        const src = _lastLocalData && Array.isArray(_lastLocalData.detail_par_date)
            ? _lastLocalData.detail_par_date.filter((d) => d.dette > 0)
            : [];
        if (!src.length) {
            if (typeof showToast === 'function') showToast('Aucune donnée à exporter', 'warning');
            return;
        }
        const fmtDateFr = (iso) => window.datesFr.enFrancais(iso);
        // Le verdict est PAR DATE: chaque ligne d'une meme journee porte donc
        // la meme avance. La sommer par ligne la compterait autant de fois
        // qu'il y a de produits - d'ou le total calcule sur les dates.
        const parDateExp = (_lastRapprochement || {}).par_date || {};
        // SOURCE MUETTE: sans reponse du partenaire, toutes les dates sont
        // 'sans_avance'. Ecrire « aucune avance » dans le fichier ferait lire
        // une absence de LIVRAISON la ou il n'y a qu'une absence de REPONSE.
        // L'ecran le dit deja; l'export doit le dire aussi, sinon le fichier
        // survit a l'ecran et devient la version qui fait foi.
        const sourceMuette = (_lastRapprochement || {}).source_partenaire === 'indisponible';
        const avanceExport = (date) => {
            if (sourceMuette) return '';
            const e = parDateExp[String(date || '').slice(0, 10)];
            if (!e || e.avance == null) return '';
            return e.avance;
        };
        const ecartExport = (date) => {
            if (sourceMuette) return 'source partenaire indisponible';
            const e = parDateExp[String(date || '').slice(0, 10)];
            if (!e) return '';
            if (e.statut === 'sans_avance') return 'aucune avance';
            if (e.statut === 'incomplet') return 'indéterminé';
            return e.statut === 'correspond' ? 'concorde' : e.ecart;
        };
        const rows = src.map((d) => ({
            'Date': fmtDateFr(d.date),
            'Produit': d.produit,
            'Quantité éligible': d.quantite,
            'Prix achat fournisseur (FCFA)': d.prix_achat == null ? '' : d.prix_achat,
            'Qté × Prix achat': d.montant_achat == null ? '' : d.montant_achat,
            // MEME colonne qu'a l'ecran: un export qui en dit moins que le
            // tableau oblige a refaire le rapprochement a la main.
            'Avance partenaire': avanceExport(d.date),
            'Écart vs avance': ecartExport(d.date),
            'Je dois (3%)': d.dette
        }));
        // Ligne TOTAL (memes sommes que le pied de tableau a l'ecran).
        const totAchat = src.reduce((s, d) => s + (d.montant_achat || 0), 0);
        const totDette = src.reduce((s, d) => s + (d.dette || 0), 0);
        rows.push({
            'Date': 'TOTAL',
            'Produit': '',
            'Quantité éligible': '',
            'Prix achat fournisseur (FCFA)': '',
            'Qté × Prix achat': totAchat,
            'Avance partenaire': Array.from(new Set(src.map((d) => String(d.date || '').slice(0, 10))))
                .reduce((t, dt) => t + ((parDateExp[dt] || {}).avance || 0), 0),
            'Écart vs avance': '',
            'Je dois (3%)': totDette
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Détail par date');
        const debut = (document.getElementById('fin-creances-date-debut') || {}).value || '';
        const fin = (document.getElementById('fin-creances-date-fin') || {}).value || '';
        const suffix = debut && fin ? `${debut}_${fin}` : new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `detail_par_date_commission_${suffix}.xlsx`);
        if (typeof showToast === 'function') showToast('Export Excel réussi', 'success');
    }

    // Rendu du tableau "Detail par date (commission 3%)".
    // 2 modes selon la case "Grouper par date":
    //  - plat: une ligne par (date, produit) (defaut).
    //  - groupe: une ligne-resume repliable par date (total du jour) +
    //    lignes produits masquees, depliees au clic. Simplifie la
    //    reconciliation par date quand une date a plusieurs produits.
    function renderDetailParDate(data) {
        const tbodyDate = document.querySelector('#fin-creances-detail-date tbody');
        if (!tbodyDate) return;
        const fmtDateFr = (iso) => window.datesFr.enFrancais(iso);
        const r2 = (n) => Math.round((n || 0) * 100) / 100;
        const tiret = '<span class="text-muted">—</span>';
        const detailDate = (data.detail_par_date || []).filter((d) => d.dette > 0);
        const grouped = !!(document.getElementById('fin-detail-date-group') || {}).checked;

        // LA COLONNE « AVANCE PARTENAIRE ».
        //
        // « Detail par date » dit ce que Maas a RECU, valorise au prix d'achat
        // fournisseur; MataBanq enregistre une AVANCE le jour ou la
        // marchandise part. Les deux decrivent la meme livraison par deux
        // bouts et doivent tomber sur le meme montant - verifie au franc sur
        // aout 2026 (le 17/08: 688 500 + 8 000 = 696 500 = l'avance).
        //
        // LA COMPARAISON EST PAR DATE, jamais par ligne: une journee porte
        // plusieurs produits et une seule avance. En mode deplie, chaque ligne
        // porte donc le verdict de SA JOURNEE, et le dit.
        const rappro = _lastRapprochement || {};
        const rapproParDate = rappro.par_date || {};
        const celluleAvance = (date) => {
            const e = rapproParDate[String(date || '').slice(0, 10)];
            if (rappro.source_partenaire === 'indisponible') {
                return `<td class="text-end text-muted" title="La source du partenaire n'a pas répondu : aucune avance n'a pu être lue.">?</td>`;
            }
            if (!e) return `<td class="text-end">${tiret}</td>`;
            if (e.statut === 'correspond') {
                return `<td class="text-end text-success"
                    title="Le total de la journée (${esc(fmtMoney(e.montant_achat))}) correspond à l'avance du partenaire, à ${esc(String(rappro.tolerance))} F près.">
                    ✓ ${esc(fmtMoney(e.avance))}</td>`;
            }
            if (e.statut === 'sans_avance') {
                return `<td class="text-end text-warning-emphasis"
                    title="Aucune avance enregistrée chez le partenaire ce jour-là. La marchandise a pu être livrée sous une autre date.">
                    aucune avance</td>`;
            }
            if (e.statut === 'incomplet') {
                return `<td class="text-end text-muted"
                    title="${esc(String(e.nb_sans_prix))} produit(s) sans prix d'achat connu ce jour-là : le total de la journée est incomplet, ni l'accord ni l'écart ne peuvent être affirmés.">
                    indéterminé</td>`;
            }
            return `<td class="text-end text-danger fw-medium"
                title="Total de la journée ${esc(fmtMoney(e.montant_achat))} contre une avance de ${esc(fmtMoney(e.avance))} : ${esc(fmtMoney(Math.abs(e.ecart)))} d'écart sur ${esc(String(e.nb_produits))} produit(s).">
                ${esc(fmtMoney(e.avance))}
                <span class="d-block small">${e.ecart > 0 ? '+' : '−'}${esc(fmtMoney(Math.abs(e.ecart)))}</span></td>`;
        };

        const productRow = (d, cls) => `
            <tr${cls ? ` class="${cls}" style="display:none"` : ''}>
                <td>${grouped ? '' : esc(fmtDateFr(d.date))}</td>
                <td${grouped ? ' class="ps-4"' : ''}>${esc(d.produit)}</td>
                <td class="text-end">${esc(d.quantite)}</td>
                <td class="text-end">${d.prix_achat == null ? tiret : esc(fmtMoney(d.prix_achat))}</td>
                <td class="text-end">${d.montant_achat == null ? tiret : esc(fmtMoney(d.montant_achat))}</td>
                ${cls
                    // LIGNE PRODUIT D'UNE DATE DEPLIEE: la cellule reste vide.
                    // Le verdict est celui de la JOURNEE, et la ligne de date
                    // juste au-dessus le porte deja. Le repeter sur chaque
                    // produit donnait quatre fois « 496 969 +1 756 » sous le
                    // 14/08 - une repetition qui se lit comme quatre constats
                    // alors qu'il n'y en a qu'un.
                    ? '<td></td>'
                    // MODE A PLAT: aucune ligne de date n'existe, chaque ligne
                    // doit donc porter le verdict de la sienne.
                    : celluleAvance(d.date)}
                <td class="text-end">${esc(fmtMoney(d.dette))}</td>
            </tr>`;

        if (!detailDate.length) {
            tbodyDate.innerHTML = '<tr><td colspan="7" class="text-muted text-center">Aucune livraison éligible sur la période</td></tr>';
        } else if (!grouped) {
            tbodyDate.innerHTML = detailDate.map((d) => productRow(d)).join('');
        } else {
            // Regrouper par date en conservant l'ordre (date desc du backend).
            const order = [];
            const groups = new Map();
            for (const d of detailDate) {
                if (!groups.has(d.date)) { groups.set(d.date, []); order.push(d.date); }
                groups.get(d.date).push(d);
            }
            let html = '';
            order.forEach((date, i) => {
                const items = groups.get(date);
                const qte = r2(items.reduce((s, d) => s + (d.quantite || 0), 0));
                const achat = items.reduce((s, d) => s + (d.montant_achat || 0), 0);
                const dette = items.reduce((s, d) => s + (d.dette || 0), 0);
                const gid = 'ddg-' + i;
                html += `
                    <tr class="table-light fw-medium dd-group-header" data-dd-group="${gid}" style="cursor:pointer">
                        <td><i class="bi bi-chevron-right dd-chevron me-1"></i>${esc(fmtDateFr(date))}</td>
                        <td><span class="badge bg-secondary rounded-pill">${items.length} produit${items.length > 1 ? 's' : ''}</span></td>
                        <td class="text-end">${esc(qte)}</td>
                        <td class="text-end">${tiret}</td>
                        <td class="text-end">${esc(fmtMoney(achat))}</td>
                        ${celluleAvance(date)}
                        <td class="text-end">${esc(fmtMoney(dette))}</td>
                    </tr>`;
                html += items.map((d) => productRow(d, 'dd-child ' + gid)).join('');
            });
            tbodyDate.innerHTML = html;
            // Clic sur une ligne-resume: plie/deplie les produits de la date.
            tbodyDate.querySelectorAll('.dd-group-header').forEach((hdr) => {
                hdr.addEventListener('click', () => {
                    const gid = hdr.dataset.ddGroup;
                    const open = hdr.classList.toggle('dd-open');
                    const chev = hdr.querySelector('.dd-chevron');
                    if (chev) chev.className = 'bi dd-chevron me-1 ' + (open ? 'bi-chevron-down' : 'bi-chevron-right');
                    tbodyDate.querySelectorAll('.dd-child.' + gid).forEach((row) => {
                        row.style.display = open ? '' : 'none';
                    });
                });
            });
        }

        // Ligne de total (dates choisies): somme de "Qté × Prix achat" et
        // "Je dois (3%)" sur les lignes affichees (identique dans les 2 modes).
        // Le total "Je dois" egale le KPI ce_que_je_dois. Cache si aucune ligne.
        const foot = document.getElementById('fin-creances-detail-date-foot');
        if (foot) {
            if (detailDate.length) {
                const totAchat = detailDate.reduce((s, d) => s + (d.montant_achat || 0), 0);
                const totDette = detailDate.reduce((s, d) => s + (d.dette || 0), 0);
                const elA = document.getElementById('fin-cre-dd-total-achat');
                const elD = document.getElementById('fin-cre-dd-total-dette');
                if (elA) elA.textContent = fmtMoney(totAchat);
                if (elD) elD.textContent = fmtMoney(totDette);
                // LE TOTAL DES AVANCES ne se somme QUE sur les dates affichees,
                // et une avance ne doit etre comptee qu'une fois meme quand sa
                // journee porte cinq produits - d'ou le passage par un Set de
                // dates plutot que par les lignes.
                const elAv = document.getElementById('fin-cre-dd-total-avance');
                if (elAv) {
                    const datesVues = new Set(detailDate.map((d) => String(d.date || '').slice(0, 10)));
                    let totAvance = 0, nbEcart = 0, nbSansAvance = 0, nbIncomplet = 0;
                    let ecartTotal = 0;
                    datesVues.forEach((dt) => {
                        const e = rapproParDate[dt];
                        if (!e) return;
                        if (e.avance != null) totAvance += e.avance;
                        // MEME SIGNE QUE LES CELLULES. Le module rend
                        // ecart = detail - avance, et la cellule du 19/08
                        // affiche donc « -3 000 ». Un pied calcule en
                        // avance - detail affichait « +3 000 » pour le meme
                        // fait, dans la meme colonne.
                        if (e.statut === 'ecart') { nbEcart += 1; ecartTotal += nb(e.ecart); }
                        if (e.statut === 'sans_avance') nbSansAvance += 1;
                        // INCOMPLET NE COMPTE PAS dans l'ecart: sa journee a un
                        // produit sans prix d'achat, donc un total partiel.
                        // L'opposer a l'avance fabriquerait un ecart rouge que
                        // le module refuse d'affirmer et qu'aucune ligne du
                        // tableau ne designe.
                        if (e.statut === 'incomplet') nbIncomplet += 1;
                    });
                    const reserve = (nbIncomplet
                        ? ` <span class="d-block small text-muted">${esc(String(nbIncomplet))} date(s) indéterminée(s), hors écart</span>`
                        : '')
                        + (nbSansAvance
                            ? ` <span class="d-block small text-warning-emphasis">${esc(String(nbSansAvance))} date(s) sans avance</span>`
                            : '');
                    elAv.innerHTML = rappro.source_partenaire === 'indisponible'
                        ? '<span class="text-muted">source indisponible</span>'
                        : esc(fmtMoney(totAvance))
                          + (nbEcart > 0
                              ? `<span class="d-block small text-danger">${ecartTotal > 0 ? '+' : '−'}${esc(fmtMoney(Math.abs(ecartTotal)))}`
                                + (nbEcart ? ` sur ${esc(String(nbEcart))} date(s)` : '')
                                + '</span>'
                              : '<span class="d-block small text-success">concorde</span>')
                          + reserve;

                    // LES AVANCES SANS AUCUNE LIGNE DE DETAIL. Le module les
                    // calcule depuis le debut, rien ne les affichait, et le
                    // pied concluait « concorde » sans les avoir vues. Une
                    // livraison partie de chez MATA et jamais recue cote Maas
                    // est pourtant exactement ce que ce rapprochement cherche.
                    const orphelines = ((rappro.resume || {}).avances_sans_detail) || [];
                    const elOrph = document.getElementById('fin-cre-dd-orphelines');
                    if (elOrph) {
                        elOrph.innerHTML = (orphelines.length && rappro.source_partenaire !== 'indisponible')
                            ? `<div class="alert alert-warning py-2 px-2 small mb-0 mt-2">
                                ${esc(String(orphelines.length))} avance(s) du partenaire n'ont
                                <strong>aucune livraison en face</strong> sur la période, pour
                                ${esc(fmtMoney(orphelines.reduce((t, o) => t + nb(o.montant), 0)))} :
                                ${esc(orphelines.slice(0, 6).map((o) => fmtDateFr(o.date)
                                    + ' (' + fmtMoney(o.montant) + ')').join(', '))}${
                                  orphelines.length > 6 ? '…' : ''}.
                                Marchandise partie de chez MATA sans être reçue côté Maas, ou reçue
                                sous une autre date.</div>`
                            : '';
                    }
                }
                foot.style.display = '';
            } else {
                foot.style.display = 'none';
                const elOrph = document.getElementById('fin-cre-dd-orphelines');
                if (elOrph) elOrph.innerHTML = '';
            }
        }
    }

    function renderLocal(data) {
        _lastLocalData = data;
        const cards = document.getElementById('fin-creances-cards');
        const soldeCommission = (data.ce_que_je_dois || 0) - (data.paiements_effectues || 0);

        // Badges totaux dans les headers d'accordeon (visibles meme replies)
        const maasBadge = document.getElementById('fin-cre-acc-maas-total');
        if (maasBadge) maasBadge.textContent = 'Je dois ' + fmtMoney(data.ce_que_je_dois || 0);
        const paiementsBadge = document.getElementById('fin-cre-acc-paiements-total');
        if (paiementsBadge) paiementsBadge.textContent = 'Payé ' + fmtMoney(data.paiements_effectues || 0);
        // 3 cartes au lieu de 4 (col-md-4). On override la col du helper.
        const card3 = (tone, icon, label, valueHtml) => kpiCard(tone, icon, label, valueHtml)
            .replace('col-md-3', 'col-md-4');
        cards.innerHTML = [
            card3('warning', 'percent',    `Je dois (${data.commission_pct}% sur livraisons ${data.categories_eligibles.join('/')})`, fmtAmount(data.ce_que_je_dois)),
            card3('info',    'wallet2',    'Paiements locaux saisis',     fmtAmount(data.paiements_effectues)),
            card3('neutral', 'calculator', 'Solde commission (Je dois − Paiements)', fmtAmount(soldeCommission))
        ].join('');

        const tbody = document.querySelector('#fin-creances-detail tbody');
        const detailDette = data.detail.filter((d) => d.dette > 0);
        tbody.innerHTML = detailDette.map((d) => `
            <tr>
                <td>${esc(d.produit)}</td>
                <td class="text-end">${esc(d.quantite)}</td>
                <td class="text-end">${esc(fmtMoney(d.dette))}</td>
            </tr>
        `).join('') || '<tr><td colspan="3" class="text-muted text-center">Aucune livraison éligible sur la période</td></tr>';

        // Detail par date : meme semantique (commission 3% sur ventes eligibles),
        // tri par date desc (jours recents en haut). Date format YYYY-MM-DD du
        // backend converti en DD/MM/YYYY pour lisibilite FR. Filtre dette>0
        // pour ne pas montrer les jours sans vente eligible.
        renderDetailParDate(data);

        const pbody = document.querySelector('#fin-paiements-list tbody');
        pbody.innerHTML = data.paiements.map((p) => `
            <tr>
                <td>${esc(p.date)}</td>
                <td class="text-end">${esc(fmtMoney(p.montant))}</td>
                <td>${esc(p.mode || '')}</td>
                <td>${esc(p.reference || '')}</td>
                <td>${esc(p.commentaire || '')}</td>
                <td><button class="btn btn-sm btn-outline-danger" data-paiement-delete="${p.id}">×</button></td>
            </tr>
        `).join('') || '<tr><td colspan="6" class="text-muted text-center">Aucun paiement sur la période</td></tr>';

        pbody.querySelectorAll('[data-paiement-delete]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.paiementDelete;
                if (typeof showConfirmModal === 'function') {
                    const ok = await showConfirmModal('Supprimer ce paiement ?', {
                        title: 'Supprimer', okLabel: 'Supprimer', okVariant: 'danger'
                    });
                    if (!ok) return;
                } else if (!confirm('Supprimer ce paiement ?')) {
                    return;
                }
                const res = await fetch('/api/finance/paiements/' + id, { method: 'DELETE', credentials: 'include' });
                const j = await res.json();
                if (!j.success) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + j.error, 'danger');
                    return;
                }
                loadCreances();
            });
        });
    }

    async function onPaiementSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        const body = Object.fromEntries(fd.entries());
        try {
            const res = await fetch('/api/finance/paiements', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur');
            form.reset();
            if (typeof showToast === 'function') showToast('Paiement enregistré', 'success');
            loadCreances();
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
        }
    }

    // ===== Centre de Découpe (marge "Il me doit") =====

    async function loadCdc() {
        try {
            const dateDebut = document.getElementById('fin-cdc-date-debut').value;
            const dateFin = document.getElementById('fin-cdc-date-fin').value;
            // Reutilise le meme endpoint /api/finance/creances mais on ne
            // garde que la partie "recevable" / detail.quantite_cdc cote rendu.
            const url = `/api/finance/creances?dateDebut=${encodeURIComponent(dateDebut)}&dateFin=${encodeURIComponent(dateFin)}`;
            const res = await fetch(url, { credentials: 'include' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Erreur');
            renderCdc(json.data.local);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur Centre Découpe: ' + e.message, 'danger');
        }
    }

    // Cache du dernier payload CDC pour permettre le drill-down "Details"
    // sans devoir refaire le calcul cote serveur.
    let _cdcLastData = null;

    function renderCdc(data) {
        const cards = document.getElementById('fin-cdc-cards');
        const accordion = document.getElementById('fin-cdc-accordion');
        if (!cards || !accordion) return;

        _cdcLastData = data;

        const parCentre = Array.isArray(data.detail_cdc_par_centre)
            ? data.detail_cdc_par_centre
            : [];

        const totalRecevable = data.ce_qu_il_me_doit || 0;
        const totalQuantiteCdc = parCentre.reduce((s, c) => s + (c.total_quantite || 0), 0);
        const margeMoyenneKg = totalQuantiteCdc > 0 ? (totalRecevable / totalQuantiteCdc) : 0;

        const card3 = (tone, icon, label, valueHtml) => kpiCard(tone, icon, label, valueHtml)
            .replace('col-md-3', 'col-md-4');
        cards.innerHTML = [
            card3('success', 'coin',      'Il me doit (total marge)', fmtAmount(totalRecevable)),
            card3('info',    'box-seam',  'Quantité CDC totale',      `${totalQuantiteCdc}<span class="fin-kpi-currency">kg</span>`),
            card3('neutral', 'bar-chart', 'Marge moyenne / kg',       fmtAmount(margeMoyenneKg))
        ].join('');

        if (parCentre.length === 0) {
            accordion.innerHTML = '<div class="alert alert-light border text-muted small mb-0">Aucune vente via un Centre de Découpe sur la période.</div>';
            return;
        }

        // Un item d'accordeon par centre. Chaque item est independamment
        // pliable (pas de data-bs-parent => l'ouverture de l'un ne ferme
        // pas les autres). Le premier est ouvert par defaut.
        accordion.innerHTML = parCentre.map((c, idx) => {
            const collapseId = 'fin-cdc-coll-' + idx;
            const isOpen = idx === 0;
            const headerBtnCls = 'accordion-button' + (isOpen ? '' : ' collapsed');
            const collapseCls = 'accordion-collapse collapse' + (isOpen ? ' show' : '');
            // Helper: rend une cellule editable (input + save + history btns)
            // commun aux 3 prix: vente fournisseur, achat, vente CDC. Le
            // data-attribute "kind" identifie le type pour le wiring JS.
            const editablePrixCell = (kind, courant, moyenPit, title) => {
                const courantVal = courant != null ? courant : '';
                const differs = (moyenPit != null && courantVal !== ''
                    && Math.abs(moyenPit - courantVal) > 0.01);
                const moyenBadge = differs
                    ? `<span class="badge bg-warning text-dark mt-1" style="font-size:0.65rem" title="Moyenne pondérée effective (point-in-time) pour les ventes de la période. Différente du courant car des ventes anciennes ont utilisé un autre prix.">moy. ${fmtMoney(moyenPit)}</span>`
                    : '';
                return `
                    <td class="text-end" style="min-width:175px">
                        <div class="d-inline-flex flex-column align-items-end gap-1" style="white-space:nowrap">
                            <div class="d-inline-flex align-items-center gap-1">
                                <input type="number" min="0" step="1" class="form-control form-control-sm text-end"
                                       style="width:85px"
                                       value="${esc(courantVal)}"
                                       data-prix-input="${kind}"
                                       title="${title}">
                                <button type="button" class="btn btn-sm btn-success py-0 px-1"
                                        data-prix-save="${kind}"
                                        title="Sauvegarder">
                                    <i class="bi bi-check2"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1"
                                        data-prix-history="${kind}"
                                        title="Voir l'historique">
                                    <i class="bi bi-clock-history"></i>
                                </button>
                            </div>
                            ${moyenBadge}
                        </div>
                    </td>
                `;
            };

            const rows = c.detail.map((d, lineIdx) => {
                // Cible des PUT prix-* = entree catalogue (ex: "Boeuf"), pas
                // le libelle vente (ex: "Boeuf en detail" qui resout vers Boeuf
                // via alias/prefix).
                const produitCatalog = d.produit_catalog || d.produit;
                // Hint visuel quand le libelle vente differe du nom catalogue
                // (= ce produit passe par alias ou prefix matching).
                const catalogHint = (d.produit_catalog && d.produit_catalog !== d.produit)
                    ? `<div class="small text-muted" title="Les prix edites ici modifient l'entree catalogue '${esc(d.produit_catalog)}', qui s'applique a toutes les variantes de ce produit (ex: en gros/en detail).">→ catalogue: <span class="fw-medium">${esc(d.produit_catalog)}</span></div>`
                    : '';
                return `
                <tr data-cdc-row data-centre-idx="${idx}" data-line-idx="${lineIdx}" data-produit="${esc(produitCatalog)}" data-produit-vente="${esc(d.produit)}">
                    <td>
                        ${esc(d.produit)}
                        ${catalogHint}
                    </td>
                    <td class="text-end">${esc(d.quantite_cdc)}</td>
                    ${editablePrixCell('prix_vente', d.prix_vente_courant, d.prix_vente_moyen, 'Prix vente fournisseur (commission 3%) — édite l\'entrée catalogue ' + produitCatalog)}
                    ${editablePrixCell('prix_achat', d.prix_achat_courant, d.prix_achat, 'Prix achat fournisseur — édite l\'entrée catalogue ' + produitCatalog)}
                    ${editablePrixCell('prix_vente_cdc', d.prix_vente_cdc_courant, d.prix_vente_cdc, 'Prix vente CDC (négocié B2B) — édite l\'entrée catalogue ' + produitCatalog)}
                    <td class="text-end">${esc(fmtMoney(d.marge_unitaire))}</td>
                    <td class="text-end fw-bold">${esc(fmtMoney(d.recevable))}</td>
                    <td class="text-end">
                        <button type="button" class="btn btn-sm btn-outline-primary"
                                data-cdc-details
                                data-centre-idx="${idx}"
                                data-line-idx="${lineIdx}">
                            <i class="bi bi-zoom-in"></i> Détails
                        </button>
                    </td>
                </tr>
            `;
            }).join('') || '<tr><td colspan="8" class="text-muted text-center">Aucune ligne</td></tr>';
            return `
                <div class="accordion-item">
                    <h2 class="accordion-header">
                        <button class="${headerBtnCls}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="${collapseId}">
                            <span class="me-3"><i class="bi bi-truck me-1"></i><strong>${esc(c.centre)}</strong></span>
                            <span class="fin-pill fin-pill--info me-2">${esc(c.total_quantite)} kg</span>
                            <span class="fin-pill fin-pill--success">${esc(fmtMoney(c.total_recevable))}</span>
                        </button>
                    </h2>
                    <div id="${collapseId}" class="${collapseCls}">
                        <div class="accordion-body p-0">
                            <table class="table table-sm table-striped mb-0">
                                <thead>
                                    <tr>
                                        <th>Produit</th>
                                        <th class="text-end">Quantité</th>
                                        <th class="text-end">Prix vente fourn.</th>
                                        <th class="text-end">Prix achat fourn.</th>
                                        <th class="text-end">Prix vente CDC</th>
                                        <th class="text-end">Marge unitaire</th>
                                        <th class="text-end">Il me doit</th>
                                        <th class="text-end"></th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Wire les boutons "Details" (delegation)
        accordion.querySelectorAll('[data-cdc-details]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const centreIdx = parseInt(btn.dataset.centreIdx, 10);
                const lineIdx = parseInt(btn.dataset.lineIdx, 10);
                showCdcDetailsModal(centreIdx, lineIdx);
            });
        });

        // Config commune des 3 kinds editables.
        // endpoint = chemin REST, bodyField = nom du field dans le PUT body,
        // label = libelle utilisateur.
        const PRIX_CONFIG = {
            'prix_vente':     { endpoint: 'prix-vente-fournisseur', bodyField: 'prix_vente',     label: 'Prix vente fournisseur' },
            'prix_achat':     { endpoint: 'prix-achat',             bodyField: 'prix_achat',     label: 'Prix achat fournisseur' },
            'prix_vente_cdc': { endpoint: 'prix-cdc',               bodyField: 'prix_vente_cdc', label: 'Prix vente CDC' }
        };

        // Wire les boutons "Save" pour les 3 prix (vente / achat / vente CDC).
        accordion.querySelectorAll('[data-prix-save]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const kind = btn.dataset.prixSave;
                const cfg = PRIX_CONFIG[kind];
                if (!cfg) return;
                const tr = btn.closest('[data-cdc-row]');
                if (!tr) return;
                const produit = tr.dataset.produit;
                const input = tr.querySelector(`[data-prix-input="${kind}"]`);
                const val = parseFloat(input ? input.value : 0);
                if (!Number.isFinite(val) || val < 0) {
                    if (typeof showToast === 'function') showToast('Prix invalide', 'warning');
                    return;
                }
                try {
                    const res = await fetch('/api/finance/' + cfg.endpoint + '/' + encodeURIComponent(produit), {
                        method: 'PUT',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ [cfg.bodyField]: val })
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    if (typeof showToast === 'function') {
                        showToast(`${cfg.label} mis à jour pour ${produit}`, 'success');
                    }
                    loadCdc();
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            });
        });

        // Wire les boutons "History" pour les 3 prix.
        accordion.querySelectorAll('[data-prix-history]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const kind = btn.dataset.prixHistory;
                const cfg = PRIX_CONFIG[kind];
                if (!cfg) return;
                const tr = btn.closest('[data-cdc-row]');
                if (!tr) return;
                const produit = tr.dataset.produit;
                try {
                    const res = await fetch('/api/finance/' + cfg.endpoint + '/' + encodeURIComponent(produit) + '/history', {
                        credentials: 'include'
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    showPrixHistoryModal(cfg.label, produit, cfg.bodyField, j.data, cfg.endpoint);
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            });
        });
    }

    // Modale historique générique pour les 3 types de prix.
    // labelPrix = libellé affiché (ex: "Prix vente CDC").
    // bodyField = nom du champ dans les rows (ex: "prix_vente_cdc").
    /**
     * @param {string} [typeEditable] 'prix-achat' | 'prix-vente-fournisseur' |
     *   'prix-cdc'. Fourni, et si l'utilisateur est ADMIN, chaque ligne devient
     *   modifiable: valeur, date d'effet, suppression.
     */
    function showPrixHistoryModal(labelPrix, produit, bodyField, rows, typeEditable) {
        const title = document.getElementById('fin-cdc-details-title');
        const body = document.getElementById('fin-cdc-details-body');
        const modalEl = document.getElementById('fin-cdc-details-modal');
        if (!title || !body || !modalEl) return;
        title.innerHTML = `<i class="bi bi-clock-history me-2"></i>Historique ${esc(labelPrix)} — <strong>${esc(produit)}</strong>`;
        const list = Array.isArray(rows) ? rows : [];
        const estAdmin = String((window.currentUser || {}).role || '').toLowerCase() === 'admin';
        const editable = !!typeEditable && estAdmin;

        // 'AAAA-MM-JJTHH:MM' pour <input type="datetime-local">, en heure
        // LOCALE: l'input n'accepte pas de fuseau, et lui donner de l'UTC
        // decalerait la date affichee de l'ecart horaire.
        const pourInput = (v) => {
            const d = v ? new Date(v) : null;
            if (!d || isNaN(d.getTime())) return '';
            const p2 = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
                + `T${p2(d.getHours())}:${p2(d.getMinutes())}`;
        };

        const rowsHtml = list.map((h) => {
            const when = h.created_at ? new Date(h.created_at).toLocaleString('fr-FR') : '—';
            const isSeed = h.changed_by === '_seed_';
            const whenLabel = isSeed ? 'Valeur initiale' : when;
            const whoLabel = isSeed ? '(seed migration)' : (h.changed_by || 'anonymous');
            if (!editable) {
                return `
                <tr${isSeed ? ' class="text-muted"' : ''}>
                    <td class="text-nowrap">${esc(whenLabel)}</td>
                    <td class="text-end fw-medium">${esc(fmtMoney(h[bodyField]))}</td>
                    <td>${esc(whoLabel)}</td>
                </tr>`;
            }
            return `
                <tr data-hist-id="${esc(String(h.id))}"${isSeed ? ' class="table-warning"' : ''}>
                    <td><input type="datetime-local" class="form-control form-control-sm hist-date"
                               value="${esc(pourInput(h.created_at))}"
                               title="Date d'effet : le prix s'applique aux ventes à partir de cet instant."></td>
                    <td><input type="number" step="0.01" min="0"
                               class="form-control form-control-sm text-end hist-valeur"
                               value="${esc(String(h[bodyField]))}"></td>
                    <td class="small text-nowrap">${esc(whoLabel)}
                        <div class="mt-1 d-flex gap-1">
                            <button type="button" class="btn btn-sm btn-outline-primary hist-maj">Enregistrer</button>
                            <button type="button" class="btn btn-sm btn-outline-danger hist-suppr">×</button>
                        </div>
                    </td>
                </tr>`;
        }).join('') || '<tr><td colspan="3" class="text-muted text-center py-3">Aucun changement enregistré.</td></tr>';

        body.innerHTML = `
            <div class="alert alert-light border small mb-3">
                <i class="bi bi-info-circle"></i> Chaque sauvegarde est historisée (point-in-time).
                La valeur la plus récente (en haut) s'applique aux futures ventes; les ventes passées
                conservent le prix effectif à leur date.
            </div>
            ${editable ? `<div class="alert alert-warning small mb-3">
                <strong>Édition réservée aux administrateurs.</strong> Corriger une valeur ou une date
                change le coût de ventes <strong>déjà enregistrées</strong>, donc le résultat de journées
                déjà closes. La ligne surlignée est une valeur d'amorçage de migration : elle n'a jamais
                été saisie par personne, et vaut souvent le prix de vente faute de mieux.
                <div class="mt-1">Pour ancrer un prix « depuis toujours », reculez sa date d'effet.</div>
            </div>` : ''}
            <div class="table-responsive">
                <table class="table table-sm mb-0" id="fin-hist-table">
                    <thead>
                        <tr>
                            <th>Date${editable ? ' d\'effet' : ''}</th>
                            <th class="text-end">${esc(labelPrix)}</th>
                            <th>Modifié par</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            <div id="fin-hist-retour" class="small mt-2"></div>
        `;
        if (editable) brancherEditionHistorique(typeEditable, labelPrix, produit, bodyField);
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }

    /**
     * Les boutons de la modale d'historique, poses APRES le rendu.
     *
     * Un seul ecouteur delegue sur le tableau: innerHTML detruit les
     * precedents a chaque ouverture, et rebrancher ligne par ligne en aurait
     * laisse trainer autant que d'ouvertures.
     */
    function brancherEditionHistorique(type, labelPrix, produit, bodyField) {
        const table = document.getElementById('fin-hist-table');
        if (!table) return;
        // L'element de retour est resolu A L'APPEL, jamais retenu: rouvrir()
        // reconstruit tout le corps de la modale, donc une reference prise au
        // branchement pointerait sur un noeud detache et le message
        // n'apparaitrait nulle part.
        const dire = (msg, ok) => {
            const el = document.getElementById('fin-hist-retour');
            if (el) el.innerHTML = `<span class="text-${ok ? 'success' : 'danger'}">${esc(msg)}</span>`;
        };
        const rouvrir = async () => {
            const res = await fetch('/api/finance/' + type + '/' + encodeURIComponent(produit) + '/history',
                { credentials: 'include' });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'historique illisible');
            showPrixHistoryModal(labelPrix, produit, bodyField, j.data, type);
        };

        table.addEventListener('click', async (ev) => {
            const tr = ev.target.closest('tr[data-hist-id]');
            if (!tr) return;
            const id = tr.dataset.histId;
            const majeur = ev.target.closest('.hist-maj');
            const suppr = ev.target.closest('.hist-suppr');
            if (!majeur && !suppr) return;
            ev.target.disabled = true;
            try {
                let res;
                if (majeur) {
                    const valeur = tr.querySelector('.hist-valeur').value;
                    const d = tr.querySelector('.hist-date').value;
                    res = await fetch('/api/finance/historique/' + type + '/' + id, {
                        method: 'PUT', credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        // L'input rend une heure LOCALE sans fuseau: on la
                        // convertit en instant avant l'envoi, sinon le serveur
                        // la lirait comme de l'UTC.
                        body: JSON.stringify({ valeur, created_at: d ? new Date(d).toISOString() : undefined })
                    });
                } else {
                    const ok = typeof showConfirmModal === 'function'
                        ? await showConfirmModal('Supprimer cette entrée d\'historique ? '
                            + 'Les ventes de cette période reprendront le prix de l\'entrée précédente.',
                            { title: 'Supprimer', okLabel: 'Supprimer', okVariant: 'danger' })
                        : confirm('Supprimer cette entrée d\'historique ?');
                    if (!ok) { ev.target.disabled = false; return; }
                    res = await fetch('/api/finance/historique/' + type + '/' + id,
                        { method: 'DELETE', credentials: 'include' });
                }
                const j = await res.json();
                if (!j.success) throw new Error(j.error || 'refusé');
            } catch (e) {
                // ECHEC D'ECRITURE: rien n'a change en base.
                dire('Échec : ' + (e && e.message), false);
                ev.target.disabled = false;
                return;
            }
            // L'ecriture a REUSSI. Ce qui suit peut echouer sans la remettre
            // en cause: annoncer « Échec » sur un rafraichissement rate ferait
            // recommencer une correction deja enregistree.
            const fait = majeur ? 'Enregistré.' : 'Entrée supprimée.';
            try {
                await rouvrir();
                // APRES le re-rendu, sinon le message est efface par lui.
                dire(fait, true);
            } catch (e) {
                dire(fait + ' Affichage non rafraîchi (' + (e && e.message)
                    + ') — rouvrez l\'historique pour le voir à jour.', true);
                ev.target.disabled = false;
            }
        });
    }

    // Affiche la modale avec le detail des ventes individuelles ayant
    // contribue a une ligne (centre, produit) du calcul "Il me doit".
    function showCdcDetailsModal(centreIdx, lineIdx) {
        if (!_cdcLastData || !Array.isArray(_cdcLastData.detail_cdc_par_centre)) return;
        const centre = _cdcLastData.detail_cdc_par_centre[centreIdx];
        if (!centre) return;
        const line = centre.detail[lineIdx];
        if (!line) return;

        const title = document.getElementById('fin-cdc-details-title');
        const body = document.getElementById('fin-cdc-details-body');
        const modalEl = document.getElementById('fin-cdc-details-modal');
        if (!title || !body || !modalEl) return;

        title.innerHTML = `<i class="bi bi-zoom-in me-2"></i>${esc(line.produit)} <small class="text-muted">— ${esc(centre.centre)}</small>`;

        const ventes = Array.isArray(line.ventes) ? line.ventes : [];
        const rowsHtml = ventes.map((v) => {
            // Client + telephone + commande
            const clientLine = v.nom_client
                ? `<div class="fw-medium">${esc(v.nom_client)}</div>`
                : '<div class="text-muted">—</div>';
            const clientMeta = [];
            if (v.numero_client) clientMeta.push(`<i class="bi bi-telephone me-1"></i>${esc(v.numero_client)}`);
            if (v.commande_id) clientMeta.push(`<i class="bi bi-receipt me-1"></i>${esc(v.commande_id)}`);
            const clientMetaHtml = clientMeta.length
                ? `<div class="small text-muted">${clientMeta.join(' • ')}</div>`
                : '';

            // Le produit "brut" tel que saisi peut differer du libelle agrege
            // (ex: vente="Boeuf en gros" mais agreget aussi "Boeuf en détail"
            // sous la cle prefix "Boeuf"). On l'affiche en petit pour clarte.
            const produitBrut = v.produit_brut && v.produit_brut !== line.produit
                ? `<div class="small text-muted">${esc(v.produit_brut)}</div>`
                : '';

            return `
                <tr>
                    <td class="text-nowrap">${esc(v.date)}</td>
                    <td>
                        ${clientLine}
                        ${clientMetaHtml}
                        ${produitBrut}
                    </td>
                    <td class="text-end">${esc(v.nombre)} <span class="fin-kpi-currency">kg</span></td>
                    <td class="text-end">${esc(fmtMoney(v.prix_unit))}</td>
                    <td class="text-end">${esc(fmtMoney(v.prix_achat))}</td>
                    <td class="text-end fw-medium" title="Prix CDC effectif au moment de la vente (point-in-time)">${esc(fmtMoney(v.prix_vente_cdc_effectif))}</td>
                    <td class="text-end">${esc(fmtMoney(v.marge_unitaire))}</td>
                    <td class="text-end fw-bold">${esc(fmtMoney(v.recevable_ligne))}</td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="8" class="text-muted text-center py-3">Aucune vente individuelle dans le payload — pense à redémarrer le serveur après le dernier déploiement.</td></tr>';

        body.innerHTML = `
            <!-- Bandeau récapitulatif -->
            <div class="row g-2 mb-3">
                <div class="col-md-3">
                    <div class="fin-kpi-label">Centre</div>
                    <div class="fw-semibold">${esc(centre.centre)}</div>
                </div>
                <div class="col-md-3">
                    <div class="fin-kpi-label">Produit (agrégé)</div>
                    <div class="fw-semibold">${esc(line.produit)}</div>
                </div>
                <div class="col-md-2">
                    <div class="fin-kpi-label">Nb ventes</div>
                    <div class="fw-semibold">${ventes.length}</div>
                </div>
                <div class="col-md-2">
                    <div class="fin-kpi-label">Quantité totale</div>
                    <div class="fw-semibold">${esc(line.quantite_cdc)} kg</div>
                </div>
                <div class="col-md-2">
                    <div class="fin-kpi-label">Il me doit</div>
                    <div class="fw-bold text-success">${esc(fmtMoney(line.recevable))}</div>
                </div>
            </div>

            <!-- Formule + agrégat -->
            <div class="p-3 mb-3" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px">
                <div class="fin-kpi-label mb-1">Formule</div>
                <div class="mb-2"><code>recevable_par_vente = (prix_vente_cdc_effectif − prix_achat_fournisseur) × quantité</code></div>
                <div class="small text-muted mb-2">
                    <i class="bi bi-info-circle"></i>
                    <strong>Point-in-time pricing</strong> : chaque vente utilise le prix vente CDC effectif à sa date.
                    Changer le prix aujourd'hui n'impacte pas les ventes passées.
                </div>
                <div class="fin-kpi-label mb-1">Agrégat ${esc(line.produit)} chez ${esc(centre.centre)}</div>
                <div>
                    Quantité <strong>${esc(line.quantite_cdc)} kg</strong>
                    × marge moyenne pondérée <strong>${esc(fmtMoney(line.marge_unitaire))}</strong>
                    = <strong class="text-success">${esc(fmtMoney(line.recevable))}</strong>
                </div>
                <div class="small text-muted mt-1">
                    Prix d'achat fournisseur référence : <strong>${esc(fmtMoney(line.prix_achat))}</strong>
                    • Prix vente CDC courant (catalogue) : <strong>${esc(fmtMoney(line.prix_vente_cdc_courant))}</strong>
                    • Prix CDC moyen pondéré (point-in-time) : <strong>${esc(fmtMoney(line.prix_vente_cdc))}</strong>
                    • Mon prix moyen POS (info) : <strong>${esc(fmtMoney(line.mon_prix_moyen))}</strong>
                </div>
            </div>

            <!-- Détail des ventes individuelles -->
            <div class="fin-subheading">Détail des ventes individuelles (prix effectifs point-in-time à la date de chaque vente)</div>
            <div class="table-responsive">
                <table class="table table-sm mb-0">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Client / Commande</th>
                            <th class="text-end">Quantité</th>
                            <th class="text-end">Mon prix POS</th>
                            <th class="text-end" title="Prix achat fournisseur effectif à la date de la vente">Achat eff.</th>
                            <th class="text-end" title="Prix vente CDC effectif à la date de la vente">CDC eff.</th>
                            <th class="text-end">Marge unit.</th>
                            <th class="text-end">Recevable</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f8fafc">
                            <th colspan="7" class="text-end">Total</th>
                            <th class="text-end">${esc(fmtMoney(line.recevable))}</th>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;

        // Affiche la modale via l'API Bootstrap (instance reutilisable).
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }

    // ===== Dépenses =====

    // Categories de depenses: configurables dans ADMIN > Categories depenses.
    // On remplit les deux <select> (formulaire d'ajout + filtre) au premier
    // chargement de l'onglet. Si l'appel echoue, on laisse les <option> du
    // HTML en place plutot que de vider les listes.
    let _depenseCategoriesChargees = false;
    async function chargerCategoriesDepenses() {
        if (_depenseCategoriesChargees) return;
        try {
            const res = await fetch('/api/finance/depense-categories', { credentials: 'include' });
            const json = await res.json();
            if (!json.success || !Array.isArray(json.categories)) return;
            const options = json.categories
                .map((c) => `<option value="${esc(c.nom)}">${esc(c.libelle)}</option>`)
                .join('');
            const selAjout = document.querySelector('#fin-depense-form select[name="categorie"]')
                || document.querySelector('select[name="categorie"]');
            if (selAjout) {
                const courant = selAjout.value;
                selAjout.innerHTML = '<option value="">—</option>' + options;
                selAjout.value = courant;
            }
            const selFiltre = document.getElementById('fin-depense-categorie');
            if (selFiltre) {
                const courant = selFiltre.value;
                selFiltre.innerHTML = '<option value="">Toutes</option>' + options;
                selFiltre.value = courant;
            }
            _depenseCategoriesChargees = true;
        } catch (e) {
            console.warn('Categories de depenses non chargees:', e.message);
        }
    }

    async function loadDepenses() {
        try {
            await chargerCategoriesDepenses();
            const params = new URLSearchParams();
            const dd = document.getElementById('fin-depense-date-debut').value;
            const df = document.getElementById('fin-depense-date-fin').value;
            const cat = document.getElementById('fin-depense-categorie').value;
            if (dd) params.set('dateDebut', dd);
            if (df) params.set('dateFin', df);
            if (cat) params.set('categorie', cat);
            const res = await fetch('/api/finance/depenses?' + params.toString(), { credentials: 'include' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Erreur');
            renderDepenses(json.data);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur depenses: ' + e.message, 'danger');
        }
    }

    function renderDepenses(rows) {
        const tbody = document.querySelector('#fin-depense-list tbody');
        tbody.innerHTML = rows.map((d) => `
            <tr>
                <td>${esc(d.date)}</td>
                <td>${esc(d.categorie || '')}${d.hors_boucherie
                    ? ' <span class="badge bg-secondary-subtle text-secondary" title="Exclue du PL quand la case Boucherie seulement est cochée">hors boucherie</span>'
                    : ''}</td>
                <td>${esc(d.description || '')}</td>
                <td class="text-end">${esc(fmtMoney(d.montant))}</td>
                <td>${d.justificatif_filename
                    ? `<a href="/api/finance/depenses/${d.id}/justificatif" target="_blank" rel="noopener">${esc(d.justificatif_filename)}</a>`
                    : '<span class="text-muted">—</span>'}</td>
                <td>${esc(d.created_by || '')}</td>
                <td><button class="btn btn-sm btn-outline-danger" data-depense-delete="${d.id}">×</button></td>
            </tr>
        `).join('') || '<tr><td colspan="7" class="text-muted text-center">Aucune dépense</td></tr>';

        tbody.querySelectorAll('[data-depense-delete]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.depenseDelete;
                if (typeof showConfirmModal === 'function') {
                    const ok = await showConfirmModal('Supprimer cette dépense ?', {
                        title: 'Supprimer', okLabel: 'Supprimer', okVariant: 'danger'
                    });
                    if (!ok) return;
                } else if (!confirm('Supprimer cette dépense ?')) {
                    return;
                }
                const res = await fetch('/api/finance/depenses/' + id, { method: 'DELETE', credentials: 'include' });
                const j = await res.json();
                if (!j.success) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + j.error, 'danger');
                    return;
                }
                loadDepenses();
            });
        });
    }

    async function onDepenseSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const fd = new FormData(form);
        try {
            const res = await fetch('/api/finance/depenses', {
                method: 'POST',
                credentials: 'include',
                body: fd  // multipart automatique
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur');
            form.reset();
            if (typeof showToast === 'function') showToast('Dépense enregistrée', 'success');
            loadDepenses();
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
        }
    }

    // ===== Prix fournisseur =====

    // Produits dont le prix achat peut etre lu depuis l'API DATA. Le toggle
    // "Prix API (DATA)" n'est propose que pour ceux-la (cf. cote serveur
    // lib/achats-boeuf-client.js, alimente par /api/external/achats-boeuf).
    const PRODUITS_PRIX_API = new Set(['boeuf']);

    async function loadPrix() {
        try {
            // Date "voir les prix au ..." : si renseignee -> mode as-of (lecture
            // seule, prix effectifs a cette date). Sinon -> edition (courant).
            const dateInput = document.getElementById('fin-prix-date');
            const asOf = dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)
                ? dateInput.value
                : '';
            const prixUrl = '/api/finance/prix' + (asOf ? '?date=' + encodeURIComponent(asOf) : '');

            // Charger config (commission_pct) et prix en parallele
            const [cfgRes, prixRes] = await Promise.all([
                fetch('/api/finance/config', { credentials: 'include' }),
                fetch(prixUrl, { credentials: 'include' })
            ]);
            const cfgJson = await cfgRes.json();
            const prixJson = await prixRes.json();
            if (!cfgJson.success) throw new Error(cfgJson.error || 'config');
            if (!prixJson.success) throw new Error(prixJson.error || 'prix');

            const commPct = document.getElementById('fin-commission-pct');
            if (commPct) commPct.value = cfgJson.data.commission_pct || '3.0';

            // Bascule affichage: as-of (lecture seule) vs edition.
            const readOnly = !!asOf;
            const banner = document.getElementById('fin-prix-asof-banner');
            const actions = document.getElementById('fin-prix-actions');
            if (banner) {
                banner.style.display = readOnly ? '' : 'none';
                const lbl = document.getElementById('fin-prix-asof-label');
                if (lbl && readOnly) {
                    const m = asOf.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                    lbl.textContent = 'Prix en vigueur au ' + (m ? `${m[3]}/${m[2]}/${m[1]}` : asOf);
                }
            }
            // NB: la barre a la classe .d-flex (display:flex !important), donc
            // un style.display inline ne suffit pas — on bascule les classes.
            if (actions) {
                actions.classList.toggle('d-none', readOnly);
                actions.classList.toggle('d-flex', !readOnly);
            }

            const tbody = document.querySelector('#fin-prix-table tbody');
            tbody.innerHTML = '';
            for (const row of prixJson.data) {
                addPrixRow(
                    row.produit,
                    row.prix_vente == null ? '' : row.prix_vente,
                    row.prix_achat == null ? '' : row.prix_achat,
                    readOnly,
                    row.prix_achat_dynamique === true,
                    row.hors_mata === true
                );
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur prix: ' + e.message, 'danger');
        }
    }

    function addPrixRow(produit, prixVente, prixAchat, readOnly, prixAchatDyn, horsMata) {
        const tbody = document.querySelector('#fin-prix-table tbody');
        const tr = document.createElement('tr');

        const tdP = document.createElement('td');
        const inP = document.createElement('input');
        inP.type = 'text'; inP.className = 'form-control form-control-sm'; inP.value = produit || '';
        inP.dataset.col = 'produit';
        if (readOnly) inP.disabled = true;
        tdP.appendChild(inP);

        // Cellule prix = input + (si produit existant en BDD) bouton historique
        // date. Reutilise showPrixHistoryModal + les endpoints /history existants
        // (chaque sauvegarde ecrit une ligne datee dans prix_*_history).
        const makePrixCell = (col, value, histEndpoint, histLabel, histField) => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'number'; input.min = '0'; input.step = '1';
            input.className = 'form-control form-control-sm';
            input.value = value == null ? '' : value;
            input.dataset.col = col;
            if (readOnly) input.disabled = true;
            if (!produit) { td.appendChild(input); return td; }
            const grp = document.createElement('div');
            grp.className = 'input-group input-group-sm';
            grp.appendChild(input);
            const btnH = document.createElement('button');
            btnH.type = 'button';
            btnH.className = 'btn btn-outline-secondary';
            btnH.title = 'Voir l\'historique daté de ce prix';
            btnH.innerHTML = '<i class="bi bi-clock-history"></i>';
            btnH.addEventListener('click', async () => {
                try {
                    const res = await fetch(
                        '/api/finance/' + histEndpoint + '/' + encodeURIComponent(produit) + '/history',
                        { credentials: 'include' }
                    );
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    showPrixHistoryModal(histLabel, produit, histField, j.data, histEndpoint);
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur historique: ' + e.message, 'danger');
                }
            });
            grp.appendChild(btnH);
            td.appendChild(grp);
            return td;
        };
        const tdV = makePrixCell('prix_vente', prixVente, 'prix-vente-fournisseur', 'Prix vente fournisseur', 'prix_vente');
        const tdA = makePrixCell('prix_achat', prixAchat, 'prix-achat', 'Prix achat fournisseur', 'prix_achat');

        // Colonne "Prix API (DATA)": bascule le prix achat de ce produit sur
        // l'API DATA (moyenne des achats du jour) au lieu de la valeur saisie
        // a gauche, qui ne sert alors que de repli si DATA est indisponible.
        // Seul le boeuf a une source API -> tiret pour les autres produits.
        const tdDyn = document.createElement('td');
        tdDyn.className = 'text-center align-middle';
        if (PRODUITS_PRIX_API.has(String(produit || '').trim().toLowerCase())) {
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'form-check-input';
            chk.dataset.col = 'prix_achat_dynamique';
            chk.checked = prixAchatDyn === true;
            if (readOnly) chk.disabled = true;
            const inA = tdA.querySelector('input');
            // Signale que le prix saisi n'est plus la valeur de reference quand
            // l'API prend la main. On met en italique (et PAS en text-muted:
            // sur le fond sombre des champs, le gris rend la valeur illisible)
            // pour que le repli reste parfaitement lisible.
            const syncAchat = () => {
                chk.title = chk.checked
                    ? 'Prix achat lu depuis DATA. Décochez pour utiliser la valeur saisie.'
                    : 'Valeur saisie utilisée. Cochez pour lire le prix depuis DATA.';
                if (!inA) return;
                inA.classList.toggle('fst-italic', chk.checked);
                inA.title = chk.checked
                    ? 'Prix API actif — cette valeur ne sert que de repli si DATA est indisponible.'
                    : 'Prix achat fournisseur utilisé pour le calcul.';
            };
            chk.addEventListener('change', syncAchat);
            syncAchat();
            tdDyn.appendChild(chk);
        } else {
            const dash = document.createElement('span');
            dash.className = 'text-muted';
            dash.textContent = '—';
            dash.title = 'Aucune source API pour ce produit';
            tdDyn.appendChild(dash);
        }

        // Colonne "Hors Mata": produit achete hors circuit Mata. Coche, ses
        // livraisons ne generent aucune commission fournisseur; son prix
        // d'achat continue de valoriser le stock (cash-stock, PL).
        const tdHors = document.createElement('td');
        tdHors.className = 'text-center align-middle';
        const chkHors = document.createElement('input');
        chkHors.type = 'checkbox';
        chkHors.className = 'form-check-input';
        chkHors.dataset.col = 'hors_mata';
        chkHors.checked = horsMata === true;
        if (readOnly) chkHors.disabled = true;
        const syncHors = () => {
            chkHors.title = chkHors.checked
                ? 'Hors circuit Mata : aucune commission fournisseur sur ses livraisons. Son prix d\'achat valorise toujours le stock.'
                : 'Dans le circuit Mata : ses livraisons génèrent la commission fournisseur. Cochez pour l\'exclure de la commission.';
        };
        chkHors.addEventListener('change', syncHors);
        syncHors();
        // Le title dit l'ETAT, identique sur toutes les lignes: sans nom de
        // produit dans l'aria-label, un lecteur d'ecran annonce cinq cases
        // indiscernables. Suit le champ produit, editable sur chaque ligne.
        const majLabelHors = () => {
            const nom = inP.value.trim();
            chkHors.setAttribute('aria-label', nom
                ? `Hors Mata : exclure ${nom} de la commission fournisseur`
                : 'Hors Mata : exclure ce produit de la commission fournisseur');
        };
        inP.addEventListener('input', majLabelHors);
        majLabelHors();
        tdHors.appendChild(chkHors);

        // Bouton supprimer. Si la ligne vient de la BDD (produit existant),
        // on appelle DELETE /api/finance/prix/:produit. Sinon (ligne ajoutee
        // localement via "+ Ajouter une ligne"), on retire juste du DOM.
        const tdDel = document.createElement('td');
        if (!readOnly) {
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn btn-sm btn-outline-danger';
        btnDel.title = 'Supprimer ce produit';
        btnDel.textContent = '×';
        if (produit) {
            // Ligne existante: capture l'identifiant pour la suppression server-side.
            btnDel.dataset.originalProduit = produit;
        }
        btnDel.addEventListener('click', async () => {
            const originalProduit = btnDel.dataset.originalProduit;
            if (originalProduit) {
                // Confirme + appel DELETE
                const msg = `Supprimer "${originalProduit}" du catalogue ?`;
                let ok;
                if (typeof showConfirmModal === 'function') {
                    ok = await showConfirmModal(msg, {
                        title: 'Supprimer', okLabel: 'Supprimer', okVariant: 'danger'
                    });
                } else {
                    ok = confirm(msg);
                }
                if (!ok) return;
                try {
                    const res = await fetch('/api/finance/prix/' + encodeURIComponent(originalProduit), {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    if (typeof showToast === 'function') showToast('Produit supprimé', 'success');
                    loadPrix();
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            } else {
                // Ligne locale: juste retirer du DOM
                tr.remove();
            }
        });
        tdDel.appendChild(btnDel);
        }

        tr.append(tdP, tdV, tdA, tdDyn, tdHors, tdDel);
        tbody.appendChild(tr);
    }

    async function onPrixSave() {
        try {
            const items = [];
            document.querySelectorAll('#fin-prix-table tbody tr').forEach((tr) => {
                const inputs = tr.querySelectorAll('input');
                const obj = {};
                inputs.forEach((inp) => {
                    // Le toggle "Prix API (DATA)" est une case a cocher: on
                    // envoie un booleen, pas la value ("on") du DOM.
                    obj[inp.dataset.col] = inp.type === 'checkbox' ? inp.checked : inp.value;
                });
                if (obj.produit && obj.produit.trim()) items.push(obj);
            });
            const res = await fetch('/api/finance/prix', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items })
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur');
            if (typeof showToast === 'function') showToast('Prix sauvegardés', 'success');
            loadPrix();
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
        }
    }

    async function onConfigSave() {
        try {
            const pct = document.getElementById('fin-commission-pct').value;
            const res = await fetch('/api/finance/config', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commission_pct: pct })
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur');
            if (typeof showToast === 'function') showToast('Commission sauvegardée', 'success');
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
        }
    }

    // ===== Mapping produits (alias vente -> catalogue prix) =====

    // Cache du payload courant pour pouvoir recalculer rapidement les
    // cartes synthese apres ajout/suppression d'alias sans refaire un
    // appel reseau complet.
    let _mappingLastData = null;

    async function loadMapping() {
        try {
            const res = await fetch('/api/finance/alias', { credentials: 'include' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Erreur');
            _mappingLastData = json.data;
            renderMapping(json.data);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur mapping: ' + e.message, 'danger');
        }
    }

    function renderMapping(data) {
        const cardsEl = document.getElementById('fin-mapping-cards');
        const tbody = document.querySelector('#fin-mapping-table tbody');
        if (!cardsEl || !tbody) return;

        const items = Array.isArray(data.items) ? data.items : [];
        // Source du dropdown: union triee (inventaire boucherie ∪ catalogue
        // fournisseur_prix), fournie cote serveur sous data.dropdown. Permet
        // a l'admin d'ajouter un produit manuellement dans "Prix fournisseur"
        // et le voir apparaitre ici automatiquement.
        const catalog = Array.isArray(data.dropdown) && data.dropdown.length
            ? data.dropdown
            : (Array.isArray(data.catalog) ? data.catalog : []);

        const nExact   = items.filter((i) => i.statut === 'exact').length;
        const nAlias   = items.filter((i) => i.statut === 'alias').length;
        const nPrefix  = items.filter((i) => i.statut === 'prefix').length;
        const nUnmap   = items.filter((i) => i.statut === 'unmapped').length;

        const card3 = (tone, icon, label, valueHtml) => kpiCard(tone, icon, label, valueHtml)
            .replace('col-md-3', 'col-md-3');
        cardsEl.innerHTML = [
            kpiCard('success', 'check-circle',     'Mappés exactement', `${nExact}`),
            kpiCard('info',    'link-45deg',       'Aliases définis',   `${nAlias}`),
            kpiCard('warning', 'exclamation-triangle', 'Fallback prefix',`${nPrefix}`),
            kpiCard('danger',  'x-circle',         'Non mappés',        `${nUnmap}`)
        ].join('');

        // Helpers de rendu d'un select catalog (option preselectionnee).
        const catalogOptions = (selected) => {
            const blank = '<option value="">— choisir —</option>';
            const opts = catalog.map((p) =>
                `<option value="${esc(p)}"${p === selected ? ' selected' : ''}>${esc(p)}</option>`
            ).join('');
            return blank + opts;
        };

        // Pills de statut (couleurs alignees au reste du design)
        const statutPill = (statut, resolved) => {
            switch (statut) {
                case 'exact':
                    return `<span class="fin-pill fin-pill--success"><i class="bi bi-check-circle me-1"></i>Exact</span>`;
                case 'alias':
                    return `<span class="fin-pill fin-pill--info"><i class="bi bi-link-45deg me-1"></i>Alias → ${esc(resolved)}</span>`;
                case 'prefix':
                    return `<span class="fin-pill fin-pill--warning"><i class="bi bi-exclamation-triangle me-1"></i>Prefix → ${esc(resolved)}</span>`;
                case 'unmapped':
                default:
                    return `<span class="fin-pill fin-pill--danger"><i class="bi bi-x-circle me-1"></i>Non mappé</span>`;
            }
        };

        // Index-based lookup: chaque ligne porte data-line-idx="N". Plus
        // robuste qu'un selector base sur le nom du produit (qui peut
        // contenir des guillemets / caracteres CSS-speciaux).
        tbody.innerHTML = items.map((it, idx) => {
            // Si exact: pas de dropdown / pas de bouton (le libelle EST une
            // entree du catalogue, rien a mapper).
            if (it.statut === 'exact') {
                return `
                    <tr>
                        <td><strong>${esc(it.produit)}</strong></td>
                        <td class="text-end">${esc(it.count)}</td>
                        <td>${statutPill(it.statut, it.resolved)}</td>
                        <td><span class="text-muted">${esc(it.resolved)}</span></td>
                        <td class="text-muted small">1 — même produit</td>
                        <td></td>
                    </tr>
                `;
            }
            const selectedCatalog = it.statut === 'alias' ? it.resolved
                                  : it.statut === 'prefix' ? it.resolved
                                  : '';
            const actionLabel = it.statut === 'alias' ? 'Mettre à jour' : 'Enregistrer';
            const deleteBtn = it.statut === 'alias'
                ? `<button type="button" class="btn btn-sm btn-outline-danger" data-mapping-del="${idx}" title="Supprimer l'alias"><i class="bi bi-trash"></i></button>`
                : '';
            return `
                <tr>
                    <td><strong>${esc(it.produit)}</strong></td>
                    <td class="text-end">${esc(it.count)}</td>
                    <td>${statutPill(it.statut, it.resolved)}</td>
                    <td>
                        <select class="form-select form-select-sm" data-mapping-select="${idx}">
                            ${catalogOptions(selectedCatalog)}
                        </select>
                    </td>
                    <td>
                        <input type="number" class="form-control form-control-sm"
                               data-mapping-coef="${idx}" min="0.01" max="1000" step="0.01"
                               value="${esc(String(it.coefficient == null ? 1 : it.coefficient))}"
                               title="1 si ce libellé se compte dans la même unité que la carcasse. 0,5 pour le Jarret, vendu à la pièce.">
                    </td>
                    <td class="d-flex gap-1">
                        <button type="button" class="btn btn-sm btn-primary" data-mapping-save="${idx}" title="${actionLabel}">
                            <i class="bi bi-check2"></i>
                        </button>
                        ${deleteBtn}
                    </td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="6" class="text-muted text-center py-3">Aucun produit vendu sur les 90 derniers jours.</td></tr>';

        // Wire boutons "Enregistrer" (PUT /alias) — lookup par index dans
        // items pour eviter tout escape CSS sur des noms a caracteres
        // speciaux (guillemets, backslash, etc.).
        tbody.querySelectorAll('[data-mapping-save]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const idx = parseInt(btn.dataset.mappingSave, 10);
                const it = items[idx];
                if (!it) return;
                const alias = it.produit;
                const select = tbody.querySelector(`select[data-mapping-select="${idx}"]`);
                const target = select ? select.value : '';
                const champCoef = tbody.querySelector(`input[data-mapping-coef="${idx}"]`);
                if (!target) {
                    if (typeof showToast === 'function') showToast('Choisir un produit du catalogue', 'warning');
                    return;
                }
                try {
                    const res = await fetch('/api/finance/alias', {
                        method: 'PUT',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        // Le coefficient part AVEC la cible: les deux décrivent
                        // la même relation, et les séparer laisserait un alias
                        // sans son unité de conversion.
                        body: JSON.stringify({
                            alias_produit: alias,
                            produit_catalog: target,
                            coefficient: champCoef ? champCoef.value : undefined
                        })
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    if (typeof showToast === 'function') showToast(`Alias "${alias}" → "${target}" enregistré`, 'success');
                    loadMapping();
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            });
        });

        // Wire boutons "Supprimer alias" (DELETE /alias/:alias) — lookup par index.
        tbody.querySelectorAll('[data-mapping-del]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const idx = parseInt(btn.dataset.mappingDel, 10);
                const it = items[idx];
                if (!it) return;
                const alias = it.produit;
                const msg = `Supprimer l'alias "${alias}" ? Le libellé retombera sur le fallback prefix ou sera ignoré.`;
                let ok;
                if (typeof showConfirmModal === 'function') {
                    ok = await showConfirmModal(msg, {
                        title: 'Supprimer alias', okLabel: 'Supprimer', okVariant: 'danger'
                    });
                } else {
                    ok = confirm(msg);
                }
                if (!ok) return;
                try {
                    const res = await fetch('/api/finance/alias/' + encodeURIComponent(alias), {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    // deleted vaut 0 quand aucune ligne ne correspondait. Un
                    // bandeau vert sur zéro suppression laissait croire à un
                    // mapping retiré qui continuait de s'appliquer.
                    if (typeof showToast === 'function') {
                        showToast(
                            j.deleted ? 'Alias supprimé' : 'Aucun alias à supprimer pour ce libellé',
                            j.deleted ? 'success' : 'warning'
                        );
                    }
                    loadMapping();
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            });
        });
    }

    async function onMappingBulkFromPrefix() {
        const items = _mappingLastData && _mappingLastData.items;
        const nPrefix = Array.isArray(items) ? items.filter((i) => i.statut === 'prefix').length : 0;
        if (nPrefix === 0) {
            if (typeof showToast === 'function') showToast('Rien à convertir (aucun fallback prefix actif)', 'info');
            return;
        }
        const msg = `Convertir ${nPrefix} libellé(s) "prefix" en aliases explicites ? La résolution restera la même mais sera figée et reproductible.`;
        let ok;
        if (typeof showConfirmModal === 'function') {
            ok = await showConfirmModal(msg, {
                title: 'Convertir en aliases', okLabel: 'Convertir', okVariant: 'primary'
            });
        } else {
            ok = confirm(msg);
        }
        if (!ok) return;
        try {
            const res = await fetch('/api/finance/alias/bulk-from-prefix', {
                method: 'POST',
                credentials: 'include'
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur');
            const n = Array.isArray(j.created) ? j.created.length : 0;
            if (typeof showToast === 'function') showToast(`${n} alias(es) créé(s)`, 'success');
            loadMapping();
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
        }
    }

    // ===== Charges mensuelles (pour calcul PL) =====

    // "420 000 x 1.03" n'avait plus de sens une fois le prorata calcule mois
    // par mois: un mois complet vaut exactement son montant, et une periode a
    // cheval melange deux montants. On dit donc ce qui est couvert.
    function libelleProrataCharges(ch) {
        const mois = Array.isArray(ch.mois_couverts) ? ch.mois_couverts : [];
        if (!mois.length) return '';
        const complet = (m) => m.joursCouverts === m.joursDuMois;

        if (mois.length === 1) {
            return complet(mois[0])
                ? '(' + formatMoisFr(mois[0].mois) + ' complet)'
                : '(' + mois[0].joursCouverts + '/' + mois[0].joursDuMois + ' jours de '
                    + formatMoisFr(mois[0].mois) + ')';
        }
        if (mois.every(complet)) {
            return '(' + mois.length + ' mois complets)';
        }
        return '(' + mois.map((m) => m.joursCouverts + '/' + m.joursDuMois).join(' + ') + ' jours)';
    }

    const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
        'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

    function formatMoisFr(mois) {
        if (!mois) return '';
        const [y, m] = mois.split('-');
        return (MOIS_FR[parseInt(m, 10) - 1] || mois) + ' ' + y;
    }

    // Distingue un montant saisi pour ce mois d'un montant reporte d'un mois
    // anterieur: sans cela l'utilisateur croit avoir saisi ce qu'il n'a
    // qu'herite, et ne comprend pas pourquoi une modification "disparait".
    function majChargesMoisInfo(rows, mois) {
        const el = document.getElementById('fin-charges-mois-info');
        if (!el) return;
        const total = (rows || []).reduce((s, r) => s + (parseFloat(r.montant_mensuel) || 0), 0);
        const nbSaisis = (rows || []).filter((r) => r.saisi_ce_mois).length;
        const libelle = esc(formatMoisFr(mois));

        if (!rows || !rows.length) { el.textContent = ''; return; }
        if (nbSaisis === rows.length) {
            el.innerHTML = 'Montants saisis pour <strong>' + libelle + '</strong> — total '
                + total.toLocaleString('fr-FR') + ' FCFA.';
        } else if (nbSaisis === 0) {
            el.innerHTML = 'Aucune saisie pour <strong>' + libelle
                + '</strong> : montants reportés. Sauvegarder les fixera pour ce mois.';
        } else {
            el.innerHTML = nbSaisis + ' charge(s) sur ' + rows.length + ' saisie(s) pour <strong>'
                + libelle + '</strong>, le reste est reporté.';
        }
    }

    // Meme distinction que pour les charges: un taux affiche peut etre saisi
    // pour ce mois ou reporte d'un mois anterieur.
    function majPertesOrigine(saisiCeMois, mois) {
        const el = document.getElementById('fin-pertes-origine');
        if (!el || !mois) return;
        el.textContent = saisiCeMois
            ? 'Saisi pour ' + formatMoisFr(mois) + '.'
            : 'Reporté — sauvegarder le fixera pour ' + formatMoisFr(mois) + '.';
    }

    // Mois selectionne dans l'onglet Charges. Par defaut le mois courant.
    function getChargesMois() {
        const el = document.getElementById('fin-charges-mois');
        if (!el) return null;
        if (!el.value) {
            const d = new Date();
            el.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        }
        return el.value;
    }

    async function loadCharges() {
        try {
            const mois = getChargesMois();
            // Parallel: charges list + config (pour stock_pertes_decoupe_pct)
            const [resCharges, resCfg] = await Promise.all([
                fetch('/api/finance/charges' + (mois ? '?mois=' + encodeURIComponent(mois) : ''), { credentials: 'include' }),
                fetch('/api/finance/config' + (mois ? '?mois=' + encodeURIComponent(mois) : ''), { credentials: 'include' })
            ]);
            const jCharges = await resCharges.json();
            const jCfg = await resCfg.json();
            if (!jCharges.success) throw new Error(jCharges.error || 'Erreur charges');
            renderCharges(jCharges.data);
            majChargesMoisInfo(jCharges.data, mois);
            // Hydrater le champ pertes %
            if (jCfg.success) {
                const pct = parseFloat(jCfg.data.stock_pertes_decoupe_pct);
                const input = document.getElementById('fin-stock-pertes-pct');
                if (input) input.value = Number.isFinite(pct) ? pct : 5;
                updateStockCoeffDisplay(Number.isFinite(pct) ? pct : 5);
                majPertesOrigine(jCfg.pertes_saisi_ce_mois, mois);
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur charges: ' + e.message, 'danger');
        }
    }

    function updateStockCoeffDisplay(pct) {
        const el = document.getElementById('fin-stock-coeff');
        if (el) el.textContent = (100 - pct).toFixed(1) + '%';
    }

    async function onStockPertesSave() {
        const input = document.getElementById('fin-stock-pertes-pct');
        if (!input) return;
        const pct = parseFloat(input.value);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
            if (typeof showToast === 'function') showToast('% invalide (0-100)', 'warning');
            return;
        }
        try {
            const res = await fetch('/api/finance/config', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stock_pertes_decoupe_pct: pct, mois: getChargesMois() })
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur');
            updateStockCoeffDisplay(pct);
            if (typeof showToast === 'function') {
                showToast(`Pertes découpe = ${pct}% pour ${formatMoisFr(getChargesMois())}`, 'success');
            }
            loadCharges();
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
        }
    }

    function renderCharges(rows) {
        const tbody = document.querySelector('#fin-charges-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        for (const r of rows) {
            addChargeRow(r.nom, r.libelle, parseFloat(r.montant_mensuel) || 0, r.ordre || 0, true);
        }
        updateChargesTotal();
    }

    // Combining diacritical marks (U+0300..U+036F). Construit via RegExp(string)
    // pour eviter qu'un editeur ne re-normalize les caracteres combinants si
    // le range etait ecrit en litteral dans la source.
    const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

    // Genere un identifiant snake_case ascii a partir d'un libelle libre.
    // Ex: "Loyer Local" -> "loyer_local"; "Électricité" -> "electricite".
    function slugifyChargeNom(libelle) {
        return String(libelle || '')
            .normalize('NFD')
            .replace(DIACRITICS_RE, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 100);
    }

    function addChargeRow(nom, libelle, montant, ordre, fromBdd) {
        const tbody = document.querySelector('#fin-charges-table tbody');
        if (!tbody) return;
        const tr = document.createElement('tr');

        const tdOrdre = document.createElement('td');
        const inOrdre = document.createElement('input');
        inOrdre.type = 'number'; inOrdre.className = 'form-control form-control-sm text-end';
        inOrdre.style.width = '70px';
        inOrdre.value = ordre || 0;
        inOrdre.dataset.col = 'ordre';
        tdOrdre.appendChild(inOrdre);

        const tdLibelle = document.createElement('td');
        const inLib = document.createElement('input');
        inLib.type = 'text'; inLib.className = 'form-control form-control-sm';
        inLib.value = libelle || '';
        inLib.dataset.col = 'libelle';
        inLib.placeholder = 'Ex: Eau, Maintenance, Assurance...';
        tdLibelle.appendChild(inLib);

        const tdNom = document.createElement('td');
        const inNom = document.createElement('input');
        inNom.type = 'text'; inNom.className = 'form-control form-control-sm';
        inNom.value = nom || '';
        inNom.dataset.col = 'nom';
        inNom.placeholder = 'auto';
        if (fromBdd) {
            // PK existant: on n'autorise pas le rename (sinon delete+create).
            inNom.readOnly = true;
            inNom.style.background = '#f8fafc';
        } else {
            // Nouvelle charge: derive le nom (PK) en snake_case depuis le libelle
            // tant que l'utilisateur n'a pas tape un nom custom.
            let nomManuallyEdited = false;
            inNom.addEventListener('input', () => { nomManuallyEdited = true; });
            inLib.addEventListener('input', () => {
                if (!nomManuallyEdited) {
                    inNom.value = slugifyChargeNom(inLib.value);
                }
            });
        }
        tdNom.appendChild(inNom);

        const tdMontant = document.createElement('td');
        const inM = document.createElement('input');
        inM.type = 'number'; inM.min = '0'; inM.step = '1';
        inM.className = 'form-control form-control-sm text-end';
        inM.value = montant == null ? '' : montant;
        inM.dataset.col = 'montant_mensuel';
        inM.addEventListener('input', updateChargesTotal);
        tdMontant.appendChild(inM);

        const tdActions = document.createElement('td');
        tdActions.className = 'text-nowrap';

        // Bouton historique (uniquement pour les charges deja en BDD).
        if (fromBdd && nom) {
            const btnHist = document.createElement('button');
            btnHist.type = 'button';
            btnHist.className = 'btn btn-sm btn-outline-secondary me-1';
            btnHist.innerHTML = '<i class="bi bi-clock-history"></i>';
            btnHist.title = 'Historique du montant';
            btnHist.addEventListener('click', async () => {
                try {
                    const res = await fetch('/api/finance/charges/' + encodeURIComponent(nom) + '/history', {
                        credentials: 'include'
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    showPrixHistoryModal('Montant mensuel', libelle || nom, 'montant_mensuel', j.data);
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            });
            tdActions.appendChild(btnHist);
        }

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn btn-sm btn-outline-danger';
        btnDel.textContent = '×';
        btnDel.title = 'Supprimer cette charge';
        if (nom && fromBdd) btnDel.dataset.originalNom = nom;
        btnDel.addEventListener('click', async () => {
            const original = btnDel.dataset.originalNom;
            if (original) {
                let ok;
                if (typeof showConfirmModal === 'function') {
                    ok = await showConfirmModal(`Supprimer la charge "${libelle}" ?`, {
                        title: 'Supprimer', okLabel: 'Supprimer', okVariant: 'danger'
                    });
                } else {
                    ok = confirm(`Supprimer la charge "${libelle}" ?`);
                }
                if (!ok) return;
                try {
                    const res = await fetch('/api/finance/charges/' + encodeURIComponent(original), {
                        method: 'DELETE', credentials: 'include'
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    if (typeof showToast === 'function') showToast('Charge supprimée', 'success');
                    loadCharges();
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            } else {
                tr.remove();
                updateChargesTotal();
            }
        });
        tdActions.appendChild(btnDel);

        tr.append(tdOrdre, tdLibelle, tdNom, tdMontant, tdActions);
        tbody.appendChild(tr);
        updateChargesTotal();

        // UX: focus auto sur le libelle pour une nouvelle ligne.
        if (!fromBdd) {
            setTimeout(() => inLib.focus(), 0);
        }
    }

    function updateChargesTotal() {
        const total = Array.from(document.querySelectorAll('#fin-charges-table tbody tr')).reduce((sum, tr) => {
            const v = parseFloat(tr.querySelector('[data-col="montant_mensuel"]').value);
            return sum + (Number.isFinite(v) ? v : 0);
        }, 0);
        const el = document.getElementById('fin-charges-total');
        if (el) el.textContent = fmtMoney(total);
    }

    async function onChargesSave() {
        const items = [];
        const invalidRows = [];
        const rows = Array.from(document.querySelectorAll('#fin-charges-table tbody tr'));
        for (const tr of rows) {
            const obj = {};
            tr.querySelectorAll('input').forEach((inp) => { obj[inp.dataset.col] = inp.value; });
            const libelle = String(obj.libelle || '').trim();
            const nom = String(obj.nom || '').trim();
            // Ligne completement vide: skip silencieusement.
            if (!libelle && !nom) continue;
            // Libelle saisi mais nom vide (slugify a echoue, ex: "!!!"):
            // on alerte plutot que de silencieusement perdre la ligne.
            if (!nom) {
                invalidRows.push(libelle || '(sans libelle)');
                tr.querySelector('[data-col="nom"]').classList.add('is-invalid');
                continue;
            }
            // Nom present mais libelle vide: idem, alerte explicite.
            if (!libelle) {
                invalidRows.push(nom);
                tr.querySelector('[data-col="libelle"]').classList.add('is-invalid');
                continue;
            }
            // Validation explicite du montant: blanc / non-numerique / negatif
            // -> alerte plutot que coercition silencieuse a 0.
            const montantRaw = String(obj.montant_mensuel || '').trim();
            const montantNum = parseFloat(montantRaw);
            const montantCell = tr.querySelector('[data-col="montant_mensuel"]');
            if (montantRaw === '' || !Number.isFinite(montantNum) || montantNum < 0) {
                invalidRows.push(`${libelle} (montant)`);
                if (montantCell) montantCell.classList.add('is-invalid');
                continue;
            }
            if (montantCell) montantCell.classList.remove('is-invalid');
            tr.querySelector('[data-col="nom"]').classList.remove('is-invalid');
            tr.querySelector('[data-col="libelle"]').classList.remove('is-invalid');
            items.push({
                nom,
                libelle,
                montant_mensuel: montantNum,
                ordre: parseInt(obj.ordre, 10) || 0
            });
        }
        if (invalidRows.length) {
            if (typeof showToast === 'function') {
                showToast(
                    `Identifiant ou libellé manquant pour: ${invalidRows.join(', ')}`,
                    'warning'
                );
            }
            return;
        }
        try {
            const res = await fetch('/api/finance/charges', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items, mois: getChargesMois() })
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur');
            if (typeof showToast === 'function') {
                showToast('Charges sauvegardées pour ' + formatMoisFr(getChargesMois()), 'success');
            }
            loadCharges();
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
        }
    }

    // ===== PL (Profit/Loss) =====

    // Periode du dernier chargement REUSSI. Revenir sur l'onglet sans changer
    // la periode ne relance rien: l'ecran montre deja ce resultat, et le
    // recalcul complet cote serveur n'est pas gratuit. Actualiser (force) ou
    // changer les dates recharge. Meme motif sur Cash et Stock et Simulation.
    let plChargePour = null;

    async function loadPl(force) {
        const resultEl = document.getElementById('fin-pl-result');
        if (!resultEl) return;
        // Garde-fou: pre-remplir les dates si vides (1er du mois -> today).
        // Le subnav click handler appelle ensureDefaultDates au clic Finance
        // mais on le re-appelle ici par securite (ex: deep link direct PL).
        ensureDefaultDates();
        const dateDebut = document.getElementById('fin-pl-date-debut').value;
        const dateFin = document.getElementById('fin-pl-date-fin').value;
        const clePeriode = dateDebut + '|' + dateFin;
        if (!force && plChargePour === clePeriode && plDernieresDonnees) return;
        resultEl.innerHTML = '<div class="text-muted"><i class="bi bi-hourglass-split"></i> Calcul en cours...</div>';
        try {
            const qs = new URLSearchParams();
            if (dateDebut) qs.set('dateDebut', dateDebut);
            if (dateFin) qs.set('dateFin', dateFin);
            const res = await fetch('/api/finance/pl?' + qs.toString(), { credentials: 'include' });
            const json = await res.json();
            if (res.status === 403) {
                resultEl.innerHTML = '<div class="alert alert-warning">Accès réservé aux administrateurs et superviseurs.</div>';
                return;
            }
            if (!json.success) throw new Error(json.error || 'Erreur');
            renderPl(json.data);
            plChargePour = clePeriode;
        } catch (e) {
            resultEl.innerHTML = `<div class="alert alert-danger">Erreur: ${esc(e.message)}</div>`;
        }
    }

    // Le String() conserve le repli d'origine: null rend '' et non 'null',
    // qui s'afficherait tel quel dans les cellules du tableau.
    const fmtDateFr = (iso) => window.datesFr.enFrancais(String(iso == null ? '' : iso));

    // ===== Export Excel du PL (tout ce que montre l'ecran) =====
    // Construit depuis plDernieresDonnees: on exporte EXACTEMENT ce qui est
    // affiche - PL courant ou snapshot en cours de consultation.
    function exporterPlExcel() {
        try {
            const d = plDernieresDonnees;
            if (!d) {
                if (typeof showToast === 'function') showToast('Charge d\'abord le PL.', 'warning');
                return;
            }
            if (typeof XLSX === 'undefined') {
                if (typeof showToast === 'function') showToast('Librairie Excel indisponible.', 'danger');
                return;
            }
            const p = d.periode || {};
            const ch = d.charges || { detail: [] };
            const stock = d.stock || {};

            // Feuille 1: la decomposition, chaque poste en CONTRIBUTION signee
            // (comme l'ecran), puis marge brute et PL.
            const ventes = d.total_ventes || 0;
            const coutDesVentes = d.cout_des_ventes !== undefined && d.cout_des_ventes !== null
                ? d.cout_des_ventes
                : (d.total_avances || 0) + (d.paiements_fournisseur || 0) - (stock.variation_nette || 0);
            const margeBrute = d.marge_des_ventes !== undefined && d.marge_des_ventes !== null
                ? d.marge_des_ventes
                : ventes - coutDesVentes;
            const synthese = [
                { 'Poste': 'Période', 'Montant (FCFA)': `${fmtDateFr(p.dateDebut)} → ${fmtDateFr(p.dateFin)} (${p.nb_jours} jours)` },
                { 'Poste': 'Montant total des ventes', 'Montant (FCFA)': ventes },
                { 'Poste': 'dont hors boucherie', 'Montant (FCFA)': d.ventes_hors_boucherie || 0 },
                { 'Poste': 'Total avances (MataBanq)', 'Montant (FCFA)': -(d.total_avances || 0) },
                { 'Poste': 'Commission MaaS', 'Montant (FCFA)': -(d.commission_maas || 0) },
                { 'Poste': 'Marge CDC (Il me doit)', 'Montant (FCFA)': d.marge_cdc || 0 },
                { 'Poste': `Charges proratisées (× ${ch.ratio_jours != null ? ch.ratio_jours : ''})`, 'Montant (FCFA)': -(ch.total_prorata || 0) },
                { 'Poste': 'Dépenses (période)', 'Montant (FCFA)': -(d.depenses_periode || 0) },
                { 'Poste': 'Paiements faits au fournisseur', 'Montant (FCFA)': -(d.paiements_fournisseur || 0) },
                { 'Poste': `Variation stock × ${stock.coeff != null ? stock.coeff : ''} (pertes découpe ${stock.pertes_decoupe_pct != null ? stock.pertes_decoupe_pct : ''}%)`, 'Montant (FCFA)': stock.variation_nette || 0 },
                { 'Poste': 'Coût des ventes (avances + paiements − variation stock)', 'Montant (FCFA)': Math.round(coutDesVentes * 100) / 100 },
                { 'Poste': 'Marge des ventes (ventes − coût des ventes)', 'Montant (FCFA)': Math.round(margeBrute * 100) / 100 },
                { 'Poste': 'Marge des ventes (% des ventes)', 'Montant (FCFA)': ventes > 0 ? Math.round((margeBrute / ventes) * 1000) / 10 : '' },
                { 'Poste': 'PL', 'Montant (FCFA)': d.pl || 0 }
            ];
            if (d.depenses_double_compte && d.depenses_double_compte.montant > 0) {
                synthese.push({
                    'Poste': `⚠ Dépenses en possible double compte (${(d.depenses_double_compte.categories || []).join(', ')})`,
                    'Montant (FCFA)': d.depenses_double_compte.montant
                });
            }

            // Feuille 2: les charges, comme le tableau de l'ecran.
            const charges = (ch.detail || []).map((c) => ({
                'Charge': c.libelle,
                'Mensuel (FCFA)': c.montant_mensuel,
                'Prorata période (FCFA)': c.prorata
            }));
            charges.push({
                'Charge': 'TOTAL',
                'Mensuel (FCFA)': ch.total_mensuel || 0,
                'Prorata période (FCFA)': ch.total_prorata || 0
            });

            // Feuille 3: le detail de la variation stock.
            const feuilleStock = [
                { 'Élément': `Stock matin (${fmtDateFr(stock.matin_date) || 'n/a'})`, 'Valeur': stock.matin_debut || 0 },
                { 'Élément': `Stock soir${stock.soir_estime === true ? ' — ESTIMÉ' : ''} (${stock.soir_date || 'n/a'})`, 'Valeur': stock.soir_fin || 0 },
                { 'Élément': 'Variation brute', 'Valeur': stock.variation_brute || 0 },
                { 'Élément': 'dont boucherie', 'Valeur': stock.variation_boucherie || 0 },
                { 'Élément': 'dont hors boucherie', 'Valeur': stock.variation_hors_boucherie || 0 },
                { 'Élément': `Pertes découpe (%)`, 'Valeur': stock.pertes_decoupe_pct != null ? stock.pertes_decoupe_pct : '' },
                { 'Élément': 'Coefficient appliqué à la boucherie', 'Valeur': stock.coeff != null ? stock.coeff : '' },
                { 'Élément': 'Variation nette (dans le PL)', 'Valeur': stock.variation_nette || 0 },
                { 'Élément': 'Stocks négatifs ignorés', 'Valeur': stock.negatifs_ignores || 0 },
                { 'Élément': 'Produits écartés (stock non fiable)', 'Valeur': (stock.produits_ecartes || []).join(', ') || '—' }
            ];
            (stock.avertissements || []).forEach((a) => {
                feuilleStock.push({ 'Élément': '⚠ Avertissement valorisation', 'Valeur': a });
            });
            // Un classeur qui ne dirait pas que le stock du soir est estime
            // ferait circuler un chiffre provisoire comme un chiffre constate.
            if (stock.soir_estime === true && stock.estimation) {
                const e = stock.estimation;
                feuilleStock.push({ 'Élément': '⚠ Stock du soir ESTIMÉ', 'Valeur': `inventaire du soir non saisi au ${p.dateFin}` });
                feuilleStock.push({ 'Élément': 'Ancré sur le comptage du', 'Valeur': `${e.date_ancre} (${e.jours_ecart} jour(s) d'écart)` });
                feuilleStock.push({ 'Élément': 'Taux de parage du mois', 'Valeur': e.mois_taux });
                Object.entries(e.par_categorie || {}).forEach(([cat, v]) => {
                    feuilleStock.push({
                        'Élément': `  ${cat} : ancre ${v.kg_ancre} kg + transferts ${v.kg_transferts} kg − sortis ${v.kg_sortis} kg`,
                        'Valeur': `${v.kg_estime} kg estimés (vendu ${v.kg_vendus} kg, parage ${v.taux_parage} %${v.taux_mesure ? ' mesuré' : ' repli'})`
                    });
                });
                (e.avertissements || []).forEach((a) => {
                    feuilleStock.push({ 'Élément': '⚠ Avertissement estimation', 'Valeur': a });
                });
            }

            const classeur = XLSX.utils.book_new();
            const fSyn = XLSX.utils.json_to_sheet(synthese);
            fSyn['!cols'] = [{ wch: 55 }, { wch: 20 }];
            XLSX.utils.book_append_sheet(classeur, fSyn, 'Synthese PL');
            const fCh = XLSX.utils.json_to_sheet(charges);
            fCh['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 20 }];
            XLSX.utils.book_append_sheet(classeur, fCh, 'Charges');
            const fSt = XLSX.utils.json_to_sheet(feuilleStock);
            fSt['!cols'] = [{ wch: 40 }, { wch: 24 }];
            XLSX.utils.book_append_sheet(classeur, fSt, 'Detail stock');

            // Detail par produit de chaque borne, quand le serveur le fournit
            // (un snapshot fige avant cette version ne l'a pas: pas de feuille).
            const ajouterFeuilleBorne = (nomFeuille, lignes) => {
                if (!lignes || !lignes.length) return;
                const rows = lignes.map((l) => ({
                    'Produit': l.produit,
                    'Quantité': l.quantite,
                    'Prix utilisé (FCFA)': l.prix_utilise == null ? '' : Math.round(l.prix_utilise * 100) / 100,
                    'Base': l.base === 'achat' ? 'prix achat' : 'prix de vente conservé',
                    'Valeur (FCFA)': Math.round((l.valeur || 0) * 100) / 100
                }));
                rows.push({
                    'Produit': 'TOTAL', 'Quantité': '', 'Prix utilisé (FCFA)': '', 'Base': '',
                    'Valeur (FCFA)': Math.round(lignes.reduce((s, l) => s + (l.valeur || 0), 0) * 100) / 100
                });
                const f = XLSX.utils.json_to_sheet(rows);
                f['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 18 }, { wch: 22 }, { wch: 16 }];
                XLSX.utils.book_append_sheet(classeur, f, nomFeuille);
            };
            ajouterFeuilleBorne('Stock matin (detail)', stock.matin_detail);
            ajouterFeuilleBorne(
                stock.soir_estime === true ? 'Stock soir (ESTIME)' : 'Stock soir (detail)',
                stock.soir_detail
            );

            XLSX.writeFile(classeur, `pl-${p.dateDebut || 'periode'}-au-${p.dateFin || ''}.xlsx`);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur export: ' + e.message, 'danger');
        }
    }

    /**
     * EXPORT JSON du PL et de l'explication de son ecart.
     *
     * Destine a etre LU PAR UN LLM, pas par un tableur: on rend la structure
     * telle que le serveur l'a calculee, avec les drapeaux et les controles de
     * bouclage, plutot qu'un aplatissement en lignes.
     *
     * Si le panneau « D'ou vient cet ecart ? » n'a jamais ete ouvert, l'appel
     * est DECLENCHE ici en mode auto - exporter un fichier sans l'explication
     * alors que le bouton la promet serait pire qu'une attente d'une seconde.
     */
    async function exporterPlJson(bouton) {
        const d = plDernieresDonnees;
        if (!d) {
            if (typeof showToast === 'function') showToast("Charge d'abord le PL.", "warning");
            return;
        }
        const libelleInitial = bouton ? bouton.innerHTML : null;
        try {
            if (bouton) { bouton.disabled = true; bouton.innerHTML = 'Préparation…'; }
            const p = d.periode || {};
            const fin = isoDeSnapshot(p.dateFin);
            const debut = isoDeSnapshot(p.dateDebut);
            // LA VEILLE REELLE, la meme que le panneau: le panneau explique
            // J-1, pas le dernier PL fige. Deux definitions donneraient deux
            // ecarts differents entre l'ecran et le fichier.
            const veille = fin
                ? new Date(new Date(fin + 'T00:00:00Z').getTime() - 86400000)
                    .toISOString().slice(0, 10)
                : null;

            let ecart = null;
            if (fin && veille) {
                // La cle porte AUSSI le debut de periode: il part dans la
                // requete, donc deux periodes de meme fin mais de debut
                // different rendent des ecarts differents. Sans lui, la
                // seconde aurait resservi le cache de la premiere.
                const cle = fin + '|' + veille + '|auto|' + (debut || '');
                if (plDernierEcart && plDernierEcart.cle === cle) {
                    // Deja calcule par le panneau: on ne refait pas l'appel.
                    ecart = plDernierEcart.data;
                } else {
                    const url = '/api/finance/pl/ecart-jour?date=' + encodeURIComponent(fin)
                        + '&reference=' + encodeURIComponent(veille)
                        + '&mode=auto'
                        + (debut ? '&debut=' + encodeURIComponent(debut) : '');
                    // Un ecart indisponible ne doit pas faire echouer l'export
                    // du PL: on exporte ce qu'on a, en DISANT ce qui manque.
                    //
                    // Le try est INTERNE. Sans lui, une coupure reseau ou une
                    // reponse non-JSON remontait au catch general et l'export
                    // entier etait abandonne - alors que le PL, lui, etait deja
                    // en memoire et parfaitement exportable.
                    try {
                        const res = await fetch(url, { credentials: 'include' });
                        const j = await res.json();
                        ecart = (j && j.success && j.data)
                            ? j.data
                            : { ok: false, raison: 'appel_echoue',
                                message: (j && j.error) || 'écart non calculable' };
                    } catch (eEcart) {
                        ecart = { ok: false, raison: 'appel_echoue',
                            message: eEcart.message || 'écart non calculable' };
                    }
                }
            }

            const sortie = {
                genere_le: new Date().toISOString(),
                // Ce que le fichier CONTIENT, en clair: un LLM qui le lit doit
                // savoir de quoi il parle sans deviner d'apres les cles.
                a_propos: {
                    source: 'Maas App — onglet Finance > PL',
                    pl: 'Cumul du 1er du mois a la date de fin. Formule: ventes '
                        + '− avances − commission MaaS + marge CDC − charges proratisees '
                        + '− depenses − paiements fournisseur + variation de stock nette.',
                    ecart_du_jour: 'Difference poste par poste entre le PL de la date de fin '
                        + 'et celui de la veille. Les deux partent du meme 1er du mois, '
                        + 'donc leur difference est la contribution de la journee.',
                    variation_stock: 'variation nette = variation boucherie × coefficient '
                        + 'de pertes de decoupe + variation hors boucherie. Le coefficient '
                        + 'ne porte QUE sur la boucherie.'
                },
                periode: p,
                pl: d.pl,
                postes: {
                    total_ventes: d.total_ventes,
                    ventes_boucherie: d.ventes_boucherie,
                    ventes_hors_boucherie: d.ventes_hors_boucherie,
                    total_avances: d.total_avances,
                    commission_maas: d.commission_maas,
                    marge_cdc: d.marge_cdc,
                    charges_proratisees: (d.charges || {}).total_prorata,
                    depenses_periode: d.depenses_periode,
                    paiements_fournisseur: d.paiements_fournisseur,
                    variation_stock_nette: (d.stock || {}).variation_nette
                },
                cout_des_ventes: d.cout_des_ventes,
                marge_des_ventes: d.marge_des_ventes,
                taux_marge: d.taux_marge,
                charges: d.charges,
                stock: d.stock,
                volumes: d.volumes,
                sources: d.sources,
                ecart_du_jour: ecart
            };

            telechargerJson(sortie, 'pl-' + (p.dateDebut || 'periode') + '-au-'
                + (p.dateFin || '') + '.json');
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur export JSON: ' + e.message, 'danger');
        } finally {
            if (bouton) { bouton.disabled = false; bouton.innerHTML = libelleInitial; }
        }
    }

    /** Telechargement d'un objet en fichier .json. Une seule ecriture pour
     *  les deux exports (PL et projection). */
    function telechargerJson(objet, nomFichier) {
        const blob = new Blob([JSON.stringify(objet, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nomFichier;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Liberer l'URL: sans revoke, le blob reste en memoire tant que
        // l'onglet vit.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    // ===== Snapshots: figer le PL du jour + historique =====

    // Postes neutralises par l'utilisateur, pour repondre a "et si cette ligne
    // n'existait pas ?". C'est une SIMULATION d'affichage: rien n'est envoye au
    // serveur, rien n'est enregistre, et le PL reel reste affiche a cote.
    //
    // Declare ICI, avant majDeltaJourPl qui le lit. Il vivait 170 lignes plus
    // bas: le code fonctionnait parce que rien n'appelle renderPl() pendant
    // l'evaluation du module, mais le premier appel plus precoce - un rendu
    // optimiste, un test qui importe le fichier - aurait leve
    // « Cannot access before initialization » et emporte tout l'ecran PL.
    // COMMENTAIRE MENSUEL, partage par le PL et Cash et Stock.
    //
    // Un chiffre surprenant se relit des mois plus tard sans que personne ne
    // se souvienne de ce qui l'expliquait. Le 24/08/2026 a Keur Massar,
    // -79 127 F venaient de 40 kg de poisson non saisis au stock: une
    // information qui n'existait que dans la tete de celui qui l'avait
    // trouvee. La note la fixe, par mois et par ecran.
    //
    // Enregistrement a la SORTIE du champ, pas a chaque frappe: une requete
    // par caractere saturerait la route pour rien.
    function blocNoteMois(ecran, mois) {
        if (!/^\d{4}-\d{2}$/.test(String(mois || ''))) return '';
        const id = 'fin-note-' + ecran;
        return `<div class="card mt-3">
            <div class="card-header bg-light d-flex align-items-center justify-content-between">
                <strong>Commentaire du mois (${esc(mois)})</strong>
                <span class="small text-muted" id="${id}-etat"></span>
            </div>
            <div class="card-body">
                <textarea class="form-control form-control-sm" id="${id}" rows="3"
                    placeholder="Ce qui explique les chiffres de ce mois : livraison non saisie, inventaire partiel, commande exceptionnelle…"></textarea>
            </div>
        </div>`;
    }

    async function cablerNoteMois(ecran, mois) {
        const ta = document.getElementById('fin-note-' + ecran);
        const etat = document.getElementById('fin-note-' + ecran + '-etat');
        if (!ta) return;
        const dire = (t) => { if (etat) etat.textContent = t; };
        try {
            const r = await fetch('/api/finance/notes?mois=' + encodeURIComponent(mois)
                + '&ecran=' + encodeURIComponent(ecran), { credentials: 'same-origin' });
            const j = await r.json();
            if (j && j.success) {
                ta.value = (j.data && j.data.texte) || '';
                if (j.data && j.data.updated_at) {
                    dire('modifié le ' + fmtDateFr(String(j.data.updated_at).slice(0, 10))
                        + (j.data.updated_by ? ' par ' + j.data.updated_by : ''));
                }
            }
        } catch (e) { dire('lecture impossible'); }
        // `dernier` evite d'enregistrer quand rien n'a change: ouvrir puis
        // quitter le champ ne doit pas ecraser l'auteur et la date.
        let dernier = ta.value;
        ta.addEventListener('blur', async () => {
            if (ta.value === dernier) return;
            dire('enregistrement…');
            try {
                const r = await fetch('/api/finance/notes', {
                    method: 'PUT', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mois: mois, ecran: ecran, texte: ta.value })
                });
                const j = await r.json();
                if (j && j.success) { dernier = ta.value; dire('enregistré'); }
                else dire('échec : ' + ((j && j.error) || 'inconnu'));
            } catch (e) { dire('échec : ' + e.message); }
        });
    }

    // L'INFOBULLE DES PRODUITS D'UNE COMMANDE, au survol de sa colonne
    // Lignes. « 7 lignes » ne dit pas quoi: le detail par produit est dans
    // la reponse, il manquait a l'ecran. Une infobulle native (title)
    // suffit - pas de JS, pas de dependance - et le saut de ligne s'ecrit
    // &#10; dans l'attribut. L'unite vient du serveur: kg pour la
    // boucherie, piece pour le reste, la base ne sachant pas faire mieux
    // (unite_stock vaut 'unite' pour les 293 produits).
    //
    // Au niveau du module: les commandes du jour se rendent dans
    // rendreEcartJour et les clients de la periode dans renderPl.
    const titreProduits = (produits) => {
        if (!produits || !produits.length) return '';
        const txt = produits.map((p) => {
            const u = p.unite === 'kg' ? 'kg'
                : (nb(p.quantite) > 1 ? 'pi\u00e8ces' : 'pi\u00e8ce');
            // Le cout REEL de ce produit (prix d'achat resolu a sa date,
            // divise par le parage) - pas une soustraction CA - marge au
            // niveau de la commande, qui ne dirait pas LEQUEL des produits a
            // cout\u00e9 cher.
            const cout = p.cout === null || p.cout === undefined
                ? ', co\u00fbt inconnu' : ', co\u00fbt ' + fmtMoney(p.cout);
            return p.produit + ' : ' + fmtDec(p.quantite) + ' ' + u + cout;
        }).join('\n');
        return ' title="' + esc(txt).replace(new RegExp('\n', 'g'), '&#10;')
            + '" style="cursor:help;text-decoration:underline dotted"';
    };

    const plPostesNeutralises = new Set();

    // MEMES REGLES QUE LE PL pour le cash theorique: cliquer une ligne la
    // retire et montre son effet. C'est une SIMULATION, jamais un
    // enregistrement - rien ne part en base, et un rechargement remet tout.
    //
    // Recalculer le total ICI est legitime, contrairement aux approbations
    // de depots qui repassent par le serveur: le total du cash theorique est
    // une simple somme signee de sept lignes, sans rapprochement ni regle
    // metier. Il n'y a donc pas de seconde arithmetique qui pourrait diverger.
    const ctLignesNeutralisees = new Set();
    // PL BOUCHERIE SEULE. Retire le hors boucherie des postes ou l'information
    // existe: ventes (champ `categorie` fiable) et variation de stock (le
    // serveur isole deja variation_boucherie et variation_hors_boucherie).
    // Les DEPENSES et les PAIEMENTS FOURNISSEUR ne portent aucune marque
    // boucherie / hors boucherie: sur Sacre Coeur, 203 100 F de legumes et
    // 81 800 F de viande hachee dorment dans le meme seau
    // `achat_marchandise`, et seule la description en texte libre les separe.
    // On ne les filtre donc pas, et l'ecran le DIT plutot que de laisser
    // croire a un perimetre pur.
    let plBoucherieSeule = false;
    // SIMULATION DU STOCK ESTIME. Rien n'est enregistre - decision du
    // proprietaire du produit: on modifie pour VOIR l'effet sur le PL, et un
    // rechargement repart de l'estimation calculee.
    //   plStockEdite  : produit -> quantite corrigee
    //   plStockAjoute : lignes ajoutees a la main
    // L'etat d'ouverture vit dans une variable et non dans le DOM: <details>
    // bascule de facon asynchrone, et le relire au rendu suivant rendrait un
    // panneau qui se referme tout seul.
    const plStockEdite = new Map();
    let plStockAjoute = [];
    let plDetailEstimationOuvert = false;
    // La periode deja rendue, pour detecter qu'on en change. Les corrections
    // portent sur les lignes d'UNE journee estimee; les laisser vivre d'une
    // periode a l'autre appliquerait a aujourd'hui une quantite saisie pour
    // hier. null = rien n'a encore ete rendu.
    let plPeriodeChargee = null;

    // PL DU JOUR: la difference entre deux cumuls voisins.
    //
    // Un PL fige court du 1er du mois a sa date. C'est un CUMUL, pas une
    // journee: lu tel quel il dit ou en est le mois, jamais ce que la veille a
    // produit. La difference entre deux cumuls isole la journee - a condition
    // qu'ils partent du MEME jour. Deux mois ne se soustraient pas, le cumul
    // repartant de zero au 1er; et une periode choisie a la main (du 5 au 13)
    // ne se compare a aucun snapshot, tous ancres au 1er.
    //
    // D'ou la comparaison sur periode_debut plutot que sur le mois: c'est la
    // condition exacte, et elle se lit sans reflechir.

    // Le jour et l'ecart en jours viennent de lib/dates-fr.js, servi au
    // navigateur par index.html - comme lib/parage.js l'est pour la formule du
    // parage. Trois conversions locales de plus dans ce fichier, chacune avec
    // sa propre tolerance aux entrees, etaient trois endroits ou la prochaine
    // divergence de format pouvait naitre.
    const isoDeSnapshot = (v) => window.datesFr.jourISO(v);
    const joursEntreIso = (a, b) => window.datesFr.ecartEnJours(a, b);

    /**
     * Le PL fige le plus recent qui precede `dateRef` sur la MEME periode.
     *
     * UNE seule definition de « le precedent », partagee par le tableau de
     * l'historique et par la carte du PL. Ils en avaient deux: le tableau
     * prenait le voisin immediat dans la liste triee, la carte filtrait puis
     * retenait le maximum. Un snapshot de periode_debut differente intercale
     * entre deux dates suffisait a les faire diverger - tiret d'un cote,
     * chiffre de l'autre, pour la meme journee au meme instant.
     */
    function snapshotPrecedent(rows, dateRef, periodeDebut) {
        let meilleur = null;
        for (const s of rows) {
            if (isoDeSnapshot(s.periode_debut) !== periodeDebut) continue;
            const d = isoDeSnapshot(s.date);
            if (!d || d >= dateRef) continue;
            if (!meilleur || d > isoDeSnapshot(meilleur.date)) meilleur = s;
        }
        return meilleur;
    }

    /**
     * Le PL de chaque journee, indexe par date ISO.
     *
     * Le premier jour de la periode fait exception: son cumul EST sa journee.
     * Sans ce cas, la ligne du 1er resterait vide alors qu'elle est justement
     * la seule dont la valeur se lit directement.
     *
     * @param {Array} rows snapshots, dans n'importe quel ordre
     * @returns {Map<string, {valeur:number, jours:number, depuis:string|null}>}
     */
    function plParJournee(rows) {
        const out = new Map();
        for (const cur of rows) {
            const dateCur = isoDeSnapshot(cur.date);
            const debutCur = isoDeSnapshot(cur.periode_debut);
            if (!dateCur || !debutCur) continue;
            const prec = snapshotPrecedent(rows, dateCur, debutCur);
            if (prec) {
                const datePrec = isoDeSnapshot(prec.date);
                out.set(dateCur, {
                    valeur: (parseFloat(cur.pl) || 0) - (parseFloat(prec.pl) || 0),
                    jours: joursEntreIso(datePrec, dateCur),
                    depuis: datePrec
                });
            } else if (dateCur === debutCur) {
                out.set(dateCur, { valeur: parseFloat(cur.pl) || 0, jours: 1, depuis: null });
            }
            // Sinon: aucun point de comparaison. Un tiret, plutot que la
            // soustraction de deux periodes qui ne se recouvrent pas.
        }
        return out;
    }

    // La liste des PL figes, gardee en memoire: renderPl est rappele a chaque
    // neutralisation de poste, et l'historique ne bouge pas entre deux clics.
    let plSnapshotsListe = null;
    // Compteur d'invalidations. Une requete partie AVANT une invalidation ne
    // doit pas reposer son resultat apres elle: figer le PL du jour vide le
    // cache, et une reponse en vol depuis dix secondes y remettrait la liste
    // d'avant - donc un historique amputé du snapshot qu'on vient de creer.
    let plSnapshotsGen = 0;

    function invaliderSnapshotsPl() {
        plSnapshotsListe = null;
        plSnapshotsGen += 1;
    }

    async function listeSnapshotsPl(force) {
        if (!force && plSnapshotsListe) return plSnapshotsListe;
        const gen = plSnapshotsGen;
        const res = await fetch('/api/finance/pl/snapshots', { credentials: 'include' });
        const j = await res.json();
        if (!j.success) throw new Error(j.error || 'Erreur');
        const rows = j.data || [];
        // Le resultat sert TOUJOURS a l'appelant - il vient de l'obtenir, il
        // est frais pour lui. Seule la mise en cache est abandonnee quand une
        // invalidation est passee entre-temps.
        if (gen === plSnapshotsGen) plSnapshotsListe = rows;
        return rows;
    }

    /**
     * « Journee du ... : +X » sous le montant du PL.
     *
     * Rempli APRES le rendu, pas pendant: renderPl est synchrone et rappele a
     * chaque clic sur un poste. Aller chercher l'historique dans son corps
     * l'aurait rendu asynchrone pour un complement d'information.
     *
     * Rien ne s'affiche si aucun PL fige ne partage la date de depart de
     * l'ecran. Un nombre faux est pire qu'une case vide.
     */
    async function majDeltaJourPl(d) {
        const cible = document.getElementById('fin-pl-delta-jour');
        if (!cible || !d || !d.periode) return;
        // PL simule: le comparer a un PL fige reel melangerait deux
        // definitions du meme mot.
        if (plPostesNeutralises.size > 0) return;
        try {
            const debut = isoDeSnapshot(d.periode.dateDebut);
            const fin = isoDeSnapshot(d.periode.dateFin);
            if (!debut || !fin) return;
            const estime = !!(d.stock && d.stock.soir_estime === true);
            const noteEstime = estime
                ? '<div class="text-muted fst-italic">stock du soir estimé : ce delta bougera au comptage.</div>'
                : '';

            // PREMIER JOUR DE LA PERIODE: son cumul EST sa journee, il n'y a
            // rien a soustraire. Meme exception que la colonne du tableau, qui
            // affiche bien la valeur du 1er - sans ce cas, la carte restait
            // muette ce jour-la pendant que le tableau, lui, chiffrait.
            if (debut === fin) {
                const v = parseFloat(d.pl) || 0;
                cible.innerHTML = `
                    <span class="text-muted">Journée du ${esc(fmtDateFr(fin))} :</span>
                    <strong class="text-${v >= 0 ? 'success' : 'danger'}">${v >= 0 ? '+' : ''}${esc(fmtMoney(v))}</strong>
                    <div class="text-muted">premier jour de la période : le cumul est la journée</div>
                    ${noteEstime}`;
                return;
            }

            const rows = await listeSnapshotsPl(false);
            // MEME regle que la colonne « PL du jour » du tableau: une seule
            // definition de « le precedent », donc deux ecrans qui ne peuvent
            // pas se contredire.
            const prec = snapshotPrecedent(rows, fin, debut);
            if (!prec) return;
            const datePrec = isoDeSnapshot(prec.date);
            const delta = (parseFloat(d.pl) || 0) - (parseFloat(prec.pl) || 0);
            const jours = joursEntreIso(datePrec, fin);
            const couleur = delta >= 0 ? 'success' : 'danger';
            cible.innerHTML = `
                <span class="text-muted">${jours === 1
                    ? 'Journée du ' + esc(fmtDateFr(fin))
                    : esc(String(jours)) + ' jours depuis le ' + esc(fmtDateFr(datePrec))} :</span>
                <strong class="text-${couleur}">${delta >= 0 ? '+' : ''}${esc(fmtMoney(delta))}</strong>
                <div class="text-muted">écart avec le PL figé du ${esc(fmtDateFr(datePrec))}
                    (${esc(fmtMoney(prec.pl))})</div>
                ${noteEstime}
                <details class="mt-1" id="pl-ecart-details">
                    <summary class="text-primary" style="cursor:pointer">D'où vient cet écart ?</summary>
                    <div id="pl-ecart-corps" class="mt-2 text-start"></div>
                </details>`;
            // CHARGE A LA DEMANDE, et une seule fois. C'est une requete de
            // plus (deux snapshots relus): la faire a chaque rendu du PL la
            // paierait sur toutes les consultations, alors que la question
            // « d'ou vient l'ecart » ne se pose pas a chaque fois.
            const det = document.getElementById('pl-ecart-details');
            if (det) {
                det.addEventListener('toggle', () => {
                    if (!det.open || det.dataset.charge === '1') return;
                    det.dataset.charge = '1';
                    // LA VEILLE REELLE, pas le snapshot precedent disponible.
                    //
                    // Le chiffre au-dessus se compare au dernier PL fige, qui
                    // peut dater de trois jours quand le cron a saute. Le
                    // panneau, lui, explique UNE journee: le serveur recalcule
                    // la veille si elle n'a pas ete figee. Les deux periodes
                    // peuvent donc differer, et le panneau annonce la sienne.
                    const veilleReelle = new Date(
                        new Date(fin + 'T00:00:00Z').getTime() - 86400000)
                        .toISOString().slice(0, 10);
                    rendreEcartJour(fin, veilleReelle, 'auto', debut);
                }, { once: false });
            }
        } catch (e) {
            // Un complement d'information ne doit pas abimer le PL lui-meme.
            cible.innerHTML = '';
        }
    }

    /**
     * D'OU VIENT L'ECART, rendu depuis /pl/ecart-jour.
     *
     * Tout le calcul vient du serveur (lib/pl-ecart-jour.js, module pur et
     * teste): cette fonction n'additionne rien, elle met en forme. Poser ici
     * une seconde arithmetique la ferait diverger de celle qui est testee.
     */
    async function rendreEcartJour(dateJour, dateReference, mode, debutPeriode) {
        const corps = document.getElementById('pl-ecart-corps');
        if (!corps) return;
        // `auto` par defaut: la journee en cours n'est jamais figee avant
        // 23h35, et sans recalcul le panneau serait muet quand on s'en sert.
        const modeUi = ['auto', 'force', 'fige'].includes(mode) ? mode : 'auto';
        corps.innerHTML = '<span class="text-muted">Chargement…</span>';
        try {
            const url = '/api/finance/pl/ecart-jour?date=' + encodeURIComponent(dateJour)
                + '&reference=' + encodeURIComponent(dateReference)
                + '&mode=' + encodeURIComponent(modeUi)
                // LA PERIODE AFFICHEE, sinon le serveur repart du 1er du mois
                // et les colonnes montreraient des cumuls etrangers a l'ecran.
                + (debutPeriode ? '&debut=' + encodeURIComponent(debutPeriode) : '');
            const res = await fetch(url, { credentials: 'include' });
            const j = await res.json();
            const d = j && j.data;
            if (!j.success || !d) throw new Error((j && j.error) || 'réponse invalide');
            plDernierEcart = {
                cle: dateJour + '|' + dateReference + '|' + modeUi + '|' + (debutPeriode || ''),
                data: d
            };

            // REFUS ASSUME. Le module dit pourquoi il ne calcule pas; on le
            // repete tel quel plutot que d'afficher un tableau vide qui se
            // lirait comme « aucun mouvement ».
            // L'INTERRUPTEUR est rendu dans TOUS les cas, refus compris: c'est
            // souvent lui qui debloque la situation, et l'enfermer dans la
            // branche du succes le rendrait inatteignable quand il sert.
            const OPTIONS = [
                ['auto', 'PL figés, recalculés s\'ils manquent'],
                ['force', 'Tout recalculer maintenant'],
                ['fige', 'PL figés seulement']
            ];
            const bascule = `<div class="d-flex align-items-center gap-2 small mb-2 flex-wrap">
                <label class="text-muted" for="pl-ecart-mode">Source des chiffres</label>
                <select class="form-select form-select-sm" id="pl-ecart-mode" style="width:auto"
                    title="Un PL figé peut être périmé : une vente saisie en retard, un stock corrigé. « Tout recalculer » montre l'état courant et signale l'écart avec ce qui avait été figé.">
                    ${OPTIONS.map(([v, t]) => `<option value="${v}"${v === modeUi ? ' selected' : ''}>${esc(t)}</option>`).join('')}
                </select></div>`;
            const cablerBascule = () => {
                const b = document.getElementById('pl-ecart-mode');
                if (b) b.addEventListener('change', () => rendreEcartJour(dateJour, dateReference, b.value, debutPeriode));
            };

            if (d.ok === false) {
                corps.innerHTML = bascule + `<div class="alert alert-secondary py-2 small mb-0">
                    ${esc(d.message || 'Écart non calculable.')}</div>`;
                cablerBascule();
                return;
            }

            const drapeaux = (d.drapeaux || []).map((f) => `
                <div class="alert ${f.niveau === 'fort' ? 'alert-warning' : 'alert-light border'} py-2 small mb-1">
                    <i class="bi bi-exclamation-triangle"></i> ${esc(f.texte)}</div>`).join('');

            const lignes = (d.postes || []).filter((p) => Math.abs(nb(p.contribution)) >= 1)
                .map((p) => {
                    const c = nb(p.contribution);
                    return `<tr>
                        <td>${esc(p.libelle)}</td>
                        <td class="text-end text-muted">${esc(fmtMoney(p.veille))}</td>
                        <td class="text-end text-muted">${esc(fmtMoney(p.jour))}</td>
                        <td class="text-end fw-bold text-${c >= 0 ? 'success' : 'danger'}">
                            ${c >= 0 ? '+' : ''}${esc(fmtMoney(c))}</td></tr>`;
                }).join('');

            const st = d.stock || {};
            const b = st.bornes || {};
            // LES BORNES d'abord: la ligne « Variation de stock » du tableau
            // n'affiche que deux nets, et un net ne se verifie pas. Avec le
            // depart et les deux fins, le lecteur refait le calcul a la main.
            const blocBornes = b.fin_jour !== undefined
                ? `<div class="small mb-2">
                    <div class="fw-medium">Le stock, ligne par ligne :</div>
                    <div>· Stock de <strong>départ</strong>
                        ${b.depart_date ? '<span class="text-muted">(' + esc(b.depart_date) + ')</span>' : ''} :
                        <strong>${esc(fmtMoney(b.depart))}</strong>
                        <span class="text-muted">— commun aux deux journées</span></div>
                    <div>· Stock de <strong>fin</strong> au ${esc(fmtDateFr(d.date_veille))} :
                        ${esc(fmtMoney(b.fin_veille))}
                        <span class="text-muted">→ variation ${esc(fmtMoney(b.variation_veille))}</span></div>
                    <div>· Stock de <strong>fin</strong> au ${esc(fmtDateFr(d.date_jour))} :
                        ${esc(fmtMoney(b.fin_jour))}
                        <span class="text-muted">→ variation ${esc(fmtMoney(b.variation_jour))}</span></div>
                    <div class="text-muted">variation = boucherie
                        (${esc(fmtMoney(b.boucherie_jour))}) × coefficient
                        ${esc(String(b.coeff_jour))} + hors boucherie
                        (${esc(fmtMoney(b.hors_boucherie_jour))}). Le coefficient de pertes
                        de découpe ne porte que sur la boucherie — l'épicerie ne se pare pas.</div>
                   </div>`
                : '';
            // Le partage n'a de sens que si le stock a bouge. Sur une journee
            // sans mouvement, ces deux lignes a zero seraient du bruit.
            const blocStock = blocBornes + ((Math.abs(nb(st.volume)) >= 1 || Math.abs(nb(st.revalorisation)) >= 1)
                ? `<div class="small mb-2">
                    <div class="fw-medium">Dont, sur le stock du soir :</div>
                    <div>· <strong>${esc(fmtMoney(st.volume))}</strong> de mouvement de
                        marchandise, valorisé aux prix de la veille</div>
                    <div>· <strong>${esc(fmtMoney(st.revalorisation))}</strong> de changement
                        de PRIX à quantité inchangée
                        <span class="text-muted">(${Math.round(nb(st.part_revalorisation) * 100)} %
                        du mouvement)</span></div>
                   </div>`
                : '');

            // LE STOCK PRODUIT PAR PRODUIT, avant et apres.
            //
            // Replie: c'est un second niveau de detail, et l'ouvrir d'office
            // enterrerait le tableau des postes sous une liste. Les produits
            // IMMOBILES ne sont pas listes - une ligne a zero n'apprend rien -
            // mais leur nombre est annonce, sinon la liste se lirait comme
            // exhaustive.
            const q = (v) => (v === null || v === undefined) ? '—' : esc(fmtDec(v));
            const px = (v) => (v === null || v === undefined)
                ? '<span class="text-muted">—</span>' : esc(fmtMoney(v));
            const MOUVEMENT = { apparu: 'apparu', disparu: 'disparu', hausse: '↑', baisse: '↓' };
            // UNE VALEUR ADOSSEE AU PRIX DE VENTE est soulignee: faute de prix
            // d'achat connu, elle ne dit pas ce que la marchandise a COUTE, et
            // c'est pourtant ce chiffre-la qu'on rapproche de l'argent sorti.
            const val = (montant, base) => (base === 'vente')
                ? `<span class="text-warning-emphasis" style="text-decoration:underline dotted"
                     title="Valorisé au prix de VENTE : le prix d'achat de ce produit n'est pas connu.">${esc(fmtMoney(montant))}</span>`
                : esc(fmtMoney(montant));
            const lignesProduits = (st.lignes || []).map((l) => `
                <tr>
                    <td>${esc(l.produit)}
                        <span class="text-muted small">${esc(MOUVEMENT[l.mouvement] || '')}</span></td>
                    <td class="text-end">${q(l.quantite_veille)} → <strong>${q(l.quantite_jour)}</strong></td>
                    <td class="text-end">${px(l.prix_veille)} → ${px(l.prix_jour)}</td>
                    <td class="text-end">${val(l.valeur_veille, l.base_veille)}</td>
                    <td class="text-end fw-bold">${val(l.valeur_jour, l.base_jour)}</td>
                    <td class="text-end ${nb(l.effet_volume) >= 0 ? 'text-success' : 'text-danger'}">
                        ${esc(fmtMoney(l.effet_volume))}</td>
                    <td class="text-end ${nb(l.effet_prix) >= 0 ? 'text-success' : 'text-danger'}">
                        ${esc(fmtMoney(l.effet_prix))}</td>
                </tr>`).join('');
            const blocProduits = (st.lignes || []).length
                ? `<details class="mb-2">
                    <summary class="text-primary small" style="cursor:pointer">
                        Le stock produit par produit, avant et après
                        (${(st.lignes || []).length} en mouvement${nb(st.nb_inchanges) > 0
                            ? ', ' + nb(st.nb_inchanges) + ' inchangé'
                              + (nb(st.nb_inchanges) > 1 ? 's' : '') : ''})</summary>
                    <div class="table-responsive mt-2">
                        <table class="table table-sm mb-1">
                            <thead><tr>
                                <th>Produit</th>
                                <th class="text-end">Quantité</th>
                                <th class="text-end">Coût unitaire</th>
                                <th class="text-end">Qté × coût<br>début</th>
                                <th class="text-end">Qté × coût<br>fin</th>
                                <th class="text-end"
                                    title="Ce que les kilos entrés ou sortis valent, comptés au coût de la veille. C'est le mouvement réel de marchandise.">Effet volume</th>
                                <th class="text-end"
                                    title="Ce que la MÊME marchandise vaut en plus ou en moins parce que son coût unitaire a changé. Ni un achat, ni une vente.">Effet prix</th>
                            </tr></thead>
                            <tbody>${lignesProduits}</tbody>
                            <tfoot><tr class="table-light fw-bold">
                                <td colspan="3">Total du stock</td>
                                <td class="text-end">${esc(fmtMoney(st.valeur_veille))}</td>
                                <td class="text-end">${esc(fmtMoney(st.valeur_jour))}</td>
                                <td class="text-end">${esc(fmtMoney(st.volume))}</td>
                                <td class="text-end">${esc(fmtMoney(st.revalorisation))}</td>
                            </tr></tfoot>
                        </table>
                    </div>
                    <div class="small mb-1">
                        <div><strong>Effet volume</strong> — ce que les kilos entrés ou sortis
                            valent, comptés au coût de la veille. C'est le mouvement réel de
                            marchandise.</div>
                        <div><strong>Effet prix</strong> — ce que la <em>même</em> marchandise
                            vaut en plus ou en moins parce que son coût unitaire a changé.
                            <strong>Ni un achat, ni une vente</strong> : le stock est revalorisé
                            sans qu'un gramme n'ait bougé. Un bœuf passé de 4 520 à 4 500 F le
                            kilo fait perdre 2 166 F sur 108,3 kg, sans qu'il ne se soit rien
                            passé.</div>
                    </div>
                    <div class="text-muted small">Les deux se somment exactement à l'écart de
                        valeur, sans reste. Un prix « — » signale un produit absent de cette
                        photo ; une valeur <span style="text-decoration:underline dotted">soulignée</span>
                        est adossée au prix de VENTE, faute de prix d'achat connu — elle ne dit
                        pas ce que la marchandise a coûté.</div>
                    ${(b.pont && Math.abs(nb(b.pont.ecart_soir) - nb(b.pont.ecart_poste)) >= 1)
                        // LE PONT vers le poste. Ce tableau mesure le stock DU
                        // SOIR, le poste mesure la variation DEPUIS LE DEPART:
                        // comparer les deux totaux sans cette explication fait
                        // conclure que l'un est faux.
                        ? `<div class="alert alert-light border py-2 small mb-0 mt-2">
                            <div class="fw-medium">Pourquoi ce total diffère du poste
                                « Variation de stock »</div>
                            <div>· Ce tableau mesure le <strong>stock du soir</strong> :
                                ${esc(fmtMoney(b.pont.ecart_soir))}</div>
                            <div>· Le stock de <strong>départ</strong> a bougé lui aussi :
                                ${esc(fmtMoney(b.pont.ecart_depart))}</div>
                            <div>· Le <strong>coefficient</strong> ${esc(String(b.coeff_jour))}
                                ne s'applique qu'à la boucherie</div>
                            <div>· = poste <strong>${esc(fmtMoney(b.pont.ecart_poste))}</strong></div>
                           </div>`
                        : ''}
                   </details>`
                : '';

            // LE RAPPROCHEMENT ARGENT / MARCHANDISE. C'est la lecture que
            // l'utilisateur a demandee: l'argent sorti est-il devenu du stock,
            // ou a-t-il remplace ce qui s'est vendu ?
            // LA MARGE DE LA JOURNEE, isolee de la structure.
            //
            // MATA facture au prix d'ACHAT: une journee normale verifie donc
            // ventes + variation de stock > avances + paiements. Quand
            // l'inegalite s'inverse, il est sorti du frigo plus de valeur que
            // la caisse n'en a encaisse, et le module leve un drapeau 'fort'.
            // Le calcul vient du serveur (lib/pl-ecart-jour.js, module pur et
            // teste): on ne fait ici que le mettre en forme.
            const mj = d.marge_jour || null;
            const blocMarge = mj ? `<div class="border rounded p-2 mb-2 small
                ${nb(mj.marge) < 0 ? 'border-danger' : ''}">
                <div class="fw-medium mb-1">La marge de la journée</div>
                <div>Ventes <strong>${esc(fmtMoney(mj.ventes))}</strong>
                    ${nb(mj.stock) >= 0 ? '+' : '−'} variation de stock
                    <strong>${esc(fmtMoney(Math.abs(nb(mj.stock))))}</strong>
                    − avances <strong>${esc(fmtMoney(Math.abs(nb(mj.avances))))}</strong>
                    ${nb(mj.paiements) !== 0
                        ? '− paiements fournisseur <strong>'
                          + esc(fmtMoney(Math.abs(nb(mj.paiements)))) + '</strong>'
                        : ''}</div>
                <div class="mt-1">= <strong class="text-${nb(mj.marge) >= 0 ? 'success' : 'danger'}">
                    ${nb(mj.marge) >= 0 ? '+' : ''}${esc(fmtMoney(mj.marge))}</strong>
                    ${mj.taux_pct !== null && mj.taux_pct !== undefined
                        ? ' <span class="text-muted">soit ' + esc(nb(mj.taux_pct).toFixed(2))
                          + ' % des ventes du jour</span>'
                        : ''}</div>
                <div class="text-muted mt-1">Marge sur la MARCHANDISE seule. La commission,
                    les charges et les dépenses n'y sont pas : elles expliquent l'écart entre
                    cette marge et l'effet total de la journée sur le PL.</div>
               </div>` : '';

            // LES COMMANDES DE LA JOURNEE, classees par marge.
            //
            // Le panneau disait quels POSTES ont bouge et quels PRODUITS se
            // sont vendus, jamais QUI a achete. Une journee qui surprend se
            // lit pourtant la: quelle commande a porte la marge, laquelle l'a
            // mangee. Un Jarret vendu 500 F pour 2 250 F de cout disparait
            // dans un total de ventes, il saute aux yeux dans une ligne de
            // commande a marge negative.
            const cj = d.commandes_jour || null;
            const cjLignes = cj ? (cj.commandes || []) : [];
            const blocCommandes = cjLignes.length
                ? `<details class="mb-2">
                    <summary class="text-primary small" style="cursor:pointer">
                      Les commandes du jour, par marge
                      (${esc(String(cjLignes.length))}, marge totale
                       ${nb(cj.total_ca_chiffre) > 0
                          ? esc(fmtMoney(cj.total_marge))
                          : 'inconnue, aucun coût d’achat renseigné'})</summary>
                    <div class="table-responsive mt-2">
                     <table class="table table-sm mb-1"><thead><tr>
                       <th>Commande / client</th>
                       <th class="text-end">Lignes</th>
                       <th class="text-end">CA</th>
                       <th class="text-end">Marge</th>
                       <th class="text-end">Taux</th></tr></thead><tbody>
                       ${cjLignes.map((x) => `<tr>
                         <td>${esc(x.client || x.commande_id || 'Ventes au comptoir')}
                           ${x.client && x.commande_id
                              ? '<span class="text-muted small d-block">' + esc(x.commande_id) + '</span>'
                              : ''}
                           ${(x.sans_cout || []).length
                              ? '<span class="text-muted small d-block">marge partielle : '
                                + esc((x.sans_cout || []).join(', ')) + ' sans coût connu</span>'
                              : ''}</td>
                         <td class="text-end text-muted"><span${titreProduits(x.produits)}>${esc(String(x.lignes))}</span></td>
                         <td class="text-end">${esc(fmtMoney(x.ca))}</td>
                         <td class="text-end fw-bold text-${x.ca_chiffre > 0
                            ? (nb(x.marge) >= 0 ? 'success' : 'danger') : 'muted'}">
                           ${x.ca_chiffre > 0
                            ? (nb(x.marge) >= 0 ? '+' : '') + esc(fmtMoney(x.marge))
                            : '—'}</td>
                         <td class="text-end text-muted">${x.taux_pct === null || x.taux_pct === undefined
                            ? '—' : esc(nb(x.taux_pct).toFixed(1)) + ' %'}</td></tr>`).join('')}
                       <tr class="table-light fw-bold">
                         <td>Total</td><td></td>
                         <td class="text-end">${esc(fmtMoney(cj.total_ca))}</td>
                         <td class="text-end">${nb(cj.total_ca_chiffre) > 0
                            ? esc(fmtMoney(cj.total_marge)) : '—'}</td>
                         <td class="text-end">${nb(cj.total_ca_chiffre) > 0
                            ? esc((nb(cj.total_marge) / nb(cj.total_ca_chiffre) * 100).toFixed(1)) + ' %'
                            : '—'}</td></tr>
                     </tbody></table></div>
                    ${cj.complet === false
                      ? '<div class="alert alert-warning py-2 px-2 small mb-1">Ces commandes sont lues en direct, alors que les postes ci-dessus viennent d’une photo figée :'
                        + ' leur total de ventes diffère de ' + esc(fmtMoney(Math.abs(nb(cj.ecart))))
                        + ' (' + esc(fmtMoney(cj.total_ca)) + ' ici contre ' + esc(fmtMoney(cj.attendu))
                        + ' au poste Ventes). Une vente a probablement été saisie après le figeage.</div>'
                      : ''}
                    <div class="text-muted small">Marge indicative : prix de vente moins prix
                      d'achat divisé par (1 − ${esc(String(cj.parage_pct))} % de parage), au
                      paramètre et non au parage mesuré. La commission MaaS n'y entre pas.
                      Le taux rapporte la marge au CA <em>chiffré</em>, pas au CA total :
                      un produit sans prix d'achat connu ne compte ni au numérateur ni au
                      dénominateur, et une commande dont aucun coût n'est connu affiche
                      un tiret plutôt qu'un trompeur 0,0 %.
                      ${nb(cj.ca_sans_cout) > 0
                        ? esc(fmtMoney(cj.ca_sans_cout)) + ' de CA n\u2019a pas de prix d\u2019achat connu et'
                          + ' ne porte donc aucune marge ici.'
                        : ''}</div>
                   </details>`
                : '';

            const rc = d.reconciliation || {};
            // LES LIGNES QUI COMPOSENT LES DEUX BORNES.
            //
            // Le bloc donnait « 699 067 -> 680 282 » sans jamais dire comment
            // chaque total se construit. La donnee existait pourtant deja dans
            // d.stock.lignes, avec quantite, prix et base par produit et par
            // borne: c'est ce que la ventilation Laspeyres du poste utilise.
            // On la reprend telle quelle plutot que de la recalculer.
            const lignesValo = ((d.stock || {}).lignes || []).filter(
                (l) => nb(l.valeur_veille) !== 0 || nb(l.valeur_jour) !== 0
            );
            const blocRec = (Math.abs(nb(rc.sorties)) >= 1 || Math.abs(nb(rc.entree_stock)) >= 1)
                ? `<div class="border rounded p-2 mb-2 small">
                    <div class="fw-medium mb-1">L'argent sorti et la marchandise</div>
                    <div>${Math.abs(nb(rc.paiements)) >= 1
                        ? 'Avances : <strong>' + esc(fmtMoney(rc.avances)) + '</strong>'
                          + ' + versements fournisseur : <strong>' + esc(fmtMoney(rc.paiements))
                          + '</strong> → <strong>' + esc(fmtMoney(rc.sorties)) + '</strong> sortis'
                        // Sans versement, la somme EST l'avance: repeter le
                        // meme nombre des deux cotes d'une fleche se lit comme
                        // une erreur de calcul.
                        : 'Avances sorties : <strong>' + esc(fmtMoney(rc.sorties)) + '</strong>'}</div>
                    <div>Stock valorisé : ${esc(fmtMoney(rc.stock_veille))}
                        → <strong>${esc(fmtMoney(rc.stock_jour))}</strong>
                        <span class="text-muted">soit ${esc(fmtMoney(rc.entree_stock))}
                        entrés en marchandise</span></div>
                    ${lignesValo.length
                        ? `<details class="mt-1">
                            <summary class="text-primary" style="cursor:pointer">Comment ces
                              deux montants sont valorisés (${esc(String(lignesValo.length))} produits)</summary>
                            <div class="table-responsive mt-2">
                             <table class="table table-sm mb-1"><thead><tr>
                               <th>Produit</th>
                               <th class="text-end">Qté veille</th><th class="text-end">× prix</th>
                               <th class="text-end">= valeur</th>
                               <th class="text-end">Qté jour</th><th class="text-end">× prix</th>
                               <th class="text-end">= valeur</th>
                               <th>Base</th></tr></thead><tbody>
                               ${lignesValo.map((l) => `<tr>
                                 <td>${esc(l.produit)}</td>
                                 <td class="text-end text-muted">${esc(fmtDec(l.quantite_veille))}</td>
                                 <td class="text-end text-muted">${esc(fmtMoney(l.prix_veille))}</td>
                                 <td class="text-end">${esc(fmtMoney(l.valeur_veille))}</td>
                                 <td class="text-end text-muted">${esc(fmtDec(l.quantite_jour))}</td>
                                 <td class="text-end text-muted">${esc(fmtMoney(l.prix_jour))}</td>
                                 <td class="text-end fw-medium">${esc(fmtMoney(l.valeur_jour))}</td>
                                 <td class="small text-muted">${esc(l.base_jour || l.base_veille || '—')}</td>
                               </tr>`).join('')}
                               <tr class="table-light fw-bold">
                                 <td>Total</td><td></td><td></td>
                                 <td class="text-end">${esc(fmtMoney(rc.stock_veille))}</td>
                                 <td></td><td></td>
                                 <td class="text-end">${esc(fmtMoney(rc.stock_jour))}</td><td></td></tr>
                             </tbody></table></div>
                            <div class="text-muted">Base « achat » : le produit est valorisé à son
                              prix d'achat. Base « vente » : aucun prix d'achat n'est connu, le prix
                              de vente sert de substitut et le rapprochement devient approximatif
                              d'autant.</div>
                           </details>`
                        : ''}
                    <div class="mt-1">= ${esc(fmtMoney(rc.sorties))} sortis
                        ${nb(rc.entree_stock) < 0
                            ? '<strong>+</strong> ' + esc(fmtMoney(Math.abs(nb(rc.entree_stock))))
                              + ' prélevés sur le stock'
                            : '<strong>−</strong> ' + esc(fmtMoney(nb(rc.entree_stock)))
                              + ' mis en stock'}
                        = <strong>${esc(fmtMoney(rc.consomme))}</strong>
                        consommés par la journée, à leur coût</div>
                    ${rc.exact === false
                        ? `<div class="text-muted mt-1" style="text-decoration:underline dotted">
                            Dont ${esc(fmtMoney(rc.dont_prix_vente_jour))} valorisés au prix de
                            VENTE faute de prix d'achat : le rapprochement est approximatif
                            d'autant.</div>`
                        : ''}
                    ${Math.abs(nb(rc.depenses_hors_marchandise)) >= 1
                        ? `<div class="text-muted mt-1">Les dépenses de la journée
                            (${esc(fmtMoney(rc.depenses_hors_marchandise))}) sont hors de ce
                            rapprochement : elles n'achètent pas de marchandise.</div>`
                        : ''}
                   </div>`
                : '';

            // CE QU'IL Y A DERRIERE CHAQUE POSTE, quand la source le permet.
            //
            // Replies: le tableau des postes repond a « quel poste », ces
            // blocs a « quoi exactement ». Les ouvrir d'office noierait le
            // premier niveau sous quatre listes.
            const det = d.detail || {};
            const bloc = (titre, items, rendu, note) => (items && items.length)
                ? `<details class="mb-1">
                    <summary class="text-primary small" style="cursor:pointer">${titre}</summary>
                    <div class="table-responsive mt-2">
                        <table class="table table-sm mb-1"><tbody>${items.map(rendu).join('')}</tbody></table>
                    </div>${note || ''}</details>`
                : '';

            // NON VENTILABLE: on dit pourquoi. Un bloc absent se cherche, une
            // raison affichee se comprend - et celle-ci se resout d'elle-meme
            // a mesure que les journees se figent avec le detail.
            const indisponible = (titre, o) => (o && o.ventilable === false && o.raison)
                ? `<div class="text-muted small mb-1"><em>${titre} :</em> ${esc(o.raison)}</div>`
                : '';

            const dv = det.ventes || {};
            const blocVentes = indisponible('Détail des ventes', dv) + bloc(
                `Ce qui s'est vendu (${(dv.lignes || []).length} produits, ${esc(fmtMoney(dv.total_ca))})`,
                dv.lignes,
                (l) => `<tr><td>${esc(l.produit)}</td>
                    <td class="text-end"><strong>${esc(fmtDec(l.quantite))}</strong></td>
                    <td class="text-end text-muted">${l.prix_moyen === null ? '—' : esc(fmtMoney(l.prix_moyen)) + '/u'}</td>
                    <td class="text-end">${esc(fmtMoney(l.ca))}</td></tr>`,
                dv.complet === false
                    ? `<div class="text-danger small">Ces produits totalisent
                        ${esc(fmtMoney(dv.total_ca))} alors que le poste Ventes a bougé de
                        ${esc(fmtMoney(dv.attendu))} : la ventilation est incomplète.</div>`
                    : '');

            const dd = det.depenses || {};
            const blocDepenses = bloc(
                `Les dépenses de la journée (${(dd.lignes || []).length}, ${esc(fmtMoney(dd.total))})`,
                dd.lignes,
                (l) => `<tr><td>${esc(l.libelle)}
                    <span class="text-muted small">${esc(l.date || '')}</span></td>
                    <td class="text-end">${esc(fmtMoney(l.montant))}</td></tr>`,
                dd.complet === false
                    ? `<div class="text-danger small">Ces lignes totalisent
                        ${esc(fmtMoney(dd.total))} alors que le poste a bougé de
                        ${esc(fmtMoney(dd.attendu))} : la liste est incomplète.</div>`
                    : '');

            const dpf = det.paiements || {};
            const blocPaiements = bloc(
                `Les versements au fournisseur (${(dpf.lignes || []).length}, ${esc(fmtMoney(dpf.total))})`,
                dpf.lignes,
                (l) => `<tr><td>${esc(l.libelle)}
                    <span class="text-muted small">${esc(l.date || '')}</span></td>
                    <td class="text-end">${esc(fmtMoney(l.montant))}</td></tr>`,
                dpf.complet === false
                    ? `<div class="text-danger small">Ces lignes totalisent
                        ${esc(fmtMoney(dpf.total))} alors que le poste a bougé de
                        ${esc(fmtMoney(dpf.attendu))} : la liste est incomplète.</div>`
                    : '');

            const dc = det.charges || {};
            const blocCharges = indisponible('Détail des charges', dc) + bloc(
                `Les charges proratisées (${(dc.lignes || []).length}, ${esc(fmtMoney(dc.total))})`,
                dc.lignes,
                (l) => `<tr><td>${esc(l.libelle)}</td>
                    <td class="text-end">${esc(fmtMoney(l.montant))}</td></tr>`,
                `<div class="text-muted small">Ce ne sont pas des décaissements du jour :
                    une charge mensuelle gagne un jour de prorata à chaque journée écoulée.</div>`);

            // LES AVANCES ne se ventilent pas, et le dire vaut mieux que de
            // laisser chercher un bloc qui n'existera jamais.
            const blocAvances = (det.avances && det.avances.ventilable === false
                && (d.postes || []).some((p) => p.cle === 'avances' && Math.abs(nb(p.contribution)) >= 1))
                ? `<div class="text-muted small mb-1"><em>Avances :</em> ${esc(det.avances.raison)}</div>`
                : '';

            // LE BOUCLAGE. Quand la somme ne retombe pas sur l'ecart de PL, le
            // tableau est INCOMPLET: un poste manque a la table du module. On
            // l'affiche quand meme, en disant ce qui n'est pas expliqué.
            const bou = d.bouclage || {};
            const alerteBouclage = bou.coherent === false
                ? `<div class="alert alert-danger py-2 small mb-1">
                    Les postes ci-dessus n'expliquent que
                    ${esc(fmtMoney(bou.somme_contributions))} des
                    ${esc(fmtMoney(bou.ecart_pl))} d'écart :
                    <strong>${esc(fmtMoney(bou.residu))}</strong> restent non attribués.
                    Un poste manque à la décomposition — le chiffre affiché n'est pas faux,
                    il est incomplet.</div>`
                : '';

            // LA PERIODE QUE CE PANNEAU COUVRE, annoncee. Elle peut differer
            // du chiffre affiche au-dessus, qui se compare au dernier PL fige:
            // sans cette ligne, deux ecarts differents se liraient comme le
            // meme, et l'un des deux passerait pour faux.
            const enTete = `<div class="small mb-2">
                <strong>La journée du ${esc(fmtDateFr(d.date_jour))}</strong>
                <span class="text-muted">— écart avec le ${esc(fmtDateFr(d.date_veille))}${
                    d.veille_recalculee ? ' (recalculé)' : ''} :</span>
                <strong class="text-${nb((d.pl || {}).ecart) >= 0 ? 'success' : 'danger'}">
                    ${nb((d.pl || {}).ecart) >= 0 ? '+' : ''}${esc(fmtMoney((d.pl || {}).ecart))}</strong>
                </div>`;

            corps.innerHTML = `
                ${bascule}
                ${enTete}
                ${alerteBouclage}
                ${drapeaux}
                <div class="table-responsive">
                    <table class="table table-sm mb-1">
                        <thead><tr>
                            <th>Poste</th>
                            <th class="text-end">${esc(fmtDateFr(d.date_veille))}</th>
                            <th class="text-end">${esc(fmtDateFr(d.date_jour))}</th>
                            <th class="text-end">Effet sur le PL</th>
                        </tr></thead>
                        <tbody>${lignes || '<tr><td colspan="4" class="text-muted">Aucun poste n\'a bougé de plus d\'un franc.</td></tr>'}</tbody>
                    </table>
                </div>
                ${blocMarge}
                ${blocCommandes}
                ${blocRec}
                ${blocVentes}
                ${blocDepenses}
                ${blocPaiements}
                ${blocCharges}
                ${blocAvances}
                ${blocStock}
                ${blocProduits}
                <div class="text-muted small">Chaque poste est lu sur les deux PL figés, qui
                    partent du même 1ᵉʳ du mois. La colonne <em>Effet sur le PL</em> porte le
                    signe de la formule : une dépense qui monte y apparaît en négatif.</div>`;
            // Apres l'ecriture du HTML: l'element n'existe pas avant.
            cablerBascule();
        } catch (e) {
            corps.innerHTML = `<div class="text-danger small">Écart non chargé : ${esc(e.message)}</div>`;
        }
    }

    // Reflete l'etat du PL affiche sur le bouton "Figer". Le serveur reste
    // l'autorite (il refuse en 409): ceci n'est qu'un confort, d'autant que la
    // route fige TOUJOURS la periode par defaut, pas celle affichee a l'ecran.
    function majBoutonFigerPl(d) {
        const btn = document.getElementById('fin-pl-snapshot');
        if (!btn) return;
        const estime = !!(d && d.stock && d.stock.soir_estime === true);
        btn.disabled = estime;
        btn.title = estime
            ? "Stock du soir non encore saisi : un PL estimé ne peut pas être figé."
            : "Fige le PL du jour (période du 1ᵉʳ du mois à aujourd'hui). Un snapshot par date, le dernier écrase.";
    }

    async function figerPlDuJour() {
        try {
            const res = await fetch('/api/finance/pl/snapshot', { method: 'POST', credentials: 'include' });
            const j = await res.json();
            // Refus explicite du serveur: ce n'est pas une panne, c'est la
            // regle. On le dit calmement, sans alerte rouge.
            if (res.status === 409) {
                if (typeof showToast === 'function') showToast(j.error || 'PL non figeable.', 'warning');
                return;
            }
            if (!j.success) throw new Error(j.error || 'Erreur');
            if (typeof showToast === 'function') {
                showToast(`PL du ${fmtDateFr(j.data.date)} figé : ${fmtMoney(j.data.pl)}`, 'success');
            }
            // Le PL du jour se lit contre le dernier snapshot: en garder un
            // perime ferait comparer l'ecran a l'avant-dernier.
            invaliderSnapshotsPl();
            // Panneau historique ouvert: il montre tout de suite la nouvelle ligne.
            const panel = document.getElementById('fin-pl-historique-panel');
            if (panel && panel.style.display !== 'none') chargerHistoriquePl();
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
        }
    }

    async function basculerHistoriquePl() {
        const panel = document.getElementById('fin-pl-historique-panel');
        if (!panel) return;
        if (panel.style.display !== 'none') {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = '';
        await chargerHistoriquePl();
    }

    async function chargerHistoriquePl() {
        const panel = document.getElementById('fin-pl-historique-panel');
        if (!panel) return;
        panel.innerHTML = '<div class="text-muted small"><i class="bi bi-hourglass-split"></i> Chargement…</div>';
        try {
            // force: on ouvre le panneau pour VOIR l'historique. Le cron du
            // soir a pu ecrire depuis que la page est ouverte.
            const rows = await listeSnapshotsPl(true);
            if (!rows.length) {
                panel.innerHTML = '<div class="alert alert-secondary py-2 small mb-0">Aucun PL figé pour l\'instant — le bouton « Figer le PL du jour » ou le cron du soir en créera.</div>';
                return;
            }
            const parJournee = plParJournee(rows);
            const lignes = rows.map((s) => {
                const dj = parJournee.get(isoDeSnapshot(s.date));
                const celluleJour = dj
                    ? `<td class="text-end fw-medium ${dj.valeur >= 0 ? 'text-success' : 'text-danger'}"
                           title="${esc(dj.depuis
                                ? 'Écart avec le PL figé du ' + fmtDateFr(dj.depuis)
                                : 'Premier jour de la période : le cumul est la journée')}">
                        ${dj.valeur >= 0 ? '+' : ''}${esc(fmtMoney(dj.valeur))}
                        ${dj.jours > 1
                            ? `<span class="badge bg-warning text-dark ms-1"
                                     title="Aucun PL figé les jours intermédiaires : cet écart couvre ${esc(String(dj.jours))} jours, pas un.">sur ${esc(String(dj.jours))} j</span>`
                            : ''}
                       </td>`
                    : '<td class="text-end text-muted" title="Aucun PL figé antérieur dans la même période : la journée ne peut pas être isolée.">—</td>';
                return `<tr data-snap-date="${esc(s.date)}" style="cursor:pointer" title="Afficher ce PL figé">
                <td>${esc(fmtDateFr(s.date))}</td>
                <td class="text-end fw-medium ${parseFloat(s.pl) >= 0 ? 'text-success' : 'text-danger'}">${esc(fmtMoney(s.pl))}</td>
                ${celluleJour}
                <td class="text-end">${esc(fmtMoney(s.total_ventes || 0))}</td>
                <td class="text-center"><span class="badge bg-${s.source === 'cron' ? 'secondary' : 'primary'}">${esc(s.source)}</span></td>
                <td class="small text-muted">${esc(s.created_by || '—')}</td>
            </tr>`;
            }).join('');
            panel.innerHTML = `<div class="card"><div class="card-body p-2">
                <div class="small text-muted mb-1">Un PL figé par date — cliquer une ligne pour l'afficher. La période figée court du 1ᵉʳ du mois à la date.
                <strong>PL du jour</strong> = écart avec le PL figé précédent, donc ce que la journée seule a produit.</div>
                <div class="table-responsive" style="max-height:300px; overflow:auto;">
                <table class="table table-sm table-hover mb-0">
                    <thead><tr><th>Date</th><th class="text-end">PL cumulé</th><th class="text-end">PL du jour</th><th class="text-end">Ventes</th><th class="text-center">Source</th><th>Par</th></tr></thead>
                    <tbody>${lignes}</tbody>
                </table></div></div></div>`;
            panel.querySelectorAll('[data-snap-date]').forEach((tr) => {
                tr.addEventListener('click', () => afficherSnapshotPl(tr.dataset.snapDate));
            });
        } catch (e) {
            panel.innerHTML = `<div class="alert alert-danger py-2 small mb-0">Erreur: ${esc(e.message)}</div>`;
        }
    }

    async function afficherSnapshotPl(date) {
        try {
            const res = await fetch('/api/finance/pl/snapshots/' + encodeURIComponent(date), { credentials: 'include' });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Erreur');
            const snap = j.data;
            // MEME rendu que le PL courant: le payload est la reponse de
            // /api/finance/pl telle qu'elle etait ce jour-la. L'export Excel
            // exporte alors ce snapshot, puisqu'il lit ce qui est affiche.
            renderPl(snap.payload);
            // Le prochain passage par l'onglet recharge le PL COURANT.
            plChargePour = null;
            // On consulte le passe: figer ne s'applique pas a ce qui est
            // affiche (la route fige toujours le jour courant). renderPl vient
            // de regler le bouton sur l'etat du SNAPSHOT: on le neutralise.
            const btnFiger = document.getElementById('fin-pl-snapshot');
            if (btnFiger) {
                btnFiger.disabled = true;
                btnFiger.title = 'Consultation d\'un PL figé : revenez au PL courant pour figer.';
            }
            const resultEl = document.getElementById('fin-pl-result');
            if (resultEl) {
                const bandeau = document.createElement('div');
                bandeau.className = 'alert alert-info py-2 small d-flex justify-content-between align-items-center flex-wrap gap-2';
                bandeau.innerHTML = `<span><i class="bi bi-camera"></i> <strong>PL figé du ${esc(fmtDateFr(snap.date))}</strong>
                        — période ${esc(fmtDateFr(snap.periode_debut))} → ${esc(fmtDateFr(snap.periode_fin))},
                        source ${esc(snap.source)}${snap.created_by ? ', par ' + esc(snap.created_by) : ''}</span>
                    <button type="button" class="btn btn-sm btn-outline-primary" id="fin-pl-snapshot-retour">Retour au PL courant</button>`;
                resultEl.prepend(bandeau);
                bandeau.querySelector('#fin-pl-snapshot-retour')
                    .addEventListener('click', () => loadPl(true));
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
        }
    }

    let plDernieresDonnees = null;
    // LE DERNIER ECART CALCULE, memorise pour l'export.
    //
    // Le panneau « D'ou vient cet ecart ? » charge a la demande: sans ce
    // cache, l'export aurait soit exporte du vide quand le panneau n'a jamais
    // ete ouvert, soit refait un appel deja fait. On garde la reponse ET la
    // paire de dates qu'elle couvre, pour ne pas resservir l'ecart d'une
    // autre journee apres un changement de periode.
    let plDernierEcart = null;

    function renderPl(d) {
        const resultEl = document.getElementById('fin-pl-result');
        if (!resultEl) return;
        // LA SIMULATION DU STOCK NE TRAVERSE PAS UN CHANGEMENT DE PERIODE.
        //
        // plStockEdite et plStockAjoute vivent au niveau du module: ils
        // survivaient a un changement de dates, et les quantites saisies pour
        // une journee s'appliquaient a une autre. On les remet a zero des que
        // la periode bouge, jamais quand elle est identique - sinon un simple
        // re-rendu (bascule d'un poste neutralise) effacerait la saisie.
        const periodeCourante = d && d.periode
            ? String(d.periode.dateDebut) + '|' + String(d.periode.dateFin) : '';
        if (plPeriodeChargee !== null && plPeriodeChargee !== periodeCourante) {
            plStockEdite.clear();
            plStockAjoute = [];
        }
        plPeriodeChargee = periodeCourante;
        // Memorise pour pouvoir re-rendre a chaque bascule sans rappeler l'API.
        plDernieresDonnees = d;
        majBoutonFigerPl(d);
        const ch = d.charges || { detail: [] };
        const stock = d.stock || { matin_debut: 0, soir_fin: 0, variation_brute: 0, variation_nette: 0, coeff: 0.95, pertes_decoupe_pct: 5 };
        const plColor0 = (d.pl || 0) >= 0 ? 'success' : 'danger';

        // Les postes du PL, dans l'ordre d'affichage. Les construire ici plutot
        // que d'ecrire seize lignes de tableau a la main: la neutralisation, le
        // recalcul et le total decoulent alors d'une seule description.
        //
        // signe = la contribution au PL. Ventes et variation stock s'ajoutent,
        // le reste se retranche. C'est ce signe qui rend le total recalculable
        // sans rejouer la formule du serveur.
        const doubleCompte = (d.depenses_double_compte && d.depenses_double_compte.montant > 0)
            ? `<span class="badge bg-warning text-dark ms-2" title="Ces dépenses sont dans des catégories déjà couvertes par les charges fixes proratisées ci-dessus. Si elles correspondent au paiement de l'abonnement mensuel, elles sont comptées deux fois. Si ce sont des surcoûts ponctuels, tout est correct.">⚠ ${esc(fmtMoney(d.depenses_double_compte.montant))} en ${esc(d.depenses_double_compte.categories.join(', '))}</span>`
            : '';

        // Le meme chiffre est rejoue ici, dans la Decomposition et dans les
        // termes de la marge brute: sans la mention "estime" aux trois
        // endroits, l'ecran affiche un chiffre provisoire a trois centimetres
        // du bandeau qui l'annonce.
        const mentionEstime = stock.soir_estime === true ? ' [estimé]' : '';
        const stockTooltip = `Stock matin (${stock.matin_date || 'n/a'}): ${fmtMoney(stock.matin_debut)} | Stock soir${mentionEstime} (${stock.soir_date || 'n/a'}): ${fmtMoney(stock.soir_fin)} | Coefficient: ${stock.coeff} (pertes ${stock.pertes_decoupe_pct}%)`;

        // Remontees ici: le panneau de detail et le calcul du delta les
        // consomment, et ils precedent desormais `postes`.
        const estimation = stock.estimation || null;
        const soirEstime = stock.soir_estime === true && !!estimation;

        // ON NE MONTRE QUE LES LIGNES QUI DISENT QUELQUE CHOSE.
        //
        // L'ancre porte tout le catalogue, epicerie comprise: 97 lignes dont
        // « Ail », « ALWAYS », « ARICOTS BLANC PM », toutes a zero et sans
        // mouvement. Les afficher noierait les huit lignes qui portent le
        // stock, et un tableau qu'on ne peut pas parcourir ne se verifie pas.
        //
        // Une ligne compte des qu'elle a une quantite, un mouvement ou une
        // vente - ou qu'elle a ete corrigee a la main.
        const lignesToutes = (estimation && estimation.lignes) || [];
        const lignesEst = lignesToutes.filter((l) => {
            if (plStockEdite.has(l.produit)) return true;
            const c = l.calcul || {};
            return nb(l.quantite) !== 0 || nb(c.ancre) !== 0
                || nb(c.transferts) !== 0 || nb(c.vendus) !== 0;
        });
        const lignesMasquees = lignesToutes.length - lignesEst.length;
        // Le prix REELLEMENT employe par la valorisation, pas celui de l'ancre:
        // valoriserLignes retient le prix d'achat quand il existe et retombe
        // sur le prix de vente sinon. Afficher l'autre ferait un total qui ne
        // se recompose pas.
        const prixValorises = new Map();
        for (const dl of (stock.soir_detail || [])) {
            if (dl && dl.produit && dl.prix_utilise != null) prixValorises.set(dl.produit, nb(dl.prix_utilise));
        }
        const prixDe = (l) => {
            const px = prixValorises.get(l.produit);
            return Number.isFinite(px) && px > 0 ? px : nb(l.prix_unitaire);
        };
        const qteDe = (l) => (plStockEdite.has(l.produit) ? plStockEdite.get(l.produit) : nb(l.quantite));
        const fmtQ = (v) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

        const lignesHtml = lignesEst.map((l, i) => {
            const c = l.calcul || {};
            const q = qteDe(l), px = prixDe(l);
            const modifiee = plStockEdite.has(l.produit);
            return '<tr' + (modifiee ? ' class="table-warning"' : '') + '>'
                + '<td>' + esc(l.produit)
                  + (l.boucherie ? '' : ' <span class="badge bg-light text-muted border">hors boucherie</span>')
                  + '</td>'
                + '<td class="text-end text-muted">' + esc(fmtQ(c.ancre)) + '</td>'
                + '<td class="text-end text-muted">' + (c.transferts ? esc(fmtQ(c.transferts)) : '\u2014') + '</td>'
                + '<td class="text-end text-muted">' + (c.vendus ? esc(fmtQ(c.vendus)) : '\u2014') + '</td>'
                + '<td class="text-end text-muted">'
                  + (c.taux_parage == null ? '\u2014' : esc(String(c.taux_parage).replace('.', ',')) + ' %') + '</td>'
                + '<td class="text-end text-muted">' + (c.sortis ? esc(fmtQ(c.sortis)) : '\u2014') + '</td>'
                + '<td class="text-end"><input type="number" step="0.01" min="0"'
                  + ' class="form-control form-control-sm text-end" style="width:7rem;margin-left:auto"'
                  + ' data-pl-est="' + i + '" value="' + esc(String(q)) + '"></td>'
                + '<td class="text-end text-muted">' + esc(fmtMoney(px)) + '</td>'
                + '<td class="text-end">' + esc(fmtMoney(q * px)) + '</td>'
                + '</tr>';
        }).join('');

        const ajoutsHtml = plStockAjoute.map((a, i) =>
            '<tr class="table-info">'
            + '<td>' + esc(a.produit) + ' <span class="badge bg-info-subtle text-info">ajout\u00e9</span></td>'
            + '<td class="text-end text-muted" colspan="5">ligne ajout\u00e9e \u00e0 la main</td>'
            + '<td class="text-end"><input type="number" step="0.01" min="0"'
              + ' class="form-control form-control-sm text-end" style="width:7rem;margin-left:auto"'
              + ' data-pl-add="' + i + '" value="' + esc(String(a.quantite)) + '"></td>'
            + '<td class="text-end text-muted">' + esc(fmtMoney(a.prix)) + '</td>'
            + '<td class="text-end">' + esc(fmtMoney(a.quantite * a.prix)) + '</td>'
            + '</tr>').join('');

        // Le catalogue vit dans `stock`, pas a la racine: il est rendu a cote
        // des autres donnees de stock. Le lire sur `d` donnait un menu vide -
        // et un menu vide ne dit pas qu'on cherche au mauvais endroit.
        const optionsAjout = ((stock.produits_catalogue) || []).map((pc) =>
            '<option value="' + esc(pc.produit) + '" data-prix="' + esc(String(pc.prix || 0))
            + '" data-bouch="' + (pc.boucherie ? '1' : '0') + '">' + esc(pc.produit) + '</option>').join('');

        const plDetailEstimation = (soirEstime && lignesEst.length)
            ? '<details class="mb-3" id="pl-detail-estimation"' + (plDetailEstimationOuvert ? ' open' : '') + '>'
              + '<summary class="small text-muted" style="cursor:pointer">'
              + 'D\u00e9tail du calcul, produit par produit \u2014 <strong>modifiable</strong> '
              + '<span class="text-muted">(' + lignesEst.length + ' lignes'
                + (lignesMasquees ? ', ' + lignesMasquees + ' à zéro masquées' : '')
                + ')</span></summary>'
              + '<div class="alert alert-light border small mt-2 mb-2">'
              + '<code>estim\u00e9 = dernier comptage + transferts \u2212 ventes \u00f7 (1 \u2212 parage)</code>. '
              + 'Les ventes sont celles qui <strong>consomment cette ligne</strong> : '
              + '\u00ab Boeuf \u00bb perd ses ventes en gros, en d\u00e9tail, et la moiti\u00e9 de chaque Jarret, '
              + 'selon la colonne <b>Mapp\u00e9 vers</b> du Mapping produits.'
              + '<br>Vous pouvez corriger une quantit\u00e9 ou ajouter un produit : '
              + '<strong>rien n\u2019est enregistr\u00e9</strong>, le PL passe simplement en simulation.</div>'
              + '<div class="table-responsive"><table class="table table-sm align-middle mb-2">'
              + '<thead><tr><th>Produit</th><th class="text-end">Dernier comptage</th>'
              + '<th class="text-end">Transferts</th><th class="text-end">Ventes</th>'
              + '<th class="text-end">Parage</th><th class="text-end">Sortis du stock</th>'
              + '<th class="text-end">Estim\u00e9</th><th class="text-end">Prix</th>'
              + '<th class="text-end">Valeur</th></tr></thead>'
              + '<tbody>' + lignesHtml + ajoutsHtml + '</tbody></table></div>'
              + '<div class="d-flex gap-2 align-items-center flex-wrap">'
              + '<select class="form-select form-select-sm" id="pl-est-produit" style="max-width:16rem">'
              + '<option value="">\u2014 ajouter un produit \u2014</option>' + optionsAjout + '</select>'
              + '<input type="number" step="0.01" min="0" class="form-control form-control-sm"'
              + ' id="pl-est-qte" placeholder="quantit\u00e9" style="max-width:9rem">'
              + '<button class="btn btn-sm btn-outline-primary" id="pl-est-ajouter">Ajouter</button>'
              + ((plStockEdite.size || plStockAjoute.length)
                 ? '<button class="btn btn-sm btn-outline-secondary" id="pl-est-reset">R\u00e9initialiser</button>'
                 : '')
              + '</div></details>'
            : '';

        // L'ECART DE STOCK PRODUIT PAR LES CORRECTIONS.
        //
        // On travaille en DELTA, jamais en recomposant la valorisation
        // entiere: valoriserLignes applique ses propres regles - prix d'achat
        // quand il existe, prix de vente sinon, quantites negatives ecartees -
        // et les rejouer ici en ferait une seconde definition, libre de
        // diverger. Un delta se greffe sur le chiffre du serveur sans le
        // recalculer.
        //
        // Boucherie et hors boucherie sont SEPARES: le coefficient de pertes
        // de decoupe ne porte que sur la premiere. Les melanger ferait diverger
        // le PL simule du PL reel des la premiere modification.
        let deltaBoucherie = 0, deltaHors = 0;
        for (const l of lignesEst) {
            if (!plStockEdite.has(l.produit)) continue;
            const dv = (plStockEdite.get(l.produit) - nb(l.quantite)) * prixDe(l);
            if (l.boucherie) deltaBoucherie += dv; else deltaHors += dv;
        }
        // SANS ESTIMATION, aucune correction ne s'applique. La boucle des
        // lignes editees est inerte d'elle-meme - lignesEst est vide - mais
        // celle des lignes AJOUTEES ne l'etait pas: elle deplacait le PL d'une
        // periode qui n'a pas d'estimation, donc pas de panneau pour le dire.
        for (const a of (soirEstime ? plStockAjoute : [])) {
            const dv = nb(a.quantite) * nb(a.prix);
            if (a.boucherie) deltaBoucherie += dv; else deltaHors += dv;
        }
        const stockModifie = soirEstime && (plStockEdite.size > 0 || plStockAjoute.length > 0);
        const coeffStockUi = nb(stock.coeff) || 1;
        const variationSimulee = stockModifie
            ? nb(stock.variation_nette) + coeffStockUi * deltaBoucherie + deltaHors
            : nb(stock.variation_nette);
        // La COULEUR suit le montant affiche, donc le simule. Elle se lisait
        // sur stock.variation_nette pendant que le poste montrait deja
        // variationSimulee: une correction qui fait passer la variation sous
        // zero affichait un nombre negatif en vert, avec l'icone verte.
        // LES DEUX MONTANTS QUE LA CASE FILTRE.
        //
        // Ventes: le serveur rend deja ventes_boucherie, calcule sur le champ
        // `categorie` des lignes de vente. Stock: il rend variation_boucherie
        // et variation_hors_boucherie separement, parce que le coefficient de
        // pertes de decoupe ne porte que sur la premiere. En boucherie seule,
        // on garde donc variation_boucherie x coeff et on laisse tomber le
        // terme hors boucherie, qui entrait a sa valeur pleine.
        const ventesRetenues = plBoucherieSeule
            ? nb(d.ventes_boucherie)
            : nb(d.total_ventes);
        // Depenses et paiements: on retire la part MARQUEE hors boucherie a la
        // saisie. Une ligne non marquee reste boucherie, ce qui vaut pour tout
        // l'historique anterieur a cette fonctionnalite - d'ou l'avertissement
        // plus bas tant qu'aucune ligne n'est marquee sur la periode.
        const depensesRetenues = plBoucherieSeule
            ? nb(d.depenses_periode) - nb(d.depenses_hors_boucherie)
            : nb(d.depenses_periode);
        const paiementsRetenus = plBoucherieSeule
            ? nb(d.paiements_fournisseur) - nb(d.paiements_hors_boucherie)
            : nb(d.paiements_fournisseur);
        const variationRetenue = plBoucherieSeule
            ? coeffStockUi * (nb(stock.variation_boucherie) + (stockModifie ? deltaBoucherie : 0))
            : variationSimulee;
        const stockCouleur = variationRetenue >= 0 ? 'success' : 'danger';

        const postes = [
            { cle: 'ventes', signe: 1, montant: ventesRetenues, couleur: 'primary', neutralisable: false,
              libelle: '<i class="bi bi-cash-stack text-primary"></i> Montant Total des Ventes'
                + (d.ventes_hors_boucherie_pct !== null && d.ventes_hors_boucherie_pct !== undefined
                    ? ` <span class="badge bg-light text-dark border ms-2"
                          title="Part du chiffre d'affaires qui ne vient pas de la boucherie (famille Épicerie ou Autres).">
                          dont hors boucherie ${esc(fmtMoney(d.ventes_hors_boucherie || 0))}
                          · ${esc(d.ventes_hors_boucherie_pct)} %</span>`
                    : '') },
            { cle: 'avances', signe: -1, montant: d.total_avances || 0, couleur: 'danger', neutralisable: false,
              libelle: '<i class="bi bi-bank text-danger"></i> Total avances (MataBanq)' },
            // AVANCES NON ENCORE SAISIES. Des journees ont recu de la
            // marchandise valorisee sans que MataBanq ait enregistre l'avance:
            // sans cette ligne, le PL surestime le resultat d'autant. Elle est
            // NEUTRALISABLE - un clic montre le PL sans elle - et disparaitra
            // d'elle-meme quand l'avance sera saisie.
            ...(nb(d.avances_provisoires) > 0 ? [{
                cle: 'avances_provisoires', signe: -1,
                montant: d.avances_provisoires, couleur: 'danger', neutralisable: true,
                titre: 'Livraisons valorisées sans avance MataBanq en face : '
                    + (d.avances_provisoires_detail || [])
                        .map((x) => fmtDateFr(x.date) + ' (' + fmtMoney(x.montant) + ')').join(', ')
                    + '. Comptées provisoirement, en attendant la saisie réelle.',
                libelle: '<i class="bi bi-hourglass-split text-danger"></i> Avances non encore saisies'
                    + ' <span class="badge bg-warning text-dark ms-1">provisoire</span>'
                    + ` <span class="badge bg-light text-dark border ms-1">${
                        esc(String((d.avances_provisoires_detail || []).length))} date(s)</span>`
            }] : []),
            { cle: 'commission', signe: -1, montant: d.commission_maas || 0, couleur: 'warning', neutralisable: true,
              libelle: '<i class="bi bi-percent text-warning"></i> Commission MaaS (3%)' },
            { cle: 'marge_cdc', signe: 1, montant: d.marge_cdc || 0, couleur: 'success', neutralisable: true,
              libelle: '<i class="bi bi-coin text-success"></i> Marge CDC (Il me doit)' },
            { cle: 'charges', signe: -1, montant: ch.total_prorata || 0, couleur: 'danger', neutralisable: true,
              libelle: `<i class="bi bi-receipt text-info"></i> Charges proratisées ${esc(libelleProrataCharges(ch))}` },
            { cle: 'depenses', signe: -1, montant: depensesRetenues, couleur: 'danger', neutralisable: true,
              libelle: `<i class="bi bi-cart-dash text-danger"></i> Dépenses (période)${doubleCompte}` },
            { cle: 'paiements', signe: -1, montant: paiementsRetenus, couleur: 'danger', neutralisable: true,
              libelle: '<i class="bi bi-wallet2 text-secondary"></i> Paiements faits au fournisseur' },
            { cle: 'stock', signe: 1, montant: variationRetenue, couleur: stockCouleur, neutralisable: true,
              libelle: `<i class="bi bi-box-seam text-${stockCouleur}"></i> Variation stock ×
                        <span class="badge bg-light text-dark border">${esc(stock.coeff)}</span>
                        <small class="text-muted">(pertes découpe ${esc(stock.pertes_decoupe_pct)}%)</small>`
                        + (stock.soir_estime === true
                            ? ' <span class="badge bg-warning text-dark" title="Le stock du soir n\'a pas encore été compté : cette variation repose sur une estimation.">stock soir estimé</span>'
                            : ''),
              titre: stockTooltip }
        ];

        const actif = (p) => !plPostesNeutralises.has(p.cle);
        // Le PL affiche se recalcule sur les postes actifs. Il vaut exactement
        // d.pl quand rien n'est neutralise - verifie a l'ecran.
        // Sans neutralisation, on reprend le PL du SERVEUR tel quel. Le
        // recalcul somme des montants deja arrondis au centime, la ou le
        // serveur arrondit le total: les deux peuvent differer de quelques
        // centimes, et l'ecran afficherait alors un chiffre qui n'est celui de
        // personne. Le recalcul ne sert qu'a la simulation.
        // Une correction de stock est une simulation au meme titre qu'un poste
        // neutralise: le PL affiche cesse d'etre celui du serveur.
        const simulation = plPostesNeutralises.size > 0 || stockModifie || plBoucherieSeule;
        const pl = simulation
            ? postes.filter(actif).reduce((s, p) => s + p.signe * p.montant, 0)
            : (d.pl || 0);
        const plColor = pl >= 0 ? 'success' : 'danger';
        const ecart = pl - (d.pl || 0);

        // MARGE DES VENTES = ventes - (avances + paiements fournisseur - stock).
        //
        // Les PAIEMENTS FOURNISSEUR manquaient. Ils sont pourtant de la
        // tresorerie d'achat au meme titre que les avances: les laisser dehors
        // affichait 13,8 % de marge la ou elle vaut 10,4 %, et obligeait a les
        // retrancher plus bas - le PL etait juste, la marge non.
        //
        // Le cout des ventes, c'est cette tresorerie MOINS ce qui est reste sur
        // l'etal: on ne compte que ce qui a ete consomme.
        const margeBrute = postes
            .filter((p) => ['ventes', 'avances', 'paiements', 'stock'].includes(p.cle) && actif(p))
            .reduce((s, p) => s + p.signe * p.montant, 0);
        // Retrouve par sa CLE, pas par sa position: postes[0] se trouve etre
        // les ventes aujourd'hui, mais reordonner le tableau ferait alors
        // diviser par le mauvais montant, en silence.
        const posteVentes = postes.find((p) => p.cle === 'ventes');
        const ventesActives = (posteVentes && actif(posteVentes)) ? ventesRetenues : 0;
        // Pourcentage du CHIFFRE D'AFFAIRES. Sans ventes, il n'y a pas de taux
        // a calculer: on affiche un tiret plutot qu'un 0% trompeur.
        const margeBrutePct = ventesActives > 0 ? (margeBrute / ventesActives) * 100 : null;
        const margeColor = margeBrute >= 0 ? 'success' : 'danger';

        // Le calcul EN CLAIR, avec ses montants. Un taux de -176% se verifie
        // alors a l'oeil au lieu d'etre a prendre pour argent comptant, et on
        // voit immediatement quel terme le tire vers le bas.
        // 'paiements' aussi: le serveur le soustrait du cout des ventes
        // (coutDesVentes = avances + paiements - variation nette), mais la
        // ligne affichee le taisait. Avec 143 000 F de paiements, le lecteur
        // qui refaisait la formule a l'oeil tombait sur 540 727 au lieu des
        // 397 727 affiches. A zero on ne l'affiche pas: un « - 0 » n'aide
        // personne et la plupart des sites n'ont aucun fournisseur externe.
        const termesMarge = postes
            .filter((p) => ['ventes', 'avances', 'stock'].includes(p.cle)
                || (p.cle === 'paiements' && nb(p.montant) !== 0))
            .map((p) => {
                const off = !actif(p);
                const valeur = p.signe * p.montant;
                const libelle = { ventes: 'Ventes', avances: 'Avances', paiements: 'Paiements fournisseur', stock: 'Variation stock' }[p.cle]
                    + (p.cle === 'stock' && stock.soir_estime === true ? ' (estimée)' : '');
                const texte = `${valeur >= 0 ? '+' : '−'} ${fmtMoney(Math.abs(valeur))}`;
                return off
                    ? `<span class="text-muted" style="text-decoration:line-through;">${libelle} ${esc(texte)}</span>`
                    : `${libelle} <span class="fw-medium">${esc(texte)}</span>`;
            }).join(' &nbsp;');

        const lignesDecomposition = postes.map((p) => {
            const off = !actif(p);
            // Le signe vient de la CONTRIBUTION REELLE, pas de la place du poste
            // dans la formule. Une variation de stock negative - le cas courant
            // d'une journee de boucherie - a signe:+1 et montant negatif: se
            // fier au seul signe l'affichait "+ 475 000" alors que le bloc
            // marge brute et le tableau Detail variation stock, sur le meme
            // ecran, ecrivaient "- 475 000". La colonne cessait de s'additionner
            // au total qu'elle est censee justifier.
            const valeur = p.signe * p.montant;
            // A zero exactement, la contribution ne dit rien: -1 * 0 vaut -0,
            // et -0 >= 0 est vrai en JavaScript, ce qui affichait "+ 0 FCFA"
            // sur une ligne de depense. On retombe alors sur la NATURE du
            // poste, la seule information qui reste.
            const signeAff = valeur > 0 ? '+' : (valeur < 0 ? '−' : (p.signe > 0 ? '+' : '−'));
            const style = off
                ? 'opacity:.45; text-decoration:line-through; cursor:pointer;'
                : (p.neutralisable ? 'cursor:pointer;' : '');
            const indice = p.neutralisable
                ? `<i class="bi ${off ? 'bi-eye-slash' : 'bi-toggle-on'} ms-2 text-muted" style="font-size:.8rem;"></i>`
                : '';
            return `<tr data-poste="${p.neutralisable ? esc(p.cle) : ''}" style="${style}"
                        ${p.neutralisable ? 'title="Cliquer pour retirer cette ligne du PL et voir son effet"' : (p.titre ? `title="${esc(p.titre)}"` : '')}>
                <td>${p.libelle}${indice}</td>
                <td class="text-end fw-medium text-${off ? 'muted' : p.couleur}">${signeAff} ${esc(fmtMoney(Math.abs(valeur)))}</td>
            </tr>`;
        }).join('');

        const chargesRows = (ch.detail || []).map((c) => `
            <tr>
                <td>${esc(c.libelle)}</td>
                <td class="text-end">${esc(fmtMoney(c.montant_mensuel))}</td>
                <td class="text-end">${esc(fmtMoney(c.prorata))}</td>
            </tr>
        `).join('');

        // Tooltip stock avec dates effectivement utilisees (fallback si pas pile aux dates demandees)

        // Meme regle d'affichage que Cash et Stock: le stock est valorise au
        // prix d'achat fournisseur, et les produits qui n'en ont pas sont
        // nommes. Les deux ecrans doivent dire la meme chose du meme stock.
        //
        // Un asterisque PAR BORNE: le stock matin et le stock soir sont deux
        // snapshots distincts, un produit sans prix d'achat peut n'etre present
        // que dans l'un des deux.
        const plMatinSansPrix = stock.matin_au_prix_de_vente || [];
        const plSoirSansPrix = stock.soir_au_prix_de_vente || [];
        const etoile = ' <span class="text-warning fw-bold">*</span>';
        const plAsterisqueMatin = plMatinSansPrix.length ? etoile : '';
        const plAsterisqueSoir = plSoirSansPrix.length ? etoile : '';
        const detailBorne = (nom, liste) => (liste.length
            ? `<div>${nom} : ${esc(liste.join(', '))}</div>` : '');
        const plLegendePrix = (plMatinSansPrix.length || plSoirSansPrix.length)
            ? `<small class="text-muted"><span class="text-warning fw-bold">*</span>
               Valorisé au <strong>prix d'achat fournisseur</strong>. Sans prix d'achat renseigné,
               ces produits restent au prix de vente :
               ${detailBorne('stock matin', plMatinSansPrix)}${detailBorne('stock soir', plSoirSansPrix)}</small>`
            : `<small class="text-muted">Valorisé au <strong>prix d'achat fournisseur</strong>.</small>`;
        // Pourquoi tel prix a ete retenu. Un repli sur le catalogue faute de
        // reponse de DATA change le chiffre de plusieurs pour cent: le taire
        // laisse croire a une erreur de calcul.
        // Deux regles a rendre visibles: le coefficient ne porte que sur la
        // viande, et les stocks negatifs ne sont pas comptes. Sans le dire, un
        // total qui ne correspond pas a la somme des lignes parait faux.
        const ecartes = stock.produits_ecartes || [];
        const plNoteStock = `<div class="small text-muted mt-1">
            Le coefficient de pertes de découpe ne s'applique qu'à la
            <strong>boucherie</strong> (${esc(fmtMoney(stock.variation_boucherie || 0))}) ;
            le hors boucherie entre à sa valeur pleine
            (${esc(fmtMoney(stock.variation_hors_boucherie || 0))}).
            ${ecartes.length
                ? `<br><span class="text-warning"><i class="bi bi-exclamation-triangle"></i>
                   ${ecartes.length} produit(s) écarté(s) faute de stock fiable :
                   ${esc(ecartes.slice(0, 6).join(', '))}${ecartes.length > 6 ? '…' : ''}.
                   Leur stock du soir est négatif, signe d'entrées non saisies — leurs
                   achats restent comptés dans les Dépenses.</span>`
                : ''}
        </div>`;

        const plAvertPrix = (stock.avertissements || []).length
            ? `<div class="alert alert-warning py-2 small mt-2 mb-0"><i class="bi bi-exclamation-triangle"></i>
               ${(stock.avertissements || []).map((a) => esc(a)).join('<br>')}</div>`
            : '';

        // --- Stock du soir ESTIME -------------------------------------------
        // Ni l'asterisque (qui parle de la base de PRIX) ni le triangle
        // d'avertissement (deja pris par les produits ecartes) ne sont
        // reutilises ici: un badge en toutes lettres, sinon trois signaux
        // differents finissent par dire la meme chose et plus rien.
        const fmtQte = (v) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
        const badgeEstime = soirEstime
            ? ' <span class="badge bg-warning text-dark" title="Le stock du soir de cette date n\'a pas encore été compté : il est estimé à partir du dernier inventaire.">estimé</span>'
            : '';
        const detailParage = soirEstime
            ? Object.entries(estimation.par_categorie || {}).map(([cat, v]) => {
                // On NOMME les produits, pas l'espece. « bovin : 71,05 kg »
                // ne se rapprochait d'aucune ligne du tableau juste en
                // dessous, qui affiche « Boeuf : 88,17 » — le pool bovin vaut
                // Boeuf + Viande Hachée, et rien ne le disait.
                const produits = Array.isArray(v.produits) ? v.produits : [];
                const nom = produits.length
                    ? produits.join(' + ')
                    : (cat === 'dechet' ? 'déchet' : cat);
                const sortie = v.kg_vendus
                    ? `vendu ${esc(fmtQte(v.kg_vendus))} kg → ${esc(fmtQte(v.kg_sortis))} kg sortis du stock`
                        + (v.taux_parage ? ` (parage ${esc(String(v.taux_parage).replace('.', ','))} %${v.taux_mesure ? ' mesuré' : ' — taux de repli'})` : '')
                    : 'aucune vente sur la période';
                return `<li><strong>${esc(nom)}</strong> : ${esc(fmtQte(v.kg_ancre))} kg au dernier comptage`
                    + (v.kg_transferts ? ` ${v.kg_transferts > 0 ? '+' : '−'} ${esc(fmtQte(Math.abs(v.kg_transferts)))} kg de transferts` : '')
                    + `, ${sortie} → <strong>${esc(fmtQte(v.kg_estime))} kg</strong> estimés</li>`;
            }).join('')
            : '';
        // STOCKS NEGATIFS: deja ECARTES du calcul, mais jamais dits.
        //
        // lib/valorisation-stock.js:119 les sort de la somme et des DEUX bornes
        // de la variation - un produit passant de 10 a -15 verrait sinon sa
        // variation ramenee a -10, soit le stock du matin entierement consomme.
        // La regle est bonne. Ce qui manquait, c'est de le DIRE: le payload
        // portait un compte et un montant, l'export les imprimait, l'ecran
        // jamais. Sur o_foire, 26 000 F de Superette sortaient du PL en silence.
        //
        // On NOMME les produits: « 1 ligne negative, -26 000 F » n'apprend pas
        // quoi corriger, « Superette au soir » si.
        const negLignes = (stock.lignes_negatives || []);
        const negNb = nb(stock.nb_lignes_negatives);
        const negVal = nb(stock.negatifs_ignores);
        const plBandeauNegatifs = (negNb > 0 || negVal !== 0)
            ? `<div class="alert alert-warning py-2 small mb-3">
                 <div><i class="bi bi-exclamation-triangle"></i>
                   <strong>${esc(String(negNb))} ligne(s) de stock négatif écartée(s) du PL</strong>
                   ${negVal !== 0 ? `, soit ${esc(fmtMoney(negVal))}` : ''}.
                 </div>
                 ${negLignes.length
                    ? `<ul class="mb-1 mt-2">${negLignes.map((l) => `<li>${esc(l.produit)}
                         <span class="text-muted">au ${esc(l.borne)}</span> :
                         ${esc(fmtQte(l.quantite))} → ${esc(fmtMoney(l.valeur))}</li>`).join('')}</ul>`
                    : ''}
                 <div>Un stock négatif est la signature d'<strong>entrées non saisies</strong> :
                   la marchandise a été achetée, et passée en charge dans l'onglet Dépenses,
                   mais jamais enregistrée en stock. La ligne est donc écartée des
                   <strong>deux</strong> bornes de la variation — la compter telle quelle
                   ajouterait au PL un coût déjà porté par les Dépenses.
                   Saisir l'entrée manquante la fera rentrer dans le calcul.</div>
               </div>`
            : '';

        const plBandeauEstimation = soirEstime
            ? `<div class="alert alert-warning py-2 small mb-3">
                 <div><i class="bi bi-hourglass-split"></i>
                   <strong>Stock du soir non encore saisi au ${esc(fmtDateFr(d.periode.dateFin))}.</strong>
                   Il est <strong>estimé</strong> à partir du dernier inventaire compté
                   (${esc(estimation.date_ancre)}, il y a ${esc(String(estimation.jours_ecart))} jour(s)),
                   auquel on ajoute les transferts et duquel on retranche les kilos
                   qu'il a fallu sortir pour les ventes — parage compris pour la boucherie.
                 </div>
                 ${detailParage ? `<ul class="mb-1 mt-2">${detailParage}</ul>` : ''}
                 <div>Les produits hors boucherie ne subissent aucun parage.
                   Ce PL <strong>ne peut pas être figé</strong> tant que l'inventaire du soir
                   n'est pas saisi.</div>
                 ${(estimation.avertissements || []).length
                    ? `<div class="mt-1">${(estimation.avertissements || []).map((a) => esc(a)).join('<br>')}</div>`
                    : ''}
               </div>`
            : '';

        // DETAIL DU CALCUL, REPLIE PAR DEFAUT ET MODIFIABLE.
        //
        // Un chiffre estime qu'on ne peut pas decomposer ne se verifie pas: on
        // le croit ou on ne le croit pas. Les quatre termes - ancre,
        // transferts, ventes, parage - permettent de le refaire a la main, et
        // la colonne de quantite permet de le corriger quand on SAIT.
        //
        // Rien n'est enregistre. Le PL passe alors en simulation, comme
        // lorsqu'un poste est neutralise: un chiffre simule ne doit jamais
        // pouvoir se lire comme le PL reel.
        // DERNIERE JOURNEE SANS VENTE. Une date de fin posee au-dela de la
        // derniere saisie donne un PL qui a l'air complet: meme nombre de
        // jours, memes charges proratisees, un total simplement plus bas. Le
        // dire evite de lire un resultat tronque comme un mauvais resultat.
        const vdf = d.ventes_date_fin;
        const plBandeauSansVente = (vdf && vdf.aucune_vente === true)
            ? `<div class="alert alert-warning py-2 small mb-3">
                 <i class="bi bi-calendar-x"></i>
                 <strong>Aucune vente saisie le ${esc(fmtDateFr(vdf.date))}</strong>, dernier jour de la période.
                 ${vdf.derniere_date_avec_vente
                    ? `La dernière journée avec des ventes est le
                       <strong>${esc(fmtDateFr(vdf.derniere_date_avec_vente))}</strong>.`
                    : 'Aucune vente sur toute la période.'}
                 Les charges sont proratisées sur ${esc(d.periode.nb_jours)} jours, cette journée comprise :
                 le résultat est donc <strong>incomplet</strong>, pas seulement mauvais.
               </div>`
            : '';

        const stockSignNet = stock.variation_nette >= 0 ? '+' : '−';
        const stockColorNet = stock.variation_nette >= 0 ? 'success' : 'danger';

        // Detail par produit des deux bornes du stock, a la demande: nom,
        // quantite, prix utilise et base (achat, ou prix de vente conserve
        // faute de prix d'achat - marque *). Present seulement quand le
        // serveur le fournit: un snapshot fige avant cette version ne l'a
        // pas, et le bouton n'apparait alors pas.
        const fmtQteStock = (v) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
        const detailBorneStock = (titre, lignes) => {
            if (!lignes || !lignes.length) return '';
            const corps = lignes.map((l) => `<tr>
                <td>${esc(l.produit)}${l.base === 'vente' ? ' <span title="Valorisé au prix de vente saisi, faute de prix d\'achat connu.">*</span>' : ''}</td>
                <td class="text-end">${esc(fmtQteStock(l.quantite))}</td>
                <td class="text-end">${l.prix_utilise == null ? '—' : esc(fmtMoney(l.prix_utilise))}</td>
                <td class="text-end">${esc(fmtMoney(l.valeur))}</td>
            </tr>`).join('');
            const total = lignes.reduce((s, l) => s + (l.valeur || 0), 0);
            return `<div class="col-md-6">
                <div class="small fw-medium mb-1">${titre}</div>
                <div class="table-responsive" style="max-height:280px; overflow:auto;">
                <table class="table table-sm mb-0">
                    <thead><tr><th>Produit</th><th class="text-end">Qté</th><th class="text-end">Prix utilisé</th><th class="text-end">Valeur</th></tr></thead>
                    <tbody>${corps}</tbody>
                    <tfoot><tr class="table-light fw-bold"><th colspan="3">Total</th><th class="text-end">${esc(fmtMoney(total))}</th></tr></tfoot>
                </table></div></div>`;
        };
        const aDetailStock = (stock.matin_detail && stock.matin_detail.length)
            || (stock.soir_detail && stock.soir_detail.length);
        const blocDetailStock = aDetailStock ? `
                <button type="button" class="btn btn-sm btn-outline-secondary mt-2" id="fin-pl-stock-detail-toggle"
                        aria-controls="fin-pl-stock-detail" aria-expanded="false"
                        title="Voir, produit par produit, le prix d'achat utilisé et la valeur de chaque borne.">
                    <i class="bi bi-list-ul"></i> Détails par produit
                </button>
                <div id="fin-pl-stock-detail" class="mt-2" style="display:none">
                    <div class="row g-3">
                        ${detailBorneStock(`Stock matin (${esc(stock.matin_date || 'n/a')})`, stock.matin_detail)}
                        ${detailBorneStock(
                            soirEstime
                                ? `Stock soir estimé au ${esc(stock.soir_date || 'n/a')} — réparti au prorata du comptage du ${esc(estimation.date_ancre)}`
                                : `Stock soir (${esc(stock.soir_date || 'n/a')})`,
                            stock.soir_detail)}
                    </div>
                    <div class="small text-muted mt-1">* valorisé au prix de vente saisi, faute de prix d'achat connu.</div>
                </div>` : '';

        // LES MEILLEURS CLIENTS DE LA PERIODE.
        //
        // Le PL dit COMBIEN on a gagne, la decomposition dit AVEC QUOI. Il
        // manquait AVEC QUI. Meme regle de marge que « les commandes du jour »
        // - prix de vente moins prix d'achat divise par (1 - parage) - mais
        // cumulee sur la periode affichee, et par CLIENT: deux commandes du
        // meme client font une ligne et deux commandes.
        //
        // Replie par defaut: la question ne se pose pas a chaque consultation,
        // mais quand elle se pose il faut pouvoir y repondre.
        const cp = d.clients_periode || null;
        const cpLignes = cp ? (cp.clients || []) : [];
        const aQuelqueChose = cpLignes.length || ((cp && cp.comptoir && cp.comptoir.nb_commandes) || 0) > 0;
        const blocClients = aQuelqueChose ? `<details class="mt-3">
            <summary class="text-primary small" style="cursor:pointer">
              Les meilleurs clients de la période
              (${esc(String(cp.nb_clients))} client${cp.nb_clients > 1 ? 's' : ''} identifié${cp.nb_clients > 1 ? 's' : ''},
               ${esc(String(cp.total_commandes))} commande${cp.total_commandes > 1 ? 's' : ''},
               marge totale ${nb(cp.total_ca_chiffre) > 0
                 ? esc(fmtMoney(cp.total_marge))
                 : 'inconnue, aucun coût d\u2019achat renseigné'})</summary>
            <div class="table-responsive mt-2">
             <table class="table table-sm mb-1"><thead><tr>
               <th>Client</th>
               <th class="text-end">Commandes</th>
               <th class="text-end">Lignes</th>
               <th class="text-end">CA</th>
               <th class="text-end">Marge</th>
               <th class="text-end">Taux</th></tr></thead><tbody>
               ${cpLignes.map((c) => `<tr>
                 <td>${c.client ? esc(c.client)
                    : '<span class="text-muted">Ventes au comptoir</span>'}
                   ${(c.sans_cout || []).length
                      ? '<span class="text-muted small d-block">marge partielle : '
                        + esc((c.sans_cout || []).slice(0, 4).join(', ')) + ' sans coût connu</span>'
                      : ''}</td>
                 <td class="text-end">${esc(String(c.nb_commandes))}</td>
                 <td class="text-end text-muted"><span${titreProduits(c.produits)}>${esc(String(c.lignes))}</span></td>
                 <td class="text-end">${esc(fmtMoney(c.ca))}</td>
                 <td class="text-end fw-bold text-${c.ca_chiffre > 0
                    ? (nb(c.marge) >= 0 ? 'success' : 'danger') : 'muted'}">
                   ${c.ca_chiffre > 0
                    ? (nb(c.marge) >= 0 ? '+' : '') + esc(fmtMoney(c.marge))
                    : '\u2014'}</td>
                 <td class="text-end text-muted">${c.taux_pct === null || c.taux_pct === undefined
                    ? '\u2014' : esc(nb(c.taux_pct).toFixed(1)) + ' %'}</td></tr>`).join('')}
               <tr class="table-light fw-bold">
                 <td>Total</td>
                 <td class="text-end">${esc(String(cp.total_commandes))}</td>
                 <td></td>
                 <td class="text-end">${esc(fmtMoney(cp.total_ca))}</td>
                 <td class="text-end">${nb(cp.total_ca_chiffre) > 0
                    ? esc(fmtMoney(cp.total_marge)) : '\u2014'}</td>
                 <td class="text-end">${nb(cp.total_ca_chiffre) > 0
                    ? esc((nb(cp.total_marge) / nb(cp.total_ca_chiffre) * 100).toFixed(1)) + ' %'
                    : '\u2014'}</td></tr>
             </tbody></table></div>
            ${((cp.comptoir || {}).nb_commandes || 0) > 0 ? `
            <div class="mt-3 mb-1 fw-medium small">Ventes au comptoir
              <span class="text-muted">— ${esc(String(cp.comptoir.nb_commandes))} commande${
                cp.comptoir.nb_commandes > 1 ? 's' : ''}, ${esc(fmtMoney(cp.comptoir.total_ca))} de
                CA, marge ${nb(cp.comptoir.total_ca_chiffre) > 0
                  ? esc(fmtMoney(cp.comptoir.total_marge)) : 'inconnue'}</span></div>
            <div class="text-muted small mb-2">Sans nom de client, il n'y a rien à cumuler : le
              comptoir se lit commande par commande. Voici les
              ${esc(String(cp.comptoir.nb_affichees))} plus grosses marges${
                cp.comptoir.nb_masquees > 0
                  ? `, <strong>${esc(String(cp.comptoir.nb_masquees))} autres ne sont pas affichées</strong>`
                  : ''}.</div>
            <div class="table-responsive">
             <table class="table table-sm mb-1"><thead><tr>
               <th>Date</th><th>Commande</th>
               <th class="text-end">Lignes</th>
               <th class="text-end">CA</th>
               <th class="text-end">Marge</th>
               <th class="text-end">Taux</th></tr></thead><tbody>
               ${(cp.comptoir.commandes || []).map((c) => `<tr>
                 <td>${esc(fmtDateFr(c.date))}</td>
                 <td class="small text-muted">${esc(c.commande_id || 'sans identifiant')}</td>
                 <td class="text-end text-muted"><span${titreProduits(c.produits)}>${esc(String(c.lignes))}</span></td>
                 <td class="text-end">${esc(fmtMoney(c.ca))}</td>
                 <td class="text-end fw-bold text-${c.ca_chiffre > 0
                    ? (nb(c.marge) >= 0 ? 'success' : 'danger') : 'muted'}">
                   ${c.ca_chiffre > 0
                    ? (nb(c.marge) >= 0 ? '+' : '') + esc(fmtMoney(c.marge))
                    : '\u2014'}</td>
                 <td class="text-end text-muted">${c.taux_pct === null || c.taux_pct === undefined
                    ? '\u2014' : esc(nb(c.taux_pct).toFixed(1)) + ' %'}</td></tr>`).join('')}
             </tbody></table></div>` : ''}
            <div class="text-muted small">Marge indicative : prix de vente moins prix d'achat
              divisé par (1 − ${esc(String(cp.parage_pct))} % de parage), au paramètre et non au
              parage mesuré. Le prix d'achat est celui de la DATE de chaque vente, pas le dernier
              connu. La commission MaaS n'y entre pas. Le taux rapporte la marge au CA
              <em>chiffré</em> : un produit sans prix d'achat ne compte ni au numérateur ni au
              dénominateur.
              ${nb(cp.ca_sans_cout) > 0
                ? ' ' + esc(fmtMoney(cp.ca_sans_cout)) + ' de CA n\u2019a pas de prix d\u2019achat'
                  + ' connu et ne porte donc aucune marge ici.'
                : ''}</div>
           </details>` : '';

        resultEl.innerHTML = `
            ${plBandeauSansVente}
            ${plBandeauNegatifs}
            ${plBandeauEstimation}
            ${plDetailEstimation}
            <!-- Cartes PL et marge brute -->
            <div class="row g-2 mb-3">
                <div class="col-md-6">
                    <div class="card border-${plColor} h-100">
                        <div class="card-body text-center">
                            <h6 class="card-subtitle mb-2 text-muted">
                                ${simulation ? 'PL simulé' : 'Profit / Loss'}
                                (${esc(d.periode.dateDebut)} → ${esc(d.periode.dateFin)}, ${esc(d.periode.nb_jours)} jours)
                            </h6>
                            <h2 class="text-${plColor} mb-0">${pl >= 0 ? '+' : ''}${esc(fmtMoney(pl))}</h2>
                            <!-- Rempli apres le rendu par majDeltaJourPl(): l'ecart
                                 avec le dernier PL fige, soit la journee seule. -->
                            <div id="fin-pl-delta-jour" class="small mt-2"></div>
                            ${simulation ? `<div class="small text-muted mt-2">
                                PL réel <strong class="text-${plColor0}">${esc(fmtMoney(d.pl || 0))}</strong>
                                &nbsp;·&nbsp; écart <strong class="text-${ecart >= 0 ? 'success' : 'danger'}">${ecart >= 0 ? '+' : ''}${esc(fmtMoney(ecart))}</strong>
                            </div>` : ''}
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card border-${margeColor} h-100">
                        <div class="card-body text-center">
                            <h6 class="card-subtitle mb-2 text-muted">Marge des ventes</h6>
                            <h2 class="text-${margeColor} mb-0">${margeBrute >= 0 ? '+' : ''}${esc(fmtMoney(margeBrute))}</h2>
                            <div class="small text-muted mt-2">
                                ${margeBrutePct === null
                                    ? 'taux indisponible (aucune vente)'
                                    : `<strong class="text-${margeColor}">${esc(margeBrutePct.toFixed(2))} %</strong> du chiffre d'affaires`}
                            </div>
                            <!-- Le calcul, montants a l'appui: verifiable a l'oeil. -->
                            <div class="mt-2 pt-2 border-top small text-muted" style="line-height:1.7;">
                                <div>${termesMarge}</div>
                                <div class="mt-1">
                                    <span class="text-body">= <strong class="text-${margeColor}">${esc(fmtMoney(margeBrute))}</strong></span>
                                    ${margeBrutePct !== null
                                        ? `&nbsp;÷&nbsp;${esc(fmtMoney(ventesActives))} de ventes
                                           = <strong class="text-${margeColor}">${esc(margeBrutePct.toFixed(2))} %</strong>`
                                        : ''}
                                </div>
                                <div class="mt-1 fst-italic">
                                    Marge sur les achats réellement consommés : avances et paiements
                                    fournisseur, corrigés de ce qui est resté en stock. Les charges,
                                    la commission et les dépenses n'en font pas partie — elles
                                    viennent après.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            ${plBoucherieSeule ? `<div class="alert alert-info py-2 small mb-2">
                <strong>Boucherie seulement.</strong>
                Ventes et variation de stock sont filtrées au franc :
                ${esc(fmtMoney(nb(d.ventes_hors_boucherie)))} de ventes hors boucherie et
                ${esc(fmtMoney(nb(stock.variation_hors_boucherie)))} de variation de stock
                hors boucherie sont retirés. Les avances et la commission MaaS ne portent
                que de la boucherie, elles sont déjà pures.
                ${(nb(d.depenses_hors_boucherie) || nb(d.paiements_hors_boucherie))
                    ? `<div class="mt-1">Dépenses hors boucherie retirées :
                        <strong>${esc(fmtMoney(nb(d.depenses_hors_boucherie)))}</strong> ·
                        paiements fournisseur hors boucherie :
                        <strong>${esc(fmtMoney(nb(d.paiements_hors_boucherie)))}</strong>.</div>`
                    : `<div class="mt-1"><strong>Aucune dépense ni aucun paiement n'est marqué
                        « hors boucherie » sur la période.</strong> Le coût des marchandises hors
                        boucherie reste donc dans ce PL. Cochez la case à la saisie, dans les
                        onglets Dépenses et Créances fournisseur, pour qu'il en sorte.</div>`}
            </div>` : ''}

            <!-- Décomposition -->
            <h6 class="fin-subheading">
                Décomposition
                <small class="text-muted fw-normal ms-2">— cliquez une ligne pour la retirer et voir son effet</small>
                <span class="form-check form-check-inline ms-3 fw-normal">
                    <input class="form-check-input" type="checkbox" id="fin-pl-boucherie"
                           ${plBoucherieSeule ? 'checked' : ''}>
                    <label class="form-check-label small" for="fin-pl-boucherie">Boucherie seulement</label>
                </span>
                ${simulation ? `<button type="button" class="btn btn-sm btn-outline-secondary ms-2" id="fin-pl-reset">
                    <i class="bi bi-arrow-counterclockwise"></i> Tout réactiver (${plPostesNeutralises.size})
                </button>` : ''}
            </h6>
            <div class="table-responsive mb-3">
                <table class="table table-sm mb-0" id="fin-pl-decomposition">
                    <tbody>
                        ${lignesDecomposition}
                        <tr class="table-light fw-bold">
                            <td>PL${simulation ? ' <span class="badge bg-secondary">simulé</span>' : ''}</td>
                            <td class="text-end text-${plColor}">${pl >= 0 ? '+' : ''}${esc(fmtMoney(pl))}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Detail stock -->
            <h6 class="fin-subheading">Détail variation stock</h6>
            <div class="table-responsive mb-3">
                <table class="table table-sm mb-0">
                    <tbody>
                        <tr>
                            <td>Stock matin${plAsterisqueMatin} <small class="text-muted">(${esc(stock.matin_date || 'n/a')})</small></td>
                            <td class="text-end">${esc(fmtMoney(stock.matin_debut))}</td>
                        </tr>
                        <tr>
                            <td>Stock soir${plAsterisqueSoir}${badgeEstime} <small class="text-muted">(${esc(stock.soir_date || 'n/a')})</small></td>
                            <td class="text-end">${esc(fmtMoney(stock.soir_fin))}</td>
                        </tr>
                        <tr>
                            <td>Variation brute</td>
                            <td class="text-end">${esc(fmtMoney(stock.variation_brute))}</td>
                        </tr>
                        <tr>
                            <td>× Coefficient (1 − ${esc(stock.pertes_decoupe_pct)}%)</td>
                            <td class="text-end">× ${esc(stock.coeff)}</td>
                        </tr>
                        <tr class="${stockModifie ? '' : 'table-light fw-bold'}">
                            <td>= Variation stock nette</td>
                            <td class="text-end text-${stockColorNet}">${stockSignNet} ${esc(fmtMoney(Math.abs(stock.variation_nette)))}</td>
                        </tr>
                        ${stockModifie ? `
                        <!-- La derivation ci-dessus reste celle du SERVEUR:
                             brute x coefficient = nette est une identite, et y
                             substituer le simule rendrait faux le calcul
                             affiche juste au-dessus. La correction se pose
                             donc en terme supplementaire, et le total repris
                             est celui que le poste PL utilise. -->
                        <tr>
                            <td>+ Correction simulée
                                <span class="badge bg-secondary">simulé</span></td>
                            <td class="text-end">${variationRetenue - nb(stock.variation_nette) >= 0 ? '+' : '−'} ${esc(fmtMoney(Math.abs(variationRetenue - nb(stock.variation_nette))))}</td>
                        </tr>
                        <tr class="table-light fw-bold">
                            <td>= Variation retenue au PL</td>
                            <td class="text-end text-${stockCouleur}">${variationRetenue >= 0 ? '+' : '−'} ${esc(fmtMoney(Math.abs(variationRetenue)))}</td>
                        </tr>` : ''}
                    </tbody>
                </table>
                ${nb(d.avances_provisoires) > 0 ? `
                <div class="alert alert-warning py-2 px-2 small mt-2 mb-0">
                  <strong>${esc(fmtMoney(d.avances_provisoires))}</strong> de marchandise reçue
                  n'a pas encore d'avance MataBanq en face
                  (${(d.avances_provisoires_detail || [])
                      .map((x) => esc(fmtDateFr(x.date)) + ' : ' + esc(fmtMoney(x.montant))).join(', ')}).
                  Ce montant est compté <strong>provisoirement</strong> dans le coût des ventes ;
                  sans lui, le PL serait surestimé d'autant. Il disparaîtra de lui-même dès que
                  l'avance sera enregistrée. Cliquez la ligne pour voir le PL sans elle.
                </div>` : ''}
                ${plLegendePrix}
                ${plNoteStock}
                ${blocClients}
                ${plAvertPrix}
                ${blocDetailStock}
            </div>

            <!-- Detail charges -->
            <h6 class="fin-subheading">Détail des charges (au prorata des ${esc(d.periode.nb_jours)} jours couverts)</h6>
            <div class="table-responsive">
                <table class="table table-sm mb-0">
                    <thead>
                        <tr>
                            <th>Charge</th>
                            <th class="text-end">Mensuel</th>
                            <th class="text-end">Prorata période</th>
                        </tr>
                    </thead>
                    <tbody>${chargesRows || '<tr><td colspan="3" class="text-muted text-center py-2">Aucune charge configurée</td></tr>'}</tbody>
                    <tfoot>
                        <tr style="background:#f8fafc">
                            <th>Total</th>
                            <th class="text-end">${esc(fmtMoney(ch.total_mensuel))}</th>
                            <th class="text-end">${esc(fmtMoney(ch.total_prorata))}</th>
                        </tr>
                    </tfoot>
                </table>
            </div>
            ${blocNoteMois('pl', String((d.periode || {}).dateFin || '').slice(0, 7))}
        `;
        cablerNoteMois('pl', String((d.periode || {}).dateFin || '').slice(0, 7));

        // L'ecart avec le dernier PL fige, en asynchrone: il demande
        // l'historique, et renderPl doit rester synchrone.
        majDeltaJourPl(d);

        // Delegation apres le rendu: ce fichier est une IIFE, un onclick inline
        // ne trouverait pas la fonction. Un seul ecouteur pour tout le tableau,
        // repose a chaque rendu puisque innerHTML detruit les precedents.

        const table = document.getElementById('fin-pl-decomposition');
        if (table) {
            table.addEventListener('click', (ev) => {
                const tr = ev.target.closest('tr[data-poste]');
                const cle = tr && tr.getAttribute('data-poste');
                if (!cle) return; // ligne non neutralisable (Ventes, Avances, total)
                if (plPostesNeutralises.has(cle)) plPostesNeutralises.delete(cle);
                else plPostesNeutralises.add(cle);
                renderPl(plDernieresDonnees);
            });
        }
        // PANNEAU DE DETAIL DE L'ESTIMATION. Meme motif que ci-dessus: les
        // ecouteurs sont reposes a chaque rendu, innerHTML ayant detruit les
        // precedents.
        const det = document.getElementById('pl-detail-estimation');
        if (det) {
            // L'etat d'ouverture vit dans la variable, pas dans le DOM:
            // <details> bascule de facon asynchrone, et le relire au rendu
            // suivant refermerait le panneau tout seul.
            det.addEventListener('toggle', () => { plDetailEstimationOuvert = det.open; });

            // On rerend sur 'change', pas sur 'input': un rendu a chaque frappe
            // ferait perdre le focus au champ qu'on est en train de remplir.
            det.addEventListener('change', (ev) => {
                const cible = ev.target;
                const iEst = cible.getAttribute && cible.getAttribute('data-pl-est');
                const iAdd = cible.getAttribute && cible.getAttribute('data-pl-add');
                if (iEst !== null && iEst !== undefined && lignesEst[iEst]) {
                    const l = lignesEst[iEst];
                    const v = parseFloat(cible.value);
                    // Revenir a la valeur calculee EFFACE la correction: sans
                    // ca, le PL resterait marque « simulation » alors que plus
                    // rien ne differe.
                    if (!Number.isFinite(v) || v === nb(l.quantite)) plStockEdite.delete(l.produit);
                    else plStockEdite.set(l.produit, v);
                    renderPl(plDernieresDonnees);
                } else if (iAdd !== null && iAdd !== undefined && plStockAjoute[iAdd]) {
                    const v = parseFloat(cible.value);
                    if (!Number.isFinite(v) || v <= 0) plStockAjoute.splice(iAdd, 1);
                    else plStockAjoute[iAdd].quantite = v;
                    renderPl(plDernieresDonnees);
                }
            });

            const btnAjout = document.getElementById('pl-est-ajouter');
            if (btnAjout) {
                btnAjout.addEventListener('click', () => {
                    const sel = document.getElementById('pl-est-produit');
                    const qte = document.getElementById('pl-est-qte');
                    const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
                    const nom = sel ? sel.value : '';
                    const v = qte ? parseFloat(qte.value) : NaN;
                    if (!nom || !Number.isFinite(v) || v <= 0) {
                        if (typeof showToast === 'function') showToast('Choisir un produit et une quantité', 'warning');
                        return;
                    }
                    // UN PRODUIT DEJA ESTIME NE S'AJOUTE PAS.
                    //
                    // Sa ligne existe et se modifie directement dans le
                    // tableau. L'ajouter une seconde fois ne remplacait pas la
                    // premiere: les deux quantites s'additionnaient dans le
                    // delta, et le stock comptait le produit deux fois sans
                    // que rien ne le signale.
                    const dejaEstime = lignesEst.some((l) => l.produit === nom);
                    if (dejaEstime) {
                        if (typeof showToast === 'function') {
                            showToast('« ' + nom + ' » a déjà une ligne estimée : '
                                + 'modifiez sa quantité dans le tableau plutôt que de l\'ajouter.', 'warning');
                        }
                        return;
                    }
                    const prix = opt ? parseFloat(opt.getAttribute('data-prix')) : NaN;
                    // Un produit SANS prix ne compte pas: le valoriser a zero
                    // gonflerait le stock d'une ligne qui ne vaut rien, en
                    // silence. On le dit et on refuse.
                    if (!Number.isFinite(prix) || prix <= 0) {
                        if (typeof showToast === 'function') {
                            showToast('« ' + nom + ' » n\'a pas de prix d\'achat au catalogue : '
                                + 'renseignez-le dans Prix fournisseur avant de l\'ajouter ici.', 'warning');
                        }
                        return;
                    }
                    plDetailEstimationOuvert = true;
                    plStockAjoute.push({
                        produit: nom, quantite: v, prix,
                        boucherie: opt ? opt.getAttribute('data-bouch') === '1' : false
                    });
                    renderPl(plDernieresDonnees);
                });
            }
            const btnReset = document.getElementById('pl-est-reset');
            if (btnReset) {
                btnReset.addEventListener('click', () => {
                    plStockEdite.clear();
                    plStockAjoute = [];
                    plDetailEstimationOuvert = true;
                    renderPl(plDernieresDonnees);
                });
            }
        }

        // La case « Boucherie seulement ». Elle ne touche a AUCUN calcul
        // serveur: elle change les montants retenus pour les postes ventes et
        // stock, et le PL se recalcule sur les postes actifs comme il le fait
        // deja pour une ligne neutralisee.
        const cbBoucherie = document.getElementById('fin-pl-boucherie');
        if (cbBoucherie) {
            cbBoucherie.addEventListener('change', () => {
                plBoucherieSeule = cbBoucherie.checked;
                renderPl(plDernieresDonnees);
            });
        }

        const reset = document.getElementById('fin-pl-reset');
        if (reset) {
            reset.addEventListener('click', () => {
                plPostesNeutralises.clear();
                plStockEdite.clear();
                plStockAjoute = [];
                plBoucherieSeule = false;
                renderPl(plDernieresDonnees);
            });
        }
        // Bouton "Détails par produit" du bloc variation stock: simple
        // bascule d'affichage, tout est deja rendu.
        const toggleDetailStock = document.getElementById('fin-pl-stock-detail-toggle');
        if (toggleDetailStock) {
            toggleDetailStock.addEventListener('click', () => {
                const zone = document.getElementById('fin-pl-stock-detail');
                if (!zone) return;
                const ouvre = zone.style.display === 'none';
                zone.style.display = ouvre ? '' : 'none';
                toggleDetailStock.setAttribute('aria-expanded', String(ouvre));
            });
        }
    }

    // ===== Cash et Stock =====

    // ================= Simulation =================
    //
    // Deux appels, jamais un seul: /simulation rend les VOLUMES vendus, /pl rend
    // le RESULTAT. Recalculer le resultat ici en aurait fait une seconde source,
    // et deux sources finissent toujours par diverger.
    let simDernieresDonnees = null;
    // Produits DECOCHES de la hausse simulee. On memorise les exclus plutot que
    // les inclus: un produit ajoute plus tard a la liste suivie sera coche par
    // defaut, ce qui est le comportement attendu. innerHTML detruit les cases a
    // chaque rendu, cet etat doit donc vivre en dehors du DOM.
    const simProduitsExclus = new Set();

    let simChargePour = null;

    async function loadSimulation(force) {
        const resultEl = document.getElementById('fin-sim-result');
        if (!resultEl) return;

        // La periode par DEFAUT est celle du PL - les deux onglets parlent du
        // meme resultat - mais elle reste modifiable.
        //
        // L'ORDRE compte. ensureDefaultDates remplit desormais aussi les deux
        // champs de la simulation (1er du mois -> aujourd'hui): l'appeler AVANT
        // rendait la reprise de la periode du PL inatteignable, puisque le garde
        // `!value` ne trouvait plus de champ vide. Le code etait mort, et mon
        // test a l'ecran ne l'a pas vu parce que les deux chemins donnaient la
        // meme date ce jour-la. Avec un PL cale sur juillet, la simulation
        // serait partie sur aout.
        //
        // On herite donc d'abord du PL, puis ensureDefaultDates ne comble que
        // ce qui reste vide. Une saisie de l'utilisateur, elle, n'est jamais
        // ecrasee: les deux etapes testent `!value`.
        const debutEl = document.getElementById('fin-sim-date-debut');
        const finEl = document.getElementById('fin-sim-date-fin');
        const plDebut = document.getElementById('fin-pl-date-debut');
        const plFin = document.getElementById('fin-pl-date-fin');
        if (debutEl && !debutEl.value && plDebut && plDebut.value) debutEl.value = plDebut.value;
        if (finEl && !finEl.value && plFin && plFin.value) finEl.value = plFin.value;
        ensureDefaultDates();

        // Meme garde de periode que loadPl: revenir sur l'onglet sans changer
        // les dates ne relance pas les deux calculs serveur.
        const clePeriode = (debutEl ? debutEl.value : '') + '|' + (finEl ? finEl.value : '');
        if (!force && simChargePour === clePeriode && simDernieresDonnees) return;
        resultEl.innerHTML = '<div class="text-muted"><i class="bi bi-hourglass-split"></i> Calcul en cours...</div>';
        try {
            const qs = new URLSearchParams();
            if (debutEl && debutEl.value) qs.set('dateDebut', debutEl.value);
            if (finEl && finEl.value) qs.set('dateFin', finEl.value);

            const [resSim, resPl] = await Promise.all([
                fetch('/api/finance/simulation?' + qs.toString(), { credentials: 'include' }),
                fetch('/api/finance/pl?' + qs.toString(), { credentials: 'include' })
            ]);
            if (resSim.status === 403 || resPl.status === 403) {
                resultEl.innerHTML = '<div class="alert alert-warning">Accès réservé aux administrateurs et superviseurs.</div>';
                return;
            }
            const jsonSim = await resSim.json();
            const jsonPl = await resPl.json();
            if (!jsonSim.success || !jsonPl.success) {
                resultEl.innerHTML = `<div class="alert alert-danger">${esc(jsonSim.error || jsonPl.error || 'Erreur')}</div>`;
                return;
            }
            simDernieresDonnees = { sim: jsonSim.data, pl: jsonPl.data };
            renderSimulation(simDernieresDonnees);
            simChargePour = clePeriode;
        } catch (e) {
            resultEl.innerHTML = `<div class="alert alert-danger">Erreur: ${esc(e.message)}</div>`;
        }
    }

    function renderSimulation({ sim, pl }) {
        const resultEl = document.getElementById('fin-sim-result');
        if (!resultEl) return;

        const plActuel = Number(pl.pl) || 0;
        const bumpEl = document.getElementById('fin-sim-bump');
        const bump = Math.max(0, Number(bumpEl && bumpEl.value) || 0);
        const produits = sim.produits || [];

        // --- Sensibilites a 100 F. Quantites inchangees, donc l'effet sur le
        // chiffre d'affaires vaut 100 x quantite vendue.
        const totalVentes = Number(pl.total_ventes) || 0;
        const lignes = produits.map((p) => {
            const cfa100 = 100 * p.quantite;
            // Un produit decoche ne subit pas la hausse: son effet est nul et
            // son resultat reste celui d'aujourd'hui. CFA 100 reste affiche -
            // c'est une caracteristique du produit, pas un choix de simulation.
            const retenu = !simProduitsExclus.has(p.nom);
            const effetBump = retenu ? bump * p.quantite : 0;
            // Poids du produit dans le chiffre d'affaires de la periode. C'est
            // ce qui dit si une sensibilite pese vraiment: 71 580 F sur le
            // boeuf en detail n'a pas le meme sens selon qu'il fait 5% ou 66%
            // des ventes.
            const partVentes = totalVentes > 0 ? (p.ca / totalVentes) * 100 : null;
            return { ...p, retenu, cfa100, effetBump, partVentes, plApres: plActuel + effetBump };
        });

        // Deux perimetres dans le meme total, a dessein: ca et cfa100 cumulent
        // TOUS les produits (des caracteristiques de la periode, pas des choix
        // de simulation), tandis qu'effetBump - et donc le PL apres - ne
        // cumule que les produits COCHES: c'est ce qui repond a "et si je
        // n'augmentais que le boeuf ?".
        const totaux = lignes.reduce((acc, l) => ({
            ca: acc.ca + l.ca,
            cfa100: acc.cfa100 + l.cfa100,
            effetBump: acc.effetBump + l.effetBump
        }), { ca: 0, cfa100: 0, effetBump: 0 });
        const nbRetenus = lignes.filter((l) => l.retenu).length;
        const partTotale = totalVentes > 0 ? (totaux.ca / totalVentes) * 100 : null;
        const fmtPct = (v) => (v === null ? '—' : v.toFixed(1) + ' %');
        // Les quantites ne sont pas des montants, mais elles restent des
        // nombres francais: 715,8 et non 715.8, comme partout ailleurs.
        const fmtQte = (v) => Number(v || 0).toLocaleString('fr-FR');

        // Le numerateur des pourcentages vient de /simulation, le denominateur
        // du PL. Ils se rapportent au meme perimetre aujourd'hui - verifie au
        // franc pres - mais rien ne le garantit demain. Si l'ecart apparait,
        // l'ecran le dit plutot que d'afficher des parts qui ne somment plus.
        const totalSim = Number(sim.total_ventes_toutes_lignes);
        const ecartPerimetre = Number.isFinite(totalSim) ? Math.abs(totalSim - totalVentes) : 0;
        const alertePerimetre = ecartPerimetre > 1
            ? `<div class="alert alert-warning py-2 small mb-3">
                 <i class="bi bi-exclamation-triangle"></i>
                 Les pourcentages rapportent des ventes par produit
                 (${esc(fmtMoney(totalSim))}) au total du PL
                 (${esc(fmtMoney(totalVentes))}). Ces deux totaux diffèrent de
                 ${esc(fmtMoney(ecartPerimetre))} : les parts ci-dessous ne
                 somment pas à 100 % et sont à lire avec prudence.
               </div>`
            : '';

        const signe = (v) => (v > 0 ? '+' : (v < 0 ? '−' : ''));
        const montantSigne = (v) => `${signe(v)}${fmtMoney(Math.abs(v))}`;

        const lignesHtml = lignes.map((l) => {
            // Sans vente, la sensibilite vaut zero et le resultat ne bouge pas.
            // La colonne "PL apres" doit donc porter le PL INCHANGE, et non la
            // note: une colonne de montants qui contient parfois du texte ne se
            // lit plus en diagonale.
            // La case reste presente sur toutes les lignes, meme celles sans
            // vente: une colonne dont les cases apparaissent et disparaissent
            // se lit mal, et cocher un produit sans vente est simplement sans
            // effet - ce que le zero affiche dit deja.
            const caseHtml = `<td class="text-center">
                <input type="checkbox" class="form-check-input" data-sim-produit="${esc(l.nom)}"
                       ${l.retenu ? 'checked' : ''} aria-label="Appliquer la hausse à ${esc(l.nom)}">
            </td>`;

            if (l.sans_vente) {
                return `<tr class="text-muted">
                    ${caseHtml}
                    <td>${esc(l.nom)}
                        <span class="small">— aucune vente sur la période</span></td>
                    <td class="text-end">0</td>
                    <td class="text-end">—</td>
                    <td class="text-end">${esc(fmtMoney(0))}</td>
                    <td class="text-end">${esc(fmtPct(0))}</td>
                    <td class="text-end">${esc(fmtMoney(0))}</td>
                    <td class="text-end">${esc(fmtMoney(0))}</td>
                    <td class="text-end">${esc(montantSigne(plActuel))}</td>
                </tr>`;
            }
            // Un produit decoche s'estompe: on voit d'un coup d'oeil ce que
            // porte la simulation en cours.
            return `<tr${l.retenu ? '' : ' class="text-muted"'}>
                ${caseHtml}
                <td>${esc(l.nom)}${l.graphies.length > 1
                    ? ` <i class="bi bi-info-circle text-muted" style="font-size:.8rem"
                         title="${esc(l.graphies.join(' + '))}"></i>` : ''}</td>
                <td class="text-end">${esc(fmtQte(l.quantite))}</td>
                <td class="text-end">${esc(fmtMoney(l.prix_moyen))}</td>
                <td class="text-end">${esc(fmtMoney(l.ca))}</td>
                <td class="text-end fw-medium">${esc(fmtPct(l.partVentes))}</td>
                <td class="text-end fw-medium text-success">${esc(fmtMoney(l.cfa100))}</td>
                <td class="text-end fw-medium ${l.retenu ? 'text-success' : ''}">${esc(fmtMoney(l.effetBump))}</td>
                <td class="text-end fw-medium ${l.plApres >= 0 ? 'text-success' : 'text-danger'}">${
                    esc(montantSigne(l.plApres))}</td>
            </tr>`;
        }).join('');

        // --- Prix d'equilibre, sur un seul produit.
        const cible = lignes.find((l) => l.nom === sim.produit_equilibre);
        let equilibreHtml;
        if (!cible || cible.sans_vente) {
            equilibreHtml = `<div class="alert alert-secondary py-2 small mb-0">
                Pas de vente de <strong>${esc(sim.produit_equilibre)}</strong> sur la période :
                aucun prix ne peut ramener le résultat à zéro par ce seul levier.</div>`;
        } else {
            // PL + hausse x quantite = 0  =>  hausse = -PL / quantite
            const hausse = -plActuel / cible.quantite;
            const prixEq = cible.prix_moyen + hausse;
            const pct = cible.prix_moyen > 0 ? (hausse / cible.prix_moyen) * 100 : null;
            const enBaisse = hausse < 0;

            // --- Le levier VOLUME, a cote du levier prix.
            //
            // Vendre un kilo de plus rapporte le prix de vente MAIS coute le
            // prix d'achat: seule la MARGE tombe dans le resultat. Rapporter le
            // PL au prix de vente - ce que je faisais d'abord - divisait le
            // volume necessaire par cinq: 4 715 F de prix moyen contre 880 F de
            // marge reelle sur le boeuf en juillet.
            const marge = cible.marge_unitaire;
            // Une seule matrice de signes pour tous les messages volume:
            //   marge > 0 et PL < 0  -> vendre PLUS rapproche de zero
            //   marge > 0 et PL > 0  -> vendre MOINS ramene a zero
            //   marge < 0            -> chaque unite vendue fait BAISSER le resultat
            //   marge = 0            -> le volume ne change rien
            //   PL = 0               -> rien a compenser
            let volumeHtml;
            if (marge === null || marge === undefined) {
                volumeHtml = `<div class="small text-muted mt-2">
                    Volume d'équilibre non calculable : aucun prix d'achat renseigné
                    pour ${esc(cible.nom)}, donc pas de marge connue.</div>`;
            } else if (marge === 0) {
                volumeHtml = `<div class="small text-muted mt-2">
                    Marge unitaire nulle : vendre plus ou moins ne change pas le résultat.</div>`;
            } else if (marge < 0) {
                volumeHtml = `<div class="small text-warning mt-2">
                    <i class="bi bi-exclamation-triangle"></i>
                    Marge unitaire ${esc(fmtMoney(marge))} : chaque unité vendue fait
                    <strong>baisser</strong> le résultat${plActuel < 0
                        ? ' — vendre davantage creuse la perte'
                        : (plActuel > 0 ? ' — vendre davantage entame le bénéfice' : '')}.</div>`;
            } else if (plActuel === 0) {
                volumeHtml = `<div class="small text-muted mt-2">
                    Résultat déjà à zéro : rien à compenser par le volume.</div>`;
            } else {
                const kg = -plActuel / marge;
                volumeHtml = enBaisse
                    ? `<div class="small text-muted mt-2">
                         Le résultat est positif : à marge constante, il faudrait vendre
                         <strong>${esc(fmtQte(Math.round(Math.abs(kg) * 10) / 10))}</strong>
                         de moins pour le ramener à zéro.</div>`
                    : `<div class="small text-muted mt-2">
                         Autre levier, à prix inchangé : vendre
                         <strong>${esc(fmtQte(Math.round(kg * 10) / 10))}</strong> de plus,
                         à ${esc(fmtMoney(marge))} de marge l'unité.</div>`;
            }

            equilibreHtml = `
                <div class="row g-2">
                    <div class="col-md-4">
                        <div class="card border-${enBaisse ? 'success' : 'danger'} h-100">
                            <div class="card-body text-center">
                                <h6 class="card-subtitle mb-2 text-muted">Prix d'équilibre</h6>
                                <h2 class="text-${enBaisse ? 'success' : 'danger'} mb-0">${esc(fmtMoney(prixEq))}</h2>
                                <div class="small text-muted mt-2">par unité de ${esc(cible.nom)}</div>
                                ${(marge !== null && marge !== undefined && marge > 0 && plActuel !== 0)
                                    ? `<hr class="my-2">
                                       <h6 class="card-subtitle mb-2 text-muted">ou vendre en ${enBaisse ? 'moins' : 'plus'}</h6>
                                       <h2 class="text-${enBaisse ? 'success' : 'danger'} mb-0">${
                                           esc(fmtQte(Math.round(Math.abs(-plActuel / marge) * 10) / 10))}</h2>
                                       <div class="small text-muted mt-2">à prix inchangé</div>`
                                    : ''}
                            </div>
                        </div>
                    </div>
                    <div class="col-md-8">
                        <div class="table-responsive">
                            <table class="table table-sm mb-0">
                                <tbody>
                                    <tr><td>Résultat actuel sur la période</td>
                                        <td class="text-end fw-medium ${plActuel >= 0 ? 'text-success' : 'text-danger'}">${
                                            esc(montantSigne(plActuel))}</td></tr>
                                    <tr><td>Quantité vendue</td>
                                        <td class="text-end">${esc(fmtQte(cible.quantite))}</td></tr>
                                    <tr><td>Prix moyen constaté</td>
                                        <td class="text-end">${esc(fmtMoney(cible.prix_moyen))}</td></tr>
                                    <tr><td>Prix d'achat</td>
                                        <td class="text-end">${cible.prix_achat === null || cible.prix_achat === undefined
                                            ? '—' : esc(fmtMoney(cible.prix_achat))}</td></tr>
                                    <tr><td>Marge unitaire</td>
                                        <td class="text-end">${marge === null || marge === undefined
                                            ? '—' : esc(fmtMoney(marge))}</td></tr>
                                    <tr class="table-light fw-bold">
                                        <td>${enBaisse ? 'Baisse possible' : 'Hausse nécessaire'} par unité</td>
                                        <td class="text-end">${esc(montantSigne(hausse))}</td></tr>
                                </tbody>
                            </table>
                            <div class="small text-muted mt-1">
                                ${plActuel === 0
                                    ? `Le résultat est <strong>déjà à zéro</strong> : aucun ajustement nécessaire.`
                                    : (enBaisse
                                        ? `Le résultat est <strong>positif</strong> : c'est la marge de baisse
                                           avant de passer sous zéro.`
                                        : `Le résultat est <strong>négatif</strong> : c'est la hausse qu'il faudrait
                                           appliquer pour l'annuler.`)}
                                ${pct !== null && plActuel !== 0 ? ` Soit ${esc(Math.abs(pct).toFixed(1))} % du prix actuel.` : ''}
                            </div>
                            ${volumeHtml}
                        </div>
                    </div>
                </div>`;
        }

        resultEl.innerHTML = `
            ${alertePerimetre}
            <h6 class="fin-subheading">Sensibilité au prix de vente</h6>
            <div class="table-responsive mb-3">
                <table class="table table-sm mb-0">
                    <thead>
                        <tr>
                            <th class="text-center" style="width:2.5rem">
                                <input type="checkbox" class="form-check-input" id="fin-sim-tout"
                                       ${lignes.length > 0 && nbRetenus === lignes.length ? 'checked' : ''}
                                       aria-label="Tout cocher ou tout décocher">
                            </th>
                            <th>Produit</th>
                            <th class="text-end">Quantité</th>
                            <th class="text-end">Prix moyen</th>
                            <th class="text-end">Ventes</th>
                            <th class="text-end">% des ventes</th>
                            <th class="text-end">CFA 100</th>
                            <th class="text-end">Effet ${esc(signe(bump))}${esc(fmtMoney(bump))}</th>
                            <th class="text-end">PL après</th>
                        </tr>
                    </thead>
                    <tbody>${lignesHtml}</tbody>
                    <tfoot>
                        <tr>
                            <th colspan="2" style="background:#f8fafc">Total des produits suivis${
                                nbRetenus < lignes.length
                                    ? ` <span class="small fw-normal text-muted">— hausse appliquée à ${nbRetenus} sur ${lignes.length}</span>`
                                    : ''}</th>
                            <th colspan="2" style="background:#f8fafc"></th>
                            <th class="text-end" style="background:#f8fafc">${esc(fmtMoney(totaux.ca))}</th>
                            <th class="text-end" style="background:#f8fafc">${esc(fmtPct(partTotale))}</th>
                            <th class="text-end text-success" style="background:#f8fafc">${esc(fmtMoney(totaux.cfa100))}</th>
                            <th class="text-end text-success" style="background:#f8fafc">${esc(fmtMoney(totaux.effetBump))}</th>
                            <th class="text-end ${(plActuel + totaux.effetBump) >= 0 ? 'text-success' : 'text-danger'}"
                                style="background:#f8fafc">${esc(montantSigne(plActuel + totaux.effetBump))}</th>
                        </tr>
                        <tr>
                            <th colspan="2" style="background:#f8fafc">Résultat actuel</th>
                            <th colspan="6" style="background:#f8fafc"></th>
                            <th class="text-end ${plActuel >= 0 ? 'text-success' : 'text-danger'}"
                                style="background:#f8fafc">${esc(montantSigne(plActuel))}</th>
                        </tr>
                    </tfoot>
                </table>
                <div class="small text-muted mt-1">
                    <strong>CFA 100</strong> : ce que rapporterait 100 FCFA de plus sur le prix unitaire,
                    à quantités inchangées. Un franc de chiffre d'affaires fait un franc de résultat —
                    aucun poste du PL n'est proportionnel aux ventes.
                    Les packs ne sont pas touchés : ils se vendent à leur propre prix.
                    <br>
                    Sur chaque ligne, <strong>PL après</strong> suppose que ce produit
                    <em>seul</em> augmente. La ligne de total suppose au contraire que
                    tous les produits <em>cochés</em> augmentent en même temps —
                    ses colonnes Ventes et CFA 100 restent, elles, la somme de
                    tous les produits suivis.
                </div>
            </div>

            <h6 class="fin-subheading">Prix d'équilibre — ${esc(sim.produit_equilibre)}</h6>
            ${equilibreHtml}

            <div class="small text-muted mt-3">
                Période du ${esc(sim.periode.dateDebut)} au ${esc(sim.periode.dateFin)}.
                Chiffre d'affaires total : ${esc(fmtMoney(Number(pl.total_ventes) || 0))}.
            </div>`;
    }

    let cashStockChargePour = null;

    async function loadCashStock(force) {
        const resultEl = document.getElementById('fin-cashstock-result');
        if (!resultEl) return;
        // Pre-remplir la date avec today si vide.
        const dateEl = document.getElementById('fin-cashstock-date');
        if (dateEl && !dateEl.value) {
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            dateEl.value = `${yyyy}-${mm}-${dd}`;
        }
        // Meme garde de date que loadPl: revenir sur l'onglet sans changer la
        // date ne relance pas le calcul.
        const cleDate = dateEl ? dateEl.value : '';
        if (!force && cashStockChargePour === cleDate) return;
        resultEl.innerHTML = '<div class="text-muted"><i class="bi bi-hourglass-split"></i> Calcul en cours...</div>';
        try {
            const date = dateEl ? dateEl.value : '';
            const qs = new URLSearchParams();
            if (date) qs.set('date', date);
            const res = await fetch('/api/finance/cash-stock?' + qs.toString(), { credentials: 'include' });
            const json = await res.json();
            if (res.status === 403) {
                resultEl.innerHTML = '<div class="alert alert-warning">Accès réservé aux administrateurs et superviseurs.</div>';
                return;
            }
            if (!json.success) {
                // Une journee pas encore arrivee n'est pas une faute de
                // l'utilisateur: on le dit calmement, sans alerte rouge.
                if (json.code === 'date_futur') {
                    resultEl.innerHTML = '<div class="alert alert-secondary mb-0">'
                        + '<i class="bi bi-calendar-x"></i> Pas encore de données pour cette date.</div>';
                    return;
                }
                throw new Error(json.error || 'Erreur');
            }
            renderCashStock(json.data);
            cashStockChargePour = cleDate;
        } catch (e) {
            resultEl.innerHTML = `<div class="alert alert-danger">Erreur: ${esc(e.message)}</div>`;
        }
    }


    // LA CARTE DU CASH THEORIQUE, isolee pour pouvoir etre re-rendue SEULE.
    //
    // Approuver un depot rechargeait tout l'ecran Cash et Stock: le stock,
    // le cash par point de vente, la note du mois, tout. Long, et on
    // perdait la position de defilement et le rapprochement deplie. Le
    // serveur reste la source du calcul - on refait l'appel - mais on ne
    // remplace que ce qui a change.
    function htmlCashTheorique(ct) {
        const rap = ct ? (ct.rapprochement || {}) : {};
        // Le total des lignes ENCORE actives. Sans neutralisation il vaut
        // exactement ct.total - identite verifiee par les tests du module.
        const ctTotalAffiche = !ct ? 0 : (ctLignesNeutralisees.size
            ? Math.round((ct.lignes || [])
                .filter((l) => !ctLignesNeutralisees.has(l.cle))
                .reduce((t, l) => t + l.signe * nb(l.montant), 0) * 100) / 100
            : nb(ct.total));
        return !ct ? '' : `
            <div class="card mt-3" id="ct-carte">
                <div class="card-header bg-light d-flex align-items-center justify-content-between">
                    <strong>Cash théorique du mois</strong>
                    <span class="small text-muted">${esc(String((ct.periode || {}).debut || ''))}
                        → ${esc(String((ct.periode || {}).fin || ''))}</span>
                </div>
                <div class="card-body">
                    ${ct.source_partenaire === 'indisponible'
                      ? `<div class="alert alert-danger py-2 px-2 small">La source du partenaire n'a pas
                          répondu : les remboursements comptent pour 0 et ce total est faux de tout ce
                          qui a été remboursé sur le mois. Ne pas s'y fier.</div>`
                      : ''}
                    ${ct.depart_manquant
                      ? `<div class="alert alert-warning py-2 px-2 small">Aucune clôture de caisse avant
                          le 1er du mois : le point de départ compte pour 0, et ce total ne vaut donc
                          que comme variation depuis le début du mois.</div>`
                      : ''}
                    ${nb(ct.depart_nb_pv_attendus) > 0 && nb(ct.depart_nb_pv) < nb(ct.depart_nb_pv_attendus)
                      ? `<div class="alert alert-warning py-2 px-2 small">Seuls ${esc(String(ct.depart_nb_pv))}
                          des ${esc(String(ct.depart_nb_pv_attendus))} points de vente avaient clôturé le
                          ${esc(String(ct.lignes && ct.lignes[0] ? String(ct.lignes[0].libelle).replace('Caisse au ', '') : '?'))} :
                          le point de départ ne porte que leur caisse, et le total est d'autant trop bas.</div>`
                      : ''}
                    ${ct.total === null || ct.total === undefined ? '' : `
                    <div class="small text-muted mb-1">
                      Cliquez une ligne pour la retirer et voir son effet.
                      ${ctLignesNeutralisees.size
                        ? `<button class="btn btn-sm btn-link p-0 align-baseline" id="ct-reactiver">
                             tout réactiver (${esc(String(ctLignesNeutralisees.size))})</button>`
                        : ''}
                    </div>
                    <table class="table table-sm mb-2" id="ct-decomposition"><tbody>
                        ${(ct.lignes || []).map((l) => {
                          const off = ctLignesNeutralisees.has(l.cle);
                          return `<tr data-ct-poste="${esc(l.cle)}" style="cursor:pointer${
                            off ? ';opacity:.45;text-decoration:line-through' : ''}"
                            title="Cliquer pour ${off ? 'remettre' : 'retirer'} cette ligne">
                          <td>${l.signe > 0 ? '' : '− '}${esc(l.libelle)}</td>
                          <td class="text-end ${off ? 'text-muted' : (l.signe > 0 ? 'text-success' : 'text-danger')}">${
                            l.signe > 0 ? '+ ' : '− '}${esc(fmtMoney(Math.abs(nb(l.montant))))}</td>
                        </tr>`; }).join('')}
                        <tr style="background:#e7f5ff;border-top:2px solid #339af0">
                          <th>= Cash théorique${ctLignesNeutralisees.size
                            ? ' <span class="badge bg-secondary">simulé</span>' : ''}</th>
                          <th class="text-end text-${nb(ctTotalAffiche) >= 0 ? 'success' : 'danger'}">${
                            esc(fmtMoney(ctTotalAffiche))}</th></tr>
                    </tbody></table>`}
                    <div class="text-muted small">${esc(ct.commentaire || '')}</div>
                    ${ct.total === null || ct.total === undefined ? '' : `
                    <div class="border-top mt-2 pt-2">
                      <div class="d-flex align-items-center justify-content-between mb-1">
                        <strong class="small">Autres</strong>
                        <span class="small text-muted">ce que le modèle ne sait pas nommer</span>
                      </div>
                      ${(ct.autres || []).length ? `<table class="table table-sm mb-1"><tbody>
                        ${(ct.autres || []).map((x) => `<tr>
                          <td class="small">${esc(x.commentaire)}</td>
                          <td class="text-end small text-${nb(x.montant) >= 0 ? 'success' : 'danger'}">${
                            nb(x.montant) >= 0 ? '+ ' : '− '}${esc(fmtMoney(Math.abs(nb(x.montant))))}</td>
                          <td class="text-end" style="width:1%">
                            <button class="btn btn-sm btn-outline-danger py-0 ct-autre-suppr"
                              data-id="${esc(String(x.id))}" title="Supprimer cette ligne">×</button></td>
                        </tr>`).join('')}
                      </tbody></table>` : '<div class="text-muted small mb-1">Aucune ligne.</div>'}
                      <div class="row g-1 align-items-center">
                        <div class="col-auto">
                          <input type="number" step="1" class="form-control form-control-sm"
                            id="ct-autre-montant" placeholder="Montant" style="width:130px">
                        </div>
                        <div class="col">
                          <input type="text" class="form-control form-control-sm"
                            id="ct-autre-commentaire" placeholder="Commentaire (obligatoire)">
                        </div>
                        <div class="col-auto">
                          <button class="btn btn-sm btn-outline-primary" id="ct-autre-ajouter">Ajouter</button>
                        </div>
                      </div>
                      <div class="text-muted small mt-1">Montant <strong>signé</strong> : positif pour
                        une entrée de caisse, négatif pour une sortie. Le commentaire est obligatoire —
                        un montant libre sans explication ne se relit pas au bout d'un mois.</div>
                      <div class="small mt-1" id="ct-autre-etat"></div>
                    </div>`}
                    ${nb((ct.creances || {}).montant) > 0
                      ? `<div class="alert alert-warning py-2 px-2 small mt-2 mb-0">
                          ${esc(String((ct.creances || {}).nb))} vente(s) à crédit sur le mois, pour
                          ${esc(fmtMoney((ct.creances || {}).montant))} : elles ne sont PAS dans les
                          ventes ci-dessus, puisqu'aucun billet n'est entré en caisse. Elles
                          entreront le jour où elles seront encaissées.</div>`
                      : '<div class="text-muted small mt-1">Aucune vente à crédit sur le mois.</div>'}
                    ${(rap.appariements || []).length ? `<details class="mt-2">
                      <summary class="text-primary small" style="cursor:pointer">
                        Le rapprochement dépôt Mata / remboursement
                        (${esc(String(rap.nb_apparies))} sur
                         ${esc(String((rap.appariements || []).length))} retrouvés)</summary>
                      <div class="table-responsive mt-2">
                       <table class="table table-sm mb-1"><thead><tr>
                         <th>Dépôt</th><th class="text-end">Montant</th>
                         <th>Remboursement</th><th></th></tr></thead><tbody>
                         ${(rap.appariements || []).map((x) => `<tr>
                           <td>${esc(x.date)}</td>
                           <td class="text-end">${esc(fmtMoney(x.montant))}</td>
                           <td class="${x.apparie ? 'text-success' : 'text-danger'}">${
                             x.apparie
                               ? esc(x.date_remboursement) + (x.decalage === 0 ? ' (le jour même)'
                                   : x.decalage > 0 ? ' (J+' + esc(String(x.decalage)) + ')'
                                   : ' (J' + esc(String(x.decalage)) + ')')
                                 + (x.ambigu ? ' <span class="text-warning-emphasis">· plusieurs candidats</span>' : '')
                               : x.approuve
                                 ? '<span class="text-success">approuvé à la main</span>'
                                 : (x.dispute
                                   ? 'non retrouvé <span class="text-warning-emphasis">· un versement du même montant a été pris par un autre dépôt</span>'
                                   : 'non retrouvé')}</td>
                         <td class="text-end">${x.apparie ? '' : (x.approuve
                            ? `<button class="btn btn-sm btn-outline-secondary py-0 ct-desapprouver"
                                 data-date="${esc(x.date)}" data-montant="${esc(String(x.montant))}"
                                 title="Retirer l'approbation : le montant redeviendra soustrait.">annuler</button>`
                            : `<button class="btn btn-sm btn-outline-success py-0 ct-approuver"
                                 data-date="${esc(x.date)}" data-montant="${esc(String(x.montant))}"
                                 title="Vous constatez que ce versement est bien arrivé : le montant sort du total soustrait.">approuver</button>`)}</td>
                       </tr>`).join('')}
                       </tbody></table></div>
                      <div class="text-muted small">Règle : même montant exact, à ±${
                        esc(String(rap.tolerance_jours))} jour. Mesuré sur août 2026 à Mbao,
                        les dépôts retrouvés le sont tous au lendemain, jamais le jour même.
                        ${nb(rap.nb_remboursements_sans_depot) > 0
                          ? esc(String(rap.nb_remboursements_sans_depot)) + ' remboursement(s) n\u2019ont'
                            + ' aucun dépôt en face : tout ne passe pas par la caisse (virement,'
                            + ' versement direct).'
                          : ''}
                        ${nb(rap.nb_ambigus) + nb(rap.nb_disputes) > 0
                          ? ' Les montants ronds se répètent : quand plusieurs versements du même'
                            + ' montant tombent dans la fenêtre, le rapprochement ligne à ligne est'
                            + ' indicatif, pas certain.'
                          : ''}</div>
                     </details>` : ''}
                </div>
            </div>`;
    }
    function renderCashStock(d) {
        const resultEl = document.getElementById('fin-cashstock-result');
        if (!resultEl) return;
        const stock = d.stock || {};
        const cash = d.cash || {};
        const solde = d.solde_du_fournisseur || 0;
        const depotMata = d.depot_mata || 0;
        const valeur = d.valeur || 0;
        const valColor = valeur >= 0 ? 'success' : 'danger';

        // Journee entierement vierge: aucune cloture ET aucun snapshot de stock
        // a reprendre. Afficher "0 FCFA" laisserait croire a une valeur mesuree
        // nulle, alors que rien n'a encore ete saisi.
        // d.aucune_donnee: journee posterieure a la date du serveur, tombee
        // dans la tolerance de fuseau, et sans aucune cloture. Le total renvoye
        // reprend le dernier snapshot de stock: il ne mesure rien.
        const aucuneCloture = !(cash.par_pv && cash.par_pv.length);
        const aucunStock = !stock.soir_date_utilisee;
        // Le solde fournisseur compte aussi: il vient des ventes du mois, pas
        // du stock ni des clotures. Sans lui dans la condition, une periode
        // avec des ventes mais aucun stock saisi affichait "pas encore de
        // donnees" en masquant une dette bien reelle.
        const aucunSolde = !solde;
        if (d.aucune_donnee || (aucuneCloture && aucunStock && aucunSolde)) {
            resultEl.innerHTML = '<div class="alert alert-secondary mb-0">'
                + `<i class="bi bi-calendar-x"></i> Pas encore de données pour le ${esc(d.date)} : `
                + 'ni clôture de caisse, ni stock du soir saisi.</div>';
            return;
        }

        // Periode du solde fournisseur: le mois en cours, du 1er a la date
        // demandee. Renvoyee par l'API pour eviter de la recalculer ici.
        const sp = d.solde_periode;
        const periodeSolde = sp && sp.debut && sp.fin
            ? `du ${sp.debut.slice(8)} au ${sp.fin.slice(8)}/${sp.fin.slice(5, 7)}`
            : 'du mois en cours';

        // Comparaison sur une base COMMUNE: soir_date_utilisee vient de la
        // colonne stocks.date, donc en JJ-MM-AAAA, tandis que d.date est en
        // ISO. La comparaison directe etait donc TOUJOURS vraie et
        // l'avertissement s'affichait en permanence, y compris quand le stock
        // etait bien celui du jour demande - une alerte qui ne s'eteint jamais
        // ne dit plus rien.
        const isoDepuisJjmm = (brut) => {
            const m = String(brut || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
            return m ? `${m[3]}-${m[2]}-${m[1]}` : String(brut || '');
        };
        const soirDateIso = isoDepuisJjmm(stock.soir_date_utilisee);
        const stockSnapshotInfo = stock.soir_date_utilisee && soirDateIso !== d.date
            ? `<small class="text-warning"><i class="bi bi-exclamation-triangle"></i> Snapshot du ${esc(stock.soir_date_utilisee)} utilisé (pas de stock soir saisi le ${esc(d.date)})</small>`
            : '';

        // Produits valorises au prix de VENTE faute de prix d'achat: nommes
        // sous la decomposition. Un total qui melange deux bases sans le dire
        // n'est pas verifiable.
        const auPrixVente = stock.produits_au_prix_de_vente || [];
        const asterisque = auPrixVente.length ? ' <span class="text-warning fw-bold">*</span>' : '';
        const legendePrix = auPrixVente.length
            ? `<div class="mt-2"><small class="text-muted"><span class="text-warning fw-bold">*</span>
               Stock valorisé au <strong>prix d'achat fournisseur</strong>, sauf
               ${esc(auPrixVente.join(', '))} — sans prix d'achat renseigné, ces produits restent au prix de vente.</small></div>`
            : `<div class="mt-2"><small class="text-muted">Stock valorisé au <strong>prix d'achat fournisseur</strong>.</small></div>`;

        // Le coefficient ne porte que sur la viande, et les stocks negatifs sont
        // ecartes: les deux doivent se lire a l'ecran, sinon le "Stock soir net"
        // ne se retrouve pas a partir du brut.
        const ecartes = stock.produits_ecartes || [];
        const noteStockCS = `<div class="small text-muted mt-1">
            Coefficient appliqué à la <strong>boucherie</strong> seule
            (${esc(fmtMoney(stock.soir_boucherie || 0))}) ; hors boucherie à valeur pleine
            (${esc(fmtMoney(stock.soir_hors_boucherie || 0))}).
            ${ecartes.length
                ? `<br><span class="text-warning"><i class="bi bi-exclamation-triangle"></i>
                   ${ecartes.length} produit(s) écarté(s) faute de stock fiable :
                   ${esc(ecartes.slice(0, 6).join(', '))}${ecartes.length > 6 ? '…' : ''}.
                   Leur stock du soir est négatif, signe d'entrées non saisies — leurs
                   achats restent comptés dans les Dépenses.</span>`
                : ''}
        </div>`;

        // "—" veut dire NON RENSEIGNE, "0 FCFA" veut dire aucun depot. Le pied
        // du tableau se decidait sur la valeur (0 -> "—"), les lignes sur la
        // nullite: le meme ecran disait "on ne sait pas" et "zero" du meme
        // chiffre. Un tiret n'apparait donc que si AUCUNE cloture du jour ne
        // porte de depot.
        const depotRenseigne = (cash.par_pv || []).some((p) => p.depot_mata != null);

        // Le detail par point de vente porte aussi le depot: sans lui, un total
        // qui parait faux n'est pas diagnosticable.
        const pvRows = (cash.par_pv || []).map((p) => {
            const cls = p.renseigne ? '' : 'text-muted';
            const val = p.renseigne ? esc(fmtMoney(p.montant)) : '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> non renseigné</span>';
            const dep = p.depot_mata == null
                ? '<span class="text-muted">—</span>'
                : `<span class="text-danger">− ${esc(fmtMoney(p.depot_mata))}</span>`;
            return `<tr class="${cls}"><td>${esc(p.point_de_vente)}</td><td class="text-end">${val}</td><td class="text-end">${dep}</td></tr>`;
        }).join('');
        const pvTable = pvRows
            ? `<table class="table table-sm mb-0">
                <thead><tr><th>Point de vente</th><th class="text-end">Cash en caisse</th><th class="text-end">Dépôt Mata</th></tr></thead>
                <tbody>${pvRows}</tbody>
                <tfoot><tr style="background:#f8fafc"><th>Total</th><th class="text-end">${esc(fmtMoney(cash.total))}</th><th class="text-end text-danger">${depotRenseigne ? '− ' + esc(fmtMoney(depotMata)) : '—'}</th></tr></tfoot>
               </table>`
            : '<div class="text-muted small">Aucune clôture de caisse trouvée pour cette date.</div>';

        const warnPv = (cash.pv_sans_saisie && cash.pv_sans_saisie.length)
            ? `<div class="alert alert-warning py-2 small mb-3"><i class="bi bi-exclamation-triangle"></i>
               ${cash.pv_sans_saisie.length} point(s) de vente ont clôturé sans saisir "Montant total en caisse" :
               <strong>${esc(cash.pv_sans_saisie.join(', '))}</strong>. Ces lignes comptent 0 dans le total.</div>`
            : '';

        // LE STOCK, LIGNE A LIGNE. Replie par defaut: la question « d'ou
        // sortent ces 443 126 ? » ne se pose pas a chaque consultation, mais
        // quand elle se pose il faut pouvoir repondre sans ouvrir la base.
        //
        // Le total du tableau est le stock BRUT; le net s'en deduit par le
        // coefficient, applique aux seules lignes de boucherie. Les lignes
        // ecartees (stock negatif) sont montrees a part: elles ne sont dans
        // aucun des deux totaux, et les taire ferait croire a un oubli.
        // Formateur LOCAL: fmtQte est defini dans d'autres fonctions de ce
        // fichier, pas dans celle-ci.
        const fmtQteCS = (v) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
        const detail = (stock.detail_lignes || []);
        const negatives = (stock.lignes_negatives || []);
        const blocStockDetaille = detail.length ? `<details class="mt-2">
            <summary class="text-primary small" style="cursor:pointer">
              D'où sortent ces ${esc(fmtMoney(stock.soir_net))} ?
              (${esc(String(detail.length))} produit${detail.length > 1 ? 's' : ''} en stock${
                negatives.length ? `, ${esc(String(negatives.length))} écarté${negatives.length > 1 ? 's' : ''}` : ''})</summary>
            <div class="table-responsive mt-2">
             <table class="table table-sm mb-1"><thead><tr>
               <th>Produit</th>
               <th class="text-end">Quantité</th>
               <th class="text-end">Prix utilisé</th>
               <th>Base</th>
               <th class="text-end">Valeur</th></tr></thead><tbody>
               ${detail.map((l) => `<tr>
                 <td>${esc(l.produit)}
                   ${l.boucherie ? '' : '<span class="badge bg-light text-secondary ms-1">hors boucherie</span>'}</td>
                 <td class="text-end">${esc(fmtQteCS(l.quantite))}</td>
                 <td class="text-end">${l.prix_utilise === null || l.prix_utilise === undefined
                    ? '<span class="text-muted">—</span>' : esc(fmtMoney(l.prix_utilise))}</td>
                 <td class="small ${l.base === 'achat' ? 'text-muted' : 'text-warning-emphasis'}">${
                    l.base === 'achat' ? "prix d'achat" : 'prix de vente *'}</td>
                 <td class="text-end">${esc(fmtMoney(l.valeur))}</td></tr>`).join('')}
               <tr class="table-light fw-bold">
                 <td>Stock soir brut</td><td></td><td></td><td></td>
                 <td class="text-end">${esc(fmtMoney(stock.soir_brut))}</td></tr>
             </tbody></table></div>
            ${negatives.length ? `<div class="table-responsive">
             <table class="table table-sm mb-1"><thead><tr>
               <th>Écarté du calcul</th><th class="text-end">Quantité</th>
               <th class="text-end">Valeur saisie</th></tr></thead><tbody>
               ${negatives.map((l) => `<tr class="text-muted">
                 <td>${esc(l.produit)}</td>
                 <td class="text-end">${esc(fmtQteCS(l.quantite))}</td>
                 <td class="text-end">${esc(fmtMoney(l.total))}</td></tr>`).join('')}
             </tbody></table></div>
             <div class="text-muted small mb-2">Un stock négatif ne vaut pas moins que rien : il
               n'existe pas. Il apparaît quand les entrées d'un produit ne sont pas saisies et que
               le stock du soir se calcule en matin + transferts − ventes. Ces lignes ne sont
               dans aucun des deux totaux.</div>` : ''}
            <div class="text-muted small">
              ${esc(fmtMoney(stock.soir_boucherie))} de boucherie × ${esc(stock.coeff)}
              + ${esc(fmtMoney(stock.soir_hors_boucherie))} hors boucherie
              = <strong>${esc(fmtMoney(stock.soir_net))}</strong>.
              Le coefficient de pertes de découpe ne porte que sur la viande ; l'épicerie entre à
              sa valeur pleine.
            </div>
           </details>` : '';

        // LE CASH THEORIQUE DU MOIS, independant de la Valeur ci-dessus.
        //
        // La Valeur est un NIVEAU a une date, stock compris. Celui-ci suit un
        // FLUX: partir de la caisse a la fin du mois dernier et suivre tout ce
        // qui est entre et sorti. Les deux ne se comparent pas, et c'est
        // voulu - une caisse qui derive se voit ici, pas dans un niveau ou le
        // stock peut compenser.
        //
        // Tout le calcul vient du serveur (lib/cash-theorique.js, module pur
        // et teste): on ne fait ici que mettre en forme.
        const ct = d.cash_theorique || null;
        const blocCashTheorique = htmlCashTheorique(ct);

        resultEl.innerHTML = `
            <div class="card border-${valColor} mb-3">
                <div class="card-body text-center">
                    <div class="text-muted small mb-1">Valeur au ${esc(d.date)}</div>
                    <div class="display-5 text-${valColor} fw-bold">${esc(fmtMoney(valeur))}</div>
                </div>
            </div>

            <div class="card mb-3">
                <div class="card-header bg-light"><strong>Décomposition</strong></div>
                <div class="card-body">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <tr>
                                <td>Stock soir brut${asterisque}</td>
                                <td class="text-end">${esc(fmtMoney(stock.soir_brut))}</td>
                            </tr>
                            <tr>
                                <td class="ps-4 text-muted small">dont boucherie ${esc(fmtMoney(stock.soir_boucherie))}
                                    × ${esc(stock.coeff)} <span class="text-muted">(1 − ${esc(stock.pertes_decoupe_pct)}% pertes découpe)</span></td>
                                <td class="text-end text-muted small">${esc(fmtMoney(nb(stock.soir_boucherie) * nb(stock.coeff)))}</td>
                            </tr>
                            <tr>
                                <td class="ps-4 text-muted small">dont hors boucherie ${esc(fmtMoney(stock.soir_hors_boucherie))}
                                    <span class="text-muted">à valeur pleine</span></td>
                                <td class="text-end text-muted small">${esc(fmtMoney(stock.soir_hors_boucherie))}</td>
                            </tr>
                            <tr style="background:#f8fafc">
                                <td><strong>= Stock soir net</strong></td>
                                <td class="text-end"><strong>${esc(fmtMoney(stock.soir_net))}</strong></td>
                            </tr>
                            <tr>
                                <td>+ Cash total en caisse <span class="text-muted">(${cash.nb_pv_renseigne}/${cash.nb_pv_avec_cloture} PV renseignés)</span></td>
                                <td class="text-end text-success">+ ${esc(fmtMoney(cash.total))}</td>
                            </tr>
                            <tr>
                                <td>− Dépôt Mata <span class="text-muted">(versé à Mata, compté avant le dépôt)</span></td>
                                <td class="text-end text-danger">${depotRenseigne ? '− ' + esc(fmtMoney(depotMata)) : '<span class="text-muted">non renseigné</span>'}</td>
                            </tr>
                            <tr>
                                <td>− Solde dû fournisseur <span class="text-muted">(commission MaaS ${esc(periodeSolde)})</span></td>
                                <td class="text-end text-danger">− ${esc(fmtMoney(solde))}</td>
                            </tr>
                            <tr style="background:#e7f5ff;border-top:2px solid #339af0">
                                <th>= Valeur</th>
                                <th class="text-end text-${valColor}">${esc(fmtMoney(valeur))}</th>
                            </tr>
                        </tbody>
                    </table>
                    ${blocStockDetaille}
                    ${legendePrix}
                    ${noteStockCS}
                    ${stockSnapshotInfo ? `<div class="mt-2">${stockSnapshotInfo}</div>` : ''}
                </div>
            </div>

            ${warnPv}

            <div class="card">
                <div class="card-header bg-light"><strong>Détail cash par point de vente</strong></div>
                <div class="card-body">${pvTable}</div>
            </div>
            ${blocCashTheorique}
            ${blocNoteMois('cash_stock', String(d.date || '').slice(0, 7))}
        `;
        cablerNoteMois('cash_stock', String(d.date || '').slice(0, 7));
        cablerCashTheorique(d);
    }

    // LES ACTIONS DU CASH THEORIQUE: approuver un depot, gerer les « Autres ».
    //
    // Chaque action ecrit en base puis RELANCE le calcul complet, au lieu de
    // corriger le total dans le DOM. Le total depend de six lignes et d'un
    // rapprochement: le recalculer ici en ferait une seconde arithmetique,
    // qui divergerait de celle du serveur des la premiere subtilite.
    function cablerCashTheorique(d) {
        const ct = d.cash_theorique;
        if (!ct) return;
        // Recharger le calcul cote serveur, puis remplacer LA SEULE carte.
        // On garde le serveur comme source du chiffre - il refait le
        // rapprochement, que l'on ne veut pas rejouer ici - mais l'ecran ne
        // clignote plus et le rapprochement reste deplie.
        const recalculer = async () => {
            const carte = document.getElementById('ct-carte');
            if (carte) carte.style.opacity = '.5';
            try {
                const date = (document.getElementById('fin-cashstock-date') || {}).value
                    || (d && d.date) || '';
                const r = await fetch('/api/finance/cash-stock?date=' + encodeURIComponent(date),
                    { credentials: 'same-origin' });
                const j = await r.json();
                if (!j || !j.success || !j.data) throw new Error((j && j.error) || 'réponse invalide');
                const frais = j.data;
                const remplacante = document.createElement('div');
                remplacante.innerHTML = htmlCashTheorique(frais.cash_theorique);
                const neuve = remplacante.firstElementChild;
                if (carte && neuve) {
                    carte.replaceWith(neuve);
                    // Les ecouteurs sont morts avec l'ancien noeud: on les repose.
                    cablerCashTheorique(frais);
                } else if (carte) {
                    carte.style.opacity = '';
                }
            } catch (e) {
                if (carte) carte.style.opacity = '';
                alert('Rechargement impossible : ' + e.message);
            }
        };
        // Re-rendre la carte SANS appel serveur, pour les changements qui ne
        // concernent que l'affichage (neutralisation, annulation de saisie).
        const rendreCarte = (donnees) => {
            const carte = document.getElementById('ct-carte');
            const boite = document.createElement('div');
            boite.innerHTML = htmlCashTheorique(donnees.cash_theorique);
            const neuve = boite.firstElementChild;
            if (carte && neuve) { carte.replaceWith(neuve); cablerCashTheorique(donnees); }
        };

        const dire = (t, ok) => {
            const e = document.getElementById('ct-autre-etat');
            if (e) e.innerHTML = t ? `<span class="text-${ok ? 'success' : 'danger'}">${esc(t)}</span>` : '';
        };

        // NEUTRALISATION: un seul ecouteur pour tout le tableau, repose a
        // chaque rendu puisque innerHTML a detruit le precedent. Meme motif
        // que la decomposition du PL.
        const tableCt = document.getElementById('ct-decomposition');
        if (tableCt) {
            tableCt.addEventListener('click', (ev) => {
                const tr = ev.target.closest('tr[data-ct-poste]');
                const cle = tr && tr.getAttribute('data-ct-poste');
                if (!cle) return;
                if (ctLignesNeutralisees.has(cle)) ctLignesNeutralisees.delete(cle);
                else ctLignesNeutralisees.add(cle);
                // La neutralisation ne touche pas au serveur: on re-rend la
                // carte depuis les MEMES donnees, sans aucun appel.
                rendreCarte(d);
            });
        }
        const reactiver = document.getElementById('ct-reactiver');
        if (reactiver) reactiver.addEventListener('click', () => {
            ctLignesNeutralisees.clear();
            rendreCarte(d);
        });

        // SAISIE EN LIGNE, pas prompt().
        //
        // prompt() n'est utilise nulle part ailleurs dans ce depot, et
        // js/ui-helpers.js remplace deja window.alert par une modale maison:
        // la boite native ne s'ouvrait pas, et le bouton restait sans effet.
        // Un champ pose dans la cellule ne depend d'aucune boite de dialogue,
        // et se teste sans stub - ce que prompt() empechait justement.
        const envoyerApprobation = async (date, montant, commentaire, cellule) => {
            try {
                const r = await fetch('/api/finance/depots-approuves', {
                    method: 'PUT', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ date, montant, commentaire })
                });
                const j = await r.json();
                if (j && j.success) return recalculer();
                cellule.innerHTML = '<span class="text-danger small">'
                    + esc((j && j.error) || 'échec') + '</span>';
            } catch (e) {
                cellule.innerHTML = '<span class="text-danger small">' + esc(e.message) + '</span>';
            }
        };

        document.querySelectorAll('.ct-approuver').forEach((b) => {
            b.addEventListener('click', () => {
                const date = b.dataset.date;
                const montant = parseFloat(b.dataset.montant);
                const cellule = b.parentElement;
                cellule.innerHTML = `<div class="d-flex gap-1 justify-content-end">
                    <input type="text" class="form-control form-control-sm ct-motif"
                       placeholder="Pourquoi ? (ex. vu sur le relevé)" style="min-width:200px">
                    <button class="btn btn-sm btn-success py-0 ct-valider">valider</button>
                    <button class="btn btn-sm btn-outline-secondary py-0 ct-annuler-saisie">×</button>
                </div>`;
                const champ = cellule.querySelector('.ct-motif');
                champ.focus();
                const valider = () => envoyerApprobation(date, montant, champ.value.trim(), cellule);
                cellule.querySelector('.ct-valider').addEventListener('click', valider);
                champ.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') valider(); });
                cellule.querySelector('.ct-annuler-saisie').addEventListener('click', () => {
                    // Re-rendre la carte depuis les memes donnees remet le bouton.
                    rendreCarte(d);
                });
            });
        });

        document.querySelectorAll('.ct-desapprouver').forEach((b) => {
            b.addEventListener('click', async () => {
                b.disabled = true;
                try {
                    const q = '?date=' + encodeURIComponent(b.dataset.date)
                        + '&montant=' + encodeURIComponent(b.dataset.montant);
                    const r = await fetch('/api/finance/depots-approuves' + q,
                        { method: 'DELETE', credentials: 'same-origin' });
                    const j = await r.json();
                    // 404 : une autre session a deja supprime cette ligne. L'etat
                    // local est prouve perime, recalculer() le resynchronise au
                    // lieu de laisser une ligne fantome dans le total affiche.
                    if ((j && j.success) || r.status === 404) recalculer();
                    else { b.disabled = false; alert('Échec : ' + ((j && j.error) || 'inconnu')); }
                } catch (e) { b.disabled = false; alert('Échec : ' + e.message); }
            });
        });

        const ajouter = document.getElementById('ct-autre-ajouter');
        if (ajouter) ajouter.addEventListener('click', async () => {
            const m = parseFloat((document.getElementById('ct-autre-montant') || {}).value);
            const c = ((document.getElementById('ct-autre-commentaire') || {}).value || '').trim();
            if (!Number.isFinite(m) || m === 0) return dire('Montant non nul requis.', false);
            if (!c) return dire('Commentaire obligatoire.', false);
            ajouter.disabled = true; dire('enregistrement…', true);
            try {
                const r = await fetch('/api/finance/cash-autres', {
                    method: 'POST', credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mois: ct.mois, montant: m, commentaire: c })
                });
                const j = await r.json();
                if (j && j.success) recalculer();
                else { ajouter.disabled = false; dire((j && j.error) || 'échec', false); }
            } catch (e) { ajouter.disabled = false; dire(e.message, false); }
        });

        document.querySelectorAll('.ct-autre-suppr').forEach((b) => {
            b.addEventListener('click', async () => {
                b.disabled = true;
                try {
                    const r = await fetch('/api/finance/cash-autres/' + encodeURIComponent(b.dataset.id)
                        + '?mois=' + encodeURIComponent(ct.mois || ''),
                        { method: 'DELETE', credentials: 'same-origin' });
                    const j = await r.json();
                    // 404 : une autre session a deja supprime cette ligne. L'etat
                    // local est prouve perime, recalculer() le resynchronise au
                    // lieu de laisser une ligne fantome dans le total affiche.
                    if ((j && j.success) || r.status === 404) recalculer();
                    else { b.disabled = false; alert('Échec : ' + ((j && j.error) || 'inconnu')); }
                } catch (e) { b.disabled = false; alert('Échec : ' + e.message); }
            });
        });
    }

})();
