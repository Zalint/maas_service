/**
 * D'ou vient l'ecart de PL entre deux journees.
 *
 * Les valeurs attendues sont recalculees par des expressions independantes,
 * jamais en appelant le module: un test qui compare le module a lui-meme ne
 * teste rien.
 *
 * @jest-environment node
 */

const { ecartJour, partagerEcartStock, POSTES } = require('../lib/pl-ecart-jour');

/**
 * Un payload de PL minimal mais COMPLET au sens de la formule: tous les
 * postes y sont, donc le bouclage est verifiable. `pl` est calcule par la
 * formule ecrite a la main ici - pas par le module.
 */
function payload(o) {
    const p = Object.assign({
        total_ventes: 0, total_avances: 0, commission_maas: 0, marge_cdc: 0,
        depenses_periode: 0, paiements_fournisseur: 0,
        charges: { total_prorata: 0 },
        stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
            soir_date: null, soir_detail: [] },
        periode: { dateDebut: '2026-08-01', dateFin: '2026-08-15' }
    }, o);
    p.pl = p.total_ventes - p.total_avances - p.commission_maas + p.marge_cdc
        - p.charges.total_prorata - p.depenses_periode - p.paiements_fournisseur
        + p.stock.variation_nette;
    return p;
}

describe('le bouclage: la somme des contributions EST l ecart de PL', () => {
    test('une journee ordinaire boucle au centime', () => {
        const veille = payload({
            total_ventes: 2600000, total_avances: 2500000, commission_maas: 78000,
            charges: { total_prorata: 150000 }, depenses_periode: 30000,
            paiements_fournisseur: 90000,
            stock: { variation_nette: 300000, coeff: 0.95, soir_estime: false, soir_detail: [] }
        });
        const jour = payload({
            total_ventes: 2853150, total_avances: 2837803, commission_maas: 91999,
            charges: { total_prorata: 169355 }, depenses_periode: 30000,
            paiements_fournisseur: 97000,
            stock: { variation_nette: 377517, coeff: 0.95, soir_estime: false, soir_detail: [] }
        });
        const r = ecartJour({ veille, jour });
        expect(r.ok).toBe(true);
        expect(r.bouclage.coherent).toBe(true);
        expect(r.bouclage.residu).toBeCloseTo(0, 2);
        // L'ecart de PL, recalcule a la main depuis les deux formules.
        const attendu = jour.pl - veille.pl;
        expect(r.pl.ecart).toBeCloseTo(attendu, 2);
        expect(r.bouclage.somme_contributions).toBeCloseTo(attendu, 2);
    });

    test('un poste ABSENT de la table casse le bouclage, et on le dit', () => {
        // Le scenario qu'on veut attraper: la formule du PL gagne un poste et
        // ce module l'ignore. On le simule en gonflant `pl` sans toucher aux
        // postes - exactement l'effet qu'aurait un poste inconnu.
        const veille = payload({ total_ventes: 1000 });
        const jour = payload({ total_ventes: 2000 });
        jour.pl += 50000;                       // un poste que POSTES ne lit pas
        const r = ecartJour({ veille, jour });
        expect(r.bouclage.coherent).toBe(false);
        expect(r.bouclage.residu).toBeCloseTo(50000, 2);
        // Le tableau reste rendu: il n'est pas faux, il est INCOMPLET, et le
        // residu chiffre exactement ce qui manque.
        expect(r.postes.find((p) => p.cle === 'ventes').contribution).toBeCloseTo(1000, 2);
    });

    test('les signes: une depense qui monte FAIT BAISSER le PL', () => {
        const veille = payload({ depenses_periode: 10000 });
        const jour = payload({ depenses_periode: 40000 });
        const r = ecartJour({ veille, jour });
        const dep = r.postes.find((p) => p.cle === 'depenses');
        expect(dep.variation).toBeCloseTo(30000, 2);     // la depense a monte
        expect(dep.contribution).toBeCloseTo(-30000, 2); // le PL a baisse
        expect(r.pl.ecart).toBeCloseTo(-30000, 2);
    });

    test('les postes sont classes par POIDS, pas par ordre de formule', () => {
        const veille = payload({ total_ventes: 1000, depenses_periode: 0 });
        const jour = payload({ total_ventes: 1100, depenses_periode: 50000 });
        const r = ecartJour({ veille, jour });
        // La depense (-50 000) pese plus que les ventes (+100).
        expect(r.postes[0].cle).toBe('depenses');
        expect(r.postes[1].cle).toBe('ventes');
    });

    test('les huit postes de la formule sont couverts', () => {
        // Si la formule du PL gagne un poste, ce test ne le voit pas - c'est
        // le bouclage qui l'attrape. Celui-ci verrouille l'inverse: qu'aucun
        // poste ne DISPARAISSE de la table par accident.
        expect(POSTES.map((p) => p.cle).sort()).toEqual([
            'avances', 'charges', 'commission', 'depenses', 'marge_cdc',
            'paiements', 'stock', 'ventes'
        ]);
    });
});

