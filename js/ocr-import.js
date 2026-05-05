/**
 * OCR Import Module - Extraction de données depuis images de tickets de caisse
 * Utilise GPT-4o Vision pour l'OCR et l'extraction structurée
 * Avec système de matching entre labels importés et produits existants
 */

let ocrExtractedData = [];
let existingProducts = []; // Produits existants dans la base
let productMappings = {}; // Mappings sauvegardés (localStorage)

// Clé localStorage pour les mappings
const MAPPING_STORAGE_KEY = 'ocr_product_mappings';

/**
 * Initialise le module d'import OCR
 */
function initOCRImport() {
    const dropZone = document.getElementById('ocr-drop-zone');
    const fileInput = document.getElementById('ocr-image-input');
    const previewContainer = document.getElementById('ocr-image-preview');
    const previewImg = document.getElementById('ocr-preview-img');
    const removeBtn = document.getElementById('ocr-remove-image');
    const extractBtn = document.getElementById('ocr-extract-btn');
    const dateInput = document.getElementById('ocr-date');
    const pointVenteSelect = document.getElementById('ocr-point-vente');

    if (!dropZone) {
        console.log('🖼️ OCR Import: Section non trouvée, module non initialisé');
        return;
    }

    console.log('🖼️ Initialisation du module Import OCR');

    // Charger les mappings sauvegardés
    loadSavedMappings();

    // Charger les produits existants
    loadExistingProducts();

    // Initialiser le datepicker
    if (dateInput && typeof flatpickr !== 'undefined') {
        flatpickr(dateInput, {
            dateFormat: 'Y-m-d',
            defaultDate: new Date(),
            locale: 'fr'
        });
    }

    // Charger les points de vente
    loadOCRPointsVente();

    // Gestionnaire de clic sur la zone de drop
    dropZone.addEventListener('click', () => fileInput.click());

    // Gestionnaire de drag & drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#764ba2';
        dropZone.style.backgroundColor = 'rgba(102, 126, 234, 0.1)';
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#667eea';
        dropZone.style.backgroundColor = '';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#667eea';
        dropZone.style.backgroundColor = '';
        
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('image/')) {
            handleOCRImageFile(files[0]);
        }
    });

    // Gestionnaire de sélection de fichier
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleOCRImageFile(e.target.files[0]);
        }
    });

    // Gestionnaire de suppression d'image
    removeBtn.addEventListener('click', resetOCRImage);

    // Gestionnaire d'extraction
    extractBtn.addEventListener('click', extractOCRData);

    // Gestionnaires des résultats
    document.getElementById('ocr-check-all')?.addEventListener('change', (e) => {
        document.querySelectorAll('#ocr-table-body input[type="checkbox"]').forEach(cb => {
            cb.checked = e.target.checked;
        });
        updateOCRSelection();
    });

    document.getElementById('ocr-select-all')?.addEventListener('click', () => {
        document.querySelectorAll('#ocr-table-body input[type="checkbox"]').forEach(cb => {
            cb.checked = true;
        });
        document.getElementById('ocr-check-all').checked = true;
        updateOCRSelection();
    });

    document.getElementById('ocr-clear-results')?.addEventListener('click', () => {
        document.getElementById('ocr-results').style.display = 'none';
        ocrExtractedData = [];
    });

    document.getElementById('ocr-cancel')?.addEventListener('click', () => {
        document.getElementById('ocr-results').style.display = 'none';
        ocrExtractedData = [];
    });

    document.getElementById('ocr-import-btn')?.addEventListener('click', importOCRData);
    
    // Gestionnaire pour ajouter une ligne manuelle
    document.getElementById('ocr-add-manual-row')?.addEventListener('click', addManualOCRRow);
}

/**
 * Charge les mappings sauvegardés depuis localStorage
 */
function loadSavedMappings() {
    try {
        const saved = localStorage.getItem(MAPPING_STORAGE_KEY);
        if (saved) {
            productMappings = JSON.parse(saved);
            console.log('📋 Mappings chargés:', Object.keys(productMappings).length);
        }
    } catch (e) {
        console.error('Erreur chargement mappings:', e);
        productMappings = {};
    }
}

/**
 * Sauvegarde un mapping
 */
function saveMapping(originalLabel, mappedProduct) {
    productMappings[originalLabel.toLowerCase()] = mappedProduct;
    try {
        localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(productMappings));
        console.log(`💾 Mapping sauvegardé: "${originalLabel}" → "${mappedProduct}"`);
    } catch (e) {
        console.error('Erreur sauvegarde mapping:', e);
    }
}

/**
 * Récupère un mapping sauvegardé
 */
function getSavedMapping(originalLabel) {
    return productMappings[originalLabel.toLowerCase()] || null;
}

/**
 * Charge les produits existants depuis l'API
 */
