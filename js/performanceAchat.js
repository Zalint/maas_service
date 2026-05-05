// Global variables
let allPerformances = [];
let allAcheteurs = [];
let currentEditId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded');
    console.log('Flatpickr available:', typeof flatpickr !== 'undefined');
    
    // Delay initialization slightly to ensure all scripts are loaded
    setTimeout(() => {
        initializeDatePickers();
        loadAcheteurs();
        
        // Load performances with default date range (first day of month to today)
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const defaultFilters = {
            startDate: firstDayOfMonth.toISOString().split('T')[0],
            endDate: today.toISOString().split('T')[0]
        };
        
        loadPerformances(defaultFilters);
        loadRankings();
        setupEventListeners();
    }, 100);
});

// Initialize Flatpickr date pickers
function initializeDatePickers() {
    console.log('Initializing date pickers...');
    
    if (typeof flatpickr === 'undefined') {
        console.error('Flatpickr not loaded!');
        return;
    }
    
    // Main form date picker
    const dateInput = document.getElementById('date');
    console.log('Date input found:', dateInput);
    
    if (dateInput) {
        const fp = flatpickr(dateInput, {
            dateFormat: 'Y-m-d',
            allowInput: false,
            defaultDate: new Date(),
            locale: window.flatpickr.l10ns.fr || 'fr',
            disableMobile: true,
            clickOpens: true,
            onChange: function(selectedDates, dateStr, instance) {
                console.log('Date selected:', dateStr);
            }
        });
        console.log('Flatpickr instance created:', fp);
    }

    // Filter start date - default to first day of current month
    const filterStartDate = document.getElementById('filter-start-date');
    if (filterStartDate) {
        const firstDayOfMonth = new Date();
        firstDayOfMonth.setDate(1); // Set to 1st day of current month
        
        flatpickr(filterStartDate, {
            dateFormat: 'Y-m-d',
            allowInput: false,
            defaultDate: firstDayOfMonth,
            locale: window.flatpickr.l10ns.fr || 'fr',
            disableMobile: true
        });
    }

    // Filter end date - default to today
    const filterEndDate = document.getElementById('filter-end-date');
    if (filterEndDate) {
        flatpickr(filterEndDate, {
            dateFormat: 'Y-m-d',
            allowInput: false,
            defaultDate: new Date(), // Today
            locale: window.flatpickr.l10ns.fr || 'fr',
            disableMobile: true
        });
    }
    
    console.log('Date pickers initialized');
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('performanceForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('filterForm').addEventListener('submit', handleFilterSubmit);
    document.getElementById('cancelEdit').addEventListener('click', cancelEdit);
    document.getElementById('exportExcel').addEventListener('click', exportToExcel);
    document.getElementById('veilleBetailBtn').addEventListener('click', showVeilleBetail);
}

// Load acheteurs from API
async function loadAcheteurs() {
    try {
        console.log('Loading acheteurs...');
        const response = await fetch('/api/acheteurs', {
            credentials: 'include' // Include session cookies
        });
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Acheteurs data:', data);
        
        if (data.success) {
            allAcheteurs = data.acheteurs;
            console.log('Acheteurs loaded:', allAcheteurs);
            populateAcheteurDropdowns();
        } else {
            showNotification('Erreur lors du chargement des acheteurs: ' + (data.error || 'Unknown error'), 'danger');
        }
    } catch (error) {
        console.error('Error loading acheteurs:', error);
        showNotification('Erreur lors du chargement des acheteurs: ' + error.message, 'danger');
    }
}

// Populate acheteur dropdowns
function populateAcheteurDropdowns() {
    const acheteurSelect = document.getElementById('acheteur');
    const filterAcheteurSelect = document.getElementById('filter-acheteur');
    
    // Clear existing options (except first one)
    acheteurSelect.innerHTML = '<option value="">Sélectionner...</option>';
    filterAcheteurSelect.innerHTML = '<option value="">Tous</option>';
    
    allAcheteurs.forEach(acheteur => {
        const option = document.createElement('option');
        option.value = acheteur.id;
        option.textContent = `${acheteur.prenom} ${acheteur.nom}`;
        acheteurSelect.appendChild(option);
        
        const filterOption = option.cloneNode(true);
        filterAcheteurSelect.appendChild(filterOption);
    });
}

// Load performances from API
async function loadPerformances(filters = {}) {
    try {
        const params = new URLSearchParams();
        if (filters.startDate) params.append('startDate', filters.startDate);
        if (filters.endDate) params.append('endDate', filters.endDate);
        if (filters.idAcheteur) params.append('idAcheteur', filters.idAcheteur);
        if (filters.bete) params.append('bete', filters.bete);
        
        const response = await fetch(`/api/performance-achat?${params.toString()}`, {
            credentials: 'include' // Include session cookies
        });
        const data = await response.json();
        
        if (data.success) {
            allPerformances = data.performances;
            displayPerformances(allPerformances);
            updateQuickStats(allPerformances);
            updatePeriodTotals(allPerformances);
        } else {
            showNotification('Erreur lors du chargement des performances', 'danger');
        }
    } catch (error) {
        console.error('Error loading performances:', error);
        showNotification('Erreur lors du chargement des performances', 'danger');
    }
}

// Display performances in table
function displayPerformances(performances) {
    const tbody = document.getElementById('performanceTableBody');
    
    if (performances.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" class="text-center">Aucune donnée disponible</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    
    performances.forEach(perf => {
        const row = document.createElement('tr');
        
        // Date
        const dateCell = document.createElement('td');
        dateCell.textContent = perf.date;
        row.appendChild(dateCell);
        
        // Acheteur
        const acheteurCell = document.createElement('td');
        acheteurCell.textContent = perf.acheteur_nom;
        row.appendChild(acheteurCell);
        
        // Type (Boeuf/Veau)
        const beteCell = document.createElement('td');
        beteCell.textContent = perf.bete.charAt(0).toUpperCase() + perf.bete.slice(1);
        row.appendChild(beteCell);
        
        // Prix
        const prixCell = document.createElement('td');
        if (perf.prix) {
            prixCell.innerHTML = `<strong>${perf.prix.toLocaleString('fr-FR')} FCFA</strong>`;
        } else {
            prixCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(prixCell);
        
        // Poids Estimé avec timestamp et date visible
        const poidsEstimeCell = document.createElement('td');
        if (perf.poids_estime) {
            const timestampDate = perf.poids_estime_timestamp ? formatTimestampWithDate(perf.poids_estime_timestamp) : null;
            poidsEstimeCell.innerHTML = `
                <strong>${perf.poids_estime.toFixed(2)} kg</strong>
                ${timestampDate ? `<br><small class="text-muted"><i class="fas fa-clock"></i> ${timestampDate.time}<br>${timestampDate.date}</small>` : ''}
            `;
            if (perf.poids_estime_timestamp) {
                poidsEstimeCell.title = `Modifié par ${perf.poids_estime_updated_by || 'Unknown'}`;
            }
        } else {
            poidsEstimeCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(poidsEstimeCell);
        
        // Poids Réel avec timestamp et date visible
        const poidsReelCell = document.createElement('td');
        if (perf.poids_reel) {
            const timestampDate = perf.poids_reel_timestamp ? formatTimestampWithDate(perf.poids_reel_timestamp) : null;
            poidsReelCell.innerHTML = `
                <strong>${perf.poids_reel.toFixed(2)} kg</strong>
                ${timestampDate ? `<br><small class="text-muted"><i class="fas fa-clock"></i> ${timestampDate.time}<br>${timestampDate.date}</small>` : ''}
            `;
            if (perf.poids_reel_timestamp) {
                poidsReelCell.title = `Modifié par ${perf.poids_reel_updated_by || 'Unknown'}`;
            }
        } else {
            poidsReelCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(poidsReelCell);
        
        // Prix/kg sans abats
        const prixKgCell = document.createElement('td');
        if (perf.prix && perf.poids_estime && perf.poids_estime !== 0) {
            const prixKg = perf.prix / perf.poids_estime;
            prixKgCell.innerHTML = `<strong>${prixKg.toFixed(2)} FCFA/kg</strong>`;
        } else {
            prixKgCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(prixKgCell);
        
        // Statut Achat (Bon/Acceptable/Mauvais)
        const statutAchatCell = document.createElement('td');
        if (perf.prix && perf.poids_estime && perf.poids_estime !== 0) {
            const prixKg = perf.prix / perf.poids_estime;
            const bete = perf.bete.toLowerCase();
            let statutBadge = document.createElement('span');
            statutBadge.className = 'badge';
            
            if (bete === 'boeuf') {
                if (prixKg <= 3200) {
                    statutBadge.classList.add('bg-success');
                    statutBadge.textContent = 'Bon';
                } else if (prixKg <= 3350) {
                    statutBadge.classList.add('bg-warning');
                    statutBadge.textContent = 'Acceptable';
                } else {
                    statutBadge.classList.add('bg-danger');
                    statutBadge.textContent = 'Mauvais';
                }
            } else if (bete === 'veau') {
                if (prixKg <= 3400) {
                    statutBadge.classList.add('bg-success');
                    statutBadge.textContent = 'Bon';
                } else if (prixKg <= 3550) {
                    statutBadge.classList.add('bg-warning');
                    statutBadge.textContent = 'Acceptable';
                } else {
                    statutBadge.classList.add('bg-danger');
                    statutBadge.textContent = 'Mauvais';
                }
            }
            
            statutAchatCell.appendChild(statutBadge);
        } else {
            statutAchatCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(statutAchatCell);
        
        // Écart
        const ecartCell = document.createElement('td');
        if (perf.ecart !== null) {
            ecartCell.textContent = `${perf.ecart >= 0 ? '+' : ''}${perf.ecart.toFixed(2)} kg`;
            ecartCell.className = perf.ecart > 0 ? 'text-danger' : (perf.ecart < 0 ? 'text-info' : 'text-success');
        } else {
            ecartCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(ecartCell);
        
        // Erreur (%) - anciennement Performance
        const erreurCell = document.createElement('td');
        if (perf.erreur !== null && perf.erreur !== undefined) {
            erreurCell.innerHTML = `<strong>${perf.erreur >= 0 ? '+' : ''}${perf.erreur.toFixed(2)}%</strong>`;
            erreurCell.className = perf.erreur > 0 ? 'text-danger' : (perf.erreur < 0 ? 'text-info' : 'text-success');
        } else {
            erreurCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(erreurCell);
        
        // Précision (%)
        const precisionCell = document.createElement('td');
        if (perf.precision !== null && perf.precision !== undefined) {
            precisionCell.innerHTML = `<strong>${perf.precision.toFixed(2)}%</strong>`;
            // Color code: green for high precision, yellow for medium, red for low
            if (perf.precision >= 95) {
                precisionCell.className = 'text-success';
            } else if (perf.precision >= 90) {
                precisionCell.className = 'text-warning';
            } else {
                precisionCell.className = 'text-danger';
            }
        } else {
            precisionCell.innerHTML = '<span class="text-muted">-</span>';
        }
        row.appendChild(precisionCell);
        
        // Type d'estimation
        const typeEstimationCell = document.createElement('td');
        if (perf.type_estimation) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = perf.type_estimation;
            
            if (perf.type_estimation === 'Surestimation') {
                badge.classList.add('badge-surestimation');
            } else if (perf.type_estimation === 'Sous-estimation') {
                badge.classList.add('badge-sous-estimation');
            } else {
                badge.classList.add('badge-parfait');
            }
            
            typeEstimationCell.appendChild(badge);
        } else {
            typeEstimationCell.textContent = '-';
        }
        row.appendChild(typeEstimationCell);
        
        // Cohérence
        const coherenceCell = document.createElement('td');
        if (perf.coherence) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = perf.coherence;
            
            if (perf.coherence === 'COHÉRENT') {
                badge.classList.add('badge-coherent');
            } else {
                badge.classList.add('badge-incoherent');
            }
            
            badge.title = `Somme achats: ${perf.somme_achats_kg} kg\nDifférence: ${perf.coherence_difference ? perf.coherence_difference.toFixed(2) : '0'} kg`;
            coherenceCell.appendChild(badge);
        } else {
            coherenceCell.textContent = '-';
        }
        row.appendChild(coherenceCell);
        
        // Actions
        const actionsCell = document.createElement('td');
        
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-sm btn-outline-primary mr-1';
        editBtn.innerHTML = '<i class="fas fa-edit"></i>';
        editBtn.title = 'Modifier';
        editBtn.onclick = () => editPerformance(perf);
        actionsCell.appendChild(editBtn);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-sm btn-outline-danger';
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = 'Supprimer';
        deleteBtn.onclick = () => deletePerformance(perf.id);
        actionsCell.appendChild(deleteBtn);
        
        row.appendChild(actionsCell);
        
        // Add click event to show details
        row.style.cursor = 'pointer';
        row.onclick = (e) => {
            // Don't show modal if clicking on buttons
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'I') return;
            showDetailModal(perf);
        };
        
        tbody.appendChild(row);
    });
}

// Update quick statistics
function updateQuickStats(performances) {
    let total = 0;
    let surestimation = 0;
    let sousEstimation = 0;
    let parfait = 0;
    
    performances.forEach(perf => {
        if (perf.type_estimation) {
            total++;
            if (perf.type_estimation === 'Surestimation') surestimation++;
            else if (perf.type_estimation === 'Sous-estimation') sousEstimation++;
            else if (perf.type_estimation === 'Parfait') parfait++;
        }
    });
    
    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-surestimation').textContent = surestimation;
    document.getElementById('stat-sous-estimation').textContent = sousEstimation;
    document.getElementById('stat-parfait').textContent = parfait;
}

// Update period totals (Poids Estimé, Poids Réel, and Écarts)
function updatePeriodTotals(performances) {
    let totalPoidsEstime = 0;
    let totalPoidsReel = 0;
    let totalEcart = 0;
    let totalEcartPositif = 0;
    let totalEcartNegatif = 0;
    
    // Calculate totals
    performances.forEach(perf => {
        if (perf.poids_estime) {
            totalPoidsEstime += parseFloat(perf.poids_estime);
        }
        if (perf.poids_reel) {
            totalPoidsReel += parseFloat(perf.poids_reel);
        }
        
        // Calculate écarts
        if (perf.ecart !== null && perf.ecart !== undefined) {
            const ecart = parseFloat(perf.ecart);
            totalEcart += ecart;
            
            if (ecart > 0) {
                totalEcartPositif += ecart;
            } else if (ecart < 0) {
                totalEcartNegatif += ecart;
            }
        }
    });
    
    // Format with thousands separator and kg unit
    const formatWeight = (weight) => {
        if (weight === 0) {
            return '0 kg';
        }
        return weight.toLocaleString('fr-FR', { 
            minimumFractionDigits: 0,
            maximumFractionDigits: 0 
        }) + ' kg';
    };
    
    // Format écart with sign
    const formatEcart = (ecart) => {
        if (ecart === 0) {
            return '0 kg';
        }
        const sign = ecart > 0 ? '+' : '';
        return sign + ecart.toLocaleString('fr-FR', { 
            minimumFractionDigits: 0,
            maximumFractionDigits: 0 
        }) + ' kg';
    };
    
    // Update DOM elements - Poids
    const estimeElement = document.getElementById('total-poids-estime');
    const reelElement = document.getElementById('total-poids-reel');
    
    if (estimeElement) {
        estimeElement.innerHTML = formatWeight(totalPoidsEstime);
    }
    if (reelElement) {
        reelElement.innerHTML = formatWeight(totalPoidsReel);
    }
    
    // Update DOM elements - Écarts
    const ecartElement = document.getElementById('total-ecart');
    const ecartPositifElement = document.getElementById('total-ecart-positif');
    const ecartNegatifElement = document.getElementById('total-ecart-negatif');
    
    if (ecartElement) {
        ecartElement.innerHTML = formatEcart(totalEcart);
    }
    if (ecartPositifElement) {
        ecartPositifElement.innerHTML = formatEcart(totalEcartPositif);
    }
    if (ecartNegatifElement) {
        ecartNegatifElement.innerHTML = formatEcart(totalEcartNegatif);
    }
}

// Load rankings
async function loadRankings() {
    try {
        let startDate = document.getElementById('filter-start-date').value;
        let endDate = document.getElementById('filter-end-date').value;
        
        // If no dates selected, use default (first day of month to today)
        if (!startDate || !endDate) {
            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            startDate = firstDayOfMonth.toISOString().split('T')[0];
            endDate = today.toISOString().split('T')[0];
        }
        
        const params = new URLSearchParams();
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        
        const response = await fetch(`/api/performance-achat/stats?${params.toString()}`, {
            credentials: 'include' // Include session cookies
        });
        const data = await response.json();
        
        if (data.success) {
            displayRankings(data.rankings);
        }
    } catch (error) {
        console.error('Error loading rankings:', error);
    }
}

// Display rankings
function displayRankings(rankings) {
    const container = document.getElementById('rankingContainer');
    
    if (rankings.length === 0) {
        container.innerHTML = '<p class="text-center">Aucun classement disponible</p>';
        return;
    }
    
    container.innerHTML = '';
    
    rankings.forEach((ranking, index) => {
        const rankingDiv = document.createElement('div');
        rankingDiv.className = 'd-flex justify-content-between align-items-center mb-3 p-3 bg-light rounded';
        rankingDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        
        const position = index + 1;
        const positionClass = position <= 3 ? `ranking-${position}` : '';
        
        rankingDiv.innerHTML = `
            <div class="d-flex align-items-center">
                <span class="ranking-position ${positionClass}" style="font-size: 2.5rem; min-width: 60px;">#${position}</span>
                <div class="ml-3">
                    <h5 class="mb-0" style="color: #000; font-weight: bold; font-size: 1.3rem;">${ranking.nom}</h5>
                    <small style="color: #333;">
                        ${ranking.total_estimations} estimation${ranking.total_estimations > 1 ? 's' : ''}
                    </small>
                </div>
            </div>
            <div class="text-right">
                <div style="color: #000; font-size: 1.5rem; font-weight: bold;">
                    ${ranking.score_moyen.toFixed(2)}/20
                </div>
                <small style="color: #28a745; font-weight: 600;">
                    Précision: ${ranking.precision_moyenne.toFixed(1)}%
                </small>
                <br>
                <small style="color: #333;">
                    <span style="color: #ffc107; font-weight: 600;">${ranking.total_surestimations} sur</span> | 
                    <span style="color: #17a2b8; font-weight: 600;">${ranking.total_sous_estimations} sous</span>
                </small>
            </div>
        `;
        
        container.appendChild(rankingDiv);
    });
}

// Handle form submit
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const formData = {
        date: document.getElementById('date').value,
        id_acheteur: document.getElementById('acheteur').value,
        bete: document.getElementById('bete').value,
        prix: parseFloat(document.getElementById('prix').value) || null,
        poids_estime: parseFloat(document.getElementById('poids-estime').value) || null,
        poids_reel: parseFloat(document.getElementById('poids-reel').value) || null,
        commentaire: document.getElementById('commentaire').value || null
    };
    
    try {
        let response;
        if (currentEditId) {
            // Update existing entry
            response = await fetch(`/api/performance-achat/${currentEditId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include', // Include session cookies
                body: JSON.stringify(formData)
            });
        } else {
            // Create new entry
            response = await fetch('/api/performance-achat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include', // Include session cookies
                body: JSON.stringify(formData)
            });
        }
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(result.message, 'success');
            resetForm();
            loadPerformances();
            loadRankings();
        } else {
            showNotification(result.error || 'Erreur lors de l\'enregistrement', 'danger');
        }
    } catch (error) {
        console.error('Error submitting form:', error);
        showNotification('Erreur lors de l\'enregistrement', 'danger');
    }
}

// Handle filter submit
function handleFilterSubmit(e) {
    e.preventDefault();
    
    const filters = {
        startDate: document.getElementById('filter-start-date').value,
        endDate: document.getElementById('filter-end-date').value,
        idAcheteur: document.getElementById('filter-acheteur').value,
        bete: document.getElementById('filter-bete').value
    };
    
    loadPerformances(filters);
    loadRankings();
}

// Edit performance
function editPerformance(perf) {
    currentEditId = perf.id;
    
    document.getElementById('date').value = perf.date;
    document.getElementById('acheteur').value = perf.id_acheteur;
    document.getElementById('bete').value = perf.bete;
    document.getElementById('prix').value = perf.prix || '';
    document.getElementById('poids-estime').value = perf.poids_estime || '';
    document.getElementById('poids-reel').value = perf.poids_reel || '';
    document.getElementById('commentaire').value = perf.commentaire || '';
    
    // Show timestamps if available
    if (perf.poids_estime_timestamp) {
        document.getElementById('poids-estime-timestamp').textContent = 
            `Modifié: ${formatTimestamp(perf.poids_estime_timestamp)} par ${perf.poids_estime_updated_by}`;
    }
    if (perf.poids_reel_timestamp) {
        document.getElementById('poids-reel-timestamp').textContent = 
            `Modifié: ${formatTimestamp(perf.poids_reel_timestamp)} par ${perf.poids_reel_updated_by}`;
    }
    
    document.getElementById('cancelEdit').style.display = 'block';
    document.querySelector('#performanceForm button[type="submit"]').innerHTML = 
        '<i class="fas fa-save"></i> Mettre à jour';
    
    // Scroll to form
    document.getElementById('performanceForm').scrollIntoView({ behavior: 'smooth' });
}

// Cancel edit
function cancelEdit() {
    resetForm();
}

// Reset form
function resetForm() {
    currentEditId = null;
    document.getElementById('performanceForm').reset();
    document.getElementById('entry-id').value = '';
    document.getElementById('poids-estime-timestamp').textContent = '';
    document.getElementById('poids-reel-timestamp').textContent = '';
    document.getElementById('cancelEdit').style.display = 'none';
    document.querySelector('#performanceForm button[type="submit"]').innerHTML = 
        '<i class="fas fa-save"></i> Enregistrer';
    
    // Reset date picker to today
    const datePicker = document.getElementById('date')._flatpickr;
    if (datePicker) {
        datePicker.setDate(new Date());
    }
}

// Delete performance
async function deletePerformance(id) {
    const ok = await showConfirmModal('Êtes-vous sûr de vouloir supprimer cette entrée ?', {
        title: 'Supprimer', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (!ok) {
        return;
    }
    
    try {
        const response = await fetch(`/api/performance-achat/${id}`, {
            method: 'DELETE',
            credentials: 'include' // Include session cookies
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification('Entrée supprimée avec succès', 'success');
            loadPerformances();
            loadRankings();
        } else {
            showNotification(result.error || 'Erreur lors de la suppression', 'danger');
        }
    } catch (error) {
        console.error('Error deleting performance:', error);
        showNotification('Erreur lors de la suppression', 'danger');
    }
}

// Show detail modal
function showDetailModal(perf) {
    const modalBody = document.getElementById('detailModalBody');
    
    modalBody.innerHTML = `
        <div class="row">
            <div class="col-md-6">
                <h6><i class="fas fa-info-circle"></i> Informations Générales</h6>
                <table class="table table-sm">
                    <tr><th>Date:</th><td>${perf.date}</td></tr>
                    <tr><th>Acheteur:</th><td>${perf.acheteur_nom}</td></tr>
                    <tr><th>Type:</th><td>${perf.bete.charAt(0).toUpperCase() + perf.bete.slice(1)}</td></tr>
                    <tr><th>Créé par:</th><td>${perf.created_by || '-'}</td></tr>
                    <tr><th>Créé le:</th><td>${formatTimestamp(perf.created_at)}</td></tr>
                </table>
            </div>
            <div class="col-md-6">
                <h6><i class="fas fa-weight"></i> Poids</h6>
                <table class="table table-sm">
                    <tr><th>Poids Estimé:</th><td>${perf.poids_estime ? perf.poids_estime.toFixed(2) + ' kg' : '-'}</td></tr>
                    ${perf.poids_estime_timestamp ? `<tr><td colspan="2" class="small text-muted">Modifié: ${formatTimestamp(perf.poids_estime_timestamp)} par ${perf.poids_estime_updated_by}</td></tr>` : ''}
                    <tr><th>Poids Réel:</th><td>${perf.poids_reel ? perf.poids_reel.toFixed(2) + ' kg' : '-'}</td></tr>
                    ${perf.poids_reel_timestamp ? `<tr><td colspan="2" class="small text-muted">Modifié: ${formatTimestamp(perf.poids_reel_timestamp)} par ${perf.poids_reel_updated_by}</td></tr>` : ''}
                </table>
            </div>
        </div>
        <div class="row">
            <div class="col-md-6">
                <h6><i class="fas fa-chart-line"></i> Performance</h6>
                <table class="table table-sm">
                    <tr><th>Écart:</th><td>${perf.ecart !== null ? (perf.ecart >= 0 ? '+' : '') + perf.ecart.toFixed(2) + ' kg' : '-'}</td></tr>
                    <tr><th>Performance:</th><td>${perf.performance !== null ? (perf.performance >= 0 ? '+' : '') + perf.performance.toFixed(2) + '%' : '-'}</td></tr>
                    <tr><th>Type:</th><td>${perf.type_estimation || '-'}</td></tr>
                    <tr><th>Score Pénalisé:</th><td>${perf.score_penalite !== null ? perf.score_penalite.toFixed(2) : '-'}</td></tr>
                </table>
            </div>
            <div class="col-md-6">
                <h6><i class="fas fa-check-circle"></i> Cohérence</h6>
                <table class="table table-sm">
                    <tr><th>Statut:</th><td><span class="badge ${perf.coherence === 'COHÉRENT' ? 'badge-coherent' : 'badge-incoherent'}">${perf.coherence || '-'}</span></td></tr>
                    <tr><th>Somme Achats:</th><td>${perf.somme_achats_kg !== null ? perf.somme_achats_kg.toFixed(2) + ' kg' : '-'}</td></tr>
                    <tr><th>Différence:</th><td>${perf.coherence_difference !== null ? (perf.coherence_difference >= 0 ? '+' : '') + perf.coherence_difference.toFixed(2) + ' kg' : '-'}</td></tr>
                </table>
            </div>
        </div>
        ${perf.commentaire ? `
        <div class="row">
            <div class="col-12">
                <h6><i class="fas fa-comment"></i> Commentaire</h6>
                <p class="border p-2 rounded">${perf.commentaire}</p>
            </div>
        </div>
        ` : ''}
    `;
    
    $('#detailModal').modal('show');
}

// Export to Excel
function exportToExcel() {
    if (allPerformances.length === 0) {
        showNotification('Aucune donnée à exporter', 'warning');
        return;
    }
    
    const exportData = allPerformances.map(perf => ({
        'Date': perf.date,
        'Acheteur': perf.acheteur_nom,
        'Type': perf.bete.charAt(0).toUpperCase() + perf.bete.slice(1),
        'Poids Estimé (kg)': perf.poids_estime || '',
        'Poids Réel (kg)': perf.poids_reel || '',
        'Écart (kg)': perf.ecart !== null ? perf.ecart.toFixed(2) : '',
        'Performance (%)': perf.performance !== null ? perf.performance.toFixed(2) : '',
        'Type Estimation': perf.type_estimation || '',
        'Cohérence': perf.coherence || '',
        'Somme Achats (kg)': perf.somme_achats_kg !== null ? perf.somme_achats_kg.toFixed(2) : '',
        'Commentaire': perf.commentaire || ''
    }));
    
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Performance Achat');
    
    const filename = `performance_achat_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);
    
    showNotification('Export Excel réussi', 'success');
}

// Format timestamp (long format)
function formatTimestamp(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('fr-FR');
}

// Format timestamp (short format for table)
function formatTimestampShort(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
        // Aujourd'hui - afficher l'heure
        return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        return 'Hier ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
        return `Il y a ${diffDays}j`;
    } else {
        // Afficher la date complète
        return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    }
}

// Format timestamp with date in YYYY-MM-DD format
function formatTimestampWithDate(timestamp) {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    // Format date as YYYY-MM-DD
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    let timeStr;
    if (diffDays === 0) {
        // Aujourd'hui - afficher l'heure
        timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
        timeStr = 'Hier ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
        timeStr = `Il y a ${diffDays}j - ` + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } else {
        timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    
    return {
        time: timeStr,
        date: dateStr
    };
}

// Show notification
function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show`;
    notification.innerHTML = `
        ${message}
        <button type="button" class="close" data-dismiss="alert">
            <span>&times;</span>
        </button>
    `;
    
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// ============================================================================
// VEILLE ACTUALITÉS BÉTAIL
// ============================================================================

async function showVeilleBetail() {
    // Show modal
    $('#veilleBetailModal').modal('show');
    
    // Reset content to loading state
    document.getElementById('veilleBetailContent').innerHTML = `
        <div class="text-center">
            <div class="spinner-border text-info" role="status">
                <span class="sr-only">Chargement...</span>
            </div>
            <p class="mt-2">Analyse des actualités en cours...</p>
            <small class="text-muted">
                Scan des sources Régionales (Mali, Mauritanie, Sénégal) + Internationales (3 dernières semaines) + Analyse IA
            </small>
        </div>
    `;
    document.getElementById('veilleBetailMeta').textContent = '';
    
    try {
        const response = await fetch('/api/veille-betail', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            displayVeilleBetail(data);
        } else {
            throw new Error(data.error || 'Erreur inconnue');
        }
    } catch (error) {
        console.error('Error fetching veille data:', error);
        document.getElementById('veilleBetailContent').innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle"></i> 
                <strong>Erreur:</strong> ${error.message}
            </div>
        `;
    }
}

function displayVeilleBetail(data) {
    const content = document.getElementById('veilleBetailContent');
    const meta = document.getElementById('veilleBetailMeta');
    
    // Meta information
    const timestamp = new Date(data.timestamp).toLocaleString('fr-FR');
    const cacheInfo = data.cached ? ` (Cache: expire dans ${data.cache_expires_in})` : ' (Données fraîches)';
    meta.textContent = `Dernière mise à jour: ${timestamp}${cacheInfo} | ${data.articles_count} articles analysés`;
    
    let html = '';
    
    // Date statistics (if available)
    if (data.date_stats) {
        const dateStats = data.date_stats;
        const freshnessClass = dateStats.average_article_age_days <= 2 ? 'success' : 
                              dateStats.average_article_age_days <= 5 ? 'info' : 'warning';
        
        html += `
            <div class="alert alert-${freshnessClass} border-${freshnessClass}">
                <h6 class="alert-heading">
                    <i class="fas fa-calendar-check"></i> Période d'Analyse
                </h6>
                <div class="row text-center">
                    <div class="col-4">
                        <strong>${dateStats.newest_article_age_days}</strong><br>
                        <small>Plus récent (jours)</small>
                    </div>
                    <div class="col-4">
                        <strong>${dateStats.average_article_age_days}</strong><br>
                        <small>Moyenne (jours)</small>
                    </div>
                    <div class="col-4">
                        <strong>${dateStats.oldest_article_age_days}</strong><br>
                        <small>Plus ancien (jours)</small>
                    </div>
                </div>
                <small class="d-block mt-2 text-center">
                    <i class="fas fa-filter"></i> ${dateStats.coverage_period}
                </small>
            </div>
        `;
    }
    
    // Contexte général
    if (data.contexte) {
        html += `
            <div class="alert alert-light border">
                <h6 class="alert-heading"><i class="fas fa-globe"></i> Contexte Général</h6>
                <p class="mb-0">${data.contexte}</p>
            </div>
        `;
    }
    
    // Alertes
    if (data.alertes && data.alertes.length > 0) {
        html += '<h5 class="mt-3 mb-3"><i class="fas fa-exclamation-circle"></i> Alertes</h5>';
        data.alertes.forEach(alerte => {
            const alertClass = alerte.niveau === 'critique' ? 'danger' : 
                             alerte.niveau === 'warning' ? 'warning' : 'info';
            const icon = alerte.niveau === 'critique' ? 'fa-exclamation-triangle' : 
                        alerte.niveau === 'warning' ? 'fa-exclamation-circle' : 'fa-info-circle';
            
            // Badge de catégorie
            const categorieBadge = alerte.categorie === 'international' ? 
                '<span class="badge badge-primary mr-2"><i class="fas fa-globe"></i> International</span>' : 
                '<span class="badge badge-secondary mr-2"><i class="fas fa-map-marker-alt"></i> Régional</span>';
            
            html += `
                <div class="alert alert-${alertClass}">
                    <h6 class="alert-heading">
                        <i class="fas ${icon}"></i> ${alerte.titre}
                        ${alerte.date_relative ? `<span class="badge badge-light float-right"><i class="fas fa-clock"></i> ${alerte.date_relative}</span>` : ''}
                    </h6>
                    <div class="mb-2">${categorieBadge}</div>
                    <p class="mb-1">${alerte.description}</p>
                    <small><strong>Impact:</strong> ${alerte.impact}</small>
                    ${alerte.source_link ? `<br><small><a href="${alerte.source_link}" target="_blank" class="text-decoration-none"><i class="fas fa-external-link-alt"></i> Lire l'article source</a></small>` : ''}
                </div>
            `;
        });
    } else {
        html += `
            <div class="alert alert-success mt-3">
                <i class="fas fa-check-circle"></i> Aucune alerte critique identifiée
            </div>
        `;
    }
    
    // Section Internationale (NOUVEAU)
    if (data.international && (data.international.resume || (data.international.articles_pertinents && data.international.articles_pertinents.length > 0))) {
        html += `
            <div class="mt-4 mb-3">
                <h5><i class="fas fa-globe text-primary"></i> Contexte International</h5>
                <div class="card border-primary">
                    <div class="card-body">
                        ${data.international.resume ? `<p class="mb-3">${data.international.resume}</p>` : ''}
                        ${data.international.articles_pertinents && data.international.articles_pertinents.length > 0 ? `
                            <h6 class="mb-2"><i class="fas fa-newspaper"></i> Articles Pertinents:</h6>
                            <ul class="list-unstyled">
                                ${data.international.articles_pertinents.map(article => `
                                    <li class="mb-2">
                                        <strong>${article.titre}</strong>
                                        ${article.lien ? `<br><a href="${article.lien}" target="_blank" class="text-primary"><i class="fas fa-external-link-alt"></i> Lire l'article</a>` : ''}
                                        ${article.impact ? `<br><small class="text-muted">Impact: ${article.impact}</small>` : ''}
                                    </li>
                                `).join('')}
                            </ul>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }
    
    // Tendances
    if (data.tendances && data.tendances.length > 0) {
        html += '<h5 class="mt-4 mb-3"><i class="fas fa-chart-line"></i> Tendances du Marché</h5>';
        html += '<div class="row">';
        
        data.tendances.forEach(tendance => {
            const typeIcon = tendance.type === 'prix' ? 'fa-money-bill-wave' : 
                           tendance.type === 'climat' ? 'fa-cloud-sun' : 
                           tendance.type === 'reglementation' ? 'fa-gavel' : 
                           tendance.type === 'marche_international' ? 'fa-globe' :
                           tendance.type === 'epidemie' ? 'fa-virus' : 'fa-info';
            const typeColor = tendance.type === 'prix' ? 'success' : 
                            tendance.type === 'climat' ? 'warning' : 
                            tendance.type === 'reglementation' ? 'danger' : 
                            tendance.type === 'marche_international' ? 'primary' :
                            tendance.type === 'epidemie' ? 'danger' : 'info';
            
            // Badge de catégorie
            const categorieBadge = tendance.categorie === 'international' ? 
                '<span class="badge badge-primary badge-sm"><i class="fas fa-globe"></i> International</span>' : 
                '<span class="badge badge-secondary badge-sm"><i class="fas fa-map-marker-alt"></i> Régional</span>';
            
            html += `
                <div class="col-md-6 mb-3">
                    <div class="card border-${typeColor}">
                        <div class="card-body">
                            <h6 class="card-title">
                                <i class="fas ${typeIcon} text-${typeColor}"></i> 
                                ${tendance.type.charAt(0).toUpperCase() + tendance.type.slice(1).replace('_', ' ')}
                            </h6>
                            <div class="mb-2">${categorieBadge}</div>
                            <p class="card-text">${tendance.description}</p>
                            <small class="text-muted"><strong>Impact prévu:</strong> ${tendance.impact_previsionnel}</small>
                        </div>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
    }
    
    // Recommandations
    if (data.recommandations && data.recommandations.length > 0) {
        html += '<h5 class="mt-4 mb-3"><i class="fas fa-lightbulb"></i> Recommandations</h5>';
        html += '<ul class="list-group">';
        
        data.recommandations.forEach(rec => {
            html += `
                <li class="list-group-item">
                    <i class="fas fa-arrow-right text-primary"></i> ${rec}
                </li>
            `;
        });
        
        html += '</ul>';
    }
    
    // Sources
    if (data.articles_sources && data.articles_sources.length > 0) {
        html += `
            <div class="mt-4">
                <small class="text-muted">
                    <i class="fas fa-newspaper"></i> Sources consultées: ${data.articles_sources.join(', ')}
                </small>
            </div>
        `;
    }
    
    content.innerHTML = html;
}