describe('le partage volume / revalorisation', () => {
    const ligne = (produit, quantite, prix) => ({
        produit, quantite, prix_utilise: prix, valeur: quantite * prix, base: 'achat'
    });

    test('a prix constant, tout est du VOLUME', () => {
        const r = partagerEcartStock(
            [ligne('Boeuf', 100, 4000)], [ligne('Boeuf', 120, 4000)]);
        expect(r.volume).toBeCloseTo(20 * 4000, 2);
        expect(r.revalorisation).toBeCloseTo(0, 2);
        expect(r.part_revalorisation).toBeCloseTo(0, 6);
    });

    test('a quantite constante, tout est de la REVALORISATION', () => {
        // Le cas qui a motive le module: la carcasse passe de 3 835 a 4 500 F
        // sans qu'un kilo n'ait bouge. Un tableau de postes appelle ca une
        // variation de stock, et l'on croit avoir achete.
        const r = partagerEcartStock(
            [ligne('Boeuf', 100, 3835)], [ligne('Boeuf', 100, 4500)]);
        expect(r.volume).toBeCloseTo(0, 2);
        expect(r.revalorisation).toBeCloseTo(100 * 665, 2);
        expect(r.part_revalorisation).toBeCloseTo(1, 6);
    });

    test('les deux termes se somment EXACTEMENT a l ecart de valeur', () => {
        // La propriete qui fait tout tenir: aucun residu, aucune part "autre".
        const av = [ligne('Boeuf', 100, 3835), ligne('Agneau', 20, 4500)];
        const ap = [ligne('Boeuf', 130, 4500), ligne('Agneau', 12, 4200)];
        const r = partagerEcartStock(av, ap);
        const valeurAv = 100 * 3835 + 20 * 4500;
        const valeurAp = 130 * 4500 + 12 * 4200;
        expect(r.volume + r.revalorisation).toBeCloseTo(valeurAp - valeurAv, 2);
        expect(r.total).toBeCloseTo(valeurAp - valeurAv, 2);
    });

    test('un produit APPARU est du volume pur, pas de la revalorisation', () => {
        // Sans prix de reference, sa valeur entiere serait tombee dans la
        // revalorisation - un produit neuf presente comme une hausse de prix.
        const r = partagerEcartStock([], [ligne('Foie', 10, 4000)]);
        expect(r.volume).toBeCloseTo(40000, 2);
        expect(r.revalorisation).toBeCloseTo(0, 2);
    });

    test('un produit DISPARU est du volume negatif', () => {
        const r = partagerEcartStock([ligne('Foie', 10, 4000)], []);
        expect(r.volume).toBeCloseTo(-40000, 2);
        expect(r.revalorisation).toBeCloseTo(0, 2);
    });

    test('deux effets massifs qui se COMPENSENT ne s annoncent pas comme nuls', () => {
        // Volume +100 000 et revalorisation -100 000: le total est nul, mais
        // dire "0 % de revalorisation" masquerait deux mouvements majeurs.
        const r = partagerEcartStock(
            [ligne('Boeuf', 100, 5000)], [ligne('Boeuf', 125, 4000)]);
        expect(r.volume).toBeCloseTo(125000, 2);
        expect(r.revalorisation).toBeCloseTo(-125000, 2);
        expect(r.total).toBeCloseTo(0, 2);
        expect(r.part_revalorisation).toBeCloseTo(0.5, 6);
    });

    test('les lignes sont classees par ecart absolu decroissant', () => {
        const r = partagerEcartStock(
            [ligne('Petit', 1, 100), ligne('Gros', 10, 4000)],
            [ligne('Petit', 2, 100), ligne('Gros', 30, 4000)]);
        expect(r.lignes[0].produit).toBe('Gros');
    });
});

describe('les pieges: ce qu on refuse de calculer', () => {
    test('sans snapshot de la veille, on ne compare pas a l avant-veille', () => {
        const r = ecartJour({ veille: null, jour: payload({}) });
        expect(r.ok).toBe(false);
        expect(r.raison).toBe('snapshot_veille_manquant');
    });

    test('sans snapshot du jour, rien', () => {
        expect(ecartJour({ veille: payload({}), jour: null }).raison)
            .toBe('snapshot_jour_manquant');
    });

    test('deux cumuls de mois DIFFERENTS ne se soustraient pas', () => {
        // Le 1er du mois: la veille appartient au mois precedent. Soustraire
        // donnerait le PL du mois entier presente comme une journee.
        const veille = payload({ periode: { dateDebut: '2026-07-01', dateFin: '2026-07-31' } });
        const jour = payload({ periode: { dateDebut: '2026-08-01', dateFin: '2026-08-01' } });
        const r = ecartJour({ veille, jour });
        expect(r.ok).toBe(false);
        expect(r.raison).toBe('periodes_differentes');
    });
});

