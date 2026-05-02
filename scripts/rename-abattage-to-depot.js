#!/usr/bin/env node
/**
 * Renomme le point de vente "Abattage" en "Dépôt central" pour le tenant
 * courant (celui pointé par les variables d'environnement DB).
 *
 * À lancer UNE fois par tenant après déploiement du code:
 *
 *   npm run tenant:rename-abattage
 *
 * Idempotent: si le PV n'existe plus sous "Abattage" (déjà migré), le
 * script ne fait rien et exit 0.
 *
 * Ce qu'il fait:
 *   1. Vérifie la connexion BDD.
 *   2. Renomme le PV "Abattage" -> "Dépôt central" et le réactive.
 *   3. Log clair (avant/après).
 *
 * Ne touche PAS:
 *   - Les colonnes payment_ref ('V_ABATS', 'CASH_ABATS') volontairement
 *     conservées comme identifiants stables.
 *   - L'historique transferts/ventes/stock (utilisateur a confirmé qu'il
 *     n'y a pas de données legacy à migrer).
 */

require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local',
});

const { sequelize, testConnection } = require('../db');

const OLD_NAME = 'Abattage';
const NEW_NAME = 'Dépôt central';

async function main() {
    console.log(`\n=== rename-abattage-to-depot (tenant: ${process.env.TENANT_SLUG || 'unknown'}) ===\n`);

    const ok = await testConnection();
    if (!ok) {
        console.error('❌ Connexion BDD impossible. Vérifier .env / .env.local.');
        process.exit(1);
    }

    // Etat avant
    const [before] = await sequelize.query(
        `SELECT nom, active, payment_ref FROM points_vente WHERE nom IN (:old, :new) ORDER BY nom`,
        { replacements: { old: OLD_NAME, new: NEW_NAME } }
    );
    console.log('Avant migration:', before);

    const hasOld = before.some((r) => r.nom === OLD_NAME);
    const hasNew = before.some((r) => r.nom === NEW_NAME);

    if (!hasOld && hasNew) {
        console.log(`✅ Déjà migré: "${NEW_NAME}" présent, "${OLD_NAME}" absent. Rien à faire.`);
        process.exit(0);
    }
    if (!hasOld && !hasNew) {
        console.log(`ℹ️  Aucun PV "${OLD_NAME}" ni "${NEW_NAME}" trouvé. Rien à faire (tenant frais).`);
        process.exit(0);
    }
    if (hasOld && hasNew) {
        // Cas pathologique: les deux existent. Refus de fusionner automatiquement.
        console.error(`❌ Conflit: "${OLD_NAME}" ET "${NEW_NAME}" existent tous les deux. Migration manuelle requise.`);
        process.exit(2);
    }

    // hasOld && !hasNew → rename + activation
    const [, meta] = await sequelize.query(
        `UPDATE points_vente
            SET nom = :new, active = TRUE, updated_at = NOW()
          WHERE nom = :old`,
        { replacements: { old: OLD_NAME, new: NEW_NAME } }
    );
    console.log(`✅ Renamed "${OLD_NAME}" -> "${NEW_NAME}" et active=TRUE.`);

    const [after] = await sequelize.query(
        `SELECT nom, active, payment_ref FROM points_vente WHERE nom = :new`,
        { replacements: { new: NEW_NAME } }
    );
    console.log('Après migration:', after);

    await sequelize.close();
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Erreur migration:', err);
    process.exit(1);
});
