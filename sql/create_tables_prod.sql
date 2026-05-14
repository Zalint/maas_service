-- =====================================================
-- SQL Script pour créer la base de données PRODUCTION
-- Application: Gestion des Ventes - KEUR BALI
-- Base de données: ventes_kb_prod
-- Date: Généré automatiquement
-- =====================================================

-- Supprimer les tables existantes si nécessaire (ATTENTION: décommenter seulement si nécessaire)
-- DROP TABLE IF EXISTS paiements_abonnement CASCADE;
-- DROP TABLE IF EXISTS clients_abonnes CASCADE;
-- DROP TABLE IF EXISTS payment_links CASCADE;
-- DROP TABLE IF EXISTS audit_client_logs CASCADE;
-- DROP TABLE IF EXISTS performance_achat CASCADE;
-- DROP TABLE IF EXISTS precommandes CASCADE;
-- DROP TABLE IF EXISTS estimations CASCADE;
-- DROP TABLE IF EXISTS weight_params CASCADE;
-- DROP TABLE IF EXISTS achats_boeuf CASCADE;
-- DROP TABLE IF EXISTS cash_payments CASCADE;
-- DROP TABLE IF EXISTS reconciliations CASCADE;
-- DROP TABLE IF EXISTS transferts CASCADE;
-- DROP TABLE IF EXISTS stocks CASCADE;
-- DROP TABLE IF EXISTS ventes CASCADE;

-- =====================================================
-- CRÉATION DES TYPES ENUM
-- =====================================================

-- Type pour le statut des clients abonnés
DO $$ BEGIN
    CREATE TYPE statut_client AS ENUM ('actif', 'inactif');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Type pour le statut des pré-commandes
DO $$ BEGIN
    CREATE TYPE statut_precommande AS ENUM ('ouvert', 'convertie', 'annulee', 'archivee');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- TABLE: ventes
