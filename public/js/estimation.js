// Estimation functions

// Remove any existing event listeners when the file loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('=== ESTIMATION.JS INITIALIZATION START ===');
    
    // Only initialize once
    if (window.estimationInitialized) {
        console.log('Estimation already initialized, skipping');
        return;
    }
    
    // Find the estimation form
    const form = document.getElementById('estimation-form');
    if (!form) {
        console.warn('Estimation form not found, will try again when section becomes visible');
        
        // Set up a mutation observer to detect when the form becomes available
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'attributes' && 
                    mutation.attributeName === 'style' && 
                    mutation.target.id === 'estimation-section' &&
                    mutation.target.style.display !== 'none') {
                    
                    console.log('Estimation section became visible, initializing');
                    const form = document.getElementById('estimation-form');
                    if (form && !window.estimationInitialized) {
                        initializeEstimationForm(form);
                    }
                }
            });
        });
        
        // Start observing the estimation section
        const estimationSection = document.getElementById('estimation-section');
        if (estimationSection) {
            observer.observe(estimationSection, { attributes: true });
        }
        
        return;
    }
    
    // If form is found, initialize it
    initializeEstimationForm(form);
    
    console.log('=== ESTIMATION.JS INITIALIZATION END ===');
});

// Function to properly initialize the estimation form
function initializeEstimationForm(form) {
    console.log('Initializing estimation form');
    
    // Mark as initialized to prevent duplicate initialization
    window.estimationInitialized = true;
    
    // Get form elements
    const dateInput = document.getElementById('estimation-date');
    const pointVenteSelect = document.getElementById('estimation-point-vente');
    const categorieSelect = document.getElementById('estimation-categorie');
    
    // Initialize date input
    if (dateInput) {
        initializeDateInput(dateInput);
    }
    
    // Charge les catégories depuis produitsInventaire
    chargerProduits();
    
    // Set up form submission handler
    form.addEventListener('submit', handleFormSubmission);
    
    // Set up input handlers
    setupInputHandlers();
    
    // Initialize the threshold slider
    initThresholdSlider();
    
    // Load data based on current selections
    loadData();
    
    console.log('Estimation form initialized successfully');
}

// Function to load products from produitsInventaire and populate the table
function chargerProduits() {
    try {
        // Charger les produits dans le tableau
        chargerTableauProduits();
        
        console.log('Products loaded successfully in table format');
    } catch (error) {
        console.error('Erreur lors du chargement des produits:', error);
    }
}

