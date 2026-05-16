// Toast UI minimal basé sur Bootstrap 5. Remplace les alert() natifs.
// Usage: showToast('msg'), showToast('msg', 'danger'), showToast('msg', 'success', 5000)
// Si type n'est pas fourni, devine d'après le texte: erreur/échec -> danger,
// attention/veuillez -> warning, sinon success.
function showToast(message, type = null, durationMs = 4000) {
    const text = String(message == null ? '' : message);
    if (!type) {
        type = /erreur|error|échec|echec|impossible|invalide/i.test(text) ? 'danger'
             : /attention|warning|veuillez|prudent/i.test(text) ? 'warning'
             : 'success';
    }
    let container = document.getElementById('appToastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'appToastContainer';
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        container.style.zIndex = '1100';
        document.body.appendChild(container);
    }
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-bg-${type} border-0`;
    toastEl.setAttribute('role', 'alert');
    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body" style="white-space: pre-line;">${safe}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;
    container.appendChild(toastEl);
    if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
        const t = new bootstrap.Toast(toastEl, { delay: durationMs });
        t.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    } else {
        // Fallback si Bootstrap n'est pas chargé: timeout manuel
        toastEl.classList.add('show');
        setTimeout(() => toastEl.remove(), durationMs);
    }
}

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

// Vérification de l'authentification et des droits
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
        
        if (!data.user.isAdmin) {
            window.location.href = 'index.html';
            return false;
        }
        
        // Afficher les informations de l'utilisateur (chip + legacy span).
        const roleDisplayName = getUserRoleDisplayName(data.user);
        const username = String(data.user.username || '').trim();
        const legacy = document.getElementById('user-info');
        if (legacy) legacy.textContent = `Connecté en tant que ${username} (${roleDisplayName})`;
        const nameEl = document.getElementById('user-name');
        const roleEl = document.getElementById('user-role');
        const avatarEl = document.getElementById('user-avatar');
        if (nameEl) nameEl.textContent = username;
        if (roleEl) roleEl.textContent = roleDisplayName || 'Utilisateur';
        if (avatarEl && username) {
            const initials = username.replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 2).toUpperCase()
                || username[0].toUpperCase();
            avatarEl.textContent = initials;
        }
        // Brand "Administration · <Tenant>" si tenant connu
        const brandTenant = document.getElementById('brand-tenant');
        if (brandTenant && data.user.clientName) {
            brandTenant.textContent = '· ' + data.user.clientName;
        }
        
        // Afficher l'onglet de gestion des utilisateurs seulement pour l'utilisateur ADMIN
        if (data.user.username === 'ADMIN') {
            const userManagementNav = document.getElementById('user-management-nav');
            if (userManagementNav) {
                userManagementNav.style.display = 'block';
            }
        }
        
        return true;
    } catch (error) {
        console.error('Erreur lors de la vérification de la session:', error);
        window.location.href = 'login.html';
        return false;
    }
}

// Le modal "Changer mon mot de passe" est géré par js/change-password.js
// (partagé entre admin.html, pos.html, etc.). On garde un stub no-op pour
// éviter de toucher l'appel existant plus bas dans le bootstrap.
function initChangePasswordModal() { /* no-op — voir js/change-password.js */ }

// Gestion de la déconnexion
function initLogoutButton() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function(e) {
            e.preventDefault();
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
        });
    }
}

// Configuration des dates
function initDatePickers() {
    const dateCorrectionInput = document.getElementById('date-correction');
    if (dateCorrectionInput) {
        flatpickr(dateCorrectionInput, {
            locale: "fr",
            dateFormat: "d/m/Y",
            defaultDate: "today"
        });
    }
}

// Gestion des onglets
function initNavigation() {
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const section = this.dataset.section;
            
            // Mettre à jour les classes actives
            document.querySelectorAll('.nav-link[data-section]').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            
            // Afficher la section correspondante
            document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
            const targetSection = document.getElementById(`${section}-section`);
            if (targetSection) {
                targetSection.classList.add('active');
            }
        });
    });
}

// Charger les points de vente
async function chargerPointsVente() {
    try {
        console.log('Chargement des points de vente...');
        const response = await fetch('/api/admin/points-vente', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Données reçues:', data);
        
        if (!data.success || !data.pointsVente) {
            throw new Error('Format de réponse invalide');
        }
        
        const pointsVente = data.pointsVente;
        console.log('Points de vente:', pointsVente);
        
        // Trouver le select pour les points de vente
        const selectPointVente = document.getElementById('point-vente-filter');
        if (!selectPointVente) {
            console.error('Select point de vente non trouvé');
            return;
        }
        
        // Vider le select
        selectPointVente.innerHTML = '<option value="">Tous</option>';
        
        // Filtrer seulement les points de vente actifs
        const pointsVenteActifs = Object.entries(pointsVente)
            .filter(([nom, config]) => config.active === true)
            .map(([nom]) => nom);
        
        console.log('Points de vente actifs:', pointsVenteActifs);
        
        // Ajouter les options pour les points de vente actifs
        pointsVenteActifs.forEach(pointVente => {
            const option = document.createElement('option');
            option.value = pointVente;
            option.textContent = pointVente;
            selectPointVente.appendChild(option);
        });
        
        console.log('Points de vente chargés avec succès');
        
        // Afficher la liste complète des points de vente dans le tableau
        afficherListePointsVente(pointsVente);
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

// Afficher la liste des points de vente dans le tableau
function afficherListePointsVente(pointsVente) {
    const tbody = document.querySelector('#points-vente-table tbody');
    if (!tbody) {
        console.error('Tableau des points de vente non trouvé');
        return;
    }
    
    // Vider le tableau
    tbody.innerHTML = '';
    
    // Trier les points de vente par nom
    const pointsVenteTries = Object.entries(pointsVente).sort(([a], [b]) => a.localeCompare(b));
    
    pointsVenteTries.forEach(([nom, config]) => {
        const row = document.createElement('tr');
        const pvId = config.id;
        console.log(`Point de vente: ${nom}, ID: ${pvId}, config:`, config);
        
        // Colonne Nom
        const tdNom = document.createElement('td');
        tdNom.textContent = nom;
        row.appendChild(tdNom);
        
        // Colonne Référence de paiement avec bouton
        const tdPaymentRef = document.createElement('td');
        const inputGroup = document.createElement('div');
        inputGroup.className = 'd-flex align-items-center gap-2';
        
        const paymentRefInput = document.createElement('input');
        paymentRefInput.type = 'text';
        paymentRefInput.className = 'form-control form-control-sm';
        paymentRefInput.value = config.payment_ref || '';
        paymentRefInput.placeholder = 'Ex: V_KB';
        paymentRefInput.style.width = '100px';
        paymentRefInput.id = `payment-ref-${pvId}`;
        
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary btn-sm';
        saveBtn.innerHTML = '<i class="fas fa-save"></i>';
        saveBtn.title = 'Sauvegarder';
        saveBtn.onclick = () => updatePaymentRef(pvId, nom, paymentRefInput.value);
        
        inputGroup.appendChild(paymentRefInput);
        inputGroup.appendChild(saveBtn);
        tdPaymentRef.appendChild(inputGroup);
        row.appendChild(tdPaymentRef);
        
        // Colonne Statut
        const tdStatut = document.createElement('td');
        const statusBadge = document.createElement('span');
        statusBadge.className = config.active ? 'badge bg-success' : 'badge bg-danger';
        statusBadge.textContent = config.active ? 'Actif' : 'Inactif';
        tdStatut.appendChild(statusBadge);
        row.appendChild(tdStatut);
        
        // Colonne Actions
        const tdActions = document.createElement('td');
        const toggleBtn = document.createElement('button');
        toggleBtn.className = config.active ? 'btn btn-warning btn-sm' : 'btn btn-success btn-sm';
        toggleBtn.textContent = config.active ? 'Désactiver' : 'Activer';
        toggleBtn.onclick = () => togglePointVente(nom);
        tdActions.appendChild(toggleBtn);
        row.appendChild(tdActions);
        
        tbody.appendChild(row);
    });
}

// Mettre à jour la référence de paiement d'un point de vente
async function updatePaymentRef(id, nom, paymentRef) {
    if (!id) {
        showToast('ID du point de vente non trouvé');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/points-vente/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nom, payment_ref: paymentRef })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`Référence "${paymentRef}" sauvegardée pour ${nom}`);
            console.log(`Référence de paiement mise à jour pour ${nom}: ${paymentRef}`);
        } else {
            showToast(data.error || 'Erreur lors de la mise à jour');
            chargerPointsVente();
        }
    } catch (error) {
        console.error('Erreur:', error);
        showToast('Erreur lors de la mise à jour de la référence');
        chargerPointsVente();
    }
}

// Ajouter un nouveau point de vente
async function ajouterPointVente() {
    const nomInput = document.getElementById('newPointVente');
    const nom = nomInput.value.trim();
    
    if (!nom) {
        showToast('Veuillez saisir un nom pour le point de vente');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/points-vente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                nom,
                action: 'add'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            nomInput.value = '';
            chargerPointsVente();
            showToast('Point de vente ajouté avec succès');
        } else {
            showToast(data.message || 'Erreur lors de l\'ajout du point de vente');
        }
    } catch (error) {
        console.error('Erreur lors de l\'ajout du point de vente:', error);
        showToast('Erreur lors de l\'ajout du point de vente');
    }
}

// Activer/désactiver un point de vente
async function togglePointVente(nom) {
    try {
        const response = await fetch('/api/admin/points-vente', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                nom,
                action: 'toggle'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            chargerPointsVente();
        } else {
            showToast(data.message);
        }
    } catch (error) {
        console.error('Erreur lors de la modification du point de vente:', error);
        showToast('Erreur lors de la modification du point de vente');
    }
}

// Charger les produits
async function chargerProduits() {
    try {
        const response = await fetch('/api/admin/produits', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            // Remplir les menus de catégories
            const categorieSelect = document.getElementById('categorie-select');
            const categoriePrix = document.getElementById('categoriePrix');
            const categorieCorrection = document.getElementById('categorie-correction');
            
            if (categorieSelect) {
                categorieSelect.innerHTML = '<option value="">Sélectionner une catégorie</option>';
                Object.keys(data.produits).forEach(categorie => {
                    const option = document.createElement('option');
                    option.value = categorie;
                    option.textContent = categorie;
                    categorieSelect.appendChild(option);
                });
            }
            
            if (categoriePrix) {
                categoriePrix.innerHTML = '<option value="">Sélectionner une catégorie</option>';
                Object.keys(data.produits).forEach(categorie => {
                    const option = document.createElement('option');
                    option.value = categorie;
                    option.textContent = categorie;
                    categoriePrix.appendChild(option);
                });
            }
            
            if (categorieCorrection) {
                categorieCorrection.innerHTML = '<option value="">Sélectionner une catégorie</option>';
                Object.keys(data.produits).forEach(categorie => {
                    const option = document.createElement('option');
                    option.value = categorie;
                    option.textContent = categorie;
                    categorieCorrection.appendChild(option);
                });
            }
            
            // Remplir le menu des produits pour la section stocks
            const produitFilter = document.getElementById('produit-filter');
            if (produitFilter) {
                produitFilter.innerHTML = '<option value="">Tous</option>';
                
                // Liste limitée des produits pour le filtre
                const produitsLimites = ['Boeuf', 'Veau', 'Poulet', 'Volaille'];
                
                // Ajouter seulement les produits de la liste limitée
                produitsLimites.forEach(produit => {
                    const option = document.createElement('option');
                    option.value = produit;
                    option.textContent = produit;
                    produitFilter.appendChild(option);
                });
            }
            
            // Stocker les produits globalement pour les utiliser dans les event listeners
            window.produits = data.produits;
        } else {
            console.error('Erreur lors du chargement des produits:', data.message);
        }
    } catch (error) {
        console.error('Erreur lors du chargement des produits:', error);
    }
}

// Initialiser les event listeners pour les prix
function initPrixEventListeners() {
    // Gestion des changements de catégorie pour les prix
    const categoriePrixSelect = document.getElementById('categoriePrix');
    if (categoriePrixSelect) {
        categoriePrixSelect.addEventListener('change', function() {
            const categorie = this.value;
            const produitSelect = document.getElementById('produitPrix');
            
            if (produitSelect) {
                // Vider le menu des produits
                produitSelect.innerHTML = '<option value="">Sélectionner un produit</option>';
                
                if (categorie && window.produits && window.produits[categorie]) {
                    // Remplir le menu des produits de la catégorie sélectionnée
                    Object.keys(window.produits[categorie]).forEach(produit => {
                        const option = document.createElement('option');
                        option.value = produit;
                        option.textContent = produit;
                        produitSelect.appendChild(option);
                    });
                }
            }
        });
    }

    // Gestion de la modification des prix
    const modifierPrixBtn = document.getElementById('modifier-prix');
    if (modifierPrixBtn) {
        modifierPrixBtn.addEventListener('click', async function() {
            const categorie = document.getElementById('categoriePrix')?.value;
            const produit = document.getElementById('produitPrix')?.value;
            const nouveauPrix = document.getElementById('nouveau-prix')?.value;
            
            if (!categorie || !produit || !nouveauPrix) {
                showToast('Veuillez remplir tous les champs');
                return;
            }
            
            try {
                const response = await fetch('/api/admin/prix', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        categorie,
                        produit,
                        nouveauPrix: parseFloat(nouveauPrix)
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('nouveau-prix').value = '';
                    showToast('Prix modifié avec succès');
                    chargerProduits(); // Recharger les produits pour mettre à jour les menus
                } else {
                    showToast(data.message);
                }
            } catch (error) {
                console.error('Erreur lors de la modification du prix:', error);
                showToast('Erreur lors de la modification du prix');
            }
        });
    }
}

// Initialiser les event listeners pour les corrections
function initCorrectionsEventListeners() {
    // Gestion des changements de catégorie pour les corrections
    const categorieCorrectionSelect = document.getElementById('categorie-correction');
    if (categorieCorrectionSelect) {
        categorieCorrectionSelect.addEventListener('change', function() {
            const categorie = this.value;
            const produitSelect = document.getElementById('produit-correction');
            
            if (produitSelect) {
                // Vider le menu des produits
                produitSelect.innerHTML = '<option value="">Sélectionner un produit</option>';
                
                if (categorie && window.produits && window.produits[categorie]) {
                    // Remplir le menu des produits de la catégorie sélectionnée
                    Object.keys(window.produits[categorie]).forEach(produit => {
                        const option = document.createElement('option');
                        option.value = produit;
                        option.textContent = produit;
                        produitSelect.appendChild(option);
                    });
                }
            }
        });
    }

    // Gestion de la correction des totaux
    const corrigerTotalBtn = document.getElementById('corriger-total');
    if (corrigerTotalBtn) {
        corrigerTotalBtn.addEventListener('click', async function() {
            const date = document.getElementById('date-correction')?.value;
            const pointVente = document.getElementById('point-vente-correction')?.value;
            const categorie = document.getElementById('categorie-correction')?.value;
            const produit = document.getElementById('produit-correction')?.value;
            const nouveauTotal = document.getElementById('nouveau-total')?.value;
            
            if (!date || !pointVente || !categorie || !produit || !nouveauTotal) {
                showToast('Veuillez remplir tous les champs');
                return;
            }
            
            try {
                const response = await fetch('/api/admin/corriger-total', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        date,
                        pointVente,
                        categorie,
                        produit,
                        nouveauTotal: parseFloat(nouveauTotal)
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    document.getElementById('nouveau-total').value = '';
                    showToast('Total corrigé avec succès');
                } else {
                    showToast(data.message);
                }
            } catch (error) {
                console.error('Erreur lors de la correction du total:', error);
                showToast('Erreur lors de la correction du total');
            }
        });
    }
}

// Initialiser les event listeners pour les points de vente
function initPointsVenteEventListeners() {
    const addPointVenteForm = document.getElementById('addPointVenteForm');
    if (addPointVenteForm) {
        addPointVenteForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const nom = document.getElementById('newPointVente')?.value;
            
            if (!nom) {
                showToast('Veuillez saisir un nom de point de vente');
                return;
            }
            
            try {
                const response = await fetch('/api/admin/points-vente', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        nom,
                        action: 'add'
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('newPointVente').value = '';
                    chargerPointsVente();
                    showToast('Point de vente ajouté avec succès');
                } else {
                    showToast(data.message);
                }
            } catch (error) {
                console.error('Erreur lors de l\'ajout du point de vente:', error);
                showToast('Erreur lors de l\'ajout du point de vente');
            }
        });
    }
}

// Variables globales pour les données de stock
let stockMatinData = [];
let stockSoirData = [];
let transfertsData = [];
let consolidatedData = [];

// Initialisation de la section stocks
function initStocksSection() {
    console.log('Initialisation de la section stocks...');
    
    // Initialiser les datepickers
    const dateDebutInput = document.getElementById('date-debut');
    const dateFinInput = document.getElementById('date-fin');
    
    if (dateDebutInput && dateFinInput) {
        flatpickr(dateDebutInput, {
            dateFormat: "d/m/Y",
            locale: "fr",
            allowInput: true
        });
        
        flatpickr(dateFinInput, {
            dateFormat: "d/m/Y",
            locale: "fr",
            allowInput: true
        });
    }
    
    // Charger les listes des points de vente et produits
    loadFilterOptions();
    
    // Ajouter les event listeners
    const rechercherBtn = document.getElementById('rechercher-stocks');
    if (rechercherBtn) {
        rechercherBtn.addEventListener('click', rechercherStocks);
    }
    
    const exportBtn = document.getElementById('export-excel');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToExcel);
    }
    
    // Charger les données par défaut (derniers 7 jours)
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    if (dateDebutInput && dateFinInput) {
        dateDebutInput.value = sevenDaysAgo.toLocaleDateString('fr-FR');
        dateFinInput.value = today.toLocaleDateString('fr-FR');
        
        // Rechercher automatiquement
        rechercherStocks();
    }
}

// Charger les options des filtres
async function loadFilterOptions() {
    try {
        // Charger les points de vente depuis l'API (base de données)
        const response = await fetch('/api/points-vente');
        const pointsVente = response.ok ? await response.json() : [];
        
        const pointVenteSelect = document.getElementById('point-vente-filter');
        if (pointVenteSelect) {
            pointsVente.forEach(pv => {
                const option = document.createElement('option');
                option.value = pv;
                option.textContent = pv;
                pointVenteSelect.appendChild(option);
            });
        }
        
        // Charger les produits
        const produits = ['Boeuf', 'Veau', 'Poulet', 'Volaille'];
        const produitSelect = document.getElementById('produit-filter');
        if (produitSelect) {
            produits.forEach(prod => {
                const option = document.createElement('option');
                option.value = prod;
                option.textContent = prod;
                produitSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur lors du chargement des options:', error);
    }
}

// Test direct des APIs pour déboguer
async function testAPIs() {
    console.log('=== TEST DES APIs ===');
    
    try {
        // Test stock matin
        console.log('Test API stock matin...');
        const matinResponse = await fetch('/api/stock/matin?date=2025-07-17', {
            credentials: 'include'
        });
        console.log('Status stock matin:', matinResponse.status);
        if (matinResponse.ok) {
            const matinData = await matinResponse.json();
            console.log('Données stock matin:', matinData);
        } else {
            console.log('Erreur stock matin:', matinResponse.statusText);
        }
        
        // Test stock soir
        console.log('Test API stock soir...');
        const soirResponse = await fetch('/api/stock/soir?date=2025-07-17', {
            credentials: 'include'
        });
        console.log('Status stock soir:', soirResponse.status);
        if (soirResponse.ok) {
            const soirData = await soirResponse.json();
            console.log('Données stock soir:', soirData);
        } else {
            console.log('Erreur stock soir:', soirResponse.statusText);
        }
        
        // Test transferts
        console.log('Test API transferts...');
        const transfertsResponse = await fetch('/api/transferts?date=2025-07-17', {
            credentials: 'include'
        });
        console.log('Status transferts:', transfertsResponse.status);
        if (transfertsResponse.ok) {
            const transfertsData = await transfertsResponse.json();
            console.log('Données transferts:', transfertsData);
        } else {
            console.log('Erreur transferts:', transfertsResponse.statusText);
        }
        
    } catch (error) {
        console.error('Erreur lors du test des APIs:', error);
    }
}

// Rechercher les données de stock
async function rechercherStocks() {
    console.log('Recherche des données de stock...');
    
    const dateDebut = document.getElementById('date-debut')?.value;
    const dateFin = document.getElementById('date-fin')?.value;
    const pointVente = document.getElementById('point-vente-filter')?.value;
    const produit = document.getElementById('produit-filter')?.value;
    
    if (!dateDebut || !dateFin) {
        showToast('Veuillez sélectionner une période de dates');
        return;
    }
    
    console.log('Paramètres de recherche:', { dateDebut, dateFin, pointVente, produit });
    
    // Afficher le loading
    showLoading();
    
    try {
        // Test des APIs d'abord
        await testAPIs();
        
        // Convertir les dates au format YYYY-MM-DD
        const dateDebutFormatted = convertDateToISO(dateDebut);
        const dateFinFormatted = convertDateToISO(dateFin);
        
        console.log('Dates formatées:', { dateDebutFormatted, dateFinFormatted });
        
        // Récupérer toutes les données pour la période
        const allData = await fetchStockDataForPeriod(dateDebutFormatted, dateFinFormatted);
        
        // Filtrer les données selon les critères
        stockMatinData = filterData(allData.stockMatin, pointVente, produit);
        stockSoirData = filterData(allData.stockSoir, pointVente, produit);
        transfertsData = filterTransfertsData(allData.transferts, pointVente, produit);
        
        // Créer les données consolidées
        consolidatedData = createConsolidatedData();
        
        // Afficher les données consolidées
        displayConsolidatedData();
        
        console.log('Données récupérées:', {
            stockMatin: stockMatinData.length,
            stockSoir: stockSoirData.length,
            transferts: transfertsData.length,
            consolidated: consolidatedData.length
        });
        
    } catch (error) {
        console.error('Erreur lors de la recherche:', error);
        showToast('Erreur lors de la récupération des données');
    } finally {
        hideLoading();
    }
}

// Récupérer les données de stock pour une période
async function fetchStockDataForPeriod(dateDebut, dateFin) {
    const stockMatin = [];
    const stockSoir = [];
    const transferts = [];
    
    // Générer la liste des dates entre dateDebut et dateFin
    const dates = generateDateRange(dateDebut, dateFin);
    
    console.log('Dates à traiter:', dates);
    
    // Récupérer les données pour chaque date
    for (const date of dates) {
        try {
            console.log(`Traitement de la date: ${date}`);
            
            // Stock matin
            const matinResponse = await fetch(`/api/stock/matin?date=${date}`, {
                credentials: 'include'
            });
            console.log(`Réponse stock matin pour ${date}:`, matinResponse.status);
            
            if (matinResponse.ok) {
                const matinData = await matinResponse.json();
                console.log(`Données stock matin pour ${date}:`, matinData);
                
                if (matinData && Object.keys(matinData).length > 0) {
                    Object.values(matinData).forEach(item => {
                        stockMatin.push({
                            date: item.date,
                            pointVente: item['Point de Vente'],
                            produit: item.Produit,
                            quantite: parseFloat(item.Nombre) || 0,
                            prixUnitaire: parseFloat(item.PU) || 0,
                            montant: parseFloat(item.Montant) || 0,
                            commentaire: item.Commentaire || ''
                        });
                    });
                }
            }
            
            // Stock soir
            const soirResponse = await fetch(`/api/stock/soir?date=${date}`, {
                credentials: 'include'
            });
            console.log(`Réponse stock soir pour ${date}:`, soirResponse.status);
            
            if (soirResponse.ok) {
                const soirData = await soirResponse.json();
                console.log(`Données stock soir pour ${date}:`, soirData);
                
                if (soirData && Object.keys(soirData).length > 0) {
                    Object.values(soirData).forEach(item => {
                        stockSoir.push({
                            date: item.date,
                            pointVente: item['Point de Vente'],
                            produit: item.Produit,
                            quantite: parseFloat(item.Nombre) || 0,
                            prixUnitaire: parseFloat(item.PU) || 0,
                            montant: parseFloat(item.Montant) || 0,
                            commentaire: item.Commentaire || ''
                        });
                    });
                }
            }
            
            // Transferts
            const transfertsResponse = await fetch(`/api/transferts?date=${date}`, {
                credentials: 'include'
            });
            console.log(`Réponse transferts pour ${date}:`, transfertsResponse.status);
            
            if (transfertsResponse.ok) {
                const transfertsData = await transfertsResponse.json();
                console.log(`Données transferts pour ${date}:`, transfertsData);
                
                if (transfertsData && transfertsData.success && transfertsData.transferts) {
                    transfertsData.transferts.forEach(item => {
                        transferts.push({
                            date: item.date,
                            pointVente: item.pointVente,
                            produit: item.produit,
                            impact: item.impact,
                            quantite: parseFloat(item.quantite) || 0,
                            prixUnitaire: parseFloat(item.prixUnitaire) || 0,
                            total: parseFloat(item.total) || 0,
                            commentaire: item.commentaire || ''
                        });
                    });
                }
            }
            
        } catch (error) {
            console.error(`Erreur pour la date ${date}:`, error);
        }
    }
    
    console.log('Résultats finaux:', {
        stockMatin: stockMatin.length,
        stockSoir: stockSoir.length,
        transferts: transferts.length
    });
    
    return { stockMatin, stockSoir, transferts };
}

// Créer les données consolidées avec ventes théoriques
function createConsolidatedData() {
    const consolidated = [];
    
    // Créer un map pour faciliter la recherche
    const stockMatinMap = new Map();
    const stockSoirMap = new Map();
    const transfertsMap = new Map();
    
    // Indexer les données par clé unique (date + pointVente + produit)
    stockMatinData.forEach(item => {
        const key = `${item.date}-${item.pointVente}-${item.produit}`;
        stockMatinMap.set(key, item);
    });
    
    stockSoirData.forEach(item => {
        const key = `${item.date}-${item.pointVente}-${item.produit}`;
        stockSoirMap.set(key, item);
    });
    
    transfertsData.forEach(item => {
        const key = `${item.date}-${item.pointVente}-${item.produit}`;
        if (transfertsMap.has(key)) {
            // Si plusieurs transferts pour la même clé, additionner les quantités
            const existing = transfertsMap.get(key);
            existing.quantite += item.quantite;
        } else {
            transfertsMap.set(key, { ...item });
        }
    });
    
    // Créer un set de toutes les clés uniques
    const allKeys = new Set([
        ...stockMatinMap.keys(),
        ...stockSoirMap.keys(),
        ...transfertsMap.keys()
    ]);
    
    // Créer les données consolidées
    allKeys.forEach(key => {
        const [date, pointVente, produit] = key.split('-');
        
        const stockMatin = stockMatinMap.get(key);
        const stockSoir = stockSoirMap.get(key);
        const transfert = transfertsMap.get(key);
        
        const stockMatinQuantite = stockMatin ? stockMatin.quantite : 0;
        const stockSoirQuantite = stockSoir ? stockSoir.quantite : 0;
        const transfertQuantite = transfert ? transfert.quantite : 0;
        
        // Calculer les ventes théoriques : Stock Soir - (Stock Matin + Transferts)
        const ventesTheoriques = stockSoirQuantite - (stockMatinQuantite + transfertQuantite);
        
        consolidated.push({
            date: date,
            pointVente: pointVente,
            produit: produit,
            stockMatin: stockMatinQuantite,
            stockSoir: stockSoirQuantite,
            transferts: transfertQuantite,
            ventesTheoriques: ventesTheoriques
        });
    });
    
    // Trier par date, puis par point de vente, puis par produit
    consolidated.sort((a, b) => {
        if (a.date !== b.date) return new Date(a.date.split('/').reverse().join('-')) - new Date(b.date.split('/').reverse().join('-'));
        if (a.pointVente !== b.pointVente) return a.pointVente.localeCompare(b.pointVente);
        return a.produit.localeCompare(b.produit);
    });
    
    return consolidated;
}

// Afficher les données consolidées
function displayConsolidatedData() {
    const tbody = document.getElementById('consolidated-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (consolidatedData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Aucune donnée disponible</td></tr>';
        return;
    }
    
    consolidatedData.forEach(item => {
        const row = document.createElement('tr');
        const ventesClass = item.ventesTheoriques >= 0 ? 'text-success' : 'text-danger';
        
        row.innerHTML = `
            <td>${item.date}</td>
            <td>${item.pointVente}</td>
            <td>${item.produit}</td>
            <td class="text-end">${item.stockMatin.toLocaleString('fr-FR')}</td>
            <td class="text-end">${item.stockSoir.toLocaleString('fr-FR')}</td>
            <td class="text-end">${item.transferts.toLocaleString('fr-FR')}</td>
            <td class="text-end ${ventesClass}">${item.ventesTheoriques.toLocaleString('fr-FR')}</td>
        `;
        tbody.appendChild(row);
    });
}

// Filtrer les données selon les critères
function filterData(data, pointVente, produit) {
    return data.filter(item => {
        const matchPointVente = !pointVente || item.pointVente === pointVente;
        const matchProduit = !produit || item.produit === produit;
        return matchPointVente && matchProduit;
    });
}

// Filtrer les données de transferts
function filterTransfertsData(data, pointVente, produit) {
    return data.filter(item => {
        const matchPointVente = !pointVente || item.pointVente === pointVente;
        const matchProduit = !produit || item.produit === produit;
        return matchPointVente && matchProduit;
    });
}

// Exporter les données en Excel
function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('Bibliothèque Excel non disponible');
        return;
    }
    
    const dateDebut = document.getElementById('date-debut')?.value;
    const dateFin = document.getElementById('date-fin')?.value;
    const pointVente = document.getElementById('point-vente-filter')?.value;
    const produit = document.getElementById('produit-filter')?.value;
    
    if (consolidatedData.length === 0) {
        showToast('Aucune donnée à exporter');
        return;
    }
    
    // Créer un nouveau classeur
    const workbook = XLSX.utils.book_new();
    
    // Préparer les données pour Excel
    const excelData = consolidatedData.map(item => ({
        'Date': item.date,
        'Point de Vente': item.pointVente,
        'Produit': item.produit,
        'Stock Matin': item.stockMatin,
        'Stock Soir': item.stockSoir,
        'Transferts': item.transferts,
        'Ventes Théoriques': item.ventesTheoriques
    }));
    
    // Créer la feuille Excel
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Ajouter la feuille au classeur
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Stocks et Ventes');
    
    // Générer le nom du fichier
    let filename = 'stocks_et_ventes_theoriques';
    if (dateDebut && dateFin) {
        filename += `_${dateDebut.replace(/\//g, '-')}_${dateFin.replace(/\//g, '-')}`;
    }
    if (pointVente) {
        filename += `_${pointVente.replace(/\s+/g, '_')}`;
    }
    if (produit) {
        filename += `_${produit}`;
    }
    filename += '.xlsx';
    
    // Télécharger le fichier
    XLSX.writeFile(workbook, filename);
    
    showToast(`Export Excel réussi : ${filename}`);
}

// Utilitaires
function convertDateToISO(dateStr) {
    if (!dateStr) return '';
    
    // Si la date est déjà au format YYYY-MM-DD, la retourner telle quelle
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }
    
    // Convertir depuis le format DD/MM/YYYY
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
            return `${year}-${month}-${day}`;
        }
    }
    
    // Convertir depuis le format DD-MM-YYYY
    if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            // Si le premier élément a 4 chiffres, c'est déjà YYYY-MM-DD
            if (parts[0].length === 4) {
                return dateStr;
            }
            // Sinon c'est DD-MM-YYYY
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
            return `${year}-${month}-${day}`;
        }
    }
    
    console.error('Format de date non reconnu:', dateStr);
    return dateStr;
}

