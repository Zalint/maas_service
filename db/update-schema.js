const { sequelize } = require('./index');
const Reconciliation = require('./models/Reconciliation');
const CashPayment = require('./models/CashPayment');
const UISettings = require('./models/UISettings');

/**
 * Met à jour le schéma de la base de données sans perdre les données existantes
 */
async function updateSchema() {
    try {
        console.log('Début de la mise à jour du schéma de la base de données...');
        
        // Vérifier l'existence de la table reconciliations
        const tableExists = await checkTableExists('reconciliations');
        
        if (tableExists) {
            console.log('La table reconciliations existe déjà');
            
            // Vérifier si les nouvelles colonnes existent déjà
            const hasNewColumns = await checkColumnsExist('reconciliations', [
                'cashPaymentData', 'comments', 'calculated', 'version'
            ]);
            
            if (!hasNewColumns) {
                console.log('Ajout des nouvelles colonnes à la table reconciliations...');
                
                // Ajouter les nouvelles colonnes
                await sequelize.query(`
                    ALTER TABLE reconciliations
                    ADD COLUMN IF NOT EXISTS "cashPaymentData" TEXT,
                    ADD COLUMN IF NOT EXISTS "comments" TEXT,
                    ADD COLUMN IF NOT EXISTS "calculated" BOOLEAN DEFAULT TRUE,
                    ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1
                `);
                
                console.log('Colonnes ajoutées avec succès');
                
                // Migrer les données existantes vers le nouveau format
                await migrateExistingData();
            } else {
                console.log('Les nouvelles colonnes existent déjà');
            }
        } else {
            console.log('La table reconciliations n\'existe pas, création...');
            await Reconciliation.sync();
            console.log('Table reconciliations créée avec succès');
        }
        
        // Vérifier/créer la table des paiements en espèces
        const cashPaymentTableExists = await checkTableExists('cash_payments');
        if (!cashPaymentTableExists) {
            console.log('La table cash_payments n\'existe pas, création...');
            await CashPayment.sync();
            console.log('Table cash_payments créée avec succès');
        } else {
            console.log('La table cash_payments existe déjà');
        }

        // Unique index sur (date, point_de_vente, payment_reference, is_manual).
        // Garantit qu'une cloture de caisse pour un PV+date donne ne peut creer
        // qu'UNE seule entree cash_payments (race-safe vs 2 admins qui valident
        // simultanement). Pour les autres entries (paiements manuels admin avec
        // payment_reference=NULL, imports Bictorys avec tx_id unique), Postgres
        // traite NULL != NULL donc pas de blocage parasite. Idempotent.
        // Si des doublons existent deja en BDD, la creation echoue → log warn
        // mais l'app continue sans la protection race.
        try {
            await sequelize.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS cash_payments_cloture_unique
                ON cash_payments (date, point_de_vente, payment_reference, is_manual)
            `);
            console.log('Index unique cash_payments_cloture_unique vérifié/créé');
        } catch (idxErr) {
            console.warn('⚠️ Echec création index unique cash_payments_cloture_unique:', idxErr.message);
            console.warn('   Probablement des doublons existants. Vérifier manuellement avec:');
            console.warn('   SELECT date, point_de_vente, payment_reference, is_manual, COUNT(*) FROM cash_payments GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;');
        }
        
        // Ajouter la colonne default_screen à la table users si la table existe.
        // Sur tenant vierge (avant sequelize.sync), users n'existe pas encore →
        // ALTER TABLE échouerait. On garde le check pour cohérence avec les
        // autres ALTER (produits, categories).
        const usersTableExists = await checkTableExists('users');
        if (usersTableExists) {
            await sequelize.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS default_screen VARCHAR(100) DEFAULT NULL
            `);
            console.log('Colonne default_screen vérifiée/ajoutée dans la table users');
        }

        // UISettings : sync + migration + seed default row.
        // Idempotent : ne touche pas a la row si elle existe deja.
        // - new_ui_roles : liste JSON des roles pour lesquels le mode moderne est actif
        // - default_theme : auto | light | dark
        // Si tenant.MATIX_TENANT est defini, utilise cette valeur. Sinon defaut 'MATA'.
        const tenantKey = process.env.MATIX_TENANT || 'MATA';
        try {
            await UISettings.sync({ alter: false });
            // Migration : ajoute new_ui_roles + default_theme si absents (idempotent).
            await sequelize.query(`
                ALTER TABLE ui_settings ADD COLUMN IF NOT EXISTS new_ui_roles TEXT DEFAULT NULL
            `);
            await sequelize.query(`
                ALTER TABLE ui_settings ADD COLUMN IF NOT EXISTS default_theme VARCHAR(8) NOT NULL DEFAULT 'auto'
            `);
            // findOrCreate evite la race possible entre findOne+create si 2
            // process boot en parallele (le 2e taperait l'unique constraint
            // sur tenant). Idempotent. Postgres serialise via la contrainte.
            const [row, created] = await UISettings.findOrCreate({
                where: { tenant: tenantKey },
                defaults: {
                    tenant: tenantKey,
                    new_ui_enabled: false,
                    new_ui_roles: [],
                    sidebar_position: 'right',
                    default_theme: 'auto',
                    updated_by: 'system-seed'
                }
            });
            if (created) {
                console.log(`UISettings : default row seeded for tenant ${tenantKey}`);
            } else {
                // Back-compat : si new_ui_roles est null mais new_ui_enabled=true,
                // on remplit avec tous les roles (ancien comportement = global).
                const roles = row.new_ui_roles;
                if ((!roles || roles.length === 0) && row.new_ui_enabled === true) {
                    row.new_ui_roles = ['admin', 'superviseur', 'superutilisateur', 'user', 'lecteur', 'chef_livreur', 'matapay'];
                    await row.save();
                    console.log('UISettings : migrated old global toggle -> all roles');
                }
                console.log(`UISettings : tenant ${tenantKey} row already exists`);
            }
        } catch (e) {
            console.error('UISettings sync/seed error (non-fatal):', e.message);
        }

        // Ajouter les colonnes ventes (inventaire -> liste de produits vente)
        // et prix_personnalise (vente -> flag de détachement) sur la table produits.
        // Idempotent: ALTER ... ADD COLUMN IF NOT EXISTS ne fait rien si déjà présent.
        const produitsTableExists = await checkTableExists('produits');
        if (produitsTableExists) {
            await sequelize.query(`
                ALTER TABLE produits
                ADD COLUMN IF NOT EXISTS "ventes" TEXT[] DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS "prix_personnalise" BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS "ventilation_poids" BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT FALSE
            `);
            console.log('Colonnes ventes / prix_personnalise / ventilation_poids / archived vérifiées/ajoutées dans la table produits');

            // Index partiel pour accelerer le filtre WHERE archived = FALSE
            // (utilise par tous les endpoints POS / stock — chemin chaud).
            await sequelize.query(`
                CREATE INDEX IF NOT EXISTS produits_archived_idx
                  ON produits (archived)
            `);

            // Activer la ventilation par défaut pour Poulet (inventaire) sur les
            // tenants existants. Idempotent: ne touche rien si déjà à TRUE.
            await sequelize.query(`
                UPDATE produits
                   SET ventilation_poids = TRUE
                 WHERE nom = 'Poulet'
                   AND type_catalogue = 'inventaire'
                   AND ventilation_poids = FALSE
            `);
        }

        // Ajouter la colonne extension JSONB sur transferts pour stocker la
        // ventilation par calibre (poids+quantité) des produits Poulet & co.
        const transfertsTableExists = await checkTableExists('transferts');
        if (transfertsTableExists) {
            await sequelize.query(`
                ALTER TABLE transferts
                ADD COLUMN IF NOT EXISTS "extension" JSONB DEFAULT NULL
            `);
            console.log('Colonne extension vérifiée/ajoutée dans la table transferts');
        }

        // Stock soir auto-calcul: marque les lignes derivees automatiquement
        // (matin + transferts - ventes) pour produits mode_stock=automatique,
        // par opposition aux saisies manuelles / overrides utilisateur.
        const stocksTableExists = await checkTableExists('stocks');
        if (stocksTableExists) {
            await sequelize.query(`
                ALTER TABLE stocks
                ADD COLUMN IF NOT EXISTS "is_auto_calculated" BOOLEAN NOT NULL DEFAULT FALSE
            `);
            console.log('Colonne is_auto_calculated vérifiée/ajoutée dans la table stocks');
        }

        // Verrou defensif: tous les produits dont la categorie a famille =
        // 'Boucherie' (Bovin/Ovin/Poulet/Poisson/Caprin) ou nommee 'Pack'
        // doivent rester en mode_stock = 'manuel'. Idempotent: ne touche que
        // les lignes qui ne sont pas deja a manuel. Sans ca, un check accidentel
        // dans l'admin pourrait faire decrementer le stock boucherie sur les
        // ventes, ce qui n'est pas l'intention metier.
        if (produitsTableExists) {
            try {
                const [, metaBoucherie] = await sequelize.query(`
                    UPDATE produits SET mode_stock = 'manuel'
                     WHERE mode_stock <> 'manuel'
                       AND categorie_id IN (
                           SELECT id FROM categories
                            WHERE famille = 'Boucherie' OR nom = 'Pack'
                       )
                `);
                if (metaBoucherie && metaBoucherie.rowCount) {
                    console.log(`🔒 Verrou Boucherie/Pack: ${metaBoucherie.rowCount} produits ramenes a mode_stock=manuel.`);
                }
            } catch (e) {
                // En tenant frais, categories peut avoir famille NULL: on
                // continue, le seed posera la bonne famille plus tard.
                console.warn('⚠️  Verrou Boucherie/Pack non applique:', e.message);
            }
        }

        // Table inventaire_categories: persistance par tenant du mapping
        // nom de catégorie d'inventaire -> famille (Boucherie/Epicerie/Autres).
        // Les catégories d'inventaire elles-mêmes restent dérivées du champ
        // categorie_affichage côté Produit; cette table sert uniquement à
        // stocker le regroupement haut niveau partagé entre admins.
        const invCatTableExists = await checkTableExists('inventaire_categories');
        if (!invCatTableExists) {
            await sequelize.query(`
                CREATE TABLE inventaire_categories (
                    nom VARCHAR(100) PRIMARY KEY,
                    famille VARCHAR(20) NOT NULL DEFAULT 'Autres',
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                )
            `);
            console.log('Table inventaire_categories créée');
        }
        // Pré-remplir / re-pré-remplir les 6 catégories logiques standard.
        // ON CONFLICT DO NOTHING garantit l'idempotence: lignes existantes
        // (avec d'éventuelles personnalisations admin) ne sont pas écrasées,
        // et les manquantes sont ajoutées même sur des bases déjà créées
        // avant cette commit.
        // created_at/updated_at fournis explicitement: si la table a ete
        // creee par Sequelize sync (timestamps: true) avant cette migration,
        // elle n'a pas le DEFAULT NOW() — l'INSERT sans timestamps echouait
        // alors avec NOT NULL constraint sur created_at.
        await sequelize.query(`
            INSERT INTO inventaire_categories (nom, famille, created_at, updated_at) VALUES
              ('Viandes', 'Boucherie', NOW(), NOW()),
              ('Abats et Sous-produits', 'Boucherie', NOW(), NOW()),
              ('Produits sur Pieds', 'Boucherie', NOW(), NOW()),
              ('Œufs et Produits Laitiers', 'Epicerie', NOW(), NOW()),
              ('Déchets', 'Autres', NOW(), NOW()),
              ('Autres', 'Autres', NOW(), NOW())
            ON CONFLICT (nom) DO NOTHING
        `);

        // Journal local des commandes envoyées au centre de découpe Mata.
        // Sequelize.sync ne tournera pas sur cette table en prod (initiale via
        // tenant:init), donc on la crée idempotemment ici.
        const decoupeLogTableExists = await checkTableExists('decoupe_order_logs');
        if (!decoupeLogTableExists) {
            await sequelize.query(`
                CREATE TABLE decoupe_order_logs (
                    id SERIAL PRIMARY KEY,
                    commande_ref VARCHAR(50),
                    point_vente VARCHAR(100) NOT NULL,
                    point_vente_executant VARCHAR(100),
                    produits JSONB NOT NULL DEFAULT '[]'::jsonb,
                    montant_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
                    nom_client VARCHAR(150),
                    numero_client VARCHAR(50),
                    adresse_client VARCHAR(255),
                    instructions_client TEXT,
                    cree_par VARCHAR(150),
                    mata_response JSONB,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                )
            `);
            console.log('Table decoupe_order_logs créée');
        } else {
            // Migration sur table existante: ajouter mata_response si absent
            await sequelize.query(`
                ALTER TABLE decoupe_order_logs
                ADD COLUMN IF NOT EXISTS mata_response JSONB
            `);
        }
        // Indices idempotents — garantissent leur présence aussi bien sur
        // tables nouvelles que pré-existantes (cas où la table avait été
        // créée avant l'ajout des indices, ou via un autre chemin).
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_decoupe_log_point_vente ON decoupe_order_logs(point_vente)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_decoupe_log_created_at ON decoupe_order_logs(created_at DESC)`);

        // Famille de catégorie pour les Produits Généraux (Boucherie / Epicerie / Autres).
        // Default 'Autres'; on pré-remplit les noms connus pour éviter à l'admin de tout
        // reclasser à la main au premier déploiement. Les nouvelles catégories créées
        // ensuite tombent en 'Autres' tant qu'elles ne sont pas reclassées via l'UI.
        const categoriesTableExists = await checkTableExists('categories');
        if (categoriesTableExists) {
            await sequelize.query(`
                ALTER TABLE categories
                ADD COLUMN IF NOT EXISTS "famille" VARCHAR(20) NOT NULL DEFAULT 'Autres'
            `);
            await sequelize.query(`
                UPDATE categories SET famille = 'Boucherie'
                WHERE famille = 'Autres' AND nom IN ('Bovin', 'Ovin', 'Caprin', 'Volaille')
            `);
            await sequelize.query(`
                UPDATE categories SET famille = 'Epicerie'
                WHERE famille = 'Autres' AND nom IN ('Pack', 'Conserve', 'Riz & Féculents', 'Superette', 'Boissons')
            `);
            console.log('Colonne famille vérifiée/ajoutée dans la table categories (Boucherie/Epicerie pré-remplis)');
        }

        // =====================================================
        // FINANCE — depenses, prix fournisseur, paiements
        // =====================================================
        // Tables creees idempotemment (IF NOT EXISTS). Seed des prix
        // fournisseur via ON CONFLICT DO NOTHING pour preserver les valeurs
        // que l'admin aurait deja modifiees.
        await sequelize.query(`
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
            )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses(date DESC)`);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_depenses_categorie ON depenses(categorie)`);
        // CHECK idempotent pour les tables deja creees sans la contrainte
        // (rolling upgrade). DO block car ADD CONSTRAINT IF NOT EXISTS
        // n'existe pas en Postgres pour les CHECK column-level.
        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depenses_montant_nonneg' AND conrelid = 'depenses'::regclass) THEN
                    ALTER TABLE depenses ADD CONSTRAINT depenses_montant_nonneg CHECK (montant >= 0);
                END IF;
            END $$;
        `);
        console.log('Table depenses verifiee');

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS fournisseur_prix (
                produit VARCHAR(100) PRIMARY KEY,
                prix_vente NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (prix_vente >= 0),
                prix_achat NUMERIC(12, 2) CHECK (prix_achat IS NULL OR prix_achat >= 0),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        // CHECK idempotent pour les tables deja creees (cf depenses).
        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fournisseur_prix_prix_vente_nonneg' AND conrelid = 'fournisseur_prix'::regclass) THEN
                    ALTER TABLE fournisseur_prix ADD CONSTRAINT fournisseur_prix_prix_vente_nonneg CHECK (prix_vente >= 0);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fournisseur_prix_prix_achat_nonneg' AND conrelid = 'fournisseur_prix'::regclass) THEN
                    ALTER TABLE fournisseur_prix ADD CONSTRAINT fournisseur_prix_prix_achat_nonneg CHECK (prix_achat IS NULL OR prix_achat >= 0);
                END IF;
            END $$;
        `);
        // updated_at fourni explicitement (cf rationale inventaire_categories
        // plus haut: la table peut avoir ete creee par Sequelize sync sans
        // DEFAULT NOW(), provoquant une NOT NULL violation au seed).
        await sequelize.query(`
            INSERT INTO fournisseur_prix (produit, prix_vente, prix_achat, updated_at) VALUES
              ('Boeuf',  4350, 3835, NOW()),
              ('Veau',   4600, 4035, NOW()),
              ('Agneau', 5300, 4500, NOW()),
              ('Poulet', 3500, NULL, NOW()),
              ('Laxass',  300,  200, NOW())
            ON CONFLICT (produit) DO NOTHING
        `);
        // Colonne prix_vente_cdc: prix de vente convenu avec le Centre de
        // Decoupe (negociation B2B), utilise pour le calcul de marge "Il
        // me doit". Default = prix_vente (= prix catalogue fournisseur)
        // pour un upgrade transparent. Editable depuis l'UI Finance CDC.
        await sequelize.query(`
            ALTER TABLE fournisseur_prix
            ADD COLUMN IF NOT EXISTS prix_vente_cdc NUMERIC(12, 2)
                CHECK (prix_vente_cdc IS NULL OR prix_vente_cdc >= 0)
        `);
        await sequelize.query(`
            UPDATE fournisseur_prix
            SET prix_vente_cdc = prix_vente
            WHERE prix_vente_cdc IS NULL
        `);
        console.log('Table fournisseur_prix verifiee (seed 5 produits + prix_vente_cdc)');

        // Colonne prix_achat_dynamique: quand TRUE, le prix achat du produit
        // est lu depuis l'API DATA (/api/external/achats-boeuf) au lieu de la
        // valeur saisie dans le catalogue (qui devient un simple repli).
        // Seul le boeuf a une source API a ce jour -> active par defaut.
        // NULL = jamais configure (= desactive): c'est ce qui rend le seed
        // ci-dessous idempotent. Si l'utilisateur decoche le boeuf (FALSE),
        // un redeploy ne le reactivera pas.
        await sequelize.query(`
            ALTER TABLE fournisseur_prix
            ADD COLUMN IF NOT EXISTS prix_achat_dynamique BOOLEAN
        `);
        await sequelize.query(`
            UPDATE fournisseur_prix
            SET prix_achat_dynamique = TRUE
            WHERE prix_achat_dynamique IS NULL
              AND LOWER(TRIM(produit)) = 'boeuf'
        `);

        // Historique des modifications de prix_vente_cdc.
        // Chaque sauvegarde insere une ligne (point-in-time pricing).
        // Le calcul de marge utilise la valeur effective a la date de la
        // vente (= derniere entree history.created_at <= vente_date),
        // donc changer le prix aujourd'hui ne reecrit PAS les ventes
        // passees.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS prix_vente_cdc_history (
                id SERIAL PRIMARY KEY,
                produit VARCHAR(100) NOT NULL
                    REFERENCES fournisseur_prix(produit) ON DELETE CASCADE,
                prix_vente_cdc NUMERIC(12, 2) NOT NULL CHECK (prix_vente_cdc >= 0),
                changed_by VARCHAR(150),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_prix_vente_cdc_history_produit ON prix_vente_cdc_history(produit, created_at DESC)`);

        // Genesis: chaque produit doit avoir au moins UNE entree history
        // pour que le lookup point-in-time fonctionne. created_at=epoch
        // 1970 signifie "cette valeur s'applique depuis le debut des
        // temps" — toutes les ventes anciennes resoudront sur cette
        // entree. Seedee une seule fois (skip si une entree existe deja).
        await sequelize.query(`
            INSERT INTO prix_vente_cdc_history (produit, prix_vente_cdc, changed_by, created_at)
            SELECT fp.produit, fp.prix_vente_cdc, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
            FROM fournisseur_prix fp
            WHERE fp.prix_vente_cdc IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM prix_vente_cdc_history h WHERE h.produit = fp.produit
              )
        `);
        console.log('Table prix_vente_cdc_history verifiee (genesis seedee)');

        // Historique des modifications de prix_achat (point-in-time).
        // Meme pattern que prix_vente_cdc_history: chaque changement est
        // une nouvelle ligne, et le calcul de marge utilise la valeur
        // effective a la date de la vente.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS prix_achat_history (
                id SERIAL PRIMARY KEY,
                produit VARCHAR(100) NOT NULL
                    REFERENCES fournisseur_prix(produit) ON DELETE CASCADE,
                prix_achat NUMERIC(12, 2) NOT NULL CHECK (prix_achat >= 0),
                changed_by VARCHAR(150),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_prix_achat_history_produit ON prix_achat_history(produit, created_at DESC)`);
        // Genesis seed pour prix_achat (uniquement pour produits avec
        // prix_achat IS NOT NULL, e.g. Poulet n'en a pas).
        await sequelize.query(`
            INSERT INTO prix_achat_history (produit, prix_achat, changed_by, created_at)
            SELECT fp.produit, fp.prix_achat, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
            FROM fournisseur_prix fp
            WHERE fp.prix_achat IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM prix_achat_history h WHERE h.produit = fp.produit
              )
        `);
        console.log('Table prix_achat_history verifiee (genesis seedee)');

        // Historique des modifications de prix_vente (point-in-time).
        // Base du calcul commission 3% dans l'onglet "Creances fournisseur".
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS prix_vente_history (
                id SERIAL PRIMARY KEY,
                produit VARCHAR(100) NOT NULL
                    REFERENCES fournisseur_prix(produit) ON DELETE CASCADE,
                prix_vente NUMERIC(12, 2) NOT NULL CHECK (prix_vente >= 0),
                changed_by VARCHAR(150),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_prix_vente_history_produit ON prix_vente_history(produit, created_at DESC)`);
        await sequelize.query(`
            INSERT INTO prix_vente_history (produit, prix_vente, changed_by, created_at)
            SELECT fp.produit, fp.prix_vente, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
            FROM fournisseur_prix fp
            WHERE NOT EXISTS (
                SELECT 1 FROM prix_vente_history h WHERE h.produit = fp.produit
            )
        `);
        console.log('Table prix_vente_history verifiee (genesis seedee)');

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS finance_config (
                key VARCHAR(50) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        // Defaut: commission 3% sur ventes boucherie. categories_eligibles
        // est stocke comme CSV pour rester JSON-libre. Modifiable via l'UI
        // finance (PUT /api/finance/config).
        await sequelize.query(`
            INSERT INTO finance_config (key, value, updated_at) VALUES
              ('commission_pct', '3.0', NOW()),
              ('categories_eligibles', 'Bovin,Ovin,Caprin,Volaille,Poisson', NOW()),
              ('stock_pertes_decoupe_pct', '5', NOW()),
              ('parage_exclusions', 'Boeuf sur pied,Veau sur pied,Mouton sur pied,Chevre sur pied', NOW())
            ON CONFLICT (key) DO NOTHING
        `);
        console.log('Table finance_config verifiee (seed commission_pct=3.0)');

        // Config Livreurs (kanban SUIVI DES COMMANDES): URL de l'API de
        // livraison externe (matix-livreur-backend) + liste des livreurs
        // actifs. Stocke en DB (et non dans livreurs_actifs.json a la racine)
        // pour survivre aux redeploiements Render (FS ephemere) et rester
        // isole par tenant (schema courant). Table cle/valeur JSONB:
        //   api_url          -> string | null (URL sans slash final)
        //   livreurs_actifs  -> array de noms (strings)
        // Modifiable via admin > Gestion des Livreurs (POST /api/livreur/save-config).
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS livreur_config (
                key VARCHAR(50) PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`
            INSERT INTO livreur_config (key, value, updated_at) VALUES
              ('api_url', 'null'::jsonb, NOW()),
              ('livreurs_actifs', '[]'::jsonb, NOW())
            ON CONFLICT (key) DO NOTHING
        `);
        console.log('Table livreur_config verifiee (seed livreurs_actifs=[])');

        // Config POS (settings pilotant l'affichage du POS), par tenant.
        // Table cle/valeur JSONB. Cle actuelle:
        //   boucherie_categories -> array ordonne des categories affichees
        //                           sous "Boucherie" dans le POS (chips + ordre)
        // Le defaut reprend l'ancien hardcode de pos.js (BOUCHERIE_CATEGORIES).
        // Modifiable via admin > Categories POS (POST /api/pos/boucherie-categories).
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS pos_config (
                key VARCHAR(50) PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`
            INSERT INTO pos_config (key, value, updated_at) VALUES
              ('boucherie_categories', '["Bovin","Ovin","Volaille","Pack","Caprin"]'::jsonb, NOW())
            ON CONFLICT (key) DO NOTHING
        `);
        console.log('Table pos_config verifiee (seed boucherie_categories)');

        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS fournisseur_paiements (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                montant NUMERIC(12, 2) NOT NULL CHECK (montant >= 0),
                mode VARCHAR(50),
                reference VARCHAR(100),
                commentaire TEXT,
                created_by VARCHAR(100),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_fournisseur_paiements_date ON fournisseur_paiements(date DESC)`);
        // CHECK idempotent (cf depenses).
        await sequelize.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fournisseur_paiements_montant_nonneg' AND conrelid = 'fournisseur_paiements'::regclass) THEN
                    ALTER TABLE fournisseur_paiements ADD CONSTRAINT fournisseur_paiements_montant_nonneg CHECK (montant >= 0);
                END IF;
            END $$;
        `);
        console.log('Table fournisseur_paiements verifiee');

        // Charges mensuelles fixes pour le calcul PL (Profit/Loss).
        // Editables depuis l'UI Finance > Charges. Le PL applique au
        // prorata des jours lineaires (30 jours conventionnels).
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS finance_charges (
                nom VARCHAR(100) PRIMARY KEY,
                libelle VARCHAR(150) NOT NULL,
                montant_mensuel NUMERIC(12, 2) NOT NULL DEFAULT 0
                    CHECK (montant_mensuel >= 0),
                ordre INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`
            INSERT INTO finance_charges (nom, libelle, montant_mensuel, ordre, updated_at) VALUES
                ('masse_salariale', 'Masse salariale', 250000, 1, NOW()),
                ('loyer',           'Loyer',           125000, 2, NOW()),
                ('elec',            'Électricité',      30000, 3, NOW()),
                ('internet',        'Internet',         15000, 4, NOW())
            ON CONFLICT (nom) DO NOTHING
        `);
        console.log('Table finance_charges verifiee (seed 4 charges par defaut)');

        // Historique des modifications de finance_charges.montant_mensuel.
        // Meme pattern point-in-time que prix_vente_cdc_history etc. : chaque
        // sauvegarde insere une ligne (uniquement si valeur change cote
        // bulk save), permettant de retracer l'evolution des charges fixes.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS finance_charges_history (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(100) NOT NULL
                    REFERENCES finance_charges(nom) ON DELETE CASCADE,
                libelle VARCHAR(150),
                montant_mensuel NUMERIC(12, 2) NOT NULL CHECK (montant_mensuel >= 0),
                changed_by VARCHAR(150),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_finance_charges_history_nom ON finance_charges_history(nom, created_at DESC)`);
        // Genesis seed pour les charges existantes (epoch 1970).
        await sequelize.query(`
            INSERT INTO finance_charges_history (nom, libelle, montant_mensuel, changed_by, created_at)
            SELECT fc.nom, fc.libelle, fc.montant_mensuel, '_seed_', '1970-01-01 00:00:00+00'::timestamptz
            FROM finance_charges fc
            WHERE NOT EXISTS (
                SELECT 1 FROM finance_charges_history h WHERE h.nom = fc.nom
            )
        `);
        console.log('Table finance_charges_history verifiee (genesis seedee)');

        // Montants des charges fixes par mois.
        //
        // finance_charges porte le catalogue et le montant courant; cette
        // table porte les montants DATES, saisis depuis Finance > Charges en
        // choisissant un mois. Le PL resout, pour chaque mois qu'il couvre,
        // la ligne la plus recente avec mois <= ce mois; a defaut il retombe
        // sur finance_charges.montant_mensuel.
        //
        // Volontairement NON seedee: sans ligne, la resolution rend la valeur
        // courante, donc un PL anterieur a toute saisie mensuelle donne
        // exactement le meme resultat qu'avant cette table.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS finance_charges_mois (
                mois CHAR(7) NOT NULL CHECK (mois ~ '^\\d{4}-\\d{2}$'),
                nom VARCHAR(100) NOT NULL
                    REFERENCES finance_charges(nom) ON DELETE CASCADE,
                montant_mensuel NUMERIC(12, 2) NOT NULL CHECK (montant_mensuel >= 0),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (mois, nom)
            )
        `);
        // Resolution = "derniere ligne <= mois demande, par charge": l'index
        // descendant sur (nom, mois) sert directement ce parcours.
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_finance_charges_mois_nom ON finance_charges_mois(nom, mois DESC)`);
        console.log('Table finance_charges_mois verifiee');

        // Valeurs datees des parametres de Finance (aujourd'hui: le % de
        // pertes decoupe). finance_config garde la valeur courante, qui sert
        // d'ancrage pour les mois anterieurs a toute saisie mensuelle.
        //
        // Sans cela, changer le taux recalculait TOUS les PL passes avec la
        // nouvelle valeur, sans trace de l'ancienne: un PL imprime n'etait
        // plus reproductible.
        //
        // Colonne `key` generique: ajouter un autre parametre date ne
        // demandera pas une nouvelle table. Volontairement NON seedee.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS finance_config_mois (
                mois CHAR(7) NOT NULL CHECK (mois ~ '^\\d{4}-\\d{2}$'),
                key VARCHAR(60) NOT NULL,
                value TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (mois, key)
            )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_finance_config_mois_key ON finance_config_mois(key, mois DESC)`);
        console.log('Table finance_config_mois verifiee');

        // Compositions par defaut des packs.
        //
        // Elles vivaient dans config/pack-compositions.js, recopie a
        // l'identique dans deux fichiers clients. Les trois copies ont diverge
        // quatre fois, et chaque divergence faisait disparaitre des kilos du
        // parage sans erreur visible. En base: sauvegardees avec le reste,
        // modifiables depuis ADMIN sans redeploiement, propres au tenant.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS pack_compositions (
                id SERIAL PRIMARY KEY,
                pack VARCHAR(100) NOT NULL,
                ordre INTEGER NOT NULL DEFAULT 0,
                produit VARCHAR(150) NOT NULL,
                quantite NUMERIC(10, 3) NOT NULL CHECK (quantite > 0),
                unite VARCHAR(20) NOT NULL DEFAULT 'kg',
                poids_unitaire NUMERIC(10, 3),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pack_compositions_pack ON pack_compositions(pack, ordre)`);

        // Amorcage depuis le fichier, UNIQUEMENT si la table est vide: c'est
        // une reprise de l'existant, pas une synchronisation. Une fois amorcee,
        // la base fait foi et le fichier n'est plus relu.
        {
            const { PACK_COMPOSITIONS } = require('../config/pack-compositions');
            const lignes = [];
            for (const [pack, composition] of Object.entries(PACK_COMPOSITIONS || {})) {
                (composition || []).forEach((c, i) => {
                    lignes.push({
                        pack,
                        ordre: i,
                        produit: c.produit,
                        quantite: c.quantite,
                        unite: c.unite || 'kg',
                        poids_unitaire: c.poids_unitaire != null ? c.poids_unitaire : null
                    });
                });
            }
            // Tout ou rien, et une seule fois. Deux garde-fous, pour deux
            // pannes differentes:
            //  - la transaction: une coupure au milieu de la boucle laisserait
            //    la table non vide donc definitivement incomplete, puisque le
            //    rejeu exige une table VIDE. Un pack ampute produit des kilos
            //    rattaches a aucune categorie, donc un parage faux et muet.
            //  - le verrou + le comptage DANS la transaction: lu au dehors, il
            //    laisse deux instances qui demarrent ensemble voir zero toutes
            //    les deux et amorcer chacune leur tour. Chaque pack en double
            //    doublerait le theorique, sans la moindre erreur.
            const tx = await sequelize.transaction();
            try {
                await sequelize.query(
                    'LOCK TABLE pack_compositions IN EXCLUSIVE MODE',
                    { transaction: tx }
                );
                const [dejaLa] = await sequelize.query(
                    'SELECT COUNT(*)::int AS n FROM pack_compositions',
                    { type: sequelize.QueryTypes.SELECT, transaction: tx }
                );
                if (dejaLa && dejaLa.n > 0) {
                    await tx.commit();
                    console.log(`Table pack_compositions verifiee (${dejaLa.n} ligne(s))`);
                } else {
                    for (const l of lignes) {
                        await sequelize.query(
                            `INSERT INTO pack_compositions (pack, ordre, produit, quantite, unite, poids_unitaire)
                             VALUES (:pack, :ordre, :produit, :quantite, :unite, :poids_unitaire)`,
                            { replacements: l, transaction: tx }
                        );
                    }
                    await tx.commit();
                    console.log(`Table pack_compositions amorcee: ${lignes.length} ligne(s)`);
                }
            } catch (e) {
                // commit() marque la transaction "finished" dans son finally,
                // meme quand il echoue: rollback() levait alors sa propre
                // erreur, qui remplacait la vraie et sautait le throw ci-dessous.
                try { await tx.rollback(); } catch (_) { /* deja terminee */ }
                throw e;
            }
        }

        // Reference de caisse des points de vente.
        //
        // points_vente.payment_ref etait NULL partout, alors que les clotures
        // ecrivent bien une reference (CASH_MBA, CASH_KM...) dans
        // cash_payments.payment_reference. getPaymentRefMapping, qui construit
        // reference -> point de vente a partir de cette colonne, rendait donc
        // un mapping VIDE: a l'import, chaque paiement tombait sur
        // 'Non specifie' et disparaissait de la reconciliation.
        //
        // Renseigne uniquement les lignes encore NULL: une reference saisie a
        // la main n'est jamais ecrasee. Idempotent.
        try {
            const { CASH_REFERENCES, erreurConfigReferences } = require('../config/cash-references');
            // Configuration illisible: la table est PARTIELLE. Ecrire quand meme
            // renseignerait une partie des points de vente et laisserait les
            // autres a NULL - un mapping incomplet est indiscernable d'un
            // mapping correct, et les paiements des points manquants tombent
            // sur 'Non specifie' a l'import. On saute; le prochain demarrage
            // rejouera, la colonne etant encore NULL.
            const pb = erreurConfigReferences();
            if (pb) {
                // Saut explicite, sans lever: le catch ci-dessous annonce une
                // "table absente", ce qui designerait la mauvaise cause.
                console.error('points_vente.payment_ref NON renseigne, '
                    + 'configuration des references illisible:', pb.message);
            } else {
                let renseignes = 0;
                for (const [nom, ref] of Object.entries(CASH_REFERENCES)) {
                    const [, meta] = await sequelize.query(
                        `UPDATE points_vente SET payment_ref = :ref
                         WHERE nom = :nom AND payment_ref IS NULL`,
                        { replacements: { nom, ref } }
                    );
                    renseignes += (meta && meta.rowCount) || 0;
                }
                console.log(`points_vente.payment_ref: ${renseignes} reference(s) renseignee(s)`);
            }
        } catch (e) {
            // Table absente sur un tenant vierge (avant sequelize.sync): non bloquant.
            console.warn('points_vente.payment_ref non renseigne:', e.message);
        }

        // Mapping libelle de vente -> entree du catalogue prix.
        // Sert a remplacer le matching prefix (startsWith) par un alias
        // explicite gere depuis l'UI Mapping produits.
        // ON DELETE CASCADE: supprimer un produit du catalogue retire
        // automatiquement ses aliases (pas de dangling references).
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS produit_alias (
                alias_produit VARCHAR(150) PRIMARY KEY,
                produit_catalog VARCHAR(100) NOT NULL
                    REFERENCES fournisseur_prix(produit) ON DELETE CASCADE,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_produit_alias_catalog ON produit_alias(produit_catalog)`);
        console.log('Table produit_alias verifiee');

        // Ajouter montant_total_caisse a clotures_caisse pour l'ecran
        // Finance > Cash et Stock. Optionnel (NULL autorise) — pas de
        // back-fill, les cloture passees sans valeur seront "non renseigne".
        // Idempotent via ADD COLUMN IF NOT EXISTS.
        // Guarde par cloturesTableExists: sur tenant vierge, la table est
        // creee par sequelize.sync() avec la colonne deja declaree dans le
        // modele ClotureCaisse. L'ALTER ne sert que pour les tenants existants.
        const cloturesTableExists = await checkTableExists('clotures_caisse');
        if (cloturesTableExists) {
            await sequelize.query(`
                ALTER TABLE clotures_caisse
                ADD COLUMN IF NOT EXISTS montant_total_caisse NUMERIC(12, 2)
                    CHECK (montant_total_caisse IS NULL OR montant_total_caisse >= 0)
            `);
            console.log('Colonne clotures_caisse.montant_total_caisse verifiee');
        }

        // adresse_client en TEXT (et non VARCHAR(255)).
        // Les adresses issues des commandes web peuvent depasser 255 caracteres
        // (le parsing e-mail y colle parfois du texte parasite): l'insert
        // echouait alors en "value too long for type character varying(255)",
        // remonte au POS en 500 au moment d'encaisser. db/update-vente-schema.js
        // creait deja ces colonnes en TEXT, mais uniquement pour les bases ou
        // elles n'existaient pas encore. On convertit donc explicitement.
        // varchar -> text est une bascule de metadonnees en Postgres (pas de
        // reecriture de table), et NULL/valeurs existantes sont conservees.
        for (const t of ['ventes', 'precommandes']) {
            if (!(await checkTableExists(t))) continue;
            const [cols] = await sequelize.query(`
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = '${t}'
                  AND column_name = 'adresse_client'
                  AND data_type = 'character varying'
            `);
            if (cols.length) {
                await sequelize.query(`ALTER TABLE ${t} ALTER COLUMN adresse_client TYPE TEXT`);
                console.log(`Colonne ${t}.adresse_client convertie en TEXT`);
            }
        }

        // Index fonctionnel sur stocks.date pour PL / Cash et Stock.
        // ATTENTION: TO_DATE est STABLE (depend de lc_time), donc NON utilisable
        // dans une expression d'index (Postgres exige IMMUTABLE). On contourne
        // en convertissant DD-MM-YYYY -> YYYY-MM-DD via substring + concat (pur
        // string manip, IMMUTABLE). L'ordre lex sur YYYY-MM-DD = ordre
        // chronologique, donc on peut faire ORDER BY et <= directement sur la
        // forme ISO sans cast vers date. Les queries cote routes/finance.js
        // utilisent la meme expression pour profiter de cet index.
        // Guarde par stocksTableExists pour ne pas crasher sur une fresh
        // install ou la table n'est pas encore creee.
        if (stocksTableExists) {
            await sequelize.query(`
                CREATE INDEX IF NOT EXISTS idx_stocks_date_iso
                ON stocks (
                    (substring(date FROM 7 FOR 4) || '-' ||
                     substring(date FROM 4 FOR 2) || '-' ||
                     substring(date FROM 1 FOR 2)),
                    type_stock
                )
                WHERE date ~ '^\\d{2}-\\d{2}-\\d{4}$'
            `);
            console.log('Index fonctionnel idx_stocks_date_iso verifie');
        }

        // Colonne ventes.gros_client: la vente porte le flag "gros client"
        // (case cochee dans le modal de paiement du POS). Affiche dans le
        // tableau de Visualisation.
        if (await checkTableExists('ventes')) {
            await sequelize.query(`
                ALTER TABLE ventes
                ADD COLUMN IF NOT EXISTS gros_client BOOLEAN NOT NULL DEFAULT FALSE
            `);
            console.log('Colonne ventes.gros_client verifiee');
        }

        // Gros clients (ADMIN > Gros clients, case "Gros client" du POS).
        // Seed initial PAR TENANT (listes fournies par le metier), applique
        // UNIQUEMENT si la table est vide: un client supprime/modifie dans
        // ADMIN n'est jamais recree par un redeploy.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS gros_clients (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(150) NOT NULL,
                telephone VARCHAR(60),
                adresse VARCHAR(255),
                type VARCHAR(60),
                actif BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        const GROS_CLIENTS_SEED = {
            'o-foire': [
                ['Ta Fat Sow', '774170184', 'Ouest Foire', 'Restaurant'],
                ['Mme Diack', '776259654', 'Sacré cœur', 'Consommateur'],
                ['Mr Ndoye', '774284536', 'Ouest Foire', 'Boucher'],
                ['Sophie', '775362350', 'HLM', 'Ambassadrice'],
                ['Ta Lemou', '776321434', 'Liberté 6', 'Consommateur'],
                ['Mr Faye', '784434809', 'Ouest Foire', 'Boucher'],
                ['Seyda', '775327733', 'VDN', 'Traiteur']
            ],
            'mbao': [
                ['Fatou Ndiaye', '774523305', 'Mbao', 'Restaurant'],
                ['Mme Ciss', '775417778', 'Mbao', 'Maison et Restaurant'],
                ['Mme Ndoye', '772825741', 'Mbao', 'Consommateur'],
                ['Mme Doucouré', '773923960', 'Mbao', 'Consommateur'],
                ['Pape Fall', '763296948', 'Petit Mbao', 'Boucher'],
                ['Mme Dieng', '776595508', 'Cité Adja Marème Mbao', 'Consommateur'],
                ['Mme Diop', '776563883', 'Mbao', 'Consommateur'],
                ['Mr et Mme Cissé', '775695986 / 775729327', 'Petit Mbao', 'Maison et Restaurant'],
                ['Maimouna Diakhaté', '775386972', 'Petit Mbao', 'Consommateur'],
                ['Seynabou Sow', '776448949', 'Cité Safco', 'Ambassadrice'],
                ['Mme Diagne', '774212267', 'Rufisque', 'Consommateur'],
                ['Mme Fall', '776661150', 'Petit Mbao', 'Consommateur']
            ],
            'sacre-coeur': [
                ['Mme Diouf', '774476005', 'Sacré cœur', 'Particulier'],
                ['Mme Thioune', '773734562', 'Cité Keur Gorgui', 'Particulier'],
                ['Mme Diagne', null, 'Almadies', 'Particulier']
            ],
            'keur-massar': [
                ['Ta Ndiaya Thiam', '775799982', 'Yeumbeul Comico', 'Traiteur'],
                ['Mme Sène', '775667239', 'Jaxaay', 'Restaurant'],
                ['Mr Kane', '776388476', 'Yeumbeul', 'Consommateur'],
                ['Mr Niang', '775362350', 'Tivaouane Peulh', 'Boucher'],
                ['Mme Gueye', '775059793', 'Cité Gendarmerie', 'Consommateur'],
                ['Mme Sylla', '771597035', 'Arrêt Sall', 'Consommateur'],
                ['Siradio', '773102110', 'Station Keur Massar', 'Boucher'],
                ['Mme Thiam', '779515258', 'Cité Safco', 'Consommateur'],
                ['Mr Diagne', '775505681', 'Keur Massar', 'Consommateur'],
                ['Mr Mboj', '774401818', 'Keur Massar', 'Consommateur']
            ]
        };
        try {
            const tenantSlug = require('../config/tenant').slug;
            const seed = GROS_CLIENTS_SEED[tenantSlug] || [];
            if (seed.length) {
                const [gcCount] = await sequelize.query('SELECT COUNT(*)::int AS n FROM gros_clients');
                if (gcCount[0].n === 0) {
                    for (const [nom, tel, adr, type] of seed) {
                        await sequelize.query(
                            'INSERT INTO gros_clients (nom, telephone, adresse, type) VALUES (:nom, :tel, :adr, :type)',
                            { replacements: { nom, tel, adr, type } }
                        );
                    }
                    console.log(`Table gros_clients seedee (${seed.length} clients pour ${tenantSlug})`);
                }
            }
            console.log('Table gros_clients verifiee');
        } catch (e) {
            console.warn('⚠️  Seed gros_clients:', e.message);
        }

        // ventes.gros_client_id: reference DIRECTE vers le gros client choisi
        // dans le POS. Le booleen gros_client dit "c'est un gros client", pas
        // LEQUEL — l'API devait donc redeviner le client par telephone/nom,
        // avec l'ambiguite que ca implique (deux clients pouvant partager un
        // numero, et un rapprochement casse des qu'un client est renomme).
        // L'identite est connue avec certitude au moment de la selection: on
        // la persiste. Doit venir APRES la creation de gros_clients (FK).
        // ON DELETE SET NULL: supprimer un client du referentiel ne doit pas
        // faire disparaitre ses ventes.
        if (await checkTableExists('ventes') && await checkTableExists('gros_clients')) {
            await sequelize.query(`
                ALTER TABLE ventes
                ADD COLUMN IF NOT EXISTS gros_client_id INTEGER
                    REFERENCES gros_clients(id) ON DELETE SET NULL
            `);
            await sequelize.query(`
                CREATE INDEX IF NOT EXISTS idx_ventes_gros_client_id
                ON ventes (gros_client_id) WHERE gros_client_id IS NOT NULL
            `);

            // Reprise des ventes deja marquees gros_client (avant cette
            // colonne). Rapprochement par telephone normalise sur les 9
            // derniers chiffres, et UNIQUEMENT quand il designe un seul
            // client: on ne devine pas. Idempotent (ne touche que les NULL).
            const [maj] = await sequelize.query(`
                UPDATE ventes v
                SET gros_client_id = g.id
                FROM (
                    SELECT RIGHT(REGEXP_REPLACE(telephone, '\\D', '', 'g'), 9) AS tel, MIN(id) AS id
                    FROM gros_clients
                    WHERE telephone IS NOT NULL
                    GROUP BY 1
                    HAVING COUNT(*) = 1
                ) g
                WHERE v.gros_client = TRUE
                  AND v.gros_client_id IS NULL
                  AND RIGHT(REGEXP_REPLACE(COALESCE(v.numero_client, ''), '\\D', '', 'g'), 9) = g.tel
                RETURNING v.id
            `);
            console.log(`Colonne ventes.gros_client_id verifiee (${maj.length} vente(s) rattachee(s))`);
        }

        // Categories de depenses (ADMIN > Categories depenses). Remplace la
        // liste figee en dur dans le <select> de l'onglet Depenses. Seed des
        // 8 categories historiques UNIQUEMENT si la table est vide: les
        // depenses deja saisies gardent leur categorie, et un redeploy ne
        // recree pas ce que l'admin a supprime.
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS depense_categories (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(60) NOT NULL UNIQUE,
                libelle VARCHAR(100) NOT NULL,
                ordre INTEGER NOT NULL DEFAULT 0,
                actif BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        const [dcCount] = await sequelize.query('SELECT COUNT(*)::int AS n FROM depense_categories');
        if (dcCount[0].n === 0) {
            await sequelize.query(`
                INSERT INTO depense_categories (nom, libelle, ordre) VALUES
                    ('loyer',             'Loyer',             1),
                    ('electricite',       'Électricité',       2),
                    ('eau',               'Eau',               3),
                    ('salaire',           'Salaire',           4),
                    ('achat_marchandise', 'Achat marchandise', 5),
                    ('transport',         'Transport',         6),
                    ('entretien',         'Entretien',         7),
                    ('autre',             'Autre',             8)
            `);
            console.log('Table depense_categories seedee (8 categories)');
        }
        console.log('Table depense_categories verifiee');

        console.log('Mise à jour du schéma terminée avec succès');
        return true;
    } catch (error) {
        console.error('Erreur lors de la mise à jour du schéma:', error);
        throw error;
    }
}

/**
 * Vérifie si une table existe dans la base de données
 */
async function checkTableExists(tableName) {
    try {
        // Use current_schema() so this works correctly under
        // schema-per-tenant (Variant A). Hardcoding 'public' would
        // always return false for non-public tenants and force a
        // re-sync on every boot — harmless but wrong, and would also
        // mask whether the table genuinely exists in this tenant.
        // SELECT 1 explicite (vs SELECT FROM) pour la portabilité — pg-mem
        // exige une colonne dans le subquery EXISTS, Postgres réel accepte
        // les deux. Comportement identique en prod, plus testable hors-prod.
        const query = `
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = current_schema()
                AND table_name = :tableName
            )
        `;

        const result = await sequelize.query(query, {
            replacements: { tableName },
            type: sequelize.QueryTypes.SELECT,
            plain: true
        });

        return result.exists;
    } catch (error) {
        console.error(`Erreur lors de la vérification de l'existence de la table ${tableName}:`, error);
        throw error;
    }
}

