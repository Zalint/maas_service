// Global variables to hold chart instances
let boeufChartInstance = null;
let veauChartInstance = null;
// Global variable to hold all fetched data
let allAchatsData = [];

document.addEventListener('DOMContentLoaded', function() {
    // Check user permissions and adjust UI accordingly
    checkUserPermissions();
    
    // Initialize UI components
    initUI();
    
    // Load existing data on page load
    loadAchatsBoeuf();
    
    // Set up event listeners
    document.getElementById('achatBoeufForm').addEventListener('submit', handleFormSubmit);
    
    // Set up import functionality
    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
        importBtn.addEventListener('click', importCsv);
    }

    // Add listeners for add/save buttons if they exist in this section
    const addRowBtn = document.getElementById('add-achat-boeuf-row');
    if (addRowBtn) {
        addRowBtn.addEventListener('click', addEmptyRowToTable); // Assuming a function like this exists or needs to be created
    }
    const saveBtn = document.getElementById('save-achat-boeuf');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveTableData); // Assuming a function like this exists or needs to be created
    }

    // Add event listener for Excel export button
    const exportBtn = document.getElementById('export-achat-boeuf-excel');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToExcel);
    }

    // Add event listeners for automatic calculation of prix_achat_kg_sans_abats
    const prixInput = document.getElementById('prix');
    const nbrKgInput = document.getElementById('nbrKg');
    
    if (prixInput && nbrKgInput) {
        prixInput.addEventListener('input', calculatePrixKgSansAbats);
        nbrKgInput.addEventListener('input', calculatePrixKgSansAbats);
    }
});

// Function to check user permissions and adjust UI
async function checkUserPermissions() {
    try {
        const response = await fetch('/api/check-session');
        const data = await response.json();
        
        if (data.success && data.user) {
            const user = data.user;
            
            // If user is a reader (lecteur), hide write-related elements
            if (user.role === 'lecteur') {
                // Hide the save button
                const saveButton = document.querySelector('button[type="submit"]');
                if (saveButton) {
                    saveButton.style.display = 'none';
                }
                
                // Hide the import button
                const importBtn = document.getElementById('importBtn');
                if (importBtn) {
                    importBtn.style.display = 'none';
                }
                
                // Disable form inputs for read-only access
                const formInputs = document.querySelectorAll('#achatBoeufForm input, #achatBoeufForm select');
                formInputs.forEach(input => {
                    input.disabled = true;
                });
                
                // Add a message indicating read-only mode
                const form = document.getElementById('achatBoeufForm');
                if (form) {
                    const readOnlyMessage = document.createElement('div');
                    readOnlyMessage.className = 'alert alert-info mt-3';
                    readOnlyMessage.innerHTML = '<strong>Mode lecture seule :</strong> Vous pouvez consulter les données mais ne pouvez pas les modifier.';
                    form.appendChild(readOnlyMessage);
                }
            }
        }
    } catch (error) {
        console.error('Erreur lors de la vérification des permissions:', error);
    }
}

// Initialize UI components like datepickers
function initUI() {
    // Initialize datepicker for the main form
    const dateInput = document.getElementById('date');
    if (typeof flatpickr !== 'undefined' && dateInput) {
        flatpickr(dateInput, {
            dateFormat: "Y-m-d",
            allowInput: true,
            defaultDate: "today" // Set today's date as default
        });
    } else if (dateInput) {
        const today = new Date();
        const formattedDate = today.toISOString().split('T')[0];
        dateInput.value = formattedDate;
    }

    // Initialize datepickers for the filters
    const dateDebutInput = document.getElementById('achat-date-debut');
    const dateFinInput = document.getElementById('achat-date-fin');

    const commonFlatpickrOptions = {
        dateFormat: "Y-m-d",
        allowInput: true,
        onChange: function(selectedDates, dateStr, instance) {
            // When a date changes, re-filter and display the data
            filterAndDisplayData(); 
        }
    };

    if (typeof flatpickr !== 'undefined') {
        if (dateDebutInput) {
            flatpickr(dateDebutInput, commonFlatpickrOptions);
        }
        if (dateFinInput) {
            flatpickr(dateFinInput, commonFlatpickrOptions);
        }
    } // No fallback needed for filters as they'll be set after data load

    // Set current month as default in 'mois' input
    const moisInput = document.getElementById('mois');
    if (moisInput) {
        const today = new Date();
        const month = today.toLocaleString('fr-FR', { month: 'long' });
        moisInput.value = month.charAt(0).toUpperCase() + month.slice(1);
    }

    // Add event listeners for automatic Prix par Kg calculation
    const prixInput = document.getElementById('prix');
    const fraisAbattageInput = document.getElementById('fraisAbattage');
    const nbrKgInput = document.getElementById('nbrKg');
    
    if (prixInput && fraisAbattageInput && nbrKgInput) {
        [prixInput, fraisAbattageInput, nbrKgInput].forEach(input => {
            input.addEventListener('input', calculateAndSetPrixKg);
        });
    }
}

// Function to calculate and set Prix par Kg based on form inputs
function calculateAndSetPrixKg() {
    const prix = parseFloat(document.getElementById('prix').value) || 0;
    const fraisAbattage = parseFloat(document.getElementById('fraisAbattage').value) || 0;
    const nbrKg = parseFloat(document.getElementById('nbrKg').value);
    const prixKgInput = document.getElementById('prixAchatKg');

    if (prixKgInput && !isNaN(nbrKg) && nbrKg !== 0) {
        const prixAchatKg = (prix + fraisAbattage) / nbrKg;
        prixKgInput.value = prixAchatKg.toFixed(2);
    } else if (prixKgInput) {
        prixKgInput.value = ''; // Clear if Nbr Kg is zero or invalid
    }
}

