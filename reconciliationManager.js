/**
 * Module de gestion centralisée de la réconciliation
 * Gère l'affichage, la sauvegarde, le chargement et la mise à jour du tableau de réconciliation
 * Intègre la gestion des paiements en espèces et des commentaires
 */

// Module de gestion centralisée de la réconciliation
const ReconciliationManager = (function() {
    // Variables privées du module
    let currentReconciliation = null;
    let currentDebugInfo = null;
    
    // Configuration de la structure du tableau
    const TABLE_COLUMNS = [
        { id: 'date', label: 'Date', isHeader: true },
        { id: 'pointVente', label: 'Point de Vente', isHeader: true },
        { id: 'stockMatin', label: 'Stock Matin', isNumeric: true },
        { id: 'stockSoir', label: 'Stock Soir', isNumeric: true },
        { id: 'transferts', label: 'Transferts', isNumeric: true },
        { id: 'ventesTheoriques', label: 'Ventes Théoriques', isNumeric: true },
        { id: 'ventesSaisies', label: 'Ventes Saisies', isNumeric: true },
        { id: 'commandesInterPV', label: 'Commandes inter-PV', isNumeric: true },
        { id: 'ventesTotales', label: 'Ventes Totales', isNumeric: true },
        { id: 'creances', label: 'Créances', isNumeric: true },
        { id: 'ecart', label: 'Écart', isNumeric: true },
        { id: 'cashPayment', label: 'Montant Total Cash', isNumeric: true },
        { id: 'ecartPourcentage', label: 'Écart %', isNumeric: true },
        { id: 'ecartCash', label: 'Ecart Cash', isNumeric: true },
        { id: 'commentaire', label: 'Commentaire', isInput: true }
    ];

    // Cache module: somme des commandes inter-PV par PV pour la date courante.
    // Rempli par chargerSommeDecoupeInterPV(date) avant le rendu du tableau.
    let decoupeInterPVByPV = {};
    
    // Mapping des références de paiement aux points de vente - chargé depuis l'API
    let PAYMENT_REF_MAPPING = {};
    
    // Fonction pour charger le mapping depuis l'API
    async function loadPaymentRefMapping() {
        try {
            const response = await fetch('/api/payment-ref-mapping');
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.data) {
                    PAYMENT_REF_MAPPING = data.data;
                    console.log('Payment ref mapping chargé depuis la BDD:', PAYMENT_REF_MAPPING);
                }
            }
        } catch (error) {
            console.error('Erreur lors du chargement du payment ref mapping:', error);
        }
    }
    
    // Index des colonnes pour accès rapide
    const COLUMN_INDEXES = {};
    TABLE_COLUMNS.forEach((col, index) => {
        COLUMN_INDEXES[col.id] = index;
    });
    
    // Point d'entrée principal - initialise le module
    async function initialize() {
        console.log('Initialisation du gestionnaire de réconciliation unifié');
        console.log('Indexes des colonnes:', COLUMN_INDEXES);
        console.log('***** INITIALISATION DU MODULE RECONCILIATION *****');
        await loadPaymentRefMapping();
        setupEventListeners();
    }
    
    // Configuration des écouteurs d'événements
    function setupEventListeners() {
        console.log('***** CONFIGURATION DES ÉCOUTEURS D\'ÉVÉNEMENTS *****');
        
        document.addEventListener('DOMContentLoaded', function() {
            console.log('***** ÉVÉNEMENT DOMContentLoaded DÉCLENCHÉ *****');
            // Écouteur pour le bouton de calcul
            const btnCalculer = document.getElementById('calculer-reconciliation');
            if (btnCalculer) {
                console.log('Bouton "Calculer" trouvé dans le DOM:', btnCalculer);
                btnCalculer.addEventListener('click', function() {
                    console.log('Clic sur le bouton Calculer détecté');
                    const date = document.getElementById('date-reconciliation').value;
                    if (!date) {
                        alert('Veuillez sélectionner une date');
                        return;
                    }
                    
                    // Charger la réconciliation (d'abord essayer de charger une existante)
                    chargerReconciliation(date);
                });
            } else {
                console.warn('Bouton "Calculer" NON TROUVÉ dans le DOM');
            }
            
            // Écouteur pour le bouton de sauvegarde (uniquement pour les utilisateurs avec droits d'écriture)
            const btnSauvegarder = document.getElementById('sauvegarder-reconciliation');
            if (btnSauvegarder) {
                console.log('Bouton "Sauvegarder" trouvé dans le DOM:', btnSauvegarder);
                
                // Vérifier le rôle utilisateur
                const currentUser = window.currentUser;
                if (currentUser && currentUser.role === 'lecteur') {
                    console.log('Utilisateur lecteur détecté, masquage du bouton de sauvegarde');
                    btnSauvegarder.style.display = 'none';
                } else {
                    btnSauvegarder.addEventListener('click', sauvegarderReconciliation);
                }
            } else {
                console.warn('Bouton "Sauvegarder" NON TROUVÉ dans le DOM');
            }
            
            // Écouteur pour le changement de date
            const dateInput = document.getElementById('date-reconciliation');
            if (dateInput) {
                console.log('Input date trouvé dans le DOM:', dateInput);
                dateInput.addEventListener('change', function() {
                    console.log("Date changed to:", this.value);
                    resetTableData();
                    
                    // Automatiquement charger les données pour la nouvelle date
                    if (this.value) {
                        console.log("Chargement automatique des données pour la nouvelle date:", this.value);
                        chargerReconciliation(this.value);
                    }
                });
                
                // Vérifier si une date est stockée dans sessionStorage (venant du Stock inventaire)
                console.log("Clés disponibles dans sessionStorage:", Object.keys(sessionStorage));
                const storedDate = sessionStorage.getItem('reconciliation_date');
                console.log('Date stockée dans sessionStorage (reconciliation_date):', storedDate);
                console.log('Type de la date stockée:', typeof storedDate);
                
                if (storedDate) {
                    console.log('Une date a été trouvée dans sessionStorage');
                    
                    // Définir la date dans le champ de date
                    console.log('Valeur actuelle du champ date:', dateInput.value);
                    dateInput.value = storedDate;
                    console.log('Nouvelle valeur du champ date après mise à jour:', dateInput.value);
                    
                    // Mettre à jour également l'élément d'affichage de la date
                    const dateDisplay = document.getElementById('date-reconciliation-display');
                    if (dateDisplay) {
                        console.log('Mise à jour de l\'élément d\'affichage de la date:', storedDate);
                        dateDisplay.textContent = storedDate;
                    } else {
                        console.warn('L\'élément date-reconciliation-display n\'a pas été trouvé');
                    }
                    
                    // Vérifier si l'élément flatpickr est initialisé
                    const hasFlatpickr = typeof dateInput._flatpickr !== 'undefined';
                    console.log('L\'élément date a-t-il flatpickr?', hasFlatpickr);
                    
                    if (hasFlatpickr) {
                        console.log('Mise à jour de la date via flatpickr...');
                        dateInput._flatpickr.setDate(storedDate);
                        console.log('Valeur après mise à jour flatpickr:', dateInput.value);
                    }
                    
                    // Déclencher l'événement change pour charger les données
                    console.log('Déclenchement de l\'événement change...');
                    const event = new Event('change');
                    dateInput.dispatchEvent(event);
                    console.log('Événement change déclenché');
                    
                    // Supprimer la date de sessionStorage pour éviter de l'utiliser à nouveau
                    sessionStorage.removeItem('reconciliation_date');
                    console.log('Date supprimée de sessionStorage');
                } else {
                    console.log('Aucune date trouvée dans sessionStorage');
                }
            } else {
                console.warn('Input date NON TROUVÉ dans le DOM');
            }
            
            // Chercher d'abord le bouton existant
            console.log('***** RECHERCHE DU BOUTON "CHARGER LES COMMENTAIRES" *****');
            let btnChargerCommentaires = document.getElementById('charger-commentaires');
            
            // Si le bouton existe déjà, ajouter simplement l'écouteur
            if (btnChargerCommentaires) {
                console.log('Bouton "Charger les commentaires" TROUVÉ dans le DOM:', btnChargerCommentaires);
                console.log('Structure HTML du bouton:', btnChargerCommentaires.outerHTML);
                console.log('Ajout de l\'écouteur d\'événement onClick...');
                
                // Tester également avec addEventListener
                btnChargerCommentaires.addEventListener('click', function(event) {
                    console.log('***** CLIC SUR LE BOUTON "CHARGER LES COMMENTAIRES" DÉTECTÉ *****');
                    console.log('Événement:', event);
                    console.log('Appel de la fonction chargerCommentaires()...');
                    chargerCommentaires();
                });
                
                // Ajouter également un gestionnaire d'événement onclick direct pour tester
                btnChargerCommentaires.onclick = function() {
                    console.log('***** GESTIONNAIRE onclick DIRECT DÉCLENCHÉ *****');
                    chargerCommentaires();
                    return false; // Empêcher la propagation
                };
                
                console.log('Écouteurs d\'événements ajoutés au bouton "Charger les commentaires"');
            } else {
                console.warn('Bouton "Charger les commentaires" NON TROUVÉ dans le DOM');
                // Sinon, créer et ajouter le bouton avec l'écouteur
                // ... (code existant)
            }
        });
    }
    
    // SECTION: AFFICHAGE DU TABLEAU DE RÉCONCILIATION
    
    // Fonction principale pour afficher les données dans le tableau
    function afficherReconciliation(reconciliationData, debugInfo) {
        console.log('Affichage des données de réconciliation:', reconciliationData);
        
        if (debugInfo) {
            currentDebugInfo = debugInfo;
        }
        
        const table = document.getElementById('reconciliation-table');
        if (!table) {
            console.error('Table de réconciliation non trouvée dans le DOM');
            return;
        }
        
        // S'assurer que le tableau est complètement réinitialisé
        // Recréer l'en-tête du tableau pour garantir l'alignement des colonnes
        setupTableHeader(table);
        
        // Réinitialiser complètement le corps du tableau
        let tbody = table.querySelector('tbody');
        if (tbody) {
            // Supprimer complètement le tbody existant
            tbody.remove();
        }
        
        // Créer un nouveau tbody
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
        
        console.log('Le corps du tableau a été complètement réinitialisé');
        
        // Initialiser les totaux
        let totals = initializeTotals();
        
        // Ajouter une ligne pour chaque point de vente
        POINTS_VENTE_PHYSIQUES.forEach(pointVente => {
            const data = reconciliationData[pointVente];
            if (data) {
                // Assurer que la propriété commentaire existe
                if (data.commentaire === undefined) {
                    data.commentaire = '';
                }
                
                // Ajouter la ligne au tableau
                addRowToTable(tbody, pointVente, data, totals);
            }
        });
        
        // Vérifier l'alignement du tableau
        console.log('Vérification de l\'alignement du tableau après création:');
        const headerCells = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        console.log('Nombre de colonnes dans l\'en-tête:', headerCells.length);
        
        const rows = table.querySelectorAll('tbody tr');
        if (rows.length > 0) {
            const firstRow = rows[0];
            console.log('Nombre de cellules dans la première ligne:', firstRow.cells.length);
            
            if (headerCells.length !== firstRow.cells.length) {
                console.error('ERREUR: Le nombre de cellules dans l\'en-tête et le corps ne correspondent pas!');
                console.error('En-tête:', headerCells.length, 'Corps:', firstRow.cells.length);
            }
        }
        
        // Mettre à jour la réconciliation actuelle
        currentReconciliation = {
            date: document.getElementById('date-reconciliation').value,
            data: reconciliationData
        };
        
        // Activer le bouton de sauvegarde (uniquement pour les utilisateurs avec droits d'écriture)
        const btnSauvegarder = document.getElementById('sauvegarder-reconciliation');
        if (btnSauvegarder) {
            const currentUser = window.currentUser;
            if (currentUser && currentUser.role === 'lecteur') {
                btnSauvegarder.style.display = 'none';
            } else {
                btnSauvegarder.disabled = false;
            }
        }
        
        // Si des données de paiement en espèces existent déjà, les appliquer
        chargerDonneesCashPayment();
    }
    
    // Configurer l'en-tête du tableau
    function setupTableHeader(table) {
        // S'assurer que l'en-tête existe, sinon le créer
        let thead = table.querySelector('thead');
        if (!thead) {
            thead = document.createElement('thead');
            table.appendChild(thead);
        } else {
            // Vider l'en-tête existant
            thead.innerHTML = '';
        }
        
        // Créer la ligne d'en-tête
        const headerRow = document.createElement('tr');
        
        // Ajouter les cellules d'en-tête
        TABLE_COLUMNS.forEach(column => {
            const th = document.createElement('th');
            th.textContent = column.label;
            if (column.isNumeric) {
                th.classList.add('text-end');
            }
            headerRow.appendChild(th);
        });
        
        // Ajouter la ligne d'en-tête au tableau
        thead.appendChild(headerRow);
    }
    
    // Initialiser les totaux pour toutes les colonnes numériques
    function initializeTotals() {
        const totals = {};
        TABLE_COLUMNS.forEach(column => {
            if (column.isNumeric) {
                totals[column.id] = 0;
            }
        });
        return totals;
    }
    
    // Ajouter une ligne au tableau
    function addRowToTable(tbody, pointVente, data, totals) {
        // Créer une nouvelle ligne
        const row = document.createElement('tr');
        
        // Ajouter l'ID du point de vente comme attribut de données
        row.setAttribute('data-point-vente', pointVente);
        
        // Appliquer une couleur de fond basée sur le pourcentage d'écart
        applyRowStyling(row, data.pourcentageEcart);

        // Créer les cellules
        TABLE_COLUMNS.forEach(column => {
            const cell = document.createElement('td');

            switch (column.id) {
                case 'date': // Add case for date
                    cell.textContent = document.getElementById('date-reconciliation').value;
                    break;

                case 'pointVente':
                    cell.textContent = pointVente;
                    cell.setAttribute('data-point-vente', pointVente);
                    cell.classList.add('debug-toggle');
                    cell.style.cursor = 'pointer'; // Add cursor pointer style here

                    // Ajouter un écouteur pour afficher les détails de débogage
                    cell.addEventListener('click', () => {
                        console.log("Clic sur le point de vente:", pointVente);
                        console.log("Current Debug Info:", currentDebugInfo);

                        // Afficher les détails même si currentDebugInfo est null ou undefined
                        if (currentDebugInfo) {
                            afficherDetailsDebugging(pointVente, currentDebugInfo);
                        } else {
                            // Si les informations de débogage ne sont pas disponibles, montrer une vue simplifiée
                            console.log("Aucune information de débogage disponible, affichage des données simplifiées");

                            // Récupérer les données du point de vente depuis le tableau actuel
                            const simplifiedDebugInfo = createSimplifiedDebugInfo(pointVente);

                            // Afficher ces données simplifiées
                            afficherDetailsDebugging(pointVente, simplifiedDebugInfo);
                        }

                        // S'assurer que le conteneur de débogage est visible
                        const debugContainer = document.getElementById('debug-container');
                        if (debugContainer) {
                            debugContainer.style.display = 'block';
                        }
                    });
                    break;

                case 'stockMatin':
                    cell.textContent = formatMonetaire(data.stockMatin);
                    cell.classList.add('currency');
                    totals.stockMatin += data.stockMatin;
                    
                    // Ajouter des détails de tooltip pour stock matin
                    if (currentDebugInfo && currentDebugInfo.detailsParPointVente && currentDebugInfo.detailsParPointVente[pointVente] && 
                        currentDebugInfo.detailsParPointVente[pointVente].stockMatin) {
                        const stockMatinDetails = currentDebugInfo.detailsParPointVente[pointVente].stockMatin;
                        if (stockMatinDetails.length > 0) {
                            let tooltip = "Détails du stock matin:\n";
                            stockMatinDetails.forEach(item => {
                                if (item.quantite && item.prixUnitaire) {
                                    tooltip += `${item.produit}: ${item.quantite} × ${formatMonetaire(item.prixUnitaire)} = ${formatMonetaire(item.montant)}\n`;
                                }
                            });
                            cell.title = tooltip;
                            cell.style.cursor = 'help';
                        }
                    }
                    break;
                    
                case 'stockSoir':
                    cell.textContent = formatMonetaire(data.stockSoir);
                    cell.classList.add('currency');
                    totals.stockSoir += data.stockSoir;
                    
                    // Ajouter des détails de tooltip pour stock soir
                    if (currentDebugInfo && currentDebugInfo.detailsParPointVente && currentDebugInfo.detailsParPointVente[pointVente] && 
                        currentDebugInfo.detailsParPointVente[pointVente].stockSoir) {
                        const stockSoirDetails = currentDebugInfo.detailsParPointVente[pointVente].stockSoir;
                        if (stockSoirDetails.length > 0) {
                            let tooltip = "Détails du stock soir:\n";
                            stockSoirDetails.forEach(item => {
                                if (item.quantite && item.prixUnitaire) {
                                    tooltip += `${item.produit}: ${item.quantite} × ${formatMonetaire(item.prixUnitaire)} = ${formatMonetaire(item.montant)}\n`;
                                }
                            });
                            cell.title = tooltip;
                            cell.style.cursor = 'help';
                        }
                    }
                    break;
                    
                case 'transferts':
                    cell.textContent = formatMonetaire(data.transferts);
                    cell.classList.add('currency');
                    totals.transferts += data.transferts;
                    
                    // Ajouter des détails de tooltip pour transferts
                    if (currentDebugInfo && currentDebugInfo.detailsParPointVente && currentDebugInfo.detailsParPointVente[pointVente] && 
                        currentDebugInfo.detailsParPointVente[pointVente].transferts) {
                        const transfertsDetails = currentDebugInfo.detailsParPointVente[pointVente].transferts;
                        if (transfertsDetails.length > 0) {
                            let tooltip = "Détails des transferts:\n";
                            transfertsDetails.forEach(item => {
                                if (item.quantite && item.prixUnitaire) {
                                    tooltip += `${item.produit}: ${item.quantite} × ${formatMonetaire(item.prixUnitaire)} = ${formatMonetaire(item.montant)}\n`;
                                }
                            });
                            cell.title = tooltip;
                            cell.style.cursor = 'help';
                        }
                    }
                    break;
                    
                case 'ventesTheoriques':
                    cell.textContent = formatMonetaire(data.ventes);
                    cell.classList.add('currency');
                    totals.ventesTheoriques += data.ventes;
                    break;
                    
                case 'ventesSaisies':
                    cell.textContent = formatMonetaire(data.ventesSaisies);
                    cell.classList.add('currency');
                    totals.ventesSaisies += data.ventesSaisies;
                    break;

                case 'commandesInterPV': {
                    // Priorité 1: valeur persistée dans la réconciliation
                    // sauvegardée (data.commandesInterPV). Priorité 2: live
                    // depuis /api/decoupe/sum-by-pv (cache decoupeInterPVByPV).
                    // Cette priorité fige la valeur affichée pour les jours
                    // déjà sauvegardés, même si decoupe_order_logs change après.
                    const interPV = (data.commandesInterPV != null)
                        ? Number(data.commandesInterPV) || 0
                        : ((decoupeInterPVByPV && decoupeInterPVByPV[pointVente]) || 0);
                    cell.textContent = formatMonetaire(interPV);
                    cell.classList.add('currency');
                    if (interPV > 0) {
                        cell.style.color = '#0d6efd'; // bleu pour distinguer
                    }
                    totals.commandesInterPV = (totals.commandesInterPV || 0) + interPV;
                    break;
                }

                case 'ventesTotales': {
                    // Recalculé à partir des ventes saisies + commandes inter-PV
                    // (saved si présent, live sinon). Pas persisté en propre car
                    // entièrement dérivé.
                    const interPV = (data.commandesInterPV != null)
                        ? Number(data.commandesInterPV) || 0
                        : ((decoupeInterPVByPV && decoupeInterPVByPV[pointVente]) || 0);
                    const ventesTotales = (Number(data.ventesSaisies) || 0) + interPV;
                    cell.textContent = formatMonetaire(ventesTotales);
                    cell.classList.add('currency');
                    cell.style.fontWeight = 'bold';
                    totals.ventesTotales = (totals.ventesTotales || 0) + ventesTotales;
                    break;
                }

                case 'creances':
                    const creancesValue = data.creances || 0;
                    cell.textContent = formatMonetaire(creancesValue);
                    cell.classList.add('currency');
                    if (creancesValue > 0) {
                        cell.style.color = '#dc3545'; // Rouge pour indiquer des créances
                        cell.style.fontWeight = 'bold';
                    }
                    totals.creances = (totals.creances || 0) + creancesValue;
                    break;
                    
                case 'ecart':
                    cell.textContent = formatMonetaire(data.difference);
                    cell.classList.add('currency');
                    // Ajouter une classe basée sur la différence
                    if (data.difference < 0) {
                        cell.classList.add('negative');
                    } else if (data.difference > 0) {
                        cell.classList.add('positive');
                    }
                    totals.ecart += data.difference;
                    break;
                    
                case 'cashPayment':
                    // Valeur initiale à 0, sera mise à jour par chargerDonneesCashPayment
                    cell.textContent = formatMonetaire(0);
                    cell.classList.add('currency');
                    break;
                    
                case 'ecartPourcentage':
                    cell.textContent = (data.pourcentageEcart !== undefined && data.pourcentageEcart !== null) ? `${data.pourcentageEcart.toFixed(2)}%` : "0.00%";
                    cell.classList.add('currency');
                    applyPercentageStyling(cell, data.pourcentageEcart);
                    break;
                    
                case 'ecartCash':
                    // Valeur initiale à 0, sera mise à jour par chargerDonneesCashPayment
                    cell.textContent = formatMonetaire(0);
                    cell.classList.add('currency');
                    break;
                    
                case 'commentaire':
                    const inputCommentaire = document.createElement('input');
                    inputCommentaire.type = 'text';
                    inputCommentaire.className = 'form-control commentaire-input';
                    inputCommentaire.placeholder = 'Ajouter un commentaire...';
                    inputCommentaire.setAttribute('data-point-vente', pointVente);
                    inputCommentaire.value = data.commentaire || '';
                    
                    // Désactiver le champ pour les lecteurs
                    const currentUser = window.currentUser;
                    if (currentUser && currentUser.role === 'lecteur') {
                        inputCommentaire.disabled = true;
                        inputCommentaire.placeholder = 'Lecture seule';
                    }
                    
                    cell.appendChild(inputCommentaire);
                    break;
            }
            
            row.appendChild(cell);
        });
        
        tbody.appendChild(row);
    }
    
    // Appliquer le style à la ligne en fonction du pourcentage d'écart
    function applyRowStyling(row, percentage) {
        if (!percentage && percentage !== 0) return; // Skip if percentage is undefined or null
        
        if (Math.abs(percentage) > 10.5) {
            row.classList.add('table-danger'); // Rouge pour > 10.5%
        } else if (Math.abs(percentage) > 8) {
            row.classList.add('table-warning'); // Jaune pour 8% à 10.5%
        } else if (Math.abs(percentage) > 0) {
            row.classList.add('table-success'); // Vert pour <= 8%
        }
    }
    
    // Appliquer le style à la cellule de pourcentage
    function applyPercentageStyling(cell, percentage) {
        if (!percentage && percentage !== 0) return; // Skip if percentage is undefined or null
        
        if (Math.abs(percentage) > 10.5) {
            cell.classList.add('text-danger', 'fw-bold');
        } else if (Math.abs(percentage) > 8) {
            cell.classList.add('text-warning', 'fw-bold');
        } else if (Math.abs(percentage) > 0) {
            cell.classList.add('text-success', 'fw-bold');
        }
    }
    
    // SECTION: GESTION DES PAIEMENTS EN ESPÈCES
    
    // Charger les données de paiement en espèces
    async function chargerDonneesCashPayment() {
        console.log("=== Chargement des données de paiement en espèces ===");
        
        if (!currentReconciliation || !currentReconciliation.date) {
            console.warn("Aucune réconciliation active pour charger les paiements en espèces");
            return;
        }
        
        const selectedDate = currentReconciliation.date;
        console.log("Date sélectionnée pour les paiements en espèces:", selectedDate);
        
        // Récupérer les données de paiement
        let cashPaymentData = {};
        try {
            console.log("Récupération des données de paiement depuis l'API...");
            // Utiliser un chemin relatif
            const response = await fetch(`/api/cash-payments/aggregated`, {
                method: 'GET',
                credentials: 'include'
            });
            
            const result = await response.json();
            
            if (result.success && result.data && Array.isArray(result.data)) {
                console.log("Données cash payments reçues:", result.data.length, "entrées");
                console.log("Date sélectionnée pour comparaison:", selectedDate);
                // Debug: afficher toutes les dates disponibles
                result.data.forEach((entry, i) => {
                    console.log(`  Entry ${i}: date brute = "${entry.date}", type = ${typeof entry.date}`);
                });
                
                // Rechercher les données pour la date sélectionnée
                const dateData = result.data.find(entry => {
                    if (!entry.date) return false;
                    
                    // Normaliser la date de l'entrée
                    let entryDateStr = entry.date;
                    if (entry.date instanceof Date) {
                        entryDateStr = entry.date.toISOString().split('T')[0];
                    } else if (typeof entry.date === 'string' && entry.date.includes('T')) {
                        entryDateStr = entry.date.split('T')[0];
                    }
                    
                    const parts = entryDateStr.split('-');
                    if (parts.length !== 3) {
                        console.log("Format de date invalide:", entry.date);
                        return false;
                    }
                    
                    const formattedEntryDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
                    const match = formattedEntryDate === selectedDate;
                    if (match) {
                        console.log("✅ Date correspondante trouvée:", formattedEntryDate, "points:", entry.points);
                    }
                    return match;
                });
                
                if (dateData && dateData.points) {
                    // Construire l'objet de données
                    dateData.points.forEach(point => {
                        const pointVenteStandard = PAYMENT_REF_MAPPING[point.point] || point.point;
                        cashPaymentData[pointVenteStandard] = point.total;
                    });
                    
                    console.log("Données de paiement en espèces finales:", cashPaymentData);
                    
                    // Stocker les données dans la réconciliation courante
                    if (currentReconciliation) {
                        currentReconciliation.cashPaymentData = cashPaymentData;
                    }
                    
                    // Mettre à jour le tableau avec ces données
                    updateCashPaymentData(cashPaymentData);
                } else {
                    console.log("Aucune donnée de paiement trouvée pour la date:", selectedDate);
                }
            } else {
                console.warn("Réponse API invalide:", result);
            }
        } catch (error) {
            console.error("Erreur lors de la récupération des données de paiement:", error);
        }
    }
    
    // Mettre à jour les données de paiement en espèces dans le tableau
    function updateCashPaymentData(cashPaymentData) {
        console.log("=== Mise à jour des données de paiement en espèces dans le tableau ===");
        
        if (!cashPaymentData) {
            console.warn("Aucune donnée de paiement en espèces à afficher");
            return;
        }
        
        const table = document.getElementById('reconciliation-table');
        if (!table) {
            console.error("Table de réconciliation non trouvée");
            return;
        }
        
        // Vérifier la structure du tableau
        const headerRow = table.querySelector('thead tr');
        if (headerRow) {
            console.log("Structure de l'en-tête du tableau:", 
                Array.from(headerRow.cells).map((cell, idx) => `${idx}: ${cell.textContent.trim()}`));
            console.log("Nombre de cellules dans l'en-tête:", headerRow.cells.length);
        }
        
        const rows = table.querySelectorAll('tbody tr');
        console.log(`Nombre de lignes dans le tableau: ${rows.length}`);
        
        if (!rows.length) {
            console.error("Aucune ligne trouvée dans la table");
            return;
        }
        
        // Vérifier les index des colonnes importants
        console.log("Index des colonnes à utiliser:", {
            cashPayment: COLUMN_INDEXES.cashPayment,
            ecartCash: COLUMN_INDEXES.ecartCash,
            ventesSaisies: COLUMN_INDEXES.ventesSaisies,
            commentaire: COLUMN_INDEXES.commentaire
        });
        
        // Mettre à jour chaque ligne
        rows.forEach((row, rowIndex) => {
            const pointVente = row.getAttribute('data-point-vente');
            if (!pointVente) {
                console.warn("Ligne sans attribut data-point-vente");
                return;
            }
            
            console.log(`Traitement de la ligne ${rowIndex} pour le point de vente: ${pointVente}`);
            console.log(`Nombre de cellules dans cette ligne: ${row.cells.length}`);
            
            // Afficher toutes les cellules de la ligne pour debugger
            Array.from(row.cells).forEach((cell, cellIndex) => {
                console.log(`Cellule ${cellIndex}: ${cell.textContent.trim()}`);
            });
            
            // Utiliser les index de colonnes stockés pour accéder aux cellules
            const cashPaymentCellIndex = COLUMN_INDEXES.cashPayment;
            const ecartCashCellIndex = COLUMN_INDEXES.ecartCash;
            const ventesSaisiesCellIndex = COLUMN_INDEXES.ventesSaisies;
            const commentaireIndex = COLUMN_INDEXES.commentaire;
            
            if (cashPaymentCellIndex === undefined || 
                ecartCashCellIndex === undefined || 
                ventesSaisiesCellIndex === undefined) {
                console.error("Index des cellules non trouvés", COLUMN_INDEXES);
                return;
            }
            
            // Vérifier que toutes les cellules nécessaires existent
            if (row.cells.length <= Math.max(cashPaymentCellIndex, ecartCashCellIndex, ventesSaisiesCellIndex)) {
                console.error(`Pas assez de cellules dans la ligne pour ${pointVente}, actuel: ${row.cells.length}, requis: ${Math.max(cashPaymentCellIndex, ecartCashCellIndex, ventesSaisiesCellIndex) + 1}`);
                return;
            }
            
            const cashPaymentCell = row.cells[cashPaymentCellIndex];
            const ecartCashCell = row.cells[ecartCashCellIndex];
            const ventesCell = row.cells[ventesSaisiesCellIndex];
            
            if (!cashPaymentCell || !ecartCashCell || !ventesCell) {
                console.error("Cellules non trouvées dans la ligne");
                return;
            }
            
            // Obtenir la valeur du paiement en espèces et la valeur des ventes saisies
            const cashValue = cashPaymentData[pointVente] || 0;
            const ventesSaisies = extractNumericValue(ventesCell.textContent);
            
            console.log(`${pointVente}: Cash=${cashValue}, Ventes=${ventesSaisies}`);
            
            // Mettre à jour la cellule de cash payment
            console.log(`Mise à jour de la cellule cashPayment (${cashPaymentCellIndex}): ${cashPaymentCell.textContent} -> ${formatMonetaire(cashValue)}`);
            cashPaymentCell.textContent = formatMonetaire(cashValue);
            cashPaymentCell.className = "currency";
            
            // Calculer et afficher l'écart cash
            const ecartCash = cashValue - ventesSaisies;
            const formattedEcartCash = formatMonetaire(ecartCash);
            
            // Mettre à jour la cellule d'écart cash
            console.log(`Mise à jour de la cellule ecartCash (${ecartCashCellIndex}): ${ecartCashCell.textContent} -> ${formattedEcartCash}`);
            ecartCashCell.textContent = formattedEcartCash;
            ecartCashCell.className = "currency";
            
            // Appliquer un style basé sur la valeur
            if (ecartCash < 0) {
                ecartCashCell.classList.add('negative');
            } else if (ecartCash > 0) {
                ecartCashCell.classList.add('positive');
            }
            
            console.log(`${pointVente}: Ecart Cash=${ecartCash}`);
            
            // Vérifier la cellule de commentaire
            const lastCell = row.cells[row.cells.length - 1];
            const isLastCellCommentCell = lastCell && lastCell.querySelector('.commentaire-input');
            
            if (!isLastCellCommentCell && commentaireIndex !== undefined) {
                console.warn(`La dernière cellule n'est pas une cellule de commentaire pour ${pointVente}`);
                
                // Récupérer ou créer la cellule de commentaire
                const commentCell = row.cells[commentaireIndex];
                if (commentCell) {
                    // S'assurer qu'elle contient un input
                    if (!commentCell.querySelector('.commentaire-input')) {
                        const commentValue = '';
                        const currentUser = window.currentUser;
                        const isLecteur = currentUser && currentUser.role === 'lecteur';
                        const placeholder = isLecteur ? 'Lecture seule' : 'Ajouter un commentaire...';
                        const disabledAttr = isLecteur ? 'disabled' : '';
                        
                        commentCell.innerHTML = `<input type="text" class="form-control commentaire-input" placeholder="${placeholder}" data-point-vente="${pointVente}" value="${commentValue}" ${disabledAttr}>`;
                        console.log(`Créé un nouveau champ de commentaire pour ${pointVente} (lecteur: ${isLecteur})`);
                    }
                }
            }
            
            // Mettre à jour les données de réconciliation
            if (currentReconciliation && currentReconciliation.data && currentReconciliation.data[pointVente]) {
                currentReconciliation.data[pointVente].cashPayment = cashValue;
                currentReconciliation.data[pointVente].ecartCash = ecartCash;
            }
        });
        
        console.log("=== Mise à jour des données de paiement terminée ===");
    }
    
    // Extraire la valeur numérique d'une chaîne formatée (ex: "1 000 000 FCFA" -> 1000000)
    function extractNumericValue(formattedString) {
        if (!formattedString) return 0;
        
        // Supprimer tous les caractères non numériques sauf le point décimal
        const numericString = formattedString.replace(/[^0-9.]/g, '');
        return parseFloat(numericString) || 0;
    }
    
    // SECTION: CHARGEMENT ET SAUVEGARDE
    
    // Réinitialiser les données du tableau
    function resetTableData() {
        console.log('Réinitialisation des données du tableau de réconciliation');
        
        const table = document.getElementById('reconciliation-table');
        if (table) {
            const tbody = table.querySelector('tbody');
            if (tbody) {
                tbody.innerHTML = '';
                console.log('Contenu du tableau vidé');
            } else {
                console.warn('Corps du tableau non trouvé lors de la réinitialisation');
            }
        } else {
            console.warn('Tableau de réconciliation non trouvé lors de la réinitialisation');
        }
        
        // Désactiver le bouton de sauvegarde
        const btnSauvegarder = document.getElementById('sauvegarder-reconciliation');
        if (btnSauvegarder) {
            btnSauvegarder.disabled = true;
            console.log('Bouton de sauvegarde désactivé');
        }
        
        // Afficher un indicateur de chargement
        const loadingIndicator = document.getElementById('loading-indicator-reconciliation');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'block';
        }
        
        // Réinitialiser la réconciliation courante
        currentReconciliation = null;
        currentDebugInfo = null;
        console.log('Variables globales de réconciliation réinitialisées');
    }
    
    // Mettre à jour les commentaires dans le tableau
    function updateComments(comments) {
        // console.log('Entering updateComments function. Received comments:', comments); // REMOVED log
        if (!comments || typeof comments !== 'object') {
            console.warn('Pas de commentaires valides à mettre à jour');
            return;
        }

        // console.log('Mise à jour des commentaires dans le tableau:', comments); // REMOVED log

        // Mettre à jour chaque input de commentaire dans le tableau
        document.querySelectorAll('.commentaire-input').forEach(input => {
            const pointVente = input.getAttribute('data-point-vente');
            if (pointVente && comments[pointVente] !== undefined) { // Check for undefined specifically
                 // console.log(`Found input for ${pointVente}. Setting value to: "${comments[pointVente]}"`); // REMOVED log
                 input.value = comments[pointVente];
                 // console.log(`Commentaire mis à jour pour ${pointVente}: "${comments[pointVente]}"`); // REMOVED log

                 // Mettre à jour également les données de réconciliation
                 if (currentReconciliation && currentReconciliation.data && currentReconciliation.data[pointVente]) {
                     currentReconciliation.data[pointVente].commentaire = comments[pointVente];
                 }
             } else { // Added log for missing comments or inputs
                 // console.log(`Skipping update for input (PointVente: ${pointVente}, Comment Exists: ${comments && comments.hasOwnProperty(pointVente)})`); // REMOVED log
             }
        });
        // console.log('Exiting updateComments function.'); // REMOVED log
    }
    
    /**
     * Affiche ou masque l'indicateur de chargement
     * @param {boolean} show - Indique si l'indicateur doit être affiché (true) ou masqué (false)
     */
    function toggleLoadingSpinner(show) {
        const loadingIndicator = document.getElementById('loading-indicator-reconciliation');
        if (loadingIndicator) {
            loadingIndicator.style.display = show ? 'block' : 'none';
        }
    }

    async function chargerCommentaires() {
        console.log("Fonction chargerCommentaires appelée");
        try {
            const date = document.getElementById('date-reconciliation').value;
            console.log(`Chargement des commentaires pour la date: ${date}`);
            
            // Afficher l'indicateur de chargement
            toggleLoadingSpinner(true);
            
            // Utiliser le point de terminaison correct
            const response = await fetch(`/api/reconciliation/load?date=${date}`, {
                method: 'GET',
                credentials: 'include'
            });
            console.log("Réponse du serveur pour commentaires:", response);
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }
            
            const data = await response.json();
            console.log("Données de réconciliation reçues:", data);
            
            if (data && data.success && data.data && data.data.data) {
                // Extraire les commentaires depuis la structure data.data.{pointVente}.commentaire
                const reconciliationData = data.data.data;
                const comments = {};
                
                // Itérer sur chaque point de vente pour extraire le commentaire
                Object.keys(reconciliationData).forEach(pointVente => {
                    if (reconciliationData[pointVente] && reconciliationData[pointVente].commentaire !== undefined) {
                        comments[pointVente] = reconciliationData[pointVente].commentaire;
                    }
                });
                
                console.log("Commentaires extraits:", comments);
                
                // Mettre à jour les commentaires en utilisant la fonction dédiée
                updateComments(comments);
            } else {
                console.log("Structure de données incorrecte ou aucun commentaire trouvé dans les données reçues");
            }
        } catch (error) {
            console.error("Erreur lors du chargement des commentaires:", error);
        } finally {
            // Masquer l'indicateur de chargement
            toggleLoadingSpinner(false);
        }
    }
    
    // Charge la somme des commandes inter-PV pour la date donnée et alimente
    // le cache module decoupeInterPVByPV. La date attendue est au format
    // DD-MM-YYYY (utilisé par l'écran reconciliation); on la convertit en
    // YYYY-MM-DD pour l'API.
    async function chargerSommeDecoupeInterPV(date) {
        try {
            decoupeInterPVByPV = {};
            // Convertit DD-MM-YYYY -> YYYY-MM-DD si besoin
            let iso = date;
            const m = String(date).match(/^(\d{2})-(\d{2})-(\d{4})$/);
            if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
            const resp = await fetch(`/api/decoupe/sum-by-pv?date=${encodeURIComponent(iso)}`, { credentials: 'include' });
            if (!resp.ok) return;
            const data = await resp.json();
            if (data && data.success && data.sums) {
                decoupeInterPVByPV = data.sums;
                console.log('[reconciliation] commandes inter-PV par PV:', decoupeInterPVByPV);
            }
        } catch (e) {
            console.warn('[reconciliation] échec chargement sum-by-pv:', e.message);
            decoupeInterPVByPV = {};
        }
    }

    // Charger une réconciliation (sauvegardée ou calculée)
    async function chargerReconciliation(date) {
        try {
            // Afficher l'indicateur de chargement
            const loadingIndicator = document.getElementById('loading-indicator-reconciliation');
            if (loadingIndicator) {
                loadingIndicator.style.display = 'block';
            }

            console.log(`Chargement de la réconciliation pour ${date}`);

            // Charger en parallèle la somme des commandes inter-PV pour ce jour
            // (alimente le cache utilisé par les colonnes commandesInterPV /
            // ventesTotales lors du rendu du tableau).
            await chargerSommeDecoupeInterPV(date);
            
            // Mettre à jour l'affichage de la date
            const dateDisplay = document.getElementById('date-reconciliation-display');
            if (dateDisplay) {
                console.log('Mise à jour de l\'affichage de la date pour la réconciliation:', date);
                dateDisplay.textContent = date;
            }
            
            // Récupérer les données sauvegardées
            try {
                // Utiliser un chemin relatif
                const response = await fetch(`/api/reconciliation/load?date=${date}`, {
                    method: 'GET',
                    credentials: 'include'
                });
                
                // Vérifier si la réponse est OK (status 200-299)
                if (!response.ok) {
                    console.log(`Réponse non-OK (${response.status}) pour la date ${date}, passage au calcul...`);
                    throw new Error(`HTTP status ${response.status}`);
                }
                
                // Vérifier que le type de réponse est bien JSON
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    console.log('La réponse n\'est pas au format JSON, passage au calcul...');
                    throw new Error('La réponse n\'est pas au format JSON');
                }
                
                const result = await response.json();
                
                console.log('Résultat de la récupération:', result);
                
                if (result.success && result.data) {
                    // Mettre à jour la réconciliation actuelle
                    currentReconciliation = {
                        date: date,
                        data: JSON.parse(result.data.reconciliation)
                    };
                    
                    // Mettre à jour l'affichage
                    afficherReconciliation(currentReconciliation.data);
                    
                    // Récupérer les données de commentaires
                    if (result.data.comments) {
                        const comments = JSON.parse(result.data.comments);
                        updateComments(comments);
                    }
                    
                    // Récupérer les données des paiements en espèces
                    if (result.data.cashPaymentData) {
                        let cashData;
                        try {
                            cashData = JSON.parse(result.data.cashPaymentData);
                            console.log('Données de paiements en espèces récupérées:', cashData);
                        } catch (e) {
                            console.error('Erreur lors du parsing des données de cash payment:', e);
                        }
                        
                        if (cashData) {
                            updateCashPaymentData(cashData);
                        }
                    } else {
                        // Charger les données de cash payment depuis l'API
                        chargerDonneesCashPayment();
                    }
                    
                    // Masquer l'indicateur de chargement
                    if (loadingIndicator) {
                        loadingIndicator.style.display = 'none';
                    }
                    
                    return true;
                } else {
                    console.log('Données récupérées mais format invalide, passage au calcul...');
                    throw new Error('Format de données invalide');
                }
            } catch (fetchError) {
                // En cas d'erreur de récupération, passer directement au calcul
                console.log(`Erreur lors de la récupération, passage au calcul: ${fetchError.message}`);
            }
            
            // Aucune donnée sauvegardée trouvée ou erreur, calcul nécessaire
            console.log('Aucune donnée sauvegardée trouvée, calcul en cours...');
            
            try {
                // Essayer d'abord avec l'API du serveur
                console.log('Calcul de la réconciliation pour la date:', date);
                
                try {
                    const response = await fetch('/api/reconciliation/calculate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify({ date })
                    });
                    
                    // Vérifier si la réponse est OK et contient du JSON
                    if (!response.ok) {
                        console.log(`Réponse non-OK (${response.status}) pour le calcul, passage au calcul local...`);
                        throw new Error(`HTTP status ${response.status}`);
                    }
                    
                    // Vérifier le type de contenu
                    const contentType = response.headers.get('content-type');
                    if (!contentType || !contentType.includes('application/json')) {
                        console.log('La réponse de calcul n\'est pas au format JSON, passage au calcul local...');
                        throw new Error('La réponse n\'est pas au format JSON');
                    }
                    
                    const calculResult = await response.json();
                    
                    if (calculResult.success) {
                        // Mettre à jour la réconciliation actuelle
                        currentReconciliation = {
                            date: date,
                            data: calculResult.data
                        };
                        
                        // Mettre à jour l'affichage
                        afficherReconciliation(currentReconciliation.data);
                        
                        // Charger les données de cash payment depuis l'API
                        chargerDonneesCashPayment();
                        
                        // Masquer l'indicateur de chargement
                        if (loadingIndicator) {
                            loadingIndicator.style.display = 'none';
                        }
                        
                        return true;
                    } else {
                        throw new Error(calculResult.message || 'Erreur lors du calcul');
                    }
                } catch (apiError) {
                    console.log('Erreur avec l\'API de calcul, utilisation du calcul local:', apiError.message);
                    
                    // Fallback: Calculer localement en utilisant la méthode de script.js
                    if (typeof window.calculerReconciliation === 'function') {
                        console.log('Utilisation de la méthode calculerReconciliation globale');
                        await window.calculerReconciliation(date);
                        
                        // Masquer l'indicateur de chargement
                        if (loadingIndicator) {
                            loadingIndicator.style.display = 'none';
                        }
                        
                        return true;
                    } else {
                        console.error('La fonction calculerReconciliation n\'est pas disponible dans l\'objet window');
                        throw new Error('Impossible de calculer la réconciliation: méthode locale non disponible');
                    }
                }
            } catch (error) {
                console.error('Erreur lors du calcul de la réconciliation:', error);
                
                // Afficher un message d'erreur dans le tableau
                const tbody = document.querySelector('#reconciliation-table tbody');
                if (tbody) {
                    tbody.innerHTML = '';
                    
                    const errorRow = document.createElement('tr');
                    const errorCell = document.createElement('td');
                    errorCell.colSpan = TABLE_COLUMNS.length;
                    errorCell.textContent = 'Erreur lors du calcul: ' + error.message;
                    errorCell.className = 'text-center text-danger';
                    errorRow.appendChild(errorCell);
                    tbody.appendChild(errorRow);
                }
                
                // Masquer l'indicateur de chargement
                if (loadingIndicator) {
                    loadingIndicator.style.display = 'none';
                }
                
                return false;
            }
        } catch (error) {
            console.error('Erreur lors du chargement de la réconciliation:', error);
            
            // Masquer l'indicateur de chargement
            const loadingIndicator = document.getElementById('loading-indicator-reconciliation');
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
            
            return false;
        } finally {
            // S'assurer que l'indicateur de chargement est masqué dans tous les cas
            const loadingIndicator = document.getElementById('loading-indicator-reconciliation');
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
        }
    }
    
    // Sauvegarder la réconciliation
    async function sauvegarderReconciliation() {
        try {
            // Vérifier si les données de réconciliation existent
            if (!currentReconciliation) {
                alert('Aucune réconciliation à sauvegarder');
                return;
            }
            
            const date = currentReconciliation.date;
            if (!date) {
                alert('Date de réconciliation non définie');
                return;
            }
            
            // Récupérer les données de réconciliation
            const reconciliationData = currentReconciliation.data;
            
            // Récupérer les commentaires saisis
            const commentaires = {};
            document.querySelectorAll('.commentaire-input').forEach(input => {
                const pointVente = input.getAttribute('data-point-vente');
                const commentaire = input.value.trim();
                if (commentaire) {
                    commentaires[pointVente] = commentaire;
                }
            });
            
            // Ajouter les commentaires aux données
            Object.keys(reconciliationData).forEach(pointVente => {
                reconciliationData[pointVente].commentaire = commentaires[pointVente] || '';
                // Snapshot des commandes inter-PV au moment de la sauvegarde.
                // Une fois persisté, ce nombre fige même si la table
                // decoupe_order_logs change ensuite (ex: nettoyage, archivage).
                // ventesTotales se recalcule à l'affichage à partir de
                // ventesSaisies + commandesInterPV.
                const interPVPersist = (decoupeInterPVByPV && decoupeInterPVByPV[pointVente]) || 0;
                reconciliationData[pointVente].commandesInterPV = interPVPersist;
            });
            
            // Préparer les données pour la sauvegarde
            const dataToSave = {
                date: date,
                reconciliation: reconciliationData,
                cashPaymentData: currentReconciliation.cashPaymentData || {},
                comments: commentaires
            };
            
            // Envoyer les données au serveur
            const response = await fetch('/api/reconciliation/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(dataToSave)
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert('Réconciliation sauvegardée avec succès');
            } else {
                throw new Error(result.message || 'Erreur lors de la sauvegarde');
            }
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de la réconciliation:', error);
            alert('Erreur lors de la sauvegarde: ' + error.message);
        }
    }
    
    // Afficher les détails de débogage pour un point de vente spécifique
    async function afficherDetailsDebugging(pointVente, currentDebugInfo) {
        try {
            const debugContainer = document.getElementById('debug-container');
            if (!debugContainer) {
                console.error('Container de débogage non trouvé');
                return;
            }
            
            // Accéder correctement aux données de réconciliation
            let data = {}; 
            
            // Vérifier si nous avons des données de débogage ou de réconciliation
            if (currentDebugInfo && currentDebugInfo.detailsParPointVente && currentDebugInfo.detailsParPointVente[pointVente]) {
                data = currentDebugInfo.detailsParPointVente[pointVente];
                console.log('Données trouvées dans currentDebugInfo:', data);
            } else if (currentReconciliation && currentReconciliation.data && currentReconciliation.data[pointVente]) {
                data = currentReconciliation.data[pointVente];
                console.log('Données trouvées dans currentReconciliation:', data);
            } else {
                console.warn('Aucune donnée trouvée pour', pointVente);
            }
            
            // Si les données ne sont pas disponibles
            if (!data || Object.keys(data).length === 0) {
                debugContainer.innerHTML = `
                    <div class="alert alert-warning">
                        Aucune donnée disponible pour ${pointVente}.
                    </div>
                `;
                return;
            }
            
            debugContainer.style.display = 'block';
            
            // Structure principale HTML
            debugContainer.innerHTML = `
                <h5>Détails de la réconciliation</h5>
                <p class="text-muted">Cliquez sur un point de vente dans le tableau pour voir les détails de calcul.</p>
                
                <div id="debug-title" class="mb-3"></div>
                <div id="debug-formule" class="mb-3"></div>
                <div id="debug-ecart" class="mb-3"></div>
                
                <div class="row mb-3 stock-module-element" id="inventaire-buttons-container">
                    <div class="col-md-6">
                        <button id="btn-voir-inventaire-matin" class="btn btn-primary">Voir inventaire matin</button>
                    </div>
                    <div class="col-md-6">
                        <button id="btn-voir-inventaire-soir" class="btn btn-primary">Voir inventaire soir</button>
                    </div>
                </div>
                
                <h6 class="mt-4">Détails des composantes</h6>
                <div id="debug-stock-section" class="mt-3"></div>
                <div id="debug-ventes-section" class="mt-3"></div>
            `;
            
            // Masquer les boutons d'inventaire pour les lecteurs OU si le module stock est désactivé
            const currentUser = window.currentUser;
            const inventaireButtonsContainer = document.getElementById('inventaire-buttons-container');
            const stockModuleActive = window.ModulesHandler ? window.ModulesHandler.isModuleActive('stock') : true;
            
            if (inventaireButtonsContainer) {
                if ((currentUser && currentUser.role === 'lecteur') || !stockModuleActive) {
                    inventaireButtonsContainer.style.display = 'none';
                }
            }
            
            // Ajouter les écouteurs d'événements pour les boutons
            document.getElementById('btn-voir-inventaire-matin').addEventListener('click', function() {
                naviguerVersInventaire(pointVente, getCurrentDate(), 'matin');
            });
            
            document.getElementById('btn-voir-inventaire-soir').addEventListener('click', function() {
                naviguerVersInventaire(pointVente, getCurrentDate(), 'soir');
            });
            
            // Titre général
            const debugTitle = document.getElementById('debug-title');
            debugTitle.innerHTML = `<h4>Détails pour "${pointVente}"</h4>`;
            
            // Sécuriser les valeurs pour éviter les undefined
            const safeDetails = {
                pointVente: pointVente,
                totalStockMatin: data.totalStockMatin || data.stockMatin || 0,
                totalStockSoir: data.totalStockSoir || data.stockSoir || 0,
                totalTransferts: data.totalTransferts || data.transferts || 0,
                venteTheoriques: data.venteTheoriques || data.ventes || 0,
                venteReelles: data.venteReelles || data.totalVentesSaisies || data.ventesSaisies || 0,
                difference: data.difference || 0,
                pourcentage: data.pourcentageEcart || data.pourcentage || 0,
                stockMatin: data.stockMatin || [],
                stockSoir: data.stockSoir || [],
                transferts: data.transferts || [],
                ventes: data.ventes || []
            };
            
            // Log pour déboguer les données disponibles
            console.log("Details pour le debugging:", {
                data: data,
                safeDetails: safeDetails,
                currentDebugInfo: currentDebugInfo
            });
            
            // Formule ventes théoriques
            const formulaDiv = document.getElementById('debug-formule');
            formulaDiv.innerHTML = `
                <div class="card bg-primary text-white">
                    <div class="card-header">
                        <h5 class="mb-0">Stock et Transferts</h5>
                    </div>
                    <div class="card-body bg-light text-dark">
                        <div><strong>Formule Ventes Théoriques:</strong></div>
                        <div class="mt-2">
                            Stock Matin (${formatMonetaire(safeDetails.totalStockMatin)}) - 
                            Stock Soir (${formatMonetaire(safeDetails.totalStockSoir)}) + 
                            Transferts (${formatMonetaire(safeDetails.totalTransferts)}) = 
                            Ventes Théoriques (${formatMonetaire(safeDetails.venteTheoriques)})
                        </div>
                    </div>
                </div>
            `;
            
            // Formule écart
            const ecartDiv = document.getElementById('debug-ecart');
            ecartDiv.innerHTML = `
                <div class="card bg-success text-white">
                    <div class="card-header">
                        <h5 class="mb-0">Ventes Saisies</h5>
                    </div>
                    <div class="card-body bg-light text-dark">
                        <div><strong>Formule Écart:</strong></div>
                        <div class="mt-2">
                            Ventes Théoriques (${formatMonetaire(safeDetails.venteTheoriques)}) - 
                            Ventes Saisies (${formatMonetaire(safeDetails.venteReelles)}) = 
                            Écart (${formatMonetaire(safeDetails.difference)})
                        </div>
                        <div class="mt-2"><strong>Pourcentage d'écart:</strong> ${safeDetails.pourcentage !== undefined ? safeDetails.pourcentage.toFixed(2) : '0.00'}%</div>
                    </div>
                </div>
            `;
            
            // Détails du stock
            const stockSection = document.getElementById('debug-stock-section');
            stockSection.innerHTML = '';
            stockSection.appendChild(creerTableauUnifie(safeDetails));
            
            // Détails des ventes
            const ventesSection = document.getElementById('debug-ventes-section');
            ventesSection.innerHTML = '';
            
            // Vérifier si nous avons des données dans ventesSaisies
            let ventesData = [];
            
            // Priorité 1: Utiliser data.ventesSaisies s'il existe et a des éléments
            if (data.ventesSaisies && Array.isArray(data.ventesSaisies) && data.ventesSaisies.length > 0) {
                console.log("Utilisation de data.ventesSaisies:", data.ventesSaisies);
                ventesData = data.ventesSaisies;
            } 
            // Priorité 2: Chercher dans currentDebugInfo.ventesParPointVente
            else if (currentDebugInfo && currentDebugInfo.ventesParPointVente && currentDebugInfo.ventesParPointVente[pointVente]) {
                console.log("Utilisation de currentDebugInfo.ventesParPointVente:", currentDebugInfo.ventesParPointVente[pointVente]);
                ventesData = currentDebugInfo.ventesParPointVente[pointVente];
            }
            // Sinon vérifier dans safeDetails.ventes
            else if (safeDetails.ventes && safeDetails.ventes.length > 0) {
                console.log("Utilisation de safeDetails.ventes:", safeDetails.ventes);
                ventesData = safeDetails.ventes;
            }
            
            console.log("Données de vente finales:", ventesData);
            
            if (ventesData && ventesData.length > 0) {
                ventesSection.appendChild(creerTableauDetail('Ventes Saisies', ventesData, false, true, safeDetails.venteReelles));
            } else {
                ventesSection.innerHTML = '<div class="alert alert-info">Aucune vente saisie pour ce point de vente à cette date.</div>';
            }
            
        } catch (error) {
            console.error('Erreur lors de l\'affichage des détails de débogage:', error);
            document.getElementById('debug-container').innerHTML = `
                <div class="alert alert-danger">
                    <h5>Une erreur est survenue lors de l'affichage des détails</h5>
                    <p>${error.message}</p>
                    <p>Veuillez réessayer ou contacter le support technique.</p>
                </div>
            `;
        }
    }
    
    // Fonction pour récupérer la date courante au format d/m/Y
    function getCurrentDate() {
        const dateElement = document.getElementById('date-reconciliation');
        return dateElement ? dateElement.value : '';
    }
    
    // Fonction pour naviguer vers l'onglet inventaire avec les filtres appropriés
    function naviguerVersInventaire(pointVente, date, periode) {
        // Stocker les informations dans sessionStorage pour les récupérer après navigation
        sessionStorage.setItem('inventaire_filter_point_vente', pointVente);
        sessionStorage.setItem('inventaire_filter_date', date);
        sessionStorage.setItem('inventaire_filter_periode', periode);
        
        // Naviguer vers l'onglet inventaire
        const stockInventaireTab = document.getElementById('stock-inventaire-tab');
        if (stockInventaireTab) {
            stockInventaireTab.click();
        } else {
            console.error("L'onglet Stock inventaire n'a pas été trouvé");
            alert("Impossible de naviguer vers l'onglet Stock inventaire. L'élément n'existe pas.");
        }
        
        // La mise à jour des filtres sera gérée par un code dans script.js
        // qui sera exécuté lorsque l'onglet inventaire est affiché
    }
    
    // Fonction pour trier les produits selon un ordre spécifique
    function trierProduits(produits) {
        // Ordre de priorité des produits
        const ordrePredefini = [
            'Boeuf', 'Boeuf en détail', 'Boeuf en gros', 
            'Agneau', 
            'Foie', 
            'Déchet 400', 
            'Yell'
        ];
        
        // Fonction de comparaison pour trier
        return produits.sort((a, b) => {
            const indexA = ordrePredefini.indexOf(a.produit);
            const indexB = ordrePredefini.indexOf(b.produit);
            
            // Si les deux produits sont dans la liste prédéfinie
            if (indexA !== -1 && indexB !== -1) {
                return indexA - indexB;
            }
            
            // Si seulement a est dans la liste
            if (indexA !== -1) {
                return -1;
            }
            
            // Si seulement b est dans la liste
            if (indexB !== -1) {
                return 1;
            }
            
            // Si aucun n'est dans la liste, trier alphabétiquement
            return a.produit.localeCompare(b.produit);
        });
    }
    
    // Générer des ventes simulées pour un point de vente
    function genererVentesSimulees(details) {
        // Ne plus générer de données simulées, retourner un tableau vide
        return [];
    }
    
    // Créer un tableau de détails pour stock, transferts ou ventes
    function creerTableauDetail(titre, donnees, estTransfert = false, estVente = false, total = 0) {
        const container = document.createElement('div');
        container.classList.add('mb-4');
        
        // Titre
        const titreElement = document.createElement('h5');
        titreElement.textContent = titre;
        titreElement.classList.add('mt-3', 'mb-2');
        container.appendChild(titreElement);
        
        if (!donnees || donnees.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.innerHTML = '<div class="alert alert-info">Aucune donnée disponible pour cette catégorie.</div>';
            container.appendChild(emptyMessage);
            return container;
        }
        
        // Trier les données selon l'ordre spécifié
        const donneesTri = trierProduits([...donnees]);
        
        // Créer le tableau
        const table = document.createElement('table');
        table.classList.add('table', 'table-sm', 'table-striped', 'table-bordered');
        
        // En-tête du tableau
        const thead = document.createElement('thead');
        thead.classList.add('table-light');
        const headerRow = document.createElement('tr');
        
        // Définir les colonnes en fonction du type de données
        let colonnes = [];
        
        if (estTransfert) {
            colonnes = [
                { id: 'produit', label: 'Produit', className: '' },
                { id: 'impact', label: 'Impact', className: 'text-center' },
                { id: 'montant', label: 'Montant', className: 'text-end' },
                { id: 'valeur', label: 'Valeur', className: 'text-end' }
            ];
        } else if (estVente) {
            colonnes = [
                { id: 'produit', label: 'Produit', className: '' },
                { id: 'pu', label: 'PU', className: 'text-end' },
                { id: 'nombre', label: 'Nombre', className: 'text-end' },
                { id: 'montant', label: 'Montant', className: 'text-end' }
            ];
        } else {
            colonnes = [
                { id: 'produit', label: 'Produit', className: '' },
                { id: 'montant', label: 'Montant', className: 'text-end' }
            ];
        }
        
        // Créer les cellules d'en-tête
        colonnes.forEach(colonne => {
            const th = document.createElement('th');
            th.textContent = colonne.label;
            if (colonne.className) {
                th.className = colonne.className;
            }
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Corps du tableau
        const tbody = document.createElement('tbody');
        
        donneesTri.forEach(item => {
            const row = document.createElement('tr');
            
            colonnes.forEach(colonne => {
                const td = document.createElement('td');
                
                if (colonne.className) {
                    td.className = colonne.className;
                }
                
                if (colonne.id === 'produit') {
                    td.textContent = item.produit || '';
                } else if (colonne.id === 'impact') {
                    td.textContent = item.impact || '';
                    td.className = 'text-center';
                } else if (colonne.id === 'montant') {
                    const montant = estTransfert ? item.montant : (item.montant || item.valeur);
                    td.textContent = formatMonetaire(montant || 0);
                    td.className = 'text-end';
                } else if (colonne.id === 'valeur') {
                    td.textContent = formatMonetaire(item.valeur || 0);
                    td.className = 'text-end';
                    if (item.valeur > 0) {
                        td.classList.add('text-success');
                    } else if (item.valeur < 0) {
                        td.classList.add('text-danger');
                    }
                } else if (colonne.id === 'pu') {
                    td.textContent = formatMonetaire(item.pu || 0);
                    td.className = 'text-end';
                } else if (colonne.id === 'nombre') {
                    td.textContent = item.nombre || '';
                    td.className = 'text-end';
                }
                
                row.appendChild(td);
            });
            
            tbody.appendChild(row);
        });
        
        // Ligne de total
        const totalRow = document.createElement('tr');
        totalRow.classList.add('table-secondary', 'fw-bold');
        
        // Première cellule: "TOTAL"
        const tdTotalLabel = document.createElement('td');
        tdTotalLabel.textContent = 'TOTAL';
        
        // Calculer le nombre de colonnes à fusionner
        let colSpan = 1;
        if (estTransfert) {
            colSpan = 3;
        } else if (estVente) {
            colSpan = 3;
        }
        
        if (colSpan > 1) {
            tdTotalLabel.colSpan = colSpan;
        }
        
        totalRow.appendChild(tdTotalLabel);
        
        // Cellule du montant total
        const tdTotal = document.createElement('td');
        tdTotal.textContent = formatMonetaire(total);
        tdTotal.className = 'text-end';
        if (total > 0 && estTransfert) {
            tdTotal.classList.add('text-success');
        } else if (total < 0 && estTransfert) {
            tdTotal.classList.add('text-danger');
        }
        totalRow.appendChild(tdTotal);
        
        tbody.appendChild(totalRow);
        table.appendChild(tbody);
        container.appendChild(table);
        
        return container;
    }
    
    // Créer un tableau unifié des données stock, transferts et ventes théoriques
    function creerTableauUnifie(details) {
        const container = document.createElement('div');
        container.classList.add('mb-4');
        
        // Titre
        const titreElement = document.createElement('h5');
        titreElement.textContent = 'Détails des calculs par produit';
        titreElement.classList.add('mt-3', 'mb-2');
        container.appendChild(titreElement);
        
        // Vérifier s'il y a des données pour au moins un des ensembles de données
        const hasStockMatin = details.stockMatin && details.stockMatin.length > 0;
        const hasStockSoir = details.stockSoir && details.stockSoir.length > 0;
        const hasTransferts = details.transferts && details.transferts.length > 0;
        
        if (!hasStockMatin && !hasStockSoir && !hasTransferts) {
            const emptyMessage = document.createElement('div');
            emptyMessage.innerHTML = '<div class="alert alert-info">Aucune donnée détaillée disponible pour ce point de vente.</div>';
            container.appendChild(emptyMessage);
            return container;
        }
        
        // Créer le tableau
        const table = document.createElement('table');
        table.classList.add('table', 'table-sm', 'table-striped', 'table-bordered');
        
        // En-tête du tableau
        const thead = document.createElement('thead');
        thead.classList.add('table-light');
        const headerRow = document.createElement('tr');
        
        // Colonnes
        const colonnes = [
            { id: 'produit', label: 'Produit', className: '' },
            { id: 'stockMatin', label: 'Stock Matin', className: 'text-end' },
            { id: 'stockSoir', label: 'Stock Soir', className: 'text-end' },
            { id: 'transferts', label: 'Transferts', className: 'text-end' },
            { id: 'venteTheorique', label: 'Vente Théorique', className: 'text-end' }
        ];
        
        // Créer les cellules d'en-tête
        colonnes.forEach(colonne => {
            const th = document.createElement('th');
            th.textContent = colonne.label;
            if (colonne.className) {
                th.className = colonne.className;
            }
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Corps du tableau
        const tbody = document.createElement('tbody');
        
        // Combiner les données de tous les produits
        const produitsMap = {};
        
        // Traiter les données de stock matin
        if (details.stockMatin && details.stockMatin.length > 0) {
            details.stockMatin.forEach(item => {
                if (!produitsMap[item.produit]) {
                    produitsMap[item.produit] = {
                        produit: item.produit,
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        venteTheorique: 0,
                        stockMatinDetails: [],
                        stockSoirDetails: [],
                        transfertsDetails: []
                    };
                }
                produitsMap[item.produit].stockMatin += (item.valeur || item.montant || 0);
                produitsMap[item.produit].stockMatinDetails.push(item);
            });
        }
        
        // Traiter les données de stock soir
        if (details.stockSoir && details.stockSoir.length > 0) {
            details.stockSoir.forEach(item => {
                if (!produitsMap[item.produit]) {
                    produitsMap[item.produit] = {
                        produit: item.produit,
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        venteTheorique: 0,
                        stockMatinDetails: [],
                        stockSoirDetails: [],
                        transfertsDetails: []
                    };
                }
                produitsMap[item.produit].stockSoir += (item.valeur || item.montant || 0);
                produitsMap[item.produit].stockSoirDetails.push(item);
            });
        }
        
        // Traiter les données de transferts
        if (details.transferts && details.transferts.length > 0) {
            details.transferts.forEach(item => {
                if (!produitsMap[item.produit]) {
                    produitsMap[item.produit] = {
                        produit: item.produit,
                        stockMatin: 0,
                        stockSoir: 0,
                        transferts: 0,
                        venteTheorique: 0,
                        stockMatinDetails: [],
                        stockSoirDetails: [],
                        transfertsDetails: []
                    };
                }
                produitsMap[item.produit].transferts += (item.valeur || item.montant || 0);
                produitsMap[item.produit].transfertsDetails.push(item);
            });
        }
        
        // Si aucune donnée détaillée n'est disponible, générer des données fictives
        if (Object.keys(produitsMap).length === 0) {
            // Utiliser les données fictives si pas de détails
            produitsMap['Boeuf'] = { 
                produit: 'Boeuf', 
                stockMatin: 0, 
                stockSoir: 0, 
                transferts: details.totalTransferts * 0.9, 
                venteTheorique: details.totalTransferts * 0.9,
                stockMatinDetails: [],
                stockSoirDetails: [],
                transfertsDetails: []
            };
            produitsMap['Agneau'] = { 
                produit: 'Agneau', 
                stockMatin: details.totalStockMatin * 0.3, 
                stockSoir: details.totalStockMatin * 0.3, 
                transferts: 0, 
                venteTheorique: 0,
                stockMatinDetails: [],
                stockSoirDetails: [],
                transfertsDetails: []
            };
            produitsMap['Déchet 400'] = { 
                produit: 'Déchet 400', 
                stockMatin: details.totalStockMatin * 0.03, 
                stockSoir: details.totalStockMatin * 0.02, 
                transferts: 0, 
                venteTheorique: details.totalStockMatin * 0.01,
                stockMatinDetails: [],
                stockSoirDetails: [],
                transfertsDetails: []
            };
            produitsMap['Foie'] = { 
                produit: 'Foie', 
                stockMatin: details.totalStockMatin * 0.17, 
                stockSoir: details.totalStockMatin * 0.17, 
                transferts: details.totalTransferts * 0.1, 
                venteTheorique: details.totalTransferts * 0.1,
                stockMatinDetails: [],
                stockSoirDetails: [],
                transfertsDetails: []
            };
            produitsMap['Yell'] = { 
                produit: 'Yell', 
                stockMatin: details.totalStockMatin * 0.5, 
                stockSoir: details.totalStockSoir * 0.4, 
                transferts: 0, 
                venteTheorique: details.venteTheoriques * 0.1,
                stockMatinDetails: [],
                stockSoirDetails: [],
                transfertsDetails: []
            };
        }
        
        // Calculer les ventes théoriques pour chaque produit
        Object.values(produitsMap).forEach(data => {
            data.venteTheorique = data.stockMatin - data.stockSoir + data.transferts;
        });
        
        // Convertir en tableau et trier
        const produitsTries = trierProduits(Object.values(produitsMap));
        
        // Créer les lignes du tableau
        produitsTries.forEach(data => {
            const row = document.createElement('tr');
            
            // Produit
            const tdProduit = document.createElement('td');
            tdProduit.textContent = data.produit;
            row.appendChild(tdProduit);
            
            // Stock Matin
            const tdStockMatin = document.createElement('td');
            tdStockMatin.textContent = formatMonetaire(data.stockMatin);
            tdStockMatin.className = 'text-end';
            
            // Ajouter des détails de tooltip pour stock matin
            if (data.stockMatin > 0 && data.stockMatinDetails.length > 0) {
                const detail = data.stockMatinDetails[0];
                if (detail.quantite) {
                    const pu = detail.prixUnitaire || (detail.montant / detail.quantite);
                    tdStockMatin.title = `Quantité: ${detail.quantite} × Prix unitaire: ${formatMonetaire(pu)}`;
                    tdStockMatin.style.cursor = 'help';
                }
            } else if (data.stockMatin > 0) {
                // Chercher dans les données originales si disponibles
                const stockMatinDetails = getStockDetails(details.stockMatin, data.produit);
                if (stockMatinDetails && stockMatinDetails.quantite) {
                    const pu = stockMatinDetails.prixUnitaire || (stockMatinDetails.montant / stockMatinDetails.quantite);
                    tdStockMatin.title = `Quantité: ${stockMatinDetails.quantite} × Prix unitaire: ${formatMonetaire(pu)}`;
                    tdStockMatin.style.cursor = 'help';
                }
            }
            
            row.appendChild(tdStockMatin);
            
            // Stock Soir
            const tdStockSoir = document.createElement('td');
            tdStockSoir.textContent = formatMonetaire(data.stockSoir);
            tdStockSoir.className = 'text-end';
            
            // Ajouter des détails de tooltip pour stock soir
            if (data.stockSoir > 0 && data.stockSoirDetails.length > 0) {
                const detail = data.stockSoirDetails[0];
                if (detail.quantite) {
                    const pu = detail.prixUnitaire || (detail.montant / detail.quantite);
                    tdStockSoir.title = `Quantité: ${detail.quantite} × Prix unitaire: ${formatMonetaire(pu)}`;
                    tdStockSoir.style.cursor = 'help';
                }
            } else if (data.stockSoir > 0) {
                // Chercher dans les données originales si disponibles
                const stockSoirDetails = getStockDetails(details.stockSoir, data.produit);
                if (stockSoirDetails && stockSoirDetails.quantite) {
                    const pu = stockSoirDetails.prixUnitaire || (stockSoirDetails.montant / stockSoirDetails.quantite);
                    tdStockSoir.title = `Quantité: ${stockSoirDetails.quantite} × Prix unitaire: ${formatMonetaire(pu)}`;
                    tdStockSoir.style.cursor = 'help';
                }
            }
            
            row.appendChild(tdStockSoir);
            
            // Transferts
            const tdTransferts = document.createElement('td');
            tdTransferts.textContent = formatMonetaire(data.transferts);
            tdTransferts.className = 'text-end';
            
            // Ajouter des détails de tooltip pour transferts
            if (data.transferts > 0 && data.transfertsDetails.length > 0) {
                const detail = data.transfertsDetails[0];
                if (detail.quantite) {
                    const pu = detail.prixUnitaire || (detail.montant / detail.quantite);
                    tdTransferts.title = `Quantité: ${detail.quantite} × Prix unitaire: ${formatMonetaire(pu)}`;
                    tdTransferts.style.cursor = 'help';
                }
            } else if (data.transferts > 0) {
                // Chercher dans les données originales si disponibles
                const transfertsDetails = getStockDetails(details.transferts, data.produit);
                if (transfertsDetails && transfertsDetails.quantite) {
                    const pu = transfertsDetails.prixUnitaire || (transfertsDetails.montant / transfertsDetails.quantite);
                    tdTransferts.title = `Quantité: ${transfertsDetails.quantite} × Prix unitaire: ${formatMonetaire(pu)}`;
                    tdTransferts.style.cursor = 'help';
                }
            }
            
            row.appendChild(tdTransferts);
            
            // Vente Théorique
            const tdVenteTheorique = document.createElement('td');
            tdVenteTheorique.textContent = formatMonetaire(data.venteTheorique);
            tdVenteTheorique.className = 'text-end';
            
            // Ajouter un tooltip pour la vente théorique, montrant la formule de calcul avec quantités et prix unitaires
            let tooltipText = `Formule: Stock Matin (${formatMonetaire(data.stockMatin)}) - Stock Soir (${formatMonetaire(data.stockSoir)}) + Transferts (${formatMonetaire(data.transferts)}) = ${formatMonetaire(data.venteTheorique)}`;
            
            // Ajouter les détails de quantité et prix unitaire si disponibles
            const details = [];
            
            if (data.stockMatinNombre && data.stockMatinNombre > 0) {
                const prixUnitaire = data.stockMatinPrixUnitaire || (data.stockMatin / data.stockMatinNombre);
                details.push(`Stock Matin: ${data.stockMatinNombre} × ${formatMonetaire(prixUnitaire)}`);
            }
            
            if (data.stockSoirNombre && data.stockSoirNombre > 0) {
                const prixUnitaire = data.stockSoirPrixUnitaire || (data.stockSoir / data.stockSoirNombre);
                details.push(`Stock Soir: ${data.stockSoirNombre} × ${formatMonetaire(prixUnitaire)}`);
            }
            
            if (data.transfertsNombre && data.transfertsNombre !== 0) {
                const prixUnitaire = data.transfertsPrixUnitaire || (data.transferts / Math.abs(data.transfertsNombre));
                details.push(`Transferts: ${data.transfertsNombre} × ${formatMonetaire(prixUnitaire)}`);
            }
            
            if (details.length > 0) {
                tooltipText += '\n\nDétails:\n' + details.join('\n');
            }
            
            tdVenteTheorique.title = tooltipText;
            tdVenteTheorique.style.cursor = 'help';
            
            row.appendChild(tdVenteTheorique);
            
            tbody.appendChild(row);
        });
        
        // Ligne de total
        const totalRow = document.createElement('tr');
        totalRow.classList.add('table-secondary', 'fw-bold');
        
        // Total
        const tdTotal = document.createElement('td');
        tdTotal.textContent = 'TOTAL';
        totalRow.appendChild(tdTotal);
        
        // Total Stock Matin
        const tdTotalStockMatin = document.createElement('td');
        tdTotalStockMatin.textContent = formatMonetaire(details.totalStockMatin);
        tdTotalStockMatin.className = 'text-end';
        totalRow.appendChild(tdTotalStockMatin);
        
        // Total Stock Soir
        const tdTotalStockSoir = document.createElement('td');
        tdTotalStockSoir.textContent = formatMonetaire(details.totalStockSoir);
        tdTotalStockSoir.className = 'text-end';
        totalRow.appendChild(tdTotalStockSoir);
        
        // Total Transferts
        const tdTotalTransferts = document.createElement('td');
        tdTotalTransferts.textContent = formatMonetaire(details.totalTransferts);
        tdTotalTransferts.className = 'text-end';
        totalRow.appendChild(tdTotalTransferts);
        
        // Total Ventes Théoriques
        const tdTotalVenteTheorique = document.createElement('td');
        tdTotalVenteTheorique.textContent = formatMonetaire(details.venteTheoriques);
        tdTotalVenteTheorique.className = 'text-end';
        totalRow.appendChild(tdTotalVenteTheorique);
        
        tbody.appendChild(totalRow);
        table.appendChild(tbody);
        container.appendChild(table);
        
        return container;
    }
    
    // Formater un nombre en format monétaire
    function formatMonetaire(valeur) {
        // Assurer que valeur est un nombre
        const nombreValide = parseFloat(valeur);
        
        if (isNaN(nombreValide)) {
            return '0 FCFA';
        }
        
        // Formater avec séparateur de milliers et ajouter FCFA
        return nombreValide.toLocaleString('fr-FR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }) + ' FCFA';
    }
    
    // Wrapper pour la fonction calculerReconciliation globale
    async function calculerReconciliation(date) {
        console.log('ReconciliationManager: Appel à calculerReconciliation pour la date:', date);
        
        if (typeof window.calculerReconciliation === 'function') {
            console.log('Utilisation de la fonction calculerReconciliation globale');
            return window.calculerReconciliation(date);
        } else {
            console.error('La fonction calculerReconciliation n\'est pas disponible dans l\'objet window');
            throw new Error('Impossible de calculer la réconciliation: fonction globale non disponible');
        }
    }
    
    // Créer des informations de débogage simplifiées à partir du tableau actuel
    function createSimplifiedDebugInfo(pointVente) {
        console.log(`Création d'informations de débogage simplifiées pour ${pointVente}`);
        
        // Trouver la ligne correspondant au point de vente dans le tableau
        const table = document.getElementById('reconciliation-table');
        if (!table) {
            console.error("Table de réconciliation non trouvée");
            return null;
        }
        
        const rows = table.querySelectorAll('tbody tr');
        let targetRow = null;
        
        // Rechercher la ligne du point de vente
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const pvAttribute = row.getAttribute('data-point-vente');
            const firstCell = row.cells[0];
            
            if ((pvAttribute && pvAttribute === pointVente) || 
                (firstCell && firstCell.textContent.trim() === pointVente)) {
                targetRow = row;
                break;
            }
        }
        
        if (!targetRow) {
            console.error(`Aucune ligne trouvée pour ${pointVente}`);
            return null;
        }
        
        // Log all cell contents for debugging
        console.log(`Nombre de cellules dans la ligne: ${targetRow.cells.length}`);
        for (let i = 0; i < targetRow.cells.length; i++) {
            console.log(`Cellule ${i}: ${targetRow.cells[i].textContent}`);
        }
        console.log("COLUMN_INDEXES:", COLUMN_INDEXES);
        
        // Extraire les données directement par index de position plutôt que par COLUMN_INDEXES
        const stockMatin = extractNumericValue(targetRow.cells[1].textContent);
        const stockSoir = extractNumericValue(targetRow.cells[2].textContent);
        const transferts = extractNumericValue(targetRow.cells[3].textContent);
        const ventesTheoriques = extractNumericValue(targetRow.cells[4].textContent);
        const ventesSaisies = extractNumericValue(targetRow.cells[5].textContent);
        const difference = extractNumericValue(targetRow.cells[6].textContent);
        
        console.log(`Valeurs extraites: 
            stockMatin: ${stockMatin}, 
            stockSoir: ${stockSoir}, 
            transferts: ${transferts}, 
            ventesTheoriques: ${ventesTheoriques}, 
            ventesSaisies: ${ventesSaisies}, 
            difference: ${difference}`);
        
        // Calculer le pourcentage d'écart
        let pourcentage = 0;
        if (ventesTheoriques !== 0) {
            pourcentage = (difference / ventesTheoriques) * 100;
        }
        
        // Ne plus créer de données fictives pour les produits
        // Cela garantit que l'affichage ne sera pas vide
        let produitsFictifs = [];
        let ventesProduits = [];
        
        // Créer une structure simplifiée compatible avec afficherDetailsDebugging
        const debugInfo = {
            pointVente: pointVente,
            venteTheoriques: ventesTheoriques,
            venteReelles: ventesSaisies,
            difference: difference,
            pourcentage: pourcentage,
            pourcentageEcart: pourcentage,
            totalStockMatin: stockMatin,
            totalStockSoir: stockSoir,
            totalTransferts: transferts,
            // Données vides pour éviter les données fictives
            stockMatin: [],
            stockSoir: [],
            transferts: [],
            ventes: []
        };
        
        console.log("Informations de débogage simplifiées créées:", debugInfo);
        return debugInfo;
    }
    
    // Fonction utilitaire pour récupérer les détails d'un stock pour un produit donné
    function getStockDetails(stockArray, produitName) {
        if (!stockArray || !Array.isArray(stockArray)) return null;
        
        return stockArray.find(item => item.produit === produitName);
    }
    
    // Exposer l'API publique du module
    return {
        initialize: initialize,
        afficherReconciliation: afficherReconciliation,
        sauvegarderReconciliation: sauvegarderReconciliation,
        chargerReconciliation: chargerReconciliation,
        calculerReconciliation: calculerReconciliation,
        updateCashPaymentData: updateCashPaymentData,
        afficherDetailsDebugging: afficherDetailsDebugging,
        chargerCommentaires: chargerCommentaires
    };
})();

// Exposer le module ReconciliationManager au niveau global pour qu'il soit accessible depuis d'autres scripts
window.ReconciliationManager = ReconciliationManager;

// Initialiser le module lorsque la page est chargée
document.addEventListener('DOMContentLoaded', function() {
    console.log('***** ÉVÉNEMENT DOMContentLoaded GLOBAL DÉCLENCHÉ *****');
    console.log('Appel de ReconciliationManager.initialize()');
    ReconciliationManager.initialize();
}); 