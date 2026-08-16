/**
 * D'OU VIENT L'ECART DE PL entre deux journees — module PUR, sans DOM, sans
 * base, sans reseau.
 *
 * Un PL figé est un CUMUL du 1er du mois a sa date. Deux snapshots voisins qui
 * partent du MEME jour se soustraient donc poste par poste, et la difference
 * est la contribution de la journee. C'est de l'arithmetique: elle boucle ou
 * elle ne boucle pas, et on le dit.
 *
 * CE MODULE NE FAIT AUCUNE INTERPRETATION. Il rend des ecarts chiffres et des
 * DRAPEAUX factuels ("le stock du soir etait estime", "le coefficient a
 * bouge"). L'interpretation, si elle vient un jour d'un LLM, se fera a partir
 * de cette sortie - jamais a partir des chiffres bruts, ou elle attribuerait
 * a une vente ce qui est une revalorisation.
 *
 * LE PARTAGE VOLUME / REVALORISATION est la raison d'etre du module.
 * La variation de stock melange deux choses qu'un tableau de postes ne separe
 * pas: on a vendu ou recu de la marchandise (volume), ET le prix auquel on
 * valorise cette marchandise a change (revalorisation). Sur un ecart reel
 * mesure ici, pres d'un tiers de la variation de stock etait de la pure
 * revalorisation - la carcasse passee de 3 835 a 4 500 F le kilo. Sans ce
 * partage, toute explication de la variation de stock est fausse.
 *
 * La decomposition est celle de Laspeyres, exacte par construction:
 *
 *   valeur(J) - valeur(J-1) = Σ (q_J - q_V) x p_V        <- volume, au prix d'hier
 *                           + Σ q_J x (p_J - p_V)        <- revalorisation
 *
 * Les deux termes se somment EXACTEMENT a l'ecart total: q_J.p_J - q_V.p_V.
 * Aucun residu a expliquer, aucune part "autre" ou l'on range ce qu'on n'a pas
 * su attribuer.
 */

/** Lecture numerique tolerante: une absence vaut zero, jamais NaN. */
function nb(v) {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : 0;
}

function round2(v) {
    return Math.round(nb(v) * 100) / 100;
}

/**
 * Un montant DANS UN TEXTE de drapeau, a la francaise et sans decimale.
 *
 * Les drapeaux sont lus par un humain: « 27162.3 F » se dechiffre, « 27 162 F »
 * se lit. Le module reste pur - c'est du formatage de chaine, pas du DOM - et
 * porter ce formatage ici evite que chaque appelant ne le refasse a sa facon.
 */
