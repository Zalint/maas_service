/**
 * Module de gestion des ventes
 */

import { standardiserDate, formatMonetaire } from './utils.js';

// Variables globales pour la pagination
let currentPage = 1;
let totalPages = 1;
let pageSize = 10;
let totalVentes = 0;

/**
 * Affiche les dernières ventes dans le tableau
 * @param {Array} ventes - Liste des ventes à afficher
 */
function afficherDernieresVentes(ventes) {
    const tableBody = document.getElementById('ventes-recentes-body');
    if (!tableBody) {
        console.error('Élément #ventes-recentes-body non trouvé');
        return;
    }
    
    tableBody.innerHTML = '';
    
    ventes.forEach(vente => {
        const row = document.createElement('tr');
        
        // Définir la classe en fonction de l'âge
        if (isToday(vente.Date)) {
            row.classList.add('today-row');
        }
        
        // Date standardisée
        const dateStd = standardiserDate(vente.Date);
        
        // Créer les cellules du tableau
        row.innerHTML = `
            <td>${dateStd}</td>
            <td>${vente['Point de Vente']}</td>
            <td>${vente.Produit}</td>
            <td class="text-end">${formatMonetaire(vente.PU)}</td>
            <td class="text-end">${vente.Nombre}</td>
            <td class="text-end">${formatMonetaire(vente.Montant)}</td>
            <td>
                <button class="btn btn-sm btn-danger" 
                        onclick="supprimerVente(${vente.id})" 
                        aria-label="Supprimer la vente">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
}

/**
 * Charge les dernières ventes depuis l'API
 * @returns {Promise<Array>} Liste des ventes
 */
async function chargerDernieresVentes() {
    try {
        const response = await fetch('/api/ventes/recent');
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success) {
            if (data.ventes && Array.isArray(data.ventes)) {
                // Tri par date (plus récente en premier)
                const ventes = data.ventes.sort((a, b) => {
                    // Fonction pour convertir une date au format comparable
                    const getComparableDate = (dateStr) => {
                        // Standardiser la date
                        const standardDate = standardiserDate(dateStr);
                        if (!standardDate) return '';
                        
                        // Convertir au format AAAA-MM-JJ pour comparaison
                        const [jour, mois, annee] = standardDate.split('-');
                        return `${annee}-${mois}-${jour}`;
                    };
                    
                    const dateA = getComparableDate(a.Date);
                    const dateB = getComparableDate(b.Date);
                    
                    // Tri décroissant (plus récente en premier)
                    return dateB.localeCompare(dateA);
                });
                
                // Afficher les ventes
                afficherDernieresVentes(ventes);
                return ventes;
            } else {
                console.error('Format de données inattendu:', data);
                return [];
            }
        } else {
            console.error('Erreur lors du chargement des ventes récentes:', data.message);
            return [];
        }
    } catch (error) {
        console.error('Erreur lors du chargement des dernières ventes:', error);
        return [];
    }
}

/**
 * Crée une nouvelle entrée de vente
 */
function creerNouvelleEntree() {
    try {
        // Récupérer les valeurs des champs
        const date = document.getElementById('date').value;
        const pointVente = document.getElementById('point-vente').value;
        const preparation = document.getElementById('preparation').value;
        const categorie = document.getElementById('categorie').value;
        const produit = document.getElementById('produit').value;
        const pu = document.getElementById('pu').value;
        const nombre = document.getElementById('nombre').value;
        
        // Validation des champs obligatoires
        if (!date || !pointVente || !categorie || !produit || !pu || !nombre) {
            alert('Veuillez remplir tous les champs obligatoires');
            return;
        }
        
        // Calcul du montant
        const puValue = parseFloat(pu.replace(/\s/g, ''));
        const nombreValue = parseFloat(nombre.replace(/,/g, '.'));
        const montant = puValue * nombreValue;
        
        // Préparation des données à envoyer
        const nouvelleVente = {
            date: date,
            pointVente: pointVente,
            preparation: preparation || pointVente,
            categorie: categorie,
            produit: produit,
            pu: puValue,
            nombre: nombreValue,
            montant: montant
        };
        
        // Ajouter la nouvelle entrée à la base de données
        ajouterVente(nouvelleVente);
    } catch (error) {
        console.error('Erreur lors de la création d\'une nouvelle entrée:', error);
        alert('Une erreur est survenue lors de la création de l\'entrée.');
    }
}

/**
 * Ajoute une vente à la base de données
 * @param {Object} vente - Données de la vente
 */
async function ajouterVente(vente) {
    try {
        const response = await fetch('/api/ventes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(vente)
        });
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Afficher les dernières ventes mises à jour
            if (data.dernieresVentes) {
                afficherDernieresVentes(data.dernieresVentes);
            }
            
            // Réinitialiser le formulaire
            document.getElementById('vente-form').reset();
            
            // Mettre le focus sur le premier champ
            document.getElementById('date').focus();
            
            // Afficher un message de succès
            alert('Vente ajoutée avec succès !');
        } else {
            console.error('Erreur lors de l\'ajout de la vente:', data.message);
            alert('Erreur lors de l\'ajout de la vente: ' + data.message);
        }
    } catch (error) {
        console.error('Erreur lors de l\'ajout de la vente:', error);
        alert('Une erreur est survenue lors de l\'ajout de la vente.');
    }
}

/**
 * Supprime une vente
 * @param {number} venteId - ID de la vente à supprimer
 */
async function supprimerVente(venteId) {
    if (!venteId) {
        console.error('ID de vente non spécifié');
        return;
    }
    
    // Demander confirmation avant suppression
    const ok = await showConfirmModal('Êtes-vous sûr de vouloir supprimer cette vente ?', {
        title: 'Supprimer la vente', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (!ok) {
        return;
    }
    
    try {
        const response = await fetch(`/api/ventes/${venteId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Recharger les dernières ventes
            chargerDernieresVentes();
            
            // Afficher un message de succès
            alert('Vente supprimée avec succès !');
        } else {
            console.error('Erreur lors de la suppression de la vente:', data.message);
            alert('Erreur lors de la suppression de la vente: ' + data.message);
        }
    } catch (error) {
        console.error('Erreur lors de la suppression de la vente:', error);
        alert('Une erreur est survenue lors de la suppression de la vente.');
    }
}

/**
 * Affiche une page spécifique de ventes
 * @param {number} page - Numéro de page
 */
function afficherPageVentes(page) {
    if (page < 1 || page > totalPages) {
        console.error('Numéro de page invalide:', page);
        return;
    }
    
    currentPage = page;
    chargerVentes();
    updatePaginationInfo();
}

/**
 * Met à jour les informations de pagination
 */
function updatePaginationInfo() {
    const paginationInfo = document.getElementById('pagination-info');
    if (paginationInfo) {
        paginationInfo.textContent = `Page ${currentPage} sur ${totalPages} (${totalVentes} ventes)`;
    }
    
    // Mettre à jour les boutons de pagination
    const prevBtn = document.getElementById('pagination-prev');
    const nextBtn = document.getElementById('pagination-next');
    
    if (prevBtn) {
        prevBtn.disabled = currentPage <= 1;
    }
    
    if (nextBtn) {
        nextBtn.disabled = currentPage >= totalPages;
    }
    
    // Mettre à jour les liens de pagination
    const paginationContainer = document.getElementById('pagination-links');
    if (paginationContainer) {
        paginationContainer.innerHTML = '';
        
        // Nombre de liens à afficher avant et après la page actuelle
        const range = 2;
        
        // Calculer la plage de pages à afficher
        let startPage = Math.max(1, currentPage - range);
        let endPage = Math.min(totalPages, currentPage + range);
        
        // Toujours montrer au moins 5 liens si possible
        const maxLinks = 5;
        if (endPage - startPage + 1 < maxLinks && totalPages > maxLinks) {
            if (startPage === 1) {
                endPage = Math.min(totalPages, startPage + maxLinks - 1);
            } else if (endPage === totalPages) {
                startPage = Math.max(1, endPage - maxLinks + 1);
            }
        }
        
        // Ajouter un lien pour la première page si nécessaire
        if (startPage > 1) {
            addPaginationLink(1);
            if (startPage > 2) {
                addPaginationEllipsis();
            }
        }
        
        // Ajouter les liens pour les pages dans la plage
        for (let i = startPage; i <= endPage; i++) {
            addPaginationLink(i);
        }
        
        // Ajouter un lien pour la dernière page si nécessaire
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                addPaginationEllipsis();
            }
            addPaginationLink(totalPages);
        }
    }
    
    // Fonction pour ajouter un lien de pagination
    function addPaginationLink(page) {
        const link = document.createElement('button');
        link.textContent = page;
        link.classList.add('pagination-link');
        if (page === currentPage) {
            link.classList.add('active');
        }
        link.addEventListener('click', () => afficherPageVentes(page));
        paginationContainer.appendChild(link);
    }
    
    // Fonction pour ajouter un ellipsis
    function addPaginationEllipsis() {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.classList.add('pagination-ellipsis');
        paginationContainer.appendChild(ellipsis);
    }
}