async function loadExistingProducts() {
    try {
        // Charger les produits de vente
        const response = await fetch('/api/admin/config/produits', { credentials: 'include' });
        const data = await response.json();
        
        existingProducts = [];
        
        if (data.success && data.produits) {
            // Extraire tous les produits de toutes les catégories
            Object.entries(data.produits).forEach(([categorie, produits]) => {
                Object.keys(produits).forEach(produit => {
                    existingProducts.push({
                        nom: produit,
                        categorie: categorie,
                        type: 'vente'
                    });
                });
            });
        }
        
        // Charger aussi les produits d'inventaire
        const invResponse = await fetch('/api/admin/config/produits-inventaire', { credentials: 'include' });
        const invData = await invResponse.json();
        
        if (invData.success && invData.produitsInventaire) {
            const processInventaire = (obj, prefix = '') => {
                Object.entries(obj).forEach(([key, value]) => {
                    if (value && typeof value === 'object' && value.prixDefault !== undefined) {
                        // C'est un produit
                        const produitNom = prefix ? `${prefix}.${key}` : key;
                        if (!existingProducts.find(p => p.nom.toLowerCase() === produitNom.toLowerCase())) {
                            existingProducts.push({
                                nom: produitNom,
                                categorie: prefix || 'Inventaire',
                                type: 'inventaire'
                            });
                        }
                    } else if (value && typeof value === 'object') {
                        // C'est une catégorie
                        processInventaire(value, key);
                    }
                });
            };
            processInventaire(invData.produitsInventaire);
        }
        
        // Trier par nom
        existingProducts.sort((a, b) => a.nom.localeCompare(b.nom));
        
        console.log(`📦 ${existingProducts.length} produits existants chargés`);
    } catch (error) {
        console.error('Erreur chargement produits existants:', error);
        existingProducts = [];
    }
}

/**
 * Calcule la similarité entre deux chaînes (algorithme de Levenshtein simplifié)
 */
function calculateSimilarity(str1, str2) {
    const s1 = str1.toLowerCase().replace(/^kg\s+/i, '').trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 1;
    
    // Vérifier si l'un contient l'autre
    if (s1.includes(s2) || s2.includes(s1)) {
        return 0.8;
    }
    
    // Calculer la distance de Levenshtein
    const matrix = [];
    const len1 = s1.length;
    const len2 = s2.length;
    
    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;
    
    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    
    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - (distance / maxLen);
}

/**
 * Trouve les meilleurs matchs pour un label importé
 */
function findBestMatches(importedLabel, limit = 5) {
    const matches = existingProducts.map(product => ({
        product: product,
        similarity: calculateSimilarity(importedLabel, product.nom)
    }));
    
    // Trier par similarité décroissante
    matches.sort((a, b) => b.similarity - a.similarity);
    
    // Retourner les meilleurs matchs (similarité > 0.3)
    return matches.filter(m => m.similarity > 0.3).slice(0, limit);
}

/**
 * Charge les points de vente dans le select
 */
function loadOCRPointsVente() {
    const pointVenteSelect = document.getElementById('ocr-point-vente');
    if (!pointVenteSelect) return;

    // Clear existing options first
    pointVenteSelect.innerHTML = '';
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Sélectionner un point de vente';
    pointVenteSelect.appendChild(defaultOption);
    
    // Utiliser POINTS_VENTE si disponible (variable globale de script.js)
    if (typeof POINTS_VENTE !== 'undefined' && Array.isArray(POINTS_VENTE)) {
        POINTS_VENTE.forEach(pv => {
            const option = document.createElement('option');
            option.value = pv;
            option.textContent = pv;
            pointVenteSelect.appendChild(option);
        });
    } else {
        // Fallback: charger depuis l'API
        fetch('/api/points-vente', { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    data.forEach(pv => {
                        const option = document.createElement('option');
                        option.value = pv;
                        option.textContent = pv;
                        pointVenteSelect.appendChild(option);
                    });
                }
            })
            .catch(err => console.error('Erreur chargement points de vente:', err));
    }
}

/**
 * Réinitialise l'image OCR
 */
function resetOCRImage() {
    const previewImg = document.getElementById('ocr-preview-img');
    const previewContainer = document.getElementById('ocr-image-preview');
    const dropZone = document.getElementById('ocr-drop-zone');
    const extractBtn = document.getElementById('ocr-extract-btn');
    const fileInput = document.getElementById('ocr-image-input');

    previewImg.src = '';
    previewContainer.style.display = 'none';
    dropZone.style.display = 'block';
    extractBtn.disabled = true;
    fileInput.value = '';
}

/**
 * Gère le fichier image sélectionné
 */