function fmtFr(v) {
    const n = Math.round(nb(v));
    return (n < 0 ? '−' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * LES POSTES DU PL et leur signe dans la formule.
 *
 *   PL = ventes - avances - commission + marge CDC - charges - depenses
 *        - paiements fournisseur + variation de stock nette
 *
 * Le signe est porte ICI et nulle part ailleurs: c'est lui qui permet au
 * controle de bouclage d'etre un vrai controle. Si un poste apparait dans le
 * PL sans figurer dans cette table, la somme des contributions ne retombera
 * pas sur l'ecart de PL, et le module le signalera au lieu d'afficher un
 * tableau plausible mais incomplet.
 */
const POSTES = [
    { cle: 'ventes', libelle: 'Ventes', signe: 1, lire: (p) => nb(p.total_ventes) },
    { cle: 'avances', libelle: 'Avances (MataBanq)', signe: -1, lire: (p) => nb(p.total_avances) },
    { cle: 'commission', libelle: 'Commission MaaS', signe: -1, lire: (p) => nb(p.commission_maas) },
    { cle: 'marge_cdc', libelle: 'Marge CDC', signe: 1, lire: (p) => nb(p.marge_cdc) },
    { cle: 'charges', libelle: 'Charges proratisées', signe: -1,
      lire: (p) => nb((p.charges || {}).total_prorata) },
    { cle: 'depenses', libelle: 'Dépenses', signe: -1, lire: (p) => nb(p.depenses_periode) },
    { cle: 'paiements', libelle: 'Paiements fournisseur', signe: -1,
      lire: (p) => nb(p.paiements_fournisseur) },
    { cle: 'stock', libelle: 'Variation de stock', signe: 1,
      lire: (p) => nb((p.stock || {}).variation_nette) }
];

/** Le residu tolere sur le bouclage, en FCFA. Les postes sont arrondis au
 *  centime a l'ecriture du snapshot: quelques centimes d'ecart cumules sont
 *  de l'arrondi, pas un poste manquant. Au-dela, c'est un vrai trou. */
const TOLERANCE_BOUCLAGE = 1;

/** La part de revalorisation a partir de laquelle on leve un drapeau. En
 *  dessous, le prix a bouge a la marge et l'annoncer ferait du bruit. */
const SEUIL_REVALORISATION = 0.15;

/**
 * Indexe des lignes de detail par produit.
 * `detail_lignes` porte {produit, base, quantite, prix_utilise, valeur}.
 */
function indexerDetail(lignes) {
    const par = new Map();
    (lignes || []).forEach((l) => {
        const nom = String(l && l.produit != null ? l.produit : '').trim();
        if (!nom) return;
        // Un produit vu deux fois dans le meme detail est additionne plutot
        // qu'ecrase: perdre une ligne fausserait le bouclage du partage.
        const dejaLa = par.get(nom);
        const q = nb(l.quantite);
        const p = (l.prix_utilise === null || l.prix_utilise === undefined)
            ? null : nb(l.prix_utilise);
        // `base` dit si prix_utilise est un prix d'ACHAT ou, a defaut, le prix
        // de vente. Un total « au cout d'achat » qui melangerait les deux
        // n'aurait pas de sens: on garde la base pour pouvoir les separer.
        const base = String((l && l.base) || '').toLowerCase() || null;
        if (dejaLa) {
            dejaLa.quantite += q;
            dejaLa.valeur += nb(l.valeur);
            if (dejaLa.prix === null) dejaLa.prix = p;
            if (dejaLa.base === null) dejaLa.base = base;
        } else {
            par.set(nom, { produit: nom, quantite: q, prix: p, valeur: nb(l.valeur), base: base });
        }
    });
    return par;
}

/**
 * Le partage VOLUME / REVALORISATION de l'ecart de stock du soir.
 *
 * On compare les deux stocks DU SOIR: les deux snapshots partant du meme 1er
 * du mois, le stock du matin leur est commun, et tout l'ecart de variation
 * vient donc du soir.
 *
 * Un produit ABSENT d'un des deux cotes compte pour une quantite nulle. Son
 * prix de reference devient alors celui du cote ou il existe: sans cela, un
 * produit apparu ce jour-la aurait un prix de reference nul et sa valeur
 * entiere tomberait dans la revalorisation, alors que c'est du volume pur.
 */
function partagerEcartStock(detailVeille, detailJour) {
    const av = indexerDetail(detailVeille);
    const ap = indexerDetail(detailJour);
    const noms = new Set([...av.keys(), ...ap.keys()]);

    let volume = 0, revalorisation = 0, valeurVeille = 0, valeurJour = 0;
    let inchanges = 0;
    const lignes = [];
    // LA VALEUR AU COUT D'ACHAT, aux deux bornes. C'est le chiffre qui se
    // compare a l'argent sorti: une avance paie de la marchandise, et la
    // marchandise se compte a ce qu'elle a coute, jamais a ce qu'elle
    // rapportera. Les lignes valorisees au prix de VENTE - faute de prix
    // d'achat connu - sont tenues a part: les additionner ici ferait un total
    // « au cout d'achat » qui n'en est pas un.
    let achatVeille = 0, achatJour = 0, horsAchatVeille = 0, horsAchatJour = 0;
    noms.forEach((nom) => {
        const v = av.get(nom) || { quantite: 0, prix: null, valeur: 0, base: null };
        const j = ap.get(nom) || { quantite: 0, prix: null, valeur: 0, base: null };
        if (v.base === 'achat') achatVeille += nb(v.valeur); else horsAchatVeille += nb(v.valeur);
        if (j.base === 'achat') achatJour += nb(j.valeur); else horsAchatJour += nb(j.valeur);
        // Prix de reference: celui de la veille, et a defaut celui du jour.
        const pV = v.prix !== null ? v.prix : (j.prix !== null ? j.prix : 0);
        const pJ = j.prix !== null ? j.prix : pV;
        const dVol = (nb(j.quantite) - nb(v.quantite)) * pV;
        const dPrix = nb(j.quantite) * (pJ - pV);
        volume += dVol;
        revalorisation += dPrix;
        valeurVeille += nb(v.valeur);
        valeurJour += nb(j.valeur);
        if (Math.abs(dVol) > 0.005 || Math.abs(dPrix) > 0.005) {
            lignes.push({
                produit: nom,
                quantite_veille: round2(v.quantite), quantite_jour: round2(j.quantite),
                prix_veille: v.prix === null ? null : round2(v.prix),
                prix_jour: j.prix === null ? null : round2(j.prix),
                // Quantite x cout, aux deux bornes: ce que la ligne VAUT, et
                // sur quelle base elle est valorisee.
                valeur_veille: round2(v.valeur),
                valeur_jour: round2(j.valeur),
                base_veille: v.base, base_jour: j.base,
                effet_volume: round2(dVol), effet_prix: round2(dPrix),
                ecart: round2(dVol + dPrix),
                // Ce que la ligne RACONTE, en un mot. L'ecran s'en sert pour
                // nommer le mouvement sans avoir a relire les quantites: une
                // apparition et une hausse ne se lisent pas pareil.
                mouvement: nb(v.quantite) === 0 ? 'apparu'
                    : (nb(j.quantite) === 0 ? 'disparu'
                        : (nb(j.quantite) > nb(v.quantite) ? 'hausse' : 'baisse'))
            });
        } else {
            inchanges++;
        }
    });
    lignes.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart));

    const total = volume + revalorisation;
    return {
        volume: round2(volume),
        revalorisation: round2(revalorisation),
        total: round2(total),
        // La part de revalorisation dans l'ecart, en valeur ABSOLUE des deux
        // termes: un volume de +100 et une revalorisation de -100 donnent un
        // total nul, et dire "0 % de revalorisation" serait faux - les deux
        // effets sont massifs et se compensent.
        part_revalorisation: (Math.abs(volume) + Math.abs(revalorisation)) > 0
            ? Math.abs(revalorisation) / (Math.abs(volume) + Math.abs(revalorisation))
            : 0,
        valeur_veille: round2(valeurVeille),
        valeur_jour: round2(valeurJour),
        // AU COUT D'ACHAT seulement, et ce qui en est exclu faute de prix
        // d'achat connu. C'est `achat_jour` qui se compare a l'argent sorti.
        achat_veille: round2(achatVeille),
        achat_jour: round2(achatJour),
        achat_delta: round2(achatJour - achatVeille),
        hors_achat_veille: round2(horsAchatVeille),
        hors_achat_jour: round2(horsAchatJour),
        lignes: lignes,
        // Les produits presents mais IMMOBILES. On les compte sans les lister:
        // une ligne a zero n'apprend rien, mais leur nombre dit combien du
        // stock n'a pas bouge - et une liste qui n'annonce pas ce qu'elle
        // omet se lit comme la liste complete.
        nb_inchanges: inchanges
    };
}

