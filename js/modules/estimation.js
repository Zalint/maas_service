/**
 * Module de gestion des estimations
 */

import { standardiserDate, formatMonetaire } from './utils.js';

// Variables globales pour la pagination
let currentPage = 1;
let totalPages = 1;
let pageSize = 10;

/**
 * Initialise le module d'estimation
 */
async function initEstimation() {
    // Initialiser les écouteurs d'événements
    const form = document.getElementById('estimation-form');
    const dateInput = document.getElementById('estimation-date');
    const pointVenteSelect = document.getElementById('estimation-point-vente');
    const categorieSelect = document.getElementById('estimation-categorie');

    // Initialiser le datepicker
    $(dateInput).datepicker({
        format: 'dd-mm-yyyy',
        autoclose: true,
        language: 'fr',
        todayHighlight: true
    });

    // Définir la date d'aujourd'hui par défaut
    const today = new Date();
    $(dateInput).datepicker('setDate', today);

    // Charger les catégories
    await chargerCategories();

    // Écouteurs d'événements
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await sauvegarderEstimation();
    });

    // Écouteurs pour le calcul automatique
    dateInput.addEventListener('change', calculerDonnees);
    pointVenteSelect.addEventListener('change', calculerDonnees);
    categorieSelect.addEventListener('change', calculerDonnees);

    // Charger les estimations initiales
    await chargerEstimations();
}

/**
 * Charge les catégories disponibles
 */
async function chargerCategories() {
    try {
        const categorieSelect = document.getElementById('estimation-categorie');
        categorieSelect.innerHTML = '<option value="">Sélectionner une catégorie</option>';
        
        // Utiliser les clés de produitsInventaire pour les catégories
        if (window.produitsInventaire && typeof window.produitsInventaire.getTousLesProduits === 'function') {
            const categories = window.produitsInventaire.getTousLesProduits();
            
            categories.forEach(categorie => {
                const option = document.createElement('option');
                option.value = categorie;
                option.textContent = categorie;
                categorieSelect.appendChild(option);
            });
        } else {
            console.error('produitsInventaire non disponible ou fonction getTousLesProduits manquante');
            
            // Tentative de rechargement différé
            let tentatives = 0;
            const maxTentatives = 3;
            const intervalleVerification = setInterval(() => {
                tentatives++;
                
                if (window.produitsInventaire && typeof window.produitsInventaire.getTousLesProduits === 'function') {
                    console.log('produitsInventaire chargé avec succès après', tentatives, 'tentative(s)');
                    chargerCategories();
                    clearInterval(intervalleVerification);
                } else if (tentatives >= maxTentatives) {
                    console.error('produitsInventaire toujours non disponible après', maxTentatives, 'tentatives');
                    alert('Erreur: Impossible de charger la liste des produits. Veuillez recharger la page ou contacter l\'administrateur.');
                    clearInterval(intervalleVerification);
                }
            }, 1000);
        }
    } catch (error) {
        console.error('Erreur lors du chargement des catégories:', error);
        alert('Erreur lors du chargement des catégories');
    }
}

/**
 * Calcule les données automatiques (stock soir et ventes effectuées)
 */
async function calculerDonnees() {
    const date = document.getElementById('estimation-date').value;
    const pointVente = document.getElementById('estimation-point-vente').value;
    const categorie = document.getElementById('estimation-categorie').value;

    if (!date || !pointVente || !categorie) return;

    try {
        // Calculer le stock du soir
        const responseStock = await fetch(`/api/stock-soir?date=${date}&pointVente=${pointVente}&categorie=${categorie}`);
        const dataStock = await responseStock.json();
        
        if (dataStock.success) {
            document.getElementById('stock-soir').value = dataStock.stockSoir || 0;
        }

        // Calculer les ventes effectuées
        const responseVentes = await fetch(`/api/ventes-effectuees?date=${date}&pointVente=${pointVente}&categorie=${categorie}`);
        const dataVentes = await responseVentes.json();
        
        if (dataVentes.success) {
            document.getElementById('ventes-effectuees').value = dataVentes.ventesEffectuees || 0;
        }
    } catch (error) {
        console.error('Erreur lors du calcul des données:', error);
        alert('Erreur lors du calcul des données');
    }
}

