// ===== Fonctionnalités pour la section Cash Paiement =====

// Variables globales pour stocker les données
let allCashPaymentData = [];
let uniquePointsDeVente = new Set();

// Fonction pour formatter les valeurs monétaires
function formatMonetaire(valeur) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'XOF',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(valeur);
}

// Helper function to extract numeric value (added)
function extractNumericValue(formattedText) {
    if (typeof formattedText !== 'string' || !formattedText) return 0;
    
    // Remove spaces (incl. non-breaking) and non-numeric characters except dot/comma/minus
    const numericString = formattedText.replace(/\s|\u00A0/g, '') 
                                     .replace(/[^\d.,-]/g, '')   
                                     .replace(',', '.');         
    
    return parseFloat(numericString) || 0;
}

// Fonction pour charger les données de paiement en espèces
async function loadCashPaymentData() {
    try {
        document.getElementById('loading-indicator-cash-payment').style.display = 'block';
        document.getElementById('cash-payment-table-body').innerHTML = '';
        document.getElementById('no-cash-payment-data').style.display = 'none';
        
        const response = await fetch('/api/cash-payments/aggregated', {
            method: 'GET',
            credentials: 'include'
        });
        
        const result = await response.json();
        
        document.getElementById('loading-indicator-cash-payment').style.display = 'none';
        
        if (result.success && result.data && result.data.length > 0) {
            // Stocker les données dans la variable globale
            allCashPaymentData = result.data;
            
            // Réinitialiser et remplir l'ensemble des points de vente uniques
            uniquePointsDeVente.clear();
            result.data.forEach(dateEntry => {
                dateEntry.points.forEach(pointData => {
                    uniquePointsDeVente.add(pointData.point);
                });
            });
            
            // Peupler le filtre de point de vente
            populatePointVenteFilter();
            
            // Afficher toutes les données (sans filtrage)
            displayCashPaymentData(result.data);
        } else {
            document.getElementById('no-cash-payment-data').style.display = 'block';
        }
    } catch (error) {
        console.error('Erreur lors du chargement des données de paiement:', error);
        document.getElementById('loading-indicator-cash-payment').style.display = 'none';
        document.getElementById('no-cash-payment-data').style.display = 'block';
        document.getElementById('no-cash-payment-data').textContent = 'Erreur lors du chargement des données: ' + error.message;
    }
}

