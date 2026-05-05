/**
 * Audit Logs - Interface de supervision
 * Affichage des logs d'utilisation de l'Audit Client
 */

let currentPage = 1;
const logsPerPage = 50;
let currentFilters = {};
let charts = {};

// ==================== INITIALIZATION ====================

$(document).ready(function() {
    initializeDatePickers();
    loadFiltersData();
    loadData();
    checkAdminAccess();
    
    // Event listeners
    $('#filterForm').on('submit', function(e) {
        e.preventDefault();
        currentPage = 1;
        loadData();
    });
    
    $('#resetBtn').on('click', resetFilters);
    $('#exportBtn').on('click', exportToExcel);
    $('#truncateBtn').on('click', truncateTable);
});

// ==================== DATE PICKERS ====================

function initializeDatePickers() {
    // Date de début du mois par défaut
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    // Aujourd'hui par défaut
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    // Flatpickr pour date de début
    flatpickr('#startDate', {
        locale: 'fr',
        dateFormat: 'd/m/Y',
        defaultDate: startOfMonth,
        maxDate: today
    });
    
    // Flatpickr pour date de fin
    flatpickr('#endDate', {
        locale: 'fr',
        dateFormat: 'd/m/Y',
        defaultDate: today,
        maxDate: today
    });
}

// ==================== LOAD FILTERS DATA ====================

async function loadFiltersData() {
    try {
        // Charger la liste des utilisateurs
        const usersResponse = await fetch('/api/audit-logs/users');
        const usersData = await usersResponse.json();
        
        if (usersData.success) {
            const userSelect = $('#filterUser');
            usersData.users.forEach(user => {
                userSelect.append(`<option value="${user}">${user}</option>`);
            });
        }
        
        // Charger la liste des points de vente
        const pointsVenteResponse = await fetch('/api/audit-logs/points-vente');
        const pointsVenteData = await pointsVenteResponse.json();
        
        if (pointsVenteData.success) {
            const pointVenteSelect = $('#filterPointVente');
            pointsVenteData.points_vente.forEach(pv => {
                pointVenteSelect.append(`<option value="${pv}">${pv}</option>`);
            });
        }
        
    } catch (error) {
        console.error('Erreur lors du chargement des filtres:', error);
    }
}

// ==================== LOAD DATA ====================

async function loadData() {
    currentFilters = getFilters();
    
    try {
        // Charger stats et logs en parallèle
        await Promise.all([
            loadStats(),
            loadLogs()
        ]);
        
    } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
        showNotification('Erreur lors du chargement des données', 'error');
    }
}

function getFilters() {
    const startDate = $('#startDate').val();
    const endDate = $('#endDate').val();
    
    return {
        start_date: startDate ? convertDateToISO(startDate) : null,
        end_date: endDate ? convertDateToISO(endDate) : null,
        username: $('#filterUser').val(),
        point_vente: $('#filterPointVente').val(),
        phone_number: $('#filterPhone').val()
    };
}