/**
 * Sauvegarde une estimation
 */
async function sauvegarderEstimation() {
    const estimation = {
        date: document.getElementById('estimation-date').value,
        pointVente: document.getElementById('estimation-point-vente').value,
        categorie: document.getElementById('estimation-categorie').value,
        stockSoir: parseFloat(document.getElementById('stock-soir').value) || 0,
        preCommandeDemain: parseFloat(document.getElementById('pre-commande').value) || 0,
        previsionVentes: parseFloat(document.getElementById('prevision-ventes').value) || 0,
        ventesEffectuees: parseFloat(document.getElementById('ventes-effectuees').value) || 0
    };

    try {
        const response = await fetch('/api/estimations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(estimation)
        });

        const data = await response.json();

        if (data.success) {
            alert('Estimation enregistrée avec succès');
            await chargerEstimations();
            document.getElementById('estimation-form').reset();
            $(document.getElementById('estimation-date')).datepicker('setDate', new Date());
        } else {
            alert('Erreur lors de l\'enregistrement de l\'estimation: ' + data.message);
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde de l\'estimation:', error);
        alert('Erreur lors de la sauvegarde de l\'estimation');
    }
}

/**
 * Charge et affiche les estimations
 */
async function chargerEstimations() {
    try {
        const response = await fetch('/api/estimations');
        const data = await response.json();

        if (data.success) {
            afficherEstimations(data.estimations);
        }
    } catch (error) {
        console.error('Erreur lors du chargement des estimations:', error);
        alert('Erreur lors du chargement des estimations');
    }
}

/**
 * Affiche les estimations dans le tableau
 */
function afficherEstimations(estimations) {
    const tbody = document.getElementById('estimations-table-body');
    tbody.innerHTML = '';

    estimations.forEach(estimation => {
        const row = document.createElement('tr');
        
        // Format stock soir and ventes effectuées with italics if zero
        const stockSoirFormatted = estimation.stockSoir === 0 ? 
            `<i>${estimation.stockSoir.toFixed(2)}</i>` : 
            estimation.stockSoir.toFixed(2);
            
        const ventesEffectueesFormatted = estimation.ventesEffectuees === 0 ? 
            `<i>${estimation.ventesEffectuees.toFixed(2)}</i>` : 
            estimation.ventesEffectuees.toFixed(2);

        row.innerHTML = `
            <td>${standardiserDate(estimation.date)}</td>
            <td>${estimation.pointVente}</td>
            <td>${estimation.categorie}</td>
            <td class="text-end">${stockSoirFormatted}</td>
            <td class="text-end">${estimation.preCommandeDemain.toFixed(2)}</td>
            <td class="text-end">${estimation.previsionVentes.toFixed(2)}</td>
            <td class="text-end">${ventesEffectueesFormatted}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="supprimerEstimation(${estimation.id})" aria-label="Supprimer l'estimation">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

/**
 * Supprime une estimation
 */
async function supprimerEstimation(id) {
    const ok = await showConfirmModal('Voulez-vous vraiment supprimer cette estimation ?', {
        title: 'Supprimer estimation', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (!ok) return;

    try {
        const response = await fetch(`/api/estimations/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            await chargerEstimations();
        } else {
            alert('Erreur lors de la suppression de l\'estimation: ' + data.message);
        }
    } catch (error) {
        console.error('Erreur lors de la suppression de l\'estimation:', error);
        alert('Erreur lors de la suppression de l\'estimation');
    }
}

/**
 * Updates the stock matin value based on selected date, point de vente, and category
 */