describe('les drapeaux: ce qui rend l ecart autre chose qu une journee', () => {
    const avec = (sV, sJ) => ecartJour({
        veille: payload({ stock: Object.assign({ variation_nette: 0, coeff: 0.95,
            soir_estime: false, soir_detail: [] }, sV) }),
        jour: payload({ stock: Object.assign({ variation_nette: 0, coeff: 0.95,
            soir_estime: false, soir_detail: [] }, sJ) })
    }).drapeaux.map((d) => d.cle);

    test('un jour estime compare a un jour compte est signale', () => {
        expect(avec({ soir_estime: true }, { soir_estime: false }))
            .toContain('estimation_corrigee');
        expect(avec({ soir_estime: false }, { soir_estime: true }))
            .toContain('estimation_en_cours');
        expect(avec({ soir_estime: true }, { soir_estime: true }))
            .toContain('estimation_deux_jours');
    });

    test('deux jours comptes ne levent aucun drapeau d estimation', () => {
        expect(avec({}, {}).filter((c) => c.startsWith('estimation'))).toHaveLength(0);
    });

    test('un coefficient qui bouge deplace le PL sans marchandise', () => {
        expect(avec({ coeff: 0.95 }, { coeff: 0.92 })).toContain('coefficient_change');
        expect(avec({ coeff: 0.95 }, { coeff: 0.95 })).not.toContain('coefficient_change');
    });

    test('le MEME stock du soir des deux cotes interdit d attribuer un mouvement', () => {
        expect(avec({ soir_date: '14-08-2026' }, { soir_date: '14-08-2026' }))
            .toContain('soir_identique');
        expect(avec({ soir_date: '14-08-2026' }, { soir_date: '15-08-2026' }))
            .not.toContain('soir_identique');
    });

    test('une revalorisation dominante est signalee, une marginale non', () => {
        const l = (q, p) => ({ produit: 'Boeuf', quantite: q, prix_utilise: p, valeur: q * p });
        const forte = ecartJour({
            veille: payload({ stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                soir_detail: [l(100, 3835)] } }),
            jour: payload({ stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                soir_detail: [l(100, 4500)] } })
        });
        expect(forte.drapeaux.map((d) => d.cle)).toContain('revalorisation');
        // Un prix qui bouge de 1 F sur un gros mouvement de volume: du bruit.
        const faible = ecartJour({
            veille: payload({ stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                soir_detail: [l(100, 4000)] } }),
            jour: payload({ stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                soir_detail: [l(200, 4001)] } })
        });
        expect(faible.drapeaux.map((d) => d.cle)).not.toContain('revalorisation');
    });

    test('des avances non fiables rendent leur poste inexploitable', () => {
        const r = ecartJour({
            veille: payload({ sources: { avances: { fiable: false } } }),
            jour: payload({})
        });
        expect(r.drapeaux.map((d) => d.cle)).toContain('avances_non_fiables');
    });
});

describe('les bornes du stock: rendre la ligne auditable', () => {
    const avecStock = (sV, sJ) => ecartJour({
        veille: payload({ stock: Object.assign({ matin_debut: 330580, matin_date: '01-08-2026',
            soir_fin: 0, coeff: 0.95, soir_estime: false, soir_detail: [] }, sV) }),
        jour: payload({ stock: Object.assign({ matin_debut: 330580, matin_date: '01-08-2026',
            soir_fin: 0, coeff: 0.95, soir_estime: false, soir_detail: [] }, sJ) })
    });

    test('les bornes rendent les valeurs, et la variation DU SERVEUR', () => {
        // Ce test affirmait `variation = (fin - depart) x coeff` et passait -
        // parce que le module appliquait la meme regle fausse. Code et test
        // partageaient la premisse; seules les donnees reelles l'ont montree.
        // Le coefficient ne porte que sur la boucherie (voir plus bas).
        const r = avecStock(
            { soir_fin: 316387, variation_nette: -13483.35 },
            { soir_fin: 586090, variation_nette: 242734.5 });
        const b = r.stock.bornes;
        expect(b.depart).toBeCloseTo(330580, 2);
        expect(b.fin_veille).toBeCloseTo(316387, 2);
        expect(b.fin_jour).toBeCloseTo(586090, 2);
        // La variation est LUE, pas reconstruite.
        expect(b.variation_veille).toBeCloseTo(-13483.35, 2);
        expect(b.variation_jour).toBeCloseTo(242734.5, 2);
    });

    test('le depart est COMMUN aux deux cumuls, et son changement est signale', () => {
        // Les deux cumuls partent du 1er: ils partagent leur stock du matin.
        // Qu'il differe veut dire qu'on a corrige le comptage du 1er APRES
        // avoir fige la veille - l'ecart contient cette correction.
        const sain = avecStock({ soir_fin: 100 }, { soir_fin: 200 });
        expect(sain.drapeaux.map((d) => d.cle)).not.toContain('base_matin_changee');

        const corrige = avecStock({ soir_fin: 100 }, { soir_fin: 200, matin_debut: 400000 });
        expect(corrige.drapeaux.map((d) => d.cle)).toContain('base_matin_changee');
    });

    test('les dates des bornes sont rendues, pour situer les photos', () => {
        const r = avecStock(
            { soir_fin: 100, soir_date: '13-08-2026' },
            { soir_fin: 200, soir_date: '14-08-2026' });
        expect(r.stock.bornes.depart_date).toBe('01-08-2026');
        expect(r.stock.bornes.fin_veille_date).toBe('13-08-2026');
        expect(r.stock.bornes.fin_jour_date).toBe('14-08-2026');
    });
});

