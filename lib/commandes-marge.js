/**
 * LES COMMANDES D'UNE JOURNEE, classees par marge.
 *
 * Le panneau de l'ecart disait quels POSTES ont bouge et quels PRODUITS se
 * sont vendus, jamais QUI a achete. Or c'est la question qui se pose quand une
 * journee surprend: quelle commande a porte la marge, laquelle l'a mangee. Un
 * Jarret vendu 500 F pour 2 250 F de cout disparait dans un total de ventes,
 * il saute aux yeux dans une ligne de commande a marge negative.
 *
 * Module PUR: aucune requete, aucune date, aucun HTTP. Il recoit les lignes de
 * vente deja lues et deux fonctions de resolution (cout, boucherie), et rend
 * l'agregat. La route ne fait que charger et brancher - meme partage que
 * lib/pl-ecart-jour.js et js/simulation-v2-projection.js.
 */

function nb(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

function round2(v) {
    return Math.round(nb(v) * 100) / 100;
}

/**
 * @param {object} args
 * @param {Array}  args.lignes       lignes de vente brutes (produit, nombre,
 *                                   montant, prix_unit, commande_id, nom_client)
 * @param {(produit: string) => number} args.prixAchatDe  cout unitaire, ou une
 *                                   valeur non finie / <= 0 si inconnu
 * @param {(produit: string) => boolean} args.estBoucherie
 * @param {number} args.paragePct    parage du PARAMETRE, en points (5 = 5 %)
 */
function agregerCommandes(args) {
    const lignes = (args && args.lignes) || [];
    const prixAchatDe = (args && args.prixAchatDe) || (() => NaN);
    const estBoucherie = (args && args.estBoucherie) || (() => false);
    // Un parage hors de [0, 100[ rendrait un diviseur nul ou negatif, donc une
    // marge infinie ou inversee. 5 % est la valeur par defaut du parametre.
    const brut = parseFloat(args && args.paragePct);
    const paragePct = Number.isFinite(brut) && brut >= 0 && brut < 100 ? brut : 5;
    const div = 1 - (paragePct / 100);

    const par = new Map();
    let sansCout = 0;
    for (const l of lignes) {
        // commande_id d'abord: c'est l'identite forte. A defaut le client, qui
        // regroupe ses achats de la journee. A defaut le comptoir, ou tout le
        // anonyme se retrouve - une seule ligne, pas une par vente.
        const cle = l.commande_id || (l.nom_client ? 'client:' + l.nom_client : '(comptoir)');
        if (!par.has(cle)) {
            par.set(cle, {
                commande_id: l.commande_id || null,
                client: l.nom_client || null,
                ca: 0, marge: 0, lignes: 0, quantite: 0,
                // LE CA REELLEMENT CHIFFRE, distinct du CA total. Une commande
                // dont un produit n'a pas de prix d'achat rend une marge
                // PARTIELLE; la diviser par le CA COMPLET donne un taux dilue,
                // et une commande entierement sans cout affichait ainsi 0,0 %,
                // ce qui se lit comme une marge nulle averee alors qu'elle est
                // simplement inconnue.
                ca_chiffre: 0,
                sans_cout: []
            });
        }
        const e = par.get(cle);
        const q = nb(l.nombre);
        const ca = nb(l.montant);
        e.ca += ca;
        e.lignes += 1;
        e.quantite += q;

        const pa = parseFloat(prixAchatDe(l.produit));
        if (!Number.isFinite(pa) || pa <= 0) {
            if (e.sans_cout.indexOf(l.produit) < 0) e.sans_cout.push(l.produit);
            sansCout += ca;
            continue;
        }
        // Le parage ne s'applique qu'a la boucherie: un sachet d'epices ne
        // perd rien a la decoupe, et le diviser gonflerait son cout.
        const d = estBoucherie(l.produit) ? div : 1;
        const pv = q > 0 ? ca / q : nb(l.prix_unit);
        e.marge += (pv - pa / d) * q;
        e.ca_chiffre += ca;
    }

    const commandes = Array.from(par.values()).map((e) => ({
        commande_id: e.commande_id,
        client: e.client,
        ca: round2(e.ca),
        ca_chiffre: round2(e.ca_chiffre),
        marge: round2(e.marge),
        // null, pas 0: sans un franc de CA chiffre, le taux n'existe pas.
        taux_pct: e.ca_chiffre > 0 ? round2((e.marge / e.ca_chiffre) * 100) : null,
        lignes: e.lignes,
        quantite: round2(e.quantite),
        sans_cout: e.sans_cout
    })).sort((a, b) => b.marge - a.marge);

    return {
        commandes: commandes,
        total_ca: round2(commandes.reduce((s, x) => s + x.ca, 0)),
        total_ca_chiffre: round2(commandes.reduce((s, x) => s + x.ca_chiffre, 0)),
        total_marge: round2(commandes.reduce((s, x) => s + x.marge, 0)),
        ca_sans_cout: round2(sansCout),
        parage_pct: paragePct
    };
}

module.exports = { agregerCommandes };