// Fonction pour peupler le filtre de point de vente (uniquement les actifs depuis la BDD)
async function populatePointVenteFilter() {
    const filterSelect = document.getElementById('point-vente-filter-cash');
    if (!filterSelect) return;
    
    // Garder l'option "Tous les points de vente"
    filterSelect.innerHTML = '<option value="">Tous les points de vente</option>';
    
    try {
        // Charger les points de vente actifs depuis l'API
        const response = await fetch('/api/points-vente');
        if (response.ok) {
            const activePointsVente = await response.json();
            // activePointsVente est un tableau de noms de points de vente actifs
            activePointsVente.sort().forEach(pointVente => {
                const option = document.createElement('option');
                option.value = pointVente;
                option.textContent = pointVente;
                filterSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
        // Fallback: utiliser les points de vente des données existantes
        [...uniquePointsDeVente].sort().forEach(pointVente => {
            const option = document.createElement('option');
            option.value = pointVente;
            option.textContent = pointVente;
            filterSelect.appendChild(option);
        });
    }
}

// Fonction pour appliquer les filtres
function applyCashPaymentFilters() {
    const monthFilter = document.getElementById('month-filter-cash').value.trim();
    const dateFilter = document.getElementById('date-filter-cash').value;
    const pointVenteFilter = document.getElementById('point-vente-filter-cash').value;
    
    // --- DEBUG LOGGING START ---
    console.log('[cash-payment.js] applyCashPaymentFilters called.');
    console.log('Date filter value from input (#date-filter-cash):', dateFilter);
    console.log('Point de vente filter value from input (#point-vente-filter-cash):', pointVenteFilter);
    if (allCashPaymentData.length > 0) {
        console.log('Sample date from allCashPaymentData[0].date:', allCashPaymentData[0].date);
    }
    // --- DEBUG LOGGING END ---

    // Filtrer les données
    let filteredData = [...allCashPaymentData];
    
    // Si un filtre de mois est spécifié
    if (monthFilter) {
        console.log('Applying month filter...', monthFilter);
        filteredData = filteredData.filter(dateEntry => {
            if (!dateEntry.date) return false;
            
            let entryYearMonth;
            
            // Analyser la date selon le format (DD/MM/YYYY ou YYYY-MM-DD)
            if (dateEntry.date.includes('/')) {
                // Format DD/MM/YYYY
                const [day, month, year] = dateEntry.date.split('/');
                entryYearMonth = `${year}-${month.padStart(2, '0')}`;
            } else if (dateEntry.date.includes('-')) {
                // Format YYYY-MM-DD
                const [year, month] = dateEntry.date.split('-');
                entryYearMonth = `${year}-${month.padStart(2, '0')}`;
            } else {
                console.warn('Format de date non reconnu:', dateEntry.date);
                return false;
            }
            
            console.log(`Comparing ${entryYearMonth} with ${monthFilter}`);
            return entryYearMonth === monthFilter;
        });
        console.log('Filtered data by month:', filteredData.length, 'entries');
    }
    
    // Si un filtre de date est spécifié
    if (dateFilter) {
        console.log('Applying date filter...'); // Log that date filtering is attempted
        filteredData = filteredData.filter((dateEntry, index) => {
            const backendDate = dateEntry.date; // Expected format: YYYY-MM-DD
            // Convertir la date SQL (YYYY-MM-DD) en format d'affichage (DD/MM/YYYY) pour la comparaison
            const parts = backendDate ? backendDate.split('-') : null;
            if (!parts || parts.length !== 3) {
                 if (index < 5) { // Log details for the first few entries only
                     console.log(`  Skipping entry ${index}: Invalid date format from backend: ${backendDate}`);
                 }
                return false;
            }
            
            const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`; // e.g., "14/04/2025"
            const comparisonResult = formattedDate === dateFilter;

            // Log details for the first few entries during comparison
            if (index < 5) { 
                console.log(`  Comparing entry ${index}: Backend='${backendDate}', Formatted='${formattedDate}', Filter='${dateFilter}', Match=${comparisonResult}`);
            }
            return comparisonResult; 
        });
    }
    
    // Si un filtre de point de vente est spécifié
    if (pointVenteFilter) {
        // Filtrer chaque entrée de date pour ne garder que les points de vente correspondants
        filteredData = filteredData.map(dateEntry => {
            const filteredPoints = dateEntry.points.filter(point => point.point === pointVenteFilter);
            return {
                ...dateEntry,
                points: filteredPoints
            };
        }).filter(dateEntry => dateEntry.points.length > 0); // Ne garder que les entrées qui ont encore des points
    }
    
    // Afficher les données filtrées
    if (filteredData.length > 0) {
        displayCashPaymentData(filteredData);
        document.getElementById('no-cash-payment-data').style.display = 'none';
        console.log('Totaux mis à jour avec les données filtrées');
    } else {
        // Réinitialiser les totaux à zéro si aucune donnée
        document.getElementById('total-positif-global').textContent = '0 FCFA';
        document.getElementById('total-negatif-retraits').textContent = '0 FCFA';
        document.getElementById('total-positif-pdv-breakdown').innerHTML = '';
        const autresElement = document.getElementById('total-positif-autres');
        if (autresElement) {
            const parentP = autresElement.closest('p');
            if (parentP) {
                parentP.innerHTML = `Autre(s): <strong class="float-end"><span id="total-positif-autres">0 FCFA</span> (0%)</strong>`;
            }
        }
        
        document.getElementById('cash-payment-table-body').innerHTML = '';
        document.getElementById('no-cash-payment-data').style.display = 'block';
        document.getElementById('no-cash-payment-data').textContent = 'Aucune donnée ne correspond aux filtres sélectionnés.';
    }
}

// Fonction pour afficher les données de paiement agrégées
function displayCashPaymentData(data) {
    const tbody = document.getElementById('cash-payment-table-body');
    tbody.innerHTML = '';

    // Initialize totals
    let totalPositifPDVBreakdown = {}; // Store breakdown by Point de Vente
    let totalPositifAutres = 0;
    let totalNegatif = 0;

    // Ensure POINTS_VENTE_PHYSIQUES is available and initialize breakdown structure
    if (typeof POINTS_VENTE_PHYSIQUES !== 'undefined') {
        POINTS_VENTE_PHYSIQUES.forEach(pdv => {
            totalPositifPDVBreakdown[pdv] = 0;
        });
    }

    data.forEach(dateEntry => {
        const date = dateEntry.date;

        function formatDateForDisplay(sqlDate) {
            if (!sqlDate) return '';
            const parts = sqlDate.split('-');
            if (parts.length !== 3) return sqlDate;
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }

        const formattedDate = formatDateForDisplay(date);

        dateEntry.points.forEach(pointData => {
            const row = document.createElement('tr');

            const tdDate = document.createElement('td');
            tdDate.textContent = formattedDate;
            row.appendChild(tdDate);

            const tdPoint = document.createElement('td');
            // --- Start Point de Vente Edit Functionality ---
            const originalPointVente = pointData.point;
            
            const pointSpan = document.createElement('span');
            pointSpan.textContent = originalPointVente;
            pointSpan.style.marginRight = '5px';

            const editPointIcon = document.createElement('span');
            editPointIcon.textContent = '✏️';
            editPointIcon.style.cursor = 'pointer';
            editPointIcon.title = 'Modifier le point de vente';

            tdPoint.appendChild(pointSpan);
            tdPoint.appendChild(editPointIcon);

            editPointIcon.addEventListener('click', () => {
                tdPoint.innerHTML = ''; // Clear cell

                const select = document.createElement('select');
                select.style.width = '150px';
                select.classList.add('form-select', 'form-select-sm');

                // Add all available points de vente
                if (typeof POINTS_VENTE_PHYSIQUES !== 'undefined') {
                    POINTS_VENTE_PHYSIQUES.forEach(pv => {
                        const option = document.createElement('option');
                        option.value = pv;
                        option.textContent = pv;
                        if (pv === originalPointVente) {
                            option.selected = true;
                        }
                        select.appendChild(option);
                    });
                }

                // Add "Non spécifié" option
                const nonSpecifieOption = document.createElement('option');
                nonSpecifieOption.value = 'Non spécifié';
                nonSpecifieOption.textContent = 'Non spécifié';
                if (originalPointVente === 'Non spécifié') {
                    nonSpecifieOption.selected = true;
                }
                select.appendChild(nonSpecifieOption);

                // Add current point if not in the list and not "Non spécifié"
                if (typeof POINTS_VENTE_PHYSIQUES !== 'undefined' && 
                    !POINTS_VENTE_PHYSIQUES.includes(originalPointVente) && 
                    originalPointVente !== 'Non spécifié') {
                    const option = document.createElement('option');
                    option.value = originalPointVente;
                    option.textContent = originalPointVente;
                    option.selected = true;
                    select.appendChild(option);
                }

                tdPoint.appendChild(select);
                select.focus();

                const finishEdit = async () => {
                    // Disable select/icon during save
                    select.disabled = true;
                    editPointIcon.style.pointerEvents = 'none';
                    editPointIcon.style.opacity = '0.5';

                    const newPointVente = select.value;
                    const originalFormattedValue = pointSpan.textContent;
                    pointSpan.textContent = newPointVente;

                    try {
                        console.log(`Attempting to save point de vente: date=${formattedDate}, old_point=${originalPointVente}, new_point=${newPointVente}`);
                        
                        const response = await fetch('/api/cash-payments/update-point-vente', {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            credentials: 'include',
                            body: JSON.stringify({
                                date: formattedDate,
                                old_point_de_vente: originalPointVente,
                                new_point_de_vente: newPointVente
                            })
                        });

                        const result = await response.json();

                        if (!response.ok || !result.success) {
                            throw new Error(result.message || `Erreur serveur: ${response.status}`);
                        }

                        console.log(`Point de vente update successful: ${originalPointVente} -> ${newPointVente} on ${formattedDate}.`);
                        
                        // Update local data cache
                        const dateEntryIndex = allCashPaymentData.findIndex(entry => {
                            const parts = entry.date.split('-');
                            if (parts.length !== 3) return false;
                            return `${parts[2]}/${parts[1]}/${parts[0]}` === formattedDate;
                        });

                        if (dateEntryIndex > -1) {
                            const pointEntryIndex = allCashPaymentData[dateEntryIndex].points.findIndex(p => p.point === originalPointVente);
                            if (pointEntryIndex > -1) {
                                allCashPaymentData[dateEntryIndex].points[pointEntryIndex].point = newPointVente;
                                console.log('Local data cache updated for point de vente.');
                            }
                        }

                        // Re-apply filters
                        applyCashPaymentFilters();

                    } catch (error) {
                        console.error('Error saving updated point de vente:', error);
                        alert(`Erreur lors de la sauvegarde: ${error.message}`);
                        // Restore original value
                        pointSpan.textContent = originalFormattedValue;
                        // Restore view
                        tdPoint.innerHTML = '';
                        tdPoint.appendChild(pointSpan);
                        tdPoint.appendChild(editPointIcon);
                        // Re-enable icon
                        editPointIcon.style.pointerEvents = 'auto';
                        editPointIcon.style.opacity = '1';
                    }
                };

                select.addEventListener('blur', finishEdit);

                select.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        select.blur();
                    }
                    if (e.key === 'Escape') {
                        // Cancel: Restore original value and view
                        pointSpan.textContent = originalPointVente;
                        tdPoint.innerHTML = '';
                        tdPoint.appendChild(pointSpan);
                        tdPoint.appendChild(editPointIcon);
                    }
                });
            });
            // --- End Point de Vente Edit Functionality ---
            row.appendChild(tdPoint);

            const tdTotal = document.createElement('td');
            // --- Start Edit Functionality --- 
            tdTotal.classList.add('text-end', 'currency'); // Ensure currency class is added
            const originalValue = pointData.total;

            const amountSpan = document.createElement('span');
            amountSpan.textContent = formatMonetaire(originalValue);
            amountSpan.style.marginRight = '5px';

            const editIcon = document.createElement('span');
            editIcon.textContent = '✏️';
            editIcon.style.cursor = 'pointer';
            editIcon.title = 'Modifier le montant'; 

            tdTotal.appendChild(amountSpan);
            tdTotal.appendChild(editIcon);

            editIcon.addEventListener('click', () => {
                const currentValue = extractNumericValue(amountSpan.textContent);
                tdTotal.innerHTML = ''; // Clear cell

                const input = document.createElement('input');
                input.type = 'number';
                input.value = currentValue;
                input.style.width = '120px'; // Adjust width as needed
                input.classList.add('form-control', 'form-control-sm'); 
                
                tdTotal.appendChild(input);
                input.focus();

                const finishEdit = async () => {
                    // Disable input/icon during save
                    input.disabled = true;
                    editIcon.style.pointerEvents = 'none';
                    editIcon.style.opacity = '0.5';

                    const newValue = parseFloat(input.value) || 0;
                    const originalFormattedValue = amountSpan.textContent; // Store before potential failure
                    amountSpan.textContent = formatMonetaire(newValue);
                    
                    try {
                        console.log(`Attempting to save: date=${formattedDate}, point_de_vente=${pointData.point}, newTotal=${newValue}`);
                        
                        const response = await fetch('/api/cash-payments/update-aggregated', {
                            method: 'PUT',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            credentials: 'include',
                            body: JSON.stringify({
                                date: formattedDate,         // Send date in DD/MM/YYYY format
                                point_de_vente: pointData.point, // Send point de vente name
                                newTotal: newValue            // Send the new numeric value
                            })
                        });

                        const result = await response.json();

                        if (!response.ok || !result.success) {
                            throw new Error(result.message || `Erreur serveur: ${response.status}`);
                        }

                        console.log(`Save successful for ${pointData.point} on ${formattedDate}.`);
                        
                        // --- Update local data cache --- 
                        const dateEntryIndex = allCashPaymentData.findIndex(entry => {
                             // Convert entry.date (YYYY-MM-DD) to DD/MM/YYYY for comparison
                             const parts = entry.date.split('-');
                             if (parts.length !== 3) return false;
                             return `${parts[2]}/${parts[1]}/${parts[0]}` === formattedDate;
                        });

                        if (dateEntryIndex > -1) {
                            const pointEntryIndex = allCashPaymentData[dateEntryIndex].points.findIndex(p => p.point === pointData.point);
                            if (pointEntryIndex > -1) {
                                allCashPaymentData[dateEntryIndex].points[pointEntryIndex].total = newValue;
                                console.log('Local data cache updated.');
                            } else {
                                console.warn('Point entry not found in local cache for update.');
                            }
                        } else {
                            console.warn('Date entry not found in local cache for update.');
                        }
                        // --- End Update local data cache --- 

                        // Re-apply filters instead of reloading all data
                        applyCashPaymentFilters(); 

                    } catch (error) {
                        console.error('Error saving updated total:', error);
                        alert(`Erreur lors de la sauvegarde: ${error.message}`);
                        // Restore original value in span on failure
                        amountSpan.textContent = originalFormattedValue;
                        // Restore view even on failure
                        tdTotal.innerHTML = ''; 
                        tdTotal.appendChild(amountSpan);
                        tdTotal.appendChild(editIcon);
                        // Re-enable icon
                        editIcon.style.pointerEvents = 'auto';
                        editIcon.style.opacity = '1';
                    }
                };

                input.addEventListener('blur', finishEdit);

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        input.blur(); 
                    }
                    if (e.key === 'Escape') {
                        // Cancel: Restore original value and view
                        amountSpan.textContent = formatMonetaire(originalValue); 
                        tdTotal.innerHTML = '';
                        tdTotal.appendChild(amountSpan);
                        tdTotal.appendChild(editIcon);
                    }
                });
            });
            // --- End Edit Functionality ---
            row.appendChild(tdTotal);

            tbody.appendChild(row);

            // --- Calculate totals --- 
            const montant = pointData.total;
            if (montant > 0) {
                // Check if it's a known physical point of sale
                if (typeof POINTS_VENTE_PHYSIQUES !== 'undefined' && POINTS_VENTE_PHYSIQUES.includes(pointData.point)) {
                    totalPositifPDVBreakdown[pointData.point] += montant;
                } else {
                    totalPositifAutres += montant;
                }
            } else if (montant < 0) {
                totalNegatif += montant; // Add the negative value
            }
            // --- End Calculate totals --- 
        });
    });

    // --- Update total display elements --- 
    const breakdownContainer = document.getElementById('total-positif-pdv-breakdown');
    breakdownContainer.innerHTML = ''; // Clear previous breakdown
    let totalPositifPDVCalculated = 0;

    // Calculate overall positive total first to use for percentages
    if (typeof POINTS_VENTE_PHYSIQUES !== 'undefined') {
        POINTS_VENTE_PHYSIQUES.forEach(pdv => {
            totalPositifPDVCalculated += totalPositifPDVBreakdown[pdv] || 0;
        });
    }
    const totalPositifGlobal = totalPositifPDVCalculated + totalPositifAutres;

    // Generate breakdown HTML with percentages
    if (typeof POINTS_VENTE_PHYSIQUES !== 'undefined') {
        POINTS_VENTE_PHYSIQUES.forEach(pdv => {
            const amount = totalPositifPDVBreakdown[pdv] || 0;
            if (amount > 0) { // Only show if there's a positive amount
                const percentage = totalPositifGlobal > 0 ? (amount / totalPositifGlobal * 100).toFixed(1) : 0;
                const p = document.createElement('p');
                p.classList.add('mb-1', 'small'); // Smaller font for breakdown
                p.innerHTML = `${pdv}: <strong class="float-end">${formatMonetaire(amount)} (${percentage}%)</strong>`;
                breakdownContainer.appendChild(p);
            }
        });
    }

    // Update "Autre(s)" with percentage
    const autresPercentage = totalPositifGlobal > 0 ? (totalPositifAutres / totalPositifGlobal * 100).toFixed(1) : 0;
    const autresElement = document.getElementById('total-positif-autres');
    if (autresElement) {
        // Find the parent <p> tag to update the whole line
        const parentP = autresElement.closest('p');
        if (parentP) {
             parentP.innerHTML = `Autre(s): <strong class="float-end"><span id="total-positif-autres">${formatMonetaire(totalPositifAutres)}</span> (${autresPercentage}%)</strong>`;
        }
    }
    
    // Update global total and negative total
    document.getElementById('total-positif-global').textContent = formatMonetaire(totalPositifGlobal);
    document.getElementById('total-negatif-retraits').textContent = formatMonetaire(totalNegatif);
    // --- End Update total display elements --- 
}

// Parser CSV pour la fonctionnalité Cash Paiement
function parseCSV(csvContent) {
    // Détecter le séparateur (virgule ou point-virgule)
    const separator = csvContent.includes(';') ? ';' : ',';
    
    // Diviser par lignes
    const lines = csvContent.split('\n');
    
    // Extraire les en-têtes (première ligne)
    const headers = lines[0].split(separator).map(header => 
        header.trim().toLowerCase().replace(/[\r\n"]/g, '')
    );
    
    // Vérifier si les en-têtes contiennent les champs requis
    const requiredHeaders = ['created_at', 'amount', 'payment_reference'];
    const missingHeaders = requiredHeaders.filter(header => !headers.includes(header));
    
    if (missingHeaders.length > 0) {
        throw new Error(`En-têtes requis manquants: ${missingHeaders.join(', ')}`);
    }
    
    // Traiter les lignes de données (exclure la première ligne d'en-têtes)
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Ignorer les lignes vides
        
        // Analyser les valeurs en respectant les éventuelles quotes
        const values = [];
        let inQuotes = false;
        let currentValue = '';
        
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === separator && !inQuotes) {
                values.push(currentValue.trim().replace(/^"|"$/g, ''));
                currentValue = '';
            } else {
                currentValue += char;
            }
        }
        
        // Ajouter la dernière valeur
        values.push(currentValue.trim().replace(/^"|"$/g, ''));
        
        // Créer un objet avec les noms de colonne comme clés
        const rowData = {};
        headers.forEach((header, index) => {
            rowData[header] = index < values.length ? values[index] : '';
        });
        
        data.push(rowData);
    }
    
    return data;
}

// Fonction pour initialiser le filtre de mois avec le mois en cours
function initMonthFilterCashPayment() {
    const monthFilter = document.getElementById('month-filter-cash');
    if (monthFilter && !monthFilter.value) {
        const maintenant = new Date();
        const moisCourant = maintenant.getFullYear() + '-' + String(maintenant.getMonth() + 1).padStart(2, '0');
        monthFilter.value = moisCourant;
        console.log(`Filtre de mois Cash Payment initialisé au mois en cours: ${moisCourant}`);
        
        // Appliquer automatiquement le filtre si l'option auto est activée
        if (document.getElementById('auto-apply-filter') && document.getElementById('auto-apply-filter').checked) {
            // Attendre un court délai pour que les données soient chargées
            setTimeout(() => {
                console.log('Application automatique du filtre de mois...');
                applyCashPaymentFilters();
            }, 500);
        }
    }
}

// Fonction pour ouvrir le modal d'ajout manuel de paiement
async function openManualPaymentModal() {
    // Remplir le dropdown des points de vente
    populateManualPaymentPointsVente();
    
    // Définir la date par défaut à aujourd'hui
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    document.getElementById('manualPaymentDate').value = dateStr;
    
    // Réinitialiser le formulaire
    document.getElementById('manualPaymentForm').reset();
    document.getElementById('manualPaymentDate').value = dateStr; // Remettre la date après le reset
    
    // Afficher/cacher le mapping des références selon les permissions
    await checkPaymentRefMappingVisibility();
    
    // Ouvrir le modal
    const modal = new bootstrap.Modal(document.getElementById('addManualPaymentModal'));
    modal.show();
}

// Fonction pour vérifier la visibilité du mapping des références de paiement
async function checkPaymentRefMappingVisibility() {
    const currentUser = window.currentUser;
    const mappingInfo = document.getElementById('paymentRefMappingInfo');
    
    if (currentUser && currentUser.role && mappingInfo) {
        const userRole = currentUser.role.toLowerCase();
        const adminRoles = ['admin', 'superviseur']; // Administrateurs et superviseurs
        
        if (adminRoles.includes(userRole)) {
            // Charger et afficher le mapping pour les administrateurs et superviseurs
            try {
                const response = await fetch('/api/payment-ref-mapping');
                const result = await response.json();
                
                if (result.success && result.data) {
                    // Construire le HTML du mapping dynamiquement
                    let mappingHTML = '<p class="mb-2"><strong>Mapping des références de paiement :</strong></p><div class="row small">';
                    
                    Object.entries(result.data).forEach(([ref, pointVente]) => {
                        mappingHTML += `<div class="col-md-4">${ref} = ${pointVente}</div>`;
                    });
                    
                    mappingHTML += '</div>';
                    mappingInfo.innerHTML = mappingHTML;
                    mappingInfo.style.display = 'block';
                    
                    console.log(`Mapping des références chargé et affiché pour ${currentUser.username}`);
                } else {
                    console.error('Erreur lors du chargement du mapping:', result.message);
                    mappingInfo.style.display = 'none';
                }
            } catch (error) {
                console.error('Erreur lors du chargement du mapping des références:', error);
                mappingInfo.style.display = 'none';
            }
        } else {
            // Cacher le mapping pour les autres utilisateurs
            mappingInfo.style.display = 'none';
            console.log(`Mapping des références caché pour ${userRole} (${currentUser.username})`);
        }
    } else {
        // Cacher par défaut si pas d'utilisateur connecté
        if (mappingInfo) {
            mappingInfo.style.display = 'none';
        }
    }
}

// Fonction pour remplir le dropdown des points de vente dans le modal
async function populateManualPaymentPointsVente() {
    try {
        const response = await fetch('/api/points-vente');
        const pointsVente = await response.json();
        
        const select = document.getElementById('manualPaymentPointVente');
        // Garder l'option par défaut et vider les autres
        select.innerHTML = '<option value="">Sélectionner un point de vente</option>';
        
        pointsVente.forEach(pointVente => {
            const option = document.createElement('option');
            option.value = pointVente;
            option.textContent = pointVente;
            select.appendChild(option);
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
        alert('Erreur lors du chargement des points de vente');
    }
}

// Fonction pour sauvegarder un paiement manuel
async function saveManualPayment() {
    const form = document.getElementById('manualPaymentForm');
    const formData = new FormData(form);
    
    // Validation des champs requis
    const date = document.getElementById('manualPaymentDate').value;
    const pointVente = document.getElementById('manualPaymentPointVente').value;
    const amount = document.getElementById('manualPaymentAmount').value;
    
    if (!date || !pointVente || !amount) {
        alert('Veuillez remplir tous les champs obligatoires (Date, Point de Vente, Montant)');
        return;
    }
    
    // Préparer les données
    const paymentData = {
        date: date,
        pointVente: pointVente,
        amount: parseFloat(amount),
        reference: document.getElementById('manualPaymentReference').value || '',
        comment: document.getElementById('manualPaymentComment').value || '',
        isManual: true
    };
    
    try {
        // Désactiver le bouton pendant l'envoi
        const saveButton = document.getElementById('saveManualPayment');
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="bi bi-hourglass-split"></i> Sauvegarde...';
        
        const response = await fetch('/api/cash-payments/manual', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(paymentData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Fermer le modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('addManualPaymentModal'));
            modal.hide();
            
            // Afficher un message de succès
            alert('Paiement ajouté avec succès !');
            
            // Recharger les données pour afficher le nouveau paiement
            loadCashPaymentData();
            
        } else {
            alert(`Erreur lors de l'ajout du paiement: ${result.message || 'Erreur inconnue'}`);
        }
        
    } catch (error) {
        console.error('Erreur lors de l\'ajout du paiement manuel:', error);
        alert('Erreur lors de l\'ajout du paiement. Veuillez réessayer.');
    } finally {
        // Réactiver le bouton
        const saveButton = document.getElementById('saveManualPayment');
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="bi bi-save"></i> Sauvegarder';
    }
}

// Initialisation des gestionnaires d'événements
document.addEventListener('DOMContentLoaded', function() {
    // NOTE: Le gestionnaire de clic pour l'onglet Cash Paiement est dans script.js
    // Pour éviter les doublons, on n'ajoute plus d'event listener ici
    
    // Gestionnaire pour le bouton d'ajout manuel de paiement
    const addManualPaymentButton = document.getElementById('add-manual-payment');
    if (addManualPaymentButton) {
        addManualPaymentButton.addEventListener('click', function() {
            openManualPaymentModal();
        });
    }
    
    // Gestionnaire pour le bouton de sauvegarde du paiement manuel
    const saveManualPaymentButton = document.getElementById('saveManualPayment');
    if (saveManualPaymentButton) {
        saveManualPaymentButton.addEventListener('click', function() {
            saveManualPayment();
        });
    }
    
    // Initialiser le datepicker pour le filtre de date
    function initDatepicker() {
        const dateFilterInput = document.getElementById('date-filter-cash');
        if (dateFilterInput && !dateFilterInput._flatpickr) {
            
            // Check if French locale is loaded
            const options = {
                dateFormat: 'd/m/Y',
                allowInput: true,
                onClose: function() {
                    if (document.getElementById('auto-apply-filter').checked) {
                        applyCashPaymentFilters();
                    }
                },
                onChange: function(selectedDates, dateStr) {
                    if (dateStr === '' && document.getElementById('auto-apply-filter').checked) {
                        applyCashPaymentFilters();
                    }
                }
            };

            if (flatpickr.l10ns && flatpickr.l10ns.fr) {
                options.locale = 'fr';
                console.log('Flatpickr: Initializing with French locale.');
            } else {
                console.warn('Flatpickr: French locale (fr.js) not loaded or available. Defaulting to English.');
                // Optionally, try again after a short delay if needed, but for now, just default.
            }

            flatpickr(dateFilterInput, options);
        }
    }
    
    // Gestionnaire pour le bouton d'application des filtres
    const applyFiltersBtn = document.getElementById('apply-filters-cash');
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', applyCashPaymentFilters);
    }
    
    // Gestionnaire pour le filtre de mois (changement automatique)
    const monthFilter = document.getElementById('month-filter-cash');
    if (monthFilter) {
        monthFilter.addEventListener('change', function() {
            if (document.getElementById('auto-apply-filter')?.checked) {
                applyCashPaymentFilters();
            }
        });
    }
    
    // Gestionnaire pour le filtre de point de vente (changement automatique)
    const pointVenteFilter = document.getElementById('point-vente-filter-cash');
    if (pointVenteFilter) {
        pointVenteFilter.addEventListener('change', function() {
            if (document.getElementById('auto-apply-filter')?.checked) {
                applyCashPaymentFilters();
            }
        });
    }
    
    // Gestionnaire pour l'importation de fichier CSV
    const importButton = document.getElementById('import-cash-payment');
    const fileInput = document.getElementById('cash-payment-file');
    const loadingIndicator = document.getElementById('loading-indicator-cash-payment');
    
    if (importButton && fileInput) {
        importButton.addEventListener('click', async function() {
            if (!fileInput.files || fileInput.files.length === 0) {
                alert('Veuillez sélectionner un fichier CSV à importer.');
                return;
            }
            
            const file = fileInput.files[0];
            const reader = new FileReader();
            
            reader.onload = async function(e) {
                try {
                    loadingIndicator.style.display = 'block';
                    
                    const csvContent = e.target.result;
                    const data = parseCSV(csvContent);
                    
                    if (data.length === 0) {
                        throw new Error('Aucune donnée valide trouvée dans le fichier CSV.');
                    }
                    
                    // Envoyer les données au serveur
                    const response = await fetch('/api/cash-payments/import', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify({ data })
                    });
                    
                    const result = await response.json();
                    
                    loadingIndicator.style.display = 'none';
                    
                    if (result.success) {
                        alert(`Importation réussie: ${result.message}`);
                        fileInput.value = ''; // Réinitialiser l'input de fichier
                        loadCashPaymentData(); // Recharger les données
                    } else {
                        throw new Error(result.message || 'Erreur lors de l\'importation');
                    }
                } catch (error) {
                    console.error('Erreur lors de l\'importation:', error);
                    loadingIndicator.style.display = 'none';
                    alert('Erreur lors de l\'importation: ' + error.message);
                }
            };
            
            reader.readAsText(file);
        });
    }
    
    // Gestionnaire pour effacer les données
    const clearButton = document.getElementById('clear-cash-payment-data');
    if (clearButton) {
        clearButton.addEventListener('click', async function() {
            const ok = await showConfirmModal('Êtes-vous sûr de vouloir supprimer toutes les données de paiement? Cette action est irréversible.', {
                title: 'Effacer données paiement', okLabel: 'Tout supprimer', okVariant: 'danger'
            });
            if (!ok) {
                return;
            }
            
            try {
                loadingIndicator.style.display = 'block';
                
                const response = await fetch('/api/cash-payments/clear', {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                const result = await response.json();
                
                loadingIndicator.style.display = 'none';
                
                if (result.success) {
                    alert('Toutes les données ont été supprimées avec succès.');
                    loadCashPaymentData(); // Recharger (ou plutôt vider) les données
                } else {
                    throw new Error(result.message || 'Erreur lors de la suppression');
                }
            } catch (error) {
                console.error('Erreur lors de la suppression des données:', error);
                loadingIndicator.style.display = 'none';
                alert('Erreur lors de la suppression: ' + error.message);
            }
        });
    }

    // Add event listener for the save button
    const saveButton = document.getElementById('save-cash-payment');
    if (saveButton) {
        saveButton.addEventListener('click', async function() {
            try {
                // Get the table data
                const tableBody = document.getElementById('cash-payment-table-body');
                
                if (!tableBody || tableBody.children.length === 0) {
                    alert('Aucune donnée à sauvegarder. Veuillez d\'abord importer des données.');
                    return;
                }
                
                // Disable the button during the operation
                this.disabled = true;
                this.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sauvegarde...';
                
                // Create a CSV content with the aggregated data
                let csvContent = 'Date,Point de Vente,Montant Total\n';
                
                Array.from(tableBody.children).forEach(row => {
                    const date = row.cells[0].textContent.trim();
                    const pointVente = row.cells[1].textContent.trim();
                    const montant = row.cells[2].textContent.trim();
                    
                    csvContent += `"${date}","${pointVente}","${montant}"\n`;
                });
                
                // Create a Blob with the CSV content
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                
                // Create a link and trigger the download
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                
                link.setAttribute('href', url);
                link.setAttribute('download', `cash-payments-${new Date().toISOString().slice(0, 10)}.csv`);
                link.style.display = 'none';
                
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // Re-enable the button
                this.disabled = false;
                this.textContent = 'Sauvegarder';
                
                alert('Les données ont été sauvegardées avec succès.');
                
            } catch (error) {
                console.error('Erreur lors de la sauvegarde des données :', error);
                alert(`Erreur lors de la sauvegarde : ${error.message}`);
                
                // Reset the button
                this.disabled = false;
                this.textContent = 'Sauvegarder';
            }
        });
    }
}); 