describe('ce qu il y a derriere chaque poste', () => {
    const vol = (produits) => ({ produits });
    const p = (cle, quantite, ca) => ({ cle, graphies: [cle], quantite, ca });

    test('les ventes se ventilent par produit, en kilos et en francs', () => {
        const r = ecartJour({
            veille: payload({ volumes: vol([p('Boeuf en détail', 300, 1500000)]) }),
            jour: payload({ volumes: vol([p('Boeuf en détail', 336, 1759800)]) })
        });
        const l = r.detail.ventes.lignes[0];
        expect(l.produit).toBe('Boeuf en détail');
        expect(l.quantite).toBeCloseTo(36, 2);
        expect(l.ca).toBeCloseTo(259800, 2);
        // Le prix moyen DU JOUR, pas celui du cumul: 259 800 / 36.
        expect(l.prix_moyen).toBeCloseTo(259800 / 36, 2);
    });

    test('un produit dont le cumul n a pas bouge n a rien vendu', () => {
        const r = ecartJour({
            veille: payload({ volumes: vol([p('Foie', 10, 40000), p('Boeuf', 300, 1500000)]) }),
            jour: payload({ volumes: vol([p('Foie', 10, 40000), p('Boeuf', 336, 1759800)]) })
        });
        expect(r.detail.ventes.lignes.map((x) => x.produit)).toEqual(['Boeuf']);
    });

    test('les depenses listees doivent SOMMER au poste, sinon on le dit', () => {
        const veille = payload({ depenses_periode: 10000 });
        const jour = payload({ depenses_periode: 40000 });
        // Le poste a bouge de 30 000; on ne fournit qu'une ligne de 20 000.
        const partiel = ecartJour({ veille, jour,
            depenses: [{ date: '2026-08-15', montant: 20000, categorie: 'Réparation' }] });
        expect(partiel.detail.depenses.total).toBeCloseTo(20000, 2);
        expect(partiel.detail.depenses.attendu).toBeCloseTo(30000, 2);
        expect(partiel.detail.depenses.complet).toBe(false);

        const complet = ecartJour({ veille, jour,
            depenses: [{ date: '2026-08-15', montant: 20000, categorie: 'Réparation' },
                { date: '2026-08-15', montant: 10000, categorie: 'Carburant' }] });
        expect(complet.detail.depenses.complet).toBe(true);
        expect(complet.detail.depenses.lignes[0].libelle).toBe('Réparation');
    });

    test('les paiements fournisseur suivent la meme verification', () => {
        const r = ecartJour({
            veille: payload({ paiements_fournisseur: 0 }),
            jour: payload({ paiements_fournisseur: 97000 }),
            paiements: [{ date: '2026-08-14', montant: 97000, libelle: 'virement · réf. X12' }]
        });
        expect(r.detail.paiements.complet).toBe(true);
        expect(r.detail.paiements.lignes[0].libelle).toBe('virement · réf. X12');
    });

    test('les charges se ventilent par ligne, en PRORATA', () => {
        const ch = (prorata) => ({ total_prorata: prorata.reduce((s, x) => s + x.prorata, 0),
            detail: prorata });
        const r = ecartJour({
            veille: payload({ charges: ch([{ nom: 'loyer', libelle: 'Loyer', prorata: 48000 },
                { nom: 'sal', libelle: 'Masse salariale', prorata: 96774 }]) }),
            jour: payload({ charges: ch([{ nom: 'loyer', libelle: 'Loyer', prorata: 52000 },
                { nom: 'sal', libelle: 'Masse salariale', prorata: 104838 }]) })
        });
        const l = r.detail.charges.lignes;
        expect(l.map((x) => x.libelle)).toEqual(['Masse salariale', 'Loyer']); // par poids
        expect(l[1].montant).toBeCloseTo(4000, 2);
        expect(r.detail.charges.total).toBeCloseTo(4000 + 8064, 2);
    });

    test('les avances se declarent NON ventilables, avec la raison', () => {
        const r = ecartJour({ veille: payload({}), jour: payload({}) });
        expect(r.detail.avances.ventilable).toBe(false);
        expect(r.detail.avances.raison).toMatch(/MataBanq/);
    });
});

describe('un cumul ABSENT n est pas un cumul nul', () => {
    // Le piege attrape sur donnees reelles: `volumes` est un champ recent, et
    // les snapshots figes avant son ajout ne le portent pas. Le traiter comme
    // un zero presentait le cumul du MOIS comme la vente d'une journee -
    // 336 kg de boeuf en un jour.
    const avecVol = { produits: [{ cle: 'boeuf', graphies: ['Boeuf'], quantite: 336, ca: 1759800 }] };

    test('volumes absent de la VEILLE: on refuse de ventiler', () => {
        const r = ecartJour({
            veille: payload({}),                       // pas de volumes
            jour: payload({ volumes: avecVol })
        });
        expect(r.detail.ventes.ventilable).toBe(false);
        expect(r.detail.ventes.lignes).toHaveLength(0);
        expect(r.detail.ventes.raison).toMatch(/veille/);
    });

    test('volumes absent du JOUR: meme refus, raison differente', () => {
        const r = ecartJour({
            veille: payload({ volumes: avecVol }), jour: payload({})
        });
        expect(r.detail.ventes.ventilable).toBe(false);
        expect(r.detail.ventes.raison).toMatch(/du jour/);
    });

    test('volumes des DEUX cotes: la ventilation reprend', () => {
        const r = ecartJour({
            veille: payload({ volumes: { produits: [{ cle: 'boeuf', graphies: ['Boeuf'],
                quantite: 300, ca: 1500000 }] } }),
            jour: payload({ volumes: avecVol })
        });
        expect(r.detail.ventes.ventilable).toBe(true);
        expect(r.detail.ventes.lignes[0].quantite).toBeCloseTo(36, 2);
    });

    test('charges sans detail: meme refus', () => {
        const r = ecartJour({
            veille: payload({ charges: { total_prorata: 100 } }),
            jour: payload({ charges: { total_prorata: 200, detail: [] } })
        });
        expect(r.detail.charges.ventilable).toBe(false);
    });
});

