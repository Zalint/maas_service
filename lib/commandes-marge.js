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

// Meme normalisation que lib/volumes-vendus.js, pour la meme raison: "Poulet
// en détail" et "Poulet En Détail" sont le meme produit, et les compter
// separement dans l'infobulle en ferait deux lignes au lieu d'une quantite
// cumulee.
const { normaliserNom } = require('./parage');

/** Cumule q, son CA, son COUT REEL apres parage (pa/div * q, pas une
 * soustraction CA - marge) ET son cout AVANT parage (pa * q, pour montrer
 * l'effet du parage a l'ecran) sous la graphie NORMALISEE de nom, en
 * gardant la premiere graphie vue pour l'affichage. coutLigne est null
 * quand le prix d'achat de cette ligne est inconnu: le produit reste
 * visible (sa quantite compte) mais son cout est marque incomplet plutot
 * que tu par un zero qui se lirait comme "gratuit". */
function accumulerProduit(map, nom, q, coutLigne, ca, coutAvantParage) {
    const cle = normaliserNom(nom);
    const cur = map.get(cle) || { produit: nom, quantite: 0, ca: 0, cout: 0, coutAvantParage: 0, coutIncomplet: false };
    cur.quantite += q;
    cur.ca += nb(ca);
    if (coutLigne === null) cur.coutIncomplet = true;
    else {
        cur.cout += coutLigne;
        cur.coutAvantParage += nb(coutAvantParage);
    }
    map.set(cle, cur);
}

// LE DETAIL PAR PRODUIT d'une commande, avec son unite ET son cout REEL.
//
// Le cout est celui REELLEMENT utilise pour la marge (prix d'achat resolu a
// la date de la vente, divise par le parage pour la boucherie) - pas une
// soustraction (CA - marge) au niveau de la commande, qui masquerait quel
// produit precisement a couté cher. Le CA voyage a cote: c'est ce qui permet
// a l'ecran de reconcilier, produit par produit, marge = CA - cout.
//
// coutAvantParage voyage aussi: sans lui, l'ecran ne peut pas montrer l'EFFET
// du parage (le prix d'achat brut vs le cout retenu apres division) - deux
// nombres qu'un lecteur qui verifie le calcul a la main veut voir cote a
// cote, pas devoir reconstituer depuis le taux affiche ailleurs.
//
// La base ne connait pas l'unite de vente: produits.unite_stock vaut 'unite'
// pour les 293 produits, sans exception. La regle metier tranche: la
// boucherie se vend au KILO (le champ nombre est un poids), tout le reste a
// la PIECE. C'est la meme frontiere que le parage, et la meme fonction la
// donne. 'piece' sans accent: c'est un jeton de donnees, l'ecran accentue.
function detailProduits(parProduit, estBoucherie) {
    return Array.from(parProduit.values())
        .map(({ produit, quantite, ca, cout, coutAvantParage, coutIncomplet }) => ({
            produit: produit,
            quantite: round2(quantite),
            unite: estBoucherie(produit) ? 'kg' : 'piece',
            ca: round2(ca),
            // null : le prix d'achat manque sur au moins une ligne de ce
            // produit, un cout partiel se ferait passer pour le cout entier.
            cout: coutIncomplet ? null : round2(cout),
            cout_avant_parage: coutIncomplet ? null : round2(coutAvantParage)
        }))
        .sort((a, b) => b.quantite - a.quantite);
}

