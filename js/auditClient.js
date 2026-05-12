/**
 * Audit Client - Système de consultation historique client
 * Gestion des recherches, affichage et sauvegarde locale
 */

const API_CONFIG = {
    // Utiliser la route proxy locale pour éviter les problèmes CORS
    url: '/api/audit-client'
};

const STORAGE_KEY = 'matix_audit_history';

// Flag pour éviter les appels multiples
let isSearching = false;

// ==================== UTILITY FUNCTIONS ====================

/**
 * Formate une date au format DD/MM/YYYY
 */
function formatDate(dateString) {
    if (!dateString) return '-';
    const [year, month, day] = dateString.split('-');
    return `${day}/${month}/${year}`;
}

/**
 * Formate un montant en FCFA
 */
function formatAmount(amount) {
    if (!amount && amount !== 0) return '-';
    return new Intl.NumberFormat('fr-FR').format(amount) + ' F';
}

/**
 * Obtient la date du jour au format YYYY-MM-DD
 */
function getTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Nettoie l'historique des jours précédents
 */
function cleanOldHistory() {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const today = getTodayDate();
    
    const todayHistory = history.filter(item => item.searchDate === today);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todayHistory));
    
    return todayHistory;
}

/**
 * Ajoute une recherche à l'historique
 */
function addToHistory(phoneNumber, clientData) {
    let history = cleanOldHistory();
    
    const existingIndex = history.findIndex(item => item.phone === phoneNumber);
    
    const historyItem = {
        phone: phoneNumber,
        clientName: clientData.client_info?.name || 'Client inconnu',
        totalOrders: clientData.client_info?.total_orders || 0,
        searchDate: getTodayDate(),
        searchTime: new Date().toLocaleTimeString('fr-FR'),
        data: clientData
    };
    
    if (existingIndex !== -1) {
        history[existingIndex] = historyItem;
    } else {
        history.unshift(historyItem);
    }
    
    // Limiter à 20 recherches
    history = history.slice(0, 20);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    displayHistory();
}

/**
 * Affiche l'historique des recherches
 */
function displayHistory() {
    const history = cleanOldHistory();
    const historySection = $('#historySection');
    const historyContainer = $('#historyContainer');
    
    if (history.length === 0) {
        historySection.hide();
        return;
    }
    
    historySection.show();
    historyContainer.empty();
    
    history.forEach(item => {
        const historyItem = $(`
            <div class="history-item" data-phone="${item.phone}">
                <div>
                    <div style="font-weight: 600; font-size: 1rem;">
                        <i class="fas fa-user"></i> ${item.clientName}
                    </div>
                    <div style="font-size: 0.85rem; color: #6c757d;">
                        <i class="fas fa-phone"></i> ${item.phone} • 
                        <i class="fas fa-shopping-cart"></i> ${item.totalOrders} commande(s) • 
                        <i class="fas fa-clock"></i> ${item.searchTime}
                    </div>
                </div>
                <div>
                    <i class="fas fa-chevron-right" style="color: var(--primary-color);"></i>
                </div>
            </div>
        `);
        
        historyItem.on('click', function() {
            const phone = $(this).data('phone');
            $('#phoneInput').val(phone);
            
            // Afficher un feedback de chargement léger
            const searchBtn = $('#searchForm button[type="submit"]');
            const originalHtml = searchBtn.html();
            searchBtn.html('<i class="fas fa-spinner fa-spin"></i> Chargement...');
            
            // Petit délai pour l'animation
            setTimeout(() => {
                displayClientData(item.data);
                searchBtn.html(originalHtml);
                
                $('html, body').animate({
                    scrollTop: $('#resultsSection').offset().top - 20
                }, 500);
            }, 300);
        });
        
        historyContainer.append(historyItem);
    });
}

/**
 * Efface l'historique
 */
async function clearHistory() {
    const ok = await showConfirmModal('Êtes-vous sûr de vouloir effacer l\'historique du jour ?', {
        title: 'Effacer l\'historique', okLabel: 'Effacer', okVariant: 'danger'
    });
    if (ok) {
        localStorage.removeItem(STORAGE_KEY);
        displayHistory();
        showNotification('Historique effacé', 'success');
    }
}

// ==================== API FUNCTIONS ====================

/**
 * Recherche un client par téléphone
 */