function convertDateToISO(dateStr) {
    // Convertir DD/MM/YYYY en YYYY-MM-DD
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

// ==================== LOAD STATS ====================

async function loadStats() {
    try {
        const params = new URLSearchParams(currentFilters);
        const response = await fetch(`/api/audit-logs/stats?${params}`);
        const data = await response.json();
        
        if (data.success) {
            displayStats(data.stats);
            displayCharts(data.stats);
        }
        
    } catch (error) {
        console.error('Erreur lors du chargement des statistiques:', error);
    }
}

function displayStats(stats) {
    $('#statTotalSearches').text(stats.total_searches || 0);
    $('#statUniqueClients').text(stats.unique_clients || 0);
    
    // Durée moyenne
    const avgDuration = stats.average_duration_seconds || 0;
    const minutes = Math.floor(avgDuration / 60);
    const seconds = avgDuration % 60;
    $('#statAvgDuration').text(`${minutes}m ${seconds}s`);
    
    // Taux de succès
    const successRate = (stats.success_rate * 100).toFixed(1);
    $('#statSuccessRate').text(`${successRate}%`);
}

// ==================== CHARTS ====================

function displayCharts(stats) {
    // Détruire les anciens graphiques
    Object.values(charts).forEach(chart => {
        if (chart) chart.destroy();
    });
    
    // Graphique recherches par jour
    charts.byDay = createLineChart('chartByDay', stats.by_day);
    
    // Graphique top utilisateurs
    charts.byUser = createBarChart('chartByUser', stats.by_user);
    
    // Graphique par point de vente
    charts.byPointVente = createPieChart('chartByPointVente', stats.by_point_vente);
}

function createLineChart(canvasId, data) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    const labels = data.map(d => formatDate(d.date));
    const values = data.map(d => parseInt(d.count));
    
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Recherches',
                data: values,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

function createBarChart(canvasId, data) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    const labels = data.map(d => d.username);
    const values = data.map(d => parseInt(d.count));
    
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Recherches',
                data: values,
                backgroundColor: '#667eea'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

function createPieChart(canvasId, data) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    const labels = data.map(d => d.point_de_vente);
    const values = data.map(d => parseInt(d.count));
    
    const colors = [
        '#667eea', '#764ba2', '#28a745', '#ffc107', 
        '#dc3545', '#17a2b8', '#6c757d', '#e83e8c'
    ];
    
    return new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// ==================== LOAD LOGS TABLE ====================

async function loadLogs() {
    try {
        const params = new URLSearchParams({
            ...currentFilters,
            page: currentPage,
            limit: logsPerPage
        });
        
        const response = await fetch(`/api/audit-logs?${params}`);
        const data = await response.json();
        
        if (data.success) {
            displayLogsTable(data.data);
            displayPagination(data.page, data.totalPages, data.total);
        }
        
    } catch (error) {
        console.error('Erreur lors du chargement des logs:', error);
        $('#logsTableBody').html('<tr><td colspan="8" class="text-center text-danger">Erreur de chargement</td></tr>');
    }
}

function displayLogsTable(logs) {
    const tbody = $('#logsTableBody');
    tbody.empty();
    
    if (logs.length === 0) {
        tbody.html('<tr><td colspan="8" class="text-center text-muted">Aucun résultat</td></tr>');
        return;
    }
    
    logs.forEach(log => {
        const row = $('<tr></tr>');
        
        // Date/Heure
        row.append(`<td>${formatDateTime(log.search_timestamp)}</td>`);
        
        // Utilisateur
        row.append(`<td><strong>${log.username}</strong></td>`);
        
        // Point de vente
        row.append(`<td>${log.point_de_vente || '-'}</td>`);
        
        // Téléphone
        row.append(`<td>${log.phone_number_searched}</td>`);
        
        // Nom client
        row.append(`<td>${log.client_name || '-'}</td>`);
        
        // Durée
        const duration = log.consultation_duration_seconds;
        const durationText = duration ? formatDuration(duration) : '-';
        row.append(`<td>${durationText}</td>`);
        
        // Succès
        const successBadge = log.search_success
            ? '<span class="badge-success-custom">✓ Oui</span>'
            : '<span class="badge-error-custom">✗ Non</span>';
        row.append(`<td>${successBadge}</td>`);
        
        // Commandes trouvées
        row.append(`<td>${log.total_orders_found || 0}</td>`);
        
        tbody.append(row);
    });
}

function displayPagination(currentPage, totalPages, totalResults) {
    const container = $('#paginationContainer');
    container.empty();
    
    if (totalPages <= 1) return;
    
    const pagination = $('<nav><ul class="pagination mb-0"></ul></nav>');
    const ul = pagination.find('ul');
    
    // Bouton précédent
    const prevDisabled = currentPage === 1 ? 'disabled' : '';
    ul.append(`
        <li class="page-item ${prevDisabled}">
            <a class="page-link" href="#" data-page="${currentPage - 1}">
                <i class="fas fa-chevron-left"></i> Préc.
            </a>
        </li>
    `);
    
    // Numéros de page
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const active = i === currentPage ? 'active' : '';
        ul.append(`
            <li class="page-item ${active}">
                <a class="page-link" href="#" data-page="${i}">${i}</a>
            </li>
        `);
    }
    
    // Bouton suivant
    const nextDisabled = currentPage === totalPages ? 'disabled' : '';
    ul.append(`
        <li class="page-item ${nextDisabled}">
            <a class="page-link" href="#" data-page="${currentPage + 1}">
                Suiv. <i class="fas fa-chevron-right"></i>
            </a>
        </li>
    `);
    
    container.append(pagination);
    container.append(`<p class="text-muted mt-2 mb-0">Page ${currentPage} sur ${totalPages} • ${totalResults} résultat(s)</p>`);
    
    // Event listeners pour pagination
    ul.find('a').on('click', function(e) {
        e.preventDefault();
        if (!$(this).parent().hasClass('disabled') && !$(this).parent().hasClass('active')) {
            currentPage = parseInt($(this).data('page'));
            loadLogs();
        }
    });
}

// ==================== EXPORT EXCEL ====================

