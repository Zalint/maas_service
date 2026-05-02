/**
 * Tests pour les fonctions de validation de données
 */

// Mock des variables globales
global.POINTS_VENTE_PHYSIQUES = ['Mbao', 'O.Foire', 'Linguere', 'Dahra', 'Touba', 'Keur Massar'];
global.PRODUITS = ['Boeuf', 'Veau', 'Agneau', 'Yell', 'Foie'];
global.TOUS_POINTS_VENTE = [...POINTS_VENTE_PHYSIQUES, 'Dépôt central', 'Depot', 'Gros Client'];

// Fonctions de validation
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
      
      if (isNaN(item.total)) {
        return { valid: false, message: `Total invalide pour ${pointVente} - ${produit}` };
      }
      
      // Vérifier la cohérence
      const calculatedTotal = parseFloat((item.quantite * item.prix).toFixed(2));
      const storedTotal = parseFloat(item.total);
      
      if (Math.abs(calculatedTotal - storedTotal) > 0.1) {
        return { 
          valid: false, 
          message: `Total incohérent pour ${pointVente} - ${produit}: calculé ${calculatedTotal}, stocké ${storedTotal}` 
        };
      }
    }
  }
  
  return { valid: true };
}

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
  
  // Vérifier les valeurs numériques
  if (isNaN(transfert.quantite) || transfert.quantite <= 0) {
    return { valid: false, message: `Quantité invalide: doit être un nombre positif` };
  }
  
  if (isNaN(transfert.prix) || transfert.prix <= 0) {
    return { valid: false, message: `Prix invalide: doit être un nombre positif` };
  }
  
  if (isNaN(transfert.total)) {
    return { valid: false, message: `Total invalide: doit être un nombre` };
  }
  
  // Vérifier la cohérence du total
  const calculatedTotal = parseFloat((transfert.quantite * transfert.prix).toFixed(2));
  const storedTotal = parseFloat(transfert.total);
  
  if (Math.abs(calculatedTotal - storedTotal) > 0.1) {
    return { 
      valid: false, 
      message: `Total incohérent: calculé ${calculatedTotal}, stocké ${storedTotal}` 
    };
  }
  
  return { valid: true };
}

// Fonction de validation de date
function validateDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return { valid: false, message: 'La date doit être une chaîne de caractères' };
  }
  
  // Format attendu : jj/mm/aaaa ou jj-mm-aaaa
  const regex1 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const regex2 = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/;
  
  let matches = dateStr.match(regex1) || dateStr.match(regex2);
  
  if (!matches) {
    return { valid: false, message: 'Format de date invalide: utiliser jj/mm/aaaa ou jj-mm-aaaa' };
  }
  
  const day = parseInt(matches[1], 10);
  const month = parseInt(matches[2], 10) - 1; // Les mois commencent à 0 en JS
  let year = parseInt(matches[3], 10);
  
  // Si l'année est à 2 chiffres, ajuster pour le 21e siècle
  if (year < 100) {
    year += 2000;
  }
  
  const date = new Date(year, month, day);
  
  // Vérifier que la date est valide
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return { valid: false, message: 'Date invalide: jour, mois ou année hors limites' };
  }
  
  return { valid: true, date };
}