// LE DIVISEUR DE COUT D'UN PRODUIT.
//
// Le parage etait un taux UNIQUE, applique au boeuf, au veau et a l'agneau
// sans distinction. Il peut desormais varier par produit - le depot mesure la
// perte reelle par espece, cf lib/parage-effectif.js. On accepte les deux
// formes: une fonction (produit) => points, ou l'ancien scalaire.
//
// Rend 1 hors boucherie et pour un taux nul: diviser par 1 ne change rien,
// ce qui est exactement ce qu'on veut d'un sachet d'epices.
function diviseurDe(paragePour, paragePct, produit, estBoucherie) {
    if (estBoucherie && !estBoucherie(produit)) return 1;
    let pts;
    if (typeof paragePour === 'function') pts = parseFloat(paragePour(produit));
    else pts = parseFloat(paragePct);
    // Hors de [0, 100[, le diviseur serait nul ou negatif: la marge
    // deviendrait infinie ou inversee. 5 % est la valeur par defaut.
    if (!Number.isFinite(pts) || pts < 0 || pts >= 100) pts = 5;
    return 1 - (pts / 100);
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
    // paragePour prime sur paragePct: un taux par espece plutot qu'un seul.
    const paragePour = args && args.paragePour;

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
                ca: 0, marge: 0, cout: 0, lignes: 0, quantite: 0,
                ca_chiffre: 0,
                sans_cout: [],
                // produit -> quantite cumulee, pour le detail au survol.
                parProduit: new Map()
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
            // COUT INCONNU = MARGE NULLE, pas une ligne ecartee du calcul.
            //
            // Exclure ce CA du denominateur (l'ancien comportement) supposait
            // implicitement une marge MOYENNE sur la part inconnue - c'est
            // cette hypothese qui gonflait le taux affiche loin au-dessus de
            // la marge reellement encaissee. Compter le CA avec une marge de
            // zero est l'hypothese neutre: elle ne peut que TIRER le taux
            // vers le bas, jamais l'inventer vers le haut.
            //
            // Le cout SUIT la meme hypothese (cout = ca, marge = 0): sans
            // cela, la colonne Cout de l'ecran et la Marge affichee a cote ne
            // se seraient plus additionnees au CA.
            accumulerProduit(e.parProduit, l.produit, q, null, ca);
            if (e.sans_cout.indexOf(l.produit) < 0) e.sans_cout.push(l.produit);
            sansCout += ca;
            e.ca_chiffre += ca;
            e.cout += ca;
            continue;
        }
        // Le parage ne s'applique qu'a la boucherie - un sachet d'epices ne
        // perd rien a la decoupe - et il varie desormais par espece.
        const d = diviseurDe(paragePour, paragePct, l.produit, estBoucherie);
        const coutLigne = (pa / d) * q;
        accumulerProduit(e.parProduit, l.produit, q, coutLigne, ca, pa * q);
        const pv = q > 0 ? ca / q : nb(l.prix_unit);
        e.marge += pv * q - coutLigne;
        e.ca_chiffre += ca;
        e.cout += coutLigne;
    }

    const commandes = Array.from(par.values()).map((e) => ({
        commande_id: e.commande_id,
        client: e.client,
        ca: round2(e.ca),
        ca_chiffre: round2(e.ca_chiffre),
        cout: round2(e.cout),
        marge: round2(e.marge),
        // null, pas 0: sans un franc de CA chiffre, le taux n'existe pas.
        taux_pct: e.ca_chiffre > 0 ? round2((e.marge / e.ca_chiffre) * 100) : null,
        lignes: e.lignes,
        quantite: round2(e.quantite),
        produits: detailProduits(e.parProduit, estBoucherie),
        sans_cout: e.sans_cout
    })).sort((a, b) => b.marge - a.marge);

    return {
        commandes: commandes,
        total_ca: round2(commandes.reduce((s, x) => s + x.ca, 0)),
        total_ca_chiffre: round2(commandes.reduce((s, x) => s + x.ca_chiffre, 0)),
        total_cout: round2(commandes.reduce((s, x) => s + x.cout, 0)),
        total_marge: round2(commandes.reduce((s, x) => s + x.marge, 0)),
        ca_sans_cout: round2(sansCout),
        parage_pct: paragePct
    };
}

/**
 * LES CLIENTS DE LA PERIODE, cumules et classes par marge.
 *
 * Meme regle de marge que agregerCommandes, mais l'unite change: une LIGNE
 * n'est plus une commande, c'est un CLIENT. « Mme Ndiaye » qui passe deux
 * commandes dans le mois fait UNE ligne et deux commandes - c'est ce que
 * compte la colonne dediee, et c'est tout l'interet de cumuler.
 *
 * LE PRIX D'ACHAT EST RESOLU A LA DATE DE CHAQUE VENTE. Un client qui a
 * achete le 3 doit etre valorise au prix du 3, pas au dernier prix connu:
 * sur un mois ou le boeuf passe de 4 480 a 4 520, valoriser tout au dernier
 * prix deplacerait la marge de chaque client du debut de mois.
 *
 * @param {object} args
 * @param {Array}  args.lignes  [{date, produit, nombre, montant, prix_unit,
 *                               commande_id, nom_client}]
 * @param {(produit: string, date: string) => number} args.prixAchatDe
 * @param {(produit: string) => boolean} args.estBoucherie
 * @param {number} args.paragePct
 */