/**
 * CE QUI S'EST VENDU, produit par produit.
 *
 * Le poste « Ventes » du tableau n'affiche que deux cumuls de francs. La
 * question qui suit est toujours la meme - quoi, et combien de kilos - et le
 * payload la porte deja: `volumes.produits` liste les quantites vendues et
 * leur chiffre d'affaires, cumulees depuis le 1er. Deux cumuls voisins se
 * soustraient donc comme les postes.
 *
 * IL N'Y A PAS D'EQUIVALENT POUR LES AVANCES. Elles arrivent de MataBanq comme
 * des operations {type, date, montant}: aucune dimension produit n'existe a la
 * source, et rien ne permet de dire quelle avance a paye quel kilo. La
 * contrepartie en marchandise se lit sur le stock, pas sur les avances.
 */
function partagerVentes(volVeille, volJour) {
    // UN CUMUL ABSENT N'EST PAS UN CUMUL NUL.
    //
    // `volumes` est un champ RECENT: les snapshots figes avant son ajout ne le
    // portent pas. Traiter son absence comme un zero faisait apparaitre tout
    // le cumul du mois comme la vente d'une seule journee - 336 kg de boeuf en
    // un jour, sur un cas reel. On refuse de ventiler plutot que de mentir.
    const aDesVolumes = (v) => !!(v && Array.isArray(v.produits));
    if (!aDesVolumes(volVeille) || !aDesVolumes(volJour)) {
        return {
            ventilable: false,
            raison: 'Le détail des volumes vendus manque sur '
                + (!aDesVolumes(volVeille) && !aDesVolumes(volJour) ? 'les deux photos'
                    : (!aDesVolumes(volVeille) ? 'la photo de la veille' : 'la photo du jour'))
                + ' : ce PL a été figé avant que ce détail ne soit enregistré. '
                + 'Les journées figées depuis le portent.',
            lignes: [], total_quantite: 0, total_ca: 0
        };
    }
    const index = (v) => {
        const m = new Map();
        (((v || {}).produits) || []).forEach((p) => {
            const cle = String(p.cle || '').trim();
            if (!cle) return;
            m.set(cle, {
                libelle: (Array.isArray(p.graphies) && p.graphies[0]) || cle,
                quantite: nb(p.quantite), ca: nb(p.ca)
            });
        });
        return m;
    };
    const av = index(volVeille), ap = index(volJour);
    const cles = new Set([...av.keys(), ...ap.keys()]);
    const lignes = [];
    cles.forEach((cle) => {
        const v = av.get(cle) || { quantite: 0, ca: 0, libelle: null };
        const j = ap.get(cle) || { quantite: 0, ca: 0, libelle: null };
        const dQ = j.quantite - v.quantite;
        const dCa = j.ca - v.ca;
        // Un produit qui n'a pas bouge n'apprend rien: le cumul est le meme
        // des deux cotes, donc il n'a rien vendu ce jour-la.
        if (Math.abs(dQ) < 0.005 && Math.abs(dCa) < 0.5) return;
        lignes.push({
            produit: j.libelle || v.libelle || cle,
            quantite: round2(dQ), ca: round2(dCa),
            // Le prix moyen DU JOUR, reconstitue depuis ce qui a bouge - pas
            // le prix moyen du cumul, qui melange tous les jours du mois.
            prix_moyen: Math.abs(dQ) > 0.005 ? round2(dCa / dQ) : null
        });
    });
    lignes.sort((a, b) => Math.abs(b.ca) - Math.abs(a.ca));
    return {
        ventilable: true,
        lignes: lignes,
        total_quantite: round2(lignes.reduce((s, l) => s + l.quantite, 0)),
        total_ca: round2(lignes.reduce((s, l) => s + l.ca, 0))
    };
}

