/**
 * Bouton "Générer rapport de parage" de l'écran Réconciliation du mois.
 *
 * Calcule sur les données déjà en base (GET /api/reconciliation/parage-rapport),
 * fait rédiger les constats par le pipeline IA déjà en place pour le PL
 * (POST /api/finance/analyse-ia, type 'parage' — le modèle ne calcule rien,
 * il commente les chiffres reçus), puis assemble un poster A4 par catégorie
 * ayant du volume ce mois-ci (bœuf et/ou agneau) et le télécharge en PDF et
 * en PNG (une image par page), via html2pdf.js déjà utilisé par le POS.
 */

(function () {
    'use strict';

    // esc() vient de js/ui-helpers.js (charge avant ce fichier) - partagee
    // avec js/finance.js plutot que redefinie ici.

    const LIBELLE_CATEGORIE = { bovin: 'Bœuf/Veau', ovin: 'Agneau' };
    const COULEUR_ROUGE = '#8c3a2e';
    const COULEUR_VERTE = '#7d8a5c';

    function couleurTaux(pct, ciblePct) {
        return (pct == null || pct > ciblePct) ? COULEUR_ROUGE : COULEUR_VERTE;
    }

    /**
     * La periode selectionnee inclut-elle AUJOURD'HUI ?
     *
     * Le stock du soir du jour en cours n'est, la plupart du temps, pas
     * encore saisi au moment ou quelqu'un clique ce bouton en journee: la
     * journee remonte alors a 100% de parage (rien de vendu ne peut
     * compenser un theorique deja compte), et fausserait aussi bien le
     * classement des jours notables que la derniere semaine du graphique.
     */
    function periodeInclutAujourdhui(mois, annee) {
        const now = new Date();
        return (now.getMonth() + 1) === mois && now.getFullYear() === annee;
    }

    async function avertirSiStockDuJourIncomplet(mois, annee) {
        if (!periodeInclutAujourdhui(mois, annee)) return true;
        const message = "Le stock du soir d'aujourd'hui n'est peut-être pas encore complètement "
            + 'saisi : la journée en cours risque de fausser le rapport (parage apparent proche de '
            + '100% sur une journée qui n\'est simplement pas terminée). Continuer quand même ?';
        if (typeof showConfirmModal === 'function') {
            return showConfirmModal(message, { title: 'Journée en cours', okLabel: 'Générer quand même', okVariant: 'primary' });
        }
        return confirm(message);
    }

    async function genererRapportParage() {
        const bouton = document.getElementById('generer-rapport-parage');
        const moisSelect = document.getElementById('mois-reconciliation');
        const anneeSelect = document.getElementById('annee-reconciliation');
        const pvSelect = document.getElementById('point-vente-filtre-mois');
        if (!bouton || !moisSelect || !anneeSelect) return;

        const mois = parseInt(moisSelect.value, 10);
        const annee = parseInt(anneeSelect.value, 10);
        const pointVente = (pvSelect && pvSelect.value) || '';

        const continuer = await avertirSiStockDuJourIncomplet(mois, annee);
        if (!continuer) return;

        const libelleInitial = bouton.innerHTML;
        bouton.disabled = true;
        bouton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération…';

        try {
            const qs = new URLSearchParams({ mois: String(mois), annee: String(annee) });
            if (pointVente) qs.set('pointVente', pointVente);
            const res = await fetch('/api/reconciliation/parage-rapport?' + qs.toString(), { credentials: 'include' });
            const json = await res.json();
            if (!json.success) throw new Error(json.message || 'Erreur');

            const categories = ['bovin', 'ovin'].filter((cat) => json[cat]);
            if (!categories.length) {
                if (typeof showToast === 'function') {
                    showToast('Aucun volume mesurable ce mois-ci : rien à rapporter.', 'warning');
                }
                return;
            }

            const pages = [];
            for (const cat of categories) {
                const rapport = json[cat];
                const payload = Object.assign({}, rapport, {
                    categorie: LIBELLE_CATEGORIE[cat],
                    point_de_vente: pointVente || 'tous les points de vente',
                    periode: json.periode
                });
                const iaRes = await fetch('/api/finance/analyse-ia', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'parage', payload: payload })
                });
                const iaJson = await iaRes.json();
                if (!iaJson.success) throw new Error(iaJson.error || 'analyse indisponible pour ' + LIBELLE_CATEGORIE[cat]);
                pages.push({ cat, rapport, poster: iaJson.data.poster });
            }

            await genererDocument(pages, json);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur: ' + e.message, 'danger');
            else alert('Erreur: ' + e.message);
        } finally {
            bouton.disabled = false;
            bouton.innerHTML = libelleInitial;
        }
    }

    // ===== Construction du document (DOM hors-ecran + graphiques + export) =====

    function construirePageHtml(cat, rapport, poster, periode) {
        const idA = `parage-chart-livraison-${cat}`;
        const idB = `parage-chart-semaines-${cat}`;
        const jn = rapport.jours_notables || [];
        return `
            <div class="mata-poster-page" data-cat="${cat}">
                <div class="mata-poster-eyebrow">
                    <span class="mata-poster-bar"></span> ANALYSE — ${esc(LIBELLE_CATEGORIE[cat])}
                </div>
                <h1 class="mata-poster-titre">Ce que disent les chiffres</h1>
                <div class="mata-poster-charts">
                    <div class="mata-poster-chart-bloc">
                        <div class="mata-poster-chart-legende">${esc(poster.titre_01 || 'Le parage naît à la réception')}</div>
                        <canvas id="${idA}" width="360" height="260"></canvas>
                    </div>
                    <div class="mata-poster-chart-bloc">
                        <div class="mata-poster-chart-legende">${esc(poster.titre_04 || 'Dérive dans le mois')}</div>
                        <canvas id="${idB}" width="360" height="260"></canvas>
                    </div>
                </div>
                <div class="mata-poster-blocs">
                    <div class="mata-poster-bloc">
                        <span class="mata-poster-num">01</span>
                        <h3>${esc(poster.titre_01 || '')}</h3>
                        <p>${esc(poster.texte_01 || '')}</p>
                    </div>
                    <div class="mata-poster-bloc">
                        <span class="mata-poster-num">02</span>
                        <h3>${esc(poster.titre_02 || '')}</h3>
                        <p>${esc(poster.texte_02 || '')}</p>
                    </div>
                    <div class="mata-poster-bloc">
                        <span class="mata-poster-num">03</span>
                        <h3>${esc(poster.titre_03 || '')}</h3>
                        <p>${esc(poster.texte_03 || '')}</p>
                    </div>
                    <div class="mata-poster-bloc">
                        <span class="mata-poster-num">04</span>
                        <h3>${esc(poster.titre_04 || '')}</h3>
                        <p>${esc(poster.texte_04 || '')}</p>
                    </div>
                </div>
                <div class="mata-poster-enjeu">
                    <h4>L'enjeu chiffré</h4>
                    <p>${esc(poster.enjeu || '')}</p>
                </div>
                <h3 class="mata-poster-mesures-titre">Deux mesures, applicables tout de suite</h3>
                <ol class="mata-poster-mesures">
                    <li>${esc(poster.mesure_1 || '')}</li>
                    <li>${esc(poster.mesure_2 || '')}</li>
                </ol>
                <div class="mata-poster-footer">
                    <span>Source : données Réconciliation du mois, ${esc(periode.debut)} → ${esc(periode.fin)}</span>
                    <span>MATA Group SA</span>
                </div>
            </div>
        `;
    }

    const STYLE_POSTER = `
        .mata-poster-page {
            width: 210mm; min-height: 297mm; box-sizing: border-box;
            padding: 15mm; background: #faf7f0; color: #1a1a1a;
            font-family: Georgia, 'Times New Roman', serif;
            page-break-after: always;
        }
        .mata-poster-eyebrow {
            font-family: Arial, sans-serif; font-size: 11px; letter-spacing: 2px;
            font-weight: bold; color: #8c3a2e; display: flex; align-items: center; gap: 8px;
        }
        .mata-poster-bar { display: inline-block; width: 28px; height: 3px; background: #8c3a2e; }
        .mata-poster-titre { font-size: 30px; margin: 6px 0 18px; line-height: 1.15; }
        .mata-poster-charts { display: flex; gap: 16px; margin-bottom: 20px; }
        .mata-poster-chart-bloc { flex: 1; min-width: 0; }
        .mata-poster-chart-legende {
            font-family: Arial, sans-serif; font-size: 11px; color: #555; margin-bottom: 4px;
        }
        .mata-poster-chart-bloc canvas { width: 100% !important; height: 190px !important; }
        .mata-poster-blocs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; margin-bottom: 18px; }
        .mata-poster-bloc h3 { font-size: 15px; margin: 2px 0 4px; }
        .mata-poster-bloc p { font-family: Arial, sans-serif; font-size: 12px; line-height: 1.45; color: #333; margin: 0; }
        .mata-poster-num {
            font-family: Arial, sans-serif; font-size: 11px; font-weight: bold; color: #8c3a2e;
        }
        .mata-poster-enjeu {
            background: #f1ece0; border-left: 4px solid #8c3a2e; padding: 10px 14px; margin-bottom: 16px;
        }
        .mata-poster-enjeu h4 { font-size: 15px; margin: 0 0 4px; }
        .mata-poster-enjeu p { font-family: Arial, sans-serif; font-size: 12px; color: #333; margin: 0; }
        .mata-poster-mesures-titre { font-size: 16px; margin: 0 0 8px; }
        .mata-poster-mesures { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding-left: 20px; margin: 0 0 24px; }
        .mata-poster-mesures li { margin-bottom: 6px; }
        .mata-poster-footer {
            display: flex; justify-content: space-between; font-family: Arial, sans-serif;
            font-size: 10px; color: #888; border-top: 1px solid #ddd; padding-top: 8px;
        }
    `;

    // Chart.js ne liberes rien tout seul quand son canvas quitte le DOM (pas
    // de MutationObserver interne) - il faut appeler .destroy() nous-memes,
    // sinon chaque generation de rapport dans la meme session laisse deux
    // instances orphelines (listeners de resize compris) par page.
    function tracerChartsPourPage(cat, rapport) {
        const ciblePct = rapport.cible_pct;
        const av = rapport.avec_livraison, sn = rapport.sans_livraison;
        // eslint-disable-next-line no-undef
        const chartLivraison = new Chart(document.getElementById(`parage-chart-livraison-${cat}`), {
            type: 'bar',
            data: {
                labels: [`Jours avec\nlivraison (${av.n_jours} j)`, `Jours sans\nlivraison (${sn.n_jours} j)`],
                datasets: [{
                    data: [av.taux_pondere_pct, sn.taux_pondere_pct],
                    backgroundColor: [couleurTaux(av.taux_pondere_pct, ciblePct), couleurTaux(sn.taux_pondere_pct, ciblePct)]
                }]
            },
            options: {
                animation: false, responsive: false,
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end', align: 'top', font: { weight: 'bold' },
                        formatter: (v) => (v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %')
                    }
                },
                scales: { y: { beginAtZero: true, title: { display: true, text: 'Taux de parage (%)' } } }
            }
        });

        const semaines = rapport.semaines || [];
        // eslint-disable-next-line no-undef
        const chartSemaines = new Chart(document.getElementById(`parage-chart-semaines-${cat}`), {
            type: 'bar',
            data: {
                labels: semaines.map((s) => `${s.label}\n${s.periode}`),
                datasets: [
                    {
                        label: 'Taux de parage',
                        data: semaines.map((s) => s.taux_pondere_pct),
                        backgroundColor: semaines.map((s) => couleurTaux(s.taux_pondere_pct, ciblePct))
                    },
                    {
                        label: `Cible ${ciblePct} %`,
                        type: 'line',
                        data: semaines.map(() => ciblePct),
                        borderColor: '#888', borderDash: [6, 4], borderWidth: 1.5,
                        pointRadius: 0, fill: false
                    }
                ]
            },
            options: {
                animation: false, responsive: false,
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end', align: 'top', font: { weight: 'bold' },
                        formatter: (v, ctx) => (ctx.datasetIndex === 1 || v == null) ? ''
                            : v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'
                    }
                },
                scales: { y: { beginAtZero: true, title: { display: true, text: 'Taux de parage (%)' } } }
            }
        });

        return [chartLivraison, chartSemaines];
    }

    function attendreRendu() {
        return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 300)));
    }

    /**
     * html2canvas (embarque par html2pdf.js) NE DETECTE PAS TOUJOURS la
     * largeur/hauteur reelle de l'element cible - mesure ici: sans le dire
     * explicitement, la capture rend une hauteur de 0 (image quasi vide),
     * alors que l'element a bien sa taille normale dans le DOM. On la lui
     * donne donc nous-memes plutot que de compter sur sa detection.
     */
    function dimensionsHtml2canvas(el) {
        return { width: el.offsetWidth, height: el.offsetHeight, x: 0, y: 0, scrollX: 0, scrollY: 0 };
    }

    async function genererDocument(pages, json) {
        const conteneur = document.createElement('div');
        conteneur.style.position = 'fixed';
        conteneur.style.left = '0';
        conteneur.style.top = '0';
        conteneur.style.zIndex = '-9999';
        conteneur.style.opacity = '0';
        conteneur.style.pointerEvents = 'none';
        const style = document.createElement('style');
        style.textContent = STYLE_POSTER;
        conteneur.appendChild(style);
        conteneur.innerHTML += pages.map((p) => construirePageHtml(p.cat, p.rapport, p.poster, json.periode)).join('');
        document.body.appendChild(conteneur);

        const charts = [];
        try {
            for (const p of pages) charts.push(...tracerChartsPourPage(p.cat, p.rapport));
            await attendreRendu();

            const nomBase = `rapport-parage-${json.annee}-${String(json.mois).padStart(2, '0')}`;
            const pageEls = conteneur.querySelectorAll('.mata-poster-page');
            const optsHtml2canvas = (el) => Object.assign(
                { scale: 2, useCORS: true, backgroundColor: '#faf7f0' },
                dimensionsHtml2canvas(el)
            );

            // Un canvas par page (API documentee .toCanvas().get('canvas') -
            // pas de global html2canvas expose par ce bundle CDN). Sert au
            // PNG ET au PDF: pagebreak.mode 'css' du bundle ne coupe pas
            // fiablement un conteneur multi-pages (constate au test), donc
            // le PDF combine est assemble a la main, page par page.
            //
            // Page 0 passe par un worker html2pdf COMPLET des le depart (et
            // non un worker jetable juste pour son canvas): .toPdf(), appele
            // plus bas sur ce MEME worker, reutilise le canvas deja rendu
            // par .toCanvas() au lieu de relancer html2canvas une seconde
            // fois sur la page la plus chargee (verifie: worker.get('canvas')
            // rend alors la reference EXACTE du premier rendu).
            const worker0 = html2pdf().set({
                margin: 0,
                html2canvas: optsHtml2canvas(pageEls[0]),
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).from(pageEls[0]);
            const canvases = [await worker0.toCanvas().get('canvas')];
            for (let i = 1; i < pageEls.length; i++) {
                // eslint-disable-next-line no-undef
                canvases.push(await html2pdf().set({ html2canvas: optsHtml2canvas(pageEls[i]) }).from(pageEls[i]).toCanvas().get('canvas'));
            }
            canvases.forEach((canvas, i) => {
                const lien = document.createElement('a');
                lien.download = `${nomBase}-${pages[i].cat}.png`;
                lien.href = canvas.toDataURL('image/png');
                document.body.appendChild(lien);
                lien.click();
                lien.remove();
            });

            await worker0.toPdf();
            const pdf = await worker0.get('pdf');
            for (let i = 1; i < canvases.length; i++) {
                pdf.addPage('a4', 'portrait');
                pdf.addImage(canvases[i].toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
            }
            pdf.save(nomBase + '.pdf');

            if (typeof showToast === 'function') showToast('Rapport de parage généré (PDF + PNG)', 'success');
        } finally {
            charts.forEach((c) => c.destroy());
            conteneur.remove();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const bouton = document.getElementById('generer-rapport-parage');
        if (bouton) bouton.addEventListener('click', genererRapportParage);
    });
})();