async function searchClient(phoneNumber) {
    // Empêcher les appels multiples
    if (isSearching) {
        console.log('Recherche déjà en cours, veuillez patienter...');
        return;
    }
    
    try {
        isSearching = true;
        showLoading();
        
        const response = await fetch(
            `${API_CONFIG.url}?phone_number=${encodeURIComponent(phoneNumber)}`,
            {
                method: 'GET'
            }
        );
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erreur API: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Aucun client trouvé avec ce numéro');
        }
        
        addToHistory(phoneNumber, data);
        displayClientData(data);
        
    } catch (error) {
        console.error('Erreur lors de la recherche:', error);
        showNotification('Erreur: ' + error.message, 'error');
    } finally {
        // Toujours réinitialiser le flag et cacher le loading
        isSearching = false;
        hideLoading();
    }
}

// ==================== DISPLAY FUNCTIONS ====================

/**
 * Affiche les données du client
 */
function displayClientData(data) {
    $('#resultsSection').fadeIn();
    
    // Profil client
    displayClientProfile(data.client_info);
    
    // Statistiques
    displayStatistics(data.statistics);
    
    // Analyse de sentiment
    displaySentiment(data.sentiment_analysis);
    
    // Historique des commandes
    displayOrders(data.orders_history);
}

/**
 * Affiche le profil client
 */
function displayClientProfile(clientInfo) {
    $('#clientName span').text(clientInfo.name || 'Client inconnu');
    $('#clientPhone').text(clientInfo.phone_number || '-');
    $('#totalOrders').text(clientInfo.total_orders || 0);
    $('#firstOrder').text(formatDate(clientInfo.first_order));
    $('#lastOrder').text(formatDate(clientInfo.last_order));
}

/**
 * Affiche les statistiques
 */
function displayStatistics(stats) {
    $('#statTotalOrders').text(stats.total_orders || 0);
    $('#statTotalAmount').text(formatAmount(stats.total_amount));
    $('#statAvgAmount').text(formatAmount(stats.avg_amount));
    
    if (stats.avg_rating) {
        $('#statAvgRating').html(`${stats.avg_rating}/10 <i class="fas fa-star"></i>`);
    } else {
        $('#statAvgRating').text('-');
    }
}

/**
 * Affiche l'analyse de sentiment
 */
function displaySentiment(sentiment) {
    const sentimentScore = $('#sentimentScore');
    const emoji = $('#sentimentEmoji');
    const label = $('#sentimentLabel');
    const confidence = $('#sentimentConfidence');
    
    // Déterminer le sentiment et la classe CSS
    let sentimentClass = 'sentiment-neutral';
    let emojiIcon = '😐';
    let sentimentText = 'Neutre';
    
    if (sentiment.overall_sentiment === 'positive') {
        sentimentClass = 'sentiment-positive';
        emojiIcon = '😊';
        sentimentText = 'Positif';
    } else if (sentiment.overall_sentiment === 'negative') {
        sentimentClass = 'sentiment-negative';
        emojiIcon = '😞';
        sentimentText = 'Négatif';
    }
    
    sentimentScore.removeClass('sentiment-positive sentiment-neutral sentiment-negative');
    sentimentScore.addClass(sentimentClass);
    emoji.text(emojiIcon);
    label.text(sentimentText);
    confidence.text(Math.round(sentiment.confidence * 100) + '%');
    
    // Mots-clés
    displayKeywords(sentiment.keywords);
    
    // Résumé
    $('#sentimentSummary').text(sentiment.summary || 'Aucune analyse disponible');
    
    // Recommandations
    displayRecommendations(sentiment.recommendations);
}

/**
 * Affiche les mots-clés
 */
function displayKeywords(keywords) {
    const container = $('#keywordsContainer');
    container.empty();
    
    let hasKeywords = false;
    
    if (keywords.positive && keywords.positive.length > 0) {
        keywords.positive.forEach(keyword => {
            container.append(`<span class="keyword-badge keyword-positive">✓ ${keyword}</span>`);
            hasKeywords = true;
        });
    }
    
    if (keywords.neutral && keywords.neutral.length > 0) {
        keywords.neutral.forEach(keyword => {
            container.append(`<span class="keyword-badge keyword-neutral">- ${keyword}</span>`);
            hasKeywords = true;
        });
    }
    
    if (keywords.negative && keywords.negative.length > 0) {
        keywords.negative.forEach(keyword => {
            container.append(`<span class="keyword-badge keyword-negative">✗ ${keyword}</span>`);
            hasKeywords = true;
        });
    }
    
    if (!hasKeywords) {
        container.append('<span class="text-muted">Aucun mot-clé identifié</span>');
    }
}

/**
 * Affiche les recommandations
 */
function displayRecommendations(recommendations) {
    const list = $('#recommendationsList');
    list.empty();
    
    if (!recommendations || recommendations.length === 0) {
        list.append('<li>Aucune recommandation disponible</li>');
        return;
    }
    
    recommendations.forEach(rec => {
        list.append(`<li><i class="fas fa-arrow-right mr-2"></i>${rec}</li>`);
    });
}

