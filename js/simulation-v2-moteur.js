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
 * LE MODELE DE COUT, et ses hypotheses. Chacune est ASSUMEE et affichee:
 *
 *  1. Les achats suivent les ventes, au taux de parage:
 *         carcasse achetee = quantites vendues / (1 - parage)
 *     Vendre 1 kg de detail consomme 1/(1-p) kg de carcasse. Impose par deux
 *     constats d'utilisateur, tous deux justes: -400 F de prix d'achat doit
 *     porter sur toutes les unites achetees (pas sur le seul stock), et un
 *     parage a 10 % doit couter cher (~258 000 F sur juillet, pas 674).
 *
 *  2. La COMMISSION SUIT LES ACHATS. Elle est assise sur les quantites
 *     livrees au prix catalogue fournisseur (3 % x prix catalogue x livre):
 *     un levier qui fait vendre ou parer plus fait livrer plus, donc
 *     commissionne plus. L'oublier surestimait le levier volume de ~20 %.
 *     SAUF sur les produits dont le prix d'achat porte DEJA la commission
 *     (reglage « commission integree », cf lib/commission-integree.js): elle
 *     est alors dans le cout, la refacturer la compterait deux fois.
 *
 *  3. Le changement de prix d'achat est un NIVEAU, pas un a-coup: il vaut
 *     pour tous les achats de la periode, y compris les unites qui ont
 *     construit le stock. L'effet stock net = achat du surplus a l'autre
 *     prix, moins sa revalorisation au coefficient de parage.
 *
 *  4. Les taux de parage simules sont PAR ESPECE (bovin, ovin). La volaille
 *     et le reste de la boucherie restent au taux actuel.
 *
 * CONSEQUENCE ASSUMEE: la marge affichee est NETTE DE PARAGE
 * (prix moyen - prix carcasse / (1 - parage)), la ou la version actuelle et
 * le PL affichent la marge brute. Sur le boeuf de juillet: 691 F nets contre
 * 893 F bruts. L'ecran le dit.
 *
 * Le PL de reference n'entre JAMAIS ici: ce moteur ne rend que des EFFETS,
 * a ajouter au PL que le serveur a calcule. Il ne peut donc pas devenir une
 * seconde source de verite sur le resultat.
 *
 * ENTREES
 *   donnees  = { produits: [{nom, quantite, ca, prix_moyen, prix_achat}...],
 *                contexte: { varBovin, varOvin, parageBase, boeuf:{matin,soir},
 *                            commission, commissionPct,
 *                            pv: {bovin, ovin, volaille, par_produit},
 *                            commissionIntegree: {disponible, produits} } }
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
    // Les marques combinantes sont ecrites en ECHAPPEMENTS unicode, pas en
    // caracteres litteraux: litterales, elles sont invisibles a la relecture
    // et une passe d'encodage ou de minification les abime en silence.
    var norm = function (s) {
        return String(s == null ? '' : s).normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    };
    var fmt = function (v) {
        if (v === null || v === undefined || isNaN(v)) return '—';
        var s = Math.abs(Math.round(v)).toLocaleString('fr-FR');
        return (v < 0 ? '−' : '') + s;
    };

    /**
     * Familles par PREFIXE, pour deux usages qui restent des questions
     * d'ESPECE: quel taux de parage appliquer, et a quels produits le levier
     * « prix d'achat boeuf » du scenario s'applique.
     *
     * ATTENTION - ce n'est PLUS la regle du serveur. Le cout d'un produit s'y
     * resout par le Mapping produits (lib/prix-achat-date.js); la regex
     * /^(boeuf|veau)/ n'y decide plus rien. Consequence connue: « Jarret »,
     * mappe vers Boeuf x 0,5, voit son cout suivre la carcasse dans le PL mais
     * PAS bouger sous le levier de prix d'achat de cette page - son nom ne
     * commence pas par « boeuf ». La sensibilite affichee sous-estime donc
     * l'exposition des decoupes mappees dont le libelle ne porte pas l'espece.
     */
    function estBoeuf(p) { return /^(boeuf|veau)/.test(norm(p && p.nom)); }
    function estOvin(p) { return /^(agneau|mouton)/.test(norm(p && p.nom)); }
    // La volaille se NOMME, elle n'est plus le fourre-tout de « ni bovin ni
    // ovin ». Ce sous-entendu faisait commissionner le Laxass, vendu 200 F,
    // sur les 3 500 F de la carcasse de poulet.
    function estVolaille(p) { return /^(poulet|volaille|poule|dinde)/.test(norm(p && p.nom)); }

    // Les ENTREES DE CATALOGUE qui portent le prix des carcasses. Le repli par
    // espece de l'assiette pointe vers elles (pv.bovin est le prix de la ligne
    // « Boeuf »), et c'est sur ces memes lignes que l'administrateur coche
    // « commission integree ». Les nommer une fois evite que le prix vienne
    // d'une ligne et la reponse d'une autre.
    var CLE_BOVIN = 'boeuf', CLE_OVIN = 'agneau', CLE_VOLAILLE = 'poulet';

    /**
     * L'ASSIETTE de la commission MaaS pour un produit: le prix de vente
     * catalogue retenu, ET l'entree de catalogue d'ou il sort.
     *
     * Les deux sont rendus ENSEMBLE parce qu'une seule ligne de catalogue
     * repond aux deux questions posees ici: quel prix sert d'assiette, et ce
     * prix porte-t-il deja la commission. Les resoudre separement laisserait
     * le montant venir d'une ligne et la reponse d'une autre - l'ecart qui
     * fait facturer deux fois, ou pas du tout.
     *
     * Son propre prix d'abord, la carcasse de son espece ensuite, rien du tout
     * en dernier. L'ancienne regle disait « bovin, sinon ovin, sinon VOLAILLE »
     * - un `else` qui rangeait d'office dans le poulet tout ce qu'il ne
     * reconnaissait pas: le Laxass, vendu 200 F, se voyait commissionne sur
     * les 3 500 F de la carcasse de poulet, 105 F l'unite, et ressortait a
     * -62 F de marge nette quand il en gagne 43. Un produit declare a perte,
     * c'est un produit qu'on arrete.
     *
     * Les noms de decoupe (« Boeuf en detail ») n'ont pas de ligne au
     * catalogue: c'est la carcasse qui porte le prix, d'ou le repli par espece.
     */
    function assietteCommission(p, contexte) {
        var pv = (contexte || {}).pv || {};
        var cle = norm(p && p.nom);
        var propre = (pv.par_produit || {})[cle];
        if (nb(propre) > 0) return { prix: nb(propre), cle: cle };
        if (estBoeuf(p)) return { prix: pv.bovin, cle: CLE_BOVIN };
        if (estOvin(p)) return { prix: pv.ovin, cle: CLE_OVIN };
        if (estVolaille(p)) return { prix: pv.volaille, cle: CLE_VOLAILLE };
        return { prix: null, cle: null };
    }

    /**
     * Le prix d'achat de cette entree de catalogue porte-t-il DEJA la
     * commission MaaS ? Si oui, rien n'est a refacturer sur ses livraisons.
     *
     * La reponse arrive tout resolue du SERVEUR, dans
     * contexte.commissionIntegree = { disponible, produits: [noms] }. C'est
     * DATA qui en decide, produit par produit (`commissionAppliquee`), et ce
     * module n'a ni base ni acces reseau pour le redemander. Il ne pourrait de
     * toute facon pas trancher le cas du bœuf: son prix ne vient de DATA -
     * commission comprise - que les journees ou DATA en publie un; les autres
     * retombent sur le catalogue, qui ne la porte pas.
     *
     * DEFAUT PRUDENT quand le contexte ne porte rien (payload d'une version
     * anterieure, snapshot en cache) ou quand DATA n'a pas repondu
     * (`disponible` faux): AUCUN produit n'est integre, donc la commission
     * continue d'etre deduite exactement comme avant - et c'est bien ce que le
     * serveur a facture dans ce cas-la. Se tromper en deduisant une commission
     * qui n'est plus facturee sous-estime la marge et fait viser un peu haut;
     * se tromper dans l'autre sens la surestime et fait recommander de vendre
     * MOINS que necessaire - une erreur qu'on ne voit qu'a la cloture.
     */
    // Index normalise des produits integres, memoise HORS de l'objet recu.
    // Ecrire le cache sur cet objet le ferait ressortir dans la reponse de
    // l'API de synthese, qui republie contexte.commissionIntegree tel quel
    // (lib/synthese-projection.js): un champ interne deviendrait alors une
    // donnee du contrat public. Une WeakMap n'empeche pas le contexte d'etre
    // collecte quand la simulation est terminee.
    var _indexIntegres = typeof WeakMap === 'function' ? new WeakMap() : null;

    function commissionIntegree(cle, contexte) {
        var ci = (contexte || {}).commissionIntegree;
        if (!ci || !ci.disponible || !ci.produits || !ci.produits.length) return false;
        if (!cle) return false;
        // La question est posee par produit ET par scenario: renormaliser toute
        // la liste a chaque appel se paie sur des simulations a plusieurs
        // dizaines de produits.
        var index = _indexIntegres && _indexIntegres.get(ci);
        if (!index) {
            index = {};
            for (var i = 0; i < ci.produits.length; i++) {
                index[norm(ci.produits[i])] = true;
            }
            if (_indexIntegres) _indexIntegres.set(ci, index);
        }
        return index[norm(cle)] === true;
    }

    function levierDe(scenario, nom) {
        var l = scenario && scenario.leviers && scenario.leviers[nom];
        return l || { prix: 0, unite: 'F', vol: 0 };
    }
    function globauxDe(scenario) { return (scenario && scenario.globaux) || {}; }

    /** Taux de parage du scenario pour un produit, en fraction restante. */
    function diviseurParage(p, scenario, contexte) {
        var g = globauxDe(scenario);
        var c = contexte || {};
        var base = nb(c.parageBase);
        // Le taux par ESPECE quand le contexte le porte - c'est le parage
        // MESURE du mois, arrete a la veille. parageBase (le parametre fixe a
        // 5 %) ne sert plus que de repli, quand aucune journee du mois n'est
        // mesurable pour cette espece. Bovin et ovin ne se parent pas au meme
        // taux: leur imposer un diviseur commun etait deja faux avant qu'il
        // soit mesure.
        var bov = c.parageBovin !== undefined && c.parageBovin !== null ? nb(c.parageBovin) : base;
        var ovi = c.parageOvin !== undefined && c.parageOvin !== null ? nb(c.parageOvin) : base;
        var taux = null;
        if (estBoeuf(p)) taux = g.parBov !== undefined ? nb(g.parBov) : bov;
        else if (estOvin(p)) taux = g.parOvi !== undefined ? nb(g.parOvi) : ovi;
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
     * La marge d'une unite vendue EN PLUS, nette de parage ET de la commission
     * que sa livraison declenche.
     *
     *     commission par unite = taux x prix catalogue / (1 - parage espece)
     *
     * Vendre une unite de plus fait livrer 1/(1-parage) unite de carcasse,
     * commissionnee au prix catalogue fournisseur (hypothese 2). Le plan
     * d'equilibre chiffrait son apport a la marge nette de parage SEULE: les
     * deux moities du meme ecran se contredisaient, le plan promettant de
     * combler 2 500 000 F la ou le moteur n'en rendait que 2 100 000.
     *
     * SANS SCENARIO, et c'est voulu: recommandations, plan d'equilibre et
     * volumes projetes decrivent la realite du moment, pas l'hypothese en
     * cours de test dans le panneau des leviers.
     *
     * RIEN N'EST DEDUIT quand le prix d'achat porte deja la commission
     * (« commission integree »): elle est alors DANS prix_achat, que la marge
     * vient de soustraire. La retirer une seconde fois ferait diverger cette
     * marge de la commission que le serveur facture reellement - deux verites
     * sur le meme mois, ce que cette page existe pour eviter.
     *
     * Prix catalogue inconnu: marge brute de commission plutot qu'un cout
     * invente - meme regle que la commission induite, qui laisse la part non
     * chiffree et la nomme.
     */
    function margeApresCommission(p, contexte) {
        var m = margeAvec(p, { leviers: {}, globaux: {} }, contexte);
        if (m === null) return null;
        var c = contexte || {};
        var taux = nb(c.commissionPct) / 100;
        if (!taux) return m;
        var a = assietteCommission(p, c);
        if (!a.prix) return m;
        if (commissionIntegree(a.cle, c)) return m;
        // LE diviseur de parage de la marge, pas une seconde lecture des
        // memes champs: les appelants le derivaient a part
        // (`estBoeuf ? parageBovin : ...`), ce qui donnait un diviseur de 1 la
        // ou la marge, elle, retombait sur parageBase - deux taux de parage
        // dans le meme chiffre. Le cas ne se produit que sur un contexte sans
        // taux par espece, mais c'est exactement le contexte degrade sur
        // lequel personne ne regarde.
        var d = diviseurParage(p, { leviers: {}, globaux: {} }, c);
        if (!(d > 0)) return m;
        return m - taux * nb(a.prix) / d;
    }

    /**
     * Effet d'UN produit sous le scenario. Trois termes:
     *   prix   : x par unite sur les quantites VENDUES (1 F de CA = 1 F de
     *            resultat, coefficient MESURE cote serveur);
     *   volume : marge nette x unites ajoutees (la commission sur la carcasse
     *            livree pour ces unites est portee par effetsGlobaux);
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
     * Effets des leviers GLOBAUX, avec leur decomposition.
     *
     * L'attribution est exacte et sans double compte:
     *   parage boeuf  = cout des ventes a (pa, parage') - a (pa, parage0),
     *                   plus la decote du stock de l'espece;
     *   prix d'achat  = dPa applique a la carcasse des ventes au parage du
     *                   scenario (dPa x q/(1-p'), qui n'exige PAS de connaitre
     *                   le prix de base - un prix inconnu n'inverse plus le
     *                   signe du levier), plus le stock net (hypothese 3);
     *   commission    = changement de taux sur le montant reel, plus la
     *                   commission sur les achats INDUITS par les leviers
     *                   volume et parage (hypothese 2).
     * La somme vaut la variation totale: rien n'est compte deux fois (teste).
     */
    function effetsGlobaux(donnees, scenario) {
        var c = donnees.contexte;
        var g = globauxDe(scenario);
        // REFERENCE PAR ESPECE. Le taux de reference est celui a partir
        // duquel l'effet d'un levier de parage se mesure: sans cette
        // separation, passer le diviseur de la marge au parage MESURE tout en
        // gardant 5 % comme reference aurait affiche un effet de parage non
        // nul sur un scenario pourtant vide - le meme fantome que la
        // commission a deja produit ici.
        var p0 = nb(c.parageBase);
        var p0B = (c.parageBovin === undefined || c.parageBovin === null) ? p0 : nb(c.parageBovin);
        var p0O = (c.parageOvin === undefined || c.parageOvin === null) ? p0 : nb(c.parageOvin);
        var pB = g.parBov !== undefined ? nb(g.parBov) : p0B;
        var pO = g.parOvi !== undefined ? nb(g.parOvi) : p0O;
        // MEME repli que le parage, et pour la meme raison: un scenario qui
        // omet `com` decrit un taux INCHANGE, pas un taux nul. Sans ce repli,
        // nb(undefined) valait 0 et coTaux rendait -(commission x (0/3 - 1))
        // = +commission, soit un gain fantome egal a TOUTE la commission
        // (+194 139 F sur juillet) sur un scenario pourtant vide. Le controle
        // de bouclage ne l'attrapait pas: expliquer() portait le meme fantome.
        var com = g.com !== undefined ? nb(g.com) : nb(c.commissionPct);
        var dPa = nb(g.dPa);
        // Un diviseur de reference PAR ESPECE: bovin et ovin ne se parent pas
        // au meme taux, et la mesure le montre crument.
        var d0B = 1 - p0B / 100;
        var d0O = 1 - p0O / 100;
        var dB = 1 - pB / 100;
        var dO = 1 - pO / 100;

        var ch = -nb(g.charges);
        var dp = -nb(g.dep);
        var coTaux = nb(c.commissionPct) > 0
            ? -(nb(c.commission) * (com / nb(c.commissionPct) - 1)) : 0;

        // Agregats par famille: quantites vendues, volumes ajoutes par les
        // leviers, et prix carcasse (partage par construction,
        // lib/prix-achat-date.js).
        var qB = 0, qO = 0, paB = null, paO = null;
        var volB = 0, volO = 0, volV = 0;
        (donnees.produits || []).forEach(function (p) {
            var vol = nb(levierDe(scenario, p.nom).vol);
            // Un levier volume sur un produit a marge inconnue est INERTE
            // (effetProduit rend 0, l'ecran le dit): sa livraison ne doit pas
            // etre commissionnee non plus, sinon on facture le cout d'une
            // vente dont on refuse de chiffrer le produit.
            if (vol && margeAvec(p, scenario, c) === null) vol = 0;
            if (estBoeuf(p)) {
                qB += nb(p.quantite);
                volB += vol;
                if (paB === null && p.prix_achat !== null && p.prix_achat !== undefined) paB = nb(p.prix_achat);
            } else if (estOvin(p)) {
                qO += nb(p.quantite);
                volO += vol;
                if (paO === null && p.prix_achat !== null && p.prix_achat !== undefined) paO = nb(p.prix_achat);
            } else {
                volV += vol;
            }
        });

        // PARAGE, canal cout des ventes: la carcasse necessaire aux memes
        // ventes change avec le taux. Exige le prix carcasse; s'il est
        // inconnu, la part reste non chiffree (0) et expliquer le dit.
        var cvParageB = (paB !== null && dB > 0 && d0B > 0)
            ? -(qB * paB / dB - qB * paB / d0B) : 0;
        var cvParageO = (paO !== null && dO > 0 && d0O > 0)
            ? -(qO * paO / dO - qO * paO / d0O) : 0;

        // PRIX D'ACHAT, canal ventes: dPa sur chaque unite de carcasse des
        // ventes, au parage du scenario. NE depend PAS du prix de base:
        // (pa+d)/x - pa/x = d/x. C'est ce qui corrige l'inversion de signe
        // quand le prix bovin etait inconnu (le levier tombait a l'effet
        // stock seul, -6 080 au lieu de +485 495).
        var cvDPa = dB > 0 ? -(dPa * qB / dB) : 0;

        // STOCK. Decote de la variation d'espece par le taux simule; et pour
        // dPa, effet NET de la constitution du stock (hypothese 3): le
        // surplus (soir - matin) est achete au nouveau prix ET revalorise au
        // coefficient - net = -dPa x surplus x parage.
        var dQ = nb(c.boeuf && c.boeuf.soir) - nb(c.boeuf && c.boeuf.matin);
        var stB = -((pB - p0B) / 100) * nb(c.varBovin);
        var stO = -((pO - p0O) / 100) * nb(c.varOvin);
        var stPa = -(dPa * dQ * (pB / 100));

        // COMMISSION INDUITE (hypothese 2): les leviers volume et parage font
        // livrer de la carcasse en plus, commissionnee au prix CATALOGUE
        // fournisseur (l'assiette reelle de la commission MaaS), au taux du
        // scenario.
        var pv = c.pv || {};
        var addB = (dB > 0 && d0B > 0) ? (volB / dB + qB * (1 / dB - 1 / d0B)) : 0;
        var addO = (dO > 0 && d0O > 0) ? (volO / dO + qO * (1 / dO - 1 / d0O)) : 0;
        var addV = volV;
        var pvManquants = [];
        // Les familles dont la livraison induite ne porte AUCUNE commission a
        // refacturer, parce que leur prix d'achat la contient deja. A tenir
        // separe de pvManquants: ce n'est pas une part qu'on renonce a
        // chiffrer, c'est zero, et les deux ne se lisent pas pareil.
        var famillesIntegrees = [];
        var assiette = 0;
        // Une seule regle pour les trois familles: chacune est commissionnee
        // au prix de SA ligne de catalogue, et c'est cette meme ligne qui
        // porte la case « commission integree ». Les traiter separement avait
        // deja laisse diverger deux des trois branches.
        var cumuler = function (add, prix, cleCatalogue, famille) {
            if (!add) return;
            if (commissionIntegree(cleCatalogue, c)) { famillesIntegrees.push(famille); return; }
            if (prix) assiette += nb(prix) * add;
            else pvManquants.push(famille);
        };
        cumuler(addB, pv.bovin, CLE_BOVIN, 'bovin');
        cumuler(addO, pv.ovin, CLE_OVIN, 'ovin');
        cumuler(addV, pv.volaille, CLE_VOLAILLE, 'volaille');
        var coInduite = -(com / 100) * assiette;

        // -0 est un zero: JavaScript les distingue (Object.is), et -(x - x)
        // rend -0. Un effet nul doit se comparer a 0, pas surprendre un test
        // ou un affichage.
        var z = function (v) { return v === 0 ? 0 : v; };
        var co = z(coTaux + coInduite);
        var pab = z(cvParageB + stB);
        var pao = z(cvParageO + stO);
        var pb = z(cvDPa + stPa);

        return {
            ch: z(ch), dp: z(dp), co: co, pab: pab, pao: pao, pb: pb,
            total: z(ch + dp + co + pab + pao + pb),
            det: {
                qBovins: qB, qOvins: qO, paBovin: paB, paOvin: paO,
                cvParageB: z(cvParageB), cvParageO: z(cvParageO), cvDPa: z(cvDPa),
                stB: z(stB), stO: z(stO), stPa: z(stPa), dQ: dQ,
                coTaux: z(coTaux), coInduite: z(coInduite),
                addB: z(addB), addO: z(addO), addV: z(addV),
                assiette: z(assiette), pvManquants: pvManquants,
                famillesIntegrees: famillesIntegrees,
                // Le taux NORMALISE, pas g.com brut: expliquer() l'imprimait
                // tel quel et affichait « undefined » quand le scenario
                // l'omettait.
                com: com,
                parageBase: p0, parageRefB: p0B, parageRefO: p0O,
                parBov: pB, parOvi: pO, dPa: dPa
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
        if (d.coTaux) lignes.push({
            libelle: 'Commission · taux',
            formule: '−' + fmt(nb(c.commission)) + ' × (' + d.com + '/' + c.commissionPct + ' − 1)',
            valeur: d.coTaux
        });
        if (d.coInduite) lignes.push({
            libelle: 'Commission · achats induits',
            formule: '−' + d.com + ' % × ' + fmt(d.assiette)
                + ' F de livraisons supplémentaires (au prix catalogue)',
            valeur: d.coInduite
        });
        // Sans !d.coInduite: les deux etats ne s'excluent PAS. Une espece au
        // prix catalogue connu et une autre sans, avec un levier sur les deux,
        // donnait une commission induite non nulle ET une part manquante - et
        // seule la premiere s'affichait. La formule laissait alors croire que
        // l'assiette couvrait toutes les livraisons induites, alors qu'il en
        // manquait jusqu'a 23 % sur le cas mesure.
        if (d.pvManquants.length) lignes.push({
            libelle: 'Commission · achats induits (part non chiffrée)',
            formule: 'prix catalogue inconnu (' + d.pvManquants.join(', ') + ') : part non chiffrée',
            valeur: 0
        });
        // Zero DIT, pas zero tu. Une famille dont le prix d'achat porte deja
        // la commission ne contribue pas a l'assiette, exactement comme une
        // famille sans prix catalogue - mais pour une raison opposee. Laisser
        // les deux silencieuses les rendait indiscernables a l'ecran.
        if (d.famillesIntegrees.length) lignes.push({
            libelle: 'Commission · achats induits (déjà dans le prix d\'achat)',
            formule: d.famillesIntegrees.join(', ') + ' : la commission est comprise '
                + 'dans le prix d\'achat — rien à refacturer sur ces livraisons',
            valeur: 0
        });

        // Les formules du parage sont ecrites avec leurs ETAPES, pas en
        // notation compacte: "1/(1-p)" a du etre explique a l'utilisateur.
        // La carcasse necessaire aux deux taux dit la meme chose et se
        // comprend seule: le parage est une perte sur ce qu'on ACHETE, donc
        // vendre autant exige d'acheter plus.
        var carc = function (qte, taux) { return nb(qte) / (1 - nb(taux) / 100); };
        if (d.cvParageB) lignes.push({
            libelle: 'Parage bœuf · coût des ventes',
            formule: 'carcasse pour ' + fmt(d.qBovins) + ' u vendues : '
                + fmt(carc(d.qBovins, d.parageRefB)) + ' u à ' + d.parageRefB + ' % → '
                + fmt(carc(d.qBovins, d.parBov)) + ' u à ' + d.parBov + ' %, soit '
                + fmt(carc(d.qBovins, d.parBov) - carc(d.qBovins, d.parageRefB))
                + ' u × ' + fmt(d.paBovin) + ' F',
            valeur: d.cvParageB
        });
        if (d.stB) lignes.push({
            libelle: 'Parage bœuf · stock',
            formule: '−(' + d.parBov + ' − ' + d.parageRefB + ')/100 × ' + fmt(nb(c.varBovin)),
            valeur: d.stB
        });
        if (d.cvParageO) lignes.push({
            libelle: 'Parage agneau · coût des ventes',
            formule: 'carcasse pour ' + fmt(d.qOvins) + ' u vendues : '
                + fmt(carc(d.qOvins, d.parageRefO)) + ' u à ' + d.parageRefO + ' % → '
                + fmt(carc(d.qOvins, d.parOvi)) + ' u à ' + d.parOvi + ' %, soit '
                + fmt(carc(d.qOvins, d.parOvi) - carc(d.qOvins, d.parageRefO))
                + ' u × ' + fmt(d.paOvin) + ' F',
            valeur: d.cvParageO
        });
        if (d.stO) lignes.push({
            libelle: 'Parage agneau · stock',
            formule: '−(' + d.parOvi + ' − ' + d.parageRefO + ')/100 × ' + fmt(nb(c.varOvin)),
            valeur: d.stO
        });
        if (d.cvDPa) lignes.push({
            libelle: 'Prix d\'achat bœuf · ventes',
            formule: fmt(d.dPa) + ' F sur chacune des ' + fmt(carc(d.qBovins, d.parBov))
                + ' u de carcasse (' + fmt(d.qBovins) + ' u vendues à '
                + d.parBov + ' % de parage)',
            valeur: d.cvDPa
        });
        if (d.stPa) lignes.push({
            libelle: 'Prix d\'achat bœuf · stock',
            formule: 'surplus de stock ' + (d.dQ > 0 ? '+' : '') + fmt(d.dQ)
                + ' u : acheté à ' + fmt(d.dPa) + ' F près, revalorisé à '
                + (100 - d.parBov) + ' % — net ' + d.parBov + ' % de l\'écart',
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
        estVolaille: estVolaille,
        normaliserNom: norm,
        // Expose pour que l'ecran affiche le cout REELLEMENT soustrait
        // (prix carcasse / (1 - parage)) a cote du prix carcasse, avec le
        // MEME diviseur que la marge - le recalculer la-bas en ferait une
        // seconde definition.
        diviseurParage: diviseurParage,
        margeAvec: margeAvec,
        // L'assiette de la commission ET la marge qui la deduit vivent ICI, et
        // plus dans chaque appelant: l'ecran et l'API externe en portaient deux
        // copies mot pour mot, qu'une correction pouvait desynchroniser en
        // silence - le defaut precis que ce module existe pour empecher.
        assietteCommission: assietteCommission,
        commissionIntegree: commissionIntegree,
        margeApresCommission: margeApresCommission,
        effetProduit: effetProduit,
        effetsGlobaux: effetsGlobaux,
        effetTotal: effetTotal,
        expliquer: expliquer
    };
}));