// Load existing beef purchase data
async function loadAchatsBoeuf() {
    try {
        const response = await fetch('/api/achats-boeuf', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch data');
        }
        
        allAchatsData = await response.json(); // Store all data globally

        // Determine min and max dates from the data
        if (allAchatsData.length > 0) {
            const dates = allAchatsData.map(a => new Date(a.date));
            const minDate = new Date(Math.min.apply(null, dates));
            const maxDate = new Date(Math.max.apply(null, dates));

            // Set initial filter dates
            const dateDebutInput = document.getElementById('achat-date-debut');
            const dateFinInput = document.getElementById('achat-date-fin');
            const minDateStr = minDate.toISOString().split('T')[0];
            const maxDateStr = maxDate.toISOString().split('T')[0];

            if (typeof flatpickr !== 'undefined') {
                 dateDebutInput?._flatpickr.setDate(minDateStr, false); // Set without triggering onChange
                 dateFinInput?._flatpickr.setDate(maxDateStr, false);
            } else {
                if(dateDebutInput) dateDebutInput.value = minDateStr;
                if(dateFinInput) dateFinInput.value = maxDateStr;
            }
        } else {
             // Clear filter inputs if no data
             document.getElementById('achat-date-debut').value = '';
             document.getElementById('achat-date-fin').value = '';
        }

        // Initial display using the full (or default) date range
        filterAndDisplayData(); 
        
    } catch (error) {
        console.error('Error loading data:', error);
        showNotification('Erreur lors du chargement des données de suivi', 'error');
        allAchatsData = []; // Clear data on error
        filterAndDisplayData(); // Display empty state
    }
}

// Extract filtering logic to reusable function
function getFilteredData() {
    const dateDebutStr = document.getElementById('achat-date-debut')?.value;
    const dateFinStr = document.getElementById('achat-date-fin')?.value;
    
    let filteredData = allAchatsData;
    
    if (dateDebutStr && dateFinStr) {
        try {
            // Add time component to ensure inclusivity
            const startDate = new Date(dateDebutStr + 'T00:00:00');
            const endDate = new Date(dateFinStr + 'T23:59:59');

            if (!isNaN(startDate) && !isNaN(endDate)) {
                 filteredData = allAchatsData.filter(achat => {
                    const achatDate = new Date(achat.date + 'T00:00:00'); // Compare dates only
                    return !isNaN(achatDate) && achatDate >= startDate && achatDate <= endDate;
                });
            }
        } catch (e) {
            console.error("Error parsing filter dates:", e);
             showNotification("Erreur dans les dates de filtre.", "warning");
        }
    } else if (dateDebutStr) {
        // Filter only by start date
         try {
            const startDate = new Date(dateDebutStr + 'T00:00:00');
             if (!isNaN(startDate)) {
                filteredData = allAchatsData.filter(achat => {
                     const achatDate = new Date(achat.date + 'T00:00:00');
                     return !isNaN(achatDate) && achatDate >= startDate;
                 });
             }
         } catch (e) { console.error("Error parsing start date:", e); }
    } else if (dateFinStr) {
         // Filter only by end date
        try {
            const endDate = new Date(dateFinStr + 'T23:59:59');
            if (!isNaN(endDate)) {
                 filteredData = allAchatsData.filter(achat => {
                     const achatDate = new Date(achat.date + 'T00:00:00');
                     return !isNaN(achatDate) && achatDate <= endDate;
                 });
            }
        } catch (e) { console.error("Error parsing end date:", e); }
    }
    
    return filteredData;
}

// Filter data based on selected dates and update display
function filterAndDisplayData() {
    const filteredData = getFilteredData();

    // Pass the filtered data to display functions
    displayAchatsBoeuf(filteredData);
    calculateAndDisplayStats(filteredData);
    createPriceEvolutionCharts(filteredData);
}