// Function to populate the products table
function chargerTableauProduits() {
    const tbody = document.getElementById('estimation-products-tbody');
    if (!tbody) {
        console.error('Element estimation-products-tbody not found');
        return;
    }
    
    // Vider le tableau
    tbody.innerHTML = '';
    
    // Vérifier si produitsInventaire est disponible
    if (window.produitsInventaire && typeof window.produitsInventaire.getTousLesProduits === 'function') {
        const allProduits = window.produitsInventaire.getTousLesProduits();
        
        // Produits par défaut à afficher
        const produitsParDefaut = ['Boeuf', 'Veau', 'Agneau', 'Foie', 'Yell', 'Poulet'];
        
        // Vérifier l'état du bouton "Afficher Tous"
        const showAllBtn = document.getElementById('show-all-products-btn');
        const showAll = showAllBtn && showAllBtn.dataset.showAll === 'true';
        
        // Filtrer les produits selon l'état
        const produits = showAll ? allProduits : allProduits.filter(produit => produitsParDefaut.includes(produit));
        
        produits.forEach(produit => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="text-start fw-medium">${produit}</td>
                <td class="text-center">
                    <div class="input-group input-group-sm">
                        <input type="number" 
                               class="form-control text-center prevision-input" 
                               data-produit="${produit}"
                               step="0.001" 
                               min="0" 
                               value="0"
                               placeholder="0">
                        <select class="form-select prevision-unit-select" data-produit="${produit}" style="max-width: 80px;">
                            <option value="kg">kg</option>
                            <option value="unite">unité</option>
                        </select>
                    </div>
                </td>
                <td class="text-center">
                    <div class="input-group input-group-sm">
                        <input type="number" 
                               class="form-control text-center precommande-input" 
                               data-produit="${produit}"
                               step="0.001" 
                               min="0" 
                               value="0"
                               placeholder="0">
                        <select class="form-select precommande-unit-select" data-produit="${produit}" style="max-width: 80px;">
                            <option value="kg">kg</option>
                            <option value="unite">unité</option>
                        </select>
                    </div>
                </td>
                <td class="text-center">
                    <input type="text" 
                           class="form-control form-control-sm commentaire-input" 
                           data-produit="${produit}"
                           placeholder="Commentaire optionnel..."
                           maxlength="255">
                </td>
            `;
            tbody.appendChild(row);
            
            // Les conversions seront affichées seulement dans la popup de confirmation
        });
        
        console.log(`Loaded ${produits.length} products in table`);
        
        // Mettre à jour le texte du bouton selon l'état
        if (showAllBtn) {
            showAllBtn.textContent = showAll ? '📋 Afficher Essentiels' : '📊 Afficher Tous';
            showAllBtn.title = showAll ? 'Afficher seulement les produits essentiels' : 'Afficher tous les produits';
        }
    } else {
        // Tentative de rechargement différé
        let tentatives = 0;
        const maxTentatives = 5;
        const intervalleVerification = setInterval(() => {
            tentatives++;
            
            if (window.produitsInventaire && typeof window.produitsInventaire.getTousLesProduits === 'function') {
                console.log('produitsInventaire chargé avec succès après', tentatives, 'tentative(s)');
                chargerTableauProduits();
                clearInterval(intervalleVerification);
            } else if (tentatives >= maxTentatives) {
                console.error('produitsInventaire toujours non disponible après', maxTentatives, 'tentatives');
                
                // Afficher un message d'erreur dans le tableau
                tbody.innerHTML = `
                    <tr>
                        <td colspan="3" class="text-center text-danger p-4">
                            <i class="bi bi-exclamation-triangle"></i><br>
                            Erreur: Impossible de charger la liste des produits<br>
                            <small>Veuillez recharger la page ou contacter l'administrateur</small>
                        </td>
                    </tr>
                `;
                
                clearInterval(intervalleVerification);
            }
        }, 500);
    }
}

// Function to initialize date input - handles flatpickr errors gracefully
function initializeDateInput(dateInput) {
    console.log('Initializing date input');
    
    // Get today's date in the correct format
    const today = new Date();
    const formattedDate = formatDateForInput(today);
    
    // Try to initialize flatpickr, but with fallbacks
    if (typeof flatpickr === 'function') {
        try {
            // Try with default locale
            flatpickr(dateInput, {
                dateFormat: 'd-m-Y',
                defaultDate: today,
                allowInput: true
            });
            console.log('Flatpickr initialized successfully');
        } catch (e) {
            console.warn('Error initializing flatpickr with default locale:', e);
            
            try {
                // Try again without locale
                flatpickr(dateInput, {
                    dateFormat: 'd-m-Y',
                    defaultDate: today,
                    allowInput: true,
                    locale: null
                });
                console.log('Flatpickr initialized without locale');
            } catch (e2) {
                console.error('Failed to initialize flatpickr:', e2);
                // Fallback: set date value directly
                dateInput.value = formattedDate;
                console.log('Using fallback date input');
            }
        }
    } else {
        // Flatpickr not available, set date directly
        dateInput.value = formattedDate;
        console.log('Flatpickr not available, using direct date input');
    }
    
    // Ensure the date is set correctly
    if (!dateInput.value) {
        dateInput.value = formattedDate;
    }
}

// Function to handle form submission
async function handleFormSubmission(e) {
    e.preventDefault();
    
    // Prevent multiple submissions
    if (window.estimationSubmissionInProgress) {
        console.log('Form submission already in progress');
        return;
    }
    
    // Mark as in progress
    window.estimationSubmissionInProgress = true;
    
    // Disable the submit button
    const submitButton = this.querySelector('button[type="submit"]');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Enregistrement...';
    }
    
    try {
        // Collecter les données et afficher le popup de validation
        await afficherPopupValidation();
        console.log('Form submitted successfully');
    } catch (error) {
        console.error('Error during form submission:', error);
    } finally {
        // Re-enable the button
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = '<i class="bi bi-check-circle"></i> Enregistrer l\'estimation';
        }
        
        // Clear the in-progress flag
        window.estimationSubmissionInProgress = false;
    }
}

// Function to set up input event handlers
function setupInputHandlers() {
    // Form selection fields
    const dateInput = document.getElementById('estimation-date');
    const pointVenteSelect = document.getElementById('estimation-point-vente');
    const weightParamsBtn = document.getElementById('weight-params-btn');
    const saveWeightParamsBtn = document.getElementById('save-weight-params-btn');
    
    // Add event listeners for selection fields
    if (dateInput) {
        dateInput.addEventListener('change', () => {
            console.log('Date changed:', dateInput.value);
            chargerParametresPoids(); // Charger les paramètres pour la nouvelle date
        });
    }
    if (pointVenteSelect) {
        pointVenteSelect.addEventListener('change', () => {
            console.log('Point de vente changed:', pointVenteSelect.value);
        });
    }
    
    // Event listeners pour les paramètres de poids
    if (weightParamsBtn) {
        weightParamsBtn.addEventListener('click', afficherModalParametresPoids);
    }
    if (saveWeightParamsBtn) {
        saveWeightParamsBtn.addEventListener('click', sauvegarderParametresPoids);
    }
    
    // Set up threshold slider
    initThresholdSlider();
    
    // Charger les paramètres de poids initiaux
    chargerParametresPoids();
}

// Function to initialize and set up the threshold slider
function initThresholdSlider() {
    const thresholdSlider = document.getElementById('performance-threshold');
    const thresholdValue = document.getElementById('threshold-value');
    const sliderFill = document.getElementById('performance-slider-fill');
    
    if (!thresholdSlider || !thresholdValue) {
        console.warn('Threshold slider elements not found');
        return;
    }
    
    // Function to update the fill effect
    function updateSliderFill() {
        if (sliderFill) {
            const percent = (thresholdSlider.value - thresholdSlider.min) / (thresholdSlider.max - thresholdSlider.min) * 100;
            sliderFill.style.width = percent + '%';
        }
        thresholdValue.textContent = `${thresholdSlider.value}%`;
    }
    
    // Initialize fill
    updateSliderFill();
    
    // Add event listeners for slider
    thresholdSlider.addEventListener('input', function() {
        updateSliderFill();
        // Debounce the chargerEstimations call to avoid too many requests
        if (window.thresholdUpdateTimeout) {
            clearTimeout(window.thresholdUpdateTimeout);
        }
        window.thresholdUpdateTimeout = setTimeout(() => {
            chargerEstimations();
        }, 300);
    });
    
    // Add a label that indicates the slider is draggable
    const handleIndicator = document.querySelector('.threshold-handle-indicator');
    if (handleIndicator) {
        // Show the indicator on hover
        thresholdSlider.addEventListener('mouseover', function() {
            handleIndicator.style.opacity = '1';
        });
        
        // Hide the indicator after a delay when not hovering
        thresholdSlider.addEventListener('mouseout', function() {
            setTimeout(() => {
                handleIndicator.style.opacity = '0.5';
            }, 1000);
        });
    }
}

// Function to load data based on current selections
function loadData() {
    // Load estimations table
    chargerEstimations().then(() => {
        // After table is loaded, load the form with latest values
        loadLatestEstimation();
        
        // Initialize table filters
        initializeTableFilters();
    });
}

async function updateEstimationStock() {
    console.log('=== UPDATE ESTIMATION STOCK START ===');
    
    const dateInput = document.getElementById('estimation-date');
    const pointVente = document.getElementById('estimation-point-vente').value;
    const produit = document.getElementById('estimation-produit').value;
    const stockSoirInput = document.getElementById('stock-soir');
    const stockSoirOriginal = document.getElementById('stock-soir-original');

    if (!dateInput || !pointVente || !categorie) {
        stockSoirInput.value = '';
        stockSoirOriginal.style.display = 'none';
        return;
    }

    try {
        const date = dateInput.value;
        const url = `/api/stock/${date}/soir/${pointVente}/${categorie}`;
        const response = await fetch(url);
        const data = await response.json();

        if (response.ok && data.stock !== undefined) {
            // Store the original value as a data attribute
            stockSoirInput.dataset.originalValue = data.stock;
            stockSoirInput.value = data.stock;
            stockSoirInput.style.fontStyle = 'normal';
            stockSoirOriginal.style.display = 'none';
        } else {
            stockSoirInput.dataset.originalValue = '0';
            stockSoirInput.value = '0';
            stockSoirInput.style.fontStyle = 'italic';
            stockSoirOriginal.style.display = 'none';
        }
    } catch (error) {
        console.error('Error in updateEstimationStock:', error);
        stockSoirInput.dataset.originalValue = '0';
        stockSoirInput.value = '0';
        stockSoirInput.style.fontStyle = 'italic';
        stockSoirOriginal.style.display = 'none';
    }
}

async function updateEstimationStockMatin() {
    console.log('=== UPDATE ESTIMATION STOCK MATIN START ===');
    
    const dateInput = document.getElementById('estimation-date');
    const pointVente = document.getElementById('estimation-point-vente').value;
    const categorie = document.getElementById('estimation-categorie').value;
    
    // Use the new ID for the stock matin input in the estimation section
    const stockMatinInput = document.getElementById('stock-matin-estimation');
    const stockMatinOriginal = document.getElementById('stock-matin-original');
    
    console.log('Stock matin input element:', stockMatinInput);

    if (!dateInput || !pointVente || !categorie || !stockMatinInput) {
        console.error('Missing required elements for stock matin update');
        if (stockMatinOriginal) stockMatinOriginal.style.display = 'none';
        return;
    }

    try {
        const date = dateInput.value;
        const url = `/api/stock/${date}/matin/${pointVente}/${categorie}`;
        const response = await fetch(url);
        const data = await response.json();

        console.log('Stock matin API response:', data);

        if (response.ok && data.stock !== undefined) {
            // Store the original value as a data attribute
            stockMatinInput.dataset.originalValue = data.stock;
            stockMatinInput.value = data.stock;
            stockMatinInput.style.fontStyle = 'normal';
            stockMatinOriginal.style.display = 'none';
            console.log('Stock matin value updated:', data.stock);
        } else {
            stockMatinInput.dataset.originalValue = '0';
            stockMatinInput.value = '0';
            stockMatinInput.style.fontStyle = 'italic';
            stockMatinOriginal.style.display = 'none';
            console.log('No stock matin found, set to 0');
        }
    } catch (error) {
        console.error('Error in updateEstimationStockMatin:', error);
        stockMatinInput.dataset.originalValue = '0';
        stockMatinInput.value = '0';
        stockMatinInput.style.fontStyle = 'italic';
        stockMatinOriginal.style.display = 'none';
    }
}

async function updateEstimationTransfert() {
    console.log('=== UPDATE ESTIMATION TRANSFERT START ===');
    
    const dateInput = document.getElementById('estimation-date');
    const pointVente = document.getElementById('estimation-point-vente').value;
    const categorie = document.getElementById('estimation-categorie').value;
    const transfertInput = document.getElementById('transfert-estimation');
    const transfertOriginal = document.getElementById('transfert-original');

    if (!dateInput || !pointVente || !categorie) {
        transfertInput.value = '';
        transfertOriginal.style.display = 'none';
        return;
    }

    try {
        const date = dateInput.value;
        const url = `/api/stock/${date}/transfert/${pointVente}/${categorie}`;
        const response = await fetch(url);
        const data = await response.json();
        
        console.log('Transfert API response:', data);

        if (response.ok && data.transfert !== undefined) {
            // Store the original value as a data attribute
            transfertInput.dataset.originalValue = data.transfert;
            transfertInput.value = data.transfert;
            transfertInput.style.fontStyle = 'normal';
            transfertOriginal.style.display = 'none';
            console.log('Transfert value updated:', data.transfert);
            
            // Add title attribute to show message if present
            if (data.message) {
                transfertInput.title = data.message;
            } else {
                transfertInput.removeAttribute('title');
            }
        } else {
            transfertInput.dataset.originalValue = '0';
            transfertInput.value = '0';
            transfertInput.style.fontStyle = 'italic';
            transfertOriginal.style.display = 'none';
            console.log('No transfert found, set to 0');
            
            // Set title with message if available
            if (data.message) {
                transfertInput.title = data.message;
            } else {
                transfertInput.title = 'Aucune donnée de transfert trouvée';
            }
        }
    } catch (error) {
        console.error('Error in updateEstimationTransfert:', error);
        transfertInput.dataset.originalValue = '0';
        transfertInput.value = '0';
        transfertInput.style.fontStyle = 'italic';
        transfertOriginal.style.display = 'none';
        transfertInput.title = 'Erreur lors de la récupération des données de transfert';
    }
}

// Function to check if a field has been modified from its original value
function checkFieldModified(input, originalDisplay) {
    // Check if originalDisplay element exists
    if (!originalDisplay) return;
    
    const originalValue = parseFloat(input.dataset.originalValue) || 0;
    const currentValue = parseFloat(input.value) || 0;
    
    // Only show original value if:
    // 1. The value has been modified from the original
    // 2. The original value is meaningful (not 0 or undefined)
    if (originalValue !== currentValue && input.dataset.originalValue !== undefined && input.dataset.originalValue !== '') {
        originalDisplay.textContent = `Valeur calculée: ${originalValue.toFixed(3)}`;
        originalDisplay.style.display = 'block';
    } else {
        originalDisplay.style.display = 'none';
    }
}

// Function to calculate and update the difference field
function updateDifference() {
    console.log('=== UPDATE DIFFERENCE START ===');
    
    const stockMatin = parseFloat(document.getElementById('stock-matin-estimation').value) || 0;
    const transfert = parseFloat(document.getElementById('transfert-estimation').value) || 0;
    const stockSoir = parseFloat(document.getElementById('stock-soir').value) || 0;
    const previsionKg = parseFloat(document.getElementById('prevision-kg').value) || 0;
    const precommandeKg = parseFloat(document.getElementById('precommande-kg').value) || 0;
    const differenceInput = document.getElementById('difference');
    
    // Formula: stock matin + transfert - stock soir - estimation (prévision seulement, pré-commande incluse)
    const difference = stockMatin + transfert - stockSoir - previsionKg;
    
    differenceInput.value = difference.toFixed(3);
    console.log('Difference calculated:', difference);
    
    // Apply visual styling based on the value
    if (difference < 0) {
        differenceInput.style.color = 'red';
    } else if (difference > 0) {
        differenceInput.style.color = 'green';
    } else {
        differenceInput.style.color = 'black';
    }
    
    // Check if fields have been modified and show original values if needed
    const stockMatinInput = document.getElementById('stock-matin-estimation');
    const transfertInput = document.getElementById('transfert-estimation');
    const stockSoirInput = document.getElementById('stock-soir');
    
    const stockMatinOriginal = document.getElementById('stock-matin-original');
    const transfertOriginal = document.getElementById('transfert-original');
    const stockSoirOriginal = document.getElementById('stock-soir-original');
    
    checkFieldModified(stockMatinInput, stockMatinOriginal);
    checkFieldModified(transfertInput, transfertOriginal);
    checkFieldModified(stockSoirInput, stockSoirOriginal);
}

// Helper function to format date for input field (DD-MM-YYYY)
function formatDateForInput(date) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
}

// Variables globales pour les paramètres de poids
let currentWeightParams = {
    'Boeuf': 150,
    'Veau': 110,
    'Agneau': 10,
    'Poulet': 1,
    'default': 1
};

// Function to get weight parameter for a product
function getWeightForProduct(produit) {
    // Nettoyer le nom du produit pour matcher les clés
    const cleanProduit = produit.trim();
    
    // Vérifier les produits spécifiques
    if (currentWeightParams[cleanProduit]) {
        return currentWeightParams[cleanProduit];
    }
    
    // Retourner le poids par défaut
    return currentWeightParams.default;
}

// Function to update conversion display
function updateConversion(produit, type) {
    const input = document.querySelector(`.${type}-input[data-produit="${produit}"]`);
    const unitSelect = document.querySelector(`.${type}-unit-select[data-produit="${produit}"]`);
    const conversionDisplay = document.querySelector(`.${type}-conversion[data-produit="${produit}"]`);
    
    if (!input || !unitSelect || !conversionDisplay) return;
    
    const value = parseFloat(input.value) || 0;
    const unit = unitSelect.value;
    
    if (unit === 'unite' && value > 0) {
        const weightPerUnit = getWeightForProduct(produit);
        const totalKg = value * weightPerUnit;
        conversionDisplay.textContent = `= ${totalKg.toFixed(1)} kg`;
        conversionDisplay.style.display = 'block';
    } else {
        conversionDisplay.style.display = 'none';
    }
}

// Function to convert value to kg
function convertToKg(produit, value, unit) {
    if (unit === 'kg') {
        return value;
    } else if (unit === 'unite') {
        const weightPerUnit = getWeightForProduct(produit);
        return value * weightPerUnit;
    }
    return value;
}

// Function to load weight parameters for current date
async function chargerParametresPoids() {
    try {
        const date = document.getElementById('estimation-date').value;
        if (!date) return;
        
        const response = await fetch(`/api/weight-params/${date}`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.params) {
                currentWeightParams = { ...currentWeightParams, ...data.params };
                console.log('Paramètres de poids chargés:', currentWeightParams);
                
                // Mettre à jour toutes les conversions
                updateAllConversions();
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement des paramètres de poids:', error);
    }
}

// Function to update all conversion displays
function updateAllConversions() {
    const precommandeInputs = document.querySelectorAll('.precommande-input');
    const previsionInputs = document.querySelectorAll('.prevision-input');
    
    precommandeInputs.forEach(input => {
        const produit = input.dataset.produit;
        updateConversion(produit, 'precommande');
    });
    
    previsionInputs.forEach(input => {
        const produit = input.dataset.produit;
        updateConversion(produit, 'prevision');
    });
}

// Function to show weight parameters modal
function afficherModalParametresPoids() {
    const date = document.getElementById('estimation-date').value;
    if (!date) {
        alert('Veuillez sélectionner une date d\'abord');
        return;
    }
    
    // Remplir la date dans le modal
    document.getElementById('weight-params-date').textContent = date;
    
    // Remplir les valeurs actuelles
    document.getElementById('weight-boeuf').value = currentWeightParams['Boeuf'] || 150;
    document.getElementById('weight-veau').value = currentWeightParams['Veau'] || 110;
    document.getElementById('weight-agneau').value = currentWeightParams['Agneau'] || 10;
    document.getElementById('weight-poulet').value = currentWeightParams['Poulet'] || 1;
    document.getElementById('weight-default').value = currentWeightParams['default'] || 1;
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('weightParamsModal'));
    modal.show();
}

// Function to save weight parameters
async function sauvegarderParametresPoids() {
    try {
        const date = document.getElementById('estimation-date').value;
        
        const params = {
            'Boeuf': parseFloat(document.getElementById('weight-boeuf').value) || 150,
            'Veau': parseFloat(document.getElementById('weight-veau').value) || 110,
            'Agneau': parseFloat(document.getElementById('weight-agneau').value) || 10,
            'Poulet': parseFloat(document.getElementById('weight-poulet').value) || 1,
            'default': parseFloat(document.getElementById('weight-default').value) || 1
        };
        
        const response = await fetch('/api/weight-params', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: date,
                params: params
            }),
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Mettre à jour les paramètres locaux
            currentWeightParams = { ...currentWeightParams, ...params };
            
            // Mettre à jour toutes les conversions
            updateAllConversions();
            
            // Fermer le modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('weightParamsModal'));
            modal.hide();
            
            alert('Paramètres de poids sauvegardés avec succès');
        } else {
            alert('Erreur lors de la sauvegarde: ' + (data.message || 'Erreur inconnue'));
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des paramètres de poids:', error);
        alert('Erreur lors de la sauvegarde des paramètres de poids');
    }
}

// Function to show validation popup before saving
async function afficherPopupValidation() {
    console.log('=== AFFICHER POPUP VALIDATION START ===');
    
    // Vérifier les champs requis
    const date = document.getElementById('estimation-date').value;
    const pointVente = document.getElementById('estimation-point-vente').value;
    
    if (!date || !pointVente) {
        alert('Veuillez remplir la date et le point de vente');
        return;
    }
    
    // Collecter les données des produits
    const produitsEstimation = collecterDonneesProduits();
    
    if (produitsEstimation.length === 0) {
        alert('Aucun produit avec des valeurs à sauvegarder. Veuillez saisir au moins une pré-commande ou prévision > 0.');
        return;
    }
    
    // Remplir le popup de validation
    document.getElementById('validation-date').textContent = date;
    document.getElementById('validation-point-vente').textContent = pointVente;
    document.getElementById('validation-products-count').textContent = produitsEstimation.length;
    
    // Remplir le tableau de validation
    const validationTbody = document.getElementById('validation-products-tbody');
    validationTbody.innerHTML = '';
    
    produitsEstimation.forEach(produit => {
        const row = document.createElement('tr');
        
        // Formatage de la pré-commande avec unité originale
        const precommandeDisplay = produit.precommandeOriginal.unit === 'unite' ? 
            `${produit.precommandeOriginal.value} unité(s) = ${produit.precommande.toFixed(1)} kg` :
            `${produit.precommande.toFixed(3)} kg`;
        
        // Formatage de la prévision avec unité originale
        const previsionDisplay = produit.previsionOriginal.unit === 'unite' ? 
            `${produit.previsionOriginal.value} unité(s) = ${produit.prevision.toFixed(1)} kg` :
            `${produit.prevision.toFixed(3)} kg`;
        
        row.innerHTML = `
            <td class="fw-medium">${produit.produit}</td>
            <td class="text-center">${previsionDisplay}</td>
            <td class="text-center">${precommandeDisplay}</td>
            <td class="text-center">${produit.commentaire || '-'}</td>
        `;
        validationTbody.appendChild(row);
    });
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('estimationValidationModal'));
    modal.show();
    
    // Configurer le bouton de confirmation
    const confirmBtn = document.getElementById('confirm-estimation-btn');
    confirmBtn.onclick = async () => {
        modal.hide();
        await sauvegarderEstimations(produitsEstimation, date, pointVente);
    };
    
    console.log('=== AFFICHER POPUP VALIDATION END ===');
}

// Function to collect product data from the table
function collecterDonneesProduits() {
    const produits = [];
    const precommandeInputs = document.querySelectorAll('.precommande-input');
    const previsionInputs = document.querySelectorAll('.prevision-input');
    const commentaireInputs = document.querySelectorAll('.commentaire-input');
    
    precommandeInputs.forEach((precommandeInput, index) => {
        const previsionInput = previsionInputs[index];
        const commentaireInput = commentaireInputs[index];
        const produit = precommandeInput.dataset.produit;
        
        // Récupérer les valeurs et unités
        const precommandeValue = parseFloat(precommandeInput.value) || 0;
        const precommandeUnit = document.querySelector(`.precommande-unit-select[data-produit="${produit}"]`).value;
        const previsionValue = parseFloat(previsionInput.value) || 0;
        const previsionUnit = document.querySelector(`.prevision-unit-select[data-produit="${produit}"]`).value;
        const commentaire = commentaireInput ? commentaireInput.value.trim() : '';
        
        // Convertir en kg
        const precommandeKg = convertToKg(produit, precommandeValue, precommandeUnit);
        const previsionKg = convertToKg(produit, previsionValue, previsionUnit);
        
        // Inclure les produits avec des valeurs > 0 OU avec un commentaire
        if (precommandeKg > 0 || previsionKg > 0 || commentaire) {
            produits.push({
                produit: produit,
                precommande: precommandeKg,
                prevision: previsionKg,
                commentaire: commentaire,
                precommandeOriginal: {
                    value: precommandeValue,
                    unit: precommandeUnit
                },
                previsionOriginal: {
                    value: previsionValue,
                    unit: previsionUnit
                }
            });
        }
    });
    
    return produits;
}

// Function to save estimations (multiple products)
async function sauvegarderEstimations(produitsEstimation, date, pointVente) {
    console.log('=== SAVE ESTIMATIONS START ===');
    
    // Check if save is already in progress
    if (window.saveEstimationInProgress) {
        console.log('Save already in progress, ignoring duplicate call');
        return;
    }
    
    // Set flag to prevent multiple simultaneous saves
    window.saveEstimationInProgress = true;
    
    try {
        // Debug des données avant envoi
        console.log('🔍 DEBUG Frontend - Données à envoyer:', {
            date: date,
            pointVente: pointVente,
            produits: produitsEstimation
        });
        
        produitsEstimation.forEach((produit, index) => {
            console.log(`🔍 DEBUG Frontend - Produit ${index + 1}:`, {
                produit: produit.produit,
                precommande: produit.precommande,
                prevision: produit.prevision,
                commentaire: produit.commentaire,
                commentaireType: typeof produit.commentaire,
                hasCommentaire: !!produit.commentaire
            });
        });
        
        // Envoyer les données au backend
        const response = await fetch('/api/estimations/bulk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: date,
                pointVente: pointVente,
                produits: produitsEstimation
            })
        });

        const data = await response.json();

        if (data.success) {
            alert(`Estimation enregistrée avec succès !\n${data.savedCount} produit(s) sauvegardé(s).`);
            
            // Reset the form but keep the Point de Vente and reset to default products
            resetEstimationFormComplete();
            
            // Reload estimations table
            await chargerEstimations();
        } else {
            alert('Erreur lors de l\'enregistrement de l\'estimation: ' + (data.message || 'Erreur inconnue'));
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de l\'estimation:', error);
        alert('Erreur lors de la sauvegarde de l\'estimation');
    } finally {
        // Clear the flag regardless of success or failure
        window.saveEstimationInProgress = false;
        console.log('=== SAVE ESTIMATIONS END ===');
    }
}

// Function to check if any stock value has been modified
function isStockModified() {
    const stockMatinInput = document.getElementById('stock-matin-estimation');
    const transfertInput = document.getElementById('transfert-estimation');
    const stockSoirInput = document.getElementById('stock-soir');
    
    const stockMatinOriginal = parseFloat(stockMatinInput.dataset.originalValue) || 0;
    const stockMatinCurrent = parseFloat(stockMatinInput.value) || 0;
    
    const transfertOriginal = parseFloat(transfertInput.dataset.originalValue) || 0;
    const transfertCurrent = parseFloat(transfertInput.value) || 0;
    
    const stockSoirOriginal = parseFloat(stockSoirInput.dataset.originalValue) || 0;
    const stockSoirCurrent = parseFloat(stockSoirInput.value) || 0;
    
    return stockMatinOriginal !== stockMatinCurrent ||
           transfertOriginal !== transfertCurrent ||
           stockSoirOriginal !== stockSoirCurrent;
}

// Function to reset the estimation form while keeping the Point de Vente
function resetEstimationForm() {
    console.log('=== RESET ESTIMATION FORM START ===');
    
    // Get form elements
    const dateInput = document.getElementById('estimation-date');
    const pointVenteSelect = document.getElementById('estimation-point-vente');
    
    // Store the current Point de Vente selection
    const currentPointVente = pointVenteSelect ? pointVenteSelect.value : '';
    
    // Reset date to today
    if (dateInput) {
        const today = new Date();
        const formattedDate = formatDateForInput(today);
        dateInput.value = formattedDate;
        
        // If using flatpickr, update it too
        if (dateInput._flatpickr) {
            dateInput._flatpickr.setDate(today);
        }
    }
    
    // Reset all product inputs to 0
    const precommandeInputs = document.querySelectorAll('.precommande-input');
    const previsionInputs = document.querySelectorAll('.prevision-input');
    
    precommandeInputs.forEach(input => {
        input.value = '0';
    });
    
    previsionInputs.forEach(input => {
        input.value = '0';
    });
    
    // Restore the Point de Vente selection
    if (pointVenteSelect && currentPointVente) {
        pointVenteSelect.value = currentPointVente;
    }
    
    console.log('Form reset completed, Point de Vente preserved:', currentPointVente);
    console.log('=== RESET ESTIMATION FORM END ===');
}

// Function to completely reset the estimation form (including product filter)
function resetEstimationFormComplete() {
    console.log('=== RESET ESTIMATION FORM COMPLETE START ===');
    
    // Reset to default products (hide the "all products" view)
    const showAllBtn = document.getElementById('show-all-products-btn');
    if (showAllBtn) {
        showAllBtn.dataset.showAll = 'false';
    }
    
    // Recharger le tableau avec les produits par défaut
    chargerTableauProduits();
    
    console.log('=== RESET ESTIMATION FORM COMPLETE END ===');
}

// Function to toggle between default and all products
function toggleProductsDisplay() {
    console.log('=== TOGGLE PRODUCTS DISPLAY START ===');
    
    const showAllBtn = document.getElementById('show-all-products-btn');
    if (!showAllBtn) return;
    
    // Basculer l'état
    const currentShowAll = showAllBtn.dataset.showAll === 'true';
    showAllBtn.dataset.showAll = (!currentShowAll).toString();
    
    // Recharger le tableau avec la nouvelle configuration
    chargerTableauProduits();
    
    console.log('=== TOGGLE PRODUCTS DISPLAY END ===');
}

// Function to enable editing of ventes theoriques
function editVentesTheo(estimationId, spanElement) {
    const row = spanElement.closest('tr');
    const input = row.querySelector('.ventes-theo-input');
    const span = row.querySelector('.ventes-theo-display');
    
    span.classList.add('d-none');
    input.classList.remove('d-none');
    input.focus();
    input.select();
}

// Function to save edited ventes theoriques
async function saveVentesTheo(estimationId, inputElement) {
    const newValue = parseFloat(inputElement.value) || 0;
    const row = inputElement.closest('tr');
    const span = row.querySelector('.ventes-theo-display');
    
    try {
        // Save to backend
        const response = await fetch(`/api/estimations/${estimationId}/ventes-theoriques`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ventesTheoriques: newValue
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Update display
            const formattedValue = newValue === 0 ? 
                `<i>${newValue.toFixed(3)}</i>` : 
                `<strong>${newValue.toFixed(3)}</strong>`;
            span.innerHTML = formattedValue;
            
            // Hide input, show span
            inputElement.classList.add('d-none');
            span.classList.remove('d-none');
            
            // Reload estimations to update calculations
            await chargerEstimations();
        } else {
            alert('Erreur lors de la sauvegarde: ' + (data.message || 'Erreur inconnue'));
            // Reset input value
            inputElement.value = inputElement.dataset.originalValue || 0;
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde des ventes théoriques:', error);
        alert('Erreur lors de la sauvegarde');
        // Reset input value
        inputElement.value = inputElement.dataset.originalValue || 0;
    }
}

// Rendre les fonctions accessibles globalement
window.toggleProductsDisplay = toggleProductsDisplay;
window.editVentesTheo = editVentesTheo;
window.saveVentesTheo = saveVentesTheo;

// Function to load estimations from the server
async function chargerEstimations() {
    console.log('=== LOAD ESTIMATIONS START ===');
    
    try {
        const response = await fetch('/api/estimations');
        const data = await response.json();

        if (data.success) {
            afficherEstimations(data.estimations);
            console.log('Estimations loaded successfully');
        } else {
            console.error('Failed to load estimations:', data.message || 'Unknown error');
        }
    } catch (error) {
        console.error('Error loading estimations:', error);
    }
    
    console.log('=== LOAD ESTIMATIONS END ===');
}

// Function to determine status based on difference percentage and threshold
function getStatusIndicator(differencePercentage, threshold) {
    // Handle N.A case
    if (differencePercentage === 'N.A') {
        return `<i class="bi bi-question-circle-fill text-muted"></i>`;
    }
    
    // Use absolute value for comparison
    const absPercentage = Math.abs(differencePercentage);
    const thresholdValue = parseFloat(threshold);
    const upperThreshold = thresholdValue + 10; // Threshold + 10%
    
    let colorClass, color, icon;
    
    if (absPercentage <= thresholdValue) {
        colorClass = 'green';
        color = 'success'; // Green
        icon = 'check-circle-fill';
    } else if (absPercentage <= upperThreshold) {
        colorClass = 'yellow';
        color = 'warning'; // Yellow
        icon = 'exclamation-triangle-fill';
    } else {
        colorClass = 'red';
        color = 'danger'; // Red
        icon = 'x-circle-fill';
    }
    
    return `<div class="status-indicator ${colorClass}" title="Écart: ${absPercentage.toFixed(2)}%, Seuil: ${thresholdValue}%">
              <i class="bi bi-${icon} text-${color}"></i>
            </div>`;
}

// Function to display estimations in the table
function afficherEstimations(estimations) {
    console.log('=== DISPLAY ESTIMATIONS START ===');
    
    const tbody = document.getElementById('estimations-table-body');
    if (!tbody) {
        console.error('Table body element not found');
        return;
    }
    
    // Get current threshold value
    const thresholdSlider = document.getElementById('performance-threshold');
    const thresholdValue = thresholdSlider ? thresholdSlider.value : 5; // Default to 5% if slider not found
    
    // Clear the table
    tbody.innerHTML = '';
    
    if (!estimations || estimations.length === 0) {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = `<td colspan="15" class="text-center">Aucune donnée disponible</td>`;
        tbody.appendChild(emptyRow);
        console.log('No estimations to display');
        return;
    }
    
    console.log(`Displaying ${estimations.length} estimations with threshold ${thresholdValue}%`);
    
    // Display each estimation
    estimations.forEach(estimation => {
        const row = document.createElement('tr');
        
        // Determine if a stock value has been modified
        const stockMatinModified = estimation.stockMatin !== undefined && 
                                  estimation.stockMatinOriginal !== undefined && 
                                  estimation.stockMatin !== estimation.stockMatinOriginal;
                                  
        const transfertModified = estimation.transfert !== undefined && 
                                 estimation.transfertOriginal !== undefined && 
                                 estimation.transfert !== estimation.transfertOriginal;
                                 
        const stockSoirModified = estimation.stockSoir !== undefined && 
                                 estimation.stockSoirOriginal !== undefined && 
                                 estimation.stockSoir !== estimation.stockSoirOriginal;
        
        // Format stock values with italics if zero and show original values if modified
        const stockMatinValue = estimation.stockMatin !== undefined ? estimation.stockMatin : 0;
        const stockMatinFormatted = stockMatinValue === 0 ? 
            `<i>${stockMatinValue.toFixed(3)}</i>` : 
            stockMatinValue.toFixed(3);
            
        const stockMatinDisplay = stockMatinModified ? 
            `${stockMatinFormatted} <small class="text-muted d-block">(calc: ${estimation.stockMatinOriginal.toFixed(3)})</small>` : 
            stockMatinFormatted;
            
        const transfertValue = estimation.transfert !== undefined ? estimation.transfert : 0;
        const transfertFormatted = transfertValue === 0 ? 
            `<i>${transfertValue.toFixed(3)}</i>` : 
            transfertValue.toFixed(3);
            
        const transfertDisplay = transfertModified ? 
            `${transfertFormatted} <small class="text-muted d-block">(calc: ${estimation.transfertOriginal.toFixed(3)})</small>` : 
            transfertFormatted;
            
        // Format stock soir with italics if zero and show original if modified
        const stockSoirFormatted = estimation.stockSoir === 0 ? 
            `<i>${estimation.stockSoir.toFixed(3)}</i>` : 
            estimation.stockSoir.toFixed(3);
            
        const stockSoirDisplay = stockSoirModified ? 
            `${stockSoirFormatted} <small class="text-muted d-block">(calc: ${estimation.stockSoirOriginal.toFixed(3)})</small>` : 
            stockSoirFormatted;
        
        // Format other values with italics if zero
        const precommandeFormatted = estimation.preCommandeDemain === 0 ? 
            `<i>${estimation.preCommandeDemain.toFixed(3)}</i>` : 
            estimation.preCommandeDemain.toFixed(3);
            
        const previsionFormatted = estimation.previsionVentes === 0 ? 
            `<i>${estimation.previsionVentes.toFixed(3)}</i>` : 
            `<strong>${estimation.previsionVentes.toFixed(3)}</strong>`;
            
        // Calculate difference if not provided
        let difference = estimation.difference;
        if (difference === undefined) {
            // Recreate the calculation if needed
            const stockMatin = estimation.stockMatin || 0;
            const transfert = estimation.transfert || 0;
            const preCommandeDemain = estimation.preCommandeDemain || 0;
            difference = stockMatin + transfert - estimation.stockSoir - estimation.previsionVentes;
        }
        
        // Format difference with color
        let differenceFormatted = difference.toFixed(3);
        let differenceColor = 'black';
        if (difference < 0) {
            differenceColor = 'red';
        } else if (difference > 0) {
            differenceColor = 'green';
        }
        
        // Use saved theoretical sales for percentage calculation if available
        const ventesTheoForPercentage = estimation.ventesTheoriques !== null && estimation.ventesTheoriques !== undefined 
            ? estimation.ventesTheoriques 
            : stockMatinValue + transfertValue - estimation.stockSoir;
        
        // Calculate difference percentage (better logic: based on theoretical sales)
        let differencePercentage = 0;
        let differencePercentageFormatted;
        let differencePercentageColor = differenceColor; // Use same color as difference
        
        if (ventesTheoForPercentage === 0) {
            differencePercentageFormatted = 'N.A';
            differencePercentageColor = 'gray';
        } else {
            differencePercentage = (difference / ventesTheoForPercentage) * 100;
            differencePercentageFormatted = differencePercentage.toFixed(2) + '%';
        }
        
        // Use saved theoretical sales if available, otherwise calculate manually
        const ventesTheo = estimation.ventesTheoriques !== null && estimation.ventesTheoriques !== undefined 
            ? estimation.ventesTheoriques 
            : stockMatinValue + transfertValue - estimation.stockSoir;
        const ventesTheoFormatted = ventesTheo === 0 ? 
            `<i>${ventesTheo.toFixed(3)}</i>` : 
            `<strong>${ventesTheo.toFixed(3)}</strong>`;
        
        // Get status indicator based on threshold (only if we have real theoretical sales)
        const hasRealVentesTheo = estimation.ventesTheoriques !== null && estimation.ventesTheoriques !== undefined && estimation.ventesTheoriques > 0;
        const statusIndicator = hasRealVentesTheo 
            ? getStatusIndicator(differencePercentage, thresholdValue)
            : `<i class="bi bi-clock text-muted" title="En attente des ventes théoriques"></i>`;
        
        // Build the row HTML - update to include new columns with checkbox and recalculate button
        row.innerHTML = `
            <td class="text-center">
                <input type="checkbox" class="estimation-checkbox" data-id="${estimation.id}">
            </td>
            <td class="text-center">${formatDate(estimation.date)}</td>
            <td class="text-center">${estimation.pointVente}</td>
            <td class="text-center">${estimation.categorie || estimation.produit || ''}</td>
            <td class="text-center stock-column" style="display: none;">${stockMatinDisplay}</td>
            <td class="text-center stock-column" style="display: none;">${transfertDisplay}</td>
            <td class="text-center stock-column" style="display: none;">${stockSoirDisplay}</td>
            <td class="text-center">${previsionFormatted}</td>
            <td class="text-center">${precommandeFormatted}</td>
            <td class="text-center">
                <div class="d-flex align-items-center justify-content-center">
                    <span class="ventes-theo-display" onclick="editVentesTheo(${estimation.id}, this)" 
                          style="cursor: pointer; border-bottom: 1px dashed #007bff;" 
                          title="Cliquez pour éditer">${ventesTheoFormatted}</span>
                    <input type="number" class="form-control form-control-sm ventes-theo-input d-none" 
                           style="width: 80px;" step="0.001" min="0"
                           value="${ventesTheo}" 
                           onblur="saveVentesTheo(${estimation.id}, this)"
                           onkeypress="if(event.key==='Enter') saveVentesTheo(${estimation.id}, this)">
                </div>
            </td>
            <td class="text-center" style="color: ${differenceColor};">${differenceFormatted}</td>
            <td class="text-center" style="color: ${differencePercentageColor};">${differencePercentageFormatted}</td>
            <td class="text-center">${statusIndicator}</td>
            <td class="text-center">${formatCommentaire(estimation.commentaire)}</td>
            <td class="text-center">
                <button class="btn btn-sm btn-outline-primary me-1" onclick="recalculerVentesTheo(${estimation.id})" title="Recalculer les ventes théoriques">
                    <i class="bi bi-arrow-clockwise"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="supprimerEstimation(${estimation.id})" aria-label="Supprimer l'estimation">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
    
    console.log('=== DISPLAY ESTIMATIONS END ===');
    
    // Initialize Bootstrap tooltips for comment truncation
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    // Initialize table filters after the table is populated
    populateFilterOptions();
    
    // Apply any existing filters
    applyFilters();
}

// Helper function to format comments with truncation and tooltip
function formatCommentaire(commentaire) {
    if (!commentaire || commentaire.trim() === '') {
        return '<span class="text-muted">-</span>';
    }
    
    const maxLength = 30;
    const text = commentaire.trim();
    
    if (text.length <= maxLength) {
        return text;
    }
    
    const truncated = text.substring(0, maxLength) + '...';
    return `<span title="${text.replace(/"/g, '&quot;')}" data-bs-toggle="tooltip" data-bs-placement="top" style="cursor: pointer; text-decoration: underline dotted;">${truncated}</span>`;
}

// Helper function to format dates
function formatDate(dateString) {
    try {
        // Handle different date formats
        let date;
        if (dateString.includes('T')) {
            // ISO format with time
            date = new Date(dateString);
        } else if (dateString.includes('-')) {
            // Determine if YYYY-MM-DD or DD-MM-YYYY
            const parts = dateString.split('-');
            if (parts[0].length === 4) {
                // YYYY-MM-DD format (ISO date format from database)
                date = new Date(parts[0], parts[1] - 1, parts[2]);
            } else {
                // DD-MM-YYYY format
                date = new Date(parts[2], parts[1] - 1, parts[0]);
            }
        } else {
            // Fallback
            date = new Date(dateString);
        }
        
        // Force the format to be DD-MM-YYYY for consistency with filters
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        
        return `${day}-${month}-${year}`;
    } catch (e) {
        console.error('Error formatting date:', e);
        return dateString; // Return original if error
    }
}

// Function to recalculate theoretical sales for a specific estimation
async function recalculerVentesTheo(id) {
    console.log('=== RECALCULATE VENTES THEO START ===', id);
    
    try {
        const response = await fetch(`/api/estimations/${id}/recalculate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            console.log('Ventes théoriques recalculées avec succès');
            await chargerEstimations(); // Reload the table
            
            // Show success message
            if (data.ventesTheo !== undefined) {
                alert(`Ventes théoriques recalculées: ${data.ventesTheo.toFixed(3)} kg`);
            }
        } else {
            console.error('Failed to recalculate ventes theo:', data.message || 'Unknown error');
            alert('Erreur lors du recalcul: ' + (data.message || 'Erreur inconnue'));
        }
    } catch (error) {
        console.error('Error recalculating ventes theo:', error);
        alert('Erreur lors du recalcul des ventes théoriques');
    }
    
    console.log('=== RECALCULATE VENTES THEO END ===');
}

// Function to delete an estimation
async function supprimerEstimation(id) {
    console.log('=== DELETE ESTIMATION START ===');
    
    const ok = await showConfirmModal('Voulez-vous vraiment supprimer cette estimation ?', {
        title: 'Supprimer estimation', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (!ok) {
        console.log('Deletion cancelled by user');
        return;
    }

    try {
        const response = await fetch(`/api/estimations/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            console.log('Estimation deleted successfully');
            await chargerEstimations(); // Reload the table
        } else {
            console.error('Failed to delete estimation:', data.message || 'Unknown error');
            alert('Erreur lors de la suppression: ' + (data.message || 'Erreur inconnue'));
        }
    } catch (error) {
        console.error('Error deleting estimation:', error);
        alert('Erreur lors de la suppression de l\'estimation');
    }
    
    console.log('=== DELETE ESTIMATION END ===');
}

// Load estimations when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the table if we're on the estimation page
    const estimationSection = document.getElementById('estimation-section');
    if (estimationSection && window.getComputedStyle(estimationSection).display !== 'none') {
        chargerEstimations().then(() => {
            // After loading estimations, load the latest estimation for the current point of sale and category
            loadLatestEstimation();
        });
    }
});