function handleOCRImageFile(file) {
    const dropZone = document.getElementById('ocr-drop-zone');
    const previewContainer = document.getElementById('ocr-image-preview');
    const previewImg = document.getElementById('ocr-preview-img');
    const extractBtn = document.getElementById('ocr-extract-btn');

    // Vérifier le type de fichier
    if (!file.type.startsWith('image/')) {
        alert('Veuillez sélectionner une image (JPG, PNG, WEBP)');
        return;
    }

    // Vérifier la taille (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
        alert('L\'image est trop volumineuse (max 20MB)');
        return;
    }

    // Afficher l'aperçu
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImg.src = e.target.result;
        previewImg.dataset.mimeType = file.type;
        previewContainer.style.display = 'block';
        dropZone.style.display = 'none';
        extractBtn.disabled = false;
    };
    reader.readAsDataURL(file);
}

/**
 * Extrait les données de l'image via OCR
 */
async function extractOCRData() {
    const previewImg = document.getElementById('ocr-preview-img');
    const statusDiv = document.getElementById('ocr-status');
    const statusText = document.getElementById('ocr-status-text');
    const resultsDiv = document.getElementById('ocr-results');
    const extractBtn = document.getElementById('ocr-extract-btn');

    if (!previewImg.src) {
        alert('Veuillez d\'abord sélectionner une image');
        return;
    }

    // Recharger les produits existants
    await loadExistingProducts();

    // Afficher le statut
    statusDiv.style.display = 'block';
    statusDiv.className = 'alert alert-info';
    statusText.textContent = 'Extraction en cours via GPT-4o Vision...';
    extractBtn.disabled = true;
    resultsDiv.style.display = 'none';

    try {
        // Extraire le base64 de l'image
        const imageData = previewImg.src.split(',')[1];
        const mimeType = previewImg.dataset.mimeType || 'image/jpeg';

        const response = await fetch('/api/ocr-extract', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                image: imageData,
                mimeType: mimeType
            })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Erreur lors de l\'extraction');
        }

        // Stocker les données extraites
        ocrExtractedData = result.data.items;

        // Appliquer les mappings sauvegardés et chercher les correspondances
        ocrExtractedData.forEach(item => {
            // Vérifier si on a un mapping sauvegardé
            const savedMapping = getSavedMapping(item.article_original);
            if (savedMapping) {
                item.produit = savedMapping;
                item.matched = true;
                item.matchSource = 'saved';
            } else {
                // Chercher les meilleurs matchs
                const matches = findBestMatches(item.article_original);
                item.suggestedMatches = matches;
                
                // Si on a un match très proche (>80%), l'appliquer automatiquement
                if (matches.length > 0 && matches[0].similarity > 0.8) {
                    item.produit = matches[0].product.nom;
                    item.matched = true;
                    item.matchSource = 'auto';
                    item.matchSimilarity = matches[0].similarity;
                }
            }
        });

        // Afficher les résultats
        displayOCRResults(result.data);

        statusDiv.style.display = 'none';
        resultsDiv.style.display = 'block';
        extractBtn.disabled = false;

    } catch (error) {
        console.error('Erreur OCR:', error);
        statusText.textContent = `Erreur: ${error.message}`;
        statusDiv.className = 'alert alert-danger';
        extractBtn.disabled = false;
    }
}

/**
 * Génère le HTML du select de matching pour un item
 */
function generateMatchingSelect(item, index) {
    let options = `<option value="">-- Nouveau produit --</option>`;
    
    // Ajouter les matchs suggérés en premier
    if (item.suggestedMatches && item.suggestedMatches.length > 0) {
        options += `<optgroup label="📊 Suggestions (similarité)">`;
        item.suggestedMatches.forEach(match => {
            const percent = Math.round(match.similarity * 100);
            const selected = item.produit === match.product.nom ? 'selected' : '';
            options += `<option value="${escapeHtml(match.product.nom)}" ${selected}>
                ${escapeHtml(match.product.nom)} (${percent}%) - ${match.product.categorie}
            </option>`;
        });
        options += `</optgroup>`;
    }
    
    // Ajouter tous les produits existants
    options += `<optgroup label="📦 Tous les produits">`;
    existingProducts.forEach(product => {
        const selected = item.produit === product.nom ? 'selected' : '';
        options += `<option value="${escapeHtml(product.nom)}" ${selected}>
            ${escapeHtml(product.nom)} - ${product.categorie}
        </option>`;
    });
    options += `</optgroup>`;
    
    return `
        <select class="form-select form-select-sm ocr-match-select" data-index="${index}" 
                style="min-width: 200px; ${item.matched ? 'border-color: #28a745;' : ''}">
            ${options}
        </select>
        ${item.matched ? `<small class="text-success d-block">✓ ${item.matchSource === 'saved' ? 'Mapping sauvegardé' : 'Auto-détecté'}</small>` : ''}
    `;
}

