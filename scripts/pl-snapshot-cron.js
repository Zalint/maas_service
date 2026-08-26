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

// Pas de dependance pour un seul cast: ce script tourne seul.
function nb(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

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

        // METTRE LE SCHEMA A JOUR AVANT DE CALCULER.
        //
        // Ce script tourne dans SON PROPRE processus (server.js le lance par
        // spawn, cf le cron a 23h35): il n'herite pas du updateSchema() joue
        // au demarrage du serveur. En exploitation la question ne se pose
        // guere - c'est ce meme serveur, deja migre, qui programme le cron -
        // mais un lancement A LA MAIN sur une base jamais demarree, ou un
        // schema de tenant dont la migration a echoue, faisait echouer le
        // calcul entier sur une colonne inconnue.
        //
        // BEST EFFORT, volontairement. Un echec ici n'arrete pas le script:
        // le schema est le plus souvent deja bon, et une DDL concurrente (un
        // deploiement qui redemarre l'application a la meme minute) peut faire
        // echouer la migration sans que rien ne manque reellement. C'est le
        // calcul lui-meme qui tranche, juste en dessous.
        //
        // Saute en dry-run: --dry-run promet que rien n'est ecrit, et
        // updateSchema() ecrit - DDL et donnees de reference.
        if (DRY_RUN) {
            console.log('[pl-snapshot] dry-run: migration du schema sautee');
        } else {
            try {
                const { updateSchema } = require('../db/update-schema');
                await updateSchema();
            } catch (e) {
                console.warn('[pl-snapshot] migration du schema echouee, on continue:', e.message);
                console.warn('[pl-snapshot] si une colonne manque vraiment, le calcul le dira.');
            }
        }

        // UNE COLONNE MANQUANTE N'EST PAS UNE PANNE DE CALCUL.
        //
        // Deuxieme filet, apres la migration ci-dessus: si elle a echoue ET
        // qu'une colonne manque pour de bon, l'erreur Postgres brute tombait a
        // 23h35 dans un journal que personne ne lit sur le moment. On la
        // nomme, avec le geste qui la repare - un schema en retard se
        // rattrape, contrairement a un PL faux.
        let data;
        try {
            data = await computePl(dateDebut, dateFin);
        } catch (e) {
            const pg = (e && (e.parent || e.original)) || e;
            if (pg && pg.code === '42703') {
                console.error(`[pl-snapshot] REFUS: le schema de la base est en retard sur le code (${pg.message}).`);
                // Le conseil depend de ce qui s'est reellement passe: en
                // dry-run la migration a ete SAUTEE, et lui reprocher de
                // n'avoir pas suffi enverrait chercher une panne inexistante.
                console.error(DRY_RUN
                    ? `[pl-snapshot] la migration est sautee en dry-run: relancer sans --dry-run, `
                      + `ou lancer \`node db/update-schema.js\`. Rien n'est fige.`
                    : `[pl-snapshot] la migration jouee juste avant n'a pas suffi: lancer `
                      + `\`node db/update-schema.js\` a la main pour voir son erreur, puis rejouer `
                      + `ce cron. Rien n'est fige.`);
                process.exitCode = 1;
                return;
            }
            throw e;
        }
        console.log(`[pl-snapshot] PL ${data.pl} FCFA (ventes ${data.total_ventes}, ${data.periode.nb_jours} jour(s))`);

        // MEME refus que POST /api/finance/pl/snapshot: on ne grave pas un PL
        // dont une source n'a pas repondu. Le cron est le chemin le plus
        // dangereux pour cette faute, parce que personne ne regarde: un PL
        // ampute des avances s'installerait en base sans qu'aucun ecran ne le
        // dise. Mieux vaut un trou dans l'historique, qui se voit et se
        // rattrape, qu'un chiffre faux qui a l'air definitif.
        //
        // Deuxieme refus, independant: on ne grave pas non plus une
        // ESTIMATION de stock du soir. Le cron tourne a 23h35 alors que la
        // saisie du soir reste ouverte jusqu'a 04h00: sans ce refus, il
        // figerait presque chaque soir un stock non encore compte.
        if (data.sources && data.sources.fiable === false) {
            const raison = (data.sources.avances && data.sources.avances.raison) || 'source indisponible';
            console.warn(`[pl-snapshot] REFUS de figer le ${dateFin}: ${raison}.`);
            console.warn('[pl-snapshot] les avances comptent pour 0, le PL serait faux. Rien ecrit.');
            process.exitCode = 1;
        } else if (nb(data.avances_provisoires) > 0) {
            // UNE AVANCE EN RETARD N'EST PAS UNE AVANCE ABSENTE.
            //
            // Le refus ci-dessus couvre la source MUETTE. Ici la source
            // repond, mais une journee a recu de la marchandise sans que
            // MataBanq ait encore enregistre son avance: le cout des ventes
            // la compte PROVISOIREMENT, et le PL du jour en depend.
            //
            // Figer un tel PL grave un chiffre que la saisie du lendemain
            // rendra faux, sans que rien ne le dise: le panneau d'ecart
            // attribuerait la difference a un poste plutot qu'a une saisie
            // tardive. Mieux vaut un trou dans l'historique, qui se voit et
            // se rattrape en rejouant le cron.
            const dates = (data.avances_provisoires_detail || [])
                .map((e) => e.date).join(', ');
            console.warn(`[pl-snapshot] REFUS: ${data.avances_provisoires} FCFA d'avances `
                + `non encore saisies (${dates || 'dates inconnues'}).`);
            console.warn('[pl-snapshot] le cout des ventes les compte a titre provisoire; '
                + 'figer maintenant graverait un PL que la saisie rendra faux. Rien ecrit.');
            process.exitCode = 1;
        } else if (data.stock && data.stock.soir_estime) {
            const meta = data.stock.estimation || {};
            console.warn(`[pl-snapshot] REFUS: stock du soir non saisi pour le ${dateFin} `
                + `(dernier comptage le ${meta.date_ancre || '?'}). Rien n'est fige.`);
        } else if (DRY_RUN) {
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
