const { Vente, Stock, Transfert } = require('./models');
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
    
    // Pour chaque date, supprimer les anciens transferts et ajouter les nouveaux
    for (const [date, dateTransferts] of Object.entries(transfertsByDate)) {
      // Supprimer les anciens transferts pour cette date
      await Transfert.destroy({
        where: { date }
      });
      
      // Préparer les nouveaux transferts
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
      
      // Sauvegarder les nouveaux transferts
      await Transfert.bulkCreate(transfertsToSave);
    }
    
    return true;
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des transferts:', error);
    throw error;
  }
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
  saveTransferts
}; 