/**
 * Charge les ventes depuis l'API avec filtres
 */
async function chargerVentes() {
    try {
        // Récupérer les critères de filtre
        const dateDebut = document.getElementById('date-debut').value;
        const dateFin = document.getElementById('date-fin').value;
        const pointVenteFiltre = document.getElementById('point-vente-filtre').value;
        const categorieFiltre = document.getElementById('categorie-filtre').value;
        const produitFiltre = document.getElementById('produit-filtre').value;
        
        // Construire l'URL avec les paramètres
        let url = `/api/ventes?page=${currentPage}&pageSize=${pageSize}`;
        
        if (dateDebut) {
            url += `&dateDebut=${formatDateForApi(dateDebut)}`;
        }
        
        if (dateFin) {
            url += `&dateFin=${formatDateForApi(dateFin, true)}`;
        }
        
        if (pointVenteFiltre) {
            url += `&pointVente=${encodeURIComponent(pointVenteFiltre)}`;
        }
        
        if (categorieFiltre) {
            url += `&categorie=${encodeURIComponent(categorieFiltre)}`;
        }
        
        if (produitFiltre) {
            url += `&produit=${encodeURIComponent(produitFiltre)}`;
        }
        
        // Afficher l'indicateur de chargement
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'block';
        }
        
        // Effectuer la requête
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Masquer l'indicateur de chargement
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
        
        if (data.success) {
            // Mettre à jour les informations de pagination
            currentPage = data.page || 1;
            totalPages = data.totalPages || 1;
            totalVentes = data.totalItems || 0;
            
            // Afficher les ventes
            afficherDernieresVentes(data.ventes);
            
            // Mettre à jour la pagination
            updatePaginationInfo();
            
            return data.ventes;
        } else {
            console.error('Erreur lors du chargement des ventes:', data.message);
            return [];
        }
    } catch (error) {
        console.error('Erreur lors du chargement des ventes:', error);
        
        // Masquer l'indicateur de chargement en cas d'erreur
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
        
        return [];
    }
    
    // Fonction pour formater la date pour l'API
    function formatDateForApi(dateStr, isEndDate = false) {
        // Convertir au format YYYY-MM-DD pour l'API
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
        return dateStr;
    }
}

/**
 * Vérifie si une date correspond à aujourd'hui
 * @param {string} dateStr - Chaîne de date
 * @returns {boolean} Vrai si la date est aujourd'hui
 */
function isToday(dateStr) {
    if (!dateStr) return false;
    
    // Standardiser le format de la date
    const standardDate = standardiserDate(dateStr);
    
    // Obtenir la date actuelle au format JJ-MM-AAAA
    const now = new Date();
    const today = `${now.getDate().toString().padStart(2, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getFullYear()}`;
    
    return standardDate === today;
}

// Exporter les fonctions
export {
    afficherDernieresVentes,
    chargerDernieresVentes,
    creerNouvelleEntree,
    supprimerVente,
    afficherPageVentes,
    updatePaginationInfo,
    chargerVentes,
    isToday
}; 