function generateDateRange(startDate, endDate) {
    const dates = [];
    const currentDate = new Date(startDate);
    const end = new Date(endDate);
    
    while (currentDate <= end) {
        dates.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return dates;
}

function showLoading() {
    const tbody = document.getElementById('consolidated-tbody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center loading"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr>';
    }
}

function hideLoading() {
    // Le loading est remplacé par les données ou le message "Aucune donnée"
}

// ==== GESTION DE LA CONFIGURATION DES PRODUITS ====

// Variables globales pour la configuration des produits
let currentProduitsConfig = {};
let currentInventaireConfig = {};
let currentAbonnementConfig = {};
// Méta-données par catégorie de l'onglet Produits Généraux: { "Bovin": {famille: "Boucherie", id: 4, ordre: 1}, ... }
let currentCategoriesMeta = {};
// Filtre actif sur l'onglet Produits Généraux: 'Tous' | 'Boucherie' | 'Epicerie' | 'Autres'
let currentFamilleFilter = 'Tous';
// Filtre actif sur l'onglet Inventaire (mêmes valeurs que Généraux).
let currentInventaireFamilleFilter = 'Tous';
// Recherche texte sur l'onglet Inventaire — filtre les lignes par nom de produit.
let currentInventaireSearchQuery = '';
// Mapping famille des catégories d'inventaire. Défauts hardcodés pour les 6
// catégories logiques standard; surcharges utilisateur stockées en localStorage
// (clé: 'inventaireCategoriesFamille'). Les catégories d'inventaire ne sont pas
// en DB (champ categorie_affichage sur Produit + résolution client-side), d'où
// la persistance localStorage plutôt qu'une nouvelle table.
const inventaireFamilleDefauts = {
    'Viandes': 'Boucherie',
    'Abats et Sous-produits': 'Boucherie',
    'Produits sur Pieds': 'Boucherie',
    'Œufs et Produits Laitiers': 'Epicerie',
    'Superette': 'Epicerie',           // NEW: cat. par defaut des produits non-boucherie
    'Déchets': 'Autres'
    // 'Autres' supprime de la liste des categories logiques (remplace par 'Superette')
};

// =====================================================================
// Catégories standard utilisées dans les <select> des modales d'ajout.
// Groupées par famille pour l'affichage <optgroup>. Source unique de
// vérité — utilisé par populerCategorieSelect() et par les classifieurs.
// =====================================================================
const CATEGORIES_PRODUITS_GENERAUX = {
    'Boucherie': ['Bovin', 'Ovin', 'Volaille', 'Caprin', 'Poisson', 'Pack'],
    'Épicerie':  ['Superette', 'Conserve', 'Riz & Féculents']
};
const DEFAULT_CATEGORIE_PRODUITS_GENERAUX = 'Superette';

// Categories Inventaire alignees sur Produits Generaux (taxonomie unique).
// Les anciennes categories logiques ("Viandes", "Abats et Sous-produits",
// "Produits sur Pieds", "Œufs et Produits Laitiers", "Déchets") restent
// supportees pour les produits existants via pumPopulerSelect qui injecte
// l'option legacy si la valeur courante n'est pas dans la liste.
const CATEGORIES_INVENTAIRE = CATEGORIES_PRODUITS_GENERAUX;
const DEFAULT_CATEGORIE_INVENTAIRE = 'Superette';

// Helper: re-route les anciennes selections "Autres" vers la default
// "Superette". Migration silencieuse cote UI.
function normaliserCategorieAvecDefaut(categorie, defaut) {
    if (!categorie || categorie === 'Autres') return defaut;
    return categorie;
}

// Toggle global "Afficher les archives" partage entre les onglets
// Produits Generaux et Produits Inventaire. False par defaut (cache les
// archives, comme dans le POS et le stock inventaire). L'onglet Recherche
// a son propre toggle (_rechercheState.showArchived) car son scope est
// plus large (les 2 catalogues fusionnes).
let _showArchivedInTabs = false;

// Synchronise toutes les checkboxes data-show-archived-tabs avec l'etat
// et re-rend les 2 onglets. Bind au load + au change de n'importe quelle
// checkbox dans le groupe.
function syncShowArchivedTabs(value) {
    _showArchivedInTabs = !!value;
    document.querySelectorAll('[data-show-archived-tabs]').forEach((cb) => {
        if (cb.checked !== _showArchivedInTabs) cb.checked = _showArchivedInTabs;
    });
    if (typeof afficherProduitsConfig === 'function') afficherProduitsConfig();
    if (typeof afficherInventaireConfig === 'function') afficherInventaireConfig();
}

// Bind des toggles "Afficher les archives" sur les onglets PG + Inv.
// Idempotent via flag, peut etre rappele si le DOM est modifie.
function initShowArchivedTabsToggles() {
    document.querySelectorAll('[data-show-archived-tabs]').forEach((cb) => {
        if (cb.dataset.bound === 'true') return;
        cb.dataset.bound = 'true';
        cb.checked = _showArchivedInTabs; // sync initial
        cb.addEventListener('change', (e) => syncShowArchivedTabs(e.target.checked));
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShowArchivedTabsToggles);
} else {
    initShowArchivedTabsToggles();
}

// Mapping: label produit (Bovin, Ovin, Conserve...) -> bucket logique de
// l'inventaire ("Viandes", "Superette", ...). Les buckets restent grossiers
// pour l'affichage de l'onglet Inventaire (groupes de viandes / epicerie /
// dechets) alors que les labels alignes Produits Generaux sont plus fins.
// Pass-through pour les buckets legacy ('Viandes', 'Déchets', ...) et pour
// les categories personnalisees (qui ont leur propre bucket cree a la volee).
const _CAT_AFFICHAGE_TO_BUCKET = {
    'Bovin': 'Viandes',
    'Ovin': 'Viandes',
    'Volaille': 'Viandes',
    'Caprin': 'Viandes',
    'Poisson': 'Viandes',
    'Pack': 'Viandes',
    'Conserve': 'Superette',
    'Riz & Féculents': 'Superette'
    // 'Superette' passe-through (deja un bucket)
};
function mapCategorieAffichageVersBucket(cat) {
    if (!cat) return null;
    return _CAT_AFFICHAGE_TO_BUCKET[cat] || cat;
}

// Charger la configuration des produits généraux
async function chargerConfigProduits() {
    try {
        const response = await fetch('/api/admin/config/produits', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success && data.produits) {
            currentProduitsConfig = data.produits;
            currentCategoriesMeta = data.categoriesMeta || {};
            console.log('✅ Produits chargés:', Object.keys(currentProduitsConfig));
            afficherProduitsConfig();
        } else {
            console.error('Erreur lors du chargement de la configuration des produits:', data.message || 'Données vides');
            currentProduitsConfig = {};
        }
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration des produits:', error);
        currentProduitsConfig = {};
    }
    // Rafraichir la recherche cross-catalogue si l'UI est deja initialisee.
    // Sinon Recherche affiche 0 resultat au load (les configs arrivent
    // async apres l'init de l'onglet).
    refreshRechercheApresConfigLoad();
}

// Charger la configuration des produits d'inventaire
async function chargerConfigInventaire() {
    try {
        const response = await fetch('/api/admin/config/produits-inventaire', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            currentInventaireConfig = data.produitsInventaire;

            // Mettre à jour les catégories personnalisées depuis le serveur
            if (data.categoriesPersonnalisees && data.categoriesPersonnalisees.length > 0) {
                localStorage.setItem('inventaireCategoriesPersonnalisees', JSON.stringify(data.categoriesPersonnalisees));
                console.log('📁 Catégories personnalisées chargées:', data.categoriesPersonnalisees);
            }

            // Charger le mapping famille depuis la table inventaire_categories
            // avant le premier rendu pour éviter un flash 'Autres' partout.
            await chargerInventaireFamilleMap();

            afficherInventaireConfig();
        } else {
            console.error('Erreur lors du chargement de la configuration d\'inventaire:', data.message);
            showToast('Erreur lors du chargement de la configuration d\'inventaire');
        }
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration d\'inventaire:', error);
        showToast('Erreur lors du chargement de la configuration d\'inventaire');
    }
    // Rafraichir l'onglet Recherche cross-catalogue.
    refreshRechercheApresConfigLoad();
}

// Helper: re-render l'onglet Recherche apres un load des configs.
// No-op si l'UI Recherche n'est pas encore initialisee (avant DOMContentLoaded).
function refreshRechercheApresConfigLoad() {
    if (typeof reconstruireFlatRecherche !== 'function') return;
    const grid = document.getElementById('recherche-grid');
    if (!grid) return; // tab pas dans le DOM (autre page)
    try {
        reconstruireFlatRecherche();
        updateRechercheCompteurs();
        if (typeof renderRechercheCategoriesFilter === 'function') {
            renderRechercheCategoriesFilter();
        }
        renderRechercheGrid();
    } catch (e) {
        // initRechercheSpotlight n'a pas encore ete appele; le premier
        // rendu se fera la, donc on no-op silencieusement.
    }
}

// Charger la configuration des produits d'abonnement
async function chargerConfigAbonnement() {
    try {
        const response = await fetch('/api/admin/config/produits-abonnement', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
            currentAbonnementConfig = data.produitsAbonnement;
            afficherAbonnementConfig();
        } else {
            console.error('Erreur lors du chargement de la configuration d\'abonnement:', data.message);
            showToast('Erreur lors du chargement de la configuration d\'abonnement');
        }
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration d\'abonnement:', error);
        showToast('Erreur lors du chargement de la configuration d\'abonnement');
    }
}

// Afficher la configuration des produits généraux
// Fonction pour générer le bouton de suppression conditionnel
function getCategorieDeleteButton(categorie) {
    const categoriesPrincipales = ['Bovin', 'Ovin', 'Volaille', 'Pack', 'Caprin', 'Autres'];

    if (categoriesPrincipales.includes(categorie)) {
        return `<button class="btn btn-sm btn-secondary" disabled title="Catégorie principale - ne peut pas être supprimée">
                    <i class="fas fa-lock"></i>
                </button>`;
    } else {
        return `<button class="btn btn-sm btn-danger" data-action="supprimer-categorie" data-categorie="${escAttr(categorie)}">
                    <i class="fas fa-trash"></i>
                </button>`;
    }
}

// Famille d'une catégorie selon currentCategoriesMeta. Default 'Autres' si la
// catégorie n'a pas (encore) de méta — ça arrive sur les nouvelles catégories
// créées avant que la migration côté DB ait tourné, ou sur les catégories perso
// d'inventaire qui ne sont pas dans cette table.
function familleDeCategorie(nomCategorie) {
    const meta = currentCategoriesMeta[nomCategorie];
    return meta && meta.famille ? meta.famille : 'Autres';
}

// Échappement HTML attribut (couvre " et ' en plus de &<>) — utilisé partout
// où on injecte du contenu dynamique (noms de catégorie/produit) dans des
// attributs HTML. Évite les XSS-via-admin si jamais un nom contient des
// caractères spéciaux.
function escAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function rendreFiltreFamille(container) {
    const familles = ['Tous', 'Boucherie', 'Epicerie', 'Autres'];
    const html = `
        <div class="btn-group mb-3" role="group" aria-label="Filtre famille" data-role="famille-filter">
            ${familles.map((f) => `
                <button type="button"
                    class="btn ${currentFamilleFilter === f ? 'btn-primary' : 'btn-outline-primary'}"
                    data-famille="${escAttr(f)}">${escAttr(f)}</button>
            `).join('')}
        </div>`;
    container.insertAdjacentHTML('beforeend', html);
    // Délégation: un seul listener pour les 4 boutons
    const grp = container.querySelector('[data-role="famille-filter"]');
    if (grp) {
        grp.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-famille]');
            if (btn) setFamilleFilter(btn.dataset.famille);
        });
    }
}

function setFamilleFilter(famille) {
    currentFamilleFilter = famille;
    afficherProduitsConfig();
}

async function changerFamilleCategorie(nomCategorie, nouvelleFamille) {
    const meta = currentCategoriesMeta[nomCategorie];
    if (!meta || !meta.id) {
        showToast(`Impossible: catégorie "${nomCategorie}" n'a pas d'ID en mémoire — recharge la page.`);
        return;
    }
    try {
        const response = await fetch(`/api/admin/config/categories/${meta.id}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ famille: nouvelleFamille })
        });
        const data = await response.json();
        if (!data.success) {
            showToast(`Erreur: ${data.error || 'échec'}`);
            return;
        }
        currentCategoriesMeta[nomCategorie].famille = nouvelleFamille;
        afficherProduitsConfig();
    } catch (e) {
        console.error('changerFamilleCategorie:', e);
        showToast('Erreur réseau.');
    }
}

function afficherProduitsConfig() {
    const container = document.getElementById('produits-categories');
    if (!container) return;

    container.innerHTML = '';
    rendreFiltreFamille(container);

    // Délégation: un seul listener attaché une fois (idempotent via flag)
    // pour toutes les actions data-action sur les catégories. Évite les
    // inline onclick="...('${nom}')" qui pouvaient injecter du code si un
    // nom de catégorie/produit contenait des caractères spéciaux.
    if (!container.dataset.delegatedActionsBound) {
        container.dataset.delegatedActionsBound = '1';
        container.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action]');
            if (!target || !container.contains(target)) return;
            const action = target.dataset.action;
            const categorie = target.dataset.categorie;
            if (action === 'ajouter-produit-categorie') {
                e.stopPropagation();
                if (typeof ajouterProduitCategorie === 'function') ajouterProduitCategorie(categorie);
            } else if (action === 'supprimer-categorie') {
                e.stopPropagation();
                if (typeof supprimerCategorie === 'function') supprimerCategorie(categorie);
            }
        });
        container.addEventListener('change', (e) => {
            const target = e.target.closest('[data-action="changer-famille-categorie"]');
            if (target) {
                changerFamilleCategorie(target.dataset.categorie, target.value);
            }
        });
        // Empêche le select famille de plier l'accordéon quand l'admin clique dessus
        container.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="changer-famille-categorie"]')) {
                e.stopPropagation();
            }
        });
    }

    // Protection contre les données undefined ou null
    if (!currentProduitsConfig || typeof currentProduitsConfig !== 'object') {
        container.innerHTML = '<div class="alert alert-warning">Aucune configuration de produits disponible</div>';
        return;
    }
    
    const categories = Object.keys(currentProduitsConfig);
    if (categories.length === 0) {
        container.innerHTML = '<div class="alert alert-info">Aucun produit configuré. Utilisez l\'interface d\'administration pour ajouter des produits.</div>';
        return;
    }
    
    // Filtrer selon la famille active. 'Tous' montre tout.
    const categoriesAffichees = currentFamilleFilter === 'Tous'
        ? categories
        : categories.filter((cat) => familleDeCategorie(cat) === currentFamilleFilter);

    if (categoriesAffichees.length === 0) {
        container.insertAdjacentHTML('beforeend',
            `<div class="alert alert-info">Aucune catégorie dans la famille "${currentFamilleFilter}". Change le filtre ou reclasse une catégorie via son menu déroulant.</div>`);
        return;
    }

    categoriesAffichees.forEach((categorie, index) => {
        if (typeof currentProduitsConfig[categorie] === 'object' && currentProduitsConfig[categorie] !== null) {
            const famille = familleDeCategorie(categorie);
            const catEsc = escAttr(categorie);
            const familleSelect = `
                <select class="form-select form-select-sm me-2" style="width: 130px;"
                        data-action="changer-famille-categorie" data-categorie="${catEsc}">
                    <option value="Boucherie" ${famille === 'Boucherie' ? 'selected' : ''}>Boucherie</option>
                    <option value="Epicerie" ${famille === 'Epicerie' ? 'selected' : ''}>Epicerie</option>
                    <option value="Autres" ${famille === 'Autres' ? 'selected' : ''}>Autres</option>
                </select>`;
            const categorieHtml = `
                <div class="accordion-item">
                    <h2 class="accordion-header" id="heading-${index}">
                        <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${index}" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="collapse-${index}">
                            <i class="fas fa-folder-open me-2"></i>
                            ${escAttr(categorie)} (${Object.keys(currentProduitsConfig[categorie]).length} produits)
                            <div class="ms-auto me-3 d-flex align-items-center">
                                ${familleSelect}
                                <button class="btn btn-sm btn-success me-1" data-action="ajouter-produit-categorie" data-categorie="${catEsc}" data-bs-toggle="modal" data-bs-target="#addProductModal">
                                    <i class="fas fa-plus"></i>
                                </button>
                                ${getCategorieDeleteButton(categorie)}
                            </div>
                        </button>
                    </h2>
                    <div id="collapse-${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" aria-labelledby="heading-${index}" data-bs-parent="#produits-categories">
                        <div class="accordion-body">
                            <div class="table-responsive">
                                <table class="table table-sm">
                                    <thead>
                                        <tr>
                                            <th>Produit</th>
                                            <th>Prix Défaut</th>
                                            <th>Alternatives</th>
                                            <th>Prix Spéciaux</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${genererLignesProduits(categorie)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', categorieHtml);
        }
    });
}