// Function to load the latest estimation into the form
async function loadLatestEstimation() {
    console.log('=== LOAD LATEST ESTIMATION START ===');
    
    try {
        // Get form elements
    const dateInput = document.getElementById('estimation-date');
    const pointVenteSelect = document.getElementById('estimation-point-vente');
    const categorieSelect = document.getElementById('estimation-categorie');

        // Check required elements - return silently if not found (elements not ready yet)
        if (!dateInput || !pointVenteSelect || !categorieSelect) {
            console.log('Required form elements not found yet, skipping loadLatestEstimation');
            return;
        }
        
        // Ensure date is set to today if empty
        if (!dateInput.value) {
            dateInput.value = formatDateForInput(new Date());
            console.log('Set missing date to today:', dateInput.value);
        }
        
        // Get current form selections
        let pointVente = pointVenteSelect.value;
        let categorie = categorieSelect.value;
        const date = dateInput.value;
        
        // Try to auto-select point de vente and categorie if not selected
        if (!pointVente || !categorie) {
            const selectionResult = await autoSelectPointVenteAndCategorie(
                pointVenteSelect, 
                categorieSelect, 
                date
            );
            
            pointVente = selectionResult.pointVente;
            categorie = selectionResult.categorie;
            
            // If we still don't have valid selections, we can't continue
            if (!pointVente || !categorie) {
                console.log('Could not determine point de vente and categorie, aborting');
                return;
            }
        }
        
        // Fetch all estimations
        const estimations = await fetchEstimations();
        if (!estimations || estimations.length === 0) {
            console.log('No estimations available');
            return;
        }
        
        // Find the latest estimation for this point de vente and categorie
        const latestEstimation = findLatestEstimation(estimations, pointVente, categorie, date);
        if (!latestEstimation) {
            console.log('No matching estimation found');
            return;
        }
        
        // Populate the form with the found estimation data
        populateFormWithEstimation(latestEstimation);
        
        console.log('Form populated with latest estimation');
    } catch (error) {
        console.error('Error in loadLatestEstimation:', error);
    }
    
    console.log('=== LOAD LATEST ESTIMATION END ===');
}

