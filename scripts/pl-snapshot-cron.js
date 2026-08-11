#!/usr/bin/env node
/**
 * Fige le PL du jour dans pl_snapshots — execute par le cron in-process de
 * server.js chaque soir a 23h35 UTC (Dakar = UTC), ou a la main.
 *
 * Passe par LE meme calcul que l'ecran (routes/finance.js#computePl) sur la
 * periode par defaut (1er du mois -> aujourd'hui): le chiffre fige est
 * exactement celui que l'ecran affichait. Une ligne par date, la derniere
 * ecrase (upsert) - relancer le script reecrit le meme jour sans doublon.
 *
 * Usage: node scripts/pl-snapshot-cron.js [--dry-run]
 */

'use strict';

// Charger .env puis .env.local (override) AVANT tout require applicatif,
// comme scripts/dev-tenant.js. Le calcul du PL appelle MataBanq
// (DEPENSES_API_*) et DATA: lance a la main sans ces variables, ces appels
// replient EN SILENCE (avances a 0) et le snapshot serait faux - constate:
// PL fige a +1 283 673 quand l'ecran disait -191 906, l'ecart etant tout
// juste les avances. Sur Render, les variables viennent du service et ces
// deux lignes ne trouvent aucun fichier: no-op.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
    const t0 = Date.now();
    // Hisse hors du try: si le require lui-meme echoue, sequelize reste
    // undefined et le finally n'essaie pas de fermer une connexion qui
    // n'existe pas.
    let sequelize;
    try {
        ({ sequelize } = require('../db/models'));
        const { computePl, periodePlParDefaut } = require('../routes/finance');
        const { PlSnapshot } = require('../db/models');

        const { dateDebut, dateFin } = periodePlParDefaut();
        console.log(`[pl-snapshot] calcul du PL ${dateDebut} -> ${dateFin}${DRY_RUN ? ' (dry-run)' : ''}`);

        const data = await computePl(dateDebut, dateFin);
        console.log(`[pl-snapshot] PL ${data.pl} FCFA (ventes ${data.total_ventes}, ${data.periode.nb_jours} jour(s))`);

        // Meme garde que la route: on ne grave pas une estimation dans un
        // historique qu'aucune route ne peut corriger. Le cron tourne a 23h35
        // alors que la saisie du soir reste ouverte jusqu'a 04h00: sans ce
        // refus, il figerait presque chaque soir un stock non encore compte.
        if (data.stock && data.stock.soir_estime) {
            const meta = data.stock.estimation || {};
            console.warn(`[pl-snapshot] REFUS: stock du soir non saisi pour le ${dateFin} `
                + `(dernier comptage le ${meta.date_ancre || '?'}). Rien n'est fige.`);
            return;
        }

        if (DRY_RUN) {
            console.log('[pl-snapshot] dry-run: rien ecrit');
        } else {
            await PlSnapshot.upsert({
                date: dateFin,
                periode_debut: dateDebut,
                periode_fin: dateFin,
                pl: data.pl,
                total_ventes: data.total_ventes,
                source: 'cron',
                created_by: null,
                payload: data,
                updated_at: new Date()
            });
            console.log(`[pl-snapshot] fige pour le ${dateFin} (source cron)`);
        }
        console.log(`[pl-snapshot] termine en ${Date.now() - t0} ms`);
    } catch (e) {
        // Un echec ne doit pas rester silencieux dans les logs Render, mais ne
        // casse rien d'autre: le snapshot du jour manquera, c'est tout.
        // exitCode (et non exit()) laisse Node vider stdout/stderr avant de
        // quitter - un exit() immediat peut tronquer la sortie sur un
        // pipe (le process est spawn avec stdio 'pipe' cote server.js).
        console.error('[pl-snapshot] ECHEC:', e.message);
        process.exitCode = 1;
    } finally {
        // Ferme le pool dans TOUS les cas (succes, dry-run, echec): sans ca,
        // une erreur APRES l'ouverture de la connexion laissait le pool
        // ouvert, le seul filet etant l'exit() force qui masquait le probleme.
        if (sequelize) await sequelize.close();
    }
})();