// Fonction pour échapper le HTML
function escapeHtml(text) {
  if (!text) return '';
  
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  
  return text.toString().replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Tests
describe('Tests des fonctions de validation', () => {
  describe('Validation de stock', () => {
    test('Accepte un stock valide', () => {
      const stock = {
        "Mbao": {
          "Boeuf": { quantite: 42.5, prix: 3600, total: 153000, commentaire: "Stock initial" }
        },
        "O.Foire": {
          "Veau": { quantite: 15, prix: 3800, total: 57000, commentaire: "" }
        }
      };
      
      const result = validateStock(stock);
      expect(result.valid).toBe(true);
    });
    
    test('Rejette un stock qui n\'est pas un objet', () => {
      const result = validateStock("pas un objet");
      expect(result.valid).toBe(false);
      expect(result.message).toContain('doit être un objet');
    });
    
    test('Rejette un point de vente invalide', () => {
      const stock = {
        "PointInvalide": {
          "Boeuf": { quantite: 10, prix: 3600, total: 36000, commentaire: "" }
        }
      };
      
      const result = validateStock(stock);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Point de vente invalide');
    });
    
    test('Rejette un produit invalide', () => {
      const stock = {
        "Mbao": {
          "ProduitInvalide": { quantite: 10, prix: 3600, total: 36000, commentaire: "" }
        }
      };
      
      const result = validateStock(stock);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Produit invalide');
    });
    
    test('Rejette une quantité invalide', () => {
      const stock = {
        "Mbao": {
          "Boeuf": { quantite: -5, prix: 3600, total: -18000, commentaire: "" }
        }
      };
      
      const result = validateStock(stock);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Quantité invalide');
    });
    
    test('Rejette un total incohérent', () => {
      const stock = {
        "Mbao": {
          "Boeuf": { quantite: 10, prix: 3600, total: 40000, commentaire: "" } // devrait être 36000
        }
      };
      
      const result = validateStock(stock);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Total incohérent');
    });
  });
  
  describe('Validation de transfert', () => {
    test('Accepte un transfert valide', () => {
      const transfert = {
        pointVente: "Mbao",
        produit: "Boeuf",
        impact: 1,
        quantite: 10,
        prix: 3600,
        total: 36000,
        commentaire: "Transfert test",
        date: "15/05/2023"
      };
      
      const result = validateTransfert(transfert);
      expect(result.valid).toBe(true);
    });
    
    test('Rejette un transfert sans champs obligatoires', () => {
      const transfert = {
        pointVente: "Mbao",
        produit: "Boeuf",
        // impact manquant
        quantite: 10,
        prix: 3600,
        total: 36000
      };
      
      const result = validateTransfert(transfert);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Champ obligatoire manquant');
    });
    
    test('Rejette un impact invalide', () => {
      const transfert = {
        pointVente: "Mbao",
        produit: "Boeuf",
        impact: 0, // devrait être 1 ou -1
        quantite: 10,
        prix: 3600,
        total: 36000,
        commentaire: ""
      };
      
      const result = validateTransfert(transfert);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Impact invalide');
    });
    
    test('Rejette une quantité négative', () => {
      const transfert = {
        pointVente: "Mbao",
        produit: "Boeuf",
        impact: 1,
        quantite: -10,
        prix: 3600,
        total: -36000,
        commentaire: ""
      };
      
      const result = validateTransfert(transfert);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Quantité invalide');
    });
  });
  
  describe('Validation de date', () => {
    test('Accepte une date au format jj/mm/aaaa', () => {
      const result = validateDate('15/05/2023');
      expect(result.valid).toBe(true);
      expect(result.date).toBeInstanceOf(Date);
      expect(result.date.getDate()).toBe(15);
      expect(result.date.getMonth()).toBe(4); // Mai = 4 (les mois commencent à 0)
      expect(result.date.getFullYear()).toBe(2023);
    });
    
    test('Accepte une date au format jj-mm-aaaa', () => {
      const result = validateDate('15-05-2023');
      expect(result.valid).toBe(true);
    });
    
    test('Accepte une date au format jj-mm-aa', () => {
      const result = validateDate('15-05-23');
      expect(result.valid).toBe(true);
      expect(result.date.getFullYear()).toBe(2023);
    });
    
    test('Rejette une date mal formatée', () => {
      const result = validateDate('2023/05/15');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Format de date invalide');
    });
    
    test('Rejette une date invalide', () => {
      const result = validateDate('31/02/2023'); // Le 31 février n'existe pas
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Date invalide');
    });
  });
  
  describe('Échappement HTML', () => {
    test('Échappe les caractères spéciaux', () => {
      const input = '<script>alert("XSS")</script>';
      const expected = '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;';
      
      expect(escapeHtml(input)).toBe(expected);
    });
    
    test('Gère les valeurs null ou undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });
    
    test('Convertit les nombres en chaînes', () => {
      expect(escapeHtml(123)).toBe('123');
    });
  });
}); 