describe('la ventilation des ventes SOMME au poste', () => {
    test('un total qui ne retombe pas sur le poste est signale', () => {
        // Le cas: une graphie de produit change entre les deux photos, la
        // ligne se dedouble, et la somme s'ecarte du poste. Verifie sur
        // donnees reelles que les deux valent 247 050 F au 14-08.
        const bon = ecartJour({
            veille: payload({ total_ventes: 2606100,
                volumes: { produits: [{ cle: 'b', graphies: ['Boeuf'], quantite: 300, ca: 2606100 }] } }),
            jour: payload({ total_ventes: 2853150,
                volumes: { produits: [{ cle: 'b', graphies: ['Boeuf'], quantite: 336, ca: 2853150 }] } })
        });
        expect(bon.detail.ventes.total_ca).toBeCloseTo(247050, 2);
        expect(bon.detail.ventes.attendu).toBeCloseTo(247050, 2);
        expect(bon.detail.ventes.complet).toBe(true);

        const casse = ecartJour({
            veille: payload({ total_ventes: 2606100,
                volumes: { produits: [{ cle: 'b', graphies: ['Boeuf'], quantite: 300, ca: 2606100 }] } }),
            // Le poste dit +247 050, la ventilation n'en montre que 100 000.
            jour: payload({ total_ventes: 2853150,
                volumes: { produits: [{ cle: 'b', graphies: ['Boeuf'], quantite: 336, ca: 2706100 }] } })
        });
        expect(casse.detail.ventes.complet).toBe(false);
        expect(casse.detail.ventes.ecart).toBeCloseTo(100000 - 247050, 2);
    });
});

describe('le rapprochement argent / marchandise', () => {
    const l = (produit, quantite, prix, base) => ({
        produit, quantite, prix_utilise: prix, valeur: quantite * prix, base: base || 'achat'
    });

    test('sorties - entree en stock = ce que la journee a consomme', () => {
        // Le cas reel du 14-08: 496 969 F sortis, 285 519 devenus du stock,
        // donc 211 450 qui ont remplace ce qui s est vendu.
        const r = ecartJour({
            veille: payload({ total_avances: 2340834,
                stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                    soir_detail: [l('Boeuf', 100, 4000)] } }),
            jour: payload({ total_avances: 2837803,
                stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                    soir_detail: [l('Boeuf', 150, 4000)] } })
        });
        const rc = r.reconciliation;
        expect(rc.avances).toBeCloseTo(2837803 - 2340834, 2);
        expect(rc.entree_stock).toBeCloseTo(50 * 4000, 2);
        expect(rc.consomme).toBeCloseTo((2837803 - 2340834) - 200000, 2);
        expect(rc.exact).toBe(true);
    });

    test('les versements fournisseur entrent dans les sorties', () => {
        const r = ecartJour({
            veille: payload({ paiements_fournisseur: 0 }),
            jour: payload({ total_avances: 100000, paiements_fournisseur: 97000 })
        });
        expect(r.reconciliation.paiements).toBeCloseTo(97000, 2);
        expect(r.reconciliation.sorties).toBeCloseTo(197000, 2);
    });

    test('les DEPENSES restent hors du rapprochement', () => {
        // Une reparation ne devient pas du stock: la meler ferait porter a la
        // marchandise un decaissement qui ne l achete pas.
        const r = ecartJour({
            veille: payload({}), jour: payload({ total_avances: 100000, depenses_periode: 30000 })
        });
        expect(r.reconciliation.sorties).toBeCloseTo(100000, 2);
        expect(r.reconciliation.depenses_hors_marchandise).toBeCloseTo(30000, 2);
    });

    test('faute de cout d achat on prend le prix de VENTE, et on le signale', () => {
        const r = ecartJour({
            veille: payload({ stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                soir_detail: [l('Boeuf', 100, 4000, 'achat'), l('Déchet', 2, 1000, 'vente')] } }),
            jour: payload({ stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                soir_detail: [l('Boeuf', 100, 4000, 'achat'), l('Déchet', 1, 400, 'vente')] } })
        });
        // La ligne au prix de vente est COMPTEE - l ecarter ferait croire a de
        // la marchandise disparue - mais son montant est isole.
        expect(r.reconciliation.stock_jour).toBeCloseTo(100 * 4000 + 400, 2);
        expect(r.reconciliation.dont_prix_vente_jour).toBeCloseTo(400, 2);
        expect(r.reconciliation.exact).toBe(false);
        const dechet = r.stock.lignes.find((x) => x.produit === 'Déchet');
        expect(dechet.base_jour).toBe('vente');
        expect(dechet.valeur_veille).toBeCloseTo(2000, 2);
        expect(dechet.valeur_jour).toBeCloseTo(400, 2);
    });

    test('chaque ligne porte sa valeur aux DEUX bornes', () => {
        const r = ecartJour({
            veille: payload({ stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                soir_detail: [l('Boeuf', 57.3, 4520)] } }),
            jour: payload({ stock: { variation_nette: 0, coeff: 0.95, soir_estime: false,
                soir_detail: [l('Boeuf', 108.3, 4500)] } })
        });
        const b = r.stock.lignes[0];
        expect(b.valeur_veille).toBeCloseTo(57.3 * 4520, 2);
        expect(b.valeur_jour).toBeCloseTo(108.3 * 4500, 2);
        // Et le total des deux effets refait bien l ecart de valeur.
        expect(b.effet_volume + b.effet_prix).toBeCloseTo(b.valeur_jour - b.valeur_veille, 2);
    });
});