function agregerClients(args) {
    const lignes = (args && args.lignes) || [];
    const prixAchatDe = (args && args.prixAchatDe) || (() => NaN);
    const estBoucherie = (args && args.estBoucherie) || (() => false);
    const brut = parseFloat(args && args.paragePct);
    const paragePct = Number.isFinite(brut) && brut >= 0 && brut < 100 ? brut : 5;
    const paragePour = args && args.paragePour;

    // LE COMPTOIR N'EST PAS UN CLIENT. Cumule, il pesait 399 commandes et
    // 41 % du CA: il prenait la premiere ligne d'un tableau qui s'appelle
    // « les meilleurs clients », et l'y garder revenait a comparer une foule
    // a des personnes. Il part dans sa propre section, par COMMANDE.
    const par = new Map();
    const comptoirParCommande = new Map();
    let sansCout = 0;
    for (const l of lignes) {
        const nom = String((l && l.nom_client) || '').trim();
        const cle = nom || '(comptoir)';
        if (!par.has(cle)) {
            par.set(cle, {
                client: nom || null,
                ca: 0, ca_chiffre: 0, cout: 0, marge: 0, lignes: 0, quantite: 0,
                // UNE COMMANDE = un commande_id. Les lignes qui n'en portent
                // pas sont regroupees par JOURNEE: un passage au comptoir
                // sans identifiant compte pour un, pas pour chacun de ses
                // produits.
                commandes: new Set(),
                sans_cout: [],
                parProduit: new Map()
            });
        }
        const e = par.get(cle);
        const date = String((l && l.date) || '').slice(0, 10);
        const cleCommande = l && l.commande_id ? String(l.commande_id) : 'jour:' + date;
        e.commandes.add(cleCommande);

        // Le comptoir est aussi suivi COMMANDE PAR COMMANDE: c'est la seule
        // maille ou une vente anonyme reste identifiable.
        let ec = null;
        if (!nom) {
            if (!comptoirParCommande.has(cleCommande)) {
                comptoirParCommande.set(cleCommande, {
                    commande_id: l && l.commande_id ? String(l.commande_id) : null,
                    date: date, ca: 0, ca_chiffre: 0, cout: 0, marge: 0, lignes: 0,
                    parProduit: new Map()
                });
            }
            ec = comptoirParCommande.get(cleCommande);
            ec.lignes += 1;
        }

        const q = nb(l.nombre);
        const ca = nb(l.montant);
        e.ca += ca;
        e.lignes += 1;
        e.quantite += q;
        if (ec) ec.ca += ca;

        const pa = parseFloat(prixAchatDe(l.produit, date));
        if (!Number.isFinite(pa) || pa <= 0) {
            // COUT INCONNU = MARGE NULLE : voir agregerCommandes plus haut.
            accumulerProduit(e.parProduit, l.produit, q, null, ca);
            if (ec) accumulerProduit(ec.parProduit, l.produit, q, null, ca);
            if (e.sans_cout.indexOf(l.produit) < 0) e.sans_cout.push(l.produit);
            sansCout += ca;
            e.ca_chiffre += ca;
            e.cout += ca;
            if (ec) { ec.ca_chiffre += ca; ec.cout += ca; }
            continue;
        }
        const d = diviseurDe(paragePour, paragePct, l.produit, estBoucherie);
        const coutLigne = (pa / d) * q;
        accumulerProduit(e.parProduit, l.produit, q, coutLigne, ca, pa * q);
        if (ec) accumulerProduit(ec.parProduit, l.produit, q, coutLigne, ca, pa * q);
        const pv = q > 0 ? ca / q : nb(l.prix_unit);
        const marge = pv * q - coutLigne;
        e.marge += marge;
        e.ca_chiffre += ca;
        e.cout += coutLigne;
        if (ec) { ec.marge += marge; ec.ca_chiffre += ca; ec.cout += coutLigne; }
    }

    const clients = Array.from(par.values()).filter((e) => e.client).map((e) => ({
        client: e.client,
        nb_commandes: e.commandes.size,
        ca: round2(e.ca),
        ca_chiffre: round2(e.ca_chiffre),
        cout: round2(e.cout),
        marge: round2(e.marge),
        // null, pas 0: sans un franc de CA chiffre, le taux n'existe pas.
        taux_pct: e.ca_chiffre > 0 ? round2((e.marge / e.ca_chiffre) * 100) : null,
        lignes: e.lignes,
        quantite: round2(e.quantite),
        produits: detailProduits(e.parProduit, estBoucherie),
        sans_cout: e.sans_cout
    })).sort((a, b) => b.marge - a.marge);

    // LE COMPTOIR, par commande et classe par marge. Borne aux plus grosses:
    // 399 lignes anonymes ne se lisent pas. Le nombre RETIRE est rendu avec,
    // pour qu'une liste tronquee ne passe pas pour une liste complete.
    const brutLimite = parseInt(args && args.limiteComptoir, 10);
    const limite = Number.isFinite(brutLimite) && brutLimite > 0 ? brutLimite : 20;
    const toutComptoir = Array.from(comptoirParCommande.values())
        .map((c) => ({
            commande_id: c.commande_id,
            date: c.date,
            ca: round2(c.ca),
            ca_chiffre: round2(c.ca_chiffre),
            cout: round2(c.cout),
            marge: round2(c.marge),
            taux_pct: c.ca_chiffre > 0 ? round2((c.marge / c.ca_chiffre) * 100) : null,
            lignes: c.lignes,
            produits: detailProduits(c.parProduit, estBoucherie)
        }))
        .sort((a, b) => b.marge - a.marge);

    const comptoir = {
        commandes: toutComptoir.slice(0, limite),
        nb_commandes: toutComptoir.length,
        nb_affichees: Math.min(limite, toutComptoir.length),
        nb_masquees: Math.max(0, toutComptoir.length - limite),
        total_ca: round2(toutComptoir.reduce((s, x) => s + x.ca, 0)),
        total_ca_chiffre: round2(toutComptoir.reduce((s, x) => s + x.ca_chiffre, 0)),
        total_cout: round2(toutComptoir.reduce((s, x) => s + x.cout, 0)),
        total_marge: round2(toutComptoir.reduce((s, x) => s + x.marge, 0)),
        limite: limite
    };

    return {
        clients: clients,
        nb_clients: clients.length,
        total_ca: round2(clients.reduce((s, x) => s + x.ca, 0)),
        total_ca_chiffre: round2(clients.reduce((s, x) => s + x.ca_chiffre, 0)),
        total_cout: round2(clients.reduce((s, x) => s + x.cout, 0)),
        total_marge: round2(clients.reduce((s, x) => s + x.marge, 0)),
        total_commandes: clients.reduce((s, x) => s + x.nb_commandes, 0),
        comptoir: comptoir,
        ca_sans_cout: round2(sansCout),
        parage_pct: paragePct
    };
}