/**
 * LES LIGNES QUI SONT ENTREES DANS LE CUMUL entre les deux photos.
 *
 * Depenses et paiements fournisseur vivent dans des tables locales, datees:
 * les lignes de la journee sont donc celles dont la date tombe apres la veille
 * et jusqu'au jour inclus. L'appelant les fournit deja filtrees.
 *
 * LEUR SOMME EST VERIFIEE contre la contribution du poste. Quand elle ne
 * correspond pas, on ne masque pas la liste - on la rend avec son ecart:
 * lister trois depenses sous un poste qui en compte quatre donnerait une
 * explication complete en apparence, et fausse.
 */
function listerEntrees(lignes, contributionAttendue, signe) {
    const propres = (lignes || []).map((l) => ({
        date: (l && l.date) ? String(l.date).slice(0, 10) : null,
        libelle: String((l && (l.libelle || l.categorie)) || '—'),
        montant: nb(l && l.montant)
    })).sort((a, b) => Math.abs(b.montant) - Math.abs(a.montant));
    const total = propres.reduce((s, l) => s + l.montant, 0);
    // La contribution du poste porte le signe de la formule (une depense fait
    // BAISSER le PL): on la ramene au montant brut pour la comparer.
    const attendu = nb(contributionAttendue) * nb(signe);
    return {
        lignes: propres,
        total: round2(total),
        attendu: round2(attendu),
        ecart: round2(total - attendu),
        complet: Math.abs(total - attendu) <= TOLERANCE_BOUCLAGE
    };
}

/**
 * LES CHARGES, ligne a ligne. Elles sont PRORATISEES: leur ecart d'un jour a
 * l'autre n'est pas une depense nouvelle mais un jour de plus de prorata, ce
 * que le libelle doit dire pour ne pas se lire comme un decaissement.
 */
function partagerCharges(chVeille, chJour) {
    // MEME precaution que les ventes: un `detail` absent d'un cote ferait
    // passer tout le prorata cumule pour l'increment d'une journee.
    const aDuDetail = (c) => !!(c && Array.isArray(c.detail));
    if (!aDuDetail(chVeille) || !aDuDetail(chJour)) {
        return { ventilable: false, lignes: [], total: 0,
            raison: 'Le détail des charges manque sur une des deux photos.' };
    }
    const index = (c) => {
        const m = new Map();
        (((c || {}).detail) || []).forEach((d) => {
            const nom = String((d && d.nom) || '').trim();
            if (nom) m.set(nom, { libelle: d.libelle || nom, prorata: nb(d.prorata) });
        });
        return m;
    };
    const av = index(chVeille), ap = index(chJour);
    const lignes = [];
    new Set([...av.keys(), ...ap.keys()]).forEach((nom) => {
        const v = av.get(nom) || { prorata: 0, libelle: null };
        const j = ap.get(nom) || { prorata: 0, libelle: null };
        const d = j.prorata - v.prorata;
        if (Math.abs(d) < 0.5) return;
        lignes.push({ libelle: j.libelle || v.libelle || nom, montant: round2(d) });
    });
    lignes.sort((a, b) => Math.abs(b.montant) - Math.abs(a.montant));
    return { ventilable: true, lignes: lignes,
        total: round2(lignes.reduce((s, l) => s + l.montant, 0)) };
}

/** Les drapeaux FACTUELS: ce qui, dans ces deux journees, rend l'ecart autre
 *  chose qu'un evenement d'exploitation. Chacun porte un niveau, pour que
 *  l'ecran puisse trier sans avoir a comprendre le contenu. */