/**
 * Affiche l'historique des commandes
 */
function displayOrders(orders) {
    const container = $('#ordersContainer');
    container.empty();
    
    if (!orders || orders.length === 0) {
        $('#ordersCountBadge').hide();
        container.html(`
            <div class="empty-state">
                <i class="fas fa-shopping-cart"></i>
                <h5>Aucune commande trouvée pour ce numéro</h5>
                <p class="text-muted">Ce client n'a pas de commandes enregistrées</p>
            </div>
        `);
        return;
    }
    
    // Afficher le badge avec le nombre total de commandes
    $('#ordersCount').text(orders.length);
    $('#ordersCountBadge').show();
    
    // Trier les commandes par date (plus récentes d'abord)
    const sortedOrders = [...orders].sort((a, b) => {
        return new Date(b.date) - new Date(a.date);
    });
    
    // Afficher les 10 premières commandes
    const defaultDisplayCount = 10;
    const ordersToShow = sortedOrders.slice(0, defaultDisplayCount);
    const remainingOrders = sortedOrders.slice(defaultDisplayCount);
    
    // Message informatif si plus de 10 commandes
    if (sortedOrders.length > defaultDisplayCount) {
        const infoMessage = $(`
            <div class="alert alert-info mb-3" style="border-left: 4px solid var(--info-color);">
                <i class="fas fa-info-circle"></i> 
                <strong>Affichage des 10 dernières commandes</strong> (${sortedOrders.length} au total)
            </div>
        `);
        container.append(infoMessage);
    }
    
    // Conteneur pour les commandes visibles
    const visibleContainer = $('<div id="visibleOrders"></div>');
    ordersToShow.forEach(order => {
        const orderCard = createOrderCard(order);
        visibleContainer.append(orderCard);
    });
    container.append(visibleContainer);
    
    // Si plus de 10 commandes, ajouter un conteneur caché et un bouton
    if (remainingOrders.length > 0) {
        const hiddenContainer = $('<div id="hiddenOrders" style="display: none;"></div>');
        remainingOrders.forEach(order => {
            const orderCard = createOrderCard(order);
            hiddenContainer.append(orderCard);
        });
        container.append(hiddenContainer);
        
        // Bouton "Voir plus"
        const viewMoreBtn = $(`
            <div class="text-center mt-4">
                <button class="btn btn-outline-primary btn-lg" id="viewMoreOrdersBtn">
                    <i class="fas fa-chevron-down"></i> 
                    Afficher ${remainingOrders.length} commande(s) supplémentaire(s)
                </button>
            </div>
        `);
        
        container.append(viewMoreBtn);
        
        // Gestion du clic sur "Voir plus"
        $('#viewMoreOrdersBtn').on('click', function() {
            $('#hiddenOrders').slideDown(500);
            $(this).parent().fadeOut(300, function() {
                $(this).remove();
            });
            
            // Ajouter un bouton "Afficher moins" après toutes les commandes
            const viewLessBtn = $(`
                <div class="text-center mt-4">
                    <button class="btn btn-outline-secondary btn-lg" id="viewLessOrdersBtn">
                        <i class="fas fa-chevron-up"></i> 
                        Afficher moins
                    </button>
                </div>
            `);
            container.append(viewLessBtn);
            
            $('#viewLessOrdersBtn').on('click', function() {
                $('#hiddenOrders').slideUp(500);
                $(this).parent().remove();
                
                // Réafficher le bouton "Voir plus"
                const newViewMoreBtn = $(`
                    <div class="text-center mt-4">
                        <button class="btn btn-outline-primary btn-lg" id="viewMoreOrdersBtn">
                            <i class="fas fa-chevron-down"></i> 
                            Afficher ${remainingOrders.length} commande(s) supplémentaire(s)
                        </button>
                    </div>
                `);
                container.append(newViewMoreBtn);
                
                $('#viewMoreOrdersBtn').on('click', arguments.callee.parent);
                
                // Scroller vers le haut de la section
                $('html, body').animate({
                    scrollTop: $('.orders-timeline').offset().top - 20
                }, 500);
            });
        });
    }
}

/**
 * Crée une carte de commande
 */
