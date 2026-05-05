const { Vente, Stock, Transfert, Produit } = require('./models');
const { sequelize } = require('./index');
const { Op } = require('sequelize');

/**
 * Fonctions utilitaires pour les opérations de base de données courantes
 */

// Formatter la date au format DD-MM-YYYY
function formatDate(date) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// Parser une date au format DD-MM-YYYY
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  let jour, mois, annee;
  
  if (dateStr.includes('/')) {
    // Format DD/MM/YYYY
    [jour, mois, annee] = dateStr.split('/');
  } else if (dateStr.includes('-')) {
    // Format DD-MM-YYYY
    [jour, mois, annee] = dateStr.split('-');
  } else {
    return null;
  }
  
  // S'assurer que l'année est au format 4 chiffres
  if (annee.length === 2) {
    annee = '20' + annee;
  }
  
  return new Date(annee, mois - 1, jour);
}

// Récupérer les ventes pour une période donnée
async function getVentesByPeriod(startDate, endDate, pointVente = null) {
  try {
    const whereConditions = {};
    
    if (startDate || endDate) {
      whereConditions.date = {};
      
      if (startDate) {
        const formattedStartDate = formatDate(startDate);
        whereConditions.date[Op.gte] = formattedStartDate;
      }
      
      if (endDate) {
        const formattedEndDate = formatDate(endDate);
        whereConditions.date[Op.lte] = formattedEndDate;
      }
    }
    
    if (pointVente && pointVente !== 'tous') {
      whereConditions.pointVente = pointVente;
    }
    
    const ventes = await Vente.findAll({
      where: whereConditions,
      order: [['date', 'DESC']]
    });
    
    return ventes;
  } catch (error) {
    console.error('Erreur lors de la récupération des ventes:', error);
    throw error;
  }
}

// Récupérer les ventes pour une date spécifique
async function getVentesByDate(date, pointVente = null) {
  try {
    const formattedDate = formatDate(date);
    const whereConditions = { date: formattedDate };
    
    if (pointVente && pointVente !== 'tous') {
      whereConditions.pointVente = pointVente;
    }
    
    const ventes = await Vente.findAll({
      where: whereConditions
    });
    
    return ventes;
  } catch (error) {
    console.error('Erreur lors de la récupération des ventes par date:', error);
    throw error;
  }
}

// Récupérer les informations de stock pour une date
async function getStockByDate(date, typeStock, pointVente = null) {
  try {
    const formattedDate = formatDate(date);
    const whereConditions = { 
      date: formattedDate,
      typeStock
    };
    
    if (pointVente && pointVente !== 'tous') {
      whereConditions.pointVente = pointVente;
    }
    
    const stock = await Stock.findAll({
      where: whereConditions
    });
    
    return stock;
  } catch (error) {
    console.error('Erreur lors de la récupération du stock:', error);
    throw error;
  }
}

// Récupérer les transferts pour une date
async function getTransfertsByDate(date, pointVente = null) {
  try {
    const formattedDate = formatDate(date);
    const whereConditions = { date: formattedDate };
    
    if (pointVente && pointVente !== 'tous') {
      whereConditions.pointVente = pointVente;
    }
    
    const transferts = await Transfert.findAll({
      where: whereConditions
    });
    
    return transferts;
  } catch (error) {
    console.error('Erreur lors de la récupération des transferts:', error);
    throw error;
  }
}

// Calculer les statistiques de ventes par catégorie
async function getStatsByCategoryAndPeriod(startDate, endDate, pointVente = null) {
  try {
    const ventes = await getVentesByPeriod(startDate, endDate, pointVente);
    
    // Grouper par catégorie
    const statsByCategory = {};
    
    ventes.forEach(vente => {
      if (!statsByCategory[vente.categorie]) {
        statsByCategory[vente.categorie] = {
          total: 0,
          count: 0
        };
      }
      
      statsByCategory[vente.categorie].total += parseFloat(vente.montant);
      statsByCategory[vente.categorie].count += parseFloat(vente.nombre);
    });
    
    return statsByCategory;
  } catch (error) {
    console.error('Erreur lors du calcul des statistiques par catégorie:', error);
    throw error;
  }
}