function drapeauxDe(veille, jour, stock, recalc) {
    const sV = veille.stock || {}, sJ = jour.stock || {};
    const out = [];

    // 0. JOURNEE RECALCULEE. Elle n'a pas ete figee: on l'a refaite depuis les
    //    donnees TELLES QU'ELLES SONT MAINTENANT. Une vente saisie en retard
    //    ou un stock corrige depuis y est incluse, alors qu'un snapshot pris
    //    ce soir-la ne l'aurait pas contenue. L'ecart reste utile, mais il
    //    n'oppose pas forcement deux photos de meme nature.
    const quelles = [
        (recalc || {}).veille ? 'la veille' : null,
        (recalc || {}).jour ? 'la journée' : null
    ].filter(Boolean);
    if (quelles.length) {
        out.push({ cle: 'recalcule', niveau: 'moyen',
            texte: 'Le PL de ' + quelles.join(' et de ') + ' a été RECALCULÉ à partir des '
                + 'données actuelles. Le stock est bien valorisé aux prix de cette date-là, '
                + 'mais une saisie faite depuis y est incluse.' });
    }

    // 0bis. LE FIGE CONTRE LE RECALCULE. C'est tout l'interet du mode force:
    //       un snapshot peut etre perime - une vente saisie en retard, un
    //       stock corrige - et l'ecart entre les deux chiffre exactement ce
    //       qui a bouge APRES le figeage. Sans cette comparaison, recalculer
    //       par-dessus un PL fige effacerait silencieusement la difference.
    const fige = (recalc || {}).plFige || {};
    [['jour', jour], ['veille', veille]].forEach(([cle, p]) => {
        const avant = fige[cle];
        if (avant === null || avant === undefined) return;
        if (!(recalc || {})[cle === 'jour' ? 'jour' : 'veille']) return;
        const ecart = nb(p.pl) - nb(avant);
        if (Math.abs(ecart) <= TOLERANCE_BOUCLAGE) return;
        out.push({ cle: 'fige_perime_' + cle, niveau: 'fort',
            texte: 'Le PL figé ' + (cle === 'jour' ? 'du jour' : 'de la veille') + ' disait '
                + fmtFr(avant) + ' F, le recalcul en donne ' + fmtFr(p.pl) + ' F : '
                + fmtFr(ecart) + ' F sont entrés APRÈS le figeage (saisie tardive, '
                + 'correction de stock).' });
    });

    // 1. ESTIMATION. Un jour estime compare a un jour compte fait apparaitre
    //    la correction de l'estimation comme si c'etait une vente ou un achat.
    if (sV.soir_estime === true && sJ.soir_estime !== true) {
        out.push({ cle: 'estimation_corrigee', niveau: 'fort',
            texte: 'Le stock du soir de la veille était ESTIMÉ, celui du jour est compté : '
                + "l'écart contient la correction de l'estimation, pas seulement l'activité." });
    } else if (sJ.soir_estime === true && sV.soir_estime !== true) {
        out.push({ cle: 'estimation_en_cours', niveau: 'fort',
            texte: "Le stock du soir du jour est ESTIMÉ, pas compté : l'écart reposera sur "
                + 'cette estimation tant que le comptage n\'est pas saisi.' });
    } else if (sJ.soir_estime === true && sV.soir_estime === true) {
        out.push({ cle: 'estimation_deux_jours', niveau: 'moyen',
            texte: 'Les deux stocks du soir sont estimés : l\'écart compare deux estimations.' });
    }

    // 2. PARAGE. Le coefficient multiplie la variation de stock: le faire
    //    bouger deplace le PL sans qu'aucune marchandise n'ait circule.
    if (round2(sV.coeff) !== round2(sJ.coeff)) {
        out.push({ cle: 'coefficient_change', niveau: 'fort',
            texte: 'Le coefficient de pertes de découpe est passé de ' + round2(sV.coeff)
                + ' à ' + round2(sJ.coeff) + ' : une partie de l\'écart de stock vient de ce '
                + 'changement de taux, pas de la marchandise.' });
    }

    // 3. REVALORISATION. Le drapeau qui evite la mauvaise histoire: attribuer
    //    a une vente ce qui est un changement de prix de la carcasse.
    if (stock && stock.part_revalorisation >= SEUIL_REVALORISATION) {
        out.push({ cle: 'revalorisation', niveau: 'fort',
            texte: Math.round(stock.part_revalorisation * 100) + ' % du mouvement de stock vient '
                + "d'un changement de PRIX et non de quantité (" + fmtFr(stock.revalorisation)
                + ' FCFA) : ce n\'est ni une vente ni un achat.' });
    }

    // 4. BASE DE DEPART CHANGEE. Les deux cumuls partent du 1er du mois et
    //    partagent donc leur stock du matin. Quand il differe, c'est qu'on a
    //    corrige le comptage du 1er APRES avoir fige la veille: les deux
    //    photos ne reposent plus sur la meme base, et l'ecart de la ligne
    //    stock contient cette correction retroactive.
    if (round2(sV.matin_debut) !== round2(sJ.matin_debut)) {
        out.push({ cle: 'base_matin_changee', niveau: 'fort',
            texte: 'Le stock de départ a changé entre les deux photos ('
                + fmtFr(sV.matin_debut) + ' puis ' + fmtFr(sJ.matin_debut)
                + ' FCFA) : le comptage du 1er a été corrigé après le figeage de la veille, '
                + "et l'écart de stock contient cette correction." });
    }

    // 5. STOCK PERIME. La borne du soir peut dater d'avant la date du
    //    snapshot: l'ecart porte alors sur deux photos non adjacentes.
    if (sV.soir_date && sJ.soir_date && sV.soir_date === sJ.soir_date) {
        out.push({ cle: 'soir_identique', niveau: 'fort',
            texte: 'Les deux journées pointent le MÊME stock du soir (' + sJ.soir_date
                + ') : aucun mouvement de stock ne peut être attribué à cette journée.' });
    }

    // 5. AVANCES INDISPONIBLES. Un poste non fiable d'un cote fabrique un
    //    ecart qui n'existe pas.
    const fiable = (p) => {
        const s = (p.sources || {}).avances;
        return !s || s.fiable !== false;
    };
    if (!fiable(veille) || !fiable(jour)) {
        out.push({ cle: 'avances_non_fiables', niveau: 'fort',
            texte: 'Les avances sont indisponibles sur au moins une des deux journées : '
                + "l'écart du poste Avances n'est pas exploitable." });
    }

    return out;
}