-- Description: Enregistre toutes les transactions de vente
-- =====================================================
CREATE TABLE IF NOT EXISTS ventes (
    id SERIAL PRIMARY KEY,
    mois VARCHAR(255) NOT NULL,
    date VARCHAR(255) NOT NULL,
    semaine VARCHAR(255),
    point_vente VARCHAR(255) NOT NULL,
    preparation VARCHAR(255),
    categorie VARCHAR(255) NOT NULL,
    produit VARCHAR(255) NOT NULL,
    prix_unit FLOAT NOT NULL,
    nombre FLOAT NOT NULL DEFAULT 0,
    montant FLOAT NOT NULL DEFAULT 0,
    nom_client VARCHAR(255),
    numero_client VARCHAR(255),
    adresse_client VARCHAR(255),
    creance BOOLEAN NOT NULL DEFAULT FALSE,
    client_abonne_id INTEGER,
    prix_normal DECIMAL(10, 2),
    rabais_applique DECIMAL(10, 2),
    extension JSONB,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_ventes_date ON ventes(date);
CREATE INDEX IF NOT EXISTS idx_ventes_point_vente ON ventes(point_vente);
CREATE INDEX IF NOT EXISTS idx_ventes_mois ON ventes(mois);
CREATE INDEX IF NOT EXISTS idx_ventes_client_abonne_id ON ventes(client_abonne_id);

-- =====================================================
-- TABLE: stocks
-- Description: Stocke les informations d'inventaire (matin et soir)
-- =====================================================
CREATE TABLE IF NOT EXISTS stocks (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL,
    type_stock VARCHAR(255) NOT NULL,
    point_vente VARCHAR(255) NOT NULL,
    produit VARCHAR(255) NOT NULL,
    quantite FLOAT NOT NULL DEFAULT 0,
    prix_unitaire FLOAT NOT NULL DEFAULT 0,
    total FLOAT NOT NULL DEFAULT 0,
    commentaire TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_stocks_date ON stocks(date);
CREATE INDEX IF NOT EXISTS idx_stocks_point_vente ON stocks(point_vente);
CREATE INDEX IF NOT EXISTS idx_stocks_type_stock ON stocks(type_stock);

-- =====================================================
-- TABLE: transferts
-- Description: Gère les mouvements de stock entre points de vente
-- =====================================================
CREATE TABLE IF NOT EXISTS transferts (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL,
    point_vente VARCHAR(255) NOT NULL,
    produit VARCHAR(255) NOT NULL,
    quantite FLOAT NOT NULL DEFAULT 0,
    prix_unitaire FLOAT NOT NULL DEFAULT 0,
    total FLOAT NOT NULL DEFAULT 0,
    impact VARCHAR(255) NOT NULL,
    commentaire TEXT,
    extension JSONB DEFAULT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN transferts.extension IS 'Données enrichies. Ex: { "calibres": [{ "poids_kg": 1.4, "quantite": 12 }, ...] } pour les produits avec ventilation_poids=true';

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_transferts_date ON transferts(date);
CREATE INDEX IF NOT EXISTS idx_transferts_point_vente ON transferts(point_vente);

-- Colonne ajoutee pour le stock soir auto-calcule (idempotent).
-- Voir db/update-schema.js pour la migration en place sur tenants existants.
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS is_auto_calculated BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN stocks.is_auto_calculated IS 'TRUE: stock soir derive auto (matin + transferts - ventes) pour produits mode_stock=automatique. FALSE: saisie manuelle / override.';

-- =====================================================
-- TABLE: reconciliations
-- Description: Stocke les données de réconciliation journalière
-- =====================================================
CREATE TABLE IF NOT EXISTS reconciliations (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL UNIQUE,
    data TEXT NOT NULL,
    "cashPaymentData" TEXT,
    comments TEXT,
    calculated BOOLEAN DEFAULT TRUE,
    version INTEGER DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index unique sur la date
CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliations_date ON reconciliations(date);

-- =====================================================
-- TABLE: cash_payments
-- Description: Stocke les paiements en espèces et mobile money
-- =====================================================
CREATE TABLE IF NOT EXISTS cash_payments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    amount FLOAT NOT NULL,
    merchant_fee FLOAT,
    customer_fee FLOAT,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(255),
    entete_trans_type VARCHAR(255),
    psp_name VARCHAR(255),
    payment_category VARCHAR(255),
    payment_means VARCHAR(255),
    payment_reference VARCHAR(255),
    merchant_reference VARCHAR(255),
    trn_status VARCHAR(255),
    tr_id VARCHAR(255),
    cust_country VARCHAR(255),
    aggregation_mt VARCHAR(255),
    total_nom_marchand VARCHAR(255),
    total_marchand VARCHAR(255),
    merchant_id VARCHAR(255),
    name_first VARCHAR(255),
    point_de_vente VARCHAR(255),
    date DATE,
    reference VARCHAR(255),
    comment TEXT,
    is_manual BOOLEAN DEFAULT FALSE,
    created_by VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_cash_payments_date ON cash_payments(date);
CREATE INDEX IF NOT EXISTS idx_cash_payments_point_de_vente ON cash_payments(point_de_vente);

-- =====================================================
-- TABLE: achats_boeuf
-- Description: Suivi des achats de bœuf
-- =====================================================
CREATE TABLE IF NOT EXISTS achats_boeuf (
    id SERIAL PRIMARY KEY,
    mois VARCHAR(255),
    date DATE NOT NULL,
    bete VARCHAR(255),
    prix FLOAT,
    abats FLOAT DEFAULT 0,
    frais_abattage FLOAT DEFAULT 0,
    nbr_kg FLOAT,
    prix_achat_kg FLOAT,
    prix_achat_kg_sans_abats FLOAT,
    commentaire TEXT,
    annee INTEGER,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_achats_boeuf_date ON achats_boeuf(date);
CREATE INDEX IF NOT EXISTS idx_achats_boeuf_mois ON achats_boeuf(mois);

-- =====================================================
-- TABLE: weight_params
-- Description: Paramètres de poids par animal pour la réconciliation
-- =====================================================
CREATE TABLE IF NOT EXISTS weight_params (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL UNIQUE,
    boeuf_kg_per_unit FLOAT NOT NULL DEFAULT 150,
    veau_kg_per_unit FLOAT NOT NULL DEFAULT 110,
    agneau_kg_per_unit FLOAT NOT NULL DEFAULT 10,
    poulet_kg_per_unit FLOAT NOT NULL DEFAULT 1.5,
    default_kg_per_unit FLOAT NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index unique sur la date
CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_params_date ON weight_params(date);

-- =====================================================
-- TABLE: precommandes
-- Description: Gestion des pré-commandes clients
-- =====================================================
CREATE TABLE IF NOT EXISTS precommandes (
    id SERIAL PRIMARY KEY,
    mois VARCHAR(255) NOT NULL,
    date_enregistrement VARCHAR(255) NOT NULL,
    date_reception VARCHAR(255) NOT NULL,
    semaine VARCHAR(255),
    point_vente VARCHAR(255) NOT NULL,
    preparation VARCHAR(255),
    categorie VARCHAR(255) NOT NULL,
    produit VARCHAR(255) NOT NULL,
    prix_unit FLOAT NOT NULL,
    nombre FLOAT NOT NULL DEFAULT 0,
    montant FLOAT NOT NULL DEFAULT 0,
    nom_client VARCHAR(255),
    numero_client VARCHAR(255),
    adresse_client VARCHAR(255),
    commentaire TEXT,
    label VARCHAR(255),
    statut VARCHAR(20) NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'convertie', 'annulee', 'archivee')),
    commentaire_statut TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_precommandes_date_reception ON precommandes(date_reception);
CREATE INDEX IF NOT EXISTS idx_precommandes_point_vente ON precommandes(point_vente);
CREATE INDEX IF NOT EXISTS idx_precommandes_statut ON precommandes(statut);

-- =====================================================
-- TABLE: estimations
-- Description: Estimations de ventes et stocks
-- =====================================================
CREATE TABLE IF NOT EXISTS estimations (
    id SERIAL PRIMARY KEY,
    date VARCHAR(255) NOT NULL,
    point_vente VARCHAR(255) NOT NULL,
    categorie VARCHAR(255),
    produit VARCHAR(255),
    stock_matin FLOAT DEFAULT 0,
    stock_matin_original FLOAT DEFAULT 0,
    transfert FLOAT DEFAULT 0,
    transfert_original FLOAT DEFAULT 0,
    stock_soir FLOAT DEFAULT 0,
    stock_soir_original FLOAT DEFAULT 0,
    pre_commande_demain FLOAT DEFAULT 0,
    prevision_ventes FLOAT DEFAULT 0,
    difference FLOAT DEFAULT 0,
    stock_modified BOOLEAN DEFAULT FALSE,
    ventes_theoriques FLOAT,
    commentaire TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_estimations_date ON estimations(date);
CREATE INDEX IF NOT EXISTS idx_estimations_point_vente ON estimations(point_vente);

-- =====================================================
-- TABLE: clients_abonnes
-- Description: Clients avec abonnement
-- =====================================================
CREATE TABLE IF NOT EXISTS clients_abonnes (
    id SERIAL PRIMARY KEY,
    abonne_id VARCHAR(20) NOT NULL UNIQUE,
    prenom VARCHAR(100) NOT NULL,
    nom VARCHAR(100) NOT NULL,
    telephone VARCHAR(20) NOT NULL UNIQUE,
    adresse TEXT,
    position_gps VARCHAR(255),
    lien_google_maps TEXT,
    point_vente_defaut VARCHAR(50) NOT NULL,
    statut VARCHAR(20) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
    date_inscription DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_abonnes_abonne_id ON clients_abonnes(abonne_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_abonnes_telephone ON clients_abonnes(telephone);
CREATE INDEX IF NOT EXISTS idx_clients_abonnes_point_vente ON clients_abonnes(point_vente_defaut);
CREATE INDEX IF NOT EXISTS idx_clients_abonnes_statut ON clients_abonnes(statut);
CREATE INDEX IF NOT EXISTS idx_clients_abonnes_date_inscription ON clients_abonnes(date_inscription);

-- =====================================================
-- TABLE: paiements_abonnement
-- Description: Paiements des abonnements clients
-- =====================================================
CREATE TABLE IF NOT EXISTS paiements_abonnement (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients_abonnes(id) ON DELETE CASCADE ON UPDATE CASCADE,
    mois VARCHAR(7) NOT NULL,
    montant DECIMAL(10, 2) NOT NULL DEFAULT 5000 CHECK (montant >= 0),
    date_paiement DATE NOT NULL,
    mode_paiement VARCHAR(50),
    payment_link_id VARCHAR(255),
    reference VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_client_mois UNIQUE (client_id, mois)
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_paiements_abonnement_client_id ON paiements_abonnement(client_id);
CREATE INDEX IF NOT EXISTS idx_paiements_abonnement_mois ON paiements_abonnement(mois);
CREATE INDEX IF NOT EXISTS idx_paiements_abonnement_date_paiement ON paiements_abonnement(date_paiement);

-- =====================================================
-- TABLE: payment_links
-- Description: Liens de paiement générés
-- =====================================================
CREATE TABLE IF NOT EXISTS payment_links (
    id SERIAL PRIMARY KEY,
    payment_link_id VARCHAR(255) NOT NULL UNIQUE,
    point_vente VARCHAR(255) NOT NULL,
    client_name VARCHAR(255),
    phone_number VARCHAR(50),
    address TEXT,
    amount DECIMAL(12, 2) NOT NULL CHECK (amount >= 0.01),
    currency VARCHAR(10) NOT NULL DEFAULT 'XOF',
    reference VARCHAR(255) NOT NULL,
    description TEXT,
    payment_url TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'opened',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    due_date TIMESTAMP WITH TIME ZONE,
    archived INTEGER NOT NULL DEFAULT 0,
    is_abonnement BOOLEAN NOT NULL DEFAULT FALSE,
    client_abonne_id INTEGER
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_payment_links_payment_link_id ON payment_links(payment_link_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_archived ON payment_links(archived);
CREATE INDEX IF NOT EXISTS idx_payment_links_point_vente ON payment_links(point_vente);
CREATE INDEX IF NOT EXISTS idx_payment_links_created_at ON payment_links(created_at);

-- =====================================================
-- TABLE: performance_achat
-- Description: Performance des acheteurs (estimation vs réalité)
-- =====================================================
CREATE TABLE IF NOT EXISTS performance_achat (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    id_acheteur VARCHAR(50) NOT NULL,
    bete VARCHAR(20) NOT NULL,
    poids_estime FLOAT,
    poids_estime_timestamp TIMESTAMP WITH TIME ZONE,
    poids_estime_updated_by VARCHAR(100),
    poids_reel FLOAT,
    poids_reel_timestamp TIMESTAMP WITH TIME ZONE,
    poids_reel_updated_by VARCHAR(100),
    locked BOOLEAN DEFAULT FALSE,
    prix FLOAT,
    commentaire TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_performance_achat_date_bete ON performance_achat(date, bete);
CREATE INDEX IF NOT EXISTS idx_performance_achat_id_acheteur ON performance_achat(id_acheteur);
CREATE INDEX IF NOT EXISTS idx_performance_achat_date ON performance_achat(date);

-- =====================================================
-- TABLE: audit_client_logs
-- Description: Logs d'audit des recherches clients
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_client_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    username VARCHAR(100) NOT NULL,
    point_de_vente VARCHAR(100),
    phone_number_searched VARCHAR(20) NOT NULL,
    client_name VARCHAR(255),
    search_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consultation_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consultation_end TIMESTAMP WITH TIME ZONE,
    consultation_duration_seconds INTEGER,
    search_success BOOLEAN NOT NULL DEFAULT TRUE,
    total_orders_found INTEGER DEFAULT 0,
    error_message TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_audit_client_logs_username ON audit_client_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_client_logs_phone ON audit_client_logs(phone_number_searched);
CREATE INDEX IF NOT EXISTS idx_audit_client_logs_timestamp ON audit_client_logs(search_timestamp);

-- =====================================================
-- TABLE: users
-- Description: Utilisateurs de l'application
-- =====================================================
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'superutilisateur', 'superviseur', 'user');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'user',
    acces_tous_points BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Insérer l'utilisateur ADMIN par défaut (mot de passe: Mata@2024)
INSERT INTO users (username, password, role, acces_tous_points, active)
VALUES ('ADMIN', '$2b$10$xguWJPdt1P2WhUXi1ZpfWuG2OrcaIj52G.lbLpR2Y1SVSAh2g2.lS', 'admin', TRUE, TRUE)
ON CONFLICT (username) DO NOTHING;

-- =====================================================
-- TABLE: points_vente
-- Description: Points de vente de l'entreprise
-- =====================================================
CREATE TABLE IF NOT EXISTS points_vente (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    payment_ref VARCHAR(20) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE UNIQUE INDEX IF NOT EXISTS idx_points_vente_nom ON points_vente(nom);
CREATE UNIQUE INDEX IF NOT EXISTS idx_points_vente_payment_ref ON points_vente(payment_ref);

-- Insérer le point de vente "Dépôt central" par défaut (PV source / receptions
-- partenaires - anciennement nommé "Abattage"). Les autres peuvent être créés via l'admin.
-- Idempotent via payment_ref (l'identifiant stable). Permet de rebaptiser
-- automatiquement une row legacy 'Abattage' -> 'Dépôt central' sans collision
-- sur l'index unique payment_ref.
INSERT INTO points_vente (nom, active, payment_ref) VALUES ('Dépôt central', TRUE, 'V_ABATS') ON CONFLICT (payment_ref) DO UPDATE SET nom = 'Dépôt central', active = TRUE;

-- =====================================================
-- TABLE: user_points_vente
-- Description: Association N:N entre utilisateurs et points de vente
-- =====================================================
CREATE TABLE IF NOT EXISTS user_points_vente (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    point_vente_id INTEGER NOT NULL REFERENCES points_vente(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_point_vente UNIQUE (user_id, point_vente_id)
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_user_points_vente_user_id ON user_points_vente(user_id);
CREATE INDEX IF NOT EXISTS idx_user_points_vente_point_vente_id ON user_points_vente(point_vente_id);

-- =====================================================
-- TABLE: categories
-- Description: Catégories de produits (Bovin, Ovin, Volaille, etc.)
-- =====================================================
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(50) NOT NULL UNIQUE,
    ordre INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_nom ON categories(nom);

-- Insérer les catégories par défaut
INSERT INTO categories (nom, ordre) VALUES ('Bovin', 1) ON CONFLICT (nom) DO NOTHING;
INSERT INTO categories (nom, ordre) VALUES ('Ovin', 2) ON CONFLICT (nom) DO NOTHING;
INSERT INTO categories (nom, ordre) VALUES ('Volaille', 3) ON CONFLICT (nom) DO NOTHING;
INSERT INTO categories (nom, ordre) VALUES ('Pack', 4) ON CONFLICT (nom) DO NOTHING;
INSERT INTO categories (nom, ordre) VALUES ('Caprin', 5) ON CONFLICT (nom) DO NOTHING;
INSERT INTO categories (nom, ordre) VALUES ('Autres', 6) ON CONFLICT (nom) DO NOTHING;

-- =====================================================
-- TABLE: produits
-- Description: Catalogue de produits (vente, abonnement, inventaire)
-- =====================================================
DO $$ BEGIN
    CREATE TYPE type_catalogue AS ENUM ('vente', 'abonnement', 'inventaire');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE mode_stock_type AS ENUM ('manuel', 'automatique');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE unite_stock_type AS ENUM ('unite', 'kilo');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS produits (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100) NOT NULL,
    categorie_id INTEGER REFERENCES categories(id) ON DELETE SET NULL ON UPDATE CASCADE,
    type_catalogue type_catalogue NOT NULL,
    prix_defaut DECIMAL(10, 2) NOT NULL DEFAULT 0,
    prix_alternatifs DECIMAL(10, 2)[] DEFAULT '{}',
    mode_stock mode_stock_type NOT NULL DEFAULT 'manuel',
    unite_stock unite_stock_type NOT NULL DEFAULT 'unite',
    categorie_affichage VARCHAR(100),
    ventilation_poids BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_produit_type UNIQUE (nom, type_catalogue)
);

COMMENT ON COLUMN produits.ventilation_poids IS 'Inventaire: si TRUE, les transferts de ce produit acceptent une ventilation par calibre (poids_kg + quantite) dans transferts.extension.calibres';

-- Commentaire pour la colonne categorie_affichage
COMMENT ON COLUMN produits.categorie_affichage IS 'Catégorie personnalisée pour l''affichage dans l''admin inventaire (ex: Conserve, Boissons)';

-- Commentaires pour les colonnes de gestion de stock
COMMENT ON COLUMN produits.mode_stock IS 'Mode de gestion: manuel (pesée quotidienne) ou automatique (décrément par vente)';
COMMENT ON COLUMN produits.unite_stock IS 'Unité de mesure: unite (pièces/bouteilles) ou kilo (poids en kg)';

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_produits_categorie_id ON produits(categorie_id);
CREATE INDEX IF NOT EXISTS idx_produits_type_catalogue ON produits(type_catalogue);

-- =====================================================
-- INSERTION DES PRODUITS PAR DÉFAUT
-- =====================================================

-- Produits de VENTE - Catégorie Bovin
INSERT INTO produits (nom, categorie_id, type_catalogue, prix_defaut, prix_alternatifs) VALUES 
    ('Abats', 1, 'vente', 1000, '{1000,1500}'),
    ('Boeuf en détail', 1, 'vente', 3700, '{3700,3600}'),
    ('Boeuf en gros', 1, 'vente', 3500, '{3500,3400}'),
    ('Boeuf sur pied', 1, 'vente', 0, '{}'),
    ('Coeur', 1, 'vente', 2000, '{2000}'),
    ('Dechet', 1, 'vente', 1000, '{1000}'),
    ('Faux Filet', 1, 'vente', 3500, '{3500}'),
    ('Filet', 1, 'vente', 5000, '{5000,4000,7000}'),
    ('Foie', 1, 'vente', 3000, '{3000,4000}'),
    ('Jarret', 1, 'vente', 250, '{250}'),
    ('Merguez', 1, 'vente', 4500, '{4500}'),
    ('Peaux', 1, 'vente', 6000, '{6000}'),
    ('Sans Os', 1, 'vente', 4500, '{4500,4000}'),
    ('Tete de Boeuf', 1, 'vente', 10000, '{10000}'),
    ('Veau en détail', 1, 'vente', 3900, '{3900,3800}'),
    ('Veau en gros', 1, 'vente', 3700, '{3700,3600}'),
    ('Veau sur pied', 1, 'vente', 0, '{}'),
    ('Viande hachée', 1, 'vente', 5000, '{5000}'),
    ('Yell', 1, 'vente', 2000, '{2000,2500}'),
    ('Faux filet', 1, 'vente', 5000, '{5000}')
ON CONFLICT (nom, type_catalogue) DO NOTHING;

-- Produits de VENTE - Catégorie Ovin
INSERT INTO produits (nom, categorie_id, type_catalogue, prix_defaut, prix_alternatifs) VALUES 
    ('Agneau', 2, 'vente', 4500, '{4500}'),
    ('Mouton sur pied', 2, 'vente', 0, '{}'),
    ('Tete Agneau', 2, 'vente', 1000, '{1000,1500}')
ON CONFLICT (nom, type_catalogue) DO NOTHING;

-- Produits de VENTE - Catégorie Volaille
INSERT INTO produits (nom, categorie_id, type_catalogue, prix_defaut, prix_alternatifs) VALUES 
    ('Merguez poulet', 3, 'vente', 5500, '{5500}'),
    ('Oeuf', 3, 'vente', 2800, '{2800,2900}'),
    ('Pack Pigeon', 3, 'vente', 2500, '{2500,2000}'),
    ('Pilon', 3, 'vente', 3500, '{3500}'),
    ('Poulet en détail', 3, 'vente', 3500, '{3500,3000,3700}'),
    ('Poulet en gros', 3, 'vente', 3000, '{3000,3300}')
ON CONFLICT (nom, type_catalogue) DO NOTHING;

-- Produits de VENTE - Catégorie Pack
INSERT INTO produits (nom, categorie_id, type_catalogue, prix_defaut, prix_alternatifs) VALUES 
    ('Pack100000', 4, 'vente', 100000, '{100000}'),
    ('Pack20000', 4, 'vente', 20000, '{20000}'),
    ('Pack25000', 4, 'vente', 25000, '{25000}'),
    ('Pack30000', 4, 'vente', 30000, '{30000}'),
    ('Pack35000', 4, 'vente', 35000, '{35000}'),
    ('Pack50000', 4, 'vente', 50000, '{50000}'),
    ('Pack75000', 4, 'vente', 75000, '{75000}')
ON CONFLICT (nom, type_catalogue) DO NOTHING;

-- Produits de VENTE - Catégorie Caprin
INSERT INTO produits (nom, categorie_id, type_catalogue, prix_defaut, prix_alternatifs) VALUES 
    ('Chevre sur pied', 5, 'vente', 4000, '{4000}')
ON CONFLICT (nom, type_catalogue) DO NOTHING;

-- Produits de VENTE - Catégorie Autres
INSERT INTO produits (nom, categorie_id, type_catalogue, prix_defaut, prix_alternatifs) VALUES 
    ('Autre viande', 6, 'vente', 3000, '{3000,4000,5000}'),
    ('Produit divers', 6, 'vente', 0, '{0}'),
    ('Service', 6, 'vente', 1000, '{1000,2000,5000,10000}')
ON CONFLICT (nom, type_catalogue) DO NOTHING;

-- Produits d'INVENTAIRE (sans catégorie)
INSERT INTO produits (nom, categorie_id, type_catalogue, prix_defaut, prix_alternatifs) VALUES
    ('Boeuf', NULL, 'inventaire', 3500, '{3500,3400,3600,3700}'),
    ('Veau', NULL, 'inventaire', 3700, '{3700,3600,3800,3900}'),
    ('Agneau', NULL, 'inventaire', 4500, '{4500,4000,5000}'),
    ('Poulet', NULL, 'inventaire', 3500, '{3500,3000,3700}'),
    ('Tablette Oeuf', NULL, 'inventaire', 2800, '{2800,2900,3000}'),
    ('Foie', NULL, 'inventaire', 3000, '{3000,4000}'),
    ('Abats', NULL, 'inventaire', 1000, '{1000,1500}'),
    ('Peaux', NULL, 'inventaire', 6000, '{6000}'),
    ('Yell', NULL, 'inventaire', 2000, '{2000,2500}'),
    ('Dechet', NULL, 'inventaire', 1000, '{1000}')
ON CONFLICT (nom, type_catalogue) DO NOTHING;

-- Activer la ventilation par calibre pour Poulet sur les fresh installs.
-- Aligne le comportement avec db/update-schema.js qui fait pareil pour les
-- tenants existants. Idempotent.
UPDATE produits SET ventilation_poids = TRUE
 WHERE nom = 'Poulet' AND type_catalogue = 'inventaire' AND ventilation_poids = FALSE;

-- =====================================================
-- TABLE: stock_auto
-- Description: Stock actuel des produits en mode automatique
-- =====================================================
DO $$ BEGIN
    CREATE TYPE type_ajustement_stock AS ENUM ('livraison', 'perte', 'inventaire', 'correction', 'transfert_entree', 'transfert_sortie', 'initialisation');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS stock_auto (
    id SERIAL PRIMARY KEY,
    produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE ON UPDATE CASCADE,
    point_vente_id INTEGER NOT NULL REFERENCES points_vente(id) ON DELETE CASCADE ON UPDATE CASCADE,
    quantite DECIMAL(10, 3) NOT NULL DEFAULT 0,
    prix_unitaire DECIMAL(10, 2) NOT NULL DEFAULT 0,
    dernier_ajustement_type VARCHAR(50),
    dernier_ajustement_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_stock_auto_produit_point_vente UNIQUE (produit_id, point_vente_id)
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_stock_auto_produit_id ON stock_auto(produit_id);
CREATE INDEX IF NOT EXISTS idx_stock_auto_point_vente_id ON stock_auto(point_vente_id);

-- Commentaires
COMMENT ON TABLE stock_auto IS 'Stock actuel des produits en mode automatique, décrémenté automatiquement lors des ventes';
COMMENT ON COLUMN stock_auto.quantite IS 'Quantité actuelle (peut être négative si stock à découvert)';
COMMENT ON COLUMN stock_auto.dernier_ajustement_type IS 'Type du dernier ajustement: livraison, perte, inventaire, etc.';

-- =====================================================
-- TABLE: stock_ajustements
-- Description: Historique des ajustements manuels de stock
-- =====================================================
CREATE TABLE IF NOT EXISTS stock_ajustements (
    id SERIAL PRIMARY KEY,
    stock_auto_id INTEGER NOT NULL REFERENCES stock_auto(id) ON DELETE CASCADE ON UPDATE CASCADE,
    type_ajustement type_ajustement_stock NOT NULL,
    quantite_avant DECIMAL(10, 3) NOT NULL,
    quantite_ajustee DECIMAL(10, 3) NOT NULL,
    quantite_apres DECIMAL(10, 3) NOT NULL,
    commentaire TEXT,
    effectue_par VARCHAR(100) NOT NULL,
    date_ajustement DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_stock_ajustements_stock_auto_id ON stock_ajustements(stock_auto_id);
CREATE INDEX IF NOT EXISTS idx_stock_ajustements_date ON stock_ajustements(date_ajustement);
CREATE INDEX IF NOT EXISTS idx_stock_ajustements_type ON stock_ajustements(type_ajustement);

-- Commentaires
COMMENT ON TABLE stock_ajustements IS 'Historique des ajustements manuels de stock (livraisons, pertes, inventaires, etc.)';
COMMENT ON COLUMN stock_ajustements.quantite_ajustee IS 'Quantité ajoutée (positif) ou retirée (négatif)';

-- =====================================================
-- TABLE: prix_point_vente
-- Description: Prix spécifiques par point de vente
-- =====================================================
CREATE TABLE IF NOT EXISTS prix_point_vente (
    id SERIAL PRIMARY KEY,
    produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE ON UPDATE CASCADE,
    point_vente_id INTEGER NOT NULL REFERENCES points_vente(id) ON DELETE CASCADE ON UPDATE CASCADE,
    prix DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_prix_produit_point_vente UNIQUE (produit_id, point_vente_id)
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_prix_point_vente_produit_id ON prix_point_vente(produit_id);
CREATE INDEX IF NOT EXISTS idx_prix_point_vente_point_vente_id ON prix_point_vente(point_vente_id);

-- =====================================================
-- TABLE: prix_historique
-- Description: Historique des modifications de prix
-- =====================================================
DO $$ BEGIN
    CREATE TYPE type_modification_prix AS ENUM ('creation', 'modification', 'suppression');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS prix_historique (
    id SERIAL PRIMARY KEY,
    produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE ON UPDATE CASCADE,
    point_vente_id INTEGER REFERENCES points_vente(id) ON DELETE SET NULL ON UPDATE CASCADE,
    ancien_prix DECIMAL(10, 2),
    nouveau_prix DECIMAL(10, 2) NOT NULL,
    type_modification type_modification_prix NOT NULL DEFAULT 'modification',
    modifie_par VARCHAR(50),
    commentaire TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_prix_historique_produit_id ON prix_historique(produit_id);
CREATE INDEX IF NOT EXISTS idx_prix_historique_point_vente_id ON prix_historique(point_vente_id);
CREATE INDEX IF NOT EXISTS idx_prix_historique_created_at ON prix_historique(created_at);

-- =====================================================
-- FINANCE: depenses, prix fournisseur, paiements
-- =====================================================
CREATE TABLE IF NOT EXISTS depenses (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    montant NUMERIC(12, 2) NOT NULL CHECK (montant >= 0),
    categorie VARCHAR(50),
    description TEXT,
    justificatif_filename VARCHAR(255),
    justificatif_mime VARCHAR(100),
    justificatif_data BYTEA,
    justificatif_size INTEGER,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_depenses_categorie ON depenses(categorie);

CREATE TABLE IF NOT EXISTS fournisseur_prix (
    produit VARCHAR(100) PRIMARY KEY,
    prix_vente NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (prix_vente >= 0),
    prix_achat NUMERIC(12, 2) CHECK (prix_achat IS NULL OR prix_achat >= 0),
    prix_vente_cdc NUMERIC(12, 2) CHECK (prix_vente_cdc IS NULL OR prix_vente_cdc >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Historique des modifications du prix vente CDC.
CREATE TABLE IF NOT EXISTS prix_vente_cdc_history (
    id SERIAL PRIMARY KEY,
    produit VARCHAR(100) NOT NULL
        REFERENCES fournisseur_prix(produit) ON DELETE CASCADE,
    prix_vente_cdc NUMERIC(12, 2) NOT NULL CHECK (prix_vente_cdc >= 0),
    changed_by VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prix_vente_cdc_history_produit ON prix_vente_cdc_history(produit, created_at DESC);

-- Historique des modifications du prix d'achat fournisseur.
CREATE TABLE IF NOT EXISTS prix_achat_history (
    id SERIAL PRIMARY KEY,
    produit VARCHAR(100) NOT NULL
        REFERENCES fournisseur_prix(produit) ON DELETE CASCADE,
    prix_achat NUMERIC(12, 2) NOT NULL CHECK (prix_achat >= 0),
    changed_by VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prix_achat_history_produit ON prix_achat_history(produit, created_at DESC);

-- Charges mensuelles fixes (utilise par le PL au prorata).
CREATE TABLE IF NOT EXISTS finance_charges (
    nom VARCHAR(100) PRIMARY KEY,
    libelle VARCHAR(150) NOT NULL,
    montant_mensuel NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (montant_mensuel >= 0),
    ordre INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO finance_charges (nom, libelle, montant_mensuel, ordre, updated_at) VALUES
    ('masse_salariale', 'Masse salariale', 250000, 1, NOW()),
    ('loyer',           'Loyer',           125000, 2, NOW()),
    ('elec',            'Électricité',      30000, 3, NOW()),
    ('internet',        'Internet',         15000, 4, NOW())
ON CONFLICT (nom) DO NOTHING;

-- Historique des modifications des charges (point-in-time).
-- Une entree par modification reelle du montant_mensuel.
CREATE TABLE IF NOT EXISTS finance_charges_history (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100) NOT NULL
        REFERENCES finance_charges(nom) ON DELETE CASCADE,
    libelle VARCHAR(150),
    montant_mensuel NUMERIC(12, 2) NOT NULL CHECK (montant_mensuel >= 0),
    changed_by VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_finance_charges_history_nom ON finance_charges_history(nom, created_at DESC);
-- Genesis seed: une entree epoch 1970 par charge existante (eviter timeline vide).
INSERT INTO finance_charges_history (nom, libelle, montant_mensuel, changed_by, created_at)
SELECT fc.nom, fc.libelle, fc.montant_mensuel, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
FROM finance_charges fc
WHERE NOT EXISTS (
    SELECT 1 FROM finance_charges_history h WHERE h.nom = fc.nom
);

-- Historique des modifications du prix vente fournisseur (catalogue).
CREATE TABLE IF NOT EXISTS prix_vente_history (
    id SERIAL PRIMARY KEY,
    produit VARCHAR(100) NOT NULL
        REFERENCES fournisseur_prix(produit) ON DELETE CASCADE,
    prix_vente NUMERIC(12, 2) NOT NULL CHECK (prix_vente >= 0),
    changed_by VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prix_vente_history_produit ON prix_vente_history(produit, created_at DESC);
INSERT INTO fournisseur_prix (produit, prix_vente, prix_achat) VALUES
  ('Boeuf',  4350, 3835),
  ('Veau',   4600, 4035),
  ('Agneau', 5300, 4500),
  ('Poulet', 3500, NULL),
  ('Laxass',  300,  200)
ON CONFLICT (produit) DO NOTHING;

-- Genesis seeds des 3 tables history (point-in-time).
-- Chaque produit doit avoir au moins UNE entree pour que le lookup
-- point-in-time fonctionne. created_at=epoch 1970 = "applicable depuis
-- toujours". Skip si une entree existe deja (idempotent).
INSERT INTO prix_vente_history (produit, prix_vente, changed_by, created_at)
SELECT fp.produit, fp.prix_vente, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
FROM fournisseur_prix fp
WHERE NOT EXISTS (
    SELECT 1 FROM prix_vente_history h WHERE h.produit = fp.produit
);
INSERT INTO prix_achat_history (produit, prix_achat, changed_by, created_at)
SELECT fp.produit, fp.prix_achat, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
FROM fournisseur_prix fp
WHERE fp.prix_achat IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM prix_achat_history h WHERE h.produit = fp.produit
  );
INSERT INTO prix_vente_cdc_history (produit, prix_vente_cdc, changed_by, created_at)
SELECT fp.produit, fp.prix_vente_cdc, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
FROM fournisseur_prix fp
WHERE fp.prix_vente_cdc IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM prix_vente_cdc_history h WHERE h.produit = fp.produit
  );

CREATE TABLE IF NOT EXISTS finance_config (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO finance_config (key, value) VALUES
  ('commission_pct', '3.0'),
  ('categories_eligibles', 'Bovin,Ovin,Caprin,Volaille,Poisson')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS fournisseur_paiements (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    montant NUMERIC(12, 2) NOT NULL CHECK (montant >= 0),
    mode VARCHAR(50),
    reference VARCHAR(100),
    commentaire TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fournisseur_paiements_date ON fournisseur_paiements(date DESC);

-- Mapping libelle vente -> entree catalogue prix.
-- Remplace le matching prefix (startsWith) par un alias explicite.
CREATE TABLE IF NOT EXISTS produit_alias (
    alias_produit VARCHAR(150) PRIMARY KEY,
    produit_catalog VARCHAR(100) NOT NULL
        REFERENCES fournisseur_prix(produit) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_produit_alias_catalog ON produit_alias(produit_catalog);

-- =====================================================
-- NETTOYAGE DES DONNÉES HISTORIQUES (optionnel)
-- =====================================================
-- Pour nettoyer les données des anciens points de vente, décommentez les lignes suivantes:
-- DELETE FROM cash_payments 
-- WHERE point_de_vente IS NOT NULL 
-- AND point_de_vente NOT IN (SELECT nom FROM points_vente WHERE active = TRUE);

-- Normaliser les références de paiement (label PV; le code V_ABATS reste stable)
UPDATE cash_payments SET point_de_vente = 'Dépôt central' WHERE point_de_vente IN ('V_ABATS', 'Abattage');

-- =====================================================
-- TABLE HISTORIQUE IMPORTS OCR
-- =====================================================
CREATE TABLE IF NOT EXISTS ocr_imports (
    id SERIAL PRIMARY KEY,
    date_import TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_ventes DATE NOT NULL,
    point_vente VARCHAR(100) NOT NULL,
    categorie VARCHAR(100) DEFAULT 'Import OCR',
    nombre_lignes INTEGER DEFAULT 0,
    total_montant DECIMAL(15, 2) DEFAULT 0,
    statut VARCHAR(20) DEFAULT 'completed', -- 'completed', 'partial', 'cancelled'
    utilisateur VARCHAR(100),
    image_source TEXT, -- base64 miniature ou référence
    donnees_json JSONB, -- Données complètes de l'import
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_ocr_imports_date ON ocr_imports(date_import DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_imports_point_vente ON ocr_imports(point_vente);
CREATE INDEX IF NOT EXISTS idx_ocr_imports_date_ventes ON ocr_imports(date_ventes);

-- =====================================================
-- VÉRIFICATION
-- =====================================================
-- Afficher les tables créées
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Vérifier les points de vente actifs
SELECT nom, active, payment_ref FROM points_vente ORDER BY nom;

-- =====================================================
-- FIN DU SCRIPT
-- =====================================================