/**
 * Affiche les résultats de l'extraction OCR
 */
function displayOCRResults(data) {
    const tbody = document.getElementById('ocr-table-body');
    const countBadge = document.getElementById('ocr-count');
    const totalCell = document.getElementById('ocr-total');

    tbody.innerHTML = '';
    
    data.items.forEach((item, index) => {
        const row = document.createElement('tr');
        // Différencier visuellement les lignes manuelles
        if (item.isManual) {
            row.className = 'table-info'; // Bleu clair pour les lignes manuelles
        } else {
            row.className = item.matched ? 'table-success' : '';
        }
        
        row.innerHTML = `
            <td>
                <input type="checkbox" class="form-check-input ocr-item-check" 
                       data-index="${index}" ${item.selected !== false ? 'checked' : ''}>
                ${item.isManual ? '<br><small class="badge bg-info">➕</small>' : ''}
            </td>
            <td>
                ${item.isManual ? 
                    `<input type="text" class="form-control form-control-sm" 
                            data-index="${index}" 
                            onchange="ocrExtractedData[${index}].article_original = this.value"
                            placeholder="Ex: KG AIL" 
                            value="${escapeHtml(item.article_original)}">` :
                    `<strong>${escapeHtml(item.article_original)}</strong>`
                }
                <br>
                <small class="text-muted">
                    Unité: 
                    ${item.isManual ? 
                        `<select class="form-select form-select-sm d-inline-block" style="width: auto;" 
                                onchange="ocrExtractedData[${index}].unite = this.value">
                            <option value="unite" ${item.unite === 'unite' ? 'selected' : ''}>Unité</option>
                            <option value="kilo" ${item.unite === 'kilo' ? 'selected' : ''}>Kg</option>
                        </select>
                        | Mode: 
                        <select class="form-select form-select-sm d-inline-block" style="width: auto;" 
                                onchange="ocrExtractedData[${index}].mode_stock = this.value"
                                title="Mode de gestion du stock">
                            <option value="automatique" ${item.mode_stock === 'automatique' ? 'selected' : ''}>⚡ Auto</option>
                            <option value="manuel" ${item.mode_stock === 'manuel' ? 'selected' : ''}>🔧 Manuel</option>
                        </select>` :
                        (item.unite === 'kilo' ? 'Kg' : 'Unité')
                    }
                </small>
            </td>
            <td>
                ${generateMatchingSelect(item, index)}
            </td>
            <td>
                <input type="text" class="form-control form-control-sm ocr-produit-custom" 
                       data-index="${index}" value="${escapeHtml(item.produit)}"
                       placeholder="Ou saisir un nom" style="display: ${item.matched ? 'none' : 'block'};">
            </td>
            <td>
                <input type="number" class="form-control form-control-sm ocr-quantite" 
                       data-index="${index}" value="${item.quantite}" step="0.01" min="0" style="width: 80px;">
            </td>
            <td>
                <input type="number" class="form-control form-control-sm ocr-prix" 
                       data-index="${index}" value="${item.prix_unitaire}" step="1" min="0" style="width: 90px;">
            </td>
            <td class="text-end fw-bold ocr-montant" data-index="${index}">
                ${item.montant.toLocaleString('fr-FR')} FCFA
            </td>
            <td>
                <button type="button" class="btn btn-sm btn-outline-danger ocr-delete-row" data-index="${index}" title="Supprimer">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Ajouter les gestionnaires d'événements
    tbody.querySelectorAll('.ocr-item-check').forEach(cb => {
        cb.addEventListener('change', updateOCRSelection);
    });

    tbody.querySelectorAll('.ocr-match-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            const selectedValue = e.target.value;
            const customInput = document.querySelector(`.ocr-produit-custom[data-index="${index}"]`);
            
            if (selectedValue) {
                // Produit existant sélectionné
                ocrExtractedData[index].produit = selectedValue;
                ocrExtractedData[index].matched = true;
                customInput.style.display = 'none';
                e.target.style.borderColor = '#28a745';
                
                // Sauvegarder le mapping
                saveMapping(ocrExtractedData[index].article_original, selectedValue);
            } else {
                // Nouveau produit
                ocrExtractedData[index].matched = false;
                customInput.style.display = 'block';
                const orig = String(ocrExtractedData[index].article_original || '');
                customInput.value = orig.replace(/^KG\s+/i, '');
                ocrExtractedData[index].produit = customInput.value;
                e.target.style.borderColor = '';
            }
        });
    });

    tbody.querySelectorAll('.ocr-produit-custom').forEach(input => {
        input.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            // Trim pour éviter qu'un espace en trop crée un doublon (" Boeuf"
            // != "Boeuf" côté lookup BDD).
            ocrExtractedData[index].produit = String(e.target.value || '').trim();
        });
    });

    tbody.querySelectorAll('.ocr-quantite, .ocr-prix').forEach(input => {
        input.addEventListener('change', (e) => updateOCRItem(e.target));
    });

    tbody.querySelectorAll('.ocr-delete-row').forEach(btn => {
        btn.addEventListener('click', (e) => deleteOCRRow(e.target.closest('button').dataset.index));
    });

    countBadge.textContent = data.items.length;
    totalCell.textContent = `${data.total_general.toLocaleString('fr-FR')} FCFA`;

    updateOCRSelection();
}

/**
 * Échappe les caractères HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Met à jour un élément OCR après modification
 */
function updateOCRItem(input) {
    const index = parseInt(input.dataset.index);
    const item = ocrExtractedData[index];

    if (!item) return;

    if (input.classList.contains('ocr-quantite')) {
        item.quantite = parseFloat(input.value) || 0;
        item.montant = item.quantite * item.prix_unitaire;
    } else if (input.classList.contains('ocr-prix')) {
        item.prix_unitaire = parseFloat(input.value) || 0;
        item.montant = item.quantite * item.prix_unitaire;
    }

    // Mettre à jour l'affichage du montant
    const montantCell = document.querySelector(`.ocr-montant[data-index="${index}"]`);
    if (montantCell) {
        montantCell.textContent = `${item.montant.toLocaleString('fr-FR')} FCFA`;
    }

    updateOCRTotal();
}

/**
 * Supprime une ligne OCR
 */
function deleteOCRRow(index) {
    ocrExtractedData.splice(parseInt(index), 1);
    displayOCRResults({ items: ocrExtractedData, total_general: calculateOCRTotal() });
}

/**
 * Calcule le total OCR des items sélectionnés
 */
function calculateOCRTotal() {
    return ocrExtractedData
        .filter((_, index) => {
            const cb = document.querySelector(`.ocr-item-check[data-index="${index}"]`);
            return cb && cb.checked;
        })
        .reduce((sum, item) => sum + (item.montant || 0), 0);
}

/**
 * Met à jour le total OCR affiché
 */
function updateOCRTotal() {
    const totalCell = document.getElementById('ocr-total');
    if (totalCell) {
        totalCell.textContent = `${calculateOCRTotal().toLocaleString('fr-FR')} FCFA`;
    }
}

/**
 * Met à jour la sélection OCR et le bouton d'import
 */
function updateOCRSelection() {
    const importBtn = document.getElementById('ocr-import-btn');
    const selectedCount = document.querySelectorAll('#ocr-table-body input[type="checkbox"]:checked').length;
    const matchedCount = ocrExtractedData.filter(item => item.matched).length;
    
    if (importBtn) {
        importBtn.disabled = selectedCount === 0;
        importBtn.innerHTML = selectedCount > 0 
            ? `<i class="bi bi-check-lg me-2"></i>Importer ${selectedCount} vente(s) (${matchedCount} matchées)` 
            : '<i class="bi bi-check-lg me-2"></i>Importer les ventes sélectionnées';
    }

    updateOCRTotal();
}

/**
 * Importe les données OCR sélectionnées dans l'application
 */
async function importOCRData() {
    const dateInput = document.getElementById('ocr-date');
    const pointVenteSelect = document.getElementById('ocr-point-vente');
    const categorieSelect = document.getElementById('ocr-categorie');

    // Validation
    if (!dateInput.value) {
        alert('Veuillez sélectionner une date');
        return;
    }
    if (!pointVenteSelect.value) {
        alert('Veuillez sélectionner un point de vente');
        return;
    }

    // Récupérer les items sélectionnés
    const selectedItems = ocrExtractedData.filter((_, index) => {
        const cb = document.querySelector(`.ocr-item-check[data-index="${index}"]`);
        return cb && cb.checked;
    });

    if (selectedItems.length === 0) {
        alert('Veuillez sélectionner au moins une ligne à importer');
        return;
    }

    // Confirmation
    const matchedItems = selectedItems.filter(item => item.matched).length;
    const newItems = selectedItems.length - matchedItems;
    let confirmMsg = `Importer ${selectedItems.length} vente(s) pour le ${dateInput.value} à ${pointVenteSelect.value} ?\n\n`;
    confirmMsg += `✅ ${matchedItems} produit(s) existant(s)\n`;
    confirmMsg += `🆕 ${newItems} nouveau(x) produit(s) à créer`;
    
    const ok = await showConfirmModal(confirmMsg, {
        title: 'Importer les ventes OCR', okLabel: 'Importer', okVariant: 'success'
    });
    if (!ok) {
        return;
    }

    const importBtn = document.getElementById('ocr-import-btn');
    importBtn.disabled = true;
    importBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Import en cours...';

    try {
        const date = dateInput.value;
        const pointVente = pointVenteSelect.value;
        const categorieDefault = categorieSelect.value || 'Import OCR';

        // Calculer mois et semaine à partir de la date
        const dateObj = new Date(date);
        const moisNoms = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                          'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
        const mois = moisNoms[dateObj.getMonth()];
        
        // Calculer le numéro de semaine ISO 8601
        const getISOWeek = (d) => {
            const target = new Date(d.valueOf());
            const dayNr = (d.getDay() + 6) % 7; // Monday = 0
            target.setDate(target.getDate() - dayNr + 3); // Nearest Thursday
            const jan4 = new Date(target.getFullYear(), 0, 4);
            const dayDiff = (target - jan4) / 86400000;
            return 1 + Math.floor(dayDiff / 7);
        };
        const weekNumber = getISOWeek(dateObj);
        const semaine = `S${weekNumber}`;

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const item of selectedItems) {
            try {
                const venteData = {
                    date: date,
                    mois: mois,
                    semaine: semaine,
                    pointVente: pointVente,
                    categorie: categorieDefault,
                    produit: item.produit,
                    nombre: item.quantite,
                    prixUnit: item.prix_unitaire,
                    montant: item.montant,
                    preparation: pointVente, // Par défaut = Point de Vente
                    creance: 'Non',
                    nomClient: '',
                    numeroClient: '',
                    adresseClient: '',
                    // Info pour création auto du produit inventaire
                    article_original: item.article_original,
                    unite_import: item.unite,
                    mode_stock_import: item.mode_stock || 'automatique' // Passer le mode de stock
                };

                const response = await fetch('/api/ventes', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify(venteData)
                });

                const result = await response.json();
                if (result.success) {
                    successCount++;
                    
                    // Sauvegarder le mapping si c'était un nouveau match manuel
                    if (!item.matched && item.article_original) {
                        saveMapping(item.article_original, item.produit);
                    }
                } else {
                    console.error('Erreur import vente:', result);
                    errorCount++;
                    errors.push(`${item.produit}: ${result.message || 'Erreur inconnue'}`);
                }
            } catch (err) {
                console.error('Erreur import item:', err);
                errorCount++;
                errors.push(`${item.produit}: ${err.message}`);
            }
        }

        // Afficher le résultat
        let message = `Import terminé!\n✅ ${successCount} vente(s) importée(s)`;
        if (errorCount > 0) {
            message += `\n❌ ${errorCount} erreur(s):\n${errors.slice(0, 5).join('\n')}`;
            if (errors.length > 5) {
                message += `\n... et ${errors.length - 5} autres erreurs`;
            }
        }
        alert(message);
        
        if (successCount > 0) {
            // Enregistrer dans l'historique
            try {
                const totalMontant = selectedItems.reduce((sum, item) => sum + (item.montant || 0), 0);
                await fetch('/api/ocr-imports', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        date_ventes: date,
                        point_vente: pointVente,
                        categorie: categorieDefault,
                        nombre_lignes: successCount,
                        total_montant: totalMontant,
                        donnees_json: {
                            items: selectedItems,
                            errors: errors,
                            mois: mois,
                            semaine: semaine
                        }
                    })
                });
                console.log('📋 Import enregistré dans l\'historique');
            } catch (histErr) {
                console.error('Erreur enregistrement historique:', histErr);
            }
            
            // Réinitialiser
            document.getElementById('ocr-results').style.display = 'none';
            resetOCRImage();
            ocrExtractedData = [];
            
            // Rafraîchir l'historique
            loadOCRHistory();
            
            // Rafraîchir les ventes si la fonction existe
            if (typeof chargerVentes === 'function') {
                chargerVentes();
            }
            
            // Recharger les produits existants pour le prochain import
            loadExistingProducts();
        }

    } catch (error) {
        console.error('Erreur import OCR:', error);
        alert('Erreur lors de l\'import: ' + error.message);
    } finally {
        importBtn.disabled = false;
        importBtn.innerHTML = '<i class="bi bi-check-lg me-2"></i>Importer les ventes sélectionnées';
        updateOCRSelection();
    }
}

/**
 * Ajoute une ligne manuelle vide pour saisie
 */
function addManualOCRRow() {
    const newItem = {
        id: ocrExtractedData.length + 1,
        article_original: '',
        produit: '',
        quantite: 1,
        unite: 'unite',
        prix_unitaire: 0,
        montant: 0,
        selected: true,
        matched: false,
        isManual: true,  // Flag pour identifier les lignes manuelles
        mode_stock: 'automatique'  // Mode stock par défaut: automatique
    };
    
    ocrExtractedData.push(newItem);
    displayOCRResults({ items: ocrExtractedData, total_general: calculateOCRTotal() });
    
    // Focus sur le premier champ de la nouvelle ligne
    const newIndex = ocrExtractedData.length - 1;
    setTimeout(() => {
        const firstInput = document.querySelector(`.ocr-produit-custom[data-index="${newIndex}"]`);
        if (firstInput) {
            firstInput.focus();
        }
    }, 100);
}

/**
 * Affiche la section Import Image
 */
function showImportImageSection() {
    // Cacher toutes les sections
    if (typeof hideAllSections === 'function') {
        hideAllSections();
    }
    
    const section = document.getElementById('import-image-section');
    if (section) {
        section.style.display = 'block';
    }
    
    // Mettre à jour l'onglet actif
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    const tab = document.getElementById('import-image-tab');
    if (tab) {
        tab.classList.add('active');
    }
    
    // Recharger les points de vente et produits
    loadOCRPointsVente();
    loadExistingProducts();
    
    // Charger l'historique
    loadOCRHistory();
}

// ============================================================================
// HISTORIQUE DES IMPORTS OCR
// ============================================================================

let ocrHistoryPage = 1;
const ocrHistoryLimit = 10;

/**
 * Charge l'historique des imports OCR
 */
async function loadOCRHistory(page = 1) {
    const tbody = document.getElementById('ocr-history-body');
    if (!tbody) return;
    
    tbody.innerHTML = `
        <tr>
            <td colspan="7" class="text-center text-muted">
                <div class="spinner-border spinner-border-sm me-2"></div>Chargement...
            </td>
        </tr>
    `;
    
    try {
        const offset = (page - 1) * ocrHistoryLimit;
        const response = await fetch(`/api/ocr-imports?limit=${ocrHistoryLimit}&offset=${offset}`, {
            credentials: 'include'
        });
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Erreur chargement historique');
        }
        
        ocrHistoryPage = page;
        displayOCRHistory(result.data, result.total);
        
    } catch (error) {
        console.error('Erreur chargement historique OCR:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-danger">
                    <i class="bi bi-exclamation-triangle me-2"></i>Erreur: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Affiche l'historique des imports OCR
 */
function displayOCRHistory(imports, total) {
    const tbody = document.getElementById('ocr-history-body');
    
    if (!imports || imports.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted">
                    <i class="bi bi-inbox me-2"></i>Aucun import dans l'historique
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = imports.map(imp => {
        const dateImport = new Date(imp.date_import).toLocaleString('fr-FR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const dateVentes = new Date(imp.date_ventes).toLocaleDateString('fr-FR');
        const montant = parseFloat(imp.total_montant || 0).toLocaleString('fr-FR');
        
        return `
            <tr>
                <td><small>${dateImport}</small></td>
                <td>${dateVentes}</td>
                <td>${escapeHtml(imp.point_vente)}</td>
                <td><span class="badge bg-secondary">${imp.nombre_lignes}</span></td>
                <td class="text-end">${montant} FCFA</td>
                <td><small>${escapeHtml(imp.utilisateur || '-')}</small></td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-info" onclick="viewOCRImport(${imp.id})" title="Voir détails">
                            <i class="bi bi-eye"></i>
                        </button>
                        <button class="btn btn-outline-danger" onclick="deleteOCRImport(${imp.id})" title="Supprimer">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    // Pagination
    const totalPages = Math.ceil(total / ocrHistoryLimit);
    updateOCRHistoryPagination(totalPages);
}

/**
 * Met à jour la pagination de l'historique
 */
function updateOCRHistoryPagination(totalPages) {
    const nav = document.getElementById('ocr-history-pagination');
    const ul = nav?.querySelector('ul');
    
    if (!ul || totalPages <= 1) {
        if (nav) nav.style.display = 'none';
        return;
    }
    
    nav.style.display = 'flex';
    
    let html = '';
    
    // Bouton précédent
    html += `<li class="page-item ${ocrHistoryPage <= 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" onclick="loadOCRHistory(${ocrHistoryPage - 1}); return false;">«</a>
    </li>`;
    
    // Pages
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= ocrHistoryPage - 2 && i <= ocrHistoryPage + 2)) {
            html += `<li class="page-item ${i === ocrHistoryPage ? 'active' : ''}">
                <a class="page-link" href="#" onclick="loadOCRHistory(${i}); return false;">${i}</a>
            </li>`;
        } else if (i === ocrHistoryPage - 3 || i === ocrHistoryPage + 3) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }
    
    // Bouton suivant
    html += `<li class="page-item ${ocrHistoryPage >= totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" onclick="loadOCRHistory(${ocrHistoryPage + 1}); return false;">»</a>
    </li>`;
    
    ul.innerHTML = html;
}