// Générer les lignes de produits pour une catégorie
function genererLignesProduits(categorie) {
    let html = '';
    const produits = currentProduitsConfig[categorie];

    Object.keys(produits).forEach(produit => {
        const config = produits[produit];
        if (typeof config === 'object' && config.default !== undefined) {
            // Filtre archive: cache par defaut (coherent avec le POS et la
            // recherche). Le toggle "Afficher les archives" du tab inclut
            // ces produits avec un marquage visuel.
            if (config.archived && !_showArchivedInTabs) return;
            const isArchived = !!config.archived;

            const alternatives = config.alternatives ? config.alternatives.join(', ') : '';
            const prixSpeciaux = Object.keys(config)
                .filter(key => !['default', 'alternatives', 'prix_personnalise', 'inventaire_parent', 'archived'].includes(key))
                .map(key => `${key}: ${config[key]}`)
                .join(', ');

            // Indicateurs de liaison à un produit d'inventaire parent.
            // - inventaire_parent: nom du produit inventaire dont les `ventes` listent ce produit (calculé côté serveur).
            // - prix_personnalise: true si l'admin a déjà modifié le prix manuellement -> stoppe la propagation.
            const parent = config.inventaire_parent || null;
            const detache = !!config.prix_personnalise;
            const escapedProduit = produit.replace(/'/g, "\\'");
            let lienBadge = '';
            let reattachBtn = '';
            if (parent) {
                if (detache) {
                    lienBadge = `<span class="badge bg-warning text-dark" title="Prix modifié manuellement — la propagation depuis '${parent}' est désactivée. Réattachez pour resynchroniser.">🔒 détaché de ${parent}</span>`;
                    reattachBtn = `<button class="btn btn-sm btn-outline-success ms-1" title="Réattacher à ${parent} et resynchroniser le prix" onclick="reattacherProduitVente('${escapedProduit}')">🔗 Réattacher</button>`;
                } else {
                    lienBadge = `<span class="badge bg-info text-dark" title="Prix hérité de '${parent}'. Modifier le prix ici détachera automatiquement.">🔗 ${parent}</span>`;
                }
            }
            const archivedBadge = isArchived
                ? `<span class="badge bg-warning text-dark ms-1" title="Produit archivé — masqué du POS et du stock inventaire"><i class="bi bi-archive"></i> Archivé</span>`
                : '';

            html += `
                <tr class="${isArchived ? 'row-archived' : ''}">
                    <td>
                        <input type="text" class="form-control form-control-sm" value="${produit}"
                               onchange="modifierNomProduit('${categorie}', '${produit}', this.value)">
                        ${(lienBadge || archivedBadge) ? `<div class="mt-1">${lienBadge}${archivedBadge}</div>` : ''}
                    </td>
                    <td>
                        <input type="number" class="form-control form-control-sm" value="${config.default}"
                               onchange="modifierPrixDefaut('${categorie}', '${produit}', this.value)">
                    </td>
                    <td>
                        <input type="text" class="form-control form-control-sm" value="${alternatives}"
                               placeholder="Ex: 3500,3600,3700"
                               onchange="modifierAlternatives('${categorie}', '${produit}', this.value)">
                    </td>
                    <td>
                        <small class="text-muted">${prixSpeciaux}</small>
                        <button class="btn btn-sm btn-outline-primary ms-1" onclick="modifierPrixSpeciaux('${categorie}', '${produit}')">
                            <i class="fas fa-edit"></i>
                        </button>
                    </td>
                    <td>
                        ${reattachBtn}
                        <button class="btn btn-sm btn-danger" onclick="supprimerProduit('${categorie}', '${produit}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        }
    });
    
    return html;
}

// Reorganiser les produits d'inventaire par catégories logiques + personnalisées
function reorganiserInventaireParCategories() {
    // Categories logiques: ordre = ordre d'affichage. "Autres" supprime au
    // profit de "Superette" (epicerie generique). Tous les produits qui ne
    // matchent aucun pattern boucherie tombent dans Superette.
    const inventaireParCategories = {
        "Viandes": {},
        "Abats et Sous-produits": {},
        "Produits sur Pieds": {},
        "Œufs et Produits Laitiers": {},
        "Superette": {},
        "Déchets": {}
    };
    
    // Liste des catégories personnalisées (stockées dans localStorage ou ajoutées manuellement)
    const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
    
    // Ajouter les catégories personnalisées
    categoriesPersonnalisees.forEach(cat => {
        if (!inventaireParCategories[cat]) {
            inventaireParCategories[cat] = {};
        }
    });
    
    Object.keys(currentInventaireConfig).forEach(produit => {
        const config = currentInventaireConfig[produit];
        
        // Si c'est une catégorie personnalisée (objet sans prixDefault contenant des produits)
        if (typeof config === 'object' && config.prixDefault === undefined) {
            // Vérifier si c'est une catégorie avec des produits dedans
            const hasProducts = Object.keys(config).some(key => {
                const subConfig = config[key];
                return typeof subConfig === 'object' && subConfig.prixDefault !== undefined;
            });
            
            if (hasProducts || Object.keys(config).length === 0) {
                // C'est une catégorie personnalisée
                if (!inventaireParCategories[produit]) {
                    inventaireParCategories[produit] = {};
                }
                // Ajouter les produits de cette catégorie
                Object.keys(config).forEach(subProduit => {
                    if (typeof config[subProduit] === 'object' && config[subProduit].prixDefault !== undefined) {
                        inventaireParCategories[produit][subProduit] = config[subProduit];
                    }
                });
                
                // Sauvegarder cette catégorie comme personnalisée
                if (!categoriesPersonnalisees.includes(produit)) {
                    categoriesPersonnalisees.push(produit);
                    localStorage.setItem('inventaireCategoriesPersonnalisees', JSON.stringify(categoriesPersonnalisees));
                }
                return;
            }
        }
        
        if (typeof config === 'object' && config.prixDefault !== undefined) {
            // Priorite 1: si le produit a un categorie_affichage explicite
            // (choisi par l'utilisateur a l'ajout), on l'honore. Depuis que
            // CATEGORIES_INVENTAIRE = CATEGORIES_PRODUITS_GENERAUX, les labels
            // saisis sont fins ('Bovin', 'Conserve'...) mais les buckets sont
            // grossiers ('Viandes', 'Superette'...) — il faut mapper avant le
            // lookup, sinon la selection explicite est perdue.
            const mapped = mapCategorieAffichageVersBucket(config.categorie_affichage);
            const explicitCat = normaliserCategorieAvecDefaut(mapped, DEFAULT_CATEGORIE_INVENTAIRE);
            if (config.categorie_affichage && explicitCat && inventaireParCategories[explicitCat]) {
                inventaireParCategories[explicitCat][produit] = config;
                return;
            }

            // Priorite 2: classification par nom (heuristique boucherie).
            // Fallback final = "Superette" (anciennement "Autres").
            if (produit.includes('Boeuf') || produit.includes('Veau') || produit.includes('Poulet') || produit.includes('Agneau')) {
                inventaireParCategories["Viandes"][produit] = config;
            } else if (produit.includes('Tablette') || produit.includes('Oeuf')) {
                inventaireParCategories["Œufs et Produits Laitiers"][produit] = config;
            } else if (produit.includes('Foie') || produit.includes('Yell') || produit.includes('Abats') || produit.includes('Tete')) {
                inventaireParCategories["Abats et Sous-produits"][produit] = config;
            } else if (produit.includes('sur pieds') || produit.includes('sur pied')) {
                inventaireParCategories["Produits sur Pieds"][produit] = config;
            } else if (produit.includes('Déchet') || produit.includes('Dechet')) {
                inventaireParCategories["Déchets"][produit] = config;
            } else {
                inventaireParCategories["Superette"][produit] = config;
            }
        }
    });

    // Supprimer les catégories LOGIQUES vides (mais garder les personnalisées)
    const categoriesLogiques = ["Viandes", "Œufs et Produits Laitiers", "Abats et Sous-produits", "Produits sur Pieds", "Superette", "Déchets"];
    
    Object.keys(inventaireParCategories).forEach(categorie => {
        // Ne supprimer que les catégories logiques vides, garder les personnalisées
        if (Object.keys(inventaireParCategories[categorie]).length === 0 && categoriesLogiques.includes(categorie)) {
            delete inventaireParCategories[categorie];
        }
    });
    
    return inventaireParCategories;
}

// Fonction pour générer le bouton de suppression conditionnel pour l'inventaire
function getCategorieInventaireDeleteButton(categorie) {
    const categoriesInventairePrincipales = ['Viandes', 'Œufs et Produits Laitiers', 'Abats et Sous-produits', 'Produits sur Pieds', 'Superette', 'Déchets'];
    
    if (categoriesInventairePrincipales.includes(categorie)) {
        return `<button class="btn btn-sm btn-secondary" disabled title="Catégorie logique - ne peut pas être supprimée">
                    <i class="fas fa-lock"></i>
                </button>`;
    } else {
        return `<button class="btn btn-sm btn-danger" onclick="supprimerCategorieInventaire('${categorie}')">
                    <i class="fas fa-trash"></i>
                </button>`;
    }
}

// Helpers famille pour l'inventaire (persistance DB via inventaire_categories).
// Cache en mémoire chargé au premier rendu de l'onglet, rafraîchi à chaque save.
let inventaireFamilleMap = null;

async function chargerInventaireFamilleMap() {
    try {
        const response = await fetch('/api/admin/config/inventaire-categories', {
            credentials: 'include'
        });
        const data = await response.json();
        if (data.success) {
            inventaireFamilleMap = data.familles || {};
        } else {
            console.warn('Echec chargement inventaire-categories:', data.error);
            inventaireFamilleMap = {};
        }
    } catch (e) {
        console.error('chargerInventaireFamilleMap:', e);
        inventaireFamilleMap = {};
    }
    return inventaireFamilleMap;
}

function familleDeCategorieInventaire(nomCategorie) {
    if (inventaireFamilleMap && inventaireFamilleMap[nomCategorie]) {
        return inventaireFamilleMap[nomCategorie];
    }
    return inventaireFamilleDefauts[nomCategorie] || 'Autres';
}

async function changerFamilleCategorieInventaire(nomCategorie, nouvelleFamille) {
    try {
        const response = await fetch(`/api/admin/config/inventaire-categories/${encodeURIComponent(nomCategorie)}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ famille: nouvelleFamille })
        });
        const data = await response.json();
        if (!data.success) {
            showToast(`Erreur: ${data.error || 'échec'}`);
            return;
        }
        if (!inventaireFamilleMap) inventaireFamilleMap = {};
        inventaireFamilleMap[nomCategorie] = nouvelleFamille;
        afficherInventaireConfig();
    } catch (e) {
        console.error('changerFamilleCategorieInventaire:', e);
        showToast('Erreur réseau lors du changement de famille.');
    }
}

function setFamilleFilterInventaire(famille) {
    currentInventaireFamilleFilter = famille;
    afficherInventaireConfig();
}

// Re-rend les boutons "Tous / Boucherie / Epicerie / Autres" dans le header
// stable (hors #inventaire-categories) pour refleter currentInventaireFamilleFilter.
function renderInventaireFamilleButtons() {
    const wrap = document.getElementById('inventaire-famille-buttons');
    if (!wrap) return;
    const familles = ['Tous', 'Boucherie', 'Epicerie', 'Autres'];
    wrap.innerHTML = familles.map((f) => `
        <button type="button"
            class="btn ${currentInventaireFamilleFilter === f ? 'btn-primary' : 'btn-outline-primary'}"
            onclick="setFamilleFilterInventaire('${f}')">${f}</button>
    `).join('');
}

// Synchronise la valeur de l'input sans toucher au DOM (le listener reste
// attache, on n'ecrase QUE la propriete .value).
function syncInventaireSearchInputValue() {
    const input = document.getElementById('inventaire-search-input');
    if (!input) return;
    if (input.value !== (currentInventaireSearchQuery || '')) {
        input.value = currentInventaireSearchQuery || '';
    }
}

// Init du listener via EVENT DELEGATION sur document: capte les events
// 'input' qui ciblent #inventaire-search-input, peu importe quand l'input
// est cree ou recree. Bullet-proof contre les re-renders et l'ordre de
// chargement (admin.js peut s'executer avant que l'input existe).
function initInventaireHeaderControls() {
    if (document._inventaireSearchBound) return;
    document._inventaireSearchBound = true;
    document.addEventListener('input', (e) => {
        const t = e.target;
        if (!t || t.id !== 'inventaire-search-input') return;
        currentInventaireSearchQuery = t.value || '';
        filtrerProduitsInventaire(currentInventaireSearchQuery);
    });
}
// Attacher immediatement (idempotent via _inventaireSearchBound guard).
initInventaireHeaderControls();