/**
 * LE COUT REEL PAR PRODUIT, CUMULE SUR TOUTE LA PERIODE.
 *
 * Les vues par commande et par client detaillent QUI a achete; celle-ci
 * detecte QUOI a un probleme structurel, invisible quand la perte d'un
 * produit se dilue dans des dizaines de commandes: un produit qui VEND A
 * PERTE (son cout depasse systematiquement son prix, souvent un prix
 * d'achat mal saisi au catalogue - un conditionnement gros au lieu du prix
 * au detail), et un produit dont le CA s'accumule sans qu'aucun prix
 * d'achat ne soit jamais connu.
 *
 * @param {object} args
 * @param {Array}  args.lignes  [{date, produit, nombre, montant, prix_unit}]
 * @param {(produit: string, date: string) => number} args.prixAchatDe
 * @param {(produit: string) => boolean} args.estBoucherie
 * @param {number} [args.paragePct]
 * @param {Function} [args.paragePour]
 */
function agregerProduitsPeriode(args) {
    const lignes = (args && args.lignes) || [];
    const prixAchatDe = (args && args.prixAchatDe) || (() => NaN);
    const estBoucherie = (args && args.estBoucherie) || (() => false);
    const brut = parseFloat(args && args.paragePct);
    const paragePct = Number.isFinite(brut) && brut >= 0 && brut < 100 ? brut : 5;
    const paragePour = args && args.paragePour;

    const par = new Map();
    for (const l of lignes) {
        const date = String((l && l.date) || '').slice(0, 10);
        const cle = normaliserNom(l.produit);
        if (!par.has(cle)) {
            par.set(cle, { produit: l.produit, quantite: 0, ca: 0, cout: 0, coutIncomplet: false, lignes: 0 });
        }
        const e = par.get(cle);
        const q = nb(l.nombre);
        const ca = nb(l.montant);
        e.quantite += q;
        e.ca += ca;
        e.lignes += 1;

        const pa = parseFloat(prixAchatDe(l.produit, date));
        if (!Number.isFinite(pa) || pa <= 0) {
            e.coutIncomplet = true;
            continue;
        }
        const d = diviseurDe(paragePour, paragePct, l.produit, estBoucherie);
        e.cout += (pa / d) * q;
    }

    return Array.from(par.values()).map((e) => ({
        produit: e.produit,
        quantite: round2(e.quantite),
        unite: estBoucherie(e.produit) ? 'kg' : 'piece',
        ca: round2(e.ca),
        lignes: e.lignes,
        // null : au moins une ligne de ce produit n'a pas de prix d'achat -
        // le cout et la marge cumules sont donc INCOMPLETS, pas nuls.
        cout: e.coutIncomplet ? null : round2(e.cout),
        marge: e.coutIncomplet ? null : round2(e.ca - e.cout)
    })).sort((a, b) => {
        // Les marges connues d'abord, la plus mauvaise en tete: c'est elle
        // qu'on veut signaler en premier. Les couts inconnus ensuite, par CA
        // decroissant - le plus gros trou de donnees avant les petits.
        if (a.marge === null && b.marge === null) return b.ca - a.ca;
        if (a.marge === null) return 1;
        if (b.marge === null) return -1;
        return a.marge - b.marge;
    });
}

module.exports = { agregerCommandes, agregerClients, agregerProduitsPeriode };
