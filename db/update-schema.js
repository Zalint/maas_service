const { sequelize } = require('./index');
const Reconciliation = require('./models/Reconciliation');
const CashPayment = require('./models/CashPayment');

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

        // Ajouter les colonnes ventes (inventaire -> liste de produits vente)
        // et prix_personnalise (vente -> flag de détachement) sur la table produits.
        // Idempotent: ALTER ... ADD COLUMN IF NOT EXISTS ne fait rien si déjà présent.
        const produitsTableExists = await checkTableExists('produits');
        if (produitsTableExists) {
            await sequelize.query(`
                ALTER TABLE produits
                ADD COLUMN IF NOT EXISTS "ventes" TEXT[] DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS "prix_personnalise" BOOLEAN NOT NULL DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS "ventilation_poids" BOOLEAN NOT NULL DEFAULT FALSE
            `);
            console.log('Colonnes ventes / prix_personnalise / ventilation_poids vérifiées/ajoutées dans la table produits');

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

        // Historique des modifications de prix_vente_cdc.
        // Chaque sauvegarde insere une ligne avec l'ancienne valeur + qui
        // l'a fait. Permet de retracer les renegociations B2B.
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
        console.log('Table prix_vente_cdc_history verifiee');

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
              ('categories_eligibles', 'Bovin,Ovin,Caprin,Volaille,Poisson', NOW())
            ON CONFLICT (key) DO NOTHING
        `);
        console.log('Table finance_config verifiee (seed commission_pct=3.0)');

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