/**
 * @jest-environment node
 *
 * PROJECTION DE LA SYNTHESE EXTERNE - lib/synthese-projection.js.
 *
 * Le module orchestre les MEMES modules purs que l'ecran (simulation-v2-
 * projection et -moteur, partages par UMD): ces tests ne re-verifient pas
 * leurs formules - les suites simulation-v2-*.test.js s'en chargent - mais
 * l'ORCHESTRATION: priorite du coefficient, parage retenu par espece, prix
 * de la suite, identite du CA « volumes x derniers prix », et les refus
 * explicites (v2 inactive, periode hors mois, mois complet).
 *
 * La fixture est aout 2026, dimanches les 2, 9, 16, 23 et 30. Analyse au 20:
 * 8 jours P1 actifs (1-10 moins les 2 et 9), 9 jours P2 (11-20 moins le 16),
 * restent 3 jours P2 (21, 22, 24) et 6 jours P1 (25-29, 31).
 */

const {
    calculerProjection, parageRetenu, auPrixDeLaSuite, construireContexte
} = require('../lib/synthese-projection');

/** ca_par_jour d'aout 2026 jusqu'au 20: 120 000 en P1, 100 000 en P2. */
function caParJourAout() {
    const ca = {};
    for (let j = 1; j <= 20; j += 1) {
        const iso = '2026-08-' + String(j).padStart(2, '0');
        if ([2, 9, 16].includes(j)) continue; // dimanches: fermes
        ca[iso] = (j <= 10) ? 120000 : 100000;
    }
    return ca;
}

