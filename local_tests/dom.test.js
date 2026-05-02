/**
 * Tests for DOM manipulations
 */

// Mock global variables
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

// Setup du DOM pour les tests
document.body.innerHTML = `
  <div id="stock-inventaire-section">
    <select id="type-stock">
      <option value="matin">Stock Matin</option>
      <option value="soir">Stock Soir</option>
    </select>
    <table id="stock-table">
      <thead>
        <tr>
          <th>Point de Vente</th>
          <th>Produit</th>
          <th>Quantité</th>
          <th>Prix Unitaire</th>
          <th>Total</th>
          <th>Commentaire</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <button id="add-stock-row">Ajouter une ligne</button>
  </div>
  <div id="transfert-section">
    <table id="transfertTable">
      <thead>
        <tr>
          <th>Point de Vente</th>
          <th>Produit</th>
          <th>Impact (+/-)</th>
          <th>Quantité</th>
          <th>Prix Unitaire</th>
          <th>Total</th>
          <th>Commentaire</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <button id="ajouterLigne">Ajouter une ligne</button>
  </div>
`;

// Fonction utilitaire pour le calcul
function calculTotal(quantite, prixUnitaire) {
  return parseFloat(quantite) * parseFloat(prixUnitaire);
}

// Fonction d'ajout de ligne de stock
function ajouterLigneStock() {
  const tbody = document.querySelector('#stock-table tbody');
  const rowIndex = tbody.rows.length;
  
  const newRow = document.createElement('tr');
  newRow.dataset.index = rowIndex;
  
  // Créer la cellule du point de vente
  const cellPointVente = document.createElement('td');
  const selectPointVente = document.createElement('select');
  selectPointVente.className = 'point-vente form-control';
  selectPointVente.required = true;
  
  // Option vide par défaut
  const optionVide = document.createElement('option');
  optionVide.value = '';
  optionVide.textContent = 'Choisir...';
  selectPointVente.appendChild(optionVide);
  
  // Ajouter les options des points de vente
  TOUS_POINTS_VENTE.forEach(point => {
    const option = document.createElement('option');
    option.value = point;
    option.textContent = point;
    selectPointVente.appendChild(option);
  });
  
  cellPointVente.appendChild(selectPointVente);
  newRow.appendChild(cellPointVente);
  
  // Créer la cellule du produit
  const cellProduit = document.createElement('td');
  const selectProduit = document.createElement('select');
  selectProduit.className = 'produit form-control';
  selectProduit.required = true;
  
  // Option vide par défaut
  const optionVideProduit = document.createElement('option');
  optionVideProduit.value = '';
  optionVideProduit.textContent = 'Choisir...';
  selectProduit.appendChild(optionVideProduit);
  
  // Ajouter les options des produits
  PRODUITS.forEach(produit => {
    const option = document.createElement('option');
    option.value = produit;
    option.textContent = produit;
    selectProduit.appendChild(option);
  });
  
  selectProduit.addEventListener('change', function() {
    const produit = this.value;
    const prixInput = this.closest('tr').querySelector('.prix-unitaire');
    if (produit && PRIX_DEFAUT[produit]) {
      prixInput.value = PRIX_DEFAUT[produit];
      // Déclencher l'événement de calcul du total
      const quantiteInput = this.closest('tr').querySelector('.quantite');
      if (quantiteInput.value) {
        const total = calculTotal(quantiteInput.value, prixInput.value);
        this.closest('tr').querySelector('.total').value = total;
      }
    }
  });
  
  cellProduit.appendChild(selectProduit);
  newRow.appendChild(cellProduit);
  
  // Créer la cellule de quantité
  const cellQuantite = document.createElement('td');
  const inputQuantite = document.createElement('input');
  inputQuantite.type = 'number';
  inputQuantite.min = '0';
  inputQuantite.step = '0.001';
  inputQuantite.className = 'quantite form-control';
  inputQuantite.required = true;
  
  inputQuantite.addEventListener('input', function() {
    const quantite = this.value;
    const prixInput = this.closest('tr').querySelector('.prix-unitaire');
    if (quantite && prixInput.value) {
      const total = calculTotal(quantite, prixInput.value);
      this.closest('tr').querySelector('.total').value = total;
    }
  });
  
  cellQuantite.appendChild(inputQuantite);
  newRow.appendChild(cellQuantite);
  
  // Créer la cellule de prix unitaire
  const cellPrix = document.createElement('td');
  const inputPrix = document.createElement('input');
  inputPrix.type = 'number';
  inputPrix.min = '0';
  inputPrix.className = 'prix-unitaire form-control';
  inputPrix.required = true;
  
  inputPrix.addEventListener('input', function() {
    const prix = this.value;
    const quantiteInput = this.closest('tr').querySelector('.quantite');
    if (prix && quantiteInput.value) {
      const total = calculTotal(quantiteInput.value, prix);
      this.closest('tr').querySelector('.total').value = total;
    }
  });
  
  cellPrix.appendChild(inputPrix);
  newRow.appendChild(cellPrix);
  
  // Créer la cellule du total
  const cellTotal = document.createElement('td');
  const inputTotal = document.createElement('input');
  inputTotal.type = 'number';
  inputTotal.className = 'total form-control';
  inputTotal.readOnly = true;
  
  cellTotal.appendChild(inputTotal);
  newRow.appendChild(cellTotal);
  
  // Créer la cellule du commentaire
  const cellCommentaire = document.createElement('td');
  const inputCommentaire = document.createElement('input');
  inputCommentaire.type = 'text';
  inputCommentaire.className = 'commentaire form-control';
  
  cellCommentaire.appendChild(inputCommentaire);
  newRow.appendChild(cellCommentaire);
  
  // Créer la cellule des actions
  const cellActions = document.createElement('td');
  const btnSupprimer = document.createElement('button');
  btnSupprimer.type = 'button';
  btnSupprimer.className = 'btn btn-danger btn-sm supprimer-ligne';
  btnSupprimer.textContent = 'Supprimer';
  
  btnSupprimer.addEventListener('click', function() {
    this.closest('tr').remove();
  });
  
  cellActions.appendChild(btnSupprimer);
  newRow.appendChild(cellActions);
  
  // Ajouter la ligne au tableau
  tbody.appendChild(newRow);
}