// Display beef purchase data in a table
function displayAchatsBoeuf(achats) {
    const tableBody = document.getElementById('achat-boeuf-table-body');
    tableBody.innerHTML = '';
    
    if (achats.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `<td colspan="10" class="text-center">Aucune donnée disponible</td>`;
        tableBody.appendChild(emptyRow);
        return;
    }
    
    achats.forEach(achat => {
        const row = document.createElement('tr');
        
        // Format currency values
        const prixFormatted = parseFloat(achat.prix).toFixed(2) + ' FCFA';
        const abatsFormatted = parseFloat(achat.abats).toFixed(2) + ' FCFA';
        const fraisFormatted = parseFloat(achat.frais_abattage).toFixed(2) + ' FCFA';
        const prixKg = parseFloat(achat.prix_achat_kg);
        const prixKgFormatted = prixKg.toFixed(2) + ' FCFA/kg';
        const prixKgSansAbats = parseFloat(achat.prix_achat_kg_sans_abats || 0);
        const prixKgSansAbatsFormatted = prixKgSansAbats.toFixed(2) + ' FCFA/kg';

        // Check for weight inconsistencies
        const nbrKg = parseFloat(achat.nbr_kg);
        const beteType = achat.bete.toLowerCase();
        let backgroundColor = '';
        let rowTitle = '';
        
        if (beteType === 'boeuf' && nbrKg <= 125) {
            backgroundColor = 'rgba(255, 165, 0, 0.3)'; // Orange light
            rowTitle = 'Attention: Poids faible pour un boeuf (≤125 kg). Vérifiez s\'il ne s\'agit pas plutôt d\'un veau.';
        } else if (beteType === 'veau' && nbrKg >= 125) {
            backgroundColor = 'rgba(173, 216, 230, 0.5)'; // Blue light
            rowTitle = 'Attention: Poids élevé pour un veau (≥125 kg). Vérifiez s\'il ne s\'agit pas plutôt d\'un boeuf.';
        }
        
        if (backgroundColor) {
            row.title = rowTitle;
            row.style.cursor = 'help';
        }

        // Determine status based on bete and prix_achat_kg
        let statusHtml = '';
        
        if (beteType === 'boeuf') {
            if (prixKg <= 3200) {
                statusHtml = '<span class="badge bg-success">Bon</span>'; // Green stick
            } else if (prixKg >= 3201 && prixKg <= 3350) {
                statusHtml = '<span class="badge bg-warning">Acceptable</span>'; // Yellow stick
            } else if (prixKg > 3350) { // Changed from 3351 as per condition > 3350
                statusHtml = '<span class="badge bg-danger">Mauvais</span>'; // Red stick
            }
        } else if (beteType === 'veau') {
            if (prixKg <= 3400) {
                statusHtml = '<span class="badge bg-success">Bon</span>'; // Green stick
            } else if (prixKg >= 3401 && prixKg <= 3550) { // Changed from 34001 as it seemed like a typo
                statusHtml = '<span class="badge bg-warning">Acceptable</span>'; // Yellow stick
            } else if (prixKg > 3550) { // Changed from 3551 as per condition > 3550
                statusHtml = '<span class="badge bg-danger">Mauvais</span>'; // Red stick
            }
        }
        
        const cellStyle = backgroundColor ? `style="background-color: ${backgroundColor} !important;"` : '';
        
        row.innerHTML = `
            <td ${cellStyle}>${achat.mois || '-'}</td>
            <td ${cellStyle}>${achat.date}</td>
            <td ${cellStyle}>${achat.bete}</td>
            <td class="text-end" ${cellStyle}>${prixFormatted}</td>
            <td class="text-end" ${cellStyle}>${abatsFormatted}</td>
            <td class="text-end" ${cellStyle}>${fraisFormatted}</td>
            <td class="text-end" ${cellStyle}>${achat.nbr_kg} kg</td>
            <td class="text-end" ${cellStyle}>${prixKgFormatted}</td>
            <td class="text-end" ${cellStyle}>${prixKgSansAbatsFormatted}</td>
            <td ${cellStyle}>
                <button class="btn btn-sm btn-outline-primary edit-btn" data-id="${achat.id}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${achat.id}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
            <td ${cellStyle}>${statusHtml}</td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Add event listeners to the edit and delete buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            editAchatBoeuf(id, achats);
        });
    });
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            deleteAchatBoeuf(id);
        });
    });
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    // Check if user is a reader and prevent submission
    try {
        const response = await fetch('/api/check-session');
        const data = await response.json();
        
        if (data.success && data.user && data.user.role === 'lecteur') {
            showNotification('Accès refusé : Mode lecture seule', 'error');
            return;
        }
    } catch (error) {
        console.error('Erreur lors de la vérification des permissions:', error);
        return;
    }
    
    // Get form data
    const formData = {
        mois: document.getElementById('mois').value,
        date: document.getElementById('date').value,
        bete: document.getElementById('bete').value,
        prix: parseFloat(document.getElementById('prix').value) || 0,
        abats: parseFloat(document.getElementById('abats').value) || 0,
        frais_abattage: parseFloat(document.getElementById('fraisAbattage').value) || 0,
        nbr_kg: parseFloat(document.getElementById('nbrKg').value) || 0,
        prix_achat_kg: 0,
        prix_achat_kg_sans_abats: 0
    };

    // Calculate prix_achat_kg = (prix - abats + frais_abattage) / nbr_kg
    if (formData.nbr_kg !== 0) {
        formData.prix_achat_kg = (formData.prix - formData.abats + formData.frais_abattage) / formData.nbr_kg;
        // Update the input field visually as well
        const prixKgInput = document.getElementById('prixAchatKg');
        if(prixKgInput) {
             prixKgInput.value = formData.prix_achat_kg.toFixed(2);
        }
    } else {
         const prixKgInput = document.getElementById('prixAchatKg');
         if(prixKgInput) {
             prixKgInput.value = ''; // Clear if kg is 0
         }
    }

    // Calculate prix_achat_kg_sans_abats = prix / nbr_kg (sans abats ni frais)
    if (formData.nbr_kg !== 0) {
        formData.prix_achat_kg_sans_abats = formData.prix / formData.nbr_kg;
        // Update the input field visually as well
        const prixKgSansAbatsInput = document.getElementById('prixAchatKgSansAbats');
        if(prixKgSansAbatsInput) {
             prixKgSansAbatsInput.value = formData.prix_achat_kg_sans_abats.toFixed(2);
        }
    } else {
         const prixKgSansAbatsInput = document.getElementById('prixAchatKgSansAbats');
         if(prixKgSansAbatsInput) {
             prixKgSansAbatsInput.value = ''; // Clear if kg is 0
         }
    }
    
    try {
        const response = await fetch('/api/achats-boeuf', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save data');
        }
        
        const result = await response.json();
        
        // Reset form and reload data
        document.getElementById('achatBoeufForm').reset();
        initUI(); // Reset default values
        
        showNotification('Données sauvegardées avec succès', 'success');
        
        // Reload ALL data and let filtering handle the display
        loadAchatsBoeuf();
    } catch (error) {
        console.error('Error:', error);
        showNotification('Erreur: ' + error.message, 'error');
    }
}

// Helper function to calculate Mean
function calculateMean(arr) {
    if (!arr || arr.length === 0) return 0;
    const sum = arr.reduce((a, b) => a + b, 0);
    return sum / arr.length;
}

// Helper function to calculate Median
function calculateMedian(arr) {
    if (!arr || arr.length === 0) return 0;
    const sortedArr = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sortedArr.length / 2);
    return sortedArr.length % 2 !== 0 ? sortedArr[mid] : (sortedArr[mid - 1] + sortedArr[mid]) / 2;
}

// Helper function to calculate Standard Deviation
function calculateStdDev(arr) {
    if (!arr || arr.length === 0) return 0;
    const mean = calculateMean(arr);
    const variance = arr.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

// Calculate and display statistics for Boeuf and Veau
function calculateAndDisplayStats(achats) {
    const boeufData = achats.filter(a => a.bete.toLowerCase() === 'boeuf');
    const veauData = achats.filter(a => a.bete.toLowerCase() === 'veau');

    const boeufPrices = boeufData.map(a => parseFloat(a.prix_achat_kg)).filter(p => !isNaN(p));
    const veauPrices = veauData.map(a => parseFloat(a.prix_achat_kg)).filter(p => !isNaN(p));
    
    // Prix sans abats
    const boeufPricesSansAbats = boeufData.map(a => parseFloat(a.prix_achat_kg_sans_abats || 0)).filter(p => !isNaN(p) && p > 0);
    const veauPricesSansAbats = veauData.map(a => parseFloat(a.prix_achat_kg_sans_abats || 0)).filter(p => !isNaN(p) && p > 0);

    // Boeuf Stats (avec abats)
    const boeufMean = calculateMean(boeufPrices);
    const boeufMedian = calculateMedian(boeufPrices);
    const boeufStdDev = calculateStdDev(boeufPrices);
    document.getElementById('boeuf-mean').textContent = boeufPrices.length > 0 ? boeufMean.toFixed(2) : 'N/A';
    document.getElementById('boeuf-median').textContent = boeufPrices.length > 0 ? boeufMedian.toFixed(2) : 'N/A';
    document.getElementById('boeuf-stddev').textContent = boeufPrices.length > 0 ? boeufStdDev.toFixed(2) : 'N/A';

    // Veau Stats (avec abats)
    const veauMean = calculateMean(veauPrices);
    const veauMedian = calculateMedian(veauPrices);
    const veauStdDev = calculateStdDev(veauPrices);
    document.getElementById('veau-mean').textContent = veauPrices.length > 0 ? veauMean.toFixed(2) : 'N/A';
    document.getElementById('veau-median').textContent = veauPrices.length > 0 ? veauMedian.toFixed(2) : 'N/A';
    document.getElementById('veau-stddev').textContent = veauPrices.length > 0 ? veauStdDev.toFixed(2) : 'N/A';

    // Boeuf Stats (sans abats)
    const boeufMeanSansAbats = calculateMean(boeufPricesSansAbats);
    const boeufMedianSansAbats = calculateMedian(boeufPricesSansAbats);
    const boeufStdDevSansAbats = calculateStdDev(boeufPricesSansAbats);
    document.getElementById('boeuf-mean-sans-abats').textContent = boeufPricesSansAbats.length > 0 ? boeufMeanSansAbats.toFixed(2) : 'N/A';
    document.getElementById('boeuf-median-sans-abats').textContent = boeufPricesSansAbats.length > 0 ? boeufMedianSansAbats.toFixed(2) : 'N/A';
    document.getElementById('boeuf-stddev-sans-abats').textContent = boeufPricesSansAbats.length > 0 ? boeufStdDevSansAbats.toFixed(2) : 'N/A';

    // Veau Stats (sans abats)
    const veauMeanSansAbats = calculateMean(veauPricesSansAbats);
    const veauMedianSansAbats = calculateMedian(veauPricesSansAbats);
    const veauStdDevSansAbats = calculateStdDev(veauPricesSansAbats);
    document.getElementById('veau-mean-sans-abats').textContent = veauPricesSansAbats.length > 0 ? veauMeanSansAbats.toFixed(2) : 'N/A';
    document.getElementById('veau-median-sans-abats').textContent = veauPricesSansAbats.length > 0 ? veauMedianSansAbats.toFixed(2) : 'N/A';
    document.getElementById('veau-stddev-sans-abats').textContent = veauPricesSansAbats.length > 0 ? veauStdDevSansAbats.toFixed(2) : 'N/A';
    // === NOUVELLES STATISTIQUES DÉTAILLÉES ===
    
    // Nombre de bêtes
    const nombreBoeufs = boeufData.length;
    const nombreVeaux = veauData.length;
    const nombreTotal = nombreBoeufs + nombreVeaux;
    
    const setBeteCounts = (elementId, value) => {
        const element = document.getElementById(elementId);
        if (element) element.textContent = value;
    };
    
    setBeteCounts('nombre-boeufs', nombreBoeufs);
    setBeteCounts('nombre-veaux', nombreVeaux);
    setBeteCounts('nombre-total', nombreTotal);

    // Calculs des poids
    const poidsBoeuf = boeufData.map(a => {
        const poids = parseFloat(a.nbr_kg);
        return isNaN(poids) ? 0 : poids;
    });
    const poidsVeau = veauData.map(a => {
        const poids = parseFloat(a.nbr_kg);
        return isNaN(poids) ? 0 : poids;
    });
    const poidsTousAnimaux = achats.map(a => {
        const poids = parseFloat(a.nbr_kg);
        return isNaN(poids) ? 0 : poids;
    });
    
    const poidsTotal = poidsTousAnimaux.reduce((sum, poids) => sum + poids, 0);
    const poidsMoyenGlobal = nombreTotal > 0 ? poidsTotal / nombreTotal : 0;
    const poidsMoyenBoeuf = nombreBoeufs > 0
      ? poidsBoeuf.reduce((sum, poids) => sum + poids, 0) / nombreBoeufs
      : 0;
    const poidsMoyenVeau = nombreVeaux > 0
      ? poidsVeau.reduce((sum, poids) => sum + poids, 0) / nombreVeaux
      : 0;
    
    document.getElementById('poids-total').textContent = poidsTotal.toFixed(2);
    document.getElementById('poids-moyen').textContent = poidsMoyenGlobal.toFixed(2);
    document.getElementById('poids-moyen-boeuf').textContent = poidsMoyenBoeuf.toFixed(2);
    document.getElementById('poids-moyen-veau').textContent = poidsMoyenVeau.toFixed(2);

    // Prix totaux
    const prixTotalAbats = achats.reduce((sum, a) => sum + (parseFloat(a.abats) || 0), 0);
    const fraisAbattageTotal = achats.reduce((sum, a) => sum + (parseFloat(a.frais_abattage) || 0), 0);
    const prixTotalAchat = achats.reduce((sum, a) => sum + (parseFloat(a.prix) || 0), 0);
    
    document.getElementById('prix-total-abats').textContent = prixTotalAbats.toLocaleString('fr-FR');
    document.getElementById('frais-abattage-total').textContent = fraisAbattageTotal.toLocaleString('fr-FR');
    document.getElementById('prix-total-achat').textContent = prixTotalAchat.toLocaleString('fr-FR');

    // Prix moyens par bête
    const prixTotalBoeuf = boeufData.reduce((sum, a) => sum + (parseFloat(a.prix) || 0), 0);
    const prixTotalVeau = veauData.reduce((sum, a) => sum + (parseFloat(a.prix) || 0), 0);
    
    const prixMoyenBoeuf = nombreBoeufs > 0 ? prixTotalBoeuf / nombreBoeufs : 0;
    const prixMoyenVeau = nombreVeaux > 0 ? prixTotalVeau / nombreVeaux : 0;
    const prixMoyenGlobal = nombreTotal > 0 ? prixTotalAchat / nombreTotal : 0;
    
    document.getElementById('prix-moyen-boeuf').textContent = prixMoyenBoeuf.toLocaleString('fr-FR');
    document.getElementById('prix-moyen-veau').textContent = prixMoyenVeau.toLocaleString('fr-FR');
    document.getElementById('prix-moyen-global').textContent = prixMoyenGlobal.toLocaleString('fr-FR');

    // === NOUVELLES STATISTIQUES SANS ABATS ===
    
    // Prix moyens par kg sans abats
    const prixMoyenKgBoeufSansAbats = boeufPricesSansAbats.length > 0 ? boeufMeanSansAbats : 0;
    const prixMoyenKgVeauSansAbats = veauPricesSansAbats.length > 0 ? veauMeanSansAbats : 0;
    const prixMoyenKgGlobalSansAbats = (boeufPricesSansAbats.length + veauPricesSansAbats.length) > 0 
        ? (boeufMeanSansAbats * boeufPricesSansAbats.length + veauMeanSansAbats * veauPricesSansAbats.length) / (boeufPricesSansAbats.length + veauPricesSansAbats.length) 
        : 0;
    
    document.getElementById('prix-moyen-kg-boeuf-sans-abats').textContent = prixMoyenKgBoeufSansAbats.toFixed(2);
    document.getElementById('prix-moyen-kg-veau-sans-abats').textContent = prixMoyenKgVeauSansAbats.toFixed(2);
    document.getElementById('prix-moyen-kg-global-sans-abats').textContent = prixMoyenKgGlobalSansAbats.toFixed(2);

    // Calcul des économies (différence entre prix avec et sans abats)
    const economieKgBoeuf = boeufPrices.length > 0 && boeufPricesSansAbats.length > 0 ? boeufMean - boeufMeanSansAbats : 0;
    const economieKgVeau = veauPrices.length > 0 && veauPricesSansAbats.length > 0 ? veauMean - veauMeanSansAbats : 0;
    
    // Économie totale (basée sur le poids total)
    const economieTotale = (economieKgBoeuf * poidsBoeuf.reduce((sum, poids) => sum + poids, 0)) + 
                          (economieKgVeau * poidsVeau.reduce((sum, poids) => sum + poids, 0));
    
    document.getElementById('economie-kg-boeuf').textContent = economieKgBoeuf.toFixed(2);
    document.getElementById('economie-kg-veau').textContent = economieKgVeau.toFixed(2);
    document.getElementById('economie-totale').textContent = economieTotale.toLocaleString('fr-FR');
}

// Create price evolution charts for Boeuf and Veau
function createPriceEvolutionCharts(achats) {
    if (typeof Chart === 'undefined') {
        console.error("Chart.js is not loaded.");
        return;
    }

    const boeufData = achats.filter(a => a.bete.toLowerCase() === 'boeuf').sort((a, b) => new Date(a.date) - new Date(b.date));
    const veauData = achats.filter(a => a.bete.toLowerCase() === 'veau').sort((a, b) => new Date(a.date) - new Date(b.date));

    const boeufLabels = boeufData.map(a => a.date);
    const boeufPrices = boeufData.map(a => parseFloat(a.prix_achat_kg));
    const boeufPricesSansAbats = boeufData.map(a => parseFloat(a.prix_achat_kg_sans_abats || 0));

    const veauLabels = veauData.map(a => a.date);
    const veauPrices = veauData.map(a => parseFloat(a.prix_achat_kg));
    const veauPricesSansAbats = veauData.map(a => parseFloat(a.prix_achat_kg_sans_abats || 0));

    // Destroy previous charts if they exist
    if (boeufChartInstance) {
        boeufChartInstance.destroy();
    }
    if (veauChartInstance) {
        veauChartInstance.destroy();
    }

    // Create Boeuf Chart
    const boeufCtx = document.getElementById('boeufPrixKgChart')?.getContext('2d');
    if (boeufCtx) {
        boeufChartInstance = new Chart(boeufCtx, {
            type: 'line',
            data: {
                labels: boeufLabels,
                datasets: [{
                    label: 'Prix Achat/kg (avec abats)',
                    data: boeufPrices,
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.1)',
                    tension: 0.1
                }, {
                    label: 'Prix Achat/kg (sans abats)',
                    data: boeufPricesSansAbats,
                    borderColor: 'rgb(255, 159, 64)',
                    backgroundColor: 'rgba(255, 159, 64, 0.1)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: { display: true, text: 'Évolution Prix/kg Boeuf' },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.raw.toFixed(2)} FCFA/kg` } }
                },
                scales: { y: { beginAtZero: false, title: { display: true, text: 'Prix/kg (FCFA)'} } }
            }
        });
    } else {
        console.error("Boeuf chart canvas not found");
    }


    // Create Veau Chart
    const veauCtx = document.getElementById('veauPrixKgChart')?.getContext('2d');
     if (veauCtx) {
        veauChartInstance = new Chart(veauCtx, {
            type: 'line',
            data: {
                labels: veauLabels,
                datasets: [{
                    label: 'Prix Achat/kg (avec abats)',
                    data: veauPrices,
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    tension: 0.1
                }, {
                    label: 'Prix Achat/kg (sans abats)',
                    data: veauPricesSansAbats,
                    borderColor: 'rgb(54, 162, 235)',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    tension: 0.1
                }]
            },
            options: {
                 responsive: true,
                plugins: {
                    title: { display: true, text: 'Évolution Prix/kg Veau' },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.raw.toFixed(2)} FCFA/kg` } }
                },
                scales: { y: { beginAtZero: false, title: { display: true, text: 'Prix/kg (FCFA)'} } }
            }
        });
     } else {
         console.error("Veau chart canvas not found");
     }
}

// Function to edit an existing entry
async function editAchatBoeuf(id, achats) {
    // Check if user is a reader and prevent editing
    try {
        const response = await fetch('/api/check-session');
        const data = await response.json();
        
        if (data.success && data.user && data.user.role === 'lecteur') {
            showNotification('Accès refusé : Mode lecture seule', 'error');
            return;
        }
    } catch (error) {
        console.error('Erreur lors de la vérification des permissions:', error);
        return;
    }
    
    const achat = achats.find(a => a.id === parseInt(id));
    
    if (!achat) {
        showNotification('Entrée non trouvée', 'error');
        return;
    }
    
    // Fill the form with the existing data
    document.getElementById('mois').value = achat.mois || '';
    document.getElementById('date').value = achat.date;
    document.getElementById('bete').value = achat.bete;
    document.getElementById('prix').value = achat.prix;
    document.getElementById('abats').value = achat.abats;
    document.getElementById('fraisAbattage').value = achat.frais_abattage;
    document.getElementById('nbrKg').value = achat.nbr_kg;
    document.getElementById('prixAchatKg').value = achat.prix_achat_kg;
    
    // Optionally, scroll to the form
    document.getElementById('achatBoeufForm').scrollIntoView({ behavior: 'smooth' });
    
    // Focus on the first field
    document.getElementById('mois').focus();
    
    showNotification('Modifiez les données et soumettez à nouveau', 'info');
}

// Function to delete an entry
async function deleteAchatBoeuf(id) {
    // Check if user is a reader and prevent deletion
    try {
        const response = await fetch('/api/check-session');
        const data = await response.json();
        
        if (data.success && data.user && data.user.role === 'lecteur') {
            showNotification('Accès refusé : Mode lecture seule', 'error');
            return;
        }
    } catch (error) {
        console.error('Erreur lors de la vérification des permissions:', error);
        return;
    }
    
    const ok = await showConfirmModal('Êtes-vous sûr de vouloir supprimer cette entrée ?', {
        title: 'Supprimer', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (!ok) {
        return;
    }
    
    try {
        const response = await fetch(`/api/achats-boeuf/${id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to delete entry');
        }
        
        showNotification('Entrée supprimée avec succès', 'success');
        
        // Reload ALL data and let filtering handle the display
        loadAchatsBoeuf();
    } catch (error) {
        console.error('Error:', error);
        showNotification('Erreur lors de la suppression', 'error');
    }
}

// Show notification
function showNotification(message, type = 'info') {
    // Check if we have a notification container
    let container = document.getElementById('notificationContainer');
    
    if (!container) {
        // Create container if it doesn't exist
        container = document.createElement('div');
        container.id = 'notificationContainer';
        container.style.position = 'fixed';
        container.style.top = '20px';
        container.style.right = '20px';
        container.style.zIndex = '1000';
        document.body.appendChild(container);
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show`;
    notification.innerHTML = `
        ${message}
        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
            <span aria-hidden="true">&times;</span>
        </button>
    `;
    
    // Add to container
    container.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
    
    // Add click handler to close button
    notification.querySelector('.close').addEventListener('click', () => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    });
}

// Function to import CSV data
async function importCsv() {
    // Check if user is a reader and prevent import
    try {
        const response = await fetch('/api/check-session');
        const data = await response.json();
        
        if (data.success && data.user && data.user.role === 'lecteur') {
            showNotification('Accès refusé : Mode lecture seule', 'error');
            return;
        }
    } catch (error) {
        console.error('Erreur lors de la vérification des permissions:', error);
        return;
    }
    
    const fileInput = document.getElementById('csvFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showNotification('Veuillez sélectionner un fichier CSV', 'warning');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const content = e.target.result;
            const lines = content.split(/\r\n|\n/); // Handle different line endings
            
            // Skip header row if it exists (more robust check)
            const headerPattern = /Mois;Date;Bete;Prix;Abats;Frais abatage;Nbr kg/i;
            const startIndex = headerPattern.test(lines[0]) ? 1 : 0;
            
            const entries = [];
            for (let i = startIndex; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const columns = line.split(';');
                // Expecting at least 7 columns (Mois to Nbr kg), 8th (Prix/kg) is optional/calculated
                if (columns.length < 7) {
                     console.warn(`Skipping invalid CSV line ${i + 1}: Not enough columns (${columns.length})`);
                     continue; // Skip lines that don't have enough columns
                }
                
                // Parse the CSV line
                const entry = {
                    mois: columns[0].trim(),
                    date: formatDate(columns[1].trim()), // Ensure date is formatted correctly
                    bete: columns[2].trim(),
                    prix: parseFloat(columns[3].replace(',', '.')) || 0, // Handle comma decimal separator
                    abats: parseFloat(columns[4].replace(',', '.')) || 0,
                    frais_abattage: parseFloat(columns[5].replace(',', '.')) || 0,
                    nbr_kg: parseFloat(columns[6].replace(',', '.')) || 0,
                    prix_achat_kg: 0 // Initialize, will be calculated
                };

                // Calculate prix_achat_kg if nbr_kg is valid
                if (entry.nbr_kg !== 0) {
                    entry.prix_achat_kg = (entry.prix - entry.abats + entry.frais_abattage) / entry.nbr_kg;
                } else if (columns.length > 7 && columns[7].trim() !== '') {
                    // Fallback to using provided value if calculation isn't possible but value exists
                    entry.prix_achat_kg = parseFloat(columns[7].replace(',', '.')) || 0;
                }

                // Basic validation
                if (!entry.date) {
                     console.warn(`Skipping invalid CSV line ${i + 1}: Invalid or missing date`);
                     continue;
                }
                 if (!entry.bete || (entry.bete.toLowerCase() !== 'boeuf' && entry.bete.toLowerCase() !== 'veau')) {
                     console.warn(`Skipping invalid CSV line ${i + 1}: Invalid or missing 'bete' value (${entry.bete})`);
                     continue;
                 }
                
                entries.push(entry);
            }
            
            if (entries.length === 0) {
                showNotification('Aucune donnée valide trouvée dans le fichier CSV', 'warning');
                return;
            }
            
            // Import each entry
            showNotification(`Importation de ${entries.length} entrées en cours...`, 'info');
            let successCount = 0;
            let errorCount = 0;
            const errors = [];

            // Use Promise.all for potentially faster imports (if backend supports concurrent requests)
            // Note: Depending on the backend, this might overload it.
            // Consider sequential import if issues arise.
            /*
            const importPromises = entries.map((entry, index) =>
                fetch('/api/achats-boeuf', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(entry)
                })
                .then(response => {
                    if (response.ok) {
                        successCount++;
                    } else {
                        errorCount++;
                        const csvLineNumber = startIndex + index + 1;
                        return response.json().then(errorData => {
                             errors.push(`Ligne ${csvLineNumber}: ${errorData.error || response.statusText}`);
                        }).catch(() => {
                             errors.push(`Ligne ${csvLineNumber}: Erreur ${response.status} - ${response.statusText}`);
                        });
                    }
                })
                .catch(err => {
                    errorCount++;
                    const csvLineNumber = startIndex + index + 1;
                    errors.push(`Ligne ${csvLineNumber}: Erreur réseau ou de traitement (${err.message})`);
                })
            );

            await Promise.all(importPromises);
            */

           // Sequential import (safer for many backends)
           for (let i = 0; i < entries.length; i++) {
               const entry = entries[i];
               const csvLineNumber = startIndex + i + 1;
               try {
                   const response = await fetch('/api/achats-boeuf', {
                       method: 'POST',
                       headers: {
                           'Content-Type': 'application/json'
                       },
                       body: JSON.stringify(entry)
                   });

                   if (response.ok) {
                       successCount++;
                   } else {
                       errorCount++;
                       try{
                            const errorData = await response.json();
                            errors.push(`Ligne ${csvLineNumber}: ${errorData.error || response.statusText}`);
                            console.error(`Failed to import row ${csvLineNumber}:`, errorData);
                       } catch (jsonError) {
                            errors.push(`Ligne ${csvLineNumber}: Erreur ${response.status} - ${response.statusText}`);
                            console.error(`Failed to import row ${csvLineNumber}, status: ${response.status}`);
                       }
                   }
               } catch (err) {
                   errorCount++;
                   errors.push(`Ligne ${csvLineNumber}: Erreur réseau ou de traitement (${err.message})`);
                   console.error(`Error importing row ${csvLineNumber}:`, err);
               }
           }
            
            if (errorCount > 0) {
                 // Display only first few errors if list is long
                 const displayedErrors = errors.slice(0, 5).join('<br>- ');
                 const moreErrors = errors.length > 5 ? `<br>... et ${errors.length - 5} autres erreurs (voir console)` : '';
                 showNotification(
                     `${successCount} entrées importées. ${errorCount} erreurs: <br>- ${displayedErrors}${moreErrors}`,
                     'warning'
                 );
            } else {
                 showNotification(`${successCount} entrées importées avec succès`, 'success');
            }
           
            // Reload ALL data and let filtering handle the display
            loadAchatsBoeuf();
            
            // Reset file input
            fileInput.value = '';
        } catch (error) {
            console.error('Error processing CSV:', error);
            showNotification('Erreur lors du traitement du CSV: ' + error.message, 'error');
        }
    };
    
    reader.onerror = function() {
        showNotification('Erreur de lecture du fichier CSV', 'error');
    };
    
    reader.readAsText(file, 'UTF-8'); // Specify encoding if needed
}

// Format date from DD/MM/YYYY or other formats to YYYY-MM-DD for backend
function formatDate(dateStr) {
    if (!dateStr) return '';
    
    // Check if date is already in correct format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }
    
    // Handle DD/MM/YYYY format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        return `${year}-${month}-${day}`;
    }
    
    // Handle other formats
    try {
        const date = new Date(dateStr);
        return date.toISOString().split('T')[0];
    } catch (e) {
        console.error('Invalid date format:', dateStr);
        return '';
    }
}

// Placeholder functions for potential table interactions (if needed)
function addEmptyRowToTable() {
    console.warn("addEmptyRowToTable function not implemented yet.");
    // Logic to add a new, empty row to the 'achat-boeuf-table-body'
    // This might involve creating input fields within table cells.
}

function saveTableData() {
    console.warn("saveTableData function not implemented yet.");
    // Logic to collect data from all editable rows in 'achat-boeuf-table-body'
    // and send it to the backend (likely via multiple POST/PUT requests).
}

// Function to export filtered data to Excel
function exportToExcel() {
    try {
        // Check if XLSX library is loaded
        if (typeof XLSX === 'undefined') {
            console.error("Erreur: La bibliothèque XLSX n'est pas chargée.");
            showNotification('Bibliothèque XLSX non disponible. Veuillez recharger la page.', 'error');
            return;
        }

        // Get filtered data
        const filteredData = getFilteredData();

        if (filteredData.length === 0) {
            showNotification('Aucune donnée à exporter pour la période sélectionnée', 'warning');
            return;
        }

        // Prepare data for Excel export
        const exportData = filteredData.map(achat => ({
            'Mois': achat.mois || '',
            'Date': achat.date,
            'Bête': achat.bete,
            'Prix': parseFloat(achat.prix) || 0,
            'Abats': parseFloat(achat.abats) || 0,
            'Frais Abattage': parseFloat(achat.frais_abattage) || 0,
            'Nombre Kg': parseFloat(achat.nbr_kg) || 0,
            'Prix Achat/Kg': parseFloat(achat.prix_achat_kg) || 0
        }));

        // Calculate summary statistics for the period
        const boeufData = filteredData.filter(a => a.bete.toLowerCase() === 'boeuf');
        const veauData = filteredData.filter(a => a.bete.toLowerCase() === 'veau');
        
        const nombreBoeufs = boeufData.length;
        const nombreVeaux = veauData.length;
        const nombreTotal = nombreBoeufs + nombreVeaux;
        
        const poidsTotal = filteredData.reduce((sum, a) => sum + (parseFloat(a.nbr_kg) || 0), 0);
        const prixTotalAchat = filteredData.reduce((sum, a) => sum + (parseFloat(a.prix) || 0), 0);
        const prixTotalAbats = filteredData.reduce((sum, a) => sum + (parseFloat(a.abats) || 0), 0);
        const fraisAbattageTotal = filteredData.reduce((sum, a) => sum + (parseFloat(a.frais_abattage) || 0), 0);
        
        const prixMoyenBoeuf = nombreBoeufs > 0 ? boeufData.reduce((sum, a) => sum + (parseFloat(a.prix) || 0), 0) / nombreBoeufs : 0;
        const prixMoyenVeau = nombreVeaux > 0 ? veauData.reduce((sum, a) => sum + (parseFloat(a.prix) || 0), 0) / nombreVeaux : 0;

        // Add summary data at the end
        exportData.push({}); // Empty row separator
        exportData.push({ 'Mois': 'RÉSUMÉ PÉRIODE', 'Date': '', 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });
        exportData.push({ 'Mois': 'Nombre de bœufs:', 'Date': nombreBoeufs, 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });
        exportData.push({ 'Mois': 'Nombre de veaux:', 'Date': nombreVeaux, 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });
        exportData.push({ 'Mois': 'Total bêtes:', 'Date': nombreTotal, 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });
        exportData.push({ 'Mois': 'Poids total (kg):', 'Date': poidsTotal.toFixed(2), 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });
        exportData.push({ 'Mois': 'Prix total achat:', 'Date': prixTotalAchat.toFixed(2), 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });
        exportData.push({ 'Mois': 'Prix total abats:', 'Date': prixTotalAbats.toFixed(2), 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });
        exportData.push({ 'Mois': 'Frais abattage total:', 'Date': fraisAbattageTotal.toFixed(2), 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });
        exportData.push({ 'Mois': 'Prix moyen bœuf:', 'Date': prixMoyenBoeuf.toFixed(2), 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });
        exportData.push({ 'Mois': 'Prix moyen veau:', 'Date': prixMoyenVeau.toFixed(2), 'Bête': '', 'Prix': '', 'Abats': '', 'Frais Abattage': '', 'Nombre Kg': '', 'Prix Achat/Kg': '' });

        // Create workbook and worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportData);

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Achats Boeuf');

        // Generate filename with date range
        let filename = 'achats_boeuf';
        const dateDebutStr = document.getElementById('achat-date-debut')?.value;
        const dateFinStr = document.getElementById('achat-date-fin')?.value;
        if (dateDebutStr && dateFinStr) {
            filename += `_${dateDebutStr}_${dateFinStr}`;
        } else if (dateDebutStr) {
            filename += `_depuis_${dateDebutStr}`;
        } else if (dateFinStr) {
            filename += `_jusqu_${dateFinStr}`;
        } else {
            filename += '_toutes_donnees';
        }
        filename += '.xlsx';

        // Save the file
        XLSX.writeFile(workbook, filename);

        showNotification(`Export Excel réussi : ${filteredData.length} entrées exportées`, 'success');

    } catch (error) {
        console.error('Error exporting to Excel:', error);
        showNotification('Erreur lors de l\'export Excel : ' + error.message, 'error');
    }
}

// Function to calculate prix_achat_kg_sans_abats automatically
function calculatePrixKgSansAbats() {
    const prixInput = document.getElementById('prix');
    const nbrKgInput = document.getElementById('nbrKg');
    const prixKgSansAbatsInput = document.getElementById('prixAchatKgSansAbats');
    
    if (prixInput && nbrKgInput && prixKgSansAbatsInput) {
        const prix = parseFloat(prixInput.value) || 0;
        const nbrKg = parseFloat(nbrKgInput.value) || 0;
        
        if (nbrKg > 0) {
            const prixKgSansAbats = prix / nbrKg;
            prixKgSansAbatsInput.value = prixKgSansAbats.toFixed(2);
        } else {
            prixKgSansAbatsInput.value = '';
        }
    }
}