describe('une veille non figee se RECALCULE au lieu de valoir zero', () => {
    test('le recalcul est signale, et l ecart reste calcule', () => {
        // Sans snapshot, prendre 0 pour la veille aurait fait passer TOUT le
        // cumul du mois pour la journee. On recalcule, et on le dit.
        const r = ecartJour({
            veille: payload({ total_ventes: 2600000 }),
            jour: payload({ total_ventes: 2853150 }),
            veilleRecalculee: true
        });
        expect(r.ok).toBe(true);
        expect(r.veille_recalculee).toBe(true);
        expect(r.drapeaux.map((d) => d.cle)).toContain("recalcule");
        // L'ecart lui-meme reste juste: seule sa PROVENANCE change.
        expect(r.pl.ecart).toBeCloseTo(253150, 2);
    });

    test('une veille FIGEE ne porte pas ce drapeau', () => {
        const r = ecartJour({ veille: payload({}), jour: payload({}) });
        expect(r.veille_recalculee).toBe(false);
        expect(r.drapeaux.map((d) => d.cle)).not.toContain("recalcule");
    });

    test('si meme le recalcul manque, on refuse toujours', () => {
        const r = ecartJour({ veille: null, jour: payload({}) });
        expect(r.ok).toBe(false);
        expect(r.raison).toBe('snapshot_veille_manquant');
        expect(r.message).toMatch(/recalcul/);
    });
});

describe('recalcul: les DEUX cotes, pas seulement la veille', () => {
    // Le cas le plus frequent n'est pas la veille manquante mais la JOURNEE
    // EN COURS: rien n'est fige avant le cron de 23h35, et sans recalcul du
    // jour le panneau restait muet precisement quand on s'en sert.
    test('la journee du jour recalculee est signalee', () => {
        const r = ecartJour({
            veille: payload({}), jour: payload({ total_ventes: 1000 }),
            jourRecalcule: true
        });
        expect(r.jour_recalcule).toBe(true);
        expect(r.veille_recalculee).toBe(false);
        const f = r.drapeaux.find((d) => d.cle === 'recalcule');
        expect(f.texte).toMatch(/la journée/);
        expect(f.texte).not.toMatch(/la veille/);
    });

    test('les deux recalcules: le drapeau les nomme tous les deux', () => {
        const r = ecartJour({
            veille: payload({}), jour: payload({}),
            veilleRecalculee: true, jourRecalcule: true
        });
        const f = r.drapeaux.find((d) => d.cle === 'recalcule');
        expect(f.texte).toMatch(/la veille et de la journée/);
    });

    test('rien de recalcule: aucun drapeau', () => {
        const r = ecartJour({ veille: payload({}), jour: payload({}) });
        expect(r.drapeaux.map((d) => d.cle)).not.toContain('recalcule');
    });
});

describe('mode force: recalculer PAR-DESSUS un PL fige', () => {
    // L interet du mode: un snapshot peut etre perime - vente saisie en
    // retard, stock corrige. Recalculer sans le dire effacerait la
    // difference; on la chiffre.
    test('l ecart entre le fige et le recalcule est signale', () => {
        const r = ecartJour({
            veille: payload({}), jour: payload({ total_ventes: 100000 }),
            jourRecalcule: true,
            plFige: { jour: 60000, veille: 0 }
        });
        const f = r.drapeaux.find((x) => x.cle === 'fige_perime_jour');
        expect(f).toBeDefined();
        expect(f.texte).toMatch(/60 000/);     // ce que le fige disait
        expect(f.texte).toMatch(/100 000/);    // ce que le recalcul donne
        expect(f.texte).toMatch(/40 000/);     // ce qui est entre depuis
        expect(f.niveau).toBe('fort');
    });

    test('un fige IDENTIQUE au recalcul ne leve rien', () => {
        const r = ecartJour({
            veille: payload({}), jour: payload({ total_ventes: 100000 }),
            jourRecalcule: true, plFige: { jour: 100000, veille: 0 }
        });
        expect(r.drapeaux.map((x) => x.cle)).not.toContain('fige_perime_jour');
    });

    test('sans recalcul, aucune comparaison au fige', () => {
        // En mode « figes seulement », il n y a rien a comparer: le chiffre
        // affiche EST le fige.
        const r = ecartJour({
            veille: payload({}), jour: payload({ total_ventes: 100000 }),
            plFige: { jour: 60000, veille: 0 }
        });
        expect(r.drapeaux.map((x) => x.cle)).not.toContain('fige_perime_jour');
    });

    test('la veille aussi est comparee a son fige', () => {
        const r = ecartJour({
            veille: payload({ total_ventes: 50000 }), jour: payload({}),
            veilleRecalculee: true, plFige: { jour: null, veille: 20000 }
        });
        expect(r.drapeaux.map((x) => x.cle)).toContain('fige_perime_veille');
    });
});