/** Historique mai-juillet 2026 (91 jours): P1 a 110 000, P2 a 90 000. */
function historique() {
    const ca = {};
    const d = new Date('2026-05-02T00:00:00Z');
    const fin = new Date('2026-07-31T00:00:00Z');
    while (d <= fin) {
        const iso = d.toISOString().slice(0, 10);
        if (d.getUTCDay() !== 0) {
            const jour = parseInt(iso.slice(8, 10), 10);
            ca[iso] = (jour >= 11 && jour <= 24) ? 90000 : 110000;
        }
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return { debut: '2026-05-02', fin: '2026-07-31', ca_par_jour: ca };
}

function simDeBase(surcharges) {
    return Object.assign({
        produits: [],
        produits_vendus: [
            {
                nom: 'Boeuf en détail', quantite: 300, ca: 1650000,
                prix_moyen: 5500, prix_achat: 4200, prix_achat_fin: 4300,
                prix_retenu: { prix: 5600 }
            },
            {
                nom: 'Agneau', quantite: 30, ca: 210000,
                prix_moyen: 7000, prix_achat: 5600, prix_achat_fin: null,
                prix_retenu: null
            }
        ],
        catalogue: {
            pv_boeuf: 4500, pv_agneau: 4800, pv_poulet: 3500, par_produit: {}
        },
        projection: {
            ca_par_jour: caParJourAout(),
            historique: historique(),
            coeff_defaut: 1.28,
            coeff_enregistre: null
        },
        parage_mesure: {
            bovin: 4, ovin: 12,
            jours_mesures: { bovin: 10, ovin: 2 },
            jusquau: '2026-08-19'
        },
        top_clients: [],
        clients_historique: null,
        commandes: []
    }, surcharges || {});
}

function plDeBase(surcharges) {
    return Object.assign({
        periode: { dateDebut: '2026-08-01', dateFin: '2026-08-20' },
        pl: 250000,
        total_ventes: 1860000,
        total_avances: 1400000,
        commission_maas: 55800,
        marge_cdc: 0,
        depenses_periode: 60000,
        paiements_fournisseur: 0,
        taux_marge: 15,
        charges: { total_mensuel: 250000, total_prorata: 161000 },
        stock: {
            variation_nette: -50000, pertes_decoupe_pct: 5,
            variation_bovin: -40000, variation_ovin: 0,
            variation_autre_boucherie: 0, coeff: 0.95,
            matin_detail: [], soir_detail: []
        },
        sources: { fiable: true }
    }, surcharges || {});
}

describe('refus explicites', () => {
    test('donnees manquantes', () => {
        expect(calculerProjection({ sim: null, pl: null }))
            .toEqual({ indisponible: 'donnees_manquantes' });
    });

    test('simulation v2 inactive : projection null dans computeSimulation', () => {
        const sim = simDeBase({ projection: null });
        expect(calculerProjection({ sim, pl: plDeBase() }).indisponible)
            .toBe('simulation_v2_inactive');
    });

    test('periode hors mois : debut qui n\'est pas un 1er', () => {
        const pl = plDeBase({ periode: { dateDebut: '2026-08-05', dateFin: '2026-08-20' } });
        expect(calculerProjection({ sim: simDeBase(), pl }).indisponible)
            .toBe('periode_hors_mois');
    });

    test('mois complet : analyse au dernier jour, rien a projeter', () => {
        const pl = plDeBase({ periode: { dateDebut: '2026-08-01', dateFin: '2026-08-31' } });
        const r = calculerProjection({ sim: simDeBase(), pl });
        expect(r.indisponible).toBe('mois_complet');
        // Le CA realise reste dit: le refus n'est pas un ecran noir.
        expect(r.ca_realise).toBeGreaterThan(0);
    });
});

describe('coefficient P1/P2 : priorite du plus delibere', () => {
    test('la calibration enregistree prime sur le calcul en direct', () => {
        const sim = simDeBase();
        sim.projection.coeff_enregistre = { valeur: '1.5', le: '2026-08-10', par: 'admin' };
        const r = calculerProjection({ sim, pl: plDeBase(), commissionPct: 3 });
        expect(r.hypotheses.coefficient_p1_p2).toBe(1.5);
        expect(r.hypotheses.origine_coefficient).toContain('calibration enregistree');
    });

    test('sans calibration enregistree, le calcul en direct sur l\'historique', () => {
        const r = calculerProjection({ sim: simDeBase(), pl: plDeBase(), commissionPct: 3 });
        // Historique construit a 110 000 / 90 000: le coefficient mesure.
        expect(r.hypotheses.coefficient_p1_p2).toBeCloseTo(110000 / 90000, 6);
        expect(r.hypotheses.origine_coefficient).toContain('calibre en direct');
    });

    test('sans historique exploitable, la reference du document', () => {
        const sim = simDeBase();
        sim.projection.historique = { debut: null, fin: null, ca_par_jour: {} };
        const r = calculerProjection({ sim, pl: plDeBase(), commissionPct: 3 });
        expect(r.hypotheses.coefficient_p1_p2).toBe(1.28);
        expect(r.hypotheses.origine_coefficient).toBe('reference du document');
    });
});

describe('parage retenu par espece', () => {
    test('mesure avec assise (>= 5 jours) : le mesure; sinon le parametre', () => {
        // Bovin: 10 journees mesurables -> 4 %. Ovin: 2 journees -> repli 5 %.
        const r = calculerProjection({ sim: simDeBase(), pl: plDeBase(), commissionPct: 3 });
        expect(r.hypotheses.parage_bovin_pct).toBe(4);
        expect(r.hypotheses.parage_ovin_pct).toBe(5);
    });

    test('parageRetenu directement : les trois cas', () => {
        const mesure = { bovin: 11, ovin: null, jours_mesures: { bovin: 6, ovin: 0 } };
        expect(parageRetenu(mesure, 5, 5, 'bovin')).toBe(11);
        expect(parageRetenu(mesure, 5, 5, 'ovin')).toBe(5);
        expect(parageRetenu(null, 5, 5, 'bovin')).toBe(5);
    });

    test('parage mesure suspect (double du parametre et +5 points) : alerte', () => {
        const sim = simDeBase({
            parage_mesure: {
                bovin: 4, ovin: 12,
                jours_mesures: { bovin: 10, ovin: 6 },
                jusquau: '2026-08-19'
            }
        });
        const r = calculerProjection({ sim, pl: plDeBase(), commissionPct: 3 });
        expect(r.hypotheses.parage_ovin_pct).toBe(12);
        expect(r.alertes).toHaveLength(1);
        expect(r.alertes[0]).toContain('agneau');
        expect(r.alertes[0]).toContain('12.00 %');
    });
});

describe('prix de la suite', () => {
    test('le prix retenu (majoritaire du dernier jour) remplace le prix moyen, '
        + 'le prix d\'achat de fin remplace la moyenne ponderee', () => {
        const p = auPrixDeLaSuite({
            nom: 'Boeuf en détail', prix_moyen: 5500, prix_achat: 4200,
            prix_achat_fin: 4300, prix_retenu: { prix: 5600 }
        });
        expect(p.prix_moyen).toBe(5600);
        expect(p.prix_achat).toBe(4300);
    });

    test('sans prix de fin ni prix retenu, les moyennes restent', () => {
        const p = auPrixDeLaSuite({
            nom: 'Agneau', prix_moyen: 7000, prix_achat: 5600,
            prix_achat_fin: null, prix_retenu: null
        });
        expect(p.prix_moyen).toBe(7000);
        expect(p.prix_achat).toBe(5600);
    });
});

describe('le CA projete et sa methode', () => {
    test('rythmes P1/P2 : 70 % reel + 30 % historique, jours restants exacts', () => {
        const r = calculerProjection({ sim: simDeBase(), pl: plDeBase(), commissionPct: 3 });
        // Realise: 8 x 120 000 + 9 x 100 000.
        expect(r.ca.caRealise).toBe(1860000);
        expect(r.ca.restants).toEqual({ P1: 6, P2: 3 });
        // Rythmes melanges: P1 = 0,7x120k + 0,3x110k; P2 = 0,7x100k + 0,3x90k.
        expect(r.ca.rythmes.P1).toBeCloseTo(117000, 6);
        expect(r.ca.rythmes.P2).toBeCloseTo(97000, 6);
        expect(r.ca.caProjete).toBeCloseTo(1860000 + 6 * 117000 + 3 * 97000, 6);
    });

    test('methode « derniers » : CA retenu = realise + proportion x '
        + 'Sigma(quantite x dernier prix de vente)', () => {
        const r = calculerProjection({ sim: simDeBase(), pl: plDeBase(), commissionPct: 3 });
        const caPlein = 300 * 5600 + 30 * 7000; // prix retenus de la fixture
        expect(r.hypotheses.ca_plein_derniers_prix).toBe(caPlein);
        const prop = (r.ca.caProjete - 1860000) / 1860000;
        expect(r.hypotheses.ca_projete_retenu)
            .toBeCloseTo(1860000 + prop * caPlein, 6);
        expect(r.hypotheses.ca_methode).toBe('derniers');
    });
});

describe('la sortie complete', () => {
    test('memes noms que l\'export JSON de l\'ecran, hypotheses toutes redites', () => {
        const r = calculerProjection({ sim: simDeBase(), pl: plDeBase(), commissionPct: 3 });
        for (const cle of ['hypotheses', 'periode', 'jours', 'ca', 'confiance',
            'taux_marge_courant', 'taux_marge_constate_pct', 'scenarios',
            'volumes_et_prix', 'plan_equilibre', 'recommandations', 'alertes']) {
            expect(r).toHaveProperty(cle);
        }
        expect(r.hypotheses).toMatchObject({
            ponderation_reel: 0.7, min_jours_mesures: 5,
            exclure_dimanches: true, option_stock: 'garder',
            option_depenses: 'realise', pl_cible: 0, commission_pct: 3
        });
        expect(r.periode).toEqual({ debut: '2026-08-01', fin: '2026-08-20' });
        // 17 jours ouvres ecoules (20 moins les dimanches 2, 9, 16), 26 au mois.
        expect(r.jours).toEqual({ ecoules: 17, mois: 26 });
    });

    test('les trois scenarios sortent avec un PL chiffre', () => {
        const r = calculerProjection({ sim: simDeBase(), pl: plDeBase(), commissionPct: 3 });
        expect(r.pl_projete_disponible).toBe(true);
        for (const s of ['prudent', 'central', 'haut']) {
            expect(typeof r.scenarios[s].pl).toBe('number');
            expect(typeof r.scenarios[s].ca).toBe('number');
        }
        // Prudent < central < haut sur le CA, par construction (-10 % / +10 %).
        expect(r.scenarios.prudent.ca).toBeLessThan(r.scenarios.central.ca);
        expect(r.scenarios.haut.ca).toBeGreaterThan(r.scenarios.central.ca);
    });

    test('les volumes projetes ne portent que les bovins qui ont vendu', () => {
        const r = calculerProjection({ sim: simDeBase(), pl: plDeBase(), commissionPct: 3 });
        expect(r.volumes_et_prix).not.toBeNull();
        const noms = r.volumes_et_prix.lignes.map((l) => l.nom);
        expect(noms).toContain('Boeuf en détail');
        expect(noms).not.toContain('Agneau');
    });
});

describe('commission integree: l API dit la meme chose que le serveur', () => {
    // Le serveur cesse de facturer la commission sur les produits dont le
    // prix d'achat la porte deja; cette projection, qui la REDERIVE par
    // produit a partir du prix catalogue, doit cesser avec lui. Sans quoi la
    // synthese externe et le PL du meme mois se contredisent.
    //
    // Les marges attendues sont recalculees ici: bovin a 4 % de parage mesure
    // (10 journees, assise atteinte), prix de la SUITE 5 600 / 4 300, prix
    // catalogue 4 500, taux 3 %.
    const margeParage = 5600 - 4300 / 0.96;          // 1 120,83
    const ponction = 0.03 * 4500 / 0.96;             // 140,63

    test('le contexte porte le reglage, et null quand le payload est muet', () => {
        const reponseData = { disponible: true, produits: ['Boeuf'] };
        expect(construireContexte(
            simDeBase(), plDeBase({ commission_integree: reponseData }), 3
        ).commissionIntegree).toEqual(reponseData);
        // Payload d'une version anterieure: rien, et le moteur retombe alors
        // sur son defaut prudent (personne n'est integre).
        expect(construireContexte(simDeBase(), plDeBase(), 3).commissionIntegree).toBeNull();
    });

    test('sans reponse de DATA: la commission est deduite, comportement d avant', () => {
        const r = calculerProjection({ sim: simDeBase(), pl: plDeBase(), commissionPct: 3 });
        expect(r.volumes_et_prix.lignes[0].marge).toBeCloseTo(margeParage - ponction, 6);
    });

    test('bœuf integre: la marge remonte d exactement une commission', () => {
        const r = calculerProjection({
            sim: simDeBase(),
            pl: plDeBase({ commission_integree: { disponible: true, produits: ['Boeuf'] } }),
            commissionPct: 3
        });
        expect(r.volumes_et_prix.lignes[0].marge).toBeCloseTo(margeParage, 6);
        // Et le volume a vendre pour tenir la cible bouge avec elle: une marge
        // sous-estimee faisait viser plus haut que necessaire.
        expect(Math.abs(r.volumes_et_prix.deltaTotal)).toBeLessThan(216);
    });

    test('L EXCEPTION BŒUF: DATA muet, le prix vient du catalogue, elle est due', () => {
        // Le serveur n'inscrit PAS le boeuf, alors que les autres produits y
        // sont. C'est la seule facon de distinguer « achete commission
        // comprise » de « achete au catalogue parce que DATA n'a rien publie ».
        const r = calculerProjection({
            sim: simDeBase(),
            pl: plDeBase({ commission_integree: { disponible: true, produits: ['Agneau'] } }),
            commissionPct: 3
        });
        expect(r.volumes_et_prix.lignes[0].marge).toBeCloseTo(margeParage - ponction, 6);
    });

    test('la reponse de DATA est REDITE dans les hypotheses', () => {
        // « Les marges sont nettes de commission » n'est pas une regle
        // uniforme: un lecteur qui refait le calcul doit savoir qui en est
        // exempte, sinon il ne retrouve pas le chiffre.
        const reponseData = { disponible: true, produits: ['Agneau'] };
        const r = calculerProjection({
            sim: simDeBase(),
            pl: plDeBase({ commission_integree: reponseData }),
            commissionPct: 3
        });
        // Compare a un LITTERAL, pas a reponseData: le moteur recevant l'objet
        // lui-meme, toute cle qu'il y ajouterait (un index memoise, par
        // exemple) serait presente des deux cotes et l'assertion passerait sans
        // rien prouver. Ce champ part dans la reponse publique de l'API de
        // synthese, il ne doit porter que ce qu'on y a mis.
        expect(r.hypotheses.commission_integree).toEqual({
            disponible: true, produits: ['Agneau']
        });
    });
});
