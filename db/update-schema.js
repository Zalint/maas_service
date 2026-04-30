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
        
        // Ajouter la colonne default_screen à la table users si elle n'existe pas
        await sequelize.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS default_screen VARCHAR(100) DEFAULT NULL
        `);
        console.log('Colonne default_screen vérifiée/ajoutée dans la table users');

        // Ajouter les colonnes ventes (inventaire -> liste de produits vente)
        // et prix_personnalise (vente -> flag de détachement) sur la table produits.
        // Idempotent: ALTER ... ADD COLUMN IF NOT EXISTS ne fait rien si déjà présent.
        const produitsTableExists = await checkTableExists('produits');
        if (produitsTableExists) {
            await sequelize.query(`
                ALTER TABLE produits
                ADD COLUMN IF NOT EXISTS "ventes" TEXT[] DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS "prix_personnalise" BOOLEAN NOT NULL DEFAULT FALSE
            `);
            console.log('Colonnes ventes / prix_personnalise vérifiées/ajoutées dans la table produits');
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
            // Pré-remplir avec les 6 catégories logiques standard pour matcher
            // les défauts hardcodés du frontend. Les catégories personnalisées
            // tomberont sur 'Autres' lors de leur première classification via
            // l'UI (PUT inventaire-categories/:nom).
            await sequelize.query(`
                INSERT INTO inventaire_categories (nom, famille) VALUES
                  ('Viandes', 'Boucherie'),
                  ('Abats et Sous-produits', 'Boucherie'),
                  ('Produits sur Pieds', 'Boucherie'),
                  ('Œufs et Produits Laitiers', 'Epicerie'),
                  ('Déchets', 'Autres'),
                  ('Autres', 'Autres')
                ON CONFLICT (nom) DO NOTHING
            `);
            console.log('Table inventaire_categories créée et pré-remplie');
        }

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
        const query = `
            SELECT EXISTS (
                SELECT FROM information_schema.tables
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
 * Vérifie si les colonnes spécifiées existent dans la table
 */
async function checkColumnsExist(tableName, columnNames) {
    try {
        // Construction d'une requête qui compte les colonnes existantes
        const placeholders = columnNames.map((col, idx) => `:col${idx}`).join(', ');
        const replacements = {};
        columnNames.forEach((col, idx) => {
            replacements[`col${idx}`] = col;
        });
        replacements.tableName = tableName;
        
        // Constrain to current_schema() — without it, this would match
        // columns in any schema named the same way, which under
        // schema-per-tenant could give false positives across tenants.
        const query = `
            SELECT COUNT(*) as count
            FROM information_schema.columns
            WHERE table_schema = current_schema()
            AND table_name = :tableName
            AND column_name IN (${placeholders})
        `;
        
        const result = await sequelize.query(query, {
            replacements,
            type: sequelize.QueryTypes.SELECT,
            plain: true
        });
        
        // Si le nombre de colonnes trouvées correspond au nombre de colonnes recherchées
        return result.count == columnNames.length;
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