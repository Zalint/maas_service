/**
 * Module de gestion des compositions de packs
 * Gère l'affichage, la modification et la sauvegarde des compositions de packs
 */

// Configuration des compositions de packs (doit rester alignee sur
// config/pack-compositions.js et sur la copie de pos.js).
//
// Cette copie referencait "Veau" et "Poulet", qui existent au catalogue mais
// SANS categorie: les kilos d'un pack decompose ici n'etaient rattaches ni a
// Bovin ni a Ovin. C'est cette copie que charge index.html, donc celle que
// voient Visualisation et Reconciliation.
const PACK_COMPOSITIONS = {
  "Pack25000": [
    { produit: "Veau en détail", quantite: 4, unite: "kg" },
    { produit: "Poulet en détail", quantite: 2, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack20000": [
    { produit: "Veau en détail", quantite: 3.5, unite: "kg" },
    { produit: "Poulet en détail", quantite: 1, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack50000": [
    { produit: "Agneau", quantite: 2.5, unite: "kg" },
    { produit: "Veau en détail", quantite: 6, unite: "kg" },
    { produit: "Poulet en détail", quantite: 4, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ],
  "Pack35000": [
    { produit: "Veau en détail", quantite: 4, unite: "kg" },
    { produit: "Poulet en détail", quantite: 2, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack30000": [
    { produit: "Veau en détail", quantite: 2, unite: "kg" },
    { produit: "Poulet en détail", quantite: 6, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack75000": [
    { produit: "Veau en détail", quantite: 8, unite: "kg" },
    { produit: "Agneau", quantite: 5, unite: "kg" },
    { produit: "Poulet en détail", quantite: 5, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ],
  "Pack100000": [
    { produit: "Veau en détail", quantite: 8, unite: "kg" },
    { produit: "Agneau", quantite: 1, unite: "kg" },
    { produit: "Poulet en détail", quantite: 5, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ]
};

// État global pour gérer les compositions de pack par produit-entry
let packCompositions = new Map();
let currentEditingEntry = null;
let packModal = null;

/**
 * Initialise le module de gestion des packs
 */
function initPackCompositionModule() {
  console.log('Initialisation du module de composition de packs');
  
  // Récupérer le modal
  const modalElement = document.getElementById('packDetailsModal');
  if (modalElement) {
    packModal = new bootstrap.Modal(modalElement);
  }
  
  // Attacher les événements
  attachPackEvents();
}

/**
 * Attache les événements pour la gestion des packs
 */
function attachPackEvents() {
  // Event delegation pour les boutons de détails de pack
  document.addEventListener('click', function(e) {
    if (e.target.closest('.btn-pack-details')) {
      const btn = e.target.closest('.btn-pack-details');
      const produitEntry = btn.closest('.produit-entry');
      openPackDetailsModal(produitEntry);
    }
  });
  
  // Bouton pour sauvegarder la composition
  const saveBtn = document.getElementById('save-pack-composition');
  if (saveBtn) {
    saveBtn.addEventListener('click', savePackComposition);
  }
  
  // Bouton pour réinitialiser la composition
  const resetBtn = document.getElementById('reset-pack-composition');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetPackComposition);
  }
  
  // Bouton pour ajouter un produit
  const addBtn = document.getElementById('add-pack-item');
  if (addBtn) {
    addBtn.addEventListener('click', addPackItem);
  }
  
  // Event delegation pour les boutons de suppression
  document.addEventListener('click', function(e) {
    if (e.target.closest('.btn-remove-pack-item')) {
      const btn = e.target.closest('.btn-remove-pack-item');
      const row = btn.closest('tr');
      row.remove();
    }
  });
}

/**
 * Vérifie si un produit est un pack et affiche/masque le bouton de détails
 */
function checkIfPackAndShowButton(produitEntry) {
  const produitSelect = produitEntry.querySelector('.produit-select');
  const detailsBtn = produitEntry.querySelector('.btn-pack-details');
  
  if (!produitSelect || !detailsBtn) return;
  
  const selectedProduit = produitSelect.value;
  
  // Vérifier si le produit sélectionné est un pack
  if (PACK_COMPOSITIONS.hasOwnProperty(selectedProduit)) {
    detailsBtn.style.display = 'inline-block';
    
    // Si c'est la première fois qu'on sélectionne ce pack, charger la composition par défaut
    if (!packCompositions.has(produitEntry)) {
      const defaultComposition = JSON.parse(JSON.stringify(PACK_COMPOSITIONS[selectedProduit]));
      packCompositions.set(produitEntry, {
        packType: selectedProduit,
        composition: defaultComposition,
        modifie: false
      });
    }
  } else {
    detailsBtn.style.display = 'none';
    packCompositions.delete(produitEntry);
  }
}

/**
 * Ouvre le modal des détails du pack
 */
function openPackDetailsModal(produitEntry) {
  currentEditingEntry = produitEntry;
  const produitSelect = produitEntry.querySelector('.produit-select');
  const packName = produitSelect.value;
  
  if (!PACK_COMPOSITIONS[packName]) {
    console.error('Pack non trouvé:', packName);
    return;
  }
  
  // Mettre à jour le titre
  document.getElementById('pack-name').textContent = packName;
  
  // Charger la composition (existante ou par défaut)
  let composition;
  if (packCompositions.has(produitEntry)) {
    composition = packCompositions.get(produitEntry).composition;
  } else {
    composition = JSON.parse(JSON.stringify(PACK_COMPOSITIONS[packName]));
  }
  
  // Afficher la composition dans le tableau
  renderPackComposition(composition);
  
  // Ouvrir le modal
  if (packModal) {
    packModal.show();
  }
}

/**
 * Affiche la composition du pack dans le tableau
 */
function renderPackComposition(composition) {
  const tbody = document.getElementById('pack-composition-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  composition.forEach((item, index) => {
    const row = createPackItemRow(item, index);
    tbody.appendChild(row);
  });
}

/**
 * Obtient le prix d'un produit depuis produits.js
 */
function getPrixProduit(nomProduit) {
  if (typeof window.produits === 'undefined') return null;
  
  // Appliquer le mapping si nécessaire
  const mappedNom = mapProduitName ? mapProduitName(nomProduit) : nomProduit;
  
  // Rechercher dans toutes les catégories
  for (const categorie in window.produits) {
    if (typeof window.produits[categorie] === 'object' && window.produits[categorie] !== null) {
      // Chercher une correspondance exacte avec le nom mappé
      if (window.produits[categorie][mappedNom]) {
        const prixData = window.produits[categorie][mappedNom];
        return prixData.default || null;
      }
      
      // Chercher une correspondance partielle
      for (const produit in window.produits[categorie]) {
        if (produit.toLowerCase().includes(mappedNom.toLowerCase())) {
          const prixData = window.produits[categorie][produit];
          return prixData.default || null;
        }
      }
    }
  }
  return null;
}

/**
 * Mapping des noms génériques vers des produits spécifiques
 */
const PRODUIT_MAPPING = {
  "Veau": "Veau en détail",
  "Boeuf": "Boeuf en détail",
  "Poulet": "Poulet en détail",
  "Mouton": "Agneau"
};

/**
 * Applique le mapping pour sélectionner le bon produit
 */
function mapProduitName(nomProduit) {
  return PRODUIT_MAPPING[nomProduit] || nomProduit;
}

/**
 * Crée un dropdown de sélection de produits
 */
function createProduitDropdown(selectedProduit, index) {
  const select = document.createElement('select');
  select.className = 'form-control form-control-sm pack-item-produit';
  select.setAttribute('data-index', index);
  
  // Appliquer le mapping au produit sélectionné
  const mappedSelectedProduit = mapProduitName(selectedProduit);
  
  // Option vide
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = 'Sélectionner...';
  select.appendChild(emptyOption);
  
  // Ajouter tous les produits disponibles depuis produits.js
  if (typeof window.produits !== 'undefined') {
    for (const categorie in window.produits) {
      if (typeof window.produits[categorie] === 'object' && window.produits[categorie] !== null && typeof window.produits[categorie] !== 'function') {
        const optgroup = document.createElement('optgroup');
        optgroup.label = categorie;
        
        for (const produit in window.produits[categorie]) {
          if (typeof window.produits[categorie][produit] === 'object') {
            const option = document.createElement('option');
            option.value = produit;
            option.textContent = produit;
            if (produit === mappedSelectedProduit) {
              option.selected = true;
            }
            optgroup.appendChild(option);
          }
        }
        
        if (optgroup.children.length > 0) {
          select.appendChild(optgroup);
        }
      }
    }
  }
  
  // Événement pour mettre à jour le prix quand le produit change
  select.addEventListener('change', function() {
    const row = this.closest('tr');
    const prixCell = row.querySelector('.pack-item-prix');
    if (prixCell) {
      const prix = getPrixProduit(this.value);
      prixCell.textContent = prix ? `${prix.toLocaleString('fr-FR')} FCFA` : '-';
    }
  });
  
  return select;
}

/**
 * Crée une ligne pour un produit du pack
 */
function createPackItemRow(item, index) {
  const row = document.createElement('tr');
  
  // Cellule Produit (dropdown)
  const tdProduit = document.createElement('td');
  tdProduit.appendChild(createProduitDropdown(item.produit, index));
  row.appendChild(tdProduit);
  
  // Cellule Quantité
  const tdQuantite = document.createElement('td');
  tdQuantite.innerHTML = `
    <input type="number" class="form-control form-control-sm pack-item-quantite" 
           value="${item.quantite}" step="0.1" min="0" data-index="${index}">
  `;
  row.appendChild(tdQuantite);
  
  // Cellule Unité
  const tdUnite = document.createElement('td');
  tdUnite.innerHTML = `
    <input type="text" class="form-control form-control-sm pack-item-unite" 
           value="${item.unite}" data-index="${index}">
    ${item.poids_unitaire ? `<br><small class="text-muted">(${item.poids_unitaire}kg/pièce)</small>` : ''}
  `;
  row.appendChild(tdUnite);
  
  // Cellule Prix (informatif)
  const tdPrix = document.createElement('td');
  tdPrix.className = 'text-end pack-item-prix';
  const prix = getPrixProduit(item.produit);
  tdPrix.textContent = prix ? `${prix.toLocaleString('fr-FR')} FCFA` : '-';
  row.appendChild(tdPrix);
  
  // Cellule Action
  const tdAction = document.createElement('td');
  tdAction.className = 'text-center';
  tdAction.innerHTML = `
    <button type="button" class="btn btn-danger btn-sm btn-remove-pack-item" title="Supprimer">
      <i class="bi bi-trash"></i>
    </button>
  `;
  row.appendChild(tdAction);
  
  return row;
}

/**
 * Ajoute un nouveau produit au pack
 */
function addPackItem() {
  const tbody = document.getElementById('pack-composition-body');
  if (!tbody) return;
  
  const newItem = {
    produit: '',
    quantite: 0,
    unite: 'kg'
  };
  
  const index = tbody.children.length;
  const row = createPackItemRow(newItem, index);
  tbody.appendChild(row);
}

/**
 * Sauvegarde la composition du pack
 */
function savePackComposition() {
  if (!currentEditingEntry) return;
  
  const tbody = document.getElementById('pack-composition-body');
  const rows = tbody.querySelectorAll('tr');
  
  const composition = [];
  let hasError = false;
  
  rows.forEach(row => {
    const produitSelect = row.querySelector('.pack-item-produit');
    const produit = produitSelect ? produitSelect.value.trim() : '';
    const quantite = parseFloat(row.querySelector('.pack-item-quantite').value);
    const unite = row.querySelector('.pack-item-unite').value.trim();
    
    if (!produit || quantite <= 0 || !unite) {
      hasError = true;
      return;
    }
    
    composition.push({
      produit,
      quantite,
      unite
    });
  });
  
  if (hasError) {
    alert('Veuillez remplir tous les champs correctement. Les quantités doivent être supérieures à 0.');
    return;
  }
  
  if (composition.length === 0) {
    alert('La composition du pack ne peut pas être vide.');
    return;
  }
  
  // Récupérer le nom du pack
  const produitSelect = currentEditingEntry.querySelector('.produit-select');
  const packName = produitSelect.value;
  
  // Vérifier si la composition a été modifiée
  const defaultComposition = PACK_COMPOSITIONS[packName];
  const isModified = JSON.stringify(composition) !== JSON.stringify(defaultComposition);
  
  // Sauvegarder la composition
  packCompositions.set(currentEditingEntry, {
    packType: packName,
    composition: composition,
    modifie: isModified
  });
  
  // Ajouter un indicateur visuel si modifié
  const detailsBtn = currentEditingEntry.querySelector('.btn-pack-details');
  if (isModified) {
    detailsBtn.classList.add('btn-warning');
    detailsBtn.classList.remove('btn-info');
    detailsBtn.title = 'Détails du pack (modifié)';
  } else {
    detailsBtn.classList.add('btn-info');
    detailsBtn.classList.remove('btn-warning');
    detailsBtn.title = 'Détails du pack';
  }
  
  // Fermer le modal
  if (packModal) {
    packModal.hide();
  }
  
  console.log('Composition sauvegardée:', packCompositions.get(currentEditingEntry));
}

/**
 * Réinitialise la composition du pack à sa valeur par défaut
 */
function resetPackComposition() {
  if (!currentEditingEntry) return;
  
  const produitSelect = currentEditingEntry.querySelector('.produit-select');
  const packName = produitSelect.value;
  
  if (!PACK_COMPOSITIONS[packName]) return;
  
  const defaultComposition = JSON.parse(JSON.stringify(PACK_COMPOSITIONS[packName]));
  renderPackComposition(defaultComposition);
}

/**
 * Récupère la composition d'un pack pour une produit-entry donnée
 */
function getPackComposition(produitEntry) {
  return packCompositions.get(produitEntry) || null;
}

/**
 * Nettoie les compositions de packs lors de la suppression d'une entry
 */
function clearPackComposition(produitEntry) {
  packCompositions.delete(produitEntry);
}

/**
 * Récupère toutes les compositions de packs pour la vente en cours
 */
function getAllPackCompositions() {
  const result = [];
  packCompositions.forEach((value, key) => {
    result.push({
      entry: key,
      ...value
    });
  });
  return result;
}

/**
 * Réinitialise toutes les compositions de packs
 */
function clearAllPackCompositions() {
  packCompositions.clear();
}

// Export des fonctions
window.PackComposition = {
  init: initPackCompositionModule,
  checkIfPackAndShowButton,
  getPackComposition,
  getAllPackCompositions,
  clearPackComposition,
  clearAllPackCompositions
};