// Fonction d'ajout de ligne de transfert
function ajouterLigneTransfert() {
  const tbody = document.querySelector('#transfertTable tbody');
  const rowIndex = tbody.rows.length;
  
  const newRow = document.createElement('tr');
  newRow.dataset.index = rowIndex;
  
  // Créer la cellule du point de vente
  const cellPointVente = document.createElement('td');
  const selectPointVente = document.createElement('select');
  selectPointVente.className = 'point-vente form-control';
  selectPointVente.required = true;
  
  // Option vide par défaut
  const optionVide = document.createElement('option');
  optionVide.value = '';
  optionVide.textContent = 'Choisir...';
  selectPointVente.appendChild(optionVide);
  
  // Ajouter les options des points de vente
  TOUS_POINTS_VENTE.forEach(point => {
    const option = document.createElement('option');
    option.value = point;
    option.textContent = point;
    selectPointVente.appendChild(option);
  });
  
  cellPointVente.appendChild(selectPointVente);
  newRow.appendChild(cellPointVente);
  
  // Créer la cellule du produit
  const cellProduit = document.createElement('td');
  const selectProduit = document.createElement('select');
  selectProduit.className = 'produit form-control';
  selectProduit.required = true;
  
  // Option vide par défaut
  const optionVideProduit = document.createElement('option');
  optionVideProduit.value = '';
  optionVideProduit.textContent = 'Choisir...';
  selectProduit.appendChild(optionVideProduit);
  
  // Ajouter les options des produits
  PRODUITS.forEach(produit => {
    const option = document.createElement('option');
    option.value = produit;
    option.textContent = produit;
    selectProduit.appendChild(option);
  });
  
  selectProduit.addEventListener('change', function() {
    const produit = this.value;
    const prixInput = this.closest('tr').querySelector('.prix-unitaire');
    if (produit && PRIX_DEFAUT[produit]) {
      prixInput.value = PRIX_DEFAUT[produit];
      // Déclencher l'événement de calcul du total
      const quantiteInput = this.closest('tr').querySelector('.quantite');
      if (quantiteInput.value) {
        const total = calculTotal(quantiteInput.value, prixInput.value);
        this.closest('tr').querySelector('.total').value = total;
      }
    }
  });
  
  cellProduit.appendChild(selectProduit);
  newRow.appendChild(cellProduit);
  
  // Créer la cellule d'impact
  const cellImpact = document.createElement('td');
  const selectImpact = document.createElement('select');
  selectImpact.className = 'impact form-control';
  selectImpact.required = true;
  
  const optionPositif = document.createElement('option');
  optionPositif.value = '1';
  optionPositif.textContent = '+';
  selectImpact.appendChild(optionPositif);
  
  const optionNegatif = document.createElement('option');
  optionNegatif.value = '-1';
  optionNegatif.textContent = '-';
  selectImpact.appendChild(optionNegatif);
  
  cellImpact.appendChild(selectImpact);
  newRow.appendChild(cellImpact);
  
  // Créer la cellule de quantité
  const cellQuantite = document.createElement('td');
  const inputQuantite = document.createElement('input');
  inputQuantite.type = 'number';
  inputQuantite.min = '0';
  inputQuantite.step = '0.001';
  inputQuantite.className = 'quantite form-control';
  inputQuantite.required = true;
  
  inputQuantite.addEventListener('input', function() {
    const quantite = this.value;
    const prixInput = this.closest('tr').querySelector('.prix-unitaire');
    if (quantite && prixInput.value) {
      const total = calculTotal(quantite, prixInput.value);
      this.closest('tr').querySelector('.total').value = total;
    }
  });
  
  cellQuantite.appendChild(inputQuantite);
  newRow.appendChild(cellQuantite);
  
  // Créer la cellule de prix unitaire
  const cellPrix = document.createElement('td');
  const inputPrix = document.createElement('input');
  inputPrix.type = 'number';
  inputPrix.min = '0';
  inputPrix.className = 'prix-unitaire form-control';
  inputPrix.required = true;
  
  inputPrix.addEventListener('input', function() {
    const prix = this.value;
    const quantiteInput = this.closest('tr').querySelector('.quantite');
    if (prix && quantiteInput.value) {
      const total = calculTotal(quantiteInput.value, prix);
      this.closest('tr').querySelector('.total').value = total;
    }
  });
  
  cellPrix.appendChild(inputPrix);
  newRow.appendChild(cellPrix);
  
  // Créer la cellule du total
  const cellTotal = document.createElement('td');
  const inputTotal = document.createElement('input');
  inputTotal.type = 'number';
  inputTotal.className = 'total form-control';
  inputTotal.readOnly = true;
  
  cellTotal.appendChild(inputTotal);
  newRow.appendChild(cellTotal);
  
  // Créer la cellule du commentaire
  const cellCommentaire = document.createElement('td');
  const inputCommentaire = document.createElement('input');
  inputCommentaire.type = 'text';
  inputCommentaire.className = 'commentaire form-control';
  
  cellCommentaire.appendChild(inputCommentaire);
  newRow.appendChild(cellCommentaire);
  
  // Créer la cellule des actions
  const cellActions = document.createElement('td');
  const btnSupprimer = document.createElement('button');
  btnSupprimer.type = 'button';
  btnSupprimer.className = 'btn btn-danger btn-sm supprimer-ligne';
  btnSupprimer.textContent = 'Supprimer';
  
  btnSupprimer.addEventListener('click', function() {
    this.closest('tr').remove();
  });
  
  cellActions.appendChild(btnSupprimer);
  newRow.appendChild(cellActions);
  
  // Ajouter la ligne au tableau
  tbody.appendChild(newRow);
}

