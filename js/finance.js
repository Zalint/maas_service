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
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
        const plRefresh = document.getElementById('fin-pl-refresh');
        if (plRefresh) plRefresh.addEventListener('click', loadPl);
        const cashStockRefresh = document.getElementById('fin-cashstock-refresh');
        if (cashStockRefresh) cashStockRefresh.addEventListener('click', loadCashStock);
        const simRefresh = document.getElementById('fin-sim-refresh');
        if (simRefresh) simRefresh.addEventListener('click', loadSimulation);
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
        const fmtDateFr = (iso) => {
            const m = typeof iso === 'string' && iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
            return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
        };
        const rows = src.map((d) => ({
            'Date': fmtDateFr(d.date),
            'Produit': d.produit,
            'Quantité éligible': d.quantite,
            'Prix achat fournisseur (FCFA)': d.prix_achat == null ? '' : d.prix_achat,
            'Qté × Prix achat': d.montant_achat == null ? '' : d.montant_achat,
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
        const fmtDateFr = (iso) => {
            if (!iso || typeof iso !== 'string') return iso;
            const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
            return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
        };
        const r2 = (n) => Math.round((n || 0) * 100) / 100;
        const tiret = '<span class="text-muted">—</span>';
        const detailDate = (data.detail_par_date || []).filter((d) => d.dette > 0);
        const grouped = !!(document.getElementById('fin-detail-date-group') || {}).checked;

        const productRow = (d, cls) => `
            <tr${cls ? ` class="${cls}" style="display:none"` : ''}>
                <td>${grouped ? '' : esc(fmtDateFr(d.date))}</td>
                <td${grouped ? ' class="ps-4"' : ''}>${esc(d.produit)}</td>
                <td class="text-end">${esc(d.quantite)}</td>
                <td class="text-end">${d.prix_achat == null ? tiret : esc(fmtMoney(d.prix_achat))}</td>
                <td class="text-end">${d.montant_achat == null ? tiret : esc(fmtMoney(d.montant_achat))}</td>
                <td class="text-end">${esc(fmtMoney(d.dette))}</td>
            </tr>`;

        if (!detailDate.length) {
            tbodyDate.innerHTML = '<tr><td colspan="6" class="text-muted text-center">Aucune livraison éligible sur la période</td></tr>';
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
                foot.style.display = '';
            } else {
                foot.style.display = 'none';
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
                    showPrixHistoryModal(cfg.label, produit, cfg.bodyField, j.data);
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            });
        });
    }

    // Modale historique générique pour les 3 types de prix.
    // labelPrix = libellé affiché (ex: "Prix vente CDC").
    // bodyField = nom du champ dans les rows (ex: "prix_vente_cdc").
    function showPrixHistoryModal(labelPrix, produit, bodyField, rows) {
        const title = document.getElementById('fin-cdc-details-title');
        const body = document.getElementById('fin-cdc-details-body');
        const modalEl = document.getElementById('fin-cdc-details-modal');
        if (!title || !body || !modalEl) return;
        title.innerHTML = `<i class="bi bi-clock-history me-2"></i>Historique ${esc(labelPrix)} — <strong>${esc(produit)}</strong>`;
        const list = Array.isArray(rows) ? rows : [];
        const rowsHtml = list.map((h) => {
            const when = h.created_at ? new Date(h.created_at).toLocaleString('fr-FR') : '—';
            const isSeed = h.changed_by === '_seed_';
            const whenLabel = isSeed ? 'Valeur initiale' : when;
            const whoLabel = isSeed ? '(seed migration)' : (h.changed_by || 'anonymous');
            return `
                <tr${isSeed ? ' class="text-muted"' : ''}>
                    <td class="text-nowrap">${esc(whenLabel)}</td>
                    <td class="text-end fw-medium">${esc(fmtMoney(h[bodyField]))}</td>
                    <td>${esc(whoLabel)}</td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="3" class="text-muted text-center py-3">Aucun changement enregistré.</td></tr>';
        body.innerHTML = `
            <div class="alert alert-light border small mb-3">
                <i class="bi bi-info-circle"></i> Chaque sauvegarde est historisée (point-in-time).
                La valeur la plus récente (en haut) s'applique aux futures ventes; les ventes passées
                conservent le prix effectif à leur date.
            </div>
            <div class="table-responsive">
                <table class="table table-sm mb-0">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th class="text-end">${esc(labelPrix)}</th>
                            <th>Modifié par</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
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
                <td>${esc(d.categorie || '')}</td>
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
                    showPrixHistoryModal(histLabel, produit, histField, j.data);
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
                    <td class="d-flex gap-1">
                        <button type="button" class="btn btn-sm btn-primary" data-mapping-save="${idx}" title="${actionLabel}">
                            <i class="bi bi-check2"></i>
                        </button>
                        ${deleteBtn}
                    </td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="5" class="text-muted text-center py-3">Aucun produit vendu sur les 90 derniers jours.</td></tr>';

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
                if (!target) {
                    if (typeof showToast === 'function') showToast('Choisir un produit du catalogue', 'warning');
                    return;
                }
                try {
                    const res = await fetch('/api/finance/alias', {
                        method: 'PUT',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ alias_produit: alias, produit_catalog: target })
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
                    if (typeof showToast === 'function') showToast('Alias supprimé', 'success');
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

    async function loadPl() {
        const resultEl = document.getElementById('fin-pl-result');
        if (!resultEl) return;
        // Garde-fou: pre-remplir les dates si vides (1er du mois -> today).
        // Le subnav click handler appelle ensureDefaultDates au clic Finance
        // mais on le re-appelle ici par securite (ex: deep link direct PL).
        ensureDefaultDates();
        resultEl.innerHTML = '<div class="text-muted"><i class="bi bi-hourglass-split"></i> Calcul en cours...</div>';
        try {
            const dateDebut = document.getElementById('fin-pl-date-debut').value;
            const dateFin = document.getElementById('fin-pl-date-fin').value;
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
        } catch (e) {
            resultEl.innerHTML = `<div class="alert alert-danger">Erreur: ${esc(e.message)}</div>`;
        }
    }

    // Postes neutralises par l'utilisateur, pour repondre a "et si cette ligne
    // n'existait pas ?". C'est une SIMULATION d'affichage: rien n'est envoye au
    // serveur, rien n'est enregistre, et le PL reel reste affiche a cote.
    const plPostesNeutralises = new Set();
    let plDernieresDonnees = null;

    function renderPl(d) {
        const resultEl = document.getElementById('fin-pl-result');
        if (!resultEl) return;
        // Memorise pour pouvoir re-rendre a chaque bascule sans rappeler l'API.
        plDernieresDonnees = d;
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
        const stockCouleur = stock.variation_nette >= 0 ? 'success' : 'danger';

        const stockTooltip = `Stock matin (${stock.matin_date || 'n/a'}): ${fmtMoney(stock.matin_debut)} | Stock soir (${stock.soir_date || 'n/a'}): ${fmtMoney(stock.soir_fin)} | Coefficient: ${stock.coeff} (pertes ${stock.pertes_decoupe_pct}%)`;

        const postes = [
            { cle: 'ventes', signe: 1, montant: d.total_ventes || 0, couleur: 'primary', neutralisable: false,
              libelle: '<i class="bi bi-cash-stack text-primary"></i> Montant Total des Ventes'
                + (d.ventes_hors_boucherie_pct !== null && d.ventes_hors_boucherie_pct !== undefined
                    ? ` <span class="badge bg-light text-dark border ms-2"
                          title="Part du chiffre d'affaires qui ne vient pas de la boucherie (famille Épicerie ou Autres).">
                          dont hors boucherie ${esc(fmtMoney(d.ventes_hors_boucherie || 0))}
                          · ${esc(d.ventes_hors_boucherie_pct)} %</span>`
                    : '') },
            { cle: 'avances', signe: -1, montant: d.total_avances || 0, couleur: 'danger', neutralisable: false,
              libelle: '<i class="bi bi-bank text-danger"></i> Total avances (MataBanq)' },
            { cle: 'commission', signe: -1, montant: d.commission_maas || 0, couleur: 'warning', neutralisable: true,
              libelle: '<i class="bi bi-percent text-warning"></i> Commission MaaS (3%)' },
            { cle: 'marge_cdc', signe: 1, montant: d.marge_cdc || 0, couleur: 'success', neutralisable: true,
              libelle: '<i class="bi bi-coin text-success"></i> Marge CDC (Il me doit)' },
            { cle: 'charges', signe: -1, montant: ch.total_prorata || 0, couleur: 'danger', neutralisable: true,
              libelle: `<i class="bi bi-receipt text-info"></i> Charges proratisées ${esc(libelleProrataCharges(ch))}` },
            { cle: 'depenses', signe: -1, montant: d.depenses_periode || 0, couleur: 'danger', neutralisable: true,
              libelle: `<i class="bi bi-cart-dash text-danger"></i> Dépenses (période)${doubleCompte}` },
            { cle: 'paiements', signe: -1, montant: d.paiements_fournisseur || 0, couleur: 'danger', neutralisable: true,
              libelle: '<i class="bi bi-wallet2 text-secondary"></i> Paiements faits au fournisseur' },
            { cle: 'stock', signe: 1, montant: stock.variation_nette || 0, couleur: stockCouleur, neutralisable: true,
              libelle: `<i class="bi bi-box-seam text-${stockCouleur}"></i> Variation stock ×
                        <span class="badge bg-light text-dark border">${esc(stock.coeff)}</span>
                        <small class="text-muted">(pertes découpe ${esc(stock.pertes_decoupe_pct)}%)</small>`,
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
        const simulation = plPostesNeutralises.size > 0;
        const pl = simulation
            ? postes.filter(actif).reduce((s, p) => s + p.signe * p.montant, 0)
            : (d.pl || 0);
        const plColor = pl >= 0 ? 'success' : 'danger';
        const ecart = pl - (d.pl || 0);

        // Marge brute = ventes - avances + variation stock, soit la marge sur
        // les achats REELLEMENT consommes: les achats corriges de ce qui est
        // reste en stock. Elle suit donc la neutralisation de la variation
        // stock, mais pas celle des charges - qui n'en font pas partie.
        const margeBrute = postes
            .filter((p) => ['ventes', 'avances', 'stock'].includes(p.cle) && actif(p))
            .reduce((s, p) => s + p.signe * p.montant, 0);
        // Retrouve par sa CLE, pas par sa position: postes[0] se trouve etre
        // les ventes aujourd'hui, mais reordonner le tableau ferait alors
        // diviser par le mauvais montant, en silence.
        const posteVentes = postes.find((p) => p.cle === 'ventes');
        const ventesActives = (posteVentes && actif(posteVentes)) ? (d.total_ventes || 0) : 0;
        // Pourcentage du CHIFFRE D'AFFAIRES. Sans ventes, il n'y a pas de taux
        // a calculer: on affiche un tiret plutot qu'un 0% trompeur.
        const margeBrutePct = ventesActives > 0 ? (margeBrute / ventesActives) * 100 : null;
        const margeColor = margeBrute >= 0 ? 'success' : 'danger';

        // Le calcul EN CLAIR, avec ses montants. Un taux de -176% se verifie
        // alors a l'oeil au lieu d'etre a prendre pour argent comptant, et on
        // voit immediatement quel terme le tire vers le bas.
        const termesMarge = postes
            .filter((p) => ['ventes', 'avances', 'stock'].includes(p.cle))
            .map((p) => {
                const off = !actif(p);
                const valeur = p.signe * p.montant;
                const libelle = { ventes: 'Ventes', avances: 'Avances', stock: 'Variation stock' }[p.cle];
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
        const stockSignNet = stock.variation_nette >= 0 ? '+' : '−';
        const stockColorNet = stock.variation_nette >= 0 ? 'success' : 'danger';

        resultEl.innerHTML = `
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
                            <h6 class="card-subtitle mb-2 text-muted">Marge brute</h6>
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
                                    Marge sur les achats réellement consommés : les achats corrigés
                                    de ce qui est resté en stock. Les charges, la commission et les
                                    dépenses n'en font pas partie — elles viennent après.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Décomposition -->
            <h6 class="fin-subheading">
                Décomposition
                <small class="text-muted fw-normal ms-2">— cliquez une ligne pour la retirer et voir son effet</small>
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
                            <td>Stock soir${plAsterisqueSoir} <small class="text-muted">(${esc(stock.soir_date || 'n/a')})</small></td>
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
                        <tr class="table-light fw-bold">
                            <td>= Variation stock nette</td>
                            <td class="text-end text-${stockColorNet}">${stockSignNet} ${esc(fmtMoney(Math.abs(stock.variation_nette)))}</td>
                        </tr>
                    </tbody>
                </table>
                ${plLegendePrix}
                ${plNoteStock}
                ${plAvertPrix}
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
        `;

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
        const reset = document.getElementById('fin-pl-reset');
        if (reset) {
            reset.addEventListener('click', () => {
                plPostesNeutralises.clear();
                renderPl(plDernieresDonnees);
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

    async function loadSimulation() {
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

    async function loadCashStock() {
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
        } catch (e) {
            resultEl.innerHTML = `<div class="alert alert-danger">Erreur: ${esc(e.message)}</div>`;
        }
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

        const stockSnapshotInfo = stock.soir_date_utilisee && stock.soir_date_utilisee !== d.date
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
                                <td>× coefficient <span class="text-muted">(1 − ${esc(stock.pertes_decoupe_pct)}% pertes découpe, <strong>boucherie seule</strong>)</span></td>
                                <td class="text-end">× ${esc(stock.coeff)}</td>
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
        `;
    }

})();
