/**
 * LE CASH THEORIQUE DU MOIS.
 *
 * Cash et Stock rend une VALEUR a une date: un niveau, stock compris. Ce
 * module repond a une autre question, celle de la tresorerie: en partant de la
 * caisse a la fin du mois dernier, et en suivant tout ce qui est entre et
 * sorti depuis, combien devrait-il y avoir en caisse aujourd'hui ?
 *
 *   caisse au dernier jour renseigne du mois precedent
 * + ventes du mois (hors creances: une vente a credit n'entre pas en caisse)
 * - depenses
 * - paiements faits au fournisseur
 * - remboursements de creance partenaire
 * - depots Mata QUE L'ON NE RETROUVE PAS dans les remboursements
 *
 * La derniere ligne est la seule delicate. L'argent depose chez Mata sort de
 * la caisse, et il revient presque toujours cote partenaire sous forme de
 * remboursement - le soustraire deux fois creuserait un trou qui n'existe pas.
 * Mesure sur aout 2026 a Mbao: les huit depots apparies le sont TOUS au
 * lendemain, jamais le jour meme.
 *
 * Module PUR: aucune requete, aucune date systeme. Il recoit des listes deja
 * lues et rend le detail. Meme partage que lib/pl-ecart-jour.js.
 */

function nb(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

function round2(v) {
    return Math.round(nb(v) * 100) / 100;
}

// Un montant lisible DANS une phrase. « 350000 F » se lit mal au milieu d'un
// commentaire que l'exploitant parcourt vite; les groupes de trois chiffres
// evitent de compter les zeros. Locale figee: le rendu ne doit pas dependre
// de la machine qui execute, sinon les tests le seraient aussi.
function fmtF(v) {
    return nb(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' FCFA';
}

function jourDecale(iso, n) {
    const t = Date.parse(String(iso) + 'T00:00:00Z');
    if (!Number.isFinite(t)) return null;
    return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

/**
 * Retrouver chaque depot Mata parmi les remboursements de creance.
 *
 * REGLE: meme montant EXACT, a plus ou moins `tolerance` jour(s). L'ordre
 * d'essai suit ce que disent les donnees - le lendemain d'abord, puis le jour
 * meme, puis la veille - et chaque remboursement n'est consomme qu'une fois,
 * sinon deux depots identiques s'apparieraient au meme versement.
 *
 * LIMITE ASSUMEE, et rendue visible: les montants ronds se repetent beaucoup
 * (200 000 revient cinq fois en aout). Quand plusieurs remboursements du meme
 * montant tombent dans la fenetre, le choix est arbitraire; `ambigu` le dit,
 * pour qu'un rapprochement de hasard ne se lise pas comme un fait etabli.
 *
 * @param {Array<{date: string, montant: number}>} depots
 * @param {Array<{date: string, montant: number}>} remboursements
 * @param {number} [tolerance=1]
 */
function apparierDepots(depots, remboursements, tolerance) {
    const tol = Number.isFinite(tolerance) ? Math.max(0, Math.trunc(tolerance)) : 1;
    // Le lendemain en premier: c'est le decalage observe. Puis le jour meme,
    // puis en remontant. Un ordre different changerait qui prend quoi.
    const deltas = [];
    for (let d = 1; d <= tol; d++) deltas.push(d);
    deltas.push(0);
    for (let d = 1; d <= tol; d++) deltas.push(-d);

    const dispo = (remboursements || []).map((r, i) => ({
        i: i,
        date: String(r.date || '').slice(0, 10),
        montant: round2(r.montant),
        pris: false
    }));

    const appariements = (depots || []).map((dep) => {
        const date = String(dep.date || '').slice(0, 10);
        const montant = round2(dep.montant);
        // Compter TOUS les candidats de la fenetre avant d'en prendre un:
        // c'est ce comptage qui dit si le choix etait force ou arbitraire.
        const fenetre = deltas.map((d) => jourDecale(date, d)).filter(Boolean);
        const candidats = dispo.filter(
            (r) => !r.pris && r.montant === montant && fenetre.indexOf(r.date) >= 0
        );
        let choisi = null;
        for (const d of deltas) {
            const cible = jourDecale(date, d);
            const c = candidats.find((r) => !r.pris && r.date === cible);
            if (c) { c.pris = true; choisi = { delta: d, date: c.date }; break; }
        }
        // ORPHELIN PAR CONTENTION, a distinguer de l'orphelin franc.
        //
        // Le depot du 11/08 (200 000) n'a pas echoue faute de versement: le
        // remboursement de 200 000 du 11/08 avait deja ete pris par le depot
        // de la veille, qui le visait aussi a J+1. Rendre les deux cas
        // identiques ferait passer un conflit d'attribution pour une absence,
        // et le montant serait soustrait sans que rien ne le signale.
        const dispute = !choisi && dispo.some(
            (r) => r.pris && r.montant === montant && fenetre.indexOf(r.date) >= 0
        );
        return {
            date: date,
            montant: montant,
            apparie: !!choisi,
            decalage: choisi ? choisi.delta : null,
            date_remboursement: choisi ? choisi.date : null,
            // Plusieurs versements libres du meme montant dans la fenetre: le
            // choix etait arbitraire.
            ambigu: candidats.length > 1,
            dispute: dispute
        };
    });

    const nonApparies = appariements.filter((a) => !a.apparie);
    return {
        appariements: appariements,
        nb_apparies: appariements.length - nonApparies.length,
        nb_ambigus: appariements.filter((a) => a.apparie && a.ambigu).length,
        nb_disputes: nonApparies.filter((a) => a.dispute).length,
        depots_non_apparies: nonApparies,
        total_non_apparie: round2(nonApparies.reduce((s, a) => s + a.montant, 0)),
        total_depots: round2(appariements.reduce((s, a) => s + a.montant, 0)),
        // Un remboursement sans depot en face n'est pas une anomalie: tout ne
        // passe pas par la caisse (virement, versement direct). On le compte
        // pour que l'ecran puisse le dire plutot que de laisser croire a un
        // rapprochement complet.
        nb_remboursements_sans_depot: dispo.filter((r) => !r.pris).length,
        tolerance_jours: tol
    };
}

/**
 * @param {object} a
 * @param {number} a.cashDepart          caisse a la fin du mois precedent
 * @param {string} a.cashDepartDate      date reellement utilisee (peut ne pas
 *                                       etre le dernier jour du mois)
 * @param {number} a.ventes              ventes du mois, creances EXCLUES
 * @param {number} a.ventesCreance       ventes a credit, pour le drapeau
 * @param {number} a.nbVentesCreance
 * @param {number} a.depenses
 * @param {number} a.paiementsFournisseur
 * @param {number} a.remboursements
 * @param {Array}  a.depots              [{date, montant}]
 * @param {Array}  a.operationsRemboursement [{date, montant}]
 * @param {number} [a.toleranceJours=1]
 */
function construireCashTheorique(a) {
    const args = a || {};
    const rapprochement = apparierDepots(
        args.depots || [],
        args.operationsRemboursement || [],
        args.toleranceJours
    );
    const depotsEnPlus = rapprochement.total_non_apparie;

    const cashDepart = round2(args.cashDepart);
    const ventes = round2(args.ventes);
    const depenses = round2(args.depenses);
    const paiements = round2(args.paiementsFournisseur);
    const remboursements = round2(args.remboursements);

    const total = round2(
        cashDepart + ventes - depenses - paiements - remboursements - depotsEnPlus
    );

    // Le commentaire dit QUELLE branche a ete prise et POURQUOI, parce que la
    // difference entre les deux se chiffre en centaines de milliers de francs
    // et qu'un lecteur ne peut pas la deviner du total seul.
    //
    // ACCENTS: les commentaires de code de ce depot n'en portent pas, mais ces
    // chaines-ci sont LUES PAR L'EXPLOITANT, au milieu d'un ecran entierement
    // accentue. La convention vaut pour le code, pas pour ce qui s'affiche.
    let commentaire;
    if (!rapprochement.appariements.length) {
        commentaire = 'Aucun dépôt Mata sur la période : rien à rapprocher.';
    } else if (depotsEnPlus === 0) {
        commentaire = 'Les ' + rapprochement.nb_apparies + ' dépôts Mata de la période se '
            + 'retrouvent tous dans les remboursements de créance : ils ne sont PAS soustraits '
            + 'une seconde fois.';
    } else {
        commentaire = rapprochement.depots_non_apparies.length + ' dépôt(s) Mata sur '
            + rapprochement.appariements.length + ' n’ont aucun remboursement du même '
            + 'montant à ±' + rapprochement.tolerance_jours
            + ' jour : ils sont soustraits en plus, pour ' + fmtF(depotsEnPlus) + '.';
        if (rapprochement.nb_disputes) {
            commentaire += ' Dont ' + rapprochement.nb_disputes + ' dont le versement '
                + 'correspondant existait mais avait déjà été attribué à un autre dépôt '
                + 'du même montant : ce montant est peut-être soustrait à tort.';
        }
    }

    return {
        lignes: [
            { cle: 'depart', libelle: 'Caisse au ' + (args.cashDepartDate || '?'),
                montant: cashDepart, signe: 1 },
            { cle: 'ventes', libelle: 'Ventes du mois (hors créances)',
                montant: ventes, signe: 1 },
            { cle: 'depenses', libelle: 'Dépenses', montant: depenses, signe: -1 },
            { cle: 'paiements', libelle: 'Paiements fournisseur', montant: paiements, signe: -1 },
            { cle: 'remboursements', libelle: 'Remboursements de créance partenaire',
                montant: remboursements, signe: -1 },
            { cle: 'depots', libelle: 'Dépôts Mata non retrouvés dans les remboursements',
                montant: depotsEnPlus, signe: -1 }
        ],
        total: total,
        commentaire: commentaire,
        rapprochement: rapprochement,
        creances: {
            montant: round2(args.ventesCreance),
            nb: Math.trunc(nb(args.nbVentesCreance))
        }
    };
}

module.exports = { apparierDepots, construireCashTheorique };