/**
 * L'ECART entre deux journees, poste par poste.
 *
 * @param {object} args
 * @param {object} args.veille  payload complet du PL fige a J-1
 * @param {object} args.jour    payload complet du PL fige a J
 * @returns {object} { ok: true, ... } ou { ok: false, raison, message }
 */
function ecartJour(args) {
    const veille = args && args.veille;
    const jour = args && args.jour;

    // ABSENCE. Ne JAMAIS se rabattre en silence sur l'avant-veille en
    // l'appelant "hier": un ecart de deux jours presente comme un ecart d'un
    // jour est un mensonge que rien ne rattrape ensuite.
    if (!jour) {
        return { ok: false, raison: 'snapshot_jour_manquant',
            message: 'Aucun PL figé pour cette date.' };
    }
    if (!veille) {
        return { ok: false, raison: 'snapshot_veille_manquant',
            message: 'Aucun PL figé pour la veille, et son recalcul n\'a pas abouti : '
                + 'rien à comparer.' };
    }

    // MEME POINT DE DEPART. Deux cumuls ne se soustraient que s'ils partent du
    // meme jour. Au 1er du mois, la veille appartient au mois precedent: il
    // n'y a pas d'ecart a calculer, et l'inventer donnerait le PL du mois
    // entier presente comme une journee.
    const debutV = (veille.periode || {}).dateDebut;
    const debutJ = (jour.periode || {}).dateDebut;
    if (debutV && debutJ && debutV !== debutJ) {
        return { ok: false, raison: 'periodes_differentes',
            message: 'Les deux PL ne partent pas du même jour (' + debutV + ' contre '
                + debutJ + ') : ce sont deux cumuls non comparables.' };
    }

    const sV = veille.stock || {}, sJ = jour.stock || {};
    const stock = partagerEcartStock(sV.soir_detail, sJ.soir_detail);

    // LES BORNES, pour que la ligne « Variation de stock » soit auditable.
    //
    //   variation nette = variation BOUCHERIE x coefficient
    //                   + variation HORS BOUCHERIE
    //
    // Et NON `(fin - depart) x coefficient`, qui etait ma premiere ecriture et
    // qui est fausse: le coefficient de pertes de decoupe ne porte que sur la
    // boucherie. L'epicerie ne se pare pas. Sur le 15-08 l'ecart entre les
    // deux formules valait 1 200 F - assez peu pour passer inapercu, assez
    // pour qu'un lecteur qui refait le calcul ne retombe jamais sur ses pieds.
    //
    // On rend donc la variation TELLE QUE LE SERVEUR L'A CALCULEE, plus ses
    // deux composantes, au lieu de la recalculer d'apres une regle approchee.
    stock.bornes = {
        depart: round2(sV.matin_debut),
        depart_date: sV.matin_date || null,
        // Le depart du JOUR est lu separement: s'il differe, les deux cumuls
        // ne reposent plus sur la meme base (voir le drapeau).
        depart_jour: round2(sJ.matin_debut),
        fin_veille: round2(sV.soir_fin),
        fin_veille_date: sV.soir_date || null,
        fin_jour: round2(sJ.soir_fin),
        fin_jour_date: sJ.soir_date || null,
        coeff_veille: round2(sV.coeff),
        coeff_jour: round2(sJ.coeff),
        // La variation TELLE QUE CALCULEE par le serveur, et ses composantes.
        variation_veille: round2(sV.variation_nette),
        variation_jour: round2(sJ.variation_nette),
        boucherie_veille: round2(sV.variation_boucherie),
        boucherie_jour: round2(sJ.variation_boucherie),
        hors_boucherie_veille: round2(sV.variation_hors_boucherie),
        hors_boucherie_jour: round2(sJ.variation_hors_boucherie),
        // LE PONT entre le tableau produit et le poste, terme a terme.
        //
        // Le tableau mesure le stock DU SOIR; le poste mesure la variation
        // DEPUIS LE DEPART, coefficient applique a la seule boucherie. Deux
        // nombres differents, et rien ne le disait: un lecteur qui compare
        // -71 684 a -39 994 conclut que l'un des deux est faux.
        pont: {
            ecart_soir: round2(nb(sJ.soir_fin) - nb(sV.soir_fin)),
            ecart_depart: round2(nb(sJ.matin_debut) - nb(sV.matin_debut)),
            ecart_poste: round2(nb(sJ.variation_nette) - nb(sV.variation_nette))
        }
    };

    let somme = 0;
    const postes = POSTES.map((p) => {
        const vV = p.lire(veille);
        const vJ = p.lire(jour);
        const contribution = p.signe * (vJ - vV);
        somme += contribution;
        return {
            cle: p.cle, libelle: p.libelle, signe: p.signe,
            veille: round2(vV), jour: round2(vJ),
            variation: round2(vJ - vV),
            // La CONTRIBUTION au PL, signe compris. C'est elle qu'on classe:
            // une hausse des depenses de 30 000 pese autant qu'une hausse des
            // ventes de 30 000, et dans l'autre sens.
            contribution: round2(contribution)
        };
    }).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    const ecartPl = nb(jour.pl) - nb(veille.pl);
    const residu = ecartPl - somme;

    return {
        ok: true,
        dates: {
            veille: (veille.periode || {}).dateFin || null,
            jour: (jour.periode || {}).dateFin || null,
            debut: debutJ || null
        },
        pl: { veille: round2(veille.pl), jour: round2(jour.pl), ecart: round2(ecartPl) },
        postes: postes,
        // LE CONTROLE DE BOUCLAGE. La somme des contributions DOIT valoir
        // l'ecart de PL. Quand elle ne le vaut pas, un poste manque a la table
        // POSTES - la formule du PL a change sans que ce module le sache - et
        // le tableau serait alors une explication partielle presentee comme
        // complete. On rend le residu plutot que de le cacher.
        bouclage: {
            somme_contributions: round2(somme),
            ecart_pl: round2(ecartPl),
            residu: round2(residu),
            coherent: Math.abs(residu) <= TOLERANCE_BOUCLAGE
        },
        stock: stock,
        // LE RAPPROCHEMENT ARGENT / MARCHANDISE.
        //
        // Une avance paie de la marchandise. La question qui suit est donc
        // toujours: cet argent est-il devenu du stock, ou a-t-il servi a
        // remplacer ce qui s'est vendu ?
        //
        //   argent sorti (avances + versements fournisseur)
        //   - marchandise entree en stock, AU COUT D'ACHAT
        //   = ce que la journee a consomme, a son cout
        //
        // Les DEPENSES sont tenues hors du rapprochement: une reparation ou du
        // carburant ne deviennent pas du stock, et les y meler ferait porter a
        // la marchandise un decaissement qui ne l'achete pas. Elles sont
        // rendues a cote, pour que le total des sorties reste lisible.
        reconciliation: (function () {
            const contrib = (cle) => nb((postes.find((p) => p.cle === cle) || {}).contribution);
            // Les contributions portent le signe du PL: une avance qui monte
            // vaut -X. On revient au montant sorti.
            const avances = -contrib('avances');
            const paiements = -contrib('paiements');
            const depenses = -contrib('depenses');
            const sorties = avances + paiements;
            return {
                avances: round2(avances),
                paiements: round2(paiements),
                sorties: round2(sorties),
                depenses_hors_marchandise: round2(depenses),
                // La valorisation COMPLETE, prix d'achat quand il existe et
                // prix de vente en repli - la meme que celle du PL. Un produit
                // ecarte faute de prix d'achat manquerait au rapprochement et
                // ferait croire a de la marchandise disparue; on le garde et
                // on SIGNALE sa base.
                stock_veille: stock.valeur_veille,
                stock_jour: stock.valeur_jour,
                entree_stock: round2(nb(stock.valeur_jour) - nb(stock.valeur_veille)),
                consomme: round2(sorties - (nb(stock.valeur_jour) - nb(stock.valeur_veille))),
                // Ce qui, dans ces totaux, repose sur un prix de VENTE faute
                // de prix d'achat connu. Non nul = le rapprochement est
                // approximatif a due concurrence, et l'ecran le souligne.
                dont_prix_vente_veille: stock.hors_achat_veille,
                dont_prix_vente_jour: stock.hors_achat_jour,
                exact: nb(stock.hors_achat_veille) === 0 && nb(stock.hors_achat_jour) === 0
            };
        }()),
        // CE QU'IL Y A DERRIERE LES POSTES, quand la source le permet.
        //
        // Ventes et charges se ventilent depuis le payload lui-meme. Depenses
        // et paiements fournisseur viennent de tables locales datees, que
        // l'appelant fournit. Les AVANCES, elles, n'ont aucun equivalent:
        // MataBanq les rend comme des operations {type, date, montant}, sans
        // dimension produit ni tiers. Leur contrepartie en marchandise se lit
        // sur le stock, jamais sur la ligne d'avances.
        detail: {
            // La ventilation des ventes DOIT sommer a la contribution du
            // poste: les deux viennent de la meme periode. Verifie sur donnees
            // reelles (247 050 F des deux cotes sur le 14-08). Quand elle ne
            // somme pas, une graphie de produit a change entre les deux photos
            // et une ligne s'est dedoublee - l'ecran doit le dire.
            ventes: (function () {
                const v = partagerVentes(veille.volumes, jour.volumes);
                if (v.ventilable === false) return v;
                const attendu = nb((postes.find((x) => x.cle === 'ventes') || {}).contribution);
                v.attendu = round2(attendu);
                v.ecart = round2(v.total_ca - attendu);
                v.complet = Math.abs(v.total_ca - attendu) <= TOLERANCE_BOUCLAGE;
                return v;
            }()),
            charges: partagerCharges(veille.charges, jour.charges),
            depenses: listerEntrees(args.depenses,
                (postes.find((p) => p.cle === 'depenses') || {}).contribution, -1),
            paiements: listerEntrees(args.paiements,
                (postes.find((p) => p.cle === 'paiements') || {}).contribution, -1),
            avances: {
                ventilable: false,
                raison: 'MataBanq rend les avances comme des opérations de caisse '
                    + '(type, date, montant) : aucune ventilation par produit ni par tiers '
                    + "n'existe à la source. La contrepartie en marchandise se lit sur le stock."
            }
        },
        // La veille vient-elle d'un snapshot ou d'un recalcul ? L'ecran en a
        // besoin pour nommer la colonne, et pas seulement pour le drapeau.
        veille_recalculee: !!args.veilleRecalculee,
        jour_recalcule: !!args.jourRecalcule,
        drapeaux: drapeauxDe(veille, jour, stock, {
            veille: !!args.veilleRecalculee, jour: !!args.jourRecalcule,
            plFige: args.plFige || {}
        })
    };
}

