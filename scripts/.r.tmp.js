require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
(async () => {
    const { sequelize } = require('../db/index');
    // Remet l'etat d'AVANT pour rejouer la migration proprement.
    await sequelize.query("DELETE FROM finance_config WHERE key = 'migration_famille_bovine_materialisee'");
    await sequelize.query("DELETE FROM produit_alias WHERE LOWER(TRIM(alias_produit)) <> 'jarret'");
    const [a] = await sequelize.query('SELECT COUNT(*)::int n FROM produit_alias');
    console.log('avant migration :', a[0].n, 'alias (Jarret seul, pose a la main)');
    await sequelize.close();
})();