// Afficher la configuration des produits d'inventaire avec accordéon
function afficherInventaireConfig() {
    const container = document.getElementById('inventaire-categories');
    if (!container) return;

    container.innerHTML = '';

    // Renders / rafraichit les controles du header stable (hors container)
    // sans casser le listener input qui est attache une SEULE fois (cf
    // initInventaireHeaderControls plus bas). Le bug "search ne marche pas"
    // venait de l'ancienne approche qui re-creait l'input a chaque render
    // et perdait le listener pendant la frappe.
    initInventaireHeaderControls(); // idempotent (data-bound guard)
    renderInventaireFamilleButtons();
    syncInventaireSearchInputValue();

    const inventaireParCategories = reorganiserInventaireParCategories();

    const categoriesAffichees = Object.keys(inventaireParCategories).filter((cat) =>
        currentInventaireFamilleFilter === 'Tous' || familleDeCategorieInventaire(cat) === currentInventaireFamilleFilter
    );

    if (categoriesAffichees.length === 0) {
        container.insertAdjacentHTML('beforeend',
            `<div class="alert alert-info">Aucune catégorie d'inventaire dans la famille "${currentInventaireFamilleFilter}". Change le filtre ou reclasse une catégorie via son menu déroulant.</div>`);
        return;
    }

    categoriesAffichees.forEach((categorie, index) => {
        const produits = inventaireParCategories[categorie];
        const nombreProduits = Object.keys(produits).length;
        const famille = familleDeCategorieInventaire(categorie);
        const escCat = categorie.replace(/'/g, "\\'");
        const familleSelect = `
            <select class="form-select form-select-sm me-2" style="width: 130px;"
                    onclick="event.stopPropagation()"
                    onchange="changerFamilleCategorieInventaire('${escCat}', this.value)">
                <option value="Boucherie" ${famille === 'Boucherie' ? 'selected' : ''}>Boucherie</option>
                <option value="Epicerie" ${famille === 'Epicerie' ? 'selected' : ''}>Epicerie</option>
                <option value="Autres" ${famille === 'Autres' ? 'selected' : ''}>Autres</option>
            </select>`;

        const categorieHtml = `
            <div class="accordion-item" data-categorie="${escAttr(categorie)}">
                <h2 class="accordion-header" id="inventaire-heading-${index}">
                    <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#inventaire-collapse-${index}" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="inventaire-collapse-${index}">
                        <i class="fas fa-warehouse me-2"></i>
                        ${categorie} (${nombreProduits} produits)
                        <div class="ms-auto me-3 d-flex align-items-center">
                            ${familleSelect}
                            <button class="btn btn-sm btn-success me-1" onclick="event.stopPropagation(); ajouterProduitInventaireCategorie('${escCat}')" data-bs-toggle="modal" data-bs-target="#addInventaireProductModal">
                                <i class="fas fa-plus"></i>
                            </button>
                            ${getCategorieInventaireDeleteButton(categorie)}
                        </div>
                    </button>
                </h2>
                <div id="inventaire-collapse-${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" aria-labelledby="inventaire-heading-${index}" data-bs-parent="#inventaire-categories">
                    <div class="accordion-body">
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Produit</th>
                                        <th>Prix Défaut</th>
                                        <th>Alternatives</th>
                                        <th>Mode Stock</th>
                                        <th>Ventes liées</th>
                                        <th>Prix Spéciaux</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${genererLignesProduitsInventaire(produits, categorie)}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', categorieHtml);
    });

    if (currentInventaireSearchQuery) {
        filtrerProduitsInventaire(currentInventaireSearchQuery);
    }
}

// Filtre client-side dead-simple: masque tout <tr> du conteneur dont le
// textContent ne contient pas la requête (insensible casse + accents).
// Plus de selecteurs fragiles sur data-produit, plus d'hypotheses sur la
// structure du tbody. Pour chaque row visible: on lit ce que l'utilisateur
// VOIT (textContent + values des <input>) et on matche.
function filtrerProduitsInventaire(query) {
    const container = document.getElementById('inventaire-categories');
    if (!container) return;
    const norm = (s) => String(s || '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase();
    const q = norm(query).trim();

    // 1) Filtrer les rows: cache celles qui ne matchent pas.
    //    On exclut les rows d'en-tete (celles qui contiennent un <th>).
    const allRows = container.querySelectorAll('tr');
    allRows.forEach((row) => {
        if (row.querySelector('th')) return; // header row, ignore
        if (!q) {
            row.style.display = '';
            return;
        }
        // textContent + valeurs des inputs (le nom du produit est dans le 1er input)
        let text = row.textContent || '';
        row.querySelectorAll('input, select').forEach((el) => { text += ' ' + (el.value || ''); });
        row.style.display = norm(text).includes(q) ? '' : 'none';
    });

    // 2) Pour chaque accordion-item, cacher ceux qui n'ont aucune row visible.
    //    Et auto-deplier ceux qui ont des matches (sinon Bootstrap les garde fermes).
    container.querySelectorAll('.accordion-item').forEach((item) => {
        const visibleDataRows = Array.from(item.querySelectorAll('tr'))
            .filter((r) => !r.querySelector('th') && r.style.display !== 'none');
        item.style.display = (q && visibleDataRows.length === 0) ? 'none' : '';
        if (q && visibleDataRows.length > 0) {
            const collapse = item.querySelector('.accordion-collapse');
            const button = item.querySelector('.accordion-button');
            if (collapse && !collapse.classList.contains('show')) collapse.classList.add('show');
            if (button && button.classList.contains('collapsed')) {
                button.classList.remove('collapsed');
                button.setAttribute('aria-expanded', 'true');
            }
        }
    });
}

// Générer les lignes de produits pour une catégorie d'inventaire
function genererLignesProduitsInventaire(produits, categorie) {
    let html = '';
    
    // Vérifier si c'est une catégorie personnalisée
    const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
    const isCustomCategory = categoriesPersonnalisees.includes(categorie);
    const catParam = isCustomCategory ? `'${categorie}'` : 'null';
    
    Object.keys(produits).forEach(produit => {
        const config = produits[produit];
        // Filtre archive: cache par defaut (coherent avec le stock inventaire).
        if (config.archived && !_showArchivedInTabs) return;
        const isArchived = !!config.archived;

        const alternatives = config.alternatives ? config.alternatives.join(', ') : '';
        const prixSpeciaux = Object.keys(config)
            .filter(key => !['prixDefault', 'alternatives', 'mode_stock', 'unite_stock', 'ventes', 'ventilation_poids', 'archived', 'categorie_affichage'].includes(key))
            .map(key => `${key}: ${config[key]}`)
            .join(', ');

        const modeStock = config.mode_stock || 'manuel';
        const uniteStock = config.unite_stock || 'unite';
        const ventilationPoids = !!config.ventilation_poids;
        const ventesCount = Array.isArray(config.ventes) ? config.ventes.length : 0;
        const escProduit = produit.replace(/'/g, "\\'");
        const ventilationCheckboxId = `ventilation-${produit.replace(/[^a-zA-Z0-9]/g, '_')}`;

        const archivedBadgeInv = isArchived
            ? `<div class="mt-1"><span class="badge bg-warning text-dark" title="Produit archivé — masqué du POS et du stock inventaire"><i class="bi bi-archive"></i> Archivé</span></div>`
            : '';
        html += `
            <tr class="${isArchived ? 'row-archived' : ''}" data-produit="${escAttr(produit)}">
                <td>
                    <input type="text" class="form-control form-control-sm" value="${produit}"
                           onchange="modifierNomProduitInventaire('${produit}', this.value, ${catParam})">
                    ${archivedBadgeInv}
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm" value="${config.prixDefault}"
                           onchange="modifierPrixInventaire('${produit}', 'prixDefault', this.value, ${catParam})">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${alternatives}"
                           placeholder="Ex: 3500,3600"
                           onchange="modifierAlternativesInventaire('${produit}', this.value, ${catParam})">
                </td>
                <td>
                    <div class="d-flex flex-column gap-1">
                        <div class="d-flex align-items-center gap-2">
                            <select class="form-select form-select-sm" style="width: 100px;"
                                    onchange="modifierModeStockInventaire('${produit}', this.value, ${catParam})">
                                <option value="manuel" ${modeStock === 'manuel' ? 'selected' : ''}>Manuel</option>
                                <option value="automatique" ${modeStock === 'automatique' ? 'selected' : ''}>Auto</option>
                            </select>
                            <select class="form-select form-select-sm" style="width: 80px;"
                                    onchange="modifierUniteStockInventaire('${produit}', this.value, ${catParam})">
                                <option value="unite" ${uniteStock === 'unite' ? 'selected' : ''}>Unité</option>
                                <option value="kilo" ${uniteStock === 'kilo' ? 'selected' : ''}>Kilo</option>
                            </select>
                        </div>
                        <div class="form-check form-check-inline" title="Saisie d'une ventilation par calibre (poids+quantité) lors des transferts">
                            <input class="form-check-input" type="checkbox" id="${ventilationCheckboxId}"
                                   ${ventilationPoids ? 'checked' : ''}
                                   onchange="modifierVentilationPoidsInventaire('${escProduit}', this.checked, ${catParam})">
                            <label class="form-check-label small" for="${ventilationCheckboxId}">Ventilation par poids</label>
                        </div>
                    </div>
                </td>
                <td>
                    <button type="button" class="btn btn-sm ${ventesCount > 0 ? 'btn-outline-success' : 'btn-outline-secondary'}"
                            onclick="gererVentesLiees('${escProduit}', ${catParam})"
                            title="Gérer les produits Généraux alimentés par cet item d'inventaire et leurs prix">
                        🔗 Gérer ${ventesCount > 0 ? `(${ventesCount})` : ''}
                    </button>
                </td>
                <td>
                    <small class="text-muted">${prixSpeciaux}</small>
                    <button class="btn btn-sm btn-outline-primary ms-1" onclick="modifierPrixSpeciauxInventaire('${produit}', ${catParam})">
                        <i class="fas fa-edit"></i>
                    </button>
                </td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="supprimerProduitInventaire('${produit}', ${catParam})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    return html;
}

// Afficher la configuration des produits d'abonnement
function afficherAbonnementConfig() {
    const container = document.getElementById('abonnement-categories');
    if (!container) return;
    
    container.innerHTML = '';
    
    Object.keys(currentAbonnementConfig).forEach((categorie, index) => {
        if (typeof currentAbonnementConfig[categorie] === 'object' && currentAbonnementConfig[categorie] !== null) {
            const nombreProduits = Object.keys(currentAbonnementConfig[categorie]).length;
            
            const categorieHtml = `
                <div class="accordion-item">
                    <h2 class="accordion-header" id="abonnement-heading-${index}">
                        <button class="accordion-button ${index === 0 ? '' : 'collapsed'}" type="button" data-bs-toggle="collapse" data-bs-target="#abonnement-collapse-${index}" aria-expanded="${index === 0 ? 'true' : 'false'}" aria-controls="abonnement-collapse-${index}">
                            <i class="fas fa-star me-2"></i>
                            ${categorie} (${nombreProduits} produits)
                            <div class="ms-auto me-3">
                                <button class="btn btn-sm btn-success" onclick="ajouterProduitAbonnementCategorie('${categorie}')" data-bs-toggle="modal" data-bs-target="#addAbonnementProductModal">
                                    <i class="fas fa-plus"></i>
                                </button>
                                ${getCategorieDeleteButton(categorie)}
                            </div>
                        </button>
                    </h2>
                    <div id="abonnement-collapse-${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" aria-labelledby="abonnement-heading-${index}" data-bs-parent="#abonnement-categories">
                        <div class="accordion-body">
                            <div class="table-responsive">
                                <table class="table table-sm">
                                    <thead>
                                        <tr>
                                            <th>Produit</th>
                                            <th>Prix Défaut</th>
                                            <th>Alternatives</th>
                                            <th>Prix Spéciaux</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${genererLignesProduitsAbonnement(categorie)}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', categorieHtml);
        }
    });
}

// Générer les lignes de produits pour une catégorie d'abonnement
function genererLignesProduitsAbonnement(categorie) {
    let html = '';
    const produits = currentAbonnementConfig[categorie];
    
    Object.keys(produits).forEach(produit => {
        const config = produits[produit];
        const alternatives = config.alternatives ? config.alternatives.join(', ') : '';
        const prixSpeciaux = Object.keys(config)
            .filter(key => !['default', 'alternatives'].includes(key))
            .map(key => `${key}: ${config[key]}`)
            .join(', ');
        
        html += `
            <tr>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${produit}" 
                           onchange="modifierNomProduitAbonnement('${categorie}', '${produit}', this.value)">
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm" value="${config.default}" 
                           onchange="modifierPrixAbonnement('${categorie}', '${produit}', 'default', this.value)">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm" value="${alternatives}" 
                           placeholder="Ex: 3500,3600"
                           onchange="modifierAlternativesAbonnement('${categorie}', '${produit}', this.value)">
                </td>
                <td>
                    <small class="text-muted">${prixSpeciaux}</small>
                    <button class="btn btn-sm btn-outline-primary ms-1" onclick="modifierPrixSpeciauxAbonnement('${categorie}', '${produit}')">
                        <i class="fas fa-edit"></i>
                    </button>
                </td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="supprimerProduitAbonnement('${categorie}', '${produit}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    return html;
}

// Fonctions de modification pour les produits généraux
function modifierNomProduit(categorie, ancienNom, nouveauNom) {
    if (nouveauNom && nouveauNom !== ancienNom) {
        const config = currentProduitsConfig[categorie][ancienNom];
        delete currentProduitsConfig[categorie][ancienNom];
        currentProduitsConfig[categorie][nouveauNom] = config;
        afficherProduitsConfig();
    }
}

function modifierPrixDefaut(categorie, produit, nouveauPrix) {
    currentProduitsConfig[categorie][produit].default = parseFloat(nouveauPrix) || 0;
}

function modifierAlternatives(categorie, produit, alternativesStr) {
    if (alternativesStr.trim()) {
        const alternatives = alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
        currentProduitsConfig[categorie][produit].alternatives = alternatives;
    } else {
        currentProduitsConfig[categorie][produit].alternatives = [];
    }
}

function modifierPrixSpeciaux(categorie, produit) {
    // Fermer tous les modals existants pour éviter les conflits
    const existingModals = document.querySelectorAll('.modal.show');
    existingModals.forEach(modal => {
        const bsModal = bootstrap.Modal.getInstance(modal);
        if (bsModal) {
            bsModal.hide();
        }
    });
    
    // Supprimer les modals de prix spéciaux existants
    const existingPrixModal = document.getElementById('prixSpeciauxModal');
    if (existingPrixModal) {
        existingPrixModal.remove();
    }
    
    // Récupérer la configuration actuelle du produit
    const config = currentProduitsConfig[categorie][produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['default', 'alternatives', 'prix_personnalise', 'inventaire_parent'].includes(key));

    // Créer le modal dynamiquement
    let modalHtml = `
        <div class="modal fade" id="prixSpeciauxModal" tabindex="-1" aria-labelledby="prixSpeciauxModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="prixSpeciauxModalLabel">Prix spéciaux pour "${produit}" (${categorie})</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label">Point de vente</label>
                                <select class="form-select" id="nouveauPointVente">
                                    <option value="">Sélectionner un point de vente</option>
                                    <!-- Les options seront chargées dynamiquement depuis points-vente.js -->
                                </select>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label">Prix</label>
                                <input type="number" class="form-control" id="nouveauPrixSpecial" placeholder="0" min="0" step="0.01">
                            </div>
                            <div class="col-md-2">
                                <label class="form-label">&nbsp;</label>
                                <button type="button" class="btn btn-success w-100" onclick="ajouterPrixSpecial('${categorie}', '${produit}')">
                                    <i class="fas fa-plus"></i> Ajouter
                                </button>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Point de Vente</th>
                                        <th>Prix</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="prixSpeciauxTableBody">
                                    <!-- Le contenu sera généré par refreshPrixSpeciauxTable -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>`;
    
    // Ajouter le nouveau modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('prixSpeciauxModal'));
    modal.show();
    
    // Remplir le tableau avec les données actuelles
    refreshPrixSpeciauxTable(categorie, produit);
    
    // Charger les points de vente dans le dropdown initial
    updatePointsVenteDropdown([]);
    
    // Nettoyer le modal quand il se ferme
    document.getElementById('prixSpeciauxModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

function ajouterPrixSpecial(categorie, produit) {
    const pointVente = document.getElementById('nouveauPointVente').value;
    const prix = parseFloat(document.getElementById('nouveauPrixSpecial').value);
    
    if (!pointVente) {
        showToast('Veuillez sélectionner un point de vente');
        return;
    }
    
    if (!prix || prix <= 0) {
        showToast('Veuillez saisir un prix valide');
        return;
    }
    
    // Vérifier si le prix spécial existe déjà
    if (currentProduitsConfig[categorie][produit][pointVente]) {
        showToast(`Un prix spécial pour "${pointVente}" existe déjà. Utilisez l'édition pour le modifier.`);
        return;
    }
    
    // Ajouter le prix spécial
    currentProduitsConfig[categorie][produit][pointVente] = prix;
    
    // Recharger seulement le tableau dans le modal
    refreshPrixSpeciauxTable(categorie, produit);
    
    // Vider les champs
    document.getElementById('nouveauPointVente').value = '';
    document.getElementById('nouveauPrixSpecial').value = '';
    
    // Recharger l'affichage principal
    afficherProduitsConfig();
}

function modifierPrixSpecialExistant(categorie, produit, pointVente, nouveauPrix) {
    const prix = parseFloat(nouveauPrix);
    if (prix && prix > 0) {
        currentProduitsConfig[categorie][produit][pointVente] = prix;
        afficherProduitsConfig();
    }
}

function refreshPrixSpeciauxTable(categorie, produit) {
    const config = currentProduitsConfig[categorie][produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['default', 'alternatives', 'prix_personnalise', 'inventaire_parent'].includes(key));
    
    const tbody = document.getElementById('prixSpeciauxTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    prixSpeciaux.forEach(pointVente => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${pointVente}</td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${config[pointVente]}" 
                       onchange="modifierPrixSpecialExistant('${categorie}', '${produit}', '${pointVente}', this.value)">
            </td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="supprimerPrixSpecial('${categorie}', '${produit}', '${pointVente}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    // Mettre à jour les options du dropdown pour exclure les points de vente déjà utilisés
    updatePointsVenteDropdown(prixSpeciaux);
}

// Fonction pour mettre à jour le dropdown des points de vente
async function updatePointsVenteDropdown(prixSpeciauxExistants = []) {
    const dropdown = document.getElementById('nouveauPointVente');
    if (!dropdown) return;
    
    try {
        const response = await fetch('/api/admin/points-vente', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.error('Erreur lors du chargement des points de vente');
            return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.pointsVente) {
            console.error('Format de réponse invalide pour les points de vente');
            return;
        }
        
        // Vider le dropdown
        dropdown.innerHTML = '<option value="">Sélectionner un point de vente</option>';
        
        // Filtrer seulement les points de vente actifs
        const pointsVenteActifs = Object.entries(data.pointsVente)
            .filter(([nom, config]) => config.active === true)
            .map(([nom]) => nom)
            .sort(); // Trier alphabétiquement
        
        // Ajouter les options pour les points de vente actifs non encore utilisés
        pointsVenteActifs.forEach(pointVente => {
            if (!prixSpeciauxExistants.includes(pointVente)) {
                const option = document.createElement('option');
                option.value = pointVente;
                option.textContent = pointVente === 'Sacre Coeur' ? 'Sacré Coeur' : pointVente;
                dropdown.appendChild(option);
            }
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

async function supprimerPrixSpecial(categorie, produit, pointVente) {
    const ok1 = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer le prix spécial pour "${pointVente}" ?`, {
        title: 'Supprimer prix spécial', okLabel: 'Oui', okVariant: 'warning'
    });
    if (!ok1) return;
    const ok2 = await showConfirmModal(`Cette suppression est définitive. Confirmer la suppression du prix spécial pour "${pointVente}" ?`, {
        title: 'Confirmer suppression définitive', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (!ok2) return;
    delete currentProduitsConfig[categorie][produit][pointVente];
    refreshPrixSpeciauxTable(categorie, produit);
    afficherProduitsConfig();
}

async function supprimerProduit(categorie, produit) {
    const ok = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer le produit "${produit}" ?`, {
        title: 'Supprimer le produit', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (ok) {
        try {
            const response = await fetch(`/api/admin/config/produits/by-name?nom=${encodeURIComponent(produit)}&type_catalogue=vente`, {
                method: 'DELETE',
                credentials: 'include'
            });

            const data = await response.json();

            if (data.success) {
                showToast(`Produit "${produit}" supprimé avec succès`);
                // Recharger depuis le serveur pour confirmer la suppression
                await chargerConfigProduits();
            } else {
                showToast(`Erreur: ${data.error}`);
            }
        } catch (error) {
            console.error('Erreur suppression produit:', error);
            showToast('Erreur lors de la suppression du produit');
        }
    }
}

async function supprimerCategorie(categorie) {
    // Protection pour les catégories principales - ne pas permettre leur suppression
    const categoriesPrincipales = ['Bovin', 'Ovin', 'Volaille', 'Pack', 'Caprin', 'Autres'];
    
    if (categoriesPrincipales.includes(categorie)) {
        showToast(`La catégorie "${categorie}" est une catégorie principale du système et ne peut pas être supprimée. Vous pouvez seulement supprimer des produits individuels.`);
        return;
    }
    
    const nombreProduits = Object.keys(currentProduitsConfig[categorie]).length;
    const ok1 = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer la catégorie "${categorie}" et ses ${nombreProduits} produits ?`, {
        title: 'Supprimer catégorie', okLabel: 'Continuer', okVariant: 'warning'
    });
    if (!ok1) return;
    const ok2 = await showConfirmModal(`Cette suppression est définitive et supprimera TOUS les produits de la catégorie "${categorie}". Confirmer la suppression définitive ?`, {
        title: 'Confirmer suppression définitive', okLabel: 'Supprimer tout', okVariant: 'danger'
    });
    if (!ok2) return;
    delete currentProduitsConfig[categorie];
    afficherProduitsConfig();
}

function ajouterProduitCategorie(categorie) {
    document.getElementById('productModalCategory').value = categorie;
    document.getElementById('addProductModalLabel').textContent = `Ajouter un produit à ${categorie}`;
}

// Fonctions pour l'inventaire
function ajouterProduitInventaireCategorie(categorie) {
    document.getElementById('inventaireProductModalCategory').value = categorie;
    document.getElementById('addInventaireProductModalLabel').textContent = `Ajouter un produit à ${categorie}`;
}

async function supprimerCategorieInventaire(categorie) {
    // Protection pour les catégories d'inventaire logiques - ne pas permettre leur suppression
    const categoriesInventairePrincipales = ['Viandes', 'Œufs et Produits Laitiers', 'Abats et Sous-produits', 'Produits sur Pieds', 'Déchets', 'Autres'];
    
    if (categoriesInventairePrincipales.includes(categorie)) {
        showToast(`La catégorie "${categorie}" est une catégorie logique du système d'inventaire et ne peut pas être supprimée. Vous pouvez seulement supprimer des produits individuels.`);
        return;
    }
    
    // Vérifier si c'est une catégorie personnalisée
    const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
    
    if (categoriesPersonnalisees.includes(categorie)) {
        const ok = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer la catégorie personnalisée "${categorie}" et tous ses produits ?`, {
            title: 'Supprimer catégorie', okLabel: 'Supprimer', okVariant: 'danger'
        });
        if (ok) {
            delete currentInventaireConfig[categorie];

            const index = categoriesPersonnalisees.indexOf(categorie);
            if (index > -1) {
                categoriesPersonnalisees.splice(index, 1);
                localStorage.setItem('inventaireCategoriesPersonnalisees', JSON.stringify(categoriesPersonnalisees));
            }

            afficherInventaireConfig();
            showToast(`Catégorie "${categorie}" supprimée avec succès!`);
        }
        return;
    }
    
    // Pour l'inventaire, on ne peut pas vraiment supprimer les catégories car elles sont logiques
    // mais on peut supprimer tous les produits de la catégorie
    const inventaireParCategories = reorganiserInventaireParCategories();
    const produits = inventaireParCategories[categorie];
    const nombreProduits = Object.keys(produits).length;
    
    const okA = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer tous les ${nombreProduits} produits de la catégorie "${categorie}" ?`, {
        title: 'Supprimer produits', okLabel: 'Continuer', okVariant: 'warning'
    });
    if (!okA) return;
    const okB = await showConfirmModal(`Cette suppression est définitive et supprimera TOUS les produits de la catégorie "${categorie}". Confirmer la suppression définitive ?`, {
        title: 'Confirmer suppression définitive', okLabel: 'Supprimer tout', okVariant: 'danger'
    });
    if (!okB) return;
    Object.keys(produits).forEach(produit => {
        delete currentInventaireConfig[produit];
    });
    afficherInventaireConfig();
}

function modifierPrixSpeciauxInventaire(produit) {
    // Fermer tous les modals existants pour éviter les conflits
    const existingModals = document.querySelectorAll('.modal.show');
    existingModals.forEach(modal => {
        const bsModal = bootstrap.Modal.getInstance(modal);
        if (bsModal) {
            bsModal.hide();
        }
    });
    
    // Supprimer les modals de prix spéciaux existants
    const existingPrixModal = document.getElementById('prixSpeciauxInventaireModal');
    if (existingPrixModal) {
        existingPrixModal.remove();
    }
    
    // Récupérer la configuration actuelle du produit
    const config = currentInventaireConfig[produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['prixDefault', 'alternatives', 'mode_stock', 'unite_stock', 'ventes', 'ventilation_poids'].includes(key));
    // ventilation_poids est un flag booleen, pas un prix par PV: l'exclure
    // empeche son affichage parasite dans la liste des prix speciaux.

    // Créer le modal dynamiquement
    let modalHtml = `
        <div class="modal fade" id="prixSpeciauxInventaireModal" tabindex="-1" aria-labelledby="prixSpeciauxInventaireModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="prixSpeciauxInventaireModalLabel">Prix spéciaux pour "${produit}" (Inventaire)</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label">Point de vente</label>
                                <select class="form-select" id="nouveauPointVenteInventaire">
                                    <option value="">Sélectionner un point de vente</option>
                                    <!-- Les options seront chargées dynamiquement depuis points-vente.js -->
                                </select>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label">Prix</label>
                                <input type="number" class="form-control" id="nouveauPrixSpecialInventaire" placeholder="0" min="0" step="0.01">
                            </div>
                            <div class="col-md-2">
                                <label class="form-label">&nbsp;</label>
                                <button type="button" class="btn btn-success w-100" onclick="ajouterPrixSpecialInventaire('${produit}')">
                                    <i class="fas fa-plus"></i> Ajouter
                                </button>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Point de Vente</th>
                                        <th>Prix</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="prixSpeciauxInventaireTableBody">
                                    <!-- Le contenu sera généré par refreshPrixSpeciauxInventaireTable -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>`;
    
    // Ajouter le nouveau modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('prixSpeciauxInventaireModal'));
    modal.show();
    
    // Remplir le tableau avec les données actuelles
    refreshPrixSpeciauxInventaireTable(produit);
    
    // Charger les points de vente dans le dropdown initial
    updatePointsVenteDropdownInventaire([]);
    
    // Nettoyer le modal quand il se ferme
    document.getElementById('prixSpeciauxInventaireModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });
}

function refreshPrixSpeciauxInventaireTable(produit) {
    const config = currentInventaireConfig[produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['prixDefault', 'alternatives', 'mode_stock', 'unite_stock', 'ventes', 'ventilation_poids'].includes(key));
    
    const tbody = document.getElementById('prixSpeciauxInventaireTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    prixSpeciaux.forEach(pointVente => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${pointVente}</td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${config[pointVente]}" 
                       onchange="modifierPrixSpecialExistantInventaire('${produit}', '${pointVente}', this.value)">
            </td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="supprimerPrixSpecialInventaire('${produit}', '${pointVente}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    // Mettre à jour les options du dropdown pour exclure les points de vente déjà utilisés
    updatePointsVenteDropdownInventaire(prixSpeciaux);
}

async function updatePointsVenteDropdownInventaire(prixSpeciauxExistants = []) {
    const dropdown = document.getElementById('nouveauPointVenteInventaire');
    if (!dropdown) return;
    
    try {
        const response = await fetch('/api/admin/points-vente', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.error('Erreur lors du chargement des points de vente');
            return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.pointsVente) {
            console.error('Format de réponse invalide pour les points de vente');
            return;
        }
        
        // Vider le dropdown
        dropdown.innerHTML = '<option value="">Sélectionner un point de vente</option>';
        
        // Filtrer seulement les points de vente actifs
        const pointsVenteActifs = Object.entries(data.pointsVente)
            .filter(([nom, config]) => config.active === true)
            .map(([nom]) => nom)
            .sort(); // Trier alphabétiquement
        
        // Ajouter les options pour les points de vente actifs non encore utilisés
        pointsVenteActifs.forEach(pointVente => {
            if (!prixSpeciauxExistants.includes(pointVente)) {
                const option = document.createElement('option');
                option.value = pointVente;
                option.textContent = pointVente === 'Sacre Coeur' ? 'Sacré Coeur' : pointVente;
                dropdown.appendChild(option);
            }
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

function ajouterPrixSpecialInventaire(produit) {
    const pointVente = document.getElementById('nouveauPointVenteInventaire').value;
    const prix = parseFloat(document.getElementById('nouveauPrixSpecialInventaire').value);
    
    if (!pointVente) {
        showToast('Veuillez sélectionner un point de vente');
        return;
    }
    
    if (!prix || prix <= 0) {
        showToast('Veuillez saisir un prix valide');
        return;
    }
    
    // Vérifier si le prix spécial existe déjà
    if (currentInventaireConfig[produit][pointVente]) {
        showToast(`Un prix spécial pour "${pointVente}" existe déjà. Utilisez l'édition pour le modifier.`);
        return;
    }
    
    // Ajouter le prix spécial
    currentInventaireConfig[produit][pointVente] = prix;
    
    // Recharger seulement le tableau dans le modal
    refreshPrixSpeciauxInventaireTable(produit);
    
    // Vider les champs
    document.getElementById('nouveauPointVenteInventaire').value = '';
    document.getElementById('nouveauPrixSpecialInventaire').value = '';
    
    // Recharger l'affichage principal
    afficherInventaireConfig();
}

function modifierPrixSpecialExistantInventaire(produit, pointVente, nouveauPrix) {
    const prix = parseFloat(nouveauPrix);
    if (prix && prix > 0) {
        currentInventaireConfig[produit][pointVente] = prix;
        afficherInventaireConfig();
    }
}

async function supprimerPrixSpecialInventaire(produit, pointVente) {
    const ok1 = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer le prix spécial pour "${pointVente}" ?`, {
        title: 'Supprimer prix spécial', okLabel: 'Oui', okVariant: 'warning'
    });
    if (!ok1) return;
    const ok2 = await showConfirmModal(`Cette suppression est définitive. Confirmer la suppression du prix spécial pour "${pointVente}" ?`, {
        title: 'Confirmer suppression définitive', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (!ok2) return;
    delete currentInventaireConfig[produit][pointVente];
    refreshPrixSpeciauxInventaireTable(produit);
    afficherInventaireConfig();
}

// Fonctions de modification pour les produits d'inventaire
function modifierNomProduitInventaire(ancienNom, nouveauNom, categorie = null) {
    if (nouveauNom && nouveauNom !== ancienNom) {
        if (categorie && currentInventaireConfig[categorie]) {
            // Produit dans une catégorie personnalisée
            const config = currentInventaireConfig[categorie][ancienNom];
            delete currentInventaireConfig[categorie][ancienNom];
            currentInventaireConfig[categorie][nouveauNom] = config;
        } else {
            // Produit au niveau racine
            const config = currentInventaireConfig[ancienNom];
            delete currentInventaireConfig[ancienNom];
            currentInventaireConfig[nouveauNom] = config;
        }
        afficherInventaireConfig();
    }
}

function modifierPrixInventaire(produit, champ, nouveauPrix, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        if (nouveauPrix) {
            config[champ] = parseFloat(nouveauPrix);
        } else {
            delete config[champ];
        }
    }
}

function modifierAlternativesInventaire(produit, alternativesStr, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        if (alternativesStr.trim()) {
            const alternatives = alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
            config.alternatives = alternatives;
        } else {
            config.alternatives = [];
        }
    }
}

// Réattache un produit de vente à son parent inventaire et resynchronise le prix.
// Appelle POST /api/admin/config/produits/:nom/reattach puis recharge la table.
async function reattacherProduitVente(produit) {
    const ok = await showConfirmModal(`Réattacher "${produit}" à son parent inventaire ?\n\nLe prix sera resynchronisé depuis le parent et les futures mises à jour du parent se propageront à nouveau.`, {
        title: 'Réattacher', okLabel: 'Réattacher'
    });
    if (!ok) {
        return;
    }
    try {
        const response = await fetch(`/api/admin/config/produits/${encodeURIComponent(produit)}/reattach`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.success) {
            showToast(data.message || 'Réattachement réussi.');
            await chargerConfigProduits();
        } else {
            showToast(`Erreur: ${data.error || 'échec du réattachement'}`);
        }
    } catch (error) {
        console.error('Erreur réattachement:', error);
        showToast('Erreur réseau lors du réattachement.');
    }
}

// Flag levé quand l'admin modifie un prix vente depuis le modal "Gérer ventes liées"
// de l'onglet Inventaire. Utilisé par sauvegarderConfigInventaire pour aussi
// pousser les changements vers POST /produits, sans que l'admin ait à basculer
// d'onglet.
let venteConfigModifieeDepuisInventaire = false;

// Met à jour la liste des produits vente alimentés par ce produit d'inventaire.
// Format saisi: noms séparés par virgules (ex: "Boeuf en gros, Boeuf en détail").
// Le serveur déclenchera la propagation du prix lors du Sauvegarder.
function modifierVentesInventaire(produit, ventesStr, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        const noms = (ventesStr || '')
            .split(',')
            .map((n) => n.trim())
            .filter((n) => n.length > 0);
        config.ventes = noms;
    }
}

// Aplatit currentProduitsConfig en liste {nom, categorie, config}.
// Utilisée par le modal de gestion pour autocompléter les noms et accéder aux prix.
function listerProduitsVente() {
    const out = [];
    if (!currentProduitsConfig || typeof currentProduitsConfig !== 'object') return out;
    for (const [cat, produits] of Object.entries(currentProduitsConfig)) {
        if (typeof produits !== 'object' || produits === null) continue;
        for (const [nom, conf] of Object.entries(produits)) {
            if (typeof conf === 'object' && conf !== null && conf.default !== undefined) {
                out.push({ nom, categorie: cat, config: conf });
            }
        }
    }
    return out;
}

function trouverConfigProduitVente(nomVente) {
    for (const [cat, produits] of Object.entries(currentProduitsConfig || {})) {
        if (produits && typeof produits === 'object' && produits[nomVente]) {
            return { categorie: cat, config: produits[nomVente] };
        }
    }
    return null;
}

// Modal: gère la liste des produits vente liés à un produit d'inventaire,
// avec édition de leur prix par défaut directement depuis cet écran.
async function gererVentesLiees(produitInventaire, categorieInv = null) {
    // S'assurer que la config vente est chargée (l'admin peut être resté sur l'onglet
    // inventaire sans l'avoir ouverte).
    if (!currentProduitsConfig || Object.keys(currentProduitsConfig).length === 0) {
        await chargerConfigProduits();
    }

    const inv = trouverConfigProduitInventaire(produitInventaire, categorieInv);
    if (!inv) {
        showToast(`Produit inventaire introuvable: ${produitInventaire}`);
        return;
    }
    if (!Array.isArray(inv.ventes)) inv.ventes = [];

    // Nettoyer un éventuel modal précédent
    const old = document.getElementById('gererVentesModal');
    if (old) old.remove();

    const datalistOptions = listerProduitsVente()
        .map((p) => `<option value="${p.nom.replace(/"/g, '&quot;')}">${p.categorie}</option>`)
        .join('');

    const modalHtml = `
        <div class="modal fade" id="gererVentesModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-lg">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Ventes liées à "${produitInventaire}" (Inventaire)</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">
                <p class="text-muted small mb-3">
                  Les produits ci-dessous reçoivent automatiquement le prix de "${produitInventaire}"
                  tant qu'ils ne sont pas détachés. Modifier un prix ici revient au même que dans
                  l'onglet "Produits Généraux" — l'enregistrement se fera quand vous cliquerez
                  <strong>Sauvegarder</strong> en bas du modal ou sur le bouton principal de l'onglet.
                </p>

                <div class="row g-2 mb-3">
                  <div class="col-md-8">
                    <label class="form-label">Ajouter un produit vente lié</label>
                    <input list="ventesAvailableList" class="form-control" id="newVenteLinkName"
                           placeholder="Tapez ou choisissez un nom de produit Généraux">
                    <datalist id="ventesAvailableList">${datalistOptions}</datalist>
                  </div>
                  <div class="col-md-4 d-flex align-items-end">
                    <button class="btn btn-success w-100" onclick="ajouterVenteLien('${produitInventaire.replace(/'/g, "\\'")}', ${categorieInv ? `'${categorieInv}'` : 'null'})">
                      <i class="fas fa-plus"></i> Ajouter
                    </button>
                  </div>
                </div>

                <div class="table-responsive">
                  <table class="table table-sm align-middle">
                    <thead>
                      <tr>
                        <th>Produit Généraux</th>
                        <th style="width: 130px;">Prix Défaut</th>
                        <th>État</th>
                        <th style="width: 200px;">Actions</th>
                      </tr>
                    </thead>
                    <tbody id="gererVentesBody"></tbody>
                  </table>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                <button type="button" class="btn btn-primary" id="gererVentesSaveBtn"
                        onclick="sauvegarderDepuisGererVentes('${produitInventaire.replace(/'/g, "\\'")}', ${categorieInv ? `'${categorieInv}'` : 'null'})">
                  <i class="fas fa-save"></i> Sauver
                </button>
              </div>
            </div>
          </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = new bootstrap.Modal(document.getElementById('gererVentesModal'));
    modal.show();
    document.getElementById('gererVentesModal').addEventListener('hidden.bs.modal', function() {
        this.remove();
    });

    refreshGererVentesBody(produitInventaire, categorieInv);
}

function refreshGererVentesBody(produitInventaire, categorieInv = null) {
    const inv = trouverConfigProduitInventaire(produitInventaire, categorieInv);
    const tbody = document.getElementById('gererVentesBody');
    if (!inv || !tbody) return;
    if (!Array.isArray(inv.ventes) || inv.ventes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Aucun produit vente lié — utilisez le formulaire au-dessus pour en ajouter.</td></tr>`;
        // Refresh la cellule "Gérer (N)" dans le tableau principal
        afficherInventaireConfig();
        return;
    }
    let html = '';
    for (const nomVente of inv.ventes) {
        const found = trouverConfigProduitVente(nomVente);
        const escNom = nomVente.replace(/'/g, "\\'");
        const escInv = produitInventaire.replace(/'/g, "\\'");
        const catArg = categorieInv ? `'${categorieInv}'` : 'null';
        if (!found) {
            html += `
                <tr>
                  <td>${nomVente} <small class="text-danger">(introuvable dans Produits Généraux)</small></td>
                  <td>—</td>
                  <td><span class="badge bg-danger">manquant</span></td>
                  <td>
                    <button class="btn btn-sm btn-outline-danger" onclick="retirerVenteLien('${escInv}', '${escNom}', ${catArg})">Retirer</button>
                  </td>
                </tr>
            `;
            continue;
        }
        const detache = !!found.config.prix_personnalise;
        const stateBadge = detache
            ? `<span class="badge bg-warning text-dark">🔒 prix personnalisé</span>`
            : `<span class="badge bg-info text-dark">🔗 hérité</span>`;
        const reattachBtn = detache
            ? `<button class="btn btn-sm btn-outline-success" title="Resynchroniser depuis le parent" onclick="reattacherDepuisModal('${escNom}', '${escInv}', ${catArg})">🔗 Réattacher</button>`
            : '';
        html += `
            <tr>
              <td><strong>${nomVente}</strong> <small class="text-muted">— ${found.categorie}</small></td>
              <td>
                <input type="number" class="form-control form-control-sm" value="${found.config.default}"
                       oninput="modifierPrixVenteDepuisInventaire('${found.categorie.replace(/'/g, "\\'")}', '${escNom}', this.value)">
              </td>
              <td>${stateBadge}</td>
              <td>
                ${reattachBtn}
                <button class="btn btn-sm btn-outline-danger ms-1" title="Retirer le lien (le produit Généraux reste mais n'est plus lié)" onclick="retirerVenteLien('${escInv}', '${escNom}', ${catArg})">Retirer</button>
              </td>
            </tr>
        `;
    }
    tbody.innerHTML = html;
}

async function ajouterVenteLien(produitInventaire, categorieInv = null) {
    const input = document.getElementById('newVenteLinkName');
    if (!input) return;
    const nom = (input.value || '').trim();
    if (!nom) {
        showToast('Tapez ou choisissez un nom de produit vente.');
        return;
    }
    const found = trouverConfigProduitVente(nom);
    if (!found) {
        const ok = await showConfirmModal(`"${nom}" n'existe pas encore dans Produits Généraux. Le lien sera créé mais le produit devra être ajouté côté Généraux pour que la propagation fonctionne. Continuer ?`, {
            title: 'Produit non encore créé', okLabel: 'Continuer'
        });
        if (!ok) {
            return;
        }
    }
    const inv = trouverConfigProduitInventaire(produitInventaire, categorieInv);
    if (!inv) return;
    if (!Array.isArray(inv.ventes)) inv.ventes = [];
    if (inv.ventes.includes(nom)) {
        showToast(`"${nom}" est déjà lié.`);
        return;
    }
    inv.ventes.push(nom);
    input.value = '';
    refreshGererVentesBody(produitInventaire, categorieInv);
}

function retirerVenteLien(produitInventaire, nomVente, categorieInv = null) {
    const inv = trouverConfigProduitInventaire(produitInventaire, categorieInv);
    if (!inv || !Array.isArray(inv.ventes)) return;
    inv.ventes = inv.ventes.filter((n) => n !== nomVente);
    refreshGererVentesBody(produitInventaire, categorieInv);
}

function modifierPrixVenteDepuisInventaire(categorie, nomVente, nouveauPrix) {
    if (!currentProduitsConfig[categorie] || !currentProduitsConfig[categorie][nomVente]) return;
    const prix = parseFloat(nouveauPrix);
    if (isNaN(prix)) return;
    currentProduitsConfig[categorie][nomVente].default = prix;
    venteConfigModifieeDepuisInventaire = true;
}

// Sauve l'état courant (prix vente + mapping inventaire) sans fermer le modal,
// puis recharge les deux configs et rafraîchit la table pour que les badges
// (🔗 hérité / 🔒 prix personnalisé) reflètent la nouvelle réalité serveur.
async function sauvegarderDepuisGererVentes(produitInventaire, categorieInv = null) {
    const btn = document.getElementById('gererVentesSaveBtn');
    const original = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Sauvegarde...';
    }
    try {
        // Filet de sécurité: relire les inputs du modal au moment du clic, au cas où
        // oninput n'aurait pas pu se déclencher (focus encore sur l'input quand on clique).
        const tbody = document.getElementById('gererVentesBody');
        if (tbody) {
            tbody.querySelectorAll('input[type="number"][oninput]').forEach((input) => {
                const match = (input.getAttribute('oninput') || '').match(/modifierPrixVenteDepuisInventaire\('([^']+)',\s*'([^']+)'/);
                if (match) {
                    const cat = match[1].replace(/\\'/g, "'");
                    const nom = match[2].replace(/\\'/g, "'");
                    if (currentProduitsConfig[cat] && currentProduitsConfig[cat][nom]) {
                        const v = parseFloat(input.value);
                        if (!isNaN(v)) {
                            currentProduitsConfig[cat][nom].default = v;
                            venteConfigModifieeDepuisInventaire = true;
                        }
                    }
                }
            });
        }
        // Toujours pousser produits d'abord pour que le serveur détache (prix_personnalise=true)
        // les enfants modifiés AVANT que la propagation inventaire les ré-écrase.
        const venteResp = await fetch('/api/admin/config/produits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ produits: currentProduitsConfig })
        });
        const venteData = await venteResp.json();
        if (!venteData.success) {
            showToast(`Erreur sauvegarde produits: ${venteData.error || venteData.message}`);
            return;
        }
        venteConfigModifieeDepuisInventaire = false;

        const invResp = await fetch('/api/admin/config/produits-inventaire', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ produitsInventaire: currentInventaireConfig })
        });
        const invData = await invResp.json();
        if (!invData.success) {
            showToast(`Erreur sauvegarde inventaire: ${invData.error || invData.message}`);
            return;
        }

        // Recharger les deux configs depuis le serveur pour récupérer prix_personnalise
        // et les éventuels prix propagés.
        await Promise.all([chargerConfigProduits(), chargerConfigInventaire()]);
        refreshGererVentesBody(produitInventaire, categorieInv);
    } catch (e) {
        console.error('sauvegarderDepuisGererVentes:', e);
        showToast('Erreur réseau lors de la sauvegarde.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }
}

async function reattacherDepuisModal(nomVente, produitInventaire, categorieInv = null) {
    const ok = await showConfirmModal(`Réattacher "${nomVente}" à "${produitInventaire}" ?\n\nLe prix sera resynchronisé depuis le parent inventaire.`, {
        title: 'Réattacher', okLabel: 'Réattacher'
    });
    if (!ok) {
        return;
    }
    try {
        const response = await fetch(`/api/admin/config/produits/${encodeURIComponent(nomVente)}/reattach`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (!data.success) {
            showToast(`Erreur: ${data.error || 'échec'}`);
            return;
        }
        // Recharger la config produits pour refléter le prix resynchronisé
        await chargerConfigProduits();
        refreshGererVentesBody(produitInventaire, categorieInv);
    } catch (e) {
        console.error('reattacherDepuisModal:', e);
        showToast('Erreur réseau.');
    }
}

function modifierModeStockInventaire(produit, modeStock, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        config.mode_stock = modeStock;
        // Si on passe en mode manuel, désactiver le sélecteur d'unité
        afficherInventaireConfig();
    }
}

function modifierUniteStockInventaire(produit, uniteStock, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        config.unite_stock = uniteStock;
    }
}

function modifierVentilationPoidsInventaire(produit, ventilation, categorie = null) {
    const config = trouverConfigProduitInventaire(produit, categorie);
    if (config) {
        config.ventilation_poids = !!ventilation;
    }
}

// Fonction helper pour trouver la config d'un produit (dans catégorie perso ou racine)
function trouverConfigProduitInventaire(produit, categorie = null) {
    // Si une catégorie est spécifiée
    if (categorie && currentInventaireConfig[categorie] && currentInventaireConfig[categorie][produit]) {
        return currentInventaireConfig[categorie][produit];
    }
    
    // Chercher au niveau racine
    if (currentInventaireConfig[produit] && currentInventaireConfig[produit].prixDefault !== undefined) {
        return currentInventaireConfig[produit];
    }
    
    // Chercher dans les catégories personnalisées
    const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
    for (const cat of categoriesPersonnalisees) {
        if (currentInventaireConfig[cat] && currentInventaireConfig[cat][produit]) {
            return currentInventaireConfig[cat][produit];
        }
    }
    
    return null;
}

async function supprimerProduitInventaire(produit, categorie = null) {
    const ok = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer le produit d'inventaire "${produit}" ?`, {
        title: 'Supprimer produit inventaire', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (ok) {
        try {
            const response = await fetch(`/api/admin/config/produits/by-name?nom=${encodeURIComponent(produit)}&type_catalogue=inventaire`, {
                method: 'DELETE',
                credentials: 'include'
            });

            const data = await response.json();

            if (data.success) {
                showToast(`Produit d'inventaire "${produit}" supprimé avec succès`);
                await chargerConfigInventaire();
            } else {
                showToast(`Erreur: ${data.error}`);
            }
        } catch (error) {
            console.error('Erreur suppression produit inventaire:', error);
            showToast('Erreur lors de la suppression du produit');
        }
    }
}

// Fonctions de modification pour les produits d'abonnement
function modifierNomProduitAbonnement(categorie, ancienNom, nouveauNom) {
    if (nouveauNom && nouveauNom !== ancienNom) {
        const config = currentAbonnementConfig[categorie][ancienNom];
        delete currentAbonnementConfig[categorie][ancienNom];
        currentAbonnementConfig[categorie][nouveauNom] = config;
        afficherAbonnementConfig();
    }
}

function modifierPrixAbonnement(categorie, produit, champ, nouveauPrix) {
    currentAbonnementConfig[categorie][produit][champ] = parseFloat(nouveauPrix) || 0;
}

function modifierAlternativesAbonnement(categorie, produit, alternativesStr) {
    if (alternativesStr.trim()) {
        const alternatives = alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
        currentAbonnementConfig[categorie][produit].alternatives = alternatives;
    } else {
        currentAbonnementConfig[categorie][produit].alternatives = [];
    }
}

function modifierPrixSpeciauxAbonnement(categorie, produit) {
    // Fermer tous les modals existants pour éviter les conflits
    const existingModals = document.querySelectorAll('.modal.show');
    existingModals.forEach(modal => {
        const bsModal = bootstrap.Modal.getInstance(modal);
        if (bsModal) {
            bsModal.hide();
        }
    });
    
    // Supprimer les modals de prix spéciaux existants
    const existingPrixModal = document.getElementById('prixSpeciauxAbonnementModal');
    if (existingPrixModal) {
        existingPrixModal.remove();
    }
    
    // Récupérer la configuration actuelle du produit
    const config = currentAbonnementConfig[categorie][produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['default', 'alternatives'].includes(key));
    
    // Créer le modal dynamiquement
    let modalHtml = `
        <div class="modal fade" id="prixSpeciauxAbonnementModal" tabindex="-1" aria-labelledby="prixSpeciauxAbonnementModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="prixSpeciauxAbonnementModalLabel">Prix spéciaux pour "${produit}" (${categorie})</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <label class="form-label">Point de vente</label>
                                <select class="form-select" id="nouveauPointVenteAbonnement">
                                    <option value="">Sélectionner un point de vente</option>
                                </select>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label">Prix</label>
                                <input type="number" class="form-control" id="nouveauPrixSpecialAbonnement" placeholder="0" min="0" step="0.01">
                            </div>
                            <div class="col-md-2">
                                <label class="form-label">&nbsp;</label>
                                <button type="button" class="btn btn-success w-100" onclick="ajouterPrixSpecialAbonnement('${categorie}', '${produit}')">
                                    <i class="fas fa-plus"></i> Ajouter
                                </button>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Point de Vente</th>
                                        <th>Prix</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="prixSpeciauxAbonnementTableBody">
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Fermer</button>
                    </div>
                </div>
            </div>
        </div>`;
    
    // Ajouter le nouveau modal au DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Afficher le modal
    const modal = new bootstrap.Modal(document.getElementById('prixSpeciauxAbonnementModal'));
    modal.show();
    
    // Rafraîchir le tableau
    refreshPrixSpeciauxAbonnementTable(categorie, produit);
}

function refreshPrixSpeciauxAbonnementTable(categorie, produit) {
    const tbody = document.getElementById('prixSpeciauxAbonnementTableBody');
    if (!tbody) return;
    
    // Vider le tableau
    tbody.innerHTML = '';
    
    // Récupérer la configuration actuelle
    const config = currentAbonnementConfig[categorie][produit];
    const prixSpeciaux = Object.keys(config)
        .filter(key => !['default', 'alternatives'].includes(key));
    
    // Si aucun prix spécial, afficher un message
    if (prixSpeciaux.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">Aucun prix spécial défini</td></tr>';
        updatePointsVenteDropdownAbonnement([]);
        return;
    }
    
    // Ajouter chaque prix spécial au tableau
    prixSpeciaux.forEach(pointVente => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${pointVente}</td>
            <td>
                <input type="number" class="form-control form-control-sm" value="${config[pointVente]}" 
                       onchange="modifierPrixSpecialExistantAbonnement('${categorie}', '${produit}', '${pointVente}', this.value)">
            </td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="supprimerPrixSpecialAbonnement('${categorie}', '${produit}', '${pointVente}')">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    
    // Mettre à jour les options du dropdown pour exclure les points de vente déjà utilisés
    updatePointsVenteDropdownAbonnement(prixSpeciaux);
}

async function updatePointsVenteDropdownAbonnement(prixSpeciauxExistants = []) {
    const dropdown = document.getElementById('nouveauPointVenteAbonnement');
    if (!dropdown) return;
    
    try {
        const response = await fetch('/api/admin/points-vente', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.error('Erreur lors du chargement des points de vente');
            return;
        }
        
        const data = await response.json();
        
        if (!data.success || !data.pointsVente) {
            console.error('Format de réponse invalide pour les points de vente');
            return;
        }
        
        // Vider le dropdown
        dropdown.innerHTML = '<option value="">Sélectionner un point de vente</option>';
        
        // Filtrer seulement les points de vente actifs
        const pointsVenteActifs = Object.entries(data.pointsVente)
            .filter(([nom, config]) => config.active === true)
            .map(([nom]) => nom)
            .sort(); // Trier alphabétiquement
        
        // Ajouter les options pour les points de vente actifs non encore utilisés
        pointsVenteActifs.forEach(pointVente => {
            if (!prixSpeciauxExistants.includes(pointVente)) {
                const option = document.createElement('option');
                option.value = pointVente;
                option.textContent = pointVente === 'Sacre Coeur' ? 'Sacré Coeur' : pointVente;
                dropdown.appendChild(option);
            }
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement des points de vente:', error);
    }
}

function ajouterPrixSpecialAbonnement(categorie, produit) {
    const pointVente = document.getElementById('nouveauPointVenteAbonnement').value;
    const prix = parseFloat(document.getElementById('nouveauPrixSpecialAbonnement').value);
    
    if (!pointVente) {
        showToast('Veuillez sélectionner un point de vente');
        return;
    }
    
    if (!prix || prix <= 0) {
        showToast('Veuillez saisir un prix valide');
        return;
    }
    
    // Vérifier si le prix spécial existe déjà
    if (currentAbonnementConfig[categorie][produit][pointVente]) {
        showToast(`Un prix spécial pour "${pointVente}" existe déjà. Utilisez l'édition pour le modifier.`);
        return;
    }
    
    // Ajouter le prix spécial
    currentAbonnementConfig[categorie][produit][pointVente] = prix;
    
    // Recharger seulement le tableau dans le modal
    refreshPrixSpeciauxAbonnementTable(categorie, produit);
    
    // Vider les champs
    document.getElementById('nouveauPointVenteAbonnement').value = '';
    document.getElementById('nouveauPrixSpecialAbonnement').value = '';
    
    // Recharger l'affichage principal
    afficherAbonnementConfig();
}

function modifierPrixSpecialExistantAbonnement(categorie, produit, pointVente, nouveauPrix) {
    const prix = parseFloat(nouveauPrix);
    if (prix && prix > 0) {
        currentAbonnementConfig[categorie][produit][pointVente] = prix;
        afficherAbonnementConfig();
    }
}

async function supprimerPrixSpecialAbonnement(categorie, produit, pointVente) {
    const ok1 = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer le prix spécial pour "${pointVente}" ?`, {
        title: 'Supprimer prix spécial', okLabel: 'Oui', okVariant: 'warning'
    });
    if (!ok1) return;
    const ok2 = await showConfirmModal(`Cette suppression est définitive. Confirmer la suppression du prix spécial pour "${pointVente}" ?`, {
        title: 'Confirmer suppression définitive', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (!ok2) return;
    delete currentAbonnementConfig[categorie][produit][pointVente];
    refreshPrixSpeciauxAbonnementTable(categorie, produit);
    afficherAbonnementConfig();
}

async function supprimerProduitAbonnement(categorie, produit) {
    const ok = await showConfirmModal(`Êtes-vous sûr de vouloir supprimer le produit d'abonnement "${produit}" ?`, {
        title: 'Supprimer produit abonnement', okLabel: 'Supprimer', okVariant: 'danger'
    });
    if (ok) {
        try {
            const response = await fetch(`/api/admin/config/produits/by-name?nom=${encodeURIComponent(produit)}&type_catalogue=abonnement`, {
                method: 'DELETE',
                credentials: 'include'
            });

            const data = await response.json();

            if (data.success) {
                showToast(`Produit d'abonnement "${produit}" supprimé avec succès`);
                await chargerConfigAbonnement();
            } else {
                showToast(`Erreur: ${data.error}`);
            }
        } catch (error) {
            console.error('Erreur suppression produit abonnement:', error);
            showToast('Erreur lors de la suppression du produit');
        }
    }
}

function ajouterProduitAbonnementCategorie(categorie) {
    // À implémenter si besoin d'ajouter de nouveaux produits via un modal
    showToast('Fonctionnalité à implémenter: ajouter un produit à ' + categorie, 'info');
}

// Sauvegarder la configuration des produits
async function sauvegarderConfigProduits() {
    try {
        const response = await fetch('/api/admin/config/produits', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ produits: currentProduitsConfig })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('Configuration des produits sauvegardée avec succès !');
            
            // Recharger automatiquement la configuration serveur
            try {
                const reloadResponse = await fetch('/api/admin/reload-products', {
                    method: 'POST',
                    credentials: 'include'
                });
                const reloadData = await reloadResponse.json();
                if (reloadData.success) {
                    console.log('Configuration serveur rechargée automatiquement');
                } else {
                    console.warn('Erreur lors du rechargement automatique:', reloadData.message);
                }
            } catch (reloadError) {
                console.warn('Erreur lors du rechargement automatique:', reloadError);
            }
        } else {
            showToast(`Erreur lors de la sauvegarde: ${data.message}`);
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        showToast('Erreur lors de la sauvegarde de la configuration des produits');
    }
}

// Sauvegarder la configuration de l'inventaire
async function sauvegarderConfigInventaire() {
    try {
        // Si l'admin a modifié des prix vente depuis le modal "Gérer ventes liées"
        // de l'onglet Inventaire, on pousse ces changements AVANT la sauvegarde
        // inventaire. Ordre important: si on sauvait inventaire d'abord, la
        // propagation côté serveur écraserait les prix vente personnalisés non
        // encore détachés, puis le POST /produits suivant les ré-écraserait —
        // bruit inutile et entrées d'historique en double. En sauvant produits
        // d'abord, le POST /produits met prix_personnalise=true sur les
        // produits dont le prix a été touché manuellement, et la propagation
        // inventaire qui suit les laisse tranquilles.
        if (venteConfigModifieeDepuisInventaire) {
            const venteResp = await fetch('/api/admin/config/produits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ produits: currentProduitsConfig })
            });
            const venteData = await venteResp.json();
            if (!venteData.success) {
                showToast(`Erreur lors de la sauvegarde des prix vente liés: ${venteData.error || venteData.message}`);
                return;
            }
            venteConfigModifieeDepuisInventaire = false;
            console.log('✅ Prix vente liés sauvegardés avant propagation inventaire');
        }

        const response = await fetch('/api/admin/config/produits-inventaire', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ produitsInventaire: currentInventaireConfig })
        });

        const data = await response.json();
        if (data.success) {
            showToast('Configuration des produits d\'inventaire sauvegardée avec succès !');
            
            // Recharger automatiquement la configuration serveur
            try {
                const reloadResponse = await fetch('/api/admin/reload-products', {
                    method: 'POST',
                    credentials: 'include'
                });
                const reloadData = await reloadResponse.json();
                if (reloadData.success) {
                    console.log('Configuration serveur rechargée automatiquement');
                } else {
                    console.warn('Erreur lors du rechargement automatique:', reloadData.message);
                }
            } catch (reloadError) {
                console.warn('Erreur lors du rechargement automatique:', reloadError);
            }
        } else {
            showToast(`Erreur lors de la sauvegarde: ${data.message}`);
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        showToast('Erreur lors de la sauvegarde de la configuration des produits d\'inventaire');
    }
}

// Sauvegarder la configuration des produits d'abonnement
async function sauvegarderConfigAbonnement() {
    try {
        const response = await fetch('/api/admin/config/produits-abonnement', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ produitsAbonnement: currentAbonnementConfig })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('Configuration des produits d\'abonnement sauvegardée avec succès !');
            
            // Recharger automatiquement la configuration serveur
            try {
                const reloadResponse = await fetch('/api/admin/reload-products', {
                    method: 'POST',
                    credentials: 'include'
                });
                const reloadData = await reloadResponse.json();
                if (reloadData.success) {
                    console.log('Configuration serveur rechargée automatiquement');
                } else {
                    console.warn('Erreur lors du rechargement automatique:', reloadData.message);
                }
            } catch (reloadError) {
                console.warn('Erreur lors du rechargement automatique:', reloadError);
            }
        } else {
            showToast(`Erreur lors de la sauvegarde: ${data.message}`);
        }
    } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        showToast('Erreur lors de la sauvegarde de la configuration des produits d\'abonnement');
    }
}

    // Initialiser les event listeners pour les points de vente
    function initPointsVenteEventListeners() {
        // Formulaire d'ajout de point de vente
        const addPointVenteForm = document.getElementById('addPointVenteForm');
        if (addPointVenteForm) {
            addPointVenteForm.addEventListener('submit', function(e) {
                e.preventDefault();
                ajouterPointVente();
            });
        }
    }

    // Initialiser les event listeners pour la configuration des produits
    function initConfigProduitsEventListeners() {
    // Boutons de sauvegarde
    const saveProduits = document.getElementById('save-produits-btn');
    if (saveProduits) {
        saveProduits.addEventListener('click', sauvegarderConfigProduits);
    }
    
    const saveInventaire = document.getElementById('save-inventaire-btn');
    if (saveInventaire) {
        saveInventaire.addEventListener('click', sauvegarderConfigInventaire);
    }
    
    // Boutons de rechargement
    const reloadProduits = document.getElementById('reload-produits-btn');
    if (reloadProduits) {
        reloadProduits.addEventListener('click', chargerConfigProduits);
    }
    
    const reloadInventaire = document.getElementById('reload-inventaire-btn');
    if (reloadInventaire) {
        reloadInventaire.addEventListener('click', chargerConfigInventaire);
    }
    
    const saveAbonnement = document.getElementById('save-abonnement-btn');
    if (saveAbonnement) {
        saveAbonnement.addEventListener('click', sauvegarderConfigAbonnement);
    }
    
    const reloadAbonnement = document.getElementById('reload-abonnement-btn');
    if (reloadAbonnement) {
        reloadAbonnement.addEventListener('click', chargerConfigAbonnement);
    }
    
        // Bouton de rechargement de la configuration serveur
    const reloadServerConfigBtn = document.getElementById('reload-server-config-btn');
    if (reloadServerConfigBtn) {
        reloadServerConfigBtn.addEventListener('click', async function() {
            try {
                const response = await fetch('/api/admin/reload-products', {
                    method: 'POST',
                    credentials: 'include'
                });
                const data = await response.json();
                
                if (data.success) {
                    showToast('Configuration serveur rechargée avec succès!');
                    // Recharger aussi l'interface admin
                    chargerConfigProduits();
                    chargerConfigInventaire();
                    chargerConfigAbonnement();
                } else {
                    showToast('Erreur lors du rechargement: ' + data.message);
                }
            } catch (error) {
                console.error('Erreur lors du rechargement:', error);
                showToast('Erreur lors du rechargement de la configuration serveur');
            }
        });
    }
    
    // Modal pour ajouter une catégorie
    const saveCategoryBtn = document.getElementById('saveCategoryBtn');
    if (saveCategoryBtn) {
        saveCategoryBtn.addEventListener('click', function() {
            const categoryName = document.getElementById('newCategoryName').value.trim();
            if (categoryName) {
                if (!currentProduitsConfig[categoryName]) {
                    currentProduitsConfig[categoryName] = {};
                    afficherProduitsConfig();
                    document.getElementById('newCategoryName').value = '';
                    bootstrap.Modal.getInstance(document.getElementById('addCategoryModal')).hide();
                } else {
                    showToast('Cette catégorie existe déjà');
                }
            }
        });
    }
    
    // Modal pour ajouter un produit général
    const saveProductBtn = document.getElementById('saveProductBtn');
    if (saveProductBtn) {
        saveProductBtn.addEventListener('click', function() {
            const category = document.getElementById('productModalCategory').value;
            const productName = document.getElementById('newProductName').value.trim();
            const defaultPrice = parseFloat(document.getElementById('newProductDefault').value) || 0;
            const alternativesStr = document.getElementById('newProductAlternatives').value.trim();
            
            if (productName && category) {
                if (!currentProduitsConfig[category][productName]) {
                    const productConfig = {
                        default: defaultPrice,
                        alternatives: alternativesStr ? 
                            alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p)) : 
                            [defaultPrice]
                    };
                    
                    // Les prix spécifiques par point de vente sont gérés via la BDD
                    
                    currentProduitsConfig[category][productName] = productConfig;
                    afficherProduitsConfig();
                    
                    // Réinitialiser le formulaire
                    document.getElementById('newProductName').value = '';
                    document.getElementById('newProductDefault').value = '';
                    document.getElementById('newProductAlternatives').value = '';
                    
                    bootstrap.Modal.getInstance(document.getElementById('addProductModal')).hide();
                } else {
                    showToast('Ce produit existe déjà dans cette catégorie');
                }
            }
        });
    }
    
    // Modal pour ajouter une catégorie d'inventaire
    const saveInventaireCategoryBtn = document.getElementById('saveInventaireCategoryBtn');
    if (saveInventaireCategoryBtn) {
        saveInventaireCategoryBtn.addEventListener('click', function() {
            const categoryName = document.getElementById('newInventaireCategoryName').value.trim();
            if (categoryName) {
                // Vérifier si la catégorie existe déjà (dans les logiques ou personnalisées)
                const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
                const categoriesLogiques = ["Viandes", "Œufs et Produits Laitiers", "Abats et Sous-produits", "Produits sur Pieds", "Déchets", "Autres"];
                
                if (categoriesLogiques.includes(categoryName) || categoriesPersonnalisees.includes(categoryName)) {
                    showToast('Cette catégorie existe déjà');
                    return;
                }
                
                // Ajouter la catégorie aux catégories personnalisées
                categoriesPersonnalisees.push(categoryName);
                localStorage.setItem('inventaireCategoriesPersonnalisees', JSON.stringify(categoriesPersonnalisees));
                
                // Créer la catégorie dans la config
                currentInventaireConfig[categoryName] = {};
                
                afficherInventaireConfig();
                document.getElementById('newInventaireCategoryName').value = '';
                
                // Fermer le modal
                const modal = document.getElementById('addInventaireCategoryModal');
                if (modal) {
                    const bsModal = bootstrap.Modal.getInstance(modal);
                    if (bsModal) bsModal.hide();
                }
                
                showToast('Catégorie "' + categoryName + '" créée avec succès! Vous pouvez maintenant y ajouter des produits.');
            } else {
                showToast('Veuillez entrer un nom de catégorie');
            }
        });
    }
    
    // Modal pour ajouter un produit d'inventaire
    const saveInventaireProductBtn = document.getElementById('saveInventaireProductBtn');
    if (saveInventaireProductBtn) {
        saveInventaireProductBtn.addEventListener('click', function() {
            const category = document.getElementById('inventaireProductModalCategory').value;
            const productName = document.getElementById('newInventaireProductName').value.trim();
            const defaultPrice = parseFloat(document.getElementById('newInventairePrixDefault').value) || 0;
            const alternativesStr = document.getElementById('newInventaireAlternatives').value.trim();
            
            if (productName) {
                // Vérifier si c'est une catégorie personnalisée
                const categoriesPersonnalisees = JSON.parse(localStorage.getItem('inventaireCategoriesPersonnalisees') || '[]');
                const isCustomCategory = categoriesPersonnalisees.includes(category);
                
                const productConfig = {
                    prixDefault: defaultPrice,
                    alternatives: alternativesStr ? 
                        alternativesStr.split(',').map(p => parseFloat(p.trim())).filter(p => !isNaN(p)) : 
                        [defaultPrice],
                    mode_stock: 'manuel',
                    unite_stock: 'unite'
                };
                
                if (isCustomCategory) {
                    // Pour les catégories personnalisées, stocker dans la sous-structure
                    if (!currentInventaireConfig[category]) {
                        currentInventaireConfig[category] = {};
                    }
                    if (currentInventaireConfig[category][productName]) {
                        showToast('Ce produit existe déjà dans cette catégorie');
                        return;
                    }
                    currentInventaireConfig[category][productName] = productConfig;
                } else {
                    // Pour les catégories logiques, stocker au niveau racine
                    if (currentInventaireConfig[productName]) {
                        showToast('Ce produit existe déjà');
                        return;
                    }
                    currentInventaireConfig[productName] = productConfig;
                }
                
                afficherInventaireConfig();
                
                // Réinitialiser le formulaire
                document.getElementById('newInventaireProductName').value = '';
                document.getElementById('newInventairePrixDefault').value = '';
                document.getElementById('newInventaireAlternatives').value = '';
                
                bootstrap.Modal.getInstance(document.getElementById('addInventaireProductModal')).hide();
            }
        });
    }
}

// Initialisation
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initialisation de la page...'); // Log de débogage
    
    // Initialiser les composants de base
    initLogoutButton();
    initChangePasswordModal();
    initDatePickers();
    initNavigation();
    
    checkAuth().then(isAuthenticated => {
        if (isAuthenticated) {
            console.log('Authentification vérifiée, chargement des données...'); // Log de débogage
            
            // Charger les données
            chargerPointsVente();
            chargerProduits();
            
            // Initialiser les event listeners
            initPointsVenteEventListeners();
            initPrixEventListeners();
            initCorrectionsEventListeners();
            initConfigProduitsEventListeners();
            
            // Charger la configuration des produits
            chargerConfigProduits();
            chargerConfigInventaire();
            chargerConfigAbonnement();
            
            // Initialiser la section stocks si elle existe
            const stocksSection = document.getElementById('stocks-section');
            if (stocksSection) {
                initStocksSection();
            }
            
            // Initialiser la section modules
            initModulesSection();
        }
    });
});

// =================== GESTION DES MODULES ===================

/**
 * Initialiser la section de gestion des modules
 */
function initModulesSection() {
    console.log('Initialisation de la section modules...');
    
    // Charger les modules
    chargerModules();
    
    // Event listener pour le bouton d'actualisation
    const refreshBtn = document.getElementById('refresh-modules-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', chargerModules);
    }
}

/**
 * Charger la liste des modules depuis l'API
 */
async function chargerModules() {
    const tbody = document.getElementById('modules-table-body');
    if (!tbody) return;
    
    try {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center"><i class="fas fa-spinner fa-spin"></i> Chargement...</td></tr>';
        
        const response = await fetch('/api/modules', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Erreur lors du chargement');
        }
        
        afficherModules(data.modules);
        
    } catch (error) {
        console.error('Erreur lors du chargement des modules:', error);
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">
            <i class="fas fa-exclamation-triangle"></i> Erreur: ${error.message}
        </td></tr>`;
    }
}

/**
 * Afficher les modules dans le tableau
 */
function afficherModules(modules) {
    const tbody = document.getElementById('modules-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    // Trier les modules par nom
    const sortedModules = Object.values(modules).sort((a, b) => a.name.localeCompare(b.name));
    
    for (const module of sortedModules) {
        const row = document.createElement('tr');
        row.setAttribute('data-module-id', module.id);
        
        // Icône de statut
        const statusIcon = module.active 
            ? '<i class="fas fa-check-circle text-success fs-4"></i>'
            : '<i class="fas fa-times-circle text-danger fs-4"></i>';
        
        // Badge pour module essentiel
        const coreBadge = module.isCore 
            ? '<span class="badge bg-secondary ms-2">Essentiel</span>'
            : '';
        
        // Bouton d'action
        const actionBtn = module.isCore
            ? '<button class="btn btn-sm btn-secondary" disabled title="Module essentiel"><i class="fas fa-lock"></i></button>'
            : module.active
                ? `<button class="btn btn-sm btn-warning" onclick="toggleModule('${module.id}')" title="Désactiver"><i class="fas fa-toggle-on"></i> Désactiver</button>`
                : `<button class="btn btn-sm btn-success" onclick="toggleModule('${module.id}')" title="Activer"><i class="fas fa-toggle-off"></i> Activer</button>`;
        
        row.innerHTML = `
            <td class="text-center">${statusIcon}</td>
            <td>
                <strong>${module.name}</strong>${coreBadge}
                <br><small class="text-muted">ID: ${module.id}</small>
            </td>
            <td>${module.description || '-'}</td>
            <td>${actionBtn}</td>
        `;
        
        tbody.appendChild(row);
    }
}

/**
 * Activer/Désactiver un module
 */
async function toggleModule(moduleId) {
    try {
        const response = await fetch(`/api/modules/${moduleId}/toggle`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Afficher une notification
            const message = data.active 
                ? `Module "${data.moduleId}" activé avec succès`
                : `Module "${data.moduleId}" désactivé avec succès`;
            
            afficherNotification(message, data.active ? 'success' : 'warning');
            
            // Recharger la liste des modules
            chargerModules();
        } else {
            throw new Error(data.message || 'Erreur lors de la mise à jour');
        }
        
    } catch (error) {
        console.error('Erreur lors du toggle du module:', error);
        afficherNotification(`Erreur: ${error.message}`, 'danger');
    }
}

/**
 * Afficher une notification temporaire
 */
function afficherNotification(message, type = 'info') {
    // Vérifier si un conteneur de notification existe, sinon le créer
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = 'position: fixed; top: 80px; right: 20px; z-index: 9999; max-width: 350px;';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} alert-dismissible fade show`;
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    
    container.appendChild(notification);

    // Supprimer automatiquement après 5 secondes
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// =====================================================================
// RECHERCHE SPOTLIGHT — onglet "Recherche" dans Configuration Produits.
// Recherche cross-catalogue (Produits Generaux + Inventaire) avec
// filtres source/famille, tri, et navigation vers la fiche du produit.
// =====================================================================

// State courant des filtres + cache des produits applatis.
const _rechercheState = {
    query: '',
    src: 'all',     // 'all' | 'pg' | 'inv'
    famille: 'all', // 'all' | 'boucherie' | 'epicerie' | 'autres'
    cat: 'all',     // 'all' | nom exact de la categorie (ex: 'Superette')
    sort: 'name',
    showArchived: false, // false = cacher les archives (defaut), true = inclure
    flat: [],
    // Selection multiple pour les actions batch (archiver/desarchiver).
    // Set de cles "src::nom" (ex: 'pg::Spaghetti 250g').
    selection: new Set()
};

// Cle unique de selection pour un produit (src+nom). Un produit peut
// exister dans les 2 catalogues — la selection est independante.
function _rechercheSelKey(src, nom) {
    return `${src}::${nom}`;
}

// Normalise une chaine en ASCII lowercase (strip diacritics) pour
// que 'Épicerie' -> 'epicerie' et matche les data-attrs des filtres.
// Sinon 'Épicerie'.toLowerCase() = 'épicerie' (avec é) != 'epicerie'.
function normFamille(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Mapping categorie -> famille pour Produits Generaux.
// Reutilise CATEGORIES_PRODUITS_GENERAUX (defini en haut du fichier).
function familleDeCatPG(categorie) {
    for (const [fam, cats] of Object.entries(CATEGORIES_PRODUITS_GENERAUX)) {
        if (cats.includes(categorie)) return normFamille(fam);
    }
    return 'autres';
}
function familleDeCatInventaire(categorie) {
    // Reutilise inventaireFamilleDefauts + custom familles localStorage
    const fam = (familleDeCategorieInventaire
        ? familleDeCategorieInventaire(categorie)
        : (inventaireFamilleDefauts[categorie] || 'Autres')
    );
    return normFamille(fam);
}

// Aplatit les 2 catalogues en un tableau unifie pour la recherche.
// Forme: { src, name, cat, famille, prix, archived }
function reconstruireFlatRecherche() {
    const flat = [];

    // Produits Generaux: currentProduitsConfig = { catName: { produitName: {default, alternatives, ...} } }
    if (typeof currentProduitsConfig === 'object' && currentProduitsConfig) {
        for (const [catName, produits] of Object.entries(currentProduitsConfig)) {
            if (typeof produits !== 'object' || produits === null) continue;
            for (const [produitName, config] of Object.entries(produits)) {
                if (typeof config !== 'object' || config === null) continue;
                if (typeof config.default !== 'number') continue;
                flat.push({
                    src: 'pg',
                    name: produitName,
                    cat: catName,
                    famille: familleDeCatPG(catName),
                    prix: config.default,
                    archived: !!config.archived
                });
            }
        }
    }

    // Produits Inventaire: structure mixte (flat ou nested).
    // On reutilise la categorisation logique de reorganiserInventaireParCategories.
    if (typeof reorganiserInventaireParCategories === 'function') {
        const parCat = reorganiserInventaireParCategories();
        for (const [catName, produits] of Object.entries(parCat)) {
            if (typeof produits !== 'object' || produits === null) continue;
            for (const [produitName, config] of Object.entries(produits)) {
                if (typeof config !== 'object' || config === null) continue;
                if (typeof config.prixDefault !== 'number') continue;
                flat.push({
                    src: 'inv',
                    name: produitName,
                    cat: catName,
                    famille: familleDeCatInventaire(catName),
                    prix: config.prixDefault,
                    archived: !!config.archived
                });
            }
        }
    }

    _rechercheState.flat = flat;
    return flat;
}

// Filtre + tri en memoire (pas de requete reseau).
function appliquerFiltresRecherche() {
    const { query, src, famille, cat, sort, showArchived, flat } = _rechercheState;
    const q = query.toLowerCase().trim();
    let matches = flat;
    // Filtre archive: par defaut on cache les archives. Si showArchived=true,
    // on les inclut (mais visuellement differents — cf. renderRechercheGrid).
    if (!showArchived) matches = matches.filter(p => !p.archived);
    if (src !== 'all') matches = matches.filter(p => p.src === src);
    if (famille !== 'all') matches = matches.filter(p => p.famille === famille);
    if (cat !== 'all') matches = matches.filter(p => p.cat === cat);
    if (q) matches = matches.filter(p => p.name.toLowerCase().includes(q));

    if (sort === 'name') {
        matches.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'price-asc') {
        matches.sort((a, b) => a.prix - b.prix);
    } else if (sort === 'price-desc') {
        matches.sort((a, b) => b.prix - a.prix);
    }
    return matches;
}

function renderRechercheGrid() {
    const grid = document.getElementById('recherche-grid');
    const countEl = document.getElementById('recherche-result-count');
    if (!grid || !countEl) return;

    const matches = appliquerFiltresRecherche();
    countEl.textContent = `${matches.length} résultat${matches.length > 1 ? 's' : ''}`;

    if (matches.length === 0) {
        grid.innerHTML = `
            <div class="recherche-empty">
                <i class="bi bi-search"></i>
                Aucun produit ne correspond aux filtres.
            </div>
        `;
        return;
    }

    // escAttr couvre <,>,&,",' pour attrs ET contenu texte. p.src est trusted
    // ('pg'/'inv' set par notre code) mais on escape par defense. icon/famIcon/
    // srcLabel sont hardcodes, p.prix passe par toLocaleString (numerique pur).
    const selection = _rechercheState.selection;
    grid.innerHTML = matches.map((p) => {
        const icon = p.src === 'pg' ? 'bi-shop' : 'bi-box-seam';
        const srcLabel = p.src === 'pg' ? 'Généraux' : 'Inventaire';
        const famIcon = p.famille === 'boucherie' ? '🥩' : (p.famille === 'epicerie' ? '🛒' : '📦');
        const escName = escAttr(p.name);
        const escCat = escAttr(p.cat);
        const escSrc = escAttr(p.src);
        // Cartes archivees: classe + badge "Archivé" en plus du badge source.
        const archivedClass = p.archived ? ' is-archived' : '';
        const archivedBadge = p.archived
            ? `<span class="archived-badge" title="Produit archivé — masqué du POS et du stock inventaire"><i class="bi bi-archive" aria-hidden="true"></i> Archivé</span>`
            : '';
        const selKey = _rechercheSelKey(p.src, p.name);
        const isSelected = selection.has(selKey);
        const selectedClass = isSelected ? ' is-selected' : '';
        const archiveQuickIcon = p.archived ? 'bi-archive-fill' : 'bi-archive';
        const archiveQuickTitle = p.archived ? 'Désarchiver ce produit' : 'Archiver ce produit';
        const archiveQuickLabel = p.archived ? 'Désarchiver' : 'Archiver';
        return `
            <div class="result-card${archivedClass}${selectedClass}" data-src="${escSrc}" data-name="${escName}" data-cat="${escCat}" data-archived="${p.archived ? 'true' : 'false'}">
                <label class="result-card-checkbox" title="Sélectionner pour action groupée" aria-label="Sélectionner ${escName}">
                    <input type="checkbox" class="result-card-checkbox-input" data-recherche-select="${escSrc}::${escName}"${isSelected ? ' checked' : ''}>
                </label>
                <button type="button" class="result-card-archive-btn" data-recherche-archive="${escSrc}::${escName}" title="${archiveQuickTitle}" aria-label="${archiveQuickLabel} ${escName}">
                    <i class="bi ${archiveQuickIcon}" aria-hidden="true"></i>
                </button>
                <div class="result-card-header">
                    <div class="result-card-icon icon-${escSrc}"><i class="bi ${icon}" aria-hidden="true"></i></div>
                    <span class="src-badge ${escSrc}">${srcLabel}</span>
                    ${archivedBadge}
                </div>
                <div class="result-name" title="${escName}">${escName}</div>
                <div class="result-cat"><span aria-hidden="true">${famIcon}</span> ${escCat}</div>
                <div class="result-price">${p.prix.toLocaleString('fr-FR')} <small>FCFA</small></div>
            </div>
        `;
    }).join('');

    // Re-render l'action bar (depend de la selection)
    renderRechercheSelectionBar();
}

// Rend la barre d'action selection (apparait quand selection > 0).
// Affiche "X selectionnes" + boutons Archiver / Desarchiver /
// Effacer la selection. Idempotent: re-cree le DOM a chaque appel.
function renderRechercheSelectionBar() {
    const bar = document.getElementById('recherche-selection-bar');
    if (!bar) return;
    const selection = _rechercheState.selection;
    const count = selection.size;
    if (count === 0) {
        bar.style.display = 'none';
        bar.innerHTML = '';
        return;
    }
    // Determine si tous les selectionnes sont deja archives (pour decider
    // quel bouton dominant proposer: archiver vs desarchiver).
    const flat = _rechercheState.flat;
    let allArchived = true;
    let anyArchived = false;
    for (const p of flat) {
        const key = _rechercheSelKey(p.src, p.name);
        if (selection.has(key)) {
            if (p.archived) anyArchived = true;
            else allArchived = false;
        }
    }
    bar.style.display = '';
    bar.innerHTML = `
        <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="fw-semibold">
                <i class="bi bi-check-square me-1" aria-hidden="true"></i>
                ${count} produit${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}
            </span>
            <div class="ms-auto d-flex gap-2 flex-wrap">
                <button type="button" class="btn btn-sm btn-warning" id="recherche-batch-archive" ${allArchived ? 'disabled title="Tous déjà archivés"' : ''}>
                    <i class="bi bi-archive" aria-hidden="true"></i> Archiver
                </button>
                <button type="button" class="btn btn-sm btn-outline-success" id="recherche-batch-unarchive" ${!anyArchived ? 'disabled title="Aucun n\'est archivé"' : ''}>
                    <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Désarchiver
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="recherche-batch-clear">
                    <i class="bi bi-x-lg" aria-hidden="true"></i> Désélectionner
                </button>
            </div>
        </div>
    `;
}

// Flag re-entrant pour empecher 2 batchs concurrents (double-click sur
// le bouton "Archiver/Desarchiver" de l'action bar). Un seul batch a la
// fois pour eviter des mutations memory paralleles sur currentXConfig.
let _rechercheBatchInFlight = false;

// Batch: applique archived=targetValue sur tous les produits selectionnes.
// Itere sur les 2 catalogues et POST en 1 fois par cote (pas N requetes).
async function rechercheBatchArchive(targetArchived) {
    if (_rechercheBatchInFlight) return; // garde re-entrante
    const selection = _rechercheState.selection;
    if (selection.size === 0) return;
    const flat = _rechercheState.flat;

    // Trouver les produits selectionnes via leur cle src::nom
    const selectedItems = flat.filter(p => selection.has(_rechercheSelKey(p.src, p.name)));
    if (selectedItems.length === 0) return;

    // Filtre: ne traiter que ceux dont l'etat change reellement
    const toUpdate = selectedItems.filter(p => !!p.archived !== targetArchived);
    if (toUpdate.length === 0) {
        showToast('Aucun changement à appliquer.', 'info');
        return;
    }

    const action = targetArchived ? 'archiver' : 'désarchiver';
    const actionPast = targetArchived ? 'archivés' : 'désarchivés';
    const explain = targetArchived
        ? `\n\nIls ne seront plus affichés dans le POS, le stock inventaire, ni dans la recherche admin par défaut.`
        : `\n\nIls redeviendront visibles dans le POS et le stock inventaire.`;
    const ok = typeof showConfirmModal === 'function'
        ? await showConfirmModal(`${action[0].toUpperCase() + action.slice(1)} ${toUpdate.length} produit${toUpdate.length > 1 ? 's' : ''} ?${explain}`, {
            title: `${action[0].toUpperCase() + action.slice(1)} en lot`,
            okLabel: action[0].toUpperCase() + action.slice(1),
            okVariant: targetArchived ? 'warning' : 'success'
        })
        : confirm(`${action} ${toUpdate.length} produits ?`);
    if (!ok) return;

    // Garde re-entrante: bloquer les autres batchs avant TOUTE mutation memory.
    // Si un autre batch arrive entre temps, il return immediatement (no-op).
    _rechercheBatchInFlight = true;

    // Snapshot pour rollback
    const snapPG = JSON.parse(JSON.stringify(currentProduitsConfig || {}));
    const snapInv = JSON.parse(JSON.stringify(currentInventaireConfig || {}));

    // Set le flag en memoire sur les 2 catalogues
    let hasPgChanges = false;
    let hasInvChanges = false;
    for (const p of toUpdate) {
        if (p.src === 'pg') {
            // Exact: ne touche QUE le produit dont le nom matche exactement
            // p.name. Sans ca, un produit 'Pasta' archive pourrait toucher
            // 'PASTA' (case-different) qui est un produit distinct.
            const pgHit = pumLookupPG(p.name, { exact: true });
            if (pgHit && currentProduitsConfig[pgHit.categorie] && currentProduitsConfig[pgHit.categorie][pgHit.nom]) {
                currentProduitsConfig[pgHit.categorie][pgHit.nom].archived = targetArchived;
                hasPgChanges = true;
            }
        } else if (p.src === 'inv') {
            const invHit = pumLookupInv(p.name, { exact: true });
            if (invHit && invHit.parent && invHit.parent[invHit.nom]) {
                invHit.parent[invHit.nom].archived = targetArchived;
                hasInvChanges = true;
            }
        }
    }

    // Disable bar pendant la sauvegarde
    const bar = document.getElementById('recherche-selection-bar');
    if (bar) bar.querySelectorAll('button').forEach(b => b.disabled = true);

    let serverOk = true;
    let serverError = null;
    try {
        if (hasPgChanges) {
            const resp = await fetch('/api/admin/config/produits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ produits: currentProduitsConfig })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                serverOk = false;
                serverError = data.message || data.error || `HTTP ${resp.status}`;
            }
        }
        if (serverOk && hasInvChanges) {
            const resp = await fetch('/api/admin/config/produits-inventaire', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ produitsInventaire: currentInventaireConfig })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                serverOk = false;
                serverError = data.message || data.error || `HTTP ${resp.status}`;
            }
        }
        if (serverOk) {
            try {
                await fetch('/api/admin/reload-products', { method: 'POST', credentials: 'include' });
            } catch (_) { /* non bloquant */ }
        }
    } catch (err) {
        serverOk = false;
        serverError = err && err.message ? err.message : String(err);
    } finally {
        if (bar) bar.querySelectorAll('button').forEach(b => b.disabled = false);
        // Liberation du flag re-entrant — TOUJOURS (success + error)
        _rechercheBatchInFlight = false;
    }

    if (!serverOk) {
        currentProduitsConfig = snapPG;
        currentInventaireConfig = snapInv;
        try {
            if (typeof chargerConfigProduits === 'function') await chargerConfigProduits();
            if (typeof chargerConfigInventaire === 'function') await chargerConfigInventaire();
        } catch (_) { /* best effort */ }
        showToast(`Erreur batch: ${serverError}`, 'danger');
        return;
    }

    // Reset selection apres succes (les produits "actifs" ne sont plus
    // visibles si on archive et qu'on affiche pas les archives, etc.)
    _rechercheState.selection.clear();

    if (typeof afficherProduitsConfig === 'function') afficherProduitsConfig();
    if (typeof afficherInventaireConfig === 'function') afficherInventaireConfig();
    reconstruireFlatRecherche();
    updateRechercheCompteurs();
    if (typeof renderRechercheCategoriesFilter === 'function') renderRechercheCategoriesFilter();
    renderRechercheGrid();

    showToast(`${toUpdate.length} produit${toUpdate.length > 1 ? 's' : ''} ${actionPast}.`, 'success');
}

// Archive rapide un seul produit (bouton sur la carte). Reutilise la
// fonction batch avec un Set d'un seul element.
// Set des keys en cours de traitement pour eviter les double-clicks
// (le confirm modal etant async, 2 clics rapides peuvent empiler 2 confirms).
const _rechercheArchiveSingleInFlight = new Set();

async function rechercheArchiveSingle(src, nom) {
    const key = _rechercheSelKey(src, nom);
    // Garde re-entrante: si deja en cours pour ce produit, ignore.
    if (_rechercheArchiveSingleInFlight.has(key)) return;

    const flat = _rechercheState.flat;
    const target = flat.find(p => p.src === src && p.name === nom);
    if (!target) return;

    _rechercheArchiveSingleInFlight.add(key);
    // Disable visuellement le bouton archive de cette carte. CSS.escape gere
    // tous les caracteres speciaux des selecteurs (],[,\\,\\n...) — bien plus
    // robuste qu'un simple replace de ". Supporte tous les navigateurs
    // modernes.
    const cssKey = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(key) : key.replace(/(["\\\[\]])/g, '\\$1');
    const btn = document.querySelector(`[data-recherche-archive="${cssKey}"]`);
    if (btn) btn.disabled = true;

    // Sauvegarde de la selection courante, on la remplace temporairement
    const previousSelection = new Set(_rechercheState.selection);
    _rechercheState.selection = new Set([key]);
    try {
        await rechercheBatchArchive(!target.archived);
    } finally {
        // Si la selection precedente etait non-vide et que le user vient
        // d'archiver un produit en plus, on garde la selection vide (batch
        // la reset deja). Sinon on restore. Comportement intuitif: le clic
        // sur l'icone individuel ne pollue pas la selection multiple.
        if (previousSelection.size === 0) {
            _rechercheState.selection.clear();
        } else {
            _rechercheState.selection = previousSelection;
        }
        _rechercheArchiveSingleInFlight.delete(key);
        // Le re-render renderRechercheGrid recree le DOM donc le bouton
        // disabled est remplace par un neuf. Pas besoin de re-enable.
        renderRechercheGrid();
    }
}

// Recalcule les compteurs (Tous / PG / Inv) dans la sidebar.
// Les compteurs respectent le toggle "Afficher les archives" pour rester
// coherents avec ce qui est visible dans la grille.
function updateRechercheCompteurs() {
    const { flat, showArchived } = _rechercheState;
    const scope = showArchived ? flat : flat.filter(p => !p.archived);
    const total = scope.length;
    const pg = scope.filter(p => p.src === 'pg').length;
    const inv = scope.filter(p => p.src === 'inv').length;
    const setCount = (sel, n) => {
        const el = document.querySelector(`[data-count="${sel}"]`);
        if (el) el.textContent = String(n);
    };
    setCount('all', total);
    setCount('pg', pg);
    setCount('inv', inv);
}

// Re-render la liste des categories visibles dans la sidebar.
// La liste ne montre que les categories presentes dans les resultats
// pre-filtres par src + famille (mais pas par cat lui-meme, sinon
// on cacherait toutes les autres apres la 1ere selection).
function renderRechercheCategoriesFilter() {
    const list = document.getElementById('recherche-cat-list');
    if (!list) return;
    const { src, famille, cat, showArchived, flat } = _rechercheState;

    // Sous-ensemble pre-filtre (archived + src + famille)
    let scope = flat;
    if (!showArchived) scope = scope.filter(p => !p.archived);
    if (src !== 'all') scope = scope.filter(p => p.src === src);
    if (famille !== 'all') scope = scope.filter(p => p.famille === famille);

    // Dedup + count par categorie
    const countByCat = new Map();
    for (const p of scope) {
        countByCat.set(p.cat, (countByCat.get(p.cat) || 0) + 1);
    }
    // Tri alphabetique
    const cats = Array.from(countByCat.keys()).sort((a, b) => a.localeCompare(b));

    // Si la categorie selectionnee n'est plus dans le scope, reset a 'all'
    if (cat !== 'all' && !countByCat.has(cat)) {
        _rechercheState.cat = 'all';
    }
    const currentCat = _rechercheState.cat;

    // Build HTML: "Toutes" + une chip par categorie
    // escAttr couvre <,>,&,",' donc utilisable a la fois pour attr et texte.
    const allActive = currentCat === 'all';
    let html = `
        <button type="button" class="recherche-filter-item${allActive ? ' active' : ''}" data-recherche-cat="all" aria-pressed="${allActive}">
            <i class="bi bi-grid" aria-hidden="true"></i> Toutes
            <span class="recherche-count">${scope.length}</span>
        </button>
    `;
    for (const c of cats) {
        const escC = escAttr(c);
        const isActive = c === currentCat;
        html += `
            <button type="button" class="recherche-filter-item${isActive ? ' active' : ''}" data-recherche-cat="${escC}" title="${escC}" aria-pressed="${isActive}">
                <span class="recherche-cat-label">${escC}</span>
                <span class="recherche-count">${countByCat.get(c)}</span>
            </button>
        `;
    }
    list.innerHTML = html;

    // Re-bind clicks (delegation simple via querySelectorAll, idempotent
    // car le innerHTML reset les anciens listeners)
    list.querySelectorAll('[data-recherche-cat]').forEach((el) => {
        el.addEventListener('click', () => {
            _rechercheState.cat = el.dataset.rechercheCat;
            // Mettre a jour visuel (active + aria-pressed) + grid
            list.querySelectorAll('[data-recherche-cat]').forEach((x) => {
                const isActive = x === el;
                x.classList.toggle('active', isActive);
                x.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
            renderRechercheGrid();
        });
    });
}

// Click sur une card -> activer l'onglet source + scroll vers le produit.
function ouvrirProduitDepuisRecherche(src, name, cat) {
    // 1) Activer l'onglet source via Bootstrap
    const tabBtnId = src === 'pg' ? 'produits-tab' : 'inventaire-tab';
    const tabBtn = document.getElementById(tabBtnId);
    if (tabBtn) {
        if (window.bootstrap && bootstrap.Tab) {
            const tab = bootstrap.Tab.getOrCreateInstance(tabBtn);
            tab.show();
        } else {
            tabBtn.click();
        }
    }

    // 2) Filtrer + scroll au prochain frame (apres le render du tab).
    setTimeout(() => {
        if (src === 'inv') {
            // Utiliser la search input deja en place sur l'onglet Inventaire.
            const input = document.getElementById('inventaire-search-input');
            if (input) {
                input.value = name;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        // Scroll vers la 1ere row qui matche le nom dans n'importe quel
        // accordion-item (data-produit ou texte de cellule).
        const containerId = src === 'pg' ? 'produits-categories' : 'inventaire-categories';
        const container = document.getElementById(containerId);
        if (!container) return;
        // 1ere row contenant le nom (matching exact case-insensitive)
        const rows = container.querySelectorAll('tr');
        const target = Array.from(rows).find((row) => {
            if (row.querySelector('th')) return false;
            const txt = (row.textContent || '').toLowerCase();
            return txt.includes(name.toLowerCase());
        });
        if (target) {
            // Si la row est dans un accordion-item collapse, l'ouvrir.
            const item = target.closest('.accordion-item');
            if (item) {
                const collapse = item.querySelector('.accordion-collapse');
                const btn = item.querySelector('.accordion-button');
                if (collapse && !collapse.classList.contains('show')) {
                    collapse.classList.add('show');
                    if (btn && btn.classList.contains('collapsed')) {
                        btn.classList.remove('collapsed');
                        btn.setAttribute('aria-expanded', 'true');
                    }
                }
            }
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.style.transition = 'background 1s';
            target.style.background = '#fef9c3';
            setTimeout(() => { target.style.background = ''; }, 2000);
        }
    }, 150);
}

// Init listeners au DOMContentLoaded (idempotent).
function initRechercheSpotlight() {
    const grid = document.getElementById('recherche-grid');
    if (!grid || grid.dataset.bound === 'true') return;
    grid.dataset.bound = 'true';

    // Input search
    const input = document.getElementById('recherche-input');
    if (input) {
        input.addEventListener('input', (e) => {
            _rechercheState.query = e.target.value || '';
            renderRechercheGrid();
        });
    }

    // Helper: synchronise .active + aria-pressed pour un groupe de toggle-buttons.
    // selector = attribut data-* (ex: '[data-recherche-src]'), active = element selectionne.
    const activateFilter = (selector, active) => {
        document.querySelectorAll(selector).forEach((x) => {
            const isActive = x === active;
            x.classList.toggle('active', isActive);
            x.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    };

    // Filtres source
    document.querySelectorAll('[data-recherche-src]').forEach((el) => {
        el.addEventListener('click', () => {
            activateFilter('[data-recherche-src]', el);
            _rechercheState.src = el.dataset.rechercheSrc;
            // Le scope des categories change avec src -> re-render la liste
            renderRechercheCategoriesFilter();
            renderRechercheGrid();
        });
    });

    // Filtres famille
    document.querySelectorAll('[data-recherche-fam]').forEach((el) => {
        el.addEventListener('click', () => {
            activateFilter('[data-recherche-fam]', el);
            _rechercheState.famille = el.dataset.rechercheFam;
            // Le scope des categories change avec famille -> re-render
            renderRechercheCategoriesFilter();
            renderRechercheGrid();
        });
    });

    // Sort
    const sortSel = document.getElementById('recherche-sort');
    if (sortSel) {
        sortSel.addEventListener('change', (e) => {
            _rechercheState.sort = e.target.value;
            renderRechercheGrid();
        });
    }

    // Toggle "Afficher les archives" (defaut: off — on cache les archives)
    const archivedToggle = document.getElementById('recherche-show-archived');
    if (archivedToggle) {
        archivedToggle.checked = _rechercheState.showArchived;
        archivedToggle.addEventListener('change', (e) => {
            _rechercheState.showArchived = !!e.target.checked;
            // Les compteurs Tous/PG/Inv dependent de showArchived (cf.
            // updateRechercheCompteurs qui filtre scope = !p.archived si
            // !showArchived). Sans ce refresh, les badges restent stales.
            updateRechercheCompteurs();
            // Le scope categorie change aussi quand on inclut/exclut les archives
            renderRechercheCategoriesFilter();
            renderRechercheGrid();
        });
    }

    // Refresh button: re-fetch les 2 catalogues + rebuild flat
    const refreshBtn = document.getElementById('recherche-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            try {
                if (typeof chargerConfigProduits === 'function') await chargerConfigProduits();
                if (typeof chargerConfigInventaire === 'function') await chargerConfigInventaire();
                reconstruireFlatRecherche();
                updateRechercheCompteurs();
                renderRechercheCategoriesFilter();
                renderRechercheGrid();
            } finally {
                refreshBtn.disabled = false;
            }
        });
    }

    // Selection bookkeeping via 'change' event sur l'input natif:
    // - Marche pour click sur input ET label (browser forward le click)
    // - Marche pour clavier (Space pour toggle quand input focused)
    // - Marche pour set programmatique de .checked (avec dispatch d'event)
    // Plus robuste qu'un click handler qui doit gerer plusieurs paths.
    grid.addEventListener('change', (e) => {
        const cbInput = e.target.closest('.result-card-checkbox-input');
        if (!cbInput) return;
        const key = cbInput.dataset.rechercheSelect;
        if (cbInput.checked) _rechercheState.selection.add(key);
        else _rechercheState.selection.delete(key);
        const card = cbInput.closest('.result-card');
        if (card) card.classList.toggle('is-selected', cbInput.checked);
        renderRechercheSelectionBar();
    });

    // Click delegation pour:
    //  - Archive rapide (path 2)
    //  - Ouverture modal (path 3, defaut)
    // La checkbox (input + label wrapper) stoppe la propagation pour eviter
    // que le click de la checkbox/label ouvre le modal. La selection elle-
    // meme est geree par le 'change' event ci-dessus.
    grid.addEventListener('click', (e) => {
        // Stop propagation sur checkbox input ET son label wrapper.
        // Le browser toggle l'input via le label, dispatch un 'change' event
        // qui sera capture par le listener au-dessus.
        if (e.target.closest('.result-card-checkbox')) {
            e.stopPropagation();
            return;
        }
        // Path 2: bouton archive rapide
        const archBtn = e.target.closest('[data-recherche-archive]');
        if (archBtn) {
            e.stopPropagation();
            const [src, ...nameParts] = archBtn.dataset.rechercheArchive.split('::');
            const nom = nameParts.join('::'); // au cas ou un nom contient '::'
            rechercheArchiveSingle(src, nom);
            return;
        }
        // Path 3: ouverture modal (comportement par defaut)
        const card = e.target.closest('.result-card');
        if (!card) return;
        const src = card.dataset.src;
        const nom = card.dataset.name;
        const cat = card.dataset.cat;
        if (typeof ouvrirModalProduitUnifie === 'function') {
            ouvrirModalProduitUnifie('edit', { src, nom, cat });
        } else {
            // Fallback ancien comportement
            ouvrirProduitDepuisRecherche(src, nom, cat);
        }
    });

    // Bind action bar (delegation: le contenu est recree a chaque render).
    const selectionBar = document.getElementById('recherche-selection-bar');
    if (selectionBar) {
        selectionBar.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            if (btn.id === 'recherche-batch-archive') {
                rechercheBatchArchive(true);
            } else if (btn.id === 'recherche-batch-unarchive') {
                rechercheBatchArchive(false);
            } else if (btn.id === 'recherche-batch-clear') {
                _rechercheState.selection.clear();
                renderRechercheGrid();
            }
        });
    }

    // Quand le user clique sur l'onglet Recherche, on rebuild la liste
    // au cas ou les autres onglets ont modifie les configs.
    const rechercheTab = document.getElementById('recherche-tab');
    if (rechercheTab) {
        rechercheTab.addEventListener('shown.bs.tab', () => {
            reconstruireFlatRecherche();
            updateRechercheCompteurs();
            renderRechercheCategoriesFilter();
            renderRechercheGrid();
        });
    }

    // Premier rendu si on a deja les donnees.
    reconstruireFlatRecherche();
    updateRechercheCompteurs();
    renderRechercheCategoriesFilter();
    renderRechercheGrid();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRechercheSpotlight);
} else {
    initRechercheSpotlight();
}

// =====================================================================
// MODAL UNIFIE M1 — ajouter ou modifier un produit dans les 2 catalogues
// Utilise par l'onglet Recherche (bouton Ajouter + click sur une card).
// =====================================================================

// Remplit un <select> avec des <optgroup> a partir d'un dict {famille: [cat,...]}
// Si `selected` n'est dans aucune famille (= valeur legacy d'un ancien produit
// inventaire), on l'injecte dans un optgroup "Anciennes catégories" en haut
// du select pour preserver la selection et signaler la migration possible.
// escAttr couvre <,>,&,",' donc utilisable a la fois pour attr et texte.
function pumPopulerSelect(selectEl, categoriesParFamille, selected) {
    if (!selectEl) return;
    // Liste plate de toutes les categories standard
    const standardCats = new Set();
    for (const cats of Object.values(categoriesParFamille)) {
        cats.forEach((c) => standardCats.add(c));
    }
    let html = '';
    // Optgroup legacy en premier si la valeur selectionnee n'est pas standard
    if (selected && !standardCats.has(selected)) {
        const escLeg = escAttr(selected);
        html += `<optgroup label="🗂️ Ancienne catégorie">`;
        html += `<option value="${escLeg}" selected>${escLeg} (legacy)</option>`;
        html += `</optgroup>`;
    }
    for (const [famille, cats] of Object.entries(categoriesParFamille)) {
        const famIcon = famille === 'Boucherie' ? '🥩' : (famille === 'Épicerie' ? '🛒' : '📦');
        // famille est une cle de constante hardcodee, mais escape par defense
        html += `<optgroup label="${famIcon} ${escAttr(famille)}">`;
        cats.forEach((cat) => {
            const escCat = escAttr(cat);
            const sel = (cat === selected) ? ' selected' : '';
            html += `<option value="${escCat}"${sel}>${escCat}</option>`;
        });
        html += '</optgroup>';
    }
    selectEl.innerHTML = html;
}

// Active/desactive le select Mode de stock en fonction de la cible
// Inventaire (mode_stock n'a de sens que pour les produits Inventaire).
function pumSyncModeStockEnabled() {
    const modeStockSel = document.getElementById('pum-mode-stock');
    const targetInv = document.getElementById('pum-target-inv');
    const helpEl = document.getElementById('pum-mode-stock-help');
    if (!modeStockSel || !targetInv) return;
    const enabled = !!targetInv.checked;
    modeStockSel.disabled = !enabled;
    if (helpEl) helpEl.style.opacity = enabled ? '' : '0.5';
}

// Regle metier: famille Boucherie + Pack = manuel (verrou defensif aligne
// sur la migration db/update-schema.js qui force mode_stock='manuel' pour
// ces categories au demarrage). Autres categories = automatique par defaut.
// Couvre aussi les anciennes categories legacy (Viandes, Abats, etc.) pour
// que les produits non-migres aient le bon defaut.
const _CATS_BOUCHERIE_MANUEL = new Set([
    // Categories alignees Produits Generaux
    'Bovin', 'Ovin', 'Volaille', 'Caprin', 'Poisson', 'Pack',
    // Buckets legacy (compatibilite avec ancienne taxonomie inventaire)
    'Viandes', 'Abats et Sous-produits', 'Produits sur Pieds'
]);
function pumDefaultModeStock(catInv) {
    return _CATS_BOUCHERIE_MANUEL.has(catInv) ? 'manuel' : 'automatique';
}

// Cherche un produit existant dans Produits Generaux par nom.
// Retourne { categorie, nom, config } ou null.
//
// opts.exact (defaut: false):
//   - false  : match case-insensitive (utile pour le hint "produit similaire")
//   - true   : match strict par cle (case-sensitive). A utiliser dans TOUS
//              les chemins destructifs (archive, save, delete) sinon 2
//              produits distincts qui different uniquement par la casse
//              (ex: 'Pasta' / 'PASTA' / 'Pomme De Terre Sac' / 'POMME DE
//              TERRE SAC') seraient conflates et l'admin pourrait toucher
//              l'un en croyant toucher l'autre.
function pumLookupPG(nom, opts) {
    if (!currentProduitsConfig || !nom) return null;
    const exact = !!(opts && opts.exact);
    if (exact) {
        // Lookup direct par cle dans chaque categorie (O(N_cats) au lieu
        // de O(N_produits) du scan fuzzy). hasOwnProperty.call evite de
        // matcher les cles heritees du prototype (Object.prototype) si un
        // produit s'appelle 'constructor', '__proto__', 'toString', etc.
        for (const [cat, produits] of Object.entries(currentProduitsConfig)) {
            if (typeof produits !== 'object' || produits === null) continue;
            if (!Object.prototype.hasOwnProperty.call(produits, nom)) continue;
            const config = produits[nom];
            if (typeof config === 'object' && config !== null && typeof config.default === 'number') {
                return { categorie: cat, nom, config };
            }
        }
        return null;
    }
    // Fuzzy: scan case-insensitive (defaut historique)
    const target = String(nom).toLowerCase();
    for (const [cat, produits] of Object.entries(currentProduitsConfig)) {
        if (typeof produits !== 'object' || produits === null) continue;
        for (const [name, config] of Object.entries(produits)) {
            if (typeof config !== 'object' || typeof config.default !== 'number') continue;
            if (name.toLowerCase() === target) {
                return { categorie: cat, nom: name, config };
            }
        }
    }
    return null;
}

// Cherche un produit existant dans Inventaire par nom. Recherche recursive
// pour trouver aussi les produits niches dans des categories personnalisees
// (ex: currentInventaireConfig['MaCategorie'] = { produit1: {...} }).
// Retourne { nom, config, parent } ou parent = l'objet contenant le produit
// (root pour les produits flat, ou la categorie personnalisee). Les callers
// qui suppriment doivent utiliser `delete parent[nom]` plutot que de
// presumer le root.
//
// opts.exact: voir pumLookupPG. Idem semantique.
function pumLookupInv(nom, opts) {
    if (!currentInventaireConfig || !nom) return null;
    const exact = !!(opts && opts.exact);
    const target = exact ? String(nom) : String(nom).toLowerCase();
    // DFS: on parcourt root + sous-objets a 1 niveau (les categories
    // personnalisees). On ne va PAS plus profond car le format admin
    // ne supporte pas l'imbrication arbitraire.
    const visit = (container) => {
        // Object.entries n'enumere que les own properties enumerable donc
        // pas de leak du prototype. Mais on filtre quand meme via
        // hasOwnProperty.call par defense en profondeur (au cas ou un parent
        // serait Object.create(prototypePollue)).
        for (const [name, config] of Object.entries(container)) {
            if (!Object.prototype.hasOwnProperty.call(container, name)) continue;
            if (typeof config !== 'object' || config === null) continue;
            // Match: produit feuille avec prixDefault
            if (typeof config.prixDefault === 'number') {
                const isMatch = exact ? (name === target) : (name.toLowerCase() === target);
                if (isMatch) {
                    return { nom: name, config, parent: container };
                }
            }
            // Sinon, si c'est un container de categorie (objet sans
            // prixDefault), descendre dedans.
            if (config.prixDefault === undefined) {
                const hit = visit(config);
                if (hit) return hit;
            }
        }
        return null;
    };
    return visit(currentInventaireConfig);
}

// Detecte un conflit de nom dans Produits Generaux: retourne le hit existant
// si la sauvegarde a venir ecraserait un autre produit deja en place. Renvoie
// null si pas de conflit (rename de soi-meme, ou nom totalement nouveau).
// Case-insensitive (coherent avec pumLookupPG).
function pumDetectPGConflict(originalNom, nomPG, mode) {
    // Edit mode sans rename: pas de conflit possible (juste un update sur
    // place du meme produit)
    if (mode === 'edit' && originalNom === nomPG) return null;
    const hit = pumLookupPG(nomPG);
    if (!hit) return null;
    // En edit mode, si le hit est exactement l'entree d'origine (meme cle),
    // ce n'est pas un conflit — c'est juste l'entree qu'on s'apprete a
    // supprimer pour la remplacer. delete est case-sensitive donc on compare
    // l'exact match.
    if (mode === 'edit' && hit.nom === originalNom) return null;
    return hit; // { categorie, nom, config }
}

// Pareil pour l'Inventaire.
function pumDetectInvConflict(originalNom, nomInv, mode) {
    if (mode === 'edit' && originalNom === nomInv) return null;
    const hit = pumLookupInv(nomInv);
    if (!hit) return null;
    if (mode === 'edit' && hit.nom === originalNom) return null;
    return hit; // { nom, config, parent }
}

// Met a jour la banniere status selon les hits dans les 2 catalogues.
// Strategie a 2 niveaux:
// 1. Match EXACT (case-sensitive): "Existe dans X" — c'est le meme produit
// 2. Si pas d'exact, match FUZZY (case-insensitive): "Similaire dans X
//    («NomDifferent»)" — produit different a la casse pres, l'admin peut
//    vouloir le voir comme indice avant de creer une variante.
// Sans cet hint fuzzy, l'admin pourrait creer 'PASTA' sans savoir que
// 'Pasta' existe deja en BDD.
function pumUpdateStatus(nom) {
    const status = document.getElementById('pum-status');
    if (!status) return;
    const pg = pumLookupPG(nom, { exact: true });
    const inv = pumLookupInv(nom, { exact: true });
    // Hint fuzzy: SEULEMENT si pas d'exact (sinon on a deja l'info)
    const pgFuzzy = pg ? null : pumLookupPG(nom);
    const invFuzzy = inv ? null : pumLookupInv(nom);

    // escAttr couvre <,>,&,",' et fait office d'escape texte aussi
    const fmtExactPG = (h) => `<strong>Produits Généraux</strong> (${escAttr(h.categorie)}, ${h.config.default.toLocaleString('fr-FR')} FCFA)`;
    const fmtExactInv = (h) => `<strong>Inventaire</strong> (${h.config.prixDefault.toLocaleString('fr-FR')} FCFA)`;
    const fmtFuzzyPG = (h) => `<strong>Produits Généraux</strong> sous le nom <em>«${escAttr(h.nom)}»</em>`;
    const fmtFuzzyInv = (h) => `<strong>Inventaire</strong> sous le nom <em>«${escAttr(h.nom)}»</em>`;

    let html = '';
    if (pg && inv) {
        html = `<i class="bi bi-check-circle-fill text-success me-1"></i>
            Existe dans ${fmtExactPG(pg)} ET ${fmtExactInv(inv)}`;
    } else if (pg) {
        html = `<i class="bi bi-check-circle-fill text-success me-1"></i>
            Existe dans ${fmtExactPG(pg)}`;
        if (invFuzzy) {
            html += `<br><i class="bi bi-exclamation-triangle text-warning me-1"></i>
                <small>Produit similaire dans ${fmtFuzzyInv(invFuzzy)} — variante de casse</small>`;
        }
    } else if (inv) {
        html = `<i class="bi bi-check-circle-fill text-success me-1"></i>
            Existe dans ${fmtExactInv(inv)}`;
        if (pgFuzzy) {
            html += `<br><i class="bi bi-exclamation-triangle text-warning me-1"></i>
                <small>Produit similaire dans ${fmtFuzzyPG(pgFuzzy)} — variante de casse</small>`;
        }
    } else if (pgFuzzy || invFuzzy) {
        // Aucun match exact mais un fuzzy → avertir l'admin avant la creation
        const lignes = [];
        if (pgFuzzy) lignes.push(fmtFuzzyPG(pgFuzzy));
        if (invFuzzy) lignes.push(fmtFuzzyInv(invFuzzy));
        html = `<i class="bi bi-exclamation-triangle text-warning me-1"></i>
            Nouveau produit, mais un similaire existe : ${lignes.join(' / ')} — confirme que tu veux créer une variante.`;
    } else {
        html = `<i class="bi bi-info-circle text-primary me-1"></i>
            Nouveau produit — sera créé dans les catalogues cochés.`;
    }
    status.innerHTML = html;
}

// Ouvre le modal en mode 'add' ou 'edit'.
// mode='add' : data peut etre { srcDefault: 'pg'|'inv'|null, categorieDefault: '...' }
// mode='edit' : data = { src: 'pg'|'inv', nom, cat, prix }
function ouvrirModalProduitUnifie(mode, data) {
    data = data || {};
    const modalEl = document.getElementById('productUnifiedModal');
    if (!modalEl) return;

    document.getElementById('pum-mode').value = mode;
    const titleText = document.getElementById('pum-title-text');
    const saveLabel = document.getElementById('pum-save-label');
    const deleteBtn = document.getElementById('pum-delete-btn');

    // Pre-calcul des valeurs selectionnees pour pouvoir les passer a
    // pumPopulerSelect (qui injecte un optgroup "Ancienne categorie" si
    // la valeur n'est pas dans la liste standard — utile pour preserver
    // les categorie_affichage legacy comme 'Viandes', 'Déchets', etc.).
    let selPG = DEFAULT_CATEGORIE_PRODUITS_GENERAUX;
    let selInv = DEFAULT_CATEGORIE_INVENTAIRE;
    let pgHit = null;
    let invHit = null;

    if (mode === 'edit' && data.nom) {
        // Exact: on n'edite QUE le produit clique, pas une variante de casse
        pgHit = pumLookupPG(data.nom, { exact: true });
        invHit = pumLookupInv(data.nom, { exact: true });
        if (pgHit) selPG = pgHit.categorie;
        if (invHit && invHit.config.categorie_affichage) {
            selInv = invHit.config.categorie_affichage;
        }
    } else {
        // Mode 'add' avec defaut explicite
        if (data.categorieDefault && data.srcDefault === 'pg') selPG = data.categorieDefault;
        else if (data.categorieDefault && data.srcDefault === 'inv') selInv = data.categorieDefault;
    }

    // Populate selects avec les valeurs cibles
    pumPopulerSelect(
        document.getElementById('pum-cat-pg'),
        CATEGORIES_PRODUITS_GENERAUX,
        selPG
    );
    pumPopulerSelect(
        document.getElementById('pum-cat-inv'),
        CATEGORIES_INVENTAIRE,
        selInv
    );

    // Etat d'archivage par cote (PG / Inv) - permet de distinguer 3 cas:
    //  - both: les 2 cotes sont archives -> bouton "Desarchiver" (vert)
    //  - none: aucun cote archive -> bouton "Archiver" (jaune)
    //  - mixed: un seul cote archive -> 2 boutons (aligne en desarchive vert
    //    OU en archive jaune, l'admin choisit)
    // Si un cote n'existe pas (pgHit ou invHit null), on le considere comme
    // "non archive" — l'action portera uniquement sur le cote existant.
    const pgArchived = !!(pgHit && pgHit.config && pgHit.config.archived);
    const invArchived = !!(invHit && invHit.config && invHit.config.archived);
    const archiveBtn = document.getElementById('pum-archive-btn');
    const archiveLabel = document.getElementById('pum-archive-label');
    const archiveBtn2 = document.getElementById('pum-archive-btn-2');
    const archiveLabel2 = document.getElementById('pum-archive-label-2');

    // Si une seule des 2 entrees existe, le mixed n'a pas de sens (on
    // ne peut pas archiver/desarchiver un cote qui n'existe pas).
    const bothExist = !!(pgHit && invHit);
    const archivedState = bothExist
        ? (pgArchived && invArchived ? 'both' :
           (!pgArchived && !invArchived ? 'none' : 'mixed'))
        : (pgArchived || invArchived ? 'both' : 'none'); // single side -> traite comme both/none

    // Labels mixed: indiquent quel cote sera touche dans chaque direction
    const sideArchived = pgArchived ? 'Généraux' : 'Inventaire';
    const sideActive = pgArchived ? 'Inventaire' : 'Généraux';

    if (mode === 'edit' && data.nom) {
        const titleArchived = (archivedState === 'both') ? ' (archivé)' :
                              (archivedState === 'mixed' ? ` (archivé côté ${sideArchived})` : '');
        titleText.textContent = `Modifier «${data.nom}»${titleArchived}`;
        saveLabel.textContent = 'Enregistrer';
        deleteBtn.style.display = '';
        // Configuration des boutons archive selon l'etat
        if (archiveBtn) {
            // dataset.archivedState pour le caller (debug / autres handlers)
            archiveBtn.dataset.archivedState = archivedState;
            if (archivedState === 'both') {
                archiveBtn.style.display = '';
                archiveBtn.dataset.archiveTarget = 'false';
                archiveLabel.textContent = 'Désarchiver';
                archiveBtn.classList.remove('btn-outline-warning');
                archiveBtn.classList.add('btn-outline-success');
            } else if (archivedState === 'none') {
                archiveBtn.style.display = '';
                archiveBtn.dataset.archiveTarget = 'true';
                archiveLabel.textContent = 'Archiver';
                archiveBtn.classList.add('btn-outline-warning');
                archiveBtn.classList.remove('btn-outline-success');
            } else {
                // mixed: bouton principal = desarchiver le cote archive (default)
                archiveBtn.style.display = '';
                archiveBtn.dataset.archiveTarget = 'false';
                archiveLabel.textContent = `Désarchiver côté ${sideArchived}`;
                archiveBtn.classList.remove('btn-outline-warning');
                archiveBtn.classList.add('btn-outline-success');
            }
        }
        if (archiveBtn2) {
            if (archivedState === 'mixed') {
                // Bouton secondaire en mixed: archive le cote actif
                archiveBtn2.style.display = '';
                archiveBtn2.dataset.archiveTarget = 'true';
                archiveLabel2.textContent = `Archiver côté ${sideActive}`;
                archiveBtn2.classList.add('btn-outline-warning');
                archiveBtn2.classList.remove('btn-outline-success');
                // Icon: archive (yellow) plutot que arrow-counterclockwise
                const icon = archiveBtn2.querySelector('i');
                if (icon) {
                    icon.classList.remove('bi-arrow-counterclockwise');
                    icon.classList.add('bi-archive');
                }
            } else {
                archiveBtn2.style.display = 'none';
            }
        }
        document.getElementById('pum-original-nom').value = data.nom;

        const nom = data.nom;
        const prix = (data.src === 'pg' ? (pgHit && pgHit.config.default) :
                     (invHit && invHit.config.prixDefault)) || data.prix || 0;
        document.getElementById('pum-nom').value = nom;
        document.getElementById('pum-prix').value = prix;
        // Pre-fill override fields too
        document.getElementById('pum-nom-pg').value = pgHit ? pgHit.nom : nom;
        document.getElementById('pum-nom-inv').value = invHit ? invHit.nom : nom;
        document.getElementById('pum-prix-pg').value = pgHit ? pgHit.config.default : prix;
        document.getElementById('pum-prix-inv').value = invHit ? invHit.config.prixDefault : prix;
        // Cibles cochees selon existence
        document.getElementById('pum-target-pg').checked = !!pgHit;
        document.getElementById('pum-target-inv').checked = !!invHit;
    } else {
        // Mode 'add'
        titleText.textContent = 'Ajouter un nouveau produit';
        saveLabel.textContent = 'Ajouter';
        deleteBtn.style.display = 'none';
        if (archiveBtn) archiveBtn.style.display = 'none';
        if (archiveBtn2) archiveBtn2.style.display = 'none';
        document.getElementById('pum-original-nom').value = '';
        document.getElementById('pum-nom').value = '';
        document.getElementById('pum-prix').value = '';
        document.getElementById('pum-nom-pg').value = '';
        document.getElementById('pum-nom-inv').value = '';
        document.getElementById('pum-prix-pg').value = '';
        document.getElementById('pum-prix-inv').value = '';
        document.getElementById('pum-target-pg').checked = true;
        document.getElementById('pum-target-inv').checked = true;
    }

    // Mode de stock (Inventaire uniquement):
    // - En EDIT: prefill depuis invHit.config.mode_stock (preserve le choix
    //   existant, meme s'il "viole" la regle famille — l'admin peut avoir
    //   une raison metier specifique).
    // - En ADD: defaut base sur la categorie Inv choisie (regle famille
    //   Boucherie+Pack = manuel, autres = automatique).
    const modeStockSel = document.getElementById('pum-mode-stock');
    if (modeStockSel) {
        let initialMode;
        if (mode === 'edit' && invHit && invHit.config && invHit.config.mode_stock) {
            initialMode = invHit.config.mode_stock;
        } else {
            initialMode = pumDefaultModeStock(selInv);
        }
        modeStockSel.value = (initialMode === 'automatique') ? 'automatique' : 'manuel';
        // Reset le flag "user override": permet au changement de categorie
        // de re-appliquer le defaut tant que l'admin n'a pas touche le select.
        modeStockSel.dataset.userOverride = 'false';
        // Disabled si Inventaire pas coche (n'aura pas d'effet)
        pumSyncModeStockEnabled();
    }

    // Reset override toggle
    document.getElementById('pum-override-toggle').checked = false;
    document.getElementById('pum-override').style.display = 'none';

    // Update status banner
    pumUpdateStatus(document.getElementById('pum-nom').value);

    // Show
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
}

// Sauvegarde: cree/met a jour dans les catalogues coches.
// Modifie les configs cote client; le bouton global "Sauvegarder" sur
// chaque onglet ecrira en BDD ensuite. Ici on display-refresh + toast.
async function pumSave() {
    const mode = document.getElementById('pum-mode').value;
    const originalNom = document.getElementById('pum-original-nom').value || null;
    const nomShared = (document.getElementById('pum-nom').value || '').trim();
    const prixShared = parseFloat(document.getElementById('pum-prix').value) || 0;
    const catPG = document.getElementById('pum-cat-pg').value;
    const catInv = document.getElementById('pum-cat-inv').value;
    const targetPG = document.getElementById('pum-target-pg').checked;
    const targetInv = document.getElementById('pum-target-inv').checked;
    const overrideOn = document.getElementById('pum-override-toggle').checked;

    if (!nomShared) {
        showToast('Le nom est obligatoire', 'warning');
        return;
    }
    if (!targetPG && !targetInv) {
        showToast('Choisis au moins un catalogue', 'warning');
        return;
    }

    // Valeurs finales par catalogue
    const nomPG = overrideOn ? (document.getElementById('pum-nom-pg').value || nomShared).trim() : nomShared;
    const nomInv = overrideOn ? (document.getElementById('pum-nom-inv').value || nomShared).trim() : nomShared;
    const prixPG = overrideOn ? (parseFloat(document.getElementById('pum-prix-pg').value) || prixShared) : prixShared;
    const prixInv = overrideOn ? (parseFloat(document.getElementById('pum-prix-inv').value) || prixShared) : prixShared;

    // Detection de doublons: on ne reecrit JAMAIS les noms saisis par l'admin.
    // Si la sauvegarde a venir ecraserait une entree differente (meme nom dans
    // l'autre catalogue, ou nom existant lors d'un rename), on demande
    // confirmation explicite.
    const conflicts = [];
    if (targetPG) {
        const c = pumDetectPGConflict(originalNom, nomPG, mode);
        if (c) {
            conflicts.push({
                label: `Produits Généraux (catégorie « ${c.categorie} », ${c.config.default.toLocaleString('fr-FR')} FCFA)`,
                nom: c.nom
            });
        }
    }
    if (targetInv) {
        const c = pumDetectInvConflict(originalNom, nomInv, mode);
        if (c) {
            conflicts.push({
                label: `Inventaire (${c.config.prixDefault.toLocaleString('fr-FR')} FCFA)`,
                nom: c.nom
            });
        }
    }
    if (conflicts.length > 0) {
        const lines = conflicts.map(c => `• « ${c.nom} » dans ${c.label}`).join('\n');
        const msg = `Un produit avec ce nom existe déjà :\n\n${lines}\n\nVeux-tu écraser cette/ces entrée(s) ?`;
        const ok = typeof showConfirmModal === 'function'
            ? await showConfirmModal(msg, {
                title: 'Écraser le produit existant ?',
                okLabel: 'Écraser',
                okVariant: 'warning'
            })
            : confirm(msg);
        if (!ok) return; // pas de toast: l'utilisateur a annule volontairement
    }

    // Snapshot pour rollback en cas d'echec serveur
    const snapPG = JSON.parse(JSON.stringify(currentProduitsConfig || {}));
    const snapInv = JSON.parse(JSON.stringify(currentInventaireConfig || {}));

    let pgChanged = false;
    let invChanged = false;

    if (targetPG) {
        // Lookup de l'entree d'origine pour preserver les champs non touches
        // (prix_personnalise, inventaire_parent, prix vente speciaux, etc.).
        let baseConfigPG = {};
        if (mode === 'edit' && originalNom) {
            // Exact: on edite QUE le produit dont la cle == originalNom.
            // Une variante de casse (ex: 'PASTA' vs 'Pasta') est un produit
            // distinct qu'il ne faut pas toucher.
            const origHit = pumLookupPG(originalNom, { exact: true });
            if (origHit) baseConfigPG = origHit.config;
            // Supprimer l'ancienne entree si rename ou changement de categorie
            for (const [cat, produits] of Object.entries(currentProduitsConfig || {})) {
                if (typeof produits === 'object' && produits[originalNom]) {
                    if (cat !== catPG || originalNom !== nomPG) {
                        delete produits[originalNom];
                    }
                }
            }
        } else if (
            currentProduitsConfig[catPG] &&
            Object.prototype.hasOwnProperty.call(currentProduitsConfig[catPG], nomPG)
        ) {
            // Mode add avec conflit deja confirme: merger avec l'existant.
            // hasOwnProperty.call evite de matcher les cles du prototype
            // (defense contre prototype pollution si un produit s'appelle
            // 'constructor', '__proto__', etc.).
            const existing = currentProduitsConfig[catPG][nomPG];
            if (typeof existing === 'object' && existing !== null) baseConfigPG = existing;
        }
        // Alternatives: preserver l'array existant, ajouter prixPG si absent
        const altsPG = Array.isArray(baseConfigPG.alternatives) ? baseConfigPG.alternatives.slice() : [];
        if (!altsPG.includes(prixPG)) altsPG.push(prixPG);

        if (!currentProduitsConfig[catPG]) currentProduitsConfig[catPG] = {};
        currentProduitsConfig[catPG][nomPG] = {
            ...baseConfigPG,
            default: prixPG,
            alternatives: altsPG
        };
        pgChanged = true;
    }

    if (targetInv) {
        // Lookup recursif pour trouver l'entree d'origine (peut etre nichee
        // dans une categorie personnalisee). On preserve tous ses champs
        // (ventes, ventilation_poids, mode_stock, unite_stock, prix vente
        // PV-specific, etc.).
        let baseConfigInv = {};
        let origInvParent = null;
        let origInvNom = null;
        if (mode === 'edit' && originalNom) {
            // Exact: idem PG. Sans ca, un edit de 'Pomme De Terre Sac'
            // pourrait DELETE 'POMME DE TERRE SAC' (case-different produit
            // distinct) puis recreer une cle 'Pomme De Terre Sac' avec sa
            // config — corruption silencieuse.
            const origHit = pumLookupInv(originalNom, { exact: true });
            if (origHit) {
                baseConfigInv = origHit.config;
                origInvParent = origHit.parent;
                origInvNom = origHit.nom;
            }
        } else {
            // Mode add avec conflit potentiellement confirme: lookup recursif
            // exact pour merger avec l'existant. Sans recursion, un produit
            // niche dans une categorie personnalisee serait rate -> on
            // creerait un produit root parallele a son homonyme nested
            // (asymetrie avec le edit-mode qui utilise pumLookupInv recursif).
            const existingHit = pumLookupInv(nomInv, { exact: true });
            if (existingHit) {
                baseConfigInv = existingHit.config;
                origInvParent = existingHit.parent;
                origInvNom = existingHit.nom;
            }
        }
        // Supprimer l'ancien si:
        //  - rename: la cle change → on doit deplacer
        //  - match nested: on ecrit au root, donc on doit supprimer le nested
        //    pour eviter d'avoir 2 entrees du meme produit
        if (origInvParent && origInvNom) {
            const sameKey = origInvNom === nomInv;
            const isNested = origInvParent !== currentInventaireConfig;
            if (!sameKey || isNested) {
                delete origInvParent[origInvNom];
            }
        }
        // Alternatives: preserver + ajouter prixInv si absent
        const altsInv = Array.isArray(baseConfigInv.alternatives) ? baseConfigInv.alternatives.slice() : [];
        if (!altsInv.includes(prixInv)) altsInv.push(prixInv);

        // Mode de stock: valeur du select (override l'existant), fallback sur
        // baseConfigInv.mode_stock ou 'manuel'. Whitelist stricte pour ne pas
        // injecter une valeur arbitraire (la colonne DB est un ENUM).
        const modeStockEl = document.getElementById('pum-mode-stock');
        const requestedMode = modeStockEl ? modeStockEl.value : null;
        const modeStockFinal = (requestedMode === 'automatique' || requestedMode === 'manuel')
            ? requestedMode
            : (baseConfigInv.mode_stock || 'manuel');

        currentInventaireConfig[nomInv] = {
            ...baseConfigInv,
            prixDefault: prixInv,
            alternatives: altsInv,
            mode_stock: modeStockFinal,
            unite_stock: baseConfigInv.unite_stock || 'unite',
            categorie_affichage: catInv
        };
        invChanged = true;
    }

    // Disable boutons pendant la sauvegarde
    const saveBtn = document.getElementById('pum-save-btn');
    const delBtn = document.getElementById('pum-delete-btn');
    const cancelBtn = document.querySelector('#productUnifiedModal [data-bs-dismiss="modal"]');
    const closeBtn = document.querySelector('#productUnifiedModal .btn-close');
    const originalSaveHtml = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Sauvegarde…';
    }
    if (delBtn) delBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (closeBtn) closeBtn.disabled = true;

    // POST aux API existantes (qui sauvegardent + rechargent serveur).
    // Les fonctions sauvegarderConfigProduits/Inventaire affichent leurs
    // propres toasts en cas d'erreur reseau, mais on capture aussi ici
    // pour rollback de l'etat local.
    let serverOk = true;
    let serverError = null;
    try {
        if (pgChanged) {
            const resp = await fetch('/api/admin/config/produits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ produits: currentProduitsConfig })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                serverOk = false;
                serverError = data.message || data.error || `HTTP ${resp.status}`;
            }
        }
        if (serverOk && invChanged) {
            const resp = await fetch('/api/admin/config/produits-inventaire', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ produitsInventaire: currentInventaireConfig })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                serverOk = false;
                serverError = data.message || data.error || `HTTP ${resp.status}`;
            }
        }
        // Reload serveur (sync caches in-process) si tout est OK
        if (serverOk) {
            try {
                await fetch('/api/admin/reload-products', { method: 'POST', credentials: 'include' });
            } catch (_) { /* non bloquant */ }
        }
    } catch (err) {
        serverOk = false;
        serverError = err && err.message ? err.message : String(err);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalSaveHtml;
        }
        if (delBtn) delBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        if (closeBtn) closeBtn.disabled = false;
    }

    if (!serverOk) {
        // Rollback in-memory pour eviter qu'un refresh ulterieur ne perde
        // ou n'ecrase les vraies donnees serveur.
        currentProduitsConfig = snapPG;
        currentInventaireConfig = snapInv;
        // Si on a eu un partial save (PG ok, Inv ko), le serveur a la moitie
        // des changements. Refetch les configs depuis le serveur pour resync
        // l'etat local avec la realite. Operation defensive: meme si pas de
        // partial, refetch est idempotent (chargerConfig* re-affiche les
        // onglets et la recherche).
        try {
            if (typeof chargerConfigProduits === 'function') await chargerConfigProduits();
            if (typeof chargerConfigInventaire === 'function') await chargerConfigInventaire();
        } catch (_) { /* best effort */ }
        showToast(`Erreur de sauvegarde: ${serverError}`, 'danger');
        return; // modal reste ouvert pour que l'user puisse retry
    }

    // Refresh affichages onglets
    if (pgChanged && typeof afficherProduitsConfig === 'function') afficherProduitsConfig();
    if (invChanged && typeof afficherInventaireConfig === 'function') afficherInventaireConfig();

    // Refresh la recherche
    reconstruireFlatRecherche();
    updateRechercheCompteurs();
    if (typeof renderRechercheCategoriesFilter === 'function') {
        renderRechercheCategoriesFilter();
    }
    renderRechercheGrid();

    // Toast succes
    const where = [pgChanged && 'Généraux', invChanged && 'Inventaire'].filter(Boolean).join(' + ');
    const action = mode === 'edit' ? 'modifié' : 'ajouté';
    showToast(`Produit ${action} dans ${where} et sauvegardé.`, 'success');

    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('productUnifiedModal'));
    if (modal) modal.hide();
}

// Suppression dans les 2 catalogues (avec confirmation).
async function pumDelete() {
    const nom = document.getElementById('pum-original-nom').value;
    if (!nom) return;
    const ok = typeof showConfirmModal === 'function'
        ? await showConfirmModal(`Supprimer définitivement «${nom}» des 2 catalogues ?`, {
            title: 'Supprimer le produit', okLabel: 'Supprimer', okVariant: 'danger'
        })
        : confirm(`Supprimer "${nom}" des 2 catalogues ?`);
    if (!ok) return;

    // Snapshot pour rollback
    const snapPG = JSON.parse(JSON.stringify(currentProduitsConfig || {}));
    const snapInv = JSON.parse(JSON.stringify(currentInventaireConfig || {}));

    // Retirer de PG
    let pgChanged = false;
    for (const [cat, produits] of Object.entries(currentProduitsConfig || {})) {
        if (typeof produits === 'object' && produits[nom]) {
            delete produits[nom];
            pgChanged = true;
        }
    }
    // Retirer de Inv
    let invChanged = false;
    if (currentInventaireConfig && currentInventaireConfig[nom]) {
        delete currentInventaireConfig[nom];
        invChanged = true;
    }

    if (!pgChanged && !invChanged) {
        const modal = bootstrap.Modal.getInstance(document.getElementById('productUnifiedModal'));
        if (modal) modal.hide();
        return;
    }

    // Disable les boutons pendant la sauvegarde
    const saveBtn = document.getElementById('pum-save-btn');
    const delBtn = document.getElementById('pum-delete-btn');
    const originalDelHtml = delBtn ? delBtn.innerHTML : '';
    if (delBtn) {
        delBtn.disabled = true;
        delBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Suppression…';
    }
    if (saveBtn) saveBtn.disabled = true;

    // Persister la suppression cote serveur
    let serverOk = true;
    let serverError = null;
    try {
        if (pgChanged) {
            const resp = await fetch('/api/admin/config/produits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ produits: currentProduitsConfig })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                serverOk = false;
                serverError = data.message || data.error || `HTTP ${resp.status}`;
            }
        }
        if (serverOk && invChanged) {
            const resp = await fetch('/api/admin/config/produits-inventaire', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ produitsInventaire: currentInventaireConfig })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                serverOk = false;
                serverError = data.message || data.error || `HTTP ${resp.status}`;
            }
        }
        if (serverOk) {
            try {
                await fetch('/api/admin/reload-products', { method: 'POST', credentials: 'include' });
            } catch (_) { /* non bloquant */ }
        }
    } catch (err) {
        serverOk = false;
        serverError = err && err.message ? err.message : String(err);
    } finally {
        if (delBtn) {
            delBtn.disabled = false;
            delBtn.innerHTML = originalDelHtml;
        }
        if (saveBtn) saveBtn.disabled = false;
    }

    if (!serverOk) {
        currentProduitsConfig = snapPG;
        currentInventaireConfig = snapInv;
        // Idem pumSave: refetch defensif pour resync apres partial save.
        try {
            if (typeof chargerConfigProduits === 'function') await chargerConfigProduits();
            if (typeof chargerConfigInventaire === 'function') await chargerConfigInventaire();
        } catch (_) { /* best effort */ }
        showToast(`Erreur de suppression: ${serverError}`, 'danger');
        return; // modal reste ouvert
    }

    if (pgChanged && typeof afficherProduitsConfig === 'function') afficherProduitsConfig();
    if (invChanged && typeof afficherInventaireConfig === 'function') afficherInventaireConfig();
    reconstruireFlatRecherche();
    updateRechercheCompteurs();
    if (typeof renderRechercheCategoriesFilter === 'function') {
        renderRechercheCategoriesFilter();
    }
    renderRechercheGrid();

    showToast(`«${nom}» supprimé et sauvegardé.`, 'success');

    const modal = bootstrap.Modal.getInstance(document.getElementById('productUnifiedModal'));
    if (modal) modal.hide();
}

// Toggle archive: bascule le flag archived sur les 2 catalogues ou il existe.
// Soft-delete reversible — pas de confirmation aussi forte que pumDelete car
// l'operation est non destructive.
async function pumToggleArchive(evt) {
    const nom = document.getElementById('pum-original-nom').value;
    if (!nom) return;
    // Direction: lue depuis le bouton clique (data-archive-target='true'|'false').
    // En mixed state, il y a 2 boutons distincts (primary = desarchive,
    // secondary = archive) — chacun avec son propre target. evt.currentTarget
    // est le bouton clique.
    const btn = (evt && evt.currentTarget && evt.currentTarget.dataset && evt.currentTarget.dataset.archiveTarget !== undefined)
        ? evt.currentTarget
        : document.getElementById('pum-archive-btn');
    if (!btn) return;
    const targetArchived = btn.dataset.archiveTarget === 'true';
    const action = targetArchived ? 'Archiver' : 'Désarchiver';
    const actionPast = targetArchived ? 'archivé' : 'désarchivé';

    // Exact match obligatoire ici: l'admin a clique sur UN produit precis
    // (cle exacte). Un match fuzzy archiverait par accident une variante
    // de casse (ex: archiver 'Pomme De Terre Sac' ne doit pas toucher
    // 'POMME DE TERRE SAC' qui est un produit distinct en BDD).
    const pgHit = pumLookupPG(nom, { exact: true });
    const invHit = pumLookupInv(nom, { exact: true });
    if (!pgHit && !invHit) return; // rien a faire

    // Determine quels cotes vont REELLEMENT changer d'etat. Si un cote est
    // deja dans l'etat cible (ex: PG deja archive et user clique "Archiver"
    // parce que Inv ne l'est pas), on ne le touche pas et on ne le mentionne
    // pas dans le toast — sinon le message est trompeur.
    const pgWillChange = !!(pgHit && !!pgHit.config.archived !== targetArchived);
    const invWillChange = !!(invHit && !!invHit.config.archived !== targetArchived);
    if (!pgWillChange && !invWillChange) {
        showToast(`«${nom}» est déjà ${actionPast}.`, 'info');
        return;
    }

    const where = [pgWillChange && 'Généraux', invWillChange && 'Inventaire'].filter(Boolean).join(' + ');
    const explainArchive = targetArchived
        ? `\n\nLe produit ne sera plus affiché dans le POS, le stock inventaire, ni dans la recherche admin par défaut. Toutes les données historiques (ventes, prix, etc.) sont conservées.`
        : `\n\nLe produit redeviendra visible dans le POS et le stock inventaire.`;
    const ok = typeof showConfirmModal === 'function'
        ? await showConfirmModal(`${action} «${nom}» dans ${where} ?${explainArchive}`, {
            title: `${action} le produit`,
            okLabel: action,
            okVariant: targetArchived ? 'warning' : 'success'
        })
        : confirm(`${action} "${nom}" dans ${where} ?`);
    if (!ok) return;

    // Snapshot pour rollback
    const snapPG = JSON.parse(JSON.stringify(currentProduitsConfig || {}));
    const snapInv = JSON.parse(JSON.stringify(currentInventaireConfig || {}));

    // Set le flag en memoire SEULEMENT sur les cotes qui changent reellement.
    // Evite des POST inutiles (cf. plus bas: hasPgChanges = pgWillChange).
    if (pgWillChange) {
        const target = currentProduitsConfig[pgHit.categorie] && currentProduitsConfig[pgHit.categorie][pgHit.nom];
        if (target) target.archived = targetArchived;
    }
    if (invWillChange && invHit.parent) {
        invHit.parent[invHit.nom].archived = targetArchived;
    }

    // Disable boutons pendant la sauvegarde
    const saveBtn = document.getElementById('pum-save-btn');
    const delBtn = document.getElementById('pum-delete-btn');
    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> ${action}…`;
    if (saveBtn) saveBtn.disabled = true;
    if (delBtn) delBtn.disabled = true;

    let serverOk = true;
    let serverError = null;
    try {
        // POST uniquement sur les cotes qui ont change reellement (POST
        // inutile si le cote etait deja dans l'etat cible).
        if (pgWillChange) {
            const resp = await fetch('/api/admin/config/produits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ produits: currentProduitsConfig })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                serverOk = false;
                serverError = data.message || data.error || `HTTP ${resp.status}`;
            }
        }
        if (serverOk && invWillChange) {
            const resp = await fetch('/api/admin/config/produits-inventaire', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ produitsInventaire: currentInventaireConfig })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                serverOk = false;
                serverError = data.message || data.error || `HTTP ${resp.status}`;
            }
        }
        if (serverOk) {
            try {
                await fetch('/api/admin/reload-products', { method: 'POST', credentials: 'include' });
            } catch (_) { /* non bloquant */ }
        }
    } catch (err) {
        serverOk = false;
        serverError = err && err.message ? err.message : String(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalLabel;
        if (saveBtn) saveBtn.disabled = false;
        if (delBtn) delBtn.disabled = false;
    }

    if (!serverOk) {
        currentProduitsConfig = snapPG;
        currentInventaireConfig = snapInv;
        try {
            if (typeof chargerConfigProduits === 'function') await chargerConfigProduits();
            if (typeof chargerConfigInventaire === 'function') await chargerConfigInventaire();
        } catch (_) { /* best effort */ }
        showToast(`Erreur: ${serverError}`, 'danger');
        return;
    }

    // Refresh affichages
    if (typeof afficherProduitsConfig === 'function') afficherProduitsConfig();
    if (typeof afficherInventaireConfig === 'function') afficherInventaireConfig();
    reconstruireFlatRecherche();
    updateRechercheCompteurs();
    if (typeof renderRechercheCategoriesFilter === 'function') {
        renderRechercheCategoriesFilter();
    }
    renderRechercheGrid();

    showToast(`«${nom}» ${actionPast} dans ${where}.`, 'success');

    const modal = bootstrap.Modal.getInstance(document.getElementById('productUnifiedModal'));
    if (modal) modal.hide();
}

// Bind events du modal au load.
function initModalProduitUnifie() {
    const modalEl = document.getElementById('productUnifiedModal');
    if (!modalEl || modalEl.dataset.bound === 'true') return;
    modalEl.dataset.bound = 'true';

    // Toggle override section
    const toggle = document.getElementById('pum-override-toggle');
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            document.getElementById('pum-override').style.display = e.target.checked ? '' : 'none';
        });
    }

    // Sync nom / prix maîtres -> champs override
    const nomShared = document.getElementById('pum-nom');
    if (nomShared) {
        nomShared.addEventListener('input', (e) => {
            const v = e.target.value;
            document.getElementById('pum-nom-pg').value = v;
            document.getElementById('pum-nom-inv').value = v;
            pumUpdateStatus(v);
        });
    }
    const prixShared = document.getElementById('pum-prix');
    if (prixShared) {
        prixShared.addEventListener('input', (e) => {
            document.getElementById('pum-prix-pg').value = e.target.value;
            document.getElementById('pum-prix-inv').value = e.target.value;
        });
    }

    // Save + Delete + Archive
    const saveBtn = document.getElementById('pum-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', pumSave);
    const deleteBtn = document.getElementById('pum-delete-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', pumDelete);
    const archiveBtn = document.getElementById('pum-archive-btn');
    if (archiveBtn) archiveBtn.addEventListener('click', pumToggleArchive);
    // 2e bouton archive visible uniquement en etat "mixed" (un seul cote
    // archive). data-archive-target indique la direction de l'action.
    const archiveBtn2 = document.getElementById('pum-archive-btn-2');
    if (archiveBtn2) archiveBtn2.addEventListener('click', pumToggleArchive);

    // Sync l'enable du select Mode de stock avec la cible Inventaire.
    // Si l'admin decoche Inventaire, le select est griseé (pas de sens
    // de le configurer pour un produit qui n'ira pas dans Inventaire).
    const targetInv = document.getElementById('pum-target-inv');
    if (targetInv) {
        targetInv.addEventListener('change', pumSyncModeStockEnabled);
    }

    // Auto-application du defaut mode_stock selon la categorie Inv choisie
    // (regle famille Boucherie+Pack=manuel, autres=automatique). Ne se
    // declenche QUE si l'admin n'a pas explicitement touche le select.
    const catInvSel = document.getElementById('pum-cat-inv');
    const modeStockSel = document.getElementById('pum-mode-stock');
    if (catInvSel && modeStockSel) {
        catInvSel.addEventListener('change', (e) => {
            if (modeStockSel.dataset.userOverride === 'true') return;
            modeStockSel.value = pumDefaultModeStock(e.target.value);
        });
        // Quand l'admin change manuellement le mode_stock, on marque
        // l'override pour ne pas l'ecraser au prochain changement de cat.
        modeStockSel.addEventListener('change', () => {
            modeStockSel.dataset.userOverride = 'true';
        });
    }

    // Bouton "+ Ajouter un produit" sur l'onglet Recherche
    const addBtn = document.getElementById('recherche-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => ouvrirModalProduitUnifie('add'));
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModalProduitUnifie);
} else {
    initModalProduitUnifie();
} 