/**
 * LE MODE demande, normalise. `auto` par defaut.
 *
 * `recalculer=0/1` est l'ancien parametre, garde parce qu'un lien copie ou un
 * onglet laisse ouvert peut encore le porter: le supprimer aurait fait
 * basculer ces appels sur le defaut sans que personne ne le voie.
 */
function resoudreMode(query) {
    const q = query || {};
    const m = String(q.mode || '').toLowerCase();
    if (['auto', 'force', 'fige'].includes(m)) return m;
    return String(q.recalculer === undefined ? '1' : q.recalculer) === '0' ? 'fige' : 'auto';
}

/**
 * LA FENETRE des lignes entrees dans le cumul entre deux photos: ]veille, jour].
 *
 * La borne basse est le LENDEMAIN de la veille, pas la veille: une depense
 * datee du jour de la veille est deja dans son cumul, et la compter ici la
 * ferait apparaitre deux fois - une fois dans la base, une fois dans la
 * journee. Le decalage d'un jour ne se voit pas a l'oeil sur un total; il se
 * voit sur le controle de somme, sans qu'on sache d'ou il vient.
 */
function fenetreEntrees(veilleISO, jourISO) {
    const lendemain = new Date(new Date(veilleISO + 'T00:00:00Z').getTime() + 86400000)
        .toISOString().slice(0, 10);
    return { debut: lendemain, fin: jourISO };
}

module.exports = {
    ecartJour,
    resoudreMode,
    fenetreEntrees,
    partagerEcartStock,
    POSTES,
    TOLERANCE_BOUCLAGE,
    SEUIL_REVALORISATION
};