/**
 * Vérifie si les colonnes spécifiées existent dans la table.
 *
 * Utilise IN (:c0, :c1, …) avec placeholders nommés. ANY(:cols) ne marche
 * pas avec Sequelize en Postgres réel: l'array se fait expand comme valeurs
 * comma-séparées, pas comme literal ARRAY[].
 *
 * Constrain to current_schema() pour ne pas matcher d'autres schémas tenant
 * dans le mode shared-Postgres.
 */
async function checkColumnsExist(tableName, columnNames) {
    try {
        const placeholders = columnNames.map((_, i) => `:c${i}`).join(', ');
        const replacements = { tableName };
        columnNames.forEach((c, i) => { replacements[`c${i}`] = c; });

        const query = `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
            AND table_name = :tableName
            AND column_name IN (${placeholders})
        `;

        const rows = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        return rows.length === columnNames.length;
    } catch (error) {
        console.error(`Erreur lors de la vérification des colonnes dans la table ${tableName}:`, error);
        throw error;
    }
}

/**
 * Migre les données existantes vers le nouveau format
 */
async function migrateExistingData() {
    try {
        console.log('Début de la migration des données existantes...');
        
        // Récupérer toutes les réconciliations
        const reconciliations = await sequelize.query(
            'SELECT id, data FROM reconciliations',
            { type: sequelize.QueryTypes.SELECT }
        );
        
        console.log(`${reconciliations.length} réconciliations trouvées à migrer`);
        
        // Pour chaque réconciliation, extraire les commentaires et les stocker dans la nouvelle colonne
        for (const rec of reconciliations) {
            try {
                let data;
                let comments = {};
                
                // Parser les données
                try {
                    data = typeof rec.data === 'string' ? JSON.parse(rec.data) : rec.data;
                } catch (e) {
                    console.error(`Erreur lors du parsing des données pour l'ID ${rec.id}:`, e);
                    continue; // Passer à la suivante
                }
                
                // Extraire les données de réconciliation selon la structure
                let reconciliationData;
                if (data.reconciliation) {
                    reconciliationData = data.reconciliation;
                } else if (data.data && data.data.reconciliation) {
                    reconciliationData = data.data.reconciliation;
                } else {
                    reconciliationData = data;
                }
                
                // Extraire les commentaires
                if (reconciliationData && typeof reconciliationData === 'object') {
                    Object.entries(reconciliationData).forEach(([pointVente, pointData]) => {
                        if (pointData && pointData.commentaire) {
                            comments[pointVente] = pointData.commentaire;
                        }
                    });
                }
                
                // Mettre à jour l'enregistrement avec les nouvelles données structurées
                await sequelize.query(
                    `UPDATE reconciliations 
                     SET "comments" = :comments,
                         "calculated" = TRUE,
                         "version" = 1
                     WHERE id = :id`,
                    {
                        replacements: {
                            id: rec.id,
                            comments: JSON.stringify(comments)
                        }
                    }
                );
                
                console.log(`Réconciliation ID ${rec.id} migrée avec succès`);
                
            } catch (error) {
                console.error(`Erreur lors de la migration de la réconciliation ID ${rec.id}:`, error);
                // Continuer malgré l'erreur
            }
        }
        
        console.log('Migration des données terminée');
        
    } catch (error) {
        console.error('Erreur lors de la migration des données:', error);
        throw error;
    }
}

// Exécuter la mise à jour si le script est appelé directement
if (require.main === module) {
    updateSchema()
        .then(() => {
            console.log('Mise à jour du schéma terminée avec succès');
            process.exit(0);
        })
        .catch(error => {
            console.error('Erreur lors de la mise à jour du schéma:', error);
            process.exit(1);
        });
}

module.exports = { updateSchema }; 