/**
 * Affiche les détails d'un import OCR
 */
async function viewOCRImport(id) {
    try {
        const response = await fetch(`/api/ocr-imports/${id}`, { credentials: 'include' });
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        const imp = result.data;
        const donnees = imp.donnees_json || {};
        const items = donnees.items || [];
        
        let itemsHtml = items.map(item => `
            <tr>
                <td>${escapeHtml(item.article_original || item.produit)}</td>
                <td>${escapeHtml(item.produit)}</td>
                <td class="text-end">${item.quantite}</td>
                <td class="text-end">${(item.prix_unitaire || 0).toLocaleString('fr-FR')}</td>
                <td class="text-end">${(item.montant || 0).toLocaleString('fr-FR')} FCFA</td>
            </tr>
        `).join('');
        
        const modalHtml = `
            <div class="modal fade" id="ocrImportDetailModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header bg-info text-white">
                            <h5 class="modal-title">
                                <i class="bi bi-file-earmark-text me-2"></i>Détails Import #${imp.id}
                            </h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row mb-3">
                                <div class="col-md-4">
                                    <strong>Date import:</strong><br>
                                    ${new Date(imp.date_import).toLocaleString('fr-FR')}
                                </div>
                                <div class="col-md-4">
                                    <strong>Date ventes:</strong><br>
                                    ${new Date(imp.date_ventes).toLocaleDateString('fr-FR')}
                                </div>
                                <div class="col-md-4">
                                    <strong>Point de vente:</strong><br>
                                    ${escapeHtml(imp.point_vente)}
                                </div>
                            </div>
                            <div class="row mb-3">
                                <div class="col-md-4">
                                    <strong>Lignes:</strong> ${imp.nombre_lignes}
                                </div>
                                <div class="col-md-4">
                                    <strong>Total:</strong> ${parseFloat(imp.total_montant || 0).toLocaleString('fr-FR')} FCFA
                                </div>
                                <div class="col-md-4">
                                    <strong>Par:</strong> ${escapeHtml(imp.utilisateur || '-')}
                                </div>
                            </div>
                            <hr>
                            <h6>Produits importés:</h6>
                            <div class="table-responsive" style="max-height: 300px; overflow-y: auto;">
                                <table class="table table-sm table-striped">
                                    <thead class="table-light sticky-top">
                                        <tr>
                                            <th>Article Original</th>
                                            <th>Produit</th>
                                            <th class="text-end">Qté</th>
                                            <th class="text-end">Prix U.</th>
                                            <th class="text-end">Montant</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${itemsHtml || '<tr><td colspan="5" class="text-muted">Aucun détail disponible</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Supprimer le modal existant s'il y en a un
        const existing = document.getElementById('ocrImportDetailModal');
        if (existing) existing.remove();
        
        // Ajouter et afficher le modal
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = new bootstrap.Modal(document.getElementById('ocrImportDetailModal'));
        modal.show();
        
    } catch (error) {
        console.error('Erreur affichage import:', error);
        alert('Erreur: ' + error.message);
    }
}

/**
 * Supprime un import OCR
 */
async function deleteOCRImport(id) {
    // First confirm: ask about deleting associated sales
    const deleteVentes = await showConfirmModal(
        'Voulez-vous également supprimer les ventes associées ?\n\nOK = Supprimer import ET ventes\nAnnuler = Supprimer uniquement l\'historique',
        { title: 'Type de suppression', okLabel: 'Import + ventes', cancelLabel: 'Import seul' }
    );

    // Second confirm: final confirmation
    const finalConfirm = await showConfirmModal(
        `Confirmer la suppression de l'import #${id} ?${deleteVentes ? '\n⚠️ Les ventes associées seront DÉFINITIVEMENT supprimées !' : ''}`,
        { title: 'Confirmer la suppression', okLabel: 'Supprimer', okVariant: 'danger' }
    );
    if (!finalConfirm) {
        return; // User cancelled, abort the operation
    }
    
    try {
        const response = await fetch(`/api/ocr-imports/${id}?delete_ventes=${deleteVentes}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        alert(`Import supprimé${result.ventes_deleted > 0 ? ` (${result.ventes_deleted} ventes supprimées)` : ''}`);
        loadOCRHistory(ocrHistoryPage);
        
    } catch (error) {
        console.error('Erreur suppression import:', error);
        alert('Erreur: ' + error.message);
    }
}

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', function() {
    // Initialiser le module OCR
    initOCRImport();
    
    // Gestionnaire de clic sur l'onglet Import Image
    const importImageTab = document.getElementById('import-image-tab');
    if (importImageTab) {
        importImageTab.addEventListener('click', function(e) {
            e.preventDefault();
            showImportImageSection();
        });
    }
    
    // Gestionnaire bouton actualiser historique
    const refreshBtn = document.getElementById('ocr-refresh-history');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadOCRHistory(1));
    }
});

console.log('📷 Module OCR Import avec Matching et Historique chargé');
