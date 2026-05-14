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

        // Subnav (creances / cdc / depenses / prix / mapping)
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
            });
        });

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

        const configSave = document.getElementById('fin-config-save');
        if (configSave) configSave.addEventListener('click', onConfigSave);

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
        for (const id of ['fin-creances-date-debut', 'fin-cdc-date-debut', 'fin-depense-date-debut']) {
            const el = document.getElementById(id);
            if (el && !el.value) el.value = firstISO;
        }
        for (const id of ['fin-creances-date-fin', 'fin-cdc-date-fin', 'fin-depense-date-fin']) {
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
            renderCdb(json.data.cdb, json.data.cdb_error);
            renderLocal(json.data.local);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur creances: ' + e.message, 'danger');
        }
    }

    // ===== Bloc 1: Créance officielle CDB (depuis MataBanq) =====
    function renderCdb(cdb, cdbError) {
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
        const operations = (detail && detail.operations) || [];
        const summary = cdb.summary || null;
        const meta = cdb.metadata || {};

        const label = meta.label || (clientStatus && clientStatus.client_name) || '?';
        const director = (detail && detail.assigned_director) || '—';
        const dateSel = (summary && summary.date_selected) || '';
        status.className = 'fin-pill fin-pill--success ms-2';
        status.textContent = `${label} • ${dateSel} • Resp: ${director}`;

        const solde = clientStatus ? clientStatus.solde_final : (summary ? summary.totals.current_balance : 0);
        const avances = clientStatus ? clientStatus.total_avances : 0;
        const remb = clientStatus ? clientStatus.total_remboursements : 0;
        const diff = summary ? (summary.totals.total_difference || 0) : 0;

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
            kpiCard('info',    'graph-up',          'Δ vs veille',             `${diffSign}${fmtAmount(diff)}`)
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
    function renderLocal(data) {
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
            card3('warning', 'percent',    `Je dois (${data.commission_pct}% sur ventes ${data.categories_eligibles.join('/')})`, fmtAmount(data.ce_que_je_dois)),
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
        `).join('') || '<tr><td colspan="3" class="text-muted text-center">Aucune vente éligible sur la période</td></tr>';

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
            const rows = c.detail.map((d, lineIdx) => {
                const prixCdcVal = d.prix_vente_cdc != null ? d.prix_vente_cdc : '';
                return `
                <tr data-cdc-row data-centre-idx="${idx}" data-line-idx="${lineIdx}" data-produit="${esc(d.produit)}">
                    <td>${esc(d.produit)}</td>
                    <td class="text-end">${esc(d.quantite_cdc)}</td>
                    <td class="text-end">${d.prix_achat == null ? '<span class="text-muted">—</span>' : esc(fmtMoney(d.prix_achat))}</td>
                    <td class="text-end" style="min-width:170px">
                        <div class="d-inline-flex align-items-center gap-1" style="white-space:nowrap">
                            <input type="number" min="0" step="1" class="form-control form-control-sm text-end"
                                   style="width:90px; display:inline-block"
                                   value="${esc(prixCdcVal)}"
                                   data-prix-cdc-input>
                            <button type="button" class="btn btn-sm btn-success py-0 px-1"
                                    data-prix-cdc-save
                                    title="Sauvegarder le nouveau prix vente CDC">
                                <i class="bi bi-check2"></i>
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1"
                                    data-prix-cdc-history
                                    title="Voir l'historique des changements">
                                <i class="bi bi-clock-history"></i>
                            </button>
                        </div>
                    </td>
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
            }).join('') || '<tr><td colspan="7" class="text-muted text-center">Aucune ligne</td></tr>';
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
                                        <th class="text-end">Prix achat fournisseur</th>
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

        // Wire les boutons "Save" prix vente CDC inline (par row).
        accordion.querySelectorAll('[data-prix-cdc-save]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const tr = btn.closest('[data-cdc-row]');
                if (!tr) return;
                const produit = tr.dataset.produit;
                const input = tr.querySelector('[data-prix-cdc-input]');
                const val = parseFloat(input ? input.value : 0);
                if (!Number.isFinite(val) || val < 0) {
                    if (typeof showToast === 'function') showToast('Prix invalide', 'warning');
                    return;
                }
                try {
                    const res = await fetch('/api/finance/prix-cdc/' + encodeURIComponent(produit), {
                        method: 'PUT',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prix_vente_cdc: val })
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    if (typeof showToast === 'function') {
                        showToast(`Prix vente CDC mis à jour pour ${produit}`, 'success');
                    }
                    // Re-fetch pour recalculer la marge + recevable avec le nouveau prix
                    loadCdc();
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            });
        });

        // Wire les boutons "History" (affiche modale avec historique des changements).
        accordion.querySelectorAll('[data-prix-cdc-history]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const tr = btn.closest('[data-cdc-row]');
                if (!tr) return;
                const produit = tr.dataset.produit;
                try {
                    const res = await fetch('/api/finance/prix-cdc/' + encodeURIComponent(produit) + '/history', {
                        credentials: 'include'
                    });
                    const j = await res.json();
                    if (!j.success) throw new Error(j.error || 'Erreur');
                    showPrixCdcHistoryModal(produit, j.data);
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
                }
            });
        });
    }

    // Modale historique des changements de prix_vente_cdc pour un produit.
    // Réutilise l'infrastructure modale CDC details (même DOM #fin-cdc-details-modal).
    function showPrixCdcHistoryModal(produit, rows) {
        const title = document.getElementById('fin-cdc-details-title');
        const body = document.getElementById('fin-cdc-details-body');
        const modalEl = document.getElementById('fin-cdc-details-modal');
        if (!title || !body || !modalEl) return;
        title.innerHTML = `<i class="bi bi-clock-history me-2"></i>Historique prix vente CDC — <strong>${esc(produit)}</strong>`;
        const list = Array.isArray(rows) ? rows : [];
        const rowsHtml = list.map((h) => {
            const when = h.created_at ? new Date(h.created_at).toLocaleString('fr-FR') : '—';
            return `
                <tr>
                    <td class="text-nowrap">${esc(when)}</td>
                    <td class="text-end fw-medium">${esc(fmtMoney(h.prix_vente_cdc))}</td>
                    <td>${esc(h.changed_by || 'anonymous')}</td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="3" class="text-muted text-center py-3">Aucun changement enregistré (valeur seedée par défaut).</td></tr>';
        body.innerHTML = `
            <div class="alert alert-light border small mb-3">
                <i class="bi bi-info-circle"></i> Chaque sauvegarde du prix vente CDC est historisée.
                La valeur la plus récente (en haut) est celle actuellement utilisée pour le calcul de marge.
            </div>
            <div class="table-responsive">
                <table class="table table-sm mb-0">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th class="text-end">Prix vente CDC</th>
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
                    <td class="text-end">${esc(fmtMoney(v.marge_unitaire))}</td>
                    <td class="text-end fw-bold">${esc(fmtMoney(v.recevable_ligne))}</td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="7" class="text-muted text-center py-3">Aucune vente individuelle dans le payload — pense à redémarrer le serveur après le dernier déploiement.</td></tr>';

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
                <div class="mb-2"><code>recevable_par_vente = (mon_prix − prix_achat_fournisseur) × quantité</code></div>
                <div class="fin-kpi-label mb-1">Agrégat ${esc(line.produit)} chez ${esc(centre.centre)}</div>
                <div>
                    Quantité <strong>${esc(line.quantite_cdc)} kg</strong>
                    × marge moyenne <strong>${esc(fmtMoney(line.marge_unitaire))}</strong>
                    = <strong class="text-success">${esc(fmtMoney(line.recevable))}</strong>
                </div>
                <div class="small text-muted mt-1">
                    Prix d'achat fournisseur référence : <strong>${esc(fmtMoney(line.prix_achat))}</strong>
                    • Prix vente CDC (configuré) : <strong>${esc(fmtMoney(line.prix_vente_cdc))}</strong>
                    • Mon prix moyen POS (info) : <strong>${esc(fmtMoney(line.mon_prix_moyen))}</strong>
                </div>
            </div>

            <!-- Détail des ventes individuelles -->
            <div class="fin-subheading">Détail des ventes individuelles</div>
            <div class="table-responsive">
                <table class="table table-sm mb-0">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Client / Commande</th>
                            <th class="text-end">Quantité</th>
                            <th class="text-end">Mon prix</th>
                            <th class="text-end">Prix achat</th>
                            <th class="text-end">Marge unit.</th>
                            <th class="text-end">Recevable</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background:#f8fafc">
                            <th colspan="6" class="text-end">Total</th>
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

    async function loadDepenses() {
        try {
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

    async function loadPrix() {
        try {
            // Charger config (commission_pct) et prix en parallele
            const [cfgRes, prixRes] = await Promise.all([
                fetch('/api/finance/config', { credentials: 'include' }),
                fetch('/api/finance/prix', { credentials: 'include' })
            ]);
            const cfgJson = await cfgRes.json();
            const prixJson = await prixRes.json();
            if (!cfgJson.success) throw new Error(cfgJson.error || 'config');
            if (!prixJson.success) throw new Error(prixJson.error || 'prix');

            const commPct = document.getElementById('fin-commission-pct');
            if (commPct) commPct.value = cfgJson.data.commission_pct || '3.0';

            const tbody = document.querySelector('#fin-prix-table tbody');
            tbody.innerHTML = '';
            for (const row of prixJson.data) {
                addPrixRow(row.produit, row.prix_vente, row.prix_achat == null ? '' : row.prix_achat);
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur prix: ' + e.message, 'danger');
        }
    }

    function addPrixRow(produit, prixVente, prixAchat) {
        const tbody = document.querySelector('#fin-prix-table tbody');
        const tr = document.createElement('tr');

        const tdP = document.createElement('td');
        const inP = document.createElement('input');
        inP.type = 'text'; inP.className = 'form-control form-control-sm'; inP.value = produit || '';
        inP.dataset.col = 'produit';
        tdP.appendChild(inP);

        const tdV = document.createElement('td');
        const inV = document.createElement('input');
        inV.type = 'number'; inV.min = '0'; inV.step = '1'; inV.className = 'form-control form-control-sm';
        inV.value = prixVente == null ? '' : prixVente;
        inV.dataset.col = 'prix_vente';
        tdV.appendChild(inV);

        const tdA = document.createElement('td');
        const inA = document.createElement('input');
        inA.type = 'number'; inA.min = '0'; inA.step = '1'; inA.className = 'form-control form-control-sm';
        inA.value = prixAchat == null ? '' : prixAchat;
        inA.dataset.col = 'prix_achat';
        tdA.appendChild(inA);

        // Bouton supprimer. Si la ligne vient de la BDD (produit existant),
        // on appelle DELETE /api/finance/prix/:produit. Sinon (ligne ajoutee
        // localement via "+ Ajouter une ligne"), on retire juste du DOM.
        const tdDel = document.createElement('td');
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

        tr.append(tdP, tdV, tdA, tdDel);
        tbody.appendChild(tr);
    }

    async function onPrixSave() {
        try {
            const items = [];
            document.querySelectorAll('#fin-prix-table tbody tr').forEach((tr) => {
                const inputs = tr.querySelectorAll('input');
                const obj = {};
                inputs.forEach((inp) => { obj[inp.dataset.col] = inp.value; });
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

})();