describe('la couche route, extraite pour etre testable', () => {
    const { resoudreMode, fenetreEntrees } = require('../lib/pl-ecart-jour');

    test('les trois modes, et le defaut', () => {
        expect(resoudreMode({ mode: 'force' })).toBe('force');
        expect(resoudreMode({ mode: 'FIGE' })).toBe('fige');   // insensible a la casse
        expect(resoudreMode({})).toBe('auto');
        expect(resoudreMode({ mode: 'nawak' })).toBe('auto');  // valeur inconnue
        expect(resoudreMode(null)).toBe('auto');
    });

    test('l ancien parametre recalculer=0/1 reste honore', () => {
        // Un lien copie ou un onglet laisse ouvert peut encore le porter: le
        // laisser tomber sur le defaut aurait change son sens en silence.
        expect(resoudreMode({ recalculer: '0' })).toBe('fige');
        expect(resoudreMode({ recalculer: '1' })).toBe('auto');
        // `mode` prime sur l ancien parametre quand les deux sont la.
        expect(resoudreMode({ mode: 'force', recalculer: '0' })).toBe('force');
    });

    test('la fenetre commence au LENDEMAIN de la veille', () => {
        // Une depense datee de la veille est deja dans SON cumul: la compter
        // ici la ferait apparaitre deux fois.
        expect(fenetreEntrees('2026-08-13', '2026-08-14'))
            .toEqual({ debut: '2026-08-14', fin: '2026-08-14' });
    });

    test('sur plusieurs jours, la fenetre les couvre tous sauf la veille', () => {
        expect(fenetreEntrees('2026-08-11', '2026-08-14'))
            .toEqual({ debut: '2026-08-12', fin: '2026-08-14' });
    });

    test('le passage de mois est correct', () => {
        expect(fenetreEntrees('2026-07-31', '2026-08-01'))
            .toEqual({ debut: '2026-08-01', fin: '2026-08-01' });
        // Annee bissextile: le 29 fevrier existe en 2028.
        expect(fenetreEntrees('2028-02-28', '2028-02-29').debut).toBe('2028-02-29');
    });
});

describe('marge de la journee: MATA facture au COUT, donc elle doit etre positive', () => {
    // Regle posee par le proprietaire du produit. MATA facture au prix
    // d'ACHAT, donc une journee normale verifie
    //     ventes + variation de stock > avances + paiements
    // Sinon il est sorti du frigo plus de valeur que la caisse n'en a
    // encaisse. Constate le 24/08/2026 a Keur Massar: -52 369 de marge,
    // cause par 40 kg de poisson livres et factures 96 000 F mais absents du
    // stock du soir. Une fois saisis, la marge est repassee a +43 631.
    const jour = (v) => ({
        pl: v.pl === undefined ? 0 : v.pl,
        total_ventes: v.ventes, total_avances: v.avances,
        paiements_fournisseur: v.paiements === undefined ? 0 : v.paiements,
        commission_maas: 0, marge_cdc: 0, charges_proratisees: 0,
        depenses_periode: 0,
        stock: { variation_nette: v.stock, matin_debut: 0, soir_fin: 0, coeff: 0.95 }
    });

    test('une journee saine ne leve AUCUN drapeau de marge', () => {
        const r = ecartJour({
            veille: jour({ ventes: 3203350, avances: 2913247, stock: 42045 }),
            jour: jour({ ventes: 3545800, avances: 3378013, stock: 207992 })
        });
        expect(r.marge_jour.marge).toBeCloseTo(342450 + 165947 - 464766, 2);
        expect(r.marge_jour.marge).toBeGreaterThan(0);
        expect((r.drapeaux || []).some((d) => d.cle === 'marge_negative')).toBe(false);
    });

    test('la journee du 24/08 AVANT correction leve le drapeau', () => {
        // Le stock du soir ne portait pas les 96 000 F de poisson.
        const r = ecartJour({
            veille: jour({ ventes: 3203350, avances: 2913247, stock: 42045 }),
            jour: jour({ ventes: 3545800, avances: 3378013, stock: 111992 })
        });
        expect(r.marge_jour.marge).toBeCloseTo(342450 + 69947 - 464766, 2);
        expect(r.marge_jour.marge).toBeLessThan(0);
        const d = (r.drapeaux || []).find((x) => x.cle === 'marge_negative');
        expect(d).toBeDefined();
        expect(d.niveau).toBe('fort');
        expect(d.texte).toMatch(/MARGE NÉGATIVE/);
    });

    test('les paiements fournisseur entrent dans la regle', () => {
        // Une journee juste a l'equilibre sur les avances bascule des qu'un
        // versement fournisseur s'y ajoute.
        const sans = ecartJour({
            veille: jour({ ventes: 0, avances: 0, stock: 0 }),
            jour: jour({ ventes: 100000, avances: 90000, stock: 0 })
        });
        expect(sans.marge_jour.marge).toBeCloseTo(10000, 2);
        expect((sans.drapeaux || []).some((d) => d.cle === 'marge_negative')).toBe(false);

        const avec = ecartJour({
            veille: jour({ ventes: 0, avances: 0, stock: 0, paiements: 0 }),
            jour: jour({ ventes: 100000, avances: 90000, stock: 0, paiements: 25000 })
        });
        expect(avec.marge_jour.marge).toBeCloseTo(-15000, 2);
        expect((avec.drapeaux || []).some((d) => d.cle === 'marge_negative')).toBe(true);
    });

    test('le taux n est pas calcule sans vente, il vaut null', () => {
        const r = ecartJour({
            veille: jour({ ventes: 0, avances: 0, stock: 0 }),
            jour: jour({ ventes: 0, avances: 50000, stock: 0 })
        });
        expect(r.marge_jour.taux_pct).toBeNull();
        // Mais la marge, elle, existe et le drapeau se leve.
        expect(r.marge_jour.marge).toBeCloseTo(-50000, 2);
        expect((r.drapeaux || []).some((d) => d.cle === 'marge_negative')).toBe(true);
    });

    test('la marge se lit sur la JOURNEE, pas sur le cumul', () => {
        // Les deux journees partent du meme 1er du mois: seule leur difference
        // est l'activite du jour. Un cumul deja negatif ne doit pas lever le
        // drapeau si la journee, elle, est saine.
        const r = ecartJour({
            veille: jour({ ventes: 1000000, avances: 1200000, stock: 0 }),
            jour: jour({ ventes: 1100000, avances: 1250000, stock: 0 })
        });
        expect(r.marge_jour.marge).toBeCloseTo(100000 - 50000, 2);
        expect((r.drapeaux || []).some((d) => d.cle === 'marge_negative')).toBe(false);
    });

    test('marge nulle exactement: pas de drapeau, ce n est pas une anomalie', () => {
        const r = ecartJour({
            veille: jour({ ventes: 0, avances: 0, stock: 0 }),
            jour: jour({ ventes: 100000, avances: 100000, stock: 0 })
        });
        expect(r.marge_jour.marge).toBeCloseTo(0, 6);
        expect((r.drapeaux || []).some((d) => d.cle === 'marge_negative')).toBe(false);
    });
});

