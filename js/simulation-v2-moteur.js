/**
 * Moteur de calcul de Simulation 2.0 — PUR, sans DOM, sans reseau.
 *
 * SOURCE UNIQUE des formules. L'ecran (js/simulation-v2.js), le mode debug,
 * le detail d'une case de matrice et les tests Jest passent TOUS par ici:
 * aucune formule n'est ecrite deux fois, donc ce que l'ecran affiche est
 * exactement ce que les tests verifient.
 *
 * UMD minimal: window.Sim2Moteur au navigateur, module.exports sous Node.
 *
 * LE MODELE DE COUT, et son hypothese centrale.
 *
 * Les achats suivent les ventes, au taux de parage:
 *
 *     carcasse achetee = quantites vendues / (1 - parage)
 *
 * Vendre 1 kg de detail consomme 1/(1-p) kg de carcasse: le parage est une
 * perte de decoupe, pas une ecriture comptable. Ce modele a ete impose par
 * deux constats de l'utilisateur, tous deux justes:
 *
 *  - "-400 F sur le prix d'achat ne peut pas ne rapporter que 6 080 F":
 *    l'economie porte sur TOUTES les unites achetees, pas sur le seul stock.
 *  - "un taux de parage a 10 % doit avoir beaucoup de perte": passer de 5 a
 *    10 % de perte de decoupe rencherit chaque unite vendue de
 *    pa x (1/0,90 - 1/0,95), soit ~224 F/unite sur le boeuf - environ
 *    258 000 F sur juillet, pas 674 F.
 *
 * CONSEQUENCE ASSUMEE: la marge affichee ici est NETTE DE PARAGE
 * (prix moyen - prix carcasse / (1 - parage)), la ou la version actuelle et
 * le PL affichent la marge brute (prix moyen - prix carcasse). Sur le boeuf
 * de juillet: 691 F nets contre 893 F bruts. L'ecran le dit.
 *
 * Le PL de reference n'entre JAMAIS ici: ce moteur ne rend que des EFFETS,
 * a ajouter au PL que le serveur a calcule. Il ne peut donc pas devenir une
 * seconde source de verite sur le resultat.
 *
 * ENTREES
 *   donnees  = { produits: [{nom, quantite, ca, prix_moyen, prix_achat}...],
 *                contexte: { varBovin, varOvin, parageBase, boeuf:{matin,soir},
 *                            commission, commissionPct } }
 *   scenario = { leviers: { [nom]: {prix, unite, vol} },
 *                globaux: { charges, dep, com, parBov, parOvi, dPa } }
 */