// Helper function to auto-select point de vente and categorie if not selected
async function autoSelectPointVenteAndCategorie(pointVenteSelect, categorieSelect, date) {
    console.log('Auto-selecting point de vente and categorie');
    
    let pointVente = pointVenteSelect.value;
    let categorie = categorieSelect.value;
    
    // Try to select first non-empty option
    if (!pointVente && pointVenteSelect.options.length > 1) {
        for (let i = 0; i < pointVenteSelect.options.length; i++) {
            if (pointVenteSelect.options[i].value) {
                pointVenteSelect.selectedIndex = i;
                pointVente = pointVenteSelect.options[i].value;
                console.log('Auto-selected point de vente:', pointVente);
                break;
            }
        }
    }
    
    if (!categorie && categorieSelect.options.length > 1) {
        for (let i = 0; i < categorieSelect.options.length; i++) {
            if (categorieSelect.options[i].value) {
                categorieSelect.selectedIndex = i;
                categorie = categorieSelect.options[i].value;
                console.log('Auto-selected categorie:', categorie);
                break;
            }
        }
    }
    
    // If we still don't have valid selections, try to find values from existing estimations
    if (!pointVente || !categorie) {
        try {
            const estimations = await fetchEstimations();
            
            if (estimations && estimations.length > 0) {
                // Try to find an estimation for today
                const todayFormatted = formatDateForInput(new Date());
                const todayEstimations = estimations.filter(est => est.date === todayFormatted);
                
                if (todayEstimations.length > 0) {
                    const firstEstimation = todayEstimations[0];
                    
                    // Set point de vente if missing
                    if (!pointVente && firstEstimation.pointVente) {
                        for (let i = 0; i < pointVenteSelect.options.length; i++) {
                            if (pointVenteSelect.options[i].value === firstEstimation.pointVente) {
                                pointVenteSelect.selectedIndex = i;
                                pointVente = firstEstimation.pointVente;
                                console.log('Selected point de vente from today\'s estimation:', pointVente);
                                break;
                            }
                        }
                    }
                    
                    // Set categorie if missing
                    if (!categorie && firstEstimation.categorie) {
                        for (let i = 0; i < categorieSelect.options.length; i++) {
                            if (categorieSelect.options[i].value === firstEstimation.categorie) {
                                categorieSelect.selectedIndex = i;
                                categorie = firstEstimation.categorie;
                                console.log('Selected categorie from today\'s estimation:', categorie);
                                break;
                            }
                        }
                    }
                } else if (estimations.length > 0) {
                    // If no today's estimation, use the most recent one
                    const mostRecent = estimations.sort((a, b) => {
                        // Sort by date descending
                        const dateA = new Date(a.date.split('-').reverse().join('-'));
                        const dateB = new Date(b.date.split('-').reverse().join('-'));
                        return dateB - dateA;
                    })[0];
                    
                    // Set point de vente if missing
                    if (!pointVente && mostRecent.pointVente) {
                        for (let i = 0; i < pointVenteSelect.options.length; i++) {
                            if (pointVenteSelect.options[i].value === mostRecent.pointVente) {
                                pointVenteSelect.selectedIndex = i;
                                pointVente = mostRecent.pointVente;
                                console.log('Selected point de vente from most recent estimation:', pointVente);
                                break;
                            }
                        }
                    }
                    
                    // Set categorie if missing
                    if (!categorie && mostRecent.categorie) {
                        for (let i = 0; i < categorieSelect.options.length; i++) {
                            if (categorieSelect.options[i].value === mostRecent.categorie) {
                                categorieSelect.selectedIndex = i;
                                categorie = mostRecent.categorie;
                                console.log('Selected categorie from most recent estimation:', categorie);
                                break;
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error auto-selecting from estimations:', error);
        }
    }
    
    // Last resort: just select the first option
    if (!pointVente && pointVenteSelect.options.length > 1) {
        pointVenteSelect.selectedIndex = 1; // Skip the empty first option
        pointVente = pointVenteSelect.value;
        console.log('Selected first available point de vente:', pointVente);
    }
    
    if (!categorie && categorieSelect.options.length > 1) {
        categorieSelect.selectedIndex = 1; // Skip the empty first option
        categorie = categorieSelect.value;
        console.log('Selected first available categorie:', categorie);
    }
    
    return { pointVente, categorie };
}

// Function to fetch estimations from the server
async function fetchEstimations() {
    try {
        const response = await fetch('/api/estimations');
        const data = await response.json();
        
        if (!data.success) {
            console.error('API returned error:', data.message || 'Unknown error');
            return null;
        }
        
        return data.estimations || [];
    } catch (error) {
        console.error('Error fetching estimations:', error);
        return null;
    }
}

// Function to find the latest estimation matching the criteria
function findLatestEstimation(estimations, pointVente, categorie, date) {
    // First try exact match for date, point de vente, and categorie
    const exactMatches = estimations.filter(est => 
        est.date === date && 
        est.pointVente === pointVente && 
        est.categorie === categorie
    );
    
    if (exactMatches.length > 0) {
        console.log('Found exact match for estimation');
        return exactMatches[0];
    }
    
    // Then try match for point de vente and categorie, sorted by date
    const matchesByPointVenteAndCategorie = estimations
        .filter(est => est.pointVente === pointVente && est.categorie === categorie)
        .sort((a, b) => {
            // Sort by date descending
            const dateA = new Date(a.date.split('-').reverse().join('-'));
            const dateB = new Date(b.date.split('-').reverse().join('-'));
            return dateB - dateA;
        });
    
    if (matchesByPointVenteAndCategorie.length > 0) {
        console.log('Found match by point de vente and categorie');
        return matchesByPointVenteAndCategorie[0];
    }
    
    // Then try match for date
    const matchesByDate = estimations.filter(est => est.date === date);
    
    if (matchesByDate.length > 0) {
        console.log('Found match by date');
        return matchesByDate[0];
    }
    
    // Finally, return the most recent estimation
    const sortedByDate = [...estimations].sort((a, b) => {
        const dateA = new Date(a.date.split('-').reverse().join('-'));
        const dateB = new Date(b.date.split('-').reverse().join('-'));
        return dateB - dateA;
    });
    
    if (sortedByDate.length > 0) {
        console.log('Using most recent estimation as fallback');
        return sortedByDate[0];
    }
    
    return null;
}

// Function to populate the form with estimation data
function populateFormWithEstimation(estimation) {
    console.log('Populating form with estimation:', estimation);
    
    const stockMatinInput = document.getElementById('stock-matin-estimation');
    const transfertInput = document.getElementById('transfert-estimation');
    const stockSoirInput = document.getElementById('stock-soir');
    const precommandeInput = document.getElementById('precommande-kg');
    const previsionInput = document.getElementById('prevision-kg');
    const differenceInput = document.getElementById('difference');
    
    // Populate stock matin
    if (stockMatinInput) {
        stockMatinInput.value = estimation.stockMatin || 0;
        stockMatinInput.dataset.originalValue = estimation.stockMatinOriginal || 0;
    }
    
    // Populate transfert
    if (transfertInput) {
        transfertInput.value = estimation.transfert || 0;
        transfertInput.dataset.originalValue = estimation.transfertOriginal || 0;
    }
    
    // Populate stock soir
    if (stockSoirInput) {
        stockSoirInput.value = estimation.stockSoir || 0;
        stockSoirInput.dataset.originalValue = estimation.stockSoirOriginal || 0;
    }
    
    // Populate pre-commande
    if (precommandeInput) {
        precommandeInput.value = estimation.preCommandeDemain || 0;
    }
    
    // Populate prevision
    if (previsionInput) {
        previsionInput.value = estimation.previsionVentes || 0;
    }
    
    // Populate and style difference
    if (differenceInput) {
        differenceInput.value = estimation.difference || 0;
        
        // Apply visual styling
        const difference = parseFloat(differenceInput.value);
        if (difference < 0) {
            differenceInput.style.color = 'red';
        } else if (difference > 0) {
            differenceInput.style.color = 'green';
        } else {
            differenceInput.style.color = 'black';
        }
    }
    
    // Update the difference display
    updateDifference();
}

// Function to enhance the threshold slider with visual indicators
function enhanceThresholdSlider() {
    const thresholdSlider = document.getElementById('performance-threshold');
    const thresholdValue = document.getElementById('threshold-value');
    
    if (!thresholdSlider || !thresholdValue) {
        console.log('Threshold slider elements not found');
        return;
    }
    
    // Create a container to wrap the slider for better styling
    const sliderContainer = document.createElement('div');
    sliderContainer.className = 'threshold-slider-container';
    sliderContainer.style.position = 'relative';
    sliderContainer.style.width = '100%';
    sliderContainer.style.padding = '10px 0';
    
    // Style the slider to make it more visible
    thresholdSlider.style.height = '10px';
    thresholdSlider.style.borderRadius = '5px';
    thresholdSlider.style.appearance = 'none';
    thresholdSlider.style.outline = 'none';
    thresholdSlider.style.opacity = '1';
    
    // Add custom draggable handle indicator
    const handle = document.createElement('div');
    handle.className = 'threshold-handle';
    handle.style.position = 'absolute';
    handle.style.width = '20px';
    handle.style.height = '20px';
    handle.style.backgroundColor = '#007bff';
    handle.style.borderRadius = '50%';
    handle.style.top = '5px';
    handle.style.marginLeft = '-10px';
    handle.style.cursor = 'grab';
    handle.style.boxShadow = '0 0 5px rgba(0,0,0,0.3)';
    handle.style.transition = 'transform 0.1s';
    handle.style.zIndex = '10';
    handle.style.border = '2px solid white';
    handle.innerHTML = '<span style="position:absolute;bottom:25px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:12px;background:white;padding:2px 5px;border-radius:3px;box-shadow:0 0 3px rgba(0,0,0,0.2);">Glisser</span>';
    
    // Add a label
    const sliderLabel = document.createElement('div');
    sliderLabel.style.position = 'absolute';
    sliderLabel.style.top = '-20px';
    sliderLabel.style.left = '0';
    sliderLabel.style.fontSize = '14px';
    sliderLabel.textContent = 'Faites glisser pour ajuster le seuil de performance:';
    
    // Insert elements into the container
    const parent = thresholdSlider.parentNode;
    sliderContainer.appendChild(sliderLabel);
    
    // Replace the slider with our container and re-add the slider to it
    parent.replaceChild(sliderContainer, thresholdSlider);
    sliderContainer.appendChild(thresholdSlider);
    sliderContainer.appendChild(handle);
    
    // Update handle position based on slider value
    function updateHandlePosition() {
        const percent = (thresholdSlider.value - thresholdSlider.min) / (thresholdSlider.max - thresholdSlider.min);
        const position = percent * (thresholdSlider.offsetWidth - 20) + 10;
        handle.style.left = position + 'px';
    }
    
    // Initial position
    updateHandlePosition();
    
    // Update on input
    thresholdSlider.addEventListener('input', function() {
        updateHandlePosition();
        thresholdValue.textContent = `${this.value}%`;
        chargerEstimations();
        
        // Animation effect
        handle.style.transform = 'scale(1.2)';
        setTimeout(() => { handle.style.transform = 'scale(1)'; }, 100);
    });
}

// Function to initialize and set up table filters
function initializeTableFilters() {
    const filterPointVente = document.getElementById('filter-point-vente');
    const filterCategorie = document.getElementById('filter-categorie');
    const filterDate = document.getElementById('filter-date');
    const resetFilterBtn = document.getElementById('reset-filters');
    
    if (!filterPointVente || !filterCategorie) {
        console.warn('Filter elements not found');
        return;
    }
    
    console.log('Initializing table filters');
    
    // Initialize date picker for date filter if available
    if (filterDate && typeof flatpickr === 'function') {
        try {
            // We need to use a format that matches how dates are displayed in the table
            const fp = flatpickr(filterDate, {
                dateFormat: 'd-m-Y', // This is what we input
                altFormat: 'd/m/Y',  // This is what might be displayed in the table
                allowInput: true,
                locale: null,
                onClose: function(selectedDates, dateStr) {
                    // This ensures the filter is applied immediately when a date is selected
                    applyFilters();
                }
            });
            
            // Try to detect if there's already a date in the input field (from browser cache/refresh)
            if (filterDate.value) {
                // Parse and reformat it to ensure consistency
                try {
                    const parts = filterDate.value.split(/[-\/]/);
                    if (parts.length === 3) {
                        // Normalize the date format
                        const day = parts[0].padStart(2, '0');
                        const month = parts[1].padStart(2, '0');
                        const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                        filterDate.value = `${day}-${month}-${year}`;
                        
                        // Apply filter since we have a value
                        setTimeout(() => applyFilters(), 100);
                    }
                } catch (e) {
                    console.warn('Failed to parse existing date value:', e);
                }
            }
        } catch (error) {
            console.warn('Error initializing date filter:', error);
            // Add regular change event as fallback
            filterDate.addEventListener('change', applyFilters);
        }
    }
    
    // Populate filter dropdowns with unique values from table
    populateFilterOptions();
    
    // Add event listeners for filters
    filterPointVente.addEventListener('change', applyFilters);
    filterCategorie.addEventListener('change', applyFilters);
    
    // Reset filters button
    if (resetFilterBtn) {
        resetFilterBtn.addEventListener('click', function() {
            filterPointVente.value = '';
            filterCategorie.value = '';
            if (filterDate) {
                filterDate.value = '';
                if (filterDate._flatpickr) {
                    filterDate._flatpickr.clear();
                }
            }
            applyFilters();
        });
    }
}

// Function to populate filter select options from table data
function populateFilterOptions() {
    // Get filter selects
    const filterPointVente = document.getElementById('filter-point-vente');
    const filterCategorie = document.getElementById('filter-categorie');
    
    if (!filterPointVente || !filterCategorie) return;
    
    // Clear existing options (except first one)
    while (filterPointVente.options.length > 1) {
        filterPointVente.remove(1);
    }
    
    while (filterCategorie.options.length > 1) {
        filterCategorie.remove(1);
    }
    
    // Get all rows from table
    const tableRows = document.querySelectorAll('#estimations-table-body tr');
    
    // Extract unique values
    const pointVenteValues = new Set();
    const categorieValues = new Set();
    
    tableRows.forEach(row => {
        // Note: cells[0] is checkbox, cells[1] is date, cells[2] is point de vente, cells[3] is categorie
        const pointVente = row.cells[2]?.textContent?.trim();
        const categorie = row.cells[3]?.textContent?.trim();
        
        if (pointVente) pointVenteValues.add(pointVente);
        if (categorie) categorieValues.add(categorie);
    });
    
    // Add options to point de vente filter
    pointVenteValues.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        filterPointVente.appendChild(option);
    });
    
    // Add options to categorie filter
    categorieValues.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        filterCategorie.appendChild(option);
    });
    
    console.log(`Populated filters with ${pointVenteValues.size} points de vente and ${categorieValues.size} categories`);
}

// Function to apply filters to the table
function applyFilters() {
    const filterPointVente = document.getElementById('filter-point-vente');
    const filterCategorie = document.getElementById('filter-categorie');
    const filterDate = document.getElementById('filter-date');
    const resetFilterBtn = document.getElementById('reset-filters');
    
    const pointVenteValue = filterPointVente?.value || '';
    const categorieValue = filterCategorie?.value || '';
    const dateValue = filterDate?.value || '';
    
    console.log('Applying filters:', { point_vente: pointVenteValue, categorie: categorieValue, date: dateValue });
    
    // Style active filters
    styleActiveFilter(filterPointVente, pointVenteValue !== '');
    styleActiveFilter(filterCategorie, categorieValue !== '');
    styleActiveFilter(filterDate, dateValue !== '');
    
    // Show/hide reset button based on if any filter is active
    const isAnyFilterActive = pointVenteValue !== '' || categorieValue !== '' || dateValue !== '';
    if (resetFilterBtn) {
        resetFilterBtn.classList.toggle('btn-outline-secondary', !isAnyFilterActive);
        resetFilterBtn.classList.toggle('btn-secondary', isAnyFilterActive);
    }
    
    // Get all rows
    const tableRows = document.querySelectorAll('#estimations-table-body tr');
    let visibleRows = 0;
    
    // Check each row against filters
    tableRows.forEach(row => {
        // Get cell values (these are displayed values)
        // Note: cells[0] is checkbox, cells[1] is date, cells[2] is point de vente, cells[3] is categorie
        const rowDate = row.cells[1]?.textContent?.trim();
        const pointVente = row.cells[2]?.textContent?.trim();
        const categorie = row.cells[3]?.textContent?.trim();
        
        // Format the date filter value to match the table display format
        // Our filter uses DD-MM-YYYY but table shows DD/MM/YYYY
        let formattedDateFilter = dateValue;
        if (dateValue) {
            // Check if the date value contains dashes (which is what the date picker uses)
            if (dateValue.includes('-')) {
                // Split the date value by dashes
                const dateParts = dateValue.split('-');
                // If we have 3 parts, format it to match the table display format
                if (dateParts.length === 3) {
                    formattedDateFilter = `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}`;
                }
            }
        }
        
        // Show/hide based on filters
        const pointVenteMatch = !pointVenteValue || pointVente === pointVenteValue;
        const categorieMatch = !categorieValue || categorie === categorieValue;
        
        // For date, compare either the formatted date or the original rowDate
        const dateMatch = !dateValue || 
                         rowDate === formattedDateFilter ||
                         // Also check the original format in case table format is different
                         rowDate === dateValue;
        
        if (pointVenteMatch && categorieMatch && dateMatch) {
            row.style.display = '';
            visibleRows++;
        } else {
            row.style.display = 'none';
        }
    });
    
    console.log(`Filter applied: ${visibleRows} rows visible`);
    
    // Show message if no results
    showNoResultsMessageIfNeeded(visibleRows);
    
    // Update filter label with count of active filters
    updateFilterLabel(isAnyFilterActive ? countActiveFilters(pointVenteValue, categorieValue, dateValue) : 0);
}

// Function to style an active filter
function styleActiveFilter(element, isActive) {
    if (!element) return;
    
    if (isActive) {
        element.classList.add('border-primary');
        element.classList.add('bg-light');
        
        // Add a subtle box shadow
        element.style.boxShadow = '0 0 0 1px rgba(13, 110, 253, 0.25)';
    } else {
        element.classList.remove('border-primary');
        element.classList.remove('bg-light');
        element.style.boxShadow = '';
    }
}

// Function to count active filters
function countActiveFilters(pointVente, categorie, date) {
    let count = 0;
    if (pointVente) count++;
    if (categorie) count++;
    if (date) count++;
    return count;
}

// Function to update the filter label with count of active filters
function updateFilterLabel(activeCount) {
    const filterLabel = document.querySelector('label.form-label strong');
    if (!filterLabel) return;
    
    if (activeCount > 0) {
        filterLabel.innerHTML = `Filtres: <span class="badge bg-primary ms-1">${activeCount}</span>`;
    } else {
        filterLabel.textContent = 'Filtres:';
    }
}

// Function to display a message when no results match the filter
function showNoResultsMessageIfNeeded(visibleRowCount) {
    const tbody = document.getElementById('estimations-table-body');
    
    // Remove existing no-results row if any
    const existingNoResults = document.getElementById('no-filter-results-row');
    if (existingNoResults) {
        tbody.removeChild(existingNoResults);
    }
    
    // If no visible rows, show message
    if (visibleRowCount === 0) {
        const noResultsRow = document.createElement('tr');
        noResultsRow.id = 'no-filter-results-row';
        noResultsRow.innerHTML = `<td colspan="14" class="text-center py-3">Aucun résultat ne correspond aux filtres sélectionnés</td>`;
        tbody.appendChild(noResultsRow);
    }
} 

// Function to export estimation data to Excel
async function exportEstimationsToExcel() {
    try {
        // Check if XLSX library is loaded
        if (typeof XLSX === 'undefined') {
            console.error("Erreur: La bibliothèque XLSX n'est pas chargée.");
            alert("Erreur: La bibliothèque XLSX n'est pas chargée. Veuillez rafraîchir la page.");
            return;
        }

        // Show loading indicator
        const loadingHtml = `
            <div id="export-loading" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                 background: white; padding: 20px; border: 2px solid #007bff; border-radius: 8px; z-index: 1000; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
                <div class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Chargement...</span>
                    </div>
                    <p class="mt-2 mb-0">Export des estimations en cours...</p>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', loadingHtml);

        // Fetch all estimations from the API
        const response = await fetch('/api/estimations', {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Erreur lors de la récupération des données');
        }

        const estimations = data.estimations || [];

        if (estimations.length === 0) {
            // Remove loading indicator
            const loadingElement = document.getElementById('export-loading');
            if (loadingElement) {
                loadingElement.remove();
            }
            alert('Aucune estimation à exporter');
            return;
        }

        // Get current threshold value for status calculation
        const thresholdSlider = document.getElementById('performance-threshold');
        const thresholdValue = thresholdSlider ? parseInt(thresholdSlider.value) : 5;

        // Prepare data for Excel export
        const exportData = estimations.map(estimation => {
            // Get values with fallbacks
            const stockMatin = estimation.stockMatin || 0;
            const transfert = estimation.transfert || 0;
            const stockSoir = estimation.stockSoir || 0;
            const preCommandeDemain = estimation.preCommandeDemain || 0;
            const previsionVentes = estimation.previsionVentes || 0;
            
            // Use saved theoretical sales if available, otherwise calculate manually  
            const ventesTheo = estimation.ventesTheoriques !== null && estimation.ventesTheoriques !== undefined
                ? estimation.ventesTheoriques 
                : stockMatin + transfert - stockSoir;
            
            // Calculate difference (ventes théo - estimation seulement, pré-commande incluse dans estimation)
            const difference = ventesTheo - previsionVentes;
            
            // Calculate difference percentage (better logic: based on theoretical sales)
            const differencePercentage = ventesTheo === 0 ? 'N.A' : (difference / ventesTheo) * 100;
            
            // Get status indicator
            const statusIndicator = getStatusIndicator(differencePercentage, thresholdValue);
            
            // Determine status text based on the indicator
            let statusText = 'Normal';
            const hasRealVentesTheo = estimation.ventesTheoriques !== null && estimation.ventesTheoriques !== undefined && estimation.ventesTheoriques > 0;
            
            if (!hasRealVentesTheo) {
                statusText = 'En attente';
            } else if (differencePercentage === 'N.A') {
                statusText = 'N.A';
            } else if (statusIndicator.includes('text-danger')) {
                statusText = 'Erreur';
            } else if (statusIndicator.includes('text-warning')) {
                statusText = 'Attention';
            }

            return {
                'Date': formatDate(estimation.date),
                'Point de Vente': estimation.pointVente,
                'Catégorie': estimation.categorie,
                'Stock Matin (kg)': parseFloat(estimation.stockMatin || 0),
                'Transfert (kg)': parseFloat(estimation.transfert || 0),
                'Stock Soir (kg)': parseFloat(estimation.stockSoir || 0),
                'Ventes Théoriques (kg)': parseFloat(ventesTheo),
                'Pré-commande (kg)': parseFloat(estimation.preCommandeDemain || 0),
                'Prévision (kg)': parseFloat(estimation.previsionVentes || 0),
                'Différence (kg)': parseFloat(difference),
                'Différence (%)': differencePercentage === 'N.A' ? 'N.A' : parseFloat(differencePercentage),
                'Status': statusText,
                'Commentaire': estimation.commentaire || ''
            };
        });

        // Create workbook and worksheet
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportData);

        // Format numeric columns
        const range = XLSX.utils.decode_range(worksheet['!ref']);
        const headers = Object.keys(exportData[0]);
        
        for (let R = range.s.r + 1; R <= range.e.r; ++R) {
            headers.forEach((header, C) => {
                const cell_address = { c: C, r: R };
                const cell_ref = XLSX.utils.encode_cell(cell_address);
                
                if (worksheet[cell_ref] && typeof worksheet[cell_ref].v === 'number') {
                    worksheet[cell_ref].t = 'n';
                    
                    // Format percentage column
                    if (header.includes('%')) {
                        worksheet[cell_ref].z = '0.00%';
                        // Convert percentage value back to decimal for Excel
                        worksheet[cell_ref].v = worksheet[cell_ref].v / 100;
                    } else if (header.includes('kg') || header.includes('Kg')) {
                        // Format weight columns with 3 decimal places
                        worksheet[cell_ref].z = '#,##0.000';
                    }
                }
            });
        }

        // Set column widths
        const colWidths = headers.map(header => {
            switch (true) {
                case header === 'Date': return { wch: 12 };
                case header === 'Point de Vente': return { wch: 15 };
                case header === 'Catégorie': return { wch: 12 };
                case header.includes('kg') || header.includes('Kg'): return { wch: 15 };
                case header.includes('%'): return { wch: 12 };
                case header === 'Status': return { wch: 10 };
                default: return { wch: 12 };
            }
        });
        worksheet['!cols'] = colWidths;

        // Add the worksheet to the workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Estimations');

        // Generate filename with current date
        const currentDate = new Date();
        const dateStr = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        let filename = `Estimations_${dateStr}`;
        
        // Add threshold information to filename
        filename += `_seuil_${thresholdValue}%`;
        filename += '.xlsx';

        // Save the file
        XLSX.writeFile(workbook, filename);

        // Remove loading indicator
        const loadingElement = document.getElementById('export-loading');
        if (loadingElement) {
            loadingElement.remove();
        }

        // Show success message
        alert(`Export Excel réussi !\n\nDonnées exportées: ${estimations.length} estimations\nSeuil de performance: ${thresholdValue}%\nFichier: ${filename}`);

    } catch (error) {
        console.error('Erreur lors de l\'export Excel des estimations:', error);
        
        // Remove loading indicator in case of error
        const loadingElement = document.getElementById('export-loading');
        if (loadingElement) {
            loadingElement.remove();
        }
        
        alert('Erreur lors de l\'export Excel : ' + error.message);
    }
}

// Function to toggle stock columns visibility
function toggleStockColumns() {
    const stockColumns = document.querySelectorAll('.stock-column');
    const toggleBtn = document.getElementById('toggle-stock-columns');
    
    if (!stockColumns.length || !toggleBtn) {
        console.warn('Stock columns or toggle button not found');
        return;
    }
    
    // Check current state
    const isHidden = stockColumns[0].style.display === 'none';
    
    stockColumns.forEach(column => {
        column.style.display = isHidden ? 'table-cell' : 'none';
    });
    
    // Update button text and icon
    if (isHidden) {
        toggleBtn.innerHTML = '<i class="bi bi-eye-slash"></i> Masquer Stocks';
        toggleBtn.className = 'btn btn-info btn-sm';
    } else {
        toggleBtn.innerHTML = '<i class="bi bi-bar-chart"></i> Afficher Stocks';
        toggleBtn.className = 'btn btn-outline-info btn-sm';
    }
    
    console.log('Stock columns toggled:', isHidden ? 'shown' : 'hidden');
}

// Function to add recalculation functionality
function ajouterFonctionnaliteRecalcul() {
    // Add global recalculate button functionality
    const selectAllCheckbox = document.getElementById('select-all-estimations');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
            const checkboxes = document.querySelectorAll('.estimation-checkbox');
            checkboxes.forEach(cb => cb.checked = this.checked);
        });
    }
}

// Initialize stock column toggle functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Set up toggle button
    const toggleBtn = document.getElementById('toggle-stock-columns');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleStockColumns);
    }
    
    // Add recalculation functionality
    ajouterFonctionnaliteRecalcul();
});

// Make functions globally available
window.exportEstimationsToExcel = exportEstimationsToExcel;
window.recalculerVentesTheo = recalculerVentesTheo;
window.supprimerEstimation = supprimerEstimation; 