describe('la variation nette n est PAS (fin - depart) x coeff', () => {
    // Ma premiere ecriture appliquait le coefficient a TOUT. Le coefficient de
    // pertes de decoupe ne porte que sur la boucherie: l epicerie ne se pare
    // pas. Sur le 15-08 reel, l ecart entre les deux formules valait 1 200 F -
    // assez peu pour passer inapercu, assez pour qu un lecteur qui refait le
    // calcul ne retombe jamais sur ses pieds.
    const jour = (o) => payload({ stock: Object.assign({
        matin_debut: 325080, soir_fin: 426033, coeff: 0.95,
        variation_boucherie: 76953, variation_hors_boucherie: 24000,
        variation_nette: 76953 * 0.95 + 24000,
        soir_estime: false, soir_detail: []
    }, o) });

    test('les bornes rendent la variation du SERVEUR, pas une reconstruction', () => {
        const r = ecartJour({ veille: jour({}), jour: jour({}) });
        const b = r.stock.bornes;
        // La vraie valeur, celle du payload.
        expect(b.variation_veille).toBeCloseTo(97105.35, 2);
        // Et surtout PAS la formule approchee, qui donnerait 95 905,35.
        expect(b.variation_veille).not.toBeCloseTo((426033 - 325080) * 0.95, 2);
        expect(b.boucherie_veille).toBeCloseTo(76953, 2);
        expect(b.hors_boucherie_veille).toBeCloseTo(24000, 2);
    });

    test('le pont chiffre les trois termes qui separent le tableau du poste', () => {
        // Le cas reel qui a souleve la question: -71 684 au tableau produit
        // contre -39 994 au poste. Le depart avait bouge de -30 690.
        const r = ecartJour({
            veille: jour({}),
            jour: jour({ matin_debut: 294390, soir_fin: 354349,
                variation_boucherie: 34695, variation_hors_boucherie: 24000,
                variation_nette: 34695 * 0.95 + 24000 })
        });
        const p = r.stock.bornes.pont;
        expect(p.ecart_soir).toBeCloseTo(354349 - 426033, 2);      // -71 684
        expect(p.ecart_depart).toBeCloseTo(294390 - 325080, 2);    // -30 690
        // Le poste, lui, vient des variations nettes reelles.
        expect(p.ecart_poste).toBeCloseTo((34695 * 0.95 + 24000) - (76953 * 0.95 + 24000), 2);
        // Et les trois ne sont PAS egaux: c est tout l objet du pont.
        expect(p.ecart_soir).not.toBeCloseTo(p.ecart_poste, 2);
    });
});

/**
 * UNE AVANCE NON SAISIE se reconnait a une signature precise: le stock MONTE
 * alors qu'aucune avance n'est enregistree. MATA facturant au prix d'achat,
 * une livraison laisse toujours une avance derriere elle.
 *
 * Sans ce drapeau, la journee du 25/08/2026 a Mbao affichait +185 847 F de
 * marge, soit 148,68 % des ventes - un taux qui n'existe pas sur de la
 * marchandise, et qui ne disait rien d'autre que la facture manquante.
 */
describe('drapeau: avance non saisie', () => {
    // total_avances, pas avances.total: c'est le champ que POSTES lit
    // (cf lire: (p) => nb(p.total_avances)). Se tromper de champ ferait
    // passer le test « une avance eteint le drapeau » pour la mauvaise
    // raison - l'avance ne serait jamais lue.
    const jour = (ventes, stock, avances) => ({
        pl: 1, total_ventes: ventes, stock: { variation_nette: stock },
        total_avances: avances, charges: {}, volumes: {}
    });
    const flag = (v, j) => (ecartJour({ veille: v, jour: j, depenses: [], paiements: [] })
        .drapeaux || []).find((x) => x.cle === 'avance_absente');

    test('le cas reel du 25/08: stock en hausse, zero avance', () => {
        const d = flag(jour(4558650, 132050, 0), jour(4683650, 192897, 0));
        expect(d).toBeDefined();
        expect(d.niveau).toBe('fort');
        expect(d.texte).toContain('60 847');
        // Le taux garde ses deux decimales: arrondi a 149 il ferait douter.
        expect(d.texte).toContain('148.68 %');
    });

    test('une avance saisie eteint le drapeau', () => {
        expect(flag(jour(4558650, 132050, 0), jour(4683650, 192897, 60000))).toBeUndefined();
    });

    test('un stock qui BAISSE sans avance est normal', () => {
        // Journee sans livraison: on vend le stock, rien n'entre, rien n'est
        // facture. Lever un drapeau la crierait au loup tous les jours.
        expect(flag(jour(4558650, 200000, 0), jour(4683650, 150000, 0))).toBeUndefined();
    });

    test('sans vente, pas de drapeau', () => {
        expect(flag(jour(100000, 0, 0), jour(100000, 50000, 0))).toBeUndefined();
    });
});