async function exportToExcel() {
    try {
        showNotification('Préparation de l\'export...', 'info');
        
        const params = new URLSearchParams(currentFilters);
        const response = await fetch(`/api/audit-logs/export?${params}`);
        const data = await response.json();
        
        if (data.success) {
            // Créer le fichier Excel
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(data.data);
            
            // Ajuster la largeur des colonnes
            const columnWidths = [
                { wch: 18 }, // Date/Heure
                { wch: 15 }, // Utilisateur
                { wch: 15 }, // Point de Vente
                { wch: 15 }, // Téléphone Client
                { wch: 20 }, // Nom Client
                { wch: 12 }, // Durée (secondes)
                { wch: 12 }, // Durée (minutes)
                { wch: 8 },  // Succès
                { wch: 12 }, // Commandes trouvées
                { wch: 30 }  // Erreur
            ];
            ws['!cols'] = columnWidths;
            
            XLSX.utils.book_append_sheet(wb, ws, 'Audit Logs');
            
            // Télécharger le fichier
            XLSX.writeFile(wb, data.filename);
            
            showNotification('Export réussi !', 'success');
        } else {
            showNotification('Erreur lors de l\'export', 'error');
        }
        
    } catch (error) {
        console.error('Erreur lors de l\'export:', error);
        showNotification('Erreur lors de l\'export', 'error');
    }
}

// ==================== UTILITY FUNCTIONS ====================

function resetFilters() {
    // Réinitialiser aux valeurs par défaut
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    
    const today = new Date();
    
    flatpickr('#startDate').setDate(startOfMonth);
    flatpickr('#endDate').setDate(today);
    
    $('#filterUser').val('Tous');
    $('#filterPointVente').val('Tous');
    $('#filterPhone').val('');
    
    currentPage = 1;
    loadData();
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function formatDateTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
}

function showNotification(message, type = 'info') {
    const alertClass = type === 'error' ? 'alert-danger' :
                       type === 'success' ? 'alert-success' :
                       'alert-info';
    
    const alert = $(`
        <div class="alert ${alertClass} alert-dismissible fade show" 
             style="position: fixed; top: 20px; right: 20px; z-index: 9999; min-width: 300px; box-shadow: 0 5px 20px rgba(0,0,0,0.2);">
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

// ==================== ADMIN FUNCTIONS ====================

async function checkAdminAccess() {
    try {
        const response = await fetch('/api/check-session');
        const data = await response.json();
        
        if (data.success && data.user) {
            const user = data.user;
            const userRole = user.role ? user.role.toLowerCase() : '';
            
            // Afficher le bouton "Vider la table" pour Superviseurs et Administrateurs
            if (userRole === 'superviseur' || 
                userRole === 'administrateur' || 
                user.role === 'admin' || 
                user.isSuperAdmin === true) {
                $('#truncateBtn').show();
            }
        }
    } catch (error) {
        console.error('Erreur lors de la vérification des droits:', error);
    }
}

async function truncateTable() {
    // Confirmation avec double vérification
    const confirmation = await showConfirmModal(
        '⚠️ ATTENTION ⚠️\n\n' +
        'Vous êtes sur le point de SUPPRIMER DÉFINITIVEMENT tous les logs d\'audit client.\n\n' +
        'Cette action est IRRÉVERSIBLE !\n\n' +
        'Tous les historiques de recherches seront perdus.\n\n' +
        'Voulez-vous vraiment continuer ?',
        { title: 'Vider les logs', okLabel: 'Continuer', okVariant: 'danger' }
    );

    if (!confirmation) {
        return;
    }

    // Deuxième confirmation
    const finalConfirmation = await showConfirmModal(
        '⚠️ DERNIÈRE CONFIRMATION ⚠️\n\n' +
        'Êtes-vous ABSOLUMENT SÛR de vouloir vider la table des logs d\'audit ?\n\n' +
        'Cette action ne peut pas être annulée !',
        { title: 'Confirmer suppression', okLabel: 'OUI, supprimer tout', okVariant: 'danger' }
    );

    if (!finalConfirmation) {
        return;
    }
    
    try {
        // Désactiver le bouton pendant l'opération
        const $btn = $('#truncateBtn');
        $btn.prop('disabled', true);
        $btn.html('<i class="fas fa-spinner fa-spin"></i> Suppression...');
        
        const response = await fetch('/api/audit-logs/truncate', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification(
                `✅ ${data.message}`,
                'success'
            );
            
            // Recharger les données
            setTimeout(() => {
                loadData();
            }, 1000);
        } else {
            showNotification(
                `❌ Erreur: ${data.error}`,
                'error'
            );
        }
        
    } catch (error) {
        console.error('Erreur lors du vidage de la table:', error);
        showNotification(
            '❌ Erreur lors de la suppression des logs',
            'error'
        );
    } finally {
        // Réactiver le bouton
        const $btn = $('#truncateBtn');
        $btn.prop('disabled', false);
        $btn.html('<i class="fas fa-trash-alt"></i> Vider la table');
    }
}

