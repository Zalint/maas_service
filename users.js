const bcrypt = require('bcrypt');
const { User, PointVente } = require('./db/models');

// Variable globale pour stocker les utilisateurs en cache
let usersCache = [];
let cacheLoaded = false;

// Fonction pour charger les utilisateurs depuis la base de données
async function loadUsers() {
    console.log('=== CHARGEMENT DES UTILISATEURS DEPUIS LA BDD ===');
    
    try {
        const dbUsers = await User.findAll({
            include: [{
                model: PointVente,
                as: 'pointsVente',
                attributes: ['nom']
            }]
        });
        
        usersCache = dbUsers.map(u => ({
            id: u.id,
            username: u.username,
            password: u.password,
            role: u.role,
            pointVente: u.acces_tous_points ? 'tous' : (u.pointsVente?.map(pv => pv.nom) || []),
            active: u.active,
            default_screen: u.default_screen || null
        }));
        
        cacheLoaded = true;
        console.log(`✅ Utilisateurs chargés depuis la BDD: ${usersCache.length} utilisateurs`);
        console.log('Utilisateurs disponibles:', usersCache.map(u => u.username).join(', '));
        
        return usersCache;
    } catch (error) {
        console.error('❌ Erreur lors du chargement des utilisateurs depuis la BDD:', error.message);
        // Fallback: liste vide si erreur
        usersCache = [];
        cacheLoaded = true;
        return usersCache;
    }
}

// S'assurer que les utilisateurs sont chargés
async function ensureUsersLoaded() {
    if (!cacheLoaded) {
        await loadUsers();
    }
    return usersCache;
}

// Charger les utilisateurs au démarrage (appelé après que Sequelize soit initialisé)
setTimeout(async () => {
    try {
        await loadUsers();
    } catch (error) {
        console.error('Erreur lors du chargement initial des utilisateurs:', error);
    }
}, 1000);

// Fonction pour vérifier les identifiants
async function verifyCredentials(username, password) {
    console.log('Tentative de vérification pour:', username);
    
    // Charger depuis la BDD directement pour avoir les données les plus récentes
    try {
        const user = await User.findOne({
            where: { username },
            include: [{
                model: PointVente,
                as: 'pointsVente',
                attributes: ['nom']
            }]
        });
        
        if (!user) {
            console.log('Utilisateur non trouvé:', username);
            return null;
        }
        console.log('Utilisateur trouvé:', user.username);

        // Vérifier si l'utilisateur est actif
        if (!user.active) {
            console.log('Utilisateur inactif:', username);
            return null;
        }

        const isValid = await bcrypt.compare(password, user.password);
        console.log('Mot de passe valide:', isValid);
        
        if (!isValid) {
            console.log('Mot de passe invalide pour:', username);
            return null;
        }

        const pointVente = user.acces_tous_points ? 'tous' : (user.pointsVente?.map(pv => pv.nom) || []);
        const role = user.role;

        console.log('Authentification réussie pour:', username);
        return {
            username: user.username,
            role: role,
            pointVente: pointVente,
            active: user.active,
            default_screen: user.default_screen || null,
            // Rôles hiérarchiques
            isAdmin: role === 'admin',
            isSuperUtilisateur: role === 'superutilisateur',
            isSuperviseur: role === 'superviseur',
            isUtilisateur: role === 'user',
            isLecteur: role === 'lecteur',
            // Permissions basées sur les droits actuels
            canRead: ['lecteur', 'user', 'superutilisateur', 'superviseur', 'admin'].includes(role),
            canWrite: ['user', 'superutilisateur', 'superviseur', 'admin'].includes(role),
            canSupervise: ['superviseur', 'admin'].includes(role),
            canManageAdvanced: ['superutilisateur', 'superviseur', 'admin'].includes(role),
            canManageUsers: ['admin'].includes(role),
            
            // Droits spécifiques selon la hiérarchie actuelle
            canCopyStock: ['user', 'superutilisateur', 'superviseur', 'admin'].includes(role),
            canManageEstimation: ['superutilisateur', 'superviseur', 'admin'].includes(role),
            canAccessAllPointsVente: ['superutilisateur', 'superviseur', 'admin', 'lecteur'].includes(role) || user.acces_tous_points,
            canManageReconciliation: ['superutilisateur', 'superviseur', 'admin'].includes(role),
            
            // Droits PRIVILÉGIÉS - Superviseurs
            bypassTimeRestrictions: ['superviseur', 'admin'].includes(role),
            canModifyStockAnytime: ['superviseur', 'admin'].includes(role),
            canAddSalesAnytime: ['superviseur', 'admin'].includes(role),
            canImportSales: ['admin'].includes(role),
            canEmptyDatabase: false, // Désactivé pour tous pour sécurité
            canAccessChat: ['superutilisateur', 'superviseur', 'admin'].includes(role),
            canAccessSpecialFeatures: ['superviseur', 'admin'].includes(role),
            // Fonction utilitaire pour vérifier l'accès à un point de vente
            hasAccessToPointVente: function(pv) {
                // Les rôles élevés ont accès à tous les points de vente
                if (this.canAccessAllPointsVente) return true;
                
                if (!this.pointVente) return false;
                if (Array.isArray(this.pointVente)) {
                    return this.pointVente.includes('tous') || this.pointVente.includes(pv);
                }
                return this.pointVente === 'tous' || this.pointVente === pv;
            }
        };
    } catch (error) {
        console.error('Erreur lors de la vérification des identifiants:', error);
        return null;
    }
}