async function updateEstimationStockMatin() {
    console.log('=== UPDATE ESTIMATION STOCK MATIN START ===');
    
    const dateInput = document.getElementById('estimation-date');
    const pointVente = document.getElementById('estimation-point-vente').value;
    const categorie = document.getElementById('estimation-categorie').value;
    const stockMatinInput = document.getElementById('stock-matin-estimation');

    console.log('Form values:', {
        date: dateInput ? dateInput.value : 'not found',
        pointVente,
        categorie
    });

    if (!dateInput || !pointVente || !categorie) {
        console.warn('Missing required fields:', {
            dateInput: !!dateInput,
            pointVente: !!pointVente,
            categorie: !!categorie
        });
        stockMatinInput.value = '';
        return;
    }

    try {
        const date = dateInput.value; // This will be in YYYY-MM-DD format
        console.log('Making API request with:', {
            date,
            pointVente,
            categorie
        });

        const url = `/api/stock/${date}/matin/${pointVente}/${categorie}`;
        console.log('API URL:', url);

        const response = await fetch(url);
        console.log('API Response status:', response.status);
        
        const data = await response.json();
        console.log('API Response data:', data);

        if (response.ok && data.stock !== undefined) {
            stockMatinInput.value = data.stock;
            stockMatinInput.style.fontStyle = 'normal';
            console.log('Stock matin value updated:', data.stock);
        } else {
            stockMatinInput.value = '0';
            stockMatinInput.style.fontStyle = 'italic';
            console.log('No stock matin found, set to 0');
        }
    } catch (error) {
        console.error('Error in updateEstimationStockMatin:', error);
        stockMatinInput.value = '0';
        stockMatinInput.style.fontStyle = 'italic';
    }
    
    console.log('=== UPDATE ESTIMATION STOCK MATIN END ===');
}

/**
 * Updates the transfert value based on selected date, point de vente, and category
 */
async function updateEstimationTransfert() {
    console.log('=== UPDATE ESTIMATION TRANSFERT START ===');
    
    const dateInput = document.getElementById('estimation-date');
    const pointVente = document.getElementById('estimation-point-vente').value;
    const categorie = document.getElementById('estimation-categorie').value;
    const transfertInput = document.getElementById('transfert-estimation');

    console.log('Form values:', {
        date: dateInput ? dateInput.value : 'not found',
        pointVente,
        categorie
    });

    if (!dateInput || !pointVente || !categorie) {
        console.warn('Missing required fields:', {
            dateInput: !!dateInput,
            pointVente: !!pointVente,
            categorie: !!categorie
        });
        transfertInput.value = '';
        return;
    }

    try {
        const date = dateInput.value; // This will be in YYYY-MM-DD format
        console.log('Making API request with:', {
            date,
            pointVente,
            categorie
        });

        const url = `/api/stock/${date}/transfert/${pointVente}/${categorie}`;
        console.log('API URL:', url);

        const response = await fetch(url);
        console.log('API Response status:', response.status);
        
        const data = await response.json();
        console.log('API Response data:', data);

        if (response.ok && data.transfert !== undefined) {
            transfertInput.value = data.transfert;
            transfertInput.style.fontStyle = 'normal';
            console.log('Transfert value updated:', data.transfert);
        } else {
            transfertInput.value = '0';
            transfertInput.style.fontStyle = 'italic';
            console.log('No transfert found, set to 0');
        }
    } catch (error) {
        console.error('Error in updateEstimationTransfert:', error);
        transfertInput.value = '0';
        transfertInput.style.fontStyle = 'italic';
    }
    
    console.log('=== UPDATE ESTIMATION TRANSFERT END ===');
}

// Add event listeners to form fields
document.addEventListener('DOMContentLoaded', function() {
    const dateInput = document.getElementById('estimation-date');
    const pointVenteSelect = document.getElementById('estimation-point-vente');
    const categorieSelect = document.getElementById('estimation-categorie');

    // Update all values when any of the form fields change
    const updateAllValues = () => {
        updateEstimationStockMatin();
        updateEstimationTransfert();
        updateEstimationStock(); // This is the existing function for stock soir
    };

    dateInput.addEventListener('change', updateAllValues);
    pointVenteSelect.addEventListener('change', updateAllValues);
    categorieSelect.addEventListener('change', updateAllValues);
});

// Exporter les fonctions
export {
    initEstimation,
    chargerEstimations,
    supprimerEstimation
}; 