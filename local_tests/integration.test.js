/**
 * Tests d'intégration pour vérifier l'interopérabilité entre différentes parties du système
 */

// Mock des variables globales
global.POINTS_VENTE_PHYSIQUES = ['Mbao', 'O.Foire', 'Linguere', 'Dahra', 'Touba', 'Keur Massar'];
global.PRODUITS = ['Boeuf', 'Veau', 'Agneau', 'Yell', 'Foie'];
global.PRIX_DEFAUT = {
  'Boeuf': 3600,
  'Veau': 3800,
  'Agneau': 4500,
  'Yell': 2500,
  'Foie': 3400
};
global.TOUS_POINTS_VENTE = [...POINTS_VENTE_PHYSIQUES, 'Dépôt central', 'Depot', 'Gros Client'];

// Mock de fetch
global.fetch = jest.fn();

// Fonctions utilitaires
function calculTotal(quantite, prixUnitaire) {
  return parseFloat(quantite) * parseFloat(prixUnitaire);
}

function formatDate(date) {
  const d = new Date(date);
  const jour = String(d.getDate()).padStart(2, '0');
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const annee = d.getFullYear();
  return `${jour}/${mois}/${annee}`;
}

// Validation des données de stock
function validateStock(stock) {
  if (!stock || typeof stock !== 'object') {
    return { valid: false, message: 'Le stock doit être un objet' };
  }
  
  for (const pointVente in stock) {
    if (!TOUS_POINTS_VENTE.includes(pointVente)) {
      return { valid: false, message: `Point de vente invalide: ${pointVente}` };
    }
    
    if (!stock[pointVente] || typeof stock[pointVente] !== 'object') {
      return { valid: false, message: `Données invalides pour ${pointVente}` };
    }
    
    for (const produit in stock[pointVente]) {
      if (!PRODUITS.includes(produit)) {
        return { valid: false, message: `Produit invalide pour ${pointVente}: ${produit}` };
      }
      
      const item = stock[pointVente][produit];
      
      if (!item || typeof item !== 'object') {
        return { valid: false, message: `Item invalide pour ${pointVente} - ${produit}` };
      }
      
      if (isNaN(item.quantite) || item.quantite < 0) {
        return { valid: false, message: `Quantité invalide pour ${pointVente} - ${produit}` };
      }
      
      if (isNaN(item.prix) || item.prix < 0) {
        return { valid: false, message: `Prix invalide pour ${pointVente} - ${produit}` };
      }
    }
  }
  
  return { valid: true };
}

// Validation d'un transfert
function validateTransfert(transfert) {
  if (!transfert || typeof transfert !== 'object') {
    return { valid: false, message: 'Le transfert doit être un objet' };
  }
  
  // Vérifier les champs obligatoires
  const requiredFields = ['pointVente', 'produit', 'impact', 'quantite', 'prix', 'total'];
  for (const field of requiredFields) {
    if (transfert[field] === undefined || transfert[field] === null || transfert[field] === '') {
      return { valid: false, message: `Champ obligatoire manquant: ${field}` };
    }
  }
  
  // Vérifier le point de vente
  if (!TOUS_POINTS_VENTE.includes(transfert.pointVente)) {
    return { valid: false, message: `Point de vente invalide: ${transfert.pointVente}` };
  }
  
  // Vérifier le produit
  if (!PRODUITS.includes(transfert.produit)) {
    return { valid: false, message: `Produit invalide: ${transfert.produit}` };
  }
  
  // Vérifier l'impact
  if (transfert.impact !== 1 && transfert.impact !== -1) {
    return { valid: false, message: `Impact invalide: doit être 1 ou -1` };
  }
  
  return { valid: true };
}