// Sauvegarder les données de stock
async function saveStock(stockData, typeStock, date) {
  try {
    const formattedDate = formatDate(date);
    
    // Supprimer les anciens enregistrements pour cette date et ce type
    await Stock.destroy({
      where: {
        date: formattedDate,
        typeStock
      }
    });
    
    // Préparer les nouveaux enregistrements
    const stockEntries = Object.entries(stockData).flatMap(([pointVente, produits]) => {
      return Object.entries(produits).map(([produit, data]) => ({
        date: formattedDate,
        typeStock,
        pointVente,
        produit,
        quantite: parseFloat(data.quantite) || 0,
        prixUnitaire: parseFloat(data.prixUnitaire) || 0,
        total: parseFloat(data.total) || 0,
        commentaire: data.commentaire || ''
      }));
    });
    
    // Sauvegarder les nouveaux enregistrements
    if (stockEntries.length > 0) {
      await Stock.bulkCreate(stockEntries);
    }
    
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du stock:', error);
    throw error;
  }
}

// Sauvegarder les transferts
async function saveTransferts(transferts) {
  try {
    if (!Array.isArray(transferts) || transferts.length === 0) {
      return false;
    }
    
    // Regrouper les transferts par date
    const transfertsByDate = {};
    
    transferts.forEach(transfert => {
      if (!transfert.date) {
        throw new Error('Date manquante pour un transfert');
      }
      
      const formattedDate = formatDate(parseDate(transfert.date));
      
      if (!transfertsByDate[formattedDate]) {
        transfertsByDate[formattedDate] = [];
      }
      
      transfertsByDate[formattedDate].push(transfert);
    });
    
    // Pour chaque date, supprimer les anciens transferts et ajouter les nouveaux.
    // Wrap dans une transaction par date: si bulkCreate echoue apres destroy,
    // on rollback pour eviter une perte de donnees.
    for (const [date, dateTransferts] of Object.entries(transfertsByDate)) {
      const transfertsToSave = dateTransferts.map(t => ({
        date,
        pointVente: t.pointVente,
        produit: t.produit,
        quantite: parseFloat(t.quantite) || 0,
        prixUnitaire: parseFloat(t.prixUnitaire) || 0,
        total: parseFloat(t.total) || 0,
        impact: t.impact || '',
        commentaire: t.commentaire || '',
        extension: t.extension || null
      }));

      await sequelize.transaction(async (t) => {
        await Transfert.destroy({ where: { date }, transaction: t });
        if (transfertsToSave.length > 0) {
          await Transfert.bulkCreate(transfertsToSave, { transaction: t });
        }
      });
    }

    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des transferts:', error);
    throw error;
  }
}

/**
 * Calcule (sans persister) les valeurs stock soir attendues pour les produits
 * en mode_stock = 'automatique' a une date donnee.
 *
 * Sortie: Map keyed par `${pointVente}|${produit}` -> quantite calculee.
 * Set keyed par nom de produit auto.
 *
 * Utilise par recomputeStockSoirForAuto (qui persiste) et par POST stock/soir
 * (qui classifie chaque ligne saisie en auto vs override sans ecraser).
 */
async function computeStockSoirAutoValues(dateInput) {
  const parsed = parseDate(dateInput);
  if (!parsed || isNaN(parsed.getTime())) {
    throw new Error(`Date invalide pour computeStockSoirAutoValues: "${dateInput}"`);
  }
  const dateBdd = formatDate(parsed);

  const autoProduits = await Produit.findAll({
    where: { mode_stock: 'automatique', type_catalogue: 'inventaire' },
    attributes: ['nom', 'prix_defaut']
  });
  const autoSet = new Set(autoProduits.map((p) => p.nom));
  const prixByProduit = new Map(
    autoProduits.map((p) => [p.nom, parseFloat(p.prix_defaut) || 0])
  );

  if (autoSet.size === 0) {
    return { dateBdd, autoSet, prixByProduit, calcByKey: new Map() };
  }

  const [allMatin, allTransferts, allVentes] = await Promise.all([
    Stock.findAll({ where: { date: dateBdd, typeStock: 'matin' } }),
    Transfert.findAll({ where: { date: dateBdd } }),
    Vente.findAll({ where: { date: dateBdd } })
  ]);

  const aggregate = new Map();
  const ensure = (key) => {
    if (!aggregate.has(key)) aggregate.set(key, { matin: 0, transferts: 0, ventes: 0 });
    return aggregate.get(key);
  };
  for (const m of allMatin) {
    if (!autoSet.has(m.produit)) continue;
    ensure(`${m.pointVente}|${m.produit}`).matin = parseFloat(m.quantite) || 0;
  }
  for (const t of allTransferts) {
    if (!autoSet.has(t.produit)) continue;
    const impact = parseInt(t.impact, 10);
    const signedQte = (Number.isFinite(impact) ? impact : 1) * (parseFloat(t.quantite) || 0);
    ensure(`${t.pointVente}|${t.produit}`).transferts += signedQte;
  }
  for (const v of allVentes) {
    if (!autoSet.has(v.produit)) continue;
    ensure(`${v.pointVente}|${v.produit}`).ventes += parseFloat(v.nombre) || 0;
  }

  const calcByKey = new Map();
  for (const [key, agg] of aggregate) {
    calcByKey.set(key, agg.matin + agg.transferts - agg.ventes);
  }
  return { dateBdd, autoSet, prixByProduit, calcByKey };
}