function createOrderCard(order) {
    const hasRatings = order.ratings && order.ratings.average;
    
    let ratingsHtml = '';
    if (hasRatings) {
        ratingsHtml = `
            <div class="ratings-section">
                <div class="rating-item">
                    <div class="rating-value">${order.ratings.service || '-'}</div>
                    <div class="rating-label">Service</div>
                </div>
                <div class="rating-item">
                    <div class="rating-value">${order.ratings.quality || '-'}</div>
                    <div class="rating-label">Qualité</div>
                </div>
                <div class="rating-item">
                    <div class="rating-value">${order.ratings.price || '-'}</div>
                    <div class="rating-label">Prix</div>
                </div>
                <div class="rating-item">
                    <div class="rating-value">${order.ratings.commercial_service || '-'}</div>
                    <div class="rating-label">Service Commercial</div>
                </div>
                <div class="rating-item">
                    <div class="rating-value">${order.ratings.average || '-'}</div>
                    <div class="rating-label">Moyenne</div>
                </div>
            </div>
        `;
    } else {
        ratingsHtml = `
            <div class="alert alert-light mb-0 mt-3" style="font-size: 0.9rem;">
                <i class="fas fa-info-circle"></i> Aucune évaluation disponible
            </div>
        `;
    }
    
    return $(`
        <div class="timeline-item">
            <div class="timeline-date">
                <i class="fas fa-calendar-alt"></i> ${formatDate(order.date)}
            </div>
            
            <div class="timeline-details">
                <div class="detail-item">
                    <i class="fas fa-map-marker-alt"></i>
                    <div>
                        <strong>Point de vente</strong><br>
                        <span>${order.point_de_vente || '-'}</span>
                    </div>
                </div>
                
                <div class="detail-item">
                    <i class="fas fa-money-bill-wave"></i>
                    <div>
                        <strong>Montant</strong><br>
                        <span class="text-success" style="font-size: 1.1rem; font-weight: 700;">
                            ${formatAmount(order.montant)}
                        </span>
                    </div>
                </div>
                
                <div class="detail-item">
                    <i class="fas fa-truck"></i>
                    <div>
                        <strong>Livreur</strong><br>
                        <span>${order.livreur || '-'}</span>
                    </div>
                </div>
                
                <div class="detail-item">
                    <i class="fas fa-route"></i>
                    <div>
                        <strong>Destination</strong><br>
                        <span>${order.adresse_destination || '-'}</span>
                    </div>
                </div>
            </div>
            
            ${order.commentaire && order.commentaire !== 'nrp' && order.commentaire !== 'Nrp' ? `
                <div class="mt-3 p-3" style="background: white; border-radius: 8px; border-left: 3px solid var(--info-color);">
                    <strong><i class="fas fa-comment"></i> Commentaire:</strong>
                    <p class="mb-0 mt-2">${order.commentaire}</p>
                </div>
            ` : ''}
            
            ${ratingsHtml}
        </div>
    `);
}

// ==================== UI FUNCTIONS ====================

/**
 * Affiche le chargement
 */
function showLoading() {
    $('#resultsSection').hide();
    
    // Désactiver le bouton et afficher le spinner
    const searchBtn = $('#searchForm button[type="submit"]');
    searchBtn.prop('disabled', true);
    searchBtn.html('<i class="fas fa-spinner fa-spin"></i> Recherche en cours...');
}

/**
 * Cache le chargement
 */
function hideLoading() {
    // Réactiver le bouton et restaurer le texte original
    const searchBtn = $('#searchForm button[type="submit"]');
    searchBtn.prop('disabled', false);
    searchBtn.html('<i class="fas fa-search"></i> Rechercher');
}

/**
 * Affiche une notification
 */
function showNotification(message, type = 'info') {
    const alertClass = type === 'error' ? 'alert-danger' : 
                       type === 'success' ? 'alert-success' : 
                       'alert-info';
    
    const alert = $(`
        <div class="alert ${alertClass} alert-dismissible fade show" role="alert" style="position: fixed; top: 20px; right: 20px; z-index: 9999; min-width: 300px; box-shadow: 0 5px 20px rgba(0,0,0,0.2);">
            ${message}
            <button type="button" class="close" data-dismiss="alert">
                <span>&times;</span>
            </button>
        </div>
    `);
    
    $('body').append(alert);
    
    setTimeout(() => {
        alert.alert('close');
    }, 5000);
}

// ==================== EVENT HANDLERS ====================

$(document).ready(function() {
    // Afficher l'historique au chargement
    displayHistory();
    
    // Formulaire de recherche
    $('#searchForm').on('submit', function(e) {
        e.preventDefault();
        const phoneNumber = $('#phoneInput').val().trim();
        
        if (!phoneNumber) {
            showNotification('Veuillez entrer un numéro de téléphone', 'error');
            return;
        }
        
        searchClient(phoneNumber);
    });
    
    // Bouton effacer historique
    $('#clearHistoryBtn').on('click', clearHistory);
    
    // Validation du champ téléphone (seulement des chiffres)
    $('#phoneInput').on('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
    });
});