// Fonction pour créer un nouvel utilisateur
async function createUser(username, password, role, pointVente, active = true) {
    const existing = await User.findOne({ where: { username } });
    if (existing) {
        throw new Error('Username already exists');
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const acces_tous_points = pointVente === 'tous' || (Array.isArray(pointVente) && pointVente.includes('tous'));

    const newUser = await User.create({
        username,
        password: hashedPassword,
        role,
        acces_tous_points,
        active
    });

    // Associer les points de vente spécifiques si ce n'est pas "tous"
    if (!acces_tous_points) {
        const pvNames = Array.isArray(pointVente) ? pointVente : (pointVente ? [pointVente] : []);
        if (pvNames.length > 0) {
            const pvRecords = await PointVente.findAll({ where: { nom: pvNames } });
            await newUser.setPointsVente(pvRecords);
        }
    }

    // Recharger le cache
    await loadUsers();
    
    return {
        username: newUser.username,
        role: newUser.role,
        pointVente: acces_tous_points ? 'tous' : pointVente,
        active: newUser.active
    };
}

// Fonction pour mettre à jour un utilisateur
async function updateUser(username, updates) {
    const user = await User.findOne({ where: { username } });
    if (!user) {
        throw new Error('User not found');
    }

    if (updates.password) {
        const saltRounds = 10;
        updates.password = await bcrypt.hash(updates.password, saltRounds);
    }

    let pointVenteValue;
    if (updates.pointVente !== undefined) {
        pointVenteValue = updates.pointVente;
        updates.acces_tous_points = pointVenteValue === 'tous' || 
            (Array.isArray(pointVenteValue) && pointVenteValue.includes('tous'));
        delete updates.pointVente;
    }

    await user.update(updates);

    // Mettre à jour les associations points de vente
    if (pointVenteValue !== undefined) {
        if (updates.acces_tous_points) {
            // Supprimer toutes les associations spécifiques (l'accès total est géré par le flag)
            await user.setPointsVente([]);
        } else {
            const pvNames = Array.isArray(pointVenteValue) ? pointVenteValue : (pointVenteValue ? [pointVenteValue] : []);
            const pvRecords = pvNames.length > 0 ? await PointVente.findAll({ where: { nom: pvNames } }) : [];
            await user.setPointsVente(pvRecords);
        }
    }
    
    // Recharger le cache
    await loadUsers();
    
    return user;
}

// Fonction pour supprimer un utilisateur
async function deleteUser(username) {
    const user = await User.findOne({ where: { username } });
    if (!user) {
        throw new Error('User not found');
    }
    await user.destroy();
    
    // Recharger le cache
    await loadUsers();
}

// Fonction pour activer/désactiver un utilisateur
async function toggleUserStatus(username) {
    const user = await User.findOne({ where: { username } });
    if (!user) {
        throw new Error('User not found');
    }

    await user.update({ active: !user.active });
    
    // Recharger le cache
    await loadUsers();
    
    return {
        username: user.username,
        role: user.role,
        active: user.active
    };
}

// Fonction pour obtenir tous les utilisateurs (sans les mots de passe)
async function getAllUsers() {
    const users = await User.findAll({
        include: [{
            model: PointVente,
            as: 'pointsVente',
            attributes: ['nom']
        }]
    });
    
    return users.map(user => ({
        username: user.username,
        role: user.role,
        pointVente: user.acces_tous_points ? 'tous' : (user.pointsVente?.map(pv => pv.nom) || []),
        active: user.active,
        default_screen: user.default_screen || null
    }));
}

// Fonction pour recharger les utilisateurs depuis la BDD
async function reloadUsers() {
    await loadUsers();
}

module.exports = {
    verifyCredentials,
    createUser,
    updateUser,
    deleteUser,
    toggleUserStatus,
    getAllUsers,
    reloadUsers,
    loadUsers,
    ensureUsersLoaded
};