// Tests
describe('Tests des manipulations DOM', () => {
  // Avant chaque test, vider les tableaux
  beforeEach(() => {
    document.querySelector('#stock-table tbody').innerHTML = '';
    document.querySelector('#transfertTable tbody').innerHTML = '';
  });
  
  describe('Gestion du stock', () => {
    test('Ajouter une ligne au tableau de stock', () => {
      ajouterLigneStock();
      
      const tbody = document.querySelector('#stock-table tbody');
      expect(tbody.rows.length).toBe(1);
      
      const row = tbody.rows[0];
      expect(row.cells.length).toBe(7); // 7 colonnes
      
      // Vérifier les éléments de la ligne
      expect(row.querySelector('.point-vente')).not.toBeNull();
      expect(row.querySelector('.produit')).not.toBeNull();
      expect(row.querySelector('.quantite')).not.toBeNull();
      expect(row.querySelector('.prix-unitaire')).not.toBeNull();
      expect(row.querySelector('.total')).not.toBeNull();
      expect(row.querySelector('.commentaire')).not.toBeNull();
      expect(row.querySelector('.supprimer-ligne')).not.toBeNull();
    });
    
    test('Les listes déroulantes contiennent les bonnes options', () => {
      ajouterLigneStock();
      
      const selectPointVente = document.querySelector('#stock-table tbody tr:first-child .point-vente');
      const selectProduit = document.querySelector('#stock-table tbody tr:first-child .produit');
      
      // Vérifier que les options sont là
      expect(selectPointVente.options.length).toBe(TOUS_POINTS_VENTE.length + 1); // +1 pour l'option vide
      expect(selectProduit.options.length).toBe(PRODUITS.length + 1);
      
      // Vérifier le contenu des options
      const pointsVenteOptions = Array.from(selectPointVente.options).slice(1).map(option => option.value);
      const produitsOptions = Array.from(selectProduit.options).slice(1).map(option => option.value);
      
      TOUS_POINTS_VENTE.forEach(point => {
        expect(pointsVenteOptions).toContain(point);
      });
      
      PRODUITS.forEach(produit => {
        expect(produitsOptions).toContain(produit);
      });
    });
    
    test('Sélectionner un produit remplit le prix unitaire par défaut', () => {
      ajouterLigneStock();
      
      const row = document.querySelector('#stock-table tbody tr:first-child');
      const selectProduit = row.querySelector('.produit');
      const inputPrix = row.querySelector('.prix-unitaire');
      
      // Sélectionner un produit
      selectProduit.value = 'Boeuf';
      const event = new Event('change');
      selectProduit.dispatchEvent(event);
      
      // Vérifier que le prix est rempli
      expect(inputPrix.value).toBe(PRIX_DEFAUT['Boeuf'].toString());
    });
    
    test('Le calcul du total se fait correctement', () => {
      ajouterLigneStock();
      
      const row = document.querySelector('#stock-table tbody tr:first-child');
      const inputQuantite = row.querySelector('.quantite');
      const inputPrix = row.querySelector('.prix-unitaire');
      const inputTotal = row.querySelector('.total');
      
      // Remplir les valeurs
      inputQuantite.value = '10';
      inputPrix.value = '3600';
      
      // Déclencher l'événement input
      const event = new Event('input');
      inputQuantite.dispatchEvent(event);
      
      // Vérifier le calcul
      expect(inputTotal.value).toBe('36000');
    });
    
    test('Supprimer une ligne fonctionne', () => {
      // Ajouter deux lignes
      ajouterLigneStock();
      ajouterLigneStock();
      
      const tbody = document.querySelector('#stock-table tbody');
      expect(tbody.rows.length).toBe(2);
      
      // Supprimer la première ligne
      const btnSupprimer = tbody.rows[0].querySelector('.supprimer-ligne');
      btnSupprimer.click();
      
      // Vérifier qu'il ne reste qu'une ligne
      expect(tbody.rows.length).toBe(1);
    });
  });
  
  describe('Gestion des transferts', () => {
    test('Ajouter une ligne au tableau de transfert', () => {
      ajouterLigneTransfert();
      
      const tbody = document.querySelector('#transfertTable tbody');
      expect(tbody.rows.length).toBe(1);
      
      const row = tbody.rows[0];
      expect(row.cells.length).toBe(8); // 8 colonnes (avec impact)
      
      // Vérifier les éléments de la ligne
      expect(row.querySelector('.point-vente')).not.toBeNull();
      expect(row.querySelector('.produit')).not.toBeNull();
      expect(row.querySelector('.impact')).not.toBeNull();
      expect(row.querySelector('.quantite')).not.toBeNull();
      expect(row.querySelector('.prix-unitaire')).not.toBeNull();
      expect(row.querySelector('.total')).not.toBeNull();
      expect(row.querySelector('.commentaire')).not.toBeNull();
      expect(row.querySelector('.supprimer-ligne')).not.toBeNull();
    });
    
    test('Le select d\'impact a les bonnes options', () => {
      ajouterLigneTransfert();
      
      const selectImpact = document.querySelector('#transfertTable tbody tr:first-child .impact');
      
      expect(selectImpact.options.length).toBe(2);
      expect(selectImpact.options[0].value).toBe('1');
      expect(selectImpact.options[0].textContent).toBe('+');
      expect(selectImpact.options[1].value).toBe('-1');
      expect(selectImpact.options[1].textContent).toBe('-');
    });
    
    test('Le calcul du total fonctionne avec un impact négatif', () => {
      ajouterLigneTransfert();
      
      const row = document.querySelector('#transfertTable tbody tr:first-child');
      const selectImpact = row.querySelector('.impact');
      const inputQuantite = row.querySelector('.quantite');
      const inputPrix = row.querySelector('.prix-unitaire');
      const inputTotal = row.querySelector('.total');
      
      // Remplir les valeurs
      selectImpact.value = '-1';
      inputQuantite.value = '10';
      inputPrix.value = '3600';
      
      // Déclencher l'événement input
      const event = new Event('input');
      inputQuantite.dispatchEvent(event);
      
      // Vérifier le calcul (le total ne tient pas compte du signe de l'impact)
      expect(inputTotal.value).toBe('36000');
    });
  });
}); 