(function (racine, fabrique) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = fabrique();
    else racine.Sim2Moteur = fabrique();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var nb = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
    // Meme normalisation que le serveur (lib/parage.js): accents et casse
    // ignores.
    var norm = function (s) {
        return String(s == null ? '' : s).normalize('NFD')
            .replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    };
    var fmt = function (v) {
        if (v === null || v === undefined || isNaN(v)) return '—';
        var s = Math.abs(Math.round(v)).toLocaleString('fr-FR');
        return (v < 0 ? '−' : '') + s;
    };

    /** Memes familles que le serveur: bovine par regex, ovine par prefixe. */
    function estBoeuf(p) { return /^(boeuf|veau)/.test(norm(p && p.nom)); }
    function estOvin(p) { return /^(agneau|mouton)/.test(norm(p && p.nom)); }

    function levierDe(scenario, nom) {
        var l = scenario && scenario.leviers && scenario.leviers[nom];
        return l || { prix: 0, unite: 'F', vol: 0 };
    }
    function globauxDe(scenario) { return (scenario && scenario.globaux) || {}; }

    /** Taux de parage du scenario pour un produit, en fraction restante. */
    function diviseurParage(p, scenario, contexte) {
        var g = globauxDe(scenario);
        var base = nb(contexte && contexte.parageBase);
        var taux = null;
        if (estBoeuf(p)) taux = g.parBov !== undefined ? nb(g.parBov) : base;
        else if (estOvin(p)) taux = g.parOvi !== undefined ? nb(g.parOvi) : base;
        else return 1; // volaille et epicerie: pas de levier de parage ici
        var d = 1 - taux / 100;
        return d > 0 ? d : null; // parage >= 100 %: rien n'est vendable
    }

    /**
     * Marge unitaire NETTE DE PARAGE, sous le scenario.
     *
     *     marge = prix moyen - (prix carcasse + dPa si bovin) / (1 - parage)
     *
     * Null si un terme est inconnu ou si le parage du scenario atteint 100 %:
     * jamais zero, qui serait un mensonge chiffre.
     */
    function margeAvec(p, scenario, contexte) {
        if (p.prix_moyen === null || p.prix_moyen === undefined) return null;
        if (p.prix_achat === null || p.prix_achat === undefined) return null;
        var d = diviseurParage(p, scenario, contexte);
        if (d === null) return null;
        var paEff = nb(p.prix_achat) + (estBoeuf(p) ? nb(globauxDe(scenario).dPa) : 0);
        return nb(p.prix_moyen) - paEff / d;
    }

    /**
     * Effet d'UN produit sous le scenario. Trois termes:
     *   prix   : x par unite sur les quantites VENDUES (1 F de CA = 1 F de
     *            resultat, coefficient MESURE cote serveur);
     *   volume : marge nette x unites ajoutees — vendre une unite de plus
     *            consomme 1/(1-parage) de carcasse, achetee au prix du
     *            scenario;
     *   croise : le prix supplementaire vaut aussi sur les unites ajoutees.
     */
    function effetProduit(p, scenario, contexte) {
        var e = levierDe(scenario, p.nom);
        var q = nb(p.quantite), ca = nb(p.ca);
        var xUnit = e.unite === '%' ? nb(p.prix_moyen) * nb(e.prix) / 100 : nb(e.prix);
        var dPrix = e.unite === '%' ? ca * nb(e.prix) / 100 : nb(e.prix) * q;
        var m = margeAvec(p, scenario, contexte);
        var dVol = (m === null) ? 0 : m * nb(e.vol);
        return dPrix + dVol + xUnit * nb(e.vol);
    }

    /**
     * Cout des ventes d'une famille: quantites vendues x prix carcasse
     * effectif / (1 - parage). C'est le canal DOMINANT des leviers parage et
     * prix d'achat — celui que les deux premieres versions oubliaient.
     */
    function coutFamille(qte, pa, taux) {
        var d = 1 - nb(taux) / 100;
        if (d <= 0 || pa === null) return null;
        return nb(qte) * nb(pa) / d;
    }

    /**
     * Effets des leviers GLOBAUX, avec leur decomposition.
     *
     * L'attribution aux lignes du panneau est exacte et sans double compte:
     *   parage boeuf  = [cout des ventes a (pa, parage') - a (pa, parage0)] + stock parage
     *   prix d'achat  = [cout des ventes a (pa+d, parage') - a (pa, parage')] + stock dPa
     *   parage agneau = idem ovin
     * La somme des trois vaut la variation totale du cout des ventes plus les
     * effets stock: rien n'est compte deux fois, rien n'est perdu.
     */
    function effetsGlobaux(donnees, scenario) {
        var c = donnees.contexte;
        var g = globauxDe(scenario);
        var p0 = nb(c.parageBase);
        var pB = g.parBov !== undefined ? nb(g.parBov) : p0;
        var pO = g.parOvi !== undefined ? nb(g.parOvi) : p0;
        var dPa = nb(g.dPa);

        var ch = -nb(g.charges);
        var dp = -nb(g.dep);
        var co = nb(c.commissionPct) > 0
            ? -(nb(c.commission) * (nb(g.com) / nb(c.commissionPct) - 1)) : 0;

        // Agregats par famille: quantites vendues et prix carcasse. Le prix
        // est celui des produits de la famille, qui partagent la carcasse par
        // construction (lib/prix-achat-date.js).
        var qB = 0, qO = 0, paB = null, paO = null;
        (donnees.produits || []).forEach(function (p) {
            if (estBoeuf(p)) {
                qB += nb(p.quantite);
                if (paB === null && p.prix_achat !== null && p.prix_achat !== undefined) paB = nb(p.prix_achat);
            } else if (estOvin(p)) {
                qO += nb(p.quantite);
                if (paO === null && p.prix_achat !== null && p.prix_achat !== undefined) paO = nb(p.prix_achat);
            }
        });

        // Cout des ventes bovines aux trois points qui separent les leviers.
        var cB00 = coutFamille(qB, paB, p0);          // reference
        var cB0p = coutFamille(qB, paB, pB);          // parage seul
        var cBdp = coutFamille(qB, paB === null ? null : paB + dPa, pB); // parage + dPa
        var cvParageB = (cB0p === null || cB00 === null) ? 0 : -(cB0p - cB00);
        var cvDPa = (cBdp === null || cB0p === null) ? 0 : -(cBdp - cB0p);

        var cO0 = coutFamille(qO, paO, p0);
        var cOp = coutFamille(qO, paO, pO);
        var cvParageO = (cOp === null || cO0 === null) ? 0 : -(cOp - cO0);

        // Effets STOCK, seconds par l'ampleur mais reels:
        //  - le taux de parage change la decote de la variation de stock de
        //    son espece (le PL fait coeff x variation boucherie);
        //  - le prix d'achat revalorise la carcasse aux deux bornes, seule la
        //    difference de quantite compte.
        var stB = -((pB - p0) / 100) * nb(c.varBovin);
        var stO = -((pO - p0) / 100) * nb(c.varOvin);
        var stPa = (1 - pB / 100) * dPa
            * (nb(c.boeuf && c.boeuf.soir) - nb(c.boeuf && c.boeuf.matin));

        // -0 est un zero: JavaScript les distingue (Object.is), et -(x - x)
        // rend -0. Un effet nul doit se comparer a 0, pas surprendre un test
        // ou un affichage.
        var z = function (v) { return v === 0 ? 0 : v; };
        var pab = z(cvParageB + stB);
        var pao = z(cvParageO + stO);
        var pb = z(cvDPa + stPa);

        return {
            ch: z(ch), dp: z(dp), co: z(co), pab: pab, pao: pao, pb: pb,
            total: z(ch + dp + co + pab + pao + pb),
            det: {
                qBovins: qB, qOvins: qO, paBovin: paB, paOvin: paO,
                cvParageB: z(cvParageB), cvParageO: z(cvParageO), cvDPa: z(cvDPa),
                stB: z(stB), stO: z(stO), stPa: z(stPa),
                parageBase: p0, parBov: pB, parOvi: pO, dPa: dPa
            }
        };
    }

    /** L'effet TOTAL du scenario, a ajouter au PL de reference. */
    function effetTotal(donnees, scenario) {
        var t = effetsGlobaux(donnees, scenario).total;
        (donnees.produits || []).forEach(function (p) {
            t += effetProduit(p, scenario, donnees.contexte);
        });
        return t;
    }

    /**
     * La DERIVATION du total, ligne par ligne, formules substituees.
     *
     * C'est ce que le mode debug imprime et ce qu'une case de matrice montre
     * au clic. Le controle de bouclage compare la somme de ces lignes a
     * effetTotal: si les deux divergent, une formule et son explication ont
     * ete modifiees l'une sans l'autre — le defaut precis que ce module
     * existe pour empecher.
     */
    function expliquer(donnees, scenario) {
        var c = donnees.contexte;
        var glob = effetsGlobaux(donnees, scenario);
        var d = glob.det;
        var g = globauxDe(scenario);
        var lignes = [];

        (donnees.produits || []).forEach(function (p) {
            var e = levierDe(scenario, p.nom);
            if (!nb(e.prix) && !nb(e.vol)) return;
            var q = nb(p.quantite), ca = nb(p.ca);
            var m = margeAvec(p, scenario, c);
            var xUnit = e.unite === '%' ? nb(p.prix_moyen) * nb(e.prix) / 100 : nb(e.prix);
            if (nb(e.prix)) {
                lignes.push({
                    libelle: p.nom + ' · prix',
                    formule: e.unite === '%'
                        ? e.prix + ' % × ' + fmt(ca) + ' de ventes'
                        : fmt(e.prix) + ' × ' + q + ' unités vendues',
                    valeur: e.unite === '%' ? ca * nb(e.prix) / 100 : nb(e.prix) * q
                });
            }
            if (nb(e.vol)) {
                lignes.push({
                    libelle: p.nom + ' · volume',
                    formule: 'marge nette ' + (m === null ? 'inconnue' : fmt(m)) + ' × ' + fmt(e.vol) + ' unités',
                    valeur: m === null ? 0 : m * nb(e.vol)
                });
                if (nb(e.prix)) {
                    lignes.push({
                        libelle: p.nom + ' · croisé',
                        formule: 'prix ' + fmt(xUnit) + ' × ' + fmt(e.vol) + ' unités ajoutées',
                        valeur: xUnit * nb(e.vol)
                    });
                }
            }
        });

        if (glob.ch) lignes.push({ libelle: 'Charges fixes', formule: '−' + fmt(nb(g.charges)), valeur: glob.ch });
        if (glob.dp) lignes.push({ libelle: 'Dépenses', formule: '−' + fmt(nb(g.dep)), valeur: glob.dp });
        if (glob.co) lignes.push({
            libelle: 'Commission',
            formule: '−' + fmt(nb(c.commission)) + ' × (' + g.com + '/' + c.commissionPct + ' − 1)',
            valeur: glob.co
        });
        if (d.cvParageB) lignes.push({
            libelle: 'Parage bœuf · coût des ventes',
            formule: '−' + fmt(d.qBovins) + ' u × ' + fmt(d.paBovin)
                + ' × (1/(1−' + d.parBov + '%) − 1/(1−' + d.parageBase + '%))',
            valeur: d.cvParageB
        });
        if (d.stB) lignes.push({
            libelle: 'Parage bœuf · stock',
            formule: '−(' + d.parBov + ' − ' + d.parageBase + ')/100 × ' + fmt(nb(c.varBovin)),
            valeur: d.stB
        });
        if (d.cvParageO) lignes.push({
            libelle: 'Parage agneau · coût des ventes',
            formule: '−' + fmt(d.qOvins) + ' u × ' + fmt(d.paOvin)
                + ' × (1/(1−' + d.parOvi + '%) − 1/(1−' + d.parageBase + '%))',
            valeur: d.cvParageO
        });
        if (d.stO) lignes.push({
            libelle: 'Parage agneau · stock',
            formule: '−(' + d.parOvi + ' − ' + d.parageBase + ')/100 × ' + fmt(nb(c.varOvin)),
            valeur: d.stO
        });
        if (d.cvDPa) lignes.push({
            libelle: 'Prix d\'achat bœuf · ventes',
            formule: '−(' + fmt(d.dPa) + ') × ' + fmt(d.qBovins) + ' u / (1−' + d.parBov + '%)',
            valeur: d.cvDPa
        });
        if (d.stPa) lignes.push({
            libelle: 'Prix d\'achat bœuf · stock',
            formule: '(1 − ' + d.parBov + '/100) × ' + fmt(d.dPa) + ' × ('
                + fmt(nb(c.boeuf && c.boeuf.soir)) + ' − ' + fmt(nb(c.boeuf && c.boeuf.matin)) + ')',
            valeur: d.stPa
        });

        var somme = 0;
        lignes.forEach(function (l) { somme += l.valeur; });
        var total = effetTotal(donnees, scenario);
        return {
            lignes: lignes,
            total: total,
            controle: { somme: somme, ecart: somme - total, ok: Math.abs(somme - total) < 0.01 }
        };
    }

    return {
        estBoeuf: estBoeuf,
        estOvin: estOvin,
        margeAvec: margeAvec,
        effetProduit: effetProduit,
        effetsGlobaux: effetsGlobaux,
        effetTotal: effetTotal,
        expliquer: expliquer
    };
}));
