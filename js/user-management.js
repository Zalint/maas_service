// Variables globales
let currentUser = null;
let users = [];
let confirmModal = null;
let pendingAction = null;

// Fonction pour obtenir le nom d'affichage du rôle utilisateur
function getUserRoleDisplayName(user) {
    if (!user || !user.role) {
        return 'Inconnu';
    }
    
    switch (user.role) {
        case 'admin':
            return 'Administrateur';
        case 'superviseur':
            return 'Superviseur';
        case 'superutilisateur':
            return 'SuperUtilisateur';
        case 'user':
            return 'Utilisateur';
        case 'lecteur':
            return 'Lecteur';
        default:
            return user.role;
    }
}

// Fonction pour obtenir le nom d'affichage du rôle
function getRoleDisplayName(role) {
    switch (role) {
        case 'admin':
            return 'Administrateur';
        case 'superviseur':
            return 'Superviseur';
        case 'superutilisateur':
            return 'SuperUtilisateur';
        case 'user':
            return 'Utilisateur';
        case 'lecteur':
            return 'Lecteur';
        default:
            return role;
    }
}

// Fonction pour obtenir la couleur du badge selon le rôle
function getRoleBadgeColor(role) {
    switch (role) {
        case 'admin':
            return 'bg-danger';
        case 'superviseur':
            return 'bg-warning';
        case 'superutilisateur':
            return 'bg-success';
        case 'user':
            return 'bg-primary';
        case 'lecteur':
            return 'bg-info';
        default:
            return 'bg-secondary';
    }
}