/**
 * Recalcule le stock soir derive automatiquement pour tous les produits dont
 * mode_stock = 'automatique'. La formule est:
 *
 *     stock_soir(PV, produit) = stock_matin(PV, produit)
 *                             + Σ transferts.signed(PV, produit)
 *                             - Σ ventes.nombre(PV, produit)
 *
 * Pour chaque (point de vente, produit) auto:
 *   - Si aucune ligne stock soir n'existe: cree avec is_auto_calculated=TRUE.
 *   - Si une ligne existe avec is_auto_calculated=TRUE: met a jour la quantite.
 *   - Si une ligne existe avec is_auto_calculated=FALSE (override utilisateur):
 *     ne touche rien.
 *
 * Idempotent: relancer plusieurs fois donne le meme resultat tant que les
 * ventes/transferts/stock matin ne changent pas.
 *
 * @param {string} dateInput - date au format DD/MM/YYYY ou DD-MM-YYYY ou similaire.
 * @returns {Promise<{updated: number, created: number, skippedOverride: number}>}
 */
async function recomputeStockSoirForAuto(dateInput) {
  const { dateBdd, calcByKey, prixByProduit } = await computeStockSoirAutoValues(dateInput);
  if (calcByKey.size === 0) {
    return { updated: 0, created: 0, skippedOverride: 0 };
  }

  // Toutes les ecritures (lock + update + create) se font dans une seule
  // transaction pour eviter qu'un POST /api/ventes parallele ne lise un
  // etat partiel et duplique des lignes ou perdle des updates.
  return await sequelize.transaction(async (t) => {
    // Lock-on-read pour serialiser les recomputes concurrents sur le meme
    // (date, soir). LOCK.UPDATE empeche un autre tx de toucher ces lignes
    // jusqu'au commit/rollback de celle-ci.
    const allSoir = await Stock.findAll({
      where: { date: dateBdd, typeStock: 'soir' },
      lock: t.LOCK.UPDATE,
      transaction: t
    });
    const soirByKey = new Map();
    for (const s of allSoir) {
      soirByKey.set(`${s.pointVente}|${s.produit}`, s);
    }

    let updated = 0;
    let created = 0;
    let skippedOverride = 0;

    for (const [key, calc] of calcByKey) {
      const [pv, produit] = key.split('|');

      const existing = soirByKey.get(key);
      if (existing && existing.is_auto_calculated === false) {
        skippedOverride++;
        continue; // override utilisateur: respecter
      }

      const prixUnitaire = existing
        ? parseFloat(existing.prixUnitaire) || prixByProduit.get(produit) || 0
        : (prixByProduit.get(produit) || 0);
      const total = calc * prixUnitaire;

      if (existing) {
        await existing.update({
          quantite: calc,
          prixUnitaire,
          total,
          is_auto_calculated: true
        }, { transaction: t });
        updated++;
      } else {
        await Stock.create({
          date: dateBdd,
          typeStock: 'soir',
          pointVente: pv,
          produit,
          quantite: calc,
          prixUnitaire,
          total,
          commentaire: '',
          is_auto_calculated: true
        }, { transaction: t });
        created++;
      }
    }

    return { updated, created, skippedOverride };
  });
}

module.exports = {
  formatDate,
  parseDate,
  getVentesByPeriod,
  getVentesByDate,
  getStockByDate,
  getTransfertsByDate,
  getStatsByCategoryAndPeriod,
  saveStock,
  saveTransferts,
  computeStockSoirAutoValues,
  recomputeStockSoirForAuto
};