// Fonctions API
async function chargerStock(type = 'matin', date = null) {
  try {
    let url = `/api/stock/${type}`;
    if (date) {
      url += `?date=${date}`;
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Erreur HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Erreur lors du chargement du stock:', error);
    throw error;
  }
}

async function sauvegarderStock(type, data, date = null) {
  try {
    let url = `/api/stock/${type}`;
    if (date) {
      url += `?date=${date}`;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      throw new Error(`Erreur HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du stock:', error);
    throw error;
  }
}

async function sauvegarderTransfert(transfert) {
  try {
    const response = await fetch('/api/transferts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(transfert)
    });
    
    if (!response.ok) {
      throw new Error(`Erreur HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Erreur lors de la sauvegarde du transfert:', error);
    throw error;
  }
}

// Appliquer un transfert au stock
function appliquerTransfertAuStock(stock, transfert) {
  // Cloner le stock pour ne pas modifier l'original
  const stockMaj = JSON.parse(JSON.stringify(stock));
  
  const { pointVente, produit, impact, quantite, prix } = transfert;
  
  // Vérifier si le point de vente existe déjà dans le stock
  if (!stockMaj[pointVente]) {
    stockMaj[pointVente] = {};
  }
  
  // Vérifier si le produit existe déjà pour ce point de vente
  if (!stockMaj[pointVente][produit]) {
    stockMaj[pointVente][produit] = {
      quantite: 0,
      prix: prix,
      total: 0,
      commentaire: ""
    };
  }
  
  // Mettre à jour la quantité selon l'impact
  const nouvelleQuantite = parseFloat(stockMaj[pointVente][produit].quantite) + (impact * parseFloat(quantite));
  
  // La quantité ne peut pas être négative
  stockMaj[pointVente][produit].quantite = Math.max(0, nouvelleQuantite);
  
  // Mettre à jour le prix si c'est un impact positif
  if (impact > 0) {
    stockMaj[pointVente][produit].prix = prix;
  }
  
  // Recalculer le total
  stockMaj[pointVente][produit].total = calculTotal(
    stockMaj[pointVente][produit].quantite,
    stockMaj[pointVente][produit].prix
  );
  
  return stockMaj;
}

// Tests d'intégration
describe('Tests d\'intégration', () => {
  // Réinitialiser les mocks avant chaque test
  beforeEach(() => {
    fetch.mockClear();
  });
  
  describe('Workflow complet', () => {
    test('Chargement, mise à jour et sauvegarde du stock', async () => {
      // 1. Configurer les mocks pour le chargement initial du stock
      const stockInitial = {
        "Mbao": {
          "Boeuf": { quantite: 42.5, prix: 3600, total: 153000, commentaire: "Stock initial" }
        }
      };
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => stockInitial
      });
      
      // 2. Charger le stock
      const stock = await chargerStock('matin');
      
      // Vérifier que fetch a été appelé correctement
      expect(fetch).toHaveBeenCalledWith('/api/stock/matin');
      expect(stock).toEqual(stockInitial);
      
      // 3. Modifier le stock
      const stockModifie = JSON.parse(JSON.stringify(stock));
      
      // Ajouter un nouveau produit
      if (!stockModifie["Mbao"]["Veau"]) {
        stockModifie["Mbao"]["Veau"] = {
          quantite: 15,
          prix: 3800,
          total: calculTotal(15, 3800),
          commentaire: "Ajout pour test"
        };
      }
      
      // 4. Configurer le mock pour la sauvegarde
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });
      
      // 5. Sauvegarder le stock modifié
      const resultatSauvegarde = await sauvegarderStock('matin', stockModifie);
      
      // Vérifier que fetch a été appelé correctement pour la sauvegarde
      expect(fetch).toHaveBeenCalledWith('/api/stock/matin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(stockModifie)
      });
      
      expect(resultatSauvegarde).toEqual({ success: true });
      
      // 6. Vérifier que le stock est valide
      const validationResult = validateStock(stockModifie);
      expect(validationResult.valid).toBe(true);
    });
    
    test('Création, validation et sauvegarde d\'un transfert', async () => {
      // 1. Créer un transfert
      const transfert = {
        pointVente: "Mbao",
        produit: "Boeuf",
        impact: 1,
        quantite: 10,
        prix: 3600,
        total: calculTotal(10, 3600),
        commentaire: "Transfert de test",
        date: formatDate(new Date())
      };
      
      // 2. Valider le transfert
      const validationResult = validateTransfert(transfert);
      expect(validationResult.valid).toBe(true);
      
      // 3. Configurer le mock pour la sauvegarde
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          success: true, 
          id: "t1234", 
          message: "Transfert enregistré avec succès"
        })
      });
      
      // 4. Sauvegarder le transfert
      const resultatSauvegarde = await sauvegarderTransfert(transfert);
      
      // Vérifier que fetch a été appelé correctement
      expect(fetch).toHaveBeenCalledWith('/api/transferts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(transfert)
      });
      
      expect(resultatSauvegarde).toEqual({ 
        success: true, 
        id: "t1234", 
        message: "Transfert enregistré avec succès"
      });
    });
    
    test('Impact d\'un transfert sur le stock', async () => {
      // 1. Configurer les mocks pour le chargement initial du stock
      const stockInitial = {
        "Mbao": {
          "Boeuf": { quantite: 42.5, prix: 3600, total: 153000, commentaire: "Stock initial" }
        }
      };
      
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => stockInitial
      });
      
      // 2. Charger le stock
      const stock = await chargerStock('matin');
      
      // 3. Créer un transfert pour ajouter du stock
      const transfertPositif = {
        pointVente: "Mbao",
        produit: "Boeuf",
        impact: 1,
        quantite: 10,
        prix: 3800, // Nouveau prix
        total: calculTotal(10, 3800),
        commentaire: "Ajout de stock",
        date: formatDate(new Date())
      };
      
      // 4. Appliquer le transfert au stock
      const stockApresTransfert = appliquerTransfertAuStock(stock, transfertPositif);
      
      // 5. Vérifier que le stock a été correctement mis à jour
      expect(stockApresTransfert["Mbao"]["Boeuf"].quantite).toBe(52.5); // 42.5 + 10
      expect(stockApresTransfert["Mbao"]["Boeuf"].prix).toBe(3800); // Nouveau prix
      expect(stockApresTransfert["Mbao"]["Boeuf"].total).toBe(52.5 * 3800); // Nouveau total
      
      // 6. Créer un transfert pour retirer du stock
      const transfertNegatif = {
        pointVente: "Mbao",
        produit: "Boeuf",
        impact: -1,
        quantite: 5,
        prix: 3800,
        total: calculTotal(5, 3800),
        commentaire: "Retrait de stock",
        date: formatDate(new Date())
      };
      
      // 7. Appliquer le second transfert
      const stockFinal = appliquerTransfertAuStock(stockApresTransfert, transfertNegatif);
      
      // 8. Vérifier que le stock a été correctement mis à jour
      expect(stockFinal["Mbao"]["Boeuf"].quantite).toBe(47.5); // 52.5 - 5
      expect(stockFinal["Mbao"]["Boeuf"].prix).toBe(3800); // Prix inchangé avec impact négatif
      expect(stockFinal["Mbao"]["Boeuf"].total).toBe(47.5 * 3800); // Nouveau total
      
      // 9. Configurer le mock pour la sauvegarde
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });
      
      // 10. Sauvegarder le stock final
      const resultatSauvegarde = await sauvegarderStock('matin', stockFinal);
      
      // Vérifier que fetch a été appelé correctement
      expect(fetch).toHaveBeenCalledWith('/api/stock/matin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(stockFinal)
      });
      
      expect(resultatSauvegarde).toEqual({ success: true });
    });
  });
  
  describe('Validation et calcul', () => {
    test('Validation de stock avec différents formats', () => {
      // Stock valide standard
      const stockValide = {
        "Mbao": {
          "Boeuf": { quantite: 42.5, prix: 3600, total: 153000, commentaire: "Stock valide" }
        }
      };
      expect(validateStock(stockValide).valid).toBe(true);
      
      // Stock avec des valeurs numériques sous forme de chaînes
      const stockChainesNumeriques = {
        "Mbao": {
          "Boeuf": { quantite: "42.5", prix: "3600", total: "153000", commentaire: "Stock en chaînes" }
        }
      };
      expect(validateStock(stockChainesNumeriques).valid).toBe(true);
      
      // Stock avec un point de vente invalide
      const stockPointInvalide = {
        "InvalidPDV": {
          "Boeuf": { quantite: 42.5, prix: 3600, total: 153000, commentaire: "Point de vente invalide" }
        }
      };
      expect(validateStock(stockPointInvalide).valid).toBe(false);
      
      // Stock avec un produit invalide
      const stockProduitInvalide = {
        "Mbao": {
          "InvalidProduct": { quantite: 42.5, prix: 3600, total: 153000, commentaire: "Produit invalide" }
        }
      };
      expect(validateStock(stockProduitInvalide).valid).toBe(false);
    });
    
    test('Calcul correct des totaux lors de l\'application des transferts', () => {
      // Stock initial
      const stockInitial = {
        "Mbao": {
          "Boeuf": { quantite: 40, prix: 3600, total: 144000, commentaire: "" }
        }
      };
      
      // Transfert positif
      const transfertPositif = {
        pointVente: "Mbao",
        produit: "Boeuf",
        impact: 1,
        quantite: 5,
        prix: 3600,
        total: 18000
      };
      
      // Appliquer le transfert
      const stockResultat = appliquerTransfertAuStock(stockInitial, transfertPositif);
      
      // Vérifier les calculs
      expect(stockResultat["Mbao"]["Boeuf"].quantite).toBe(45);
      expect(stockResultat["Mbao"]["Boeuf"].total).toBe(45 * 3600);
      
      // Transfert négatif qui devrait mettre la quantité à zéro (pas négatif)
      const transfertExcessif = {
        pointVente: "Mbao",
        produit: "Boeuf",
        impact: -1,
        quantite: 50, // Plus que la quantité disponible
        prix: 3600,
        total: 180000
      };
      
      // Appliquer le transfert excessif
      const stockFinal = appliquerTransfertAuStock(stockResultat, transfertExcessif);
      
      // Vérifier que la quantité ne descend pas en dessous de zéro
      expect(stockFinal["Mbao"]["Boeuf"].quantite).toBe(0);
      expect(stockFinal["Mbao"]["Boeuf"].total).toBe(0);
    });
    
    test('Création d\'un nouveau produit dans le stock via un transfert', () => {
      // Stock initial sans Agneau
      const stockInitial = {
        "Mbao": {
          "Boeuf": { quantite: 40, prix: 3600, total: 144000, commentaire: "" }
        }
      };
      
      // Transfert pour un nouveau produit
      const transfertNouveauProduit = {
        pointVente: "Mbao",
        produit: "Agneau",
        impact: 1,
        quantite: 8,
        prix: 4500,
        total: 36000
      };
      
      // Appliquer le transfert
      const stockResultat = appliquerTransfertAuStock(stockInitial, transfertNouveauProduit);
      
      // Vérifier que le nouveau produit a été ajouté
      expect(stockResultat["Mbao"]["Agneau"]).toBeDefined();
      expect(stockResultat["Mbao"]["Agneau"].quantite).toBe(8);
      expect(stockResultat["Mbao"]["Agneau"].prix).toBe(4500);
      expect(stockResultat["Mbao"]["Agneau"].total).toBe(8 * 4500);
    });
    
    test('Création d\'un nouveau point de vente via un transfert', () => {
      // Stock initial sans Linguere
      const stockInitial = {
        "Mbao": {
          "Boeuf": { quantite: 40, prix: 3600, total: 144000, commentaire: "" }
        }
      };
      
      // Transfert pour un nouveau point de vente
      const transfertNouveauPoint = {
        pointVente: "Linguere",
        produit: "Boeuf",
        impact: 1,
        quantite: 10,
        prix: 3700,
        total: 37000
      };
      
      // Appliquer le transfert
      const stockResultat = appliquerTransfertAuStock(stockInitial, transfertNouveauPoint);
      
      // Vérifier que le nouveau point de vente a été ajouté
      expect(stockResultat["Linguere"]).toBeDefined();
      expect(stockResultat["Linguere"]["Boeuf"]).toBeDefined();
      expect(stockResultat["Linguere"]["Boeuf"].quantite).toBe(10);
      expect(stockResultat["Linguere"]["Boeuf"].prix).toBe(3700);
      expect(stockResultat["Linguere"]["Boeuf"].total).toBe(10 * 3700);
    });
  });
});