// Vérification de l'authentification et des droits admin
async function checkAuth() {
    try {
        const response = await fetch('/api/check-session', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (!data.success) {
            window.location.href = 'login.html';
            return false;
        }
        
        // Vérifier que l'utilisateur est admin
        if (data.user.role !== 'admin') {
            alert('Accès non autorisé. Seuls les administrateurs peuvent accéder à cette page.');
            window.location.href = 'index.html';
            return false;
        }
        
        currentUser = data.user;
        const roleDisplayName = getUserRoleDisplayName(currentUser);
        document.getElementById('user-info').textContent = `Connecté en tant que ${currentUser.username} (${roleDisplayName})`;
        return true;
    } catch (error) {
        console.error('Erreur lors de la vérification de la session:', error);
        window.location.href = 'login.html';
        return false;
    }
}

// Charger la liste des utilisateurs
async function loadUsers() {
    try {
        const response = await fetch('/api/admin/users', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            users = data.users;
            displayUsers();
        } else {
            console.error('Erreur lors du chargement des utilisateurs:', data.message);
            alert('Erreur lors du chargement des utilisateurs');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des utilisateurs:', error);
        alert('Erreur lors du chargement des utilisateurs');
    }
}

// Écrans disponibles pour la sélection
const AVAILABLE_SCREENS = [
    { value: '', label: '— Par défaut (index.html) —' },
    { value: 'index.html', label: 'Tableau de bord' },
    { value: 'pos.html', label: 'Point de Vente (POS)' },
    { value: 'Realtime.html', label: 'Temps Réel' },
    { value: 'auditClient.html', label: 'Audit Client' }
];

// Afficher les utilisateurs dans le tableau
function displayUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    
    users.forEach(user => {
        const screenOptions = AVAILABLE_SCREENS.map(s => 
            `<option value="${s.value}" ${(user.default_screen || '') === s.value ? 'selected' : ''}>${s.label}</option>`
        ).join('');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${user.username}</strong>
                ${user.username === 'ADMIN' ? '<i class="fas fa-crown text-warning ms-2" title="Super Administrateur"></i>' : ''}
            </td>
            <td>
                <span class="badge ${getRoleBadgeColor(user.role)}">
                    ${getRoleDisplayName(user.role)}
                </span>
            </td>
            <td>${Array.isArray(user.pointVente) ? user.pointVente.join(', ') : user.pointVente}</td>
            <td>
                <span class="badge ${user.active ? 'bg-success' : 'bg-secondary'} status-badge">
                    ${user.active ? 'Actif' : 'Inactif'}
                </span>
            </td>
            <td>
                ${user.username !== 'ADMIN' ? `
                    <select class="form-select form-select-sm" style="min-width:160px"
                            onchange="updateDefaultScreen('${user.username}', this.value, this)">
                        ${screenOptions}
                    </select>
                ` : '<span class="text-muted">—</span>'}
            </td>
            <td>
                ${user.username !== 'ADMIN' ? `
                    <button class="btn btn-sm btn-primary btn-action" 
                            onclick="editUser('${user.username}')" 
                            title="Modifier l'utilisateur">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm ${user.active ? 'btn-warning' : 'btn-success'} btn-action" 
                            onclick="toggleUserStatus('${user.username}')" 
                            title="${user.active ? 'Désactiver' : 'Activer'} l'utilisateur">
                        <i class="fas ${user.active ? 'fa-user-slash' : 'fa-user-check'}"></i>
                    </button>
                    <button class="btn btn-sm btn-danger btn-action" 
                            onclick="deleteUser('${user.username}')" 
                            title="Supprimer l'utilisateur">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : '<span class="text-muted">Actions non disponibles</span>'}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Mettre à jour l'écran par défaut d'un utilisateur
async function updateDefaultScreen(username, screen, selectEl) {
    const originalValue = users.find(u => u.username === username)?.default_screen || '';
    try {
        selectEl.disabled = true;
        const response = await fetch(`/api/admin/users/${username}/default-screen`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ default_screen: screen })
        });
        const data = await response.json();
        if (data.success) {
            // Mettre à jour le cache local
            const user = users.find(u => u.username === username);
            if (user) user.default_screen = screen || null;
            selectEl.style.borderColor = '#198754';
            setTimeout(() => { selectEl.style.borderColor = ''; }, 1500);
        } else {
            alert('Erreur : ' + data.message);
            selectEl.value = originalValue;
        }
    } catch (error) {
        console.error('Erreur lors de la mise à jour de l\'écran par défaut:', error);
        alert('Erreur lors de la mise à jour');
        selectEl.value = originalValue;
    } finally {
        selectEl.disabled = false;
    }
}

// Créer un nouvel utilisateur
async function createUser(userData) {
    try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(userData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Utilisateur créé avec succès !');
            document.getElementById('createUserForm').reset();
            loadUsers();
        } else {
            alert('Erreur lors de la création : ' + data.message);
        }
    } catch (error) {
        console.error('Erreur lors de la création de l\'utilisateur:', error);
        alert('Erreur lors de la création de l\'utilisateur');
    }
}

// Activer/désactiver un utilisateur
async function toggleUserStatus(username) {
    const user = users.find(u => u.username === username);
    if (!user) return;
    
    const action = user.active ? 'désactiver' : 'activer';
    const message = `Êtes-vous sûr de vouloir ${action} l'utilisateur "${username}" ?`;
    
    showConfirmModal(message, async () => {
        try {
            const response = await fetch(`/api/admin/users/${username}/toggle-status`, {
                method: 'POST',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                alert(`Utilisateur ${action === 'activer' ? 'activé' : 'désactivé'} avec succès !`);
                loadUsers();
            } else {
                alert('Erreur lors de la modification : ' + data.message);
            }
        } catch (error) {
            console.error('Erreur lors de la modification du statut:', error);
            alert('Erreur lors de la modification du statut');
        }
    });
}

// Supprimer un utilisateur
async function deleteUser(username) {
    const message = `Êtes-vous sûr de vouloir supprimer l'utilisateur "${username}" ? Cette action est irréversible.`;
    
    showConfirmModal(message, async () => {
        try {
            const response = await fetch(`/api/admin/users/${username}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success) {
                alert('Utilisateur supprimé avec succès !');
                loadUsers();
            } else {
                alert('Erreur lors de la suppression : ' + data.message);
            }
        } catch (error) {
            console.error('Erreur lors de la suppression:', error);
            alert('Erreur lors de la suppression');
        }
    });
}

// Afficher le modal de confirmation
function showConfirmModal(message, callback) {
    document.getElementById('confirmModalBody').textContent = message;
    pendingAction = callback;
    confirmModal.show();
}

// Gestion de la déconnexion
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
        const data = await response.json();
        if (data.success) {
            localStorage.removeItem('user');
            window.location.href = 'login.html';
        }
    } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
    }
}

// Fonction pour ouvrir le modal d'édition d'utilisateur
function editUser(username) {
    const user = users.find(u => u.username === username);
    if (!user) {
        alert('Utilisateur non trouvé');
        return;
    }
    
    // Remplir le formulaire d'édition avec les données actuelles
    document.getElementById('editUsername').value = user.username;
    document.getElementById('editNewUsername').value = user.username;
    document.getElementById('editNewPassword').value = ''; // Mot de passe vide par défaut
    document.getElementById('editNewRole').value = user.role;
    document.getElementById('editNewUserActive').checked = user.active;
    
    // Gérer les checkboxes des points de vente
    const userPointsVente = Array.isArray(user.pointVente) ? user.pointVente : [user.pointVente];
    
    // D'abord, décocher toutes les checkboxes
    document.querySelectorAll('input[name="editPointVente"]').forEach(checkbox => {
        checkbox.checked = false;
    });
    
    // Ensuite, cocher celles qui correspondent aux points de vente de l'utilisateur
    userPointsVente.forEach(pv => {
        const checkbox = document.querySelector(`input[name="editPointVente"][value="${pv}"]`);
        if (checkbox) {
            checkbox.checked = true;
        }
    });
    
    // Afficher le modal
    const editModal = new bootstrap.Modal(document.getElementById('editUserModal'));
    editModal.show();
}

// Fonction pour sauvegarder les modifications d'un utilisateur
async function saveEditUser() {
    const originalUsername = document.getElementById('editUsername').value;
    const newUsername = document.getElementById('editNewUsername').value.trim();
    const newPassword = document.getElementById('editNewPassword').value;
    const newRole = document.getElementById('editNewRole').value;
    // Récupérer les checkboxes cochées pour les points de vente
    const selectedEditCheckboxes = document.querySelectorAll('input[name="editPointVente"]:checked');
    const newPointVente = Array.from(selectedEditCheckboxes).map(checkbox => checkbox.value);
    const newActive = document.getElementById('editNewUserActive').checked;
    
    if (!newUsername || !newRole || newPointVente.length === 0) {
        alert('Veuillez remplir tous les champs obligatoires et sélectionner au moins un point de vente');
        return;
    }

    // Si admin a saisi un nouveau mot de passe → règle minimum 6 caractères
    if (newPassword && newPassword.length < 6) {
        alert('Le mot de passe forcé doit faire au moins 6 caractères.');
        return;
    }

    // Vérifier que le nouveau nom d'utilisateur n'existe pas déjà (sauf pour l'utilisateur actuel)
    if (newUsername !== originalUsername && users.some(u => u.username === newUsername)) {
        alert('Ce nom d\'utilisateur existe déjà');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/users/${originalUsername}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                username: newUsername,
                password: newPassword, // Peut être vide si on ne veut pas changer le mot de passe
                role: newRole,
                pointVente: newPointVente,
                active: newActive
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('Utilisateur modifié avec succès !');
            
            // Fermer le modal
            const editModal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
            editModal.hide();
            
            // Recharger la liste des utilisateurs
            await loadUsers();
        } else {
            alert('Erreur lors de la modification : ' + data.message);
        }
    } catch (error) {
        console.error('Erreur lors de la modification:', error);
        alert('Erreur lors de la modification');
    }
}

// Fonction pour gérer la logique des checkboxes des points de vente
function setupPointVenteCheckboxes() {
    const tousCheckbox = document.getElementById('pv-tous');
    const otherCheckboxes = document.querySelectorAll('input[name="pointVente"]:not(#pv-tous)');
    
    // Quand "Tous" est coché, décocher les autres
    tousCheckbox.addEventListener('change', function() {
        if (this.checked) {
            otherCheckboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
        }
    });
    
    // Quand une autre option est cochée, décocher "Tous"
    otherCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                tousCheckbox.checked = false;
            }
        });
    });
}

// Fonction pour gérer la logique des checkboxes du modal d'édition
function setupEditPointVenteCheckboxes() {
    const tousCheckbox = document.getElementById('edit-pv-tous');
    const otherCheckboxes = document.querySelectorAll('input[name="editPointVente"]:not(#edit-pv-tous)');
    
    // Quand "Tous" est coché, décocher les autres
    tousCheckbox.addEventListener('change', function() {
        if (this.checked) {
            otherCheckboxes.forEach(checkbox => {
                checkbox.checked = false;
            });
        }
    });
    
    // Quand une autre option est cochée, décocher "Tous"
    otherCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                tousCheckbox.checked = false;
            }
        });
    });
}

// Charger les points de vente dynamiquement depuis la BDD
async function loadPointsVenteCheckboxes() {
    try {
        const response = await fetch('/api/points-vente', { credentials: 'include' });
        if (!response.ok) throw new Error('Erreur lors du chargement des points de vente');
        const pointsVente = await response.json();
        
        // Générer les checkboxes pour le formulaire de création
        const container = document.getElementById('points-vente-checkboxes');
        if (container) {
            container.innerHTML = '';
            pointsVente.forEach(pv => {
                const pvId = pv.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                const div = document.createElement('div');
                div.className = 'form-check';
                div.innerHTML = `
                    <input class="form-check-input" type="checkbox" value="${pv}" id="pv-${pvId}" name="pointVente">
                    <label class="form-check-label" for="pv-${pvId}">${pv}</label>
                `;
                container.appendChild(div);
            });
        }
        
        // Générer les checkboxes pour le modal d'édition
        const editContainer = document.getElementById('edit-points-vente-checkboxes');
        if (editContainer) {
            editContainer.innerHTML = '';
            pointsVente.forEach(pv => {
                const pvId = pv.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                const div = document.createElement('div');
                div.className = 'form-check';
                div.innerHTML = `
                    <input class="form-check-input" type="checkbox" value="${pv}" id="edit-pv-${pvId}" name="editPointVente">
                    <label class="form-check-label" for="edit-pv-${pvId}">${pv}</label>
                `;
                editContainer.appendChild(div);
            });
        }
        
        console.log('Points de vente chargés:', pointsVente);
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

// Initialisation
document.addEventListener('DOMContentLoaded', async function() {
    // Initialiser le modal Bootstrap
    confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
    
    // Vérifier l'authentification
    const isAuthenticated = await checkAuth();
    if (isAuthenticated) {
        // Charger les points de vente dynamiquement
        await loadPointsVenteCheckboxes();
        
        // Charger les utilisateurs
        await loadUsers();
        
        // Gestionnaire pour le formulaire de création
        document.getElementById('createUserForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const username = document.getElementById('newUsername').value.trim();
            const password = document.getElementById('newPassword').value;
            const role = document.getElementById('newRole').value;
            // Récupérer les checkboxes cochées
            const selectedCheckboxes = document.querySelectorAll('input[name="pointVente"]:checked');
            const selectedOptions = Array.from(selectedCheckboxes).map(checkbox => checkbox.value);
            const active = document.getElementById('newUserActive').checked;
            
            if (!username || !password || !role || selectedOptions.length === 0) {
                alert('Veuillez remplir tous les champs obligatoires et sélectionner au moins un point de vente');
                return;
            }
            
            // Vérifier que le nom d'utilisateur n'existe pas déjà
            if (users.some(u => u.username === username)) {
                alert('Ce nom d\'utilisateur existe déjà');
                return;
            }
            
            createUser({
                username,
                password,
                role,
                pointVente: selectedOptions,
                active
            });
        });
        
        // Gestionnaire pour le bouton de déconnexion
        document.getElementById('logout-btn').addEventListener('click', function(e) {
            e.preventDefault();
            logout();
        });
        
        // Gestion des checkboxes des points de vente
        setupPointVenteCheckboxes();
        setupEditPointVenteCheckboxes();
        
        // Gestionnaire pour la confirmation d'action
        document.getElementById('confirmAction').addEventListener('click', function() {
            if (pendingAction) {
                pendingAction();
                confirmModal.hide();
                pendingAction = null;
            }
        });
        
        // Gestionnaire pour le bouton d'enregistrement du modal d'édition
        document.getElementById('saveEditUser').addEventListener('click', function() {
            saveEditUser();
        });

        // Boutons œil pour révéler/masquer les mots de passe (création + édition)
        function wirePwdToggle(toggleBtnId, inputId) {
            const btn = document.getElementById(toggleBtnId);
            const input = document.getElementById(inputId);
            if (!btn || !input) return;
            btn.addEventListener('click', function () {
                const isPwd = input.type === 'password';
                input.type = isPwd ? 'text' : 'password';
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.classList.toggle('fa-eye', !isPwd);
                    icon.classList.toggle('fa-eye-slash', isPwd);
                }
            });
        }
        wirePwdToggle('toggleNewPassword', 'newPassword');
        wirePwdToggle('toggleEditNewPassword', 'editNewPassword');
    }
}); 