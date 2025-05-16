// Import Firebase configuration and Firestore services
import { db } from "./firebase-config.js";
import {

    collection, getDocs, doc, setDoc, getDoc, writeBatch,
    updateDoc, onSnapshot, runTransaction, query, where,

} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { NotificationSystem as notify } from './notification.js';

// ==================================================
// 1. STATE MANAGEMENT AND DOM REFERENCES
// ==================================================

/**
 * Main application state container
 * Tracks current product, variants, undo/redo stacks, and UI state
 */
const state = {
  currentProduct: null,
  isAdding: true,
  allProducts: [],
  undoStack: [],
  redoStack: [],
  selectedAttributes: {},  
  activeVariant: null  
};

/**
 * DOM element references grouped for easy access
 */
const dom = {
  // Input fields
  productInput: document.getElementById("product-name-input"),
  packagedQuantity: document.getElementById("packaged-quantity"),
  usedStock: document.getElementById("used-stock"),
  
  // Display elements
  currentPackaged: document.getElementById("current-packaged"),
  currentUsed: document.getElementById("current-used"),
  totalPackaged: document.getElementById("total-packaged"),
  
  // Containers
  productDetails: document.getElementById("product-details"),
  packagingTable: document.getElementById("packaging-table").querySelector("tbody"),
  packagingTableContainer: document.getElementById("packaging-table-container"),
  variantSelector: document.getElementById("variant-selector"),
  autocomplete: document.getElementById("autocomplete-suggestions"),
  
  // Modals and loaders
  confirmationModal: document.getElementById("confirmation-modal"),
  saveSpinner: document.getElementById("save-spinner"),
  loadingSpinner: document.getElementById("loading-spinner"),
  modalMessage: document.getElementById("modal-message")
};

// ==================================================
// 2. CORE APPLICATION FUNCTIONS
// ==================================================

/**
 * Initialize application on load
 */
function initializeApp() {
  fetchAllProducts();
  setupPackagingTableListener();
  setupEventListeners();
  notify.init();
}

window.addEventListener("load", initializeApp);

// ==================================================
// 3. PRODUCT MANAGEMENT
// ==================================================

/**
 * Fetch all products from Firestore and initialize state
 */
async function fetchAllProducts() {
  const snapshot = await getDocs(collection(db, "packaging"));
  state.allProducts = snapshot.docs.map(doc => ({
    productId: doc.id,
    name: doc.data().productName,
    variants: doc.data().variants.map(v => ({
      ...v,
      packagedQuantity: Number(v.packagedQuantity) || 0,
      usedStock: Number(v.usedStock) || 0
    })),
    variantDimensions: doc.data().variantDimensions
  }));
}

/**
 * Handle product selection via search/barcode scan
 * @param {string} productId - ID of selected product
 */
async function scanBarcode(productId) {
  resetProductDetails();
  const product = state.allProducts.find(p => p.productId === productId);
  if (!product?.variants?.length) return;
  notify.show({
    message: `Loaded: ${product.name}`,
    type: "success",
    timeout: 2000
  });
  state.currentProduct = product;
  document.getElementById("product-name").textContent = product.name;

  if (product.variants.length === 1) {
    autoSelectVariant(product.variants[0]);
  } else {
    renderVariantChips();
  }
  
  dom.productDetails.style.display = "block";
}

/**
 * Auto-select variant for single-variant products
 * @param {object} variant - The variant to select
 */
function autoSelectVariant(variant) {
  state.selectedAttributes = {...variant.attributes};
  state.activeVariant = variant;
  updateQuantityDisplay();
  renderVariantChips();
}

// ==================================================
// 4. VARIANT SELECTION SYSTEM
// ==================================================

/**
 * Render interactive chips for variant selection
 */
function renderVariantChips() {
  const container = dom.variantSelector;
  if (!state.currentProduct?.variantDimensions) return;

  container.innerHTML = state.currentProduct.variantDimensions.map(dim => {
    const allValues = getUniqueValues(dim);
    const currentSelection = state.selectedAttributes[dim];

    return `
      <div class="dimension-group">
        <h3>${dim.toUpperCase()}</h3>
        <div class="chips">
          ${allValues.map(val => {
            const isSelected = currentSelection === val;
            const shouldDisable = !isSelected && !hasVariantWithSelection(dim, val);

            return `
              <button class="chip ${isSelected ? 'selected' : ''}
                      ${shouldDisable ? 'disabled' : ''}"
                      data-dim="${dim}" 
                      data-val="${val}"
                      ${shouldDisable ? 'tabindex="-1"' : ''}>
                ${val}
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners to active chips
  container.querySelectorAll('.chip:not(.disabled)').forEach(chip => {
    chip.addEventListener('click', handleChipClick);
  });
}

/**
 * Handle chip selection/deselection
 * @param {Event} e - Click event
 */
function handleChipClick(e) {
  const chip = e.currentTarget;
  const dim = chip.dataset.dim;
  const val = chip.dataset.val;

  // Toggle selection
  if (state.selectedAttributes[dim] === val) {
    delete state.selectedAttributes[dim];
    if (Object.keys(state.selectedAttributes).length === 0) {
      resetVariantDisplay();
    }
  } else {
    state.selectedAttributes[dim] = val;
  }

  // Update active variant and UI
  state.activeVariant = findVariant();
  updateVariantDisplay();
  renderVariantChips();
}

/**
 * Find variant matching current attribute selections
 * @returns {object|null} Matching variant or null
 */
function findVariant() {
  const selectedDims = Object.keys(state.selectedAttributes);
  const allDims = state.currentProduct.variantDimensions || [];
  
  if (selectedDims.length === 0 || selectedDims.length !== allDims.length) {
    return null;
  }
  
  return state.currentProduct.variants.find(v => 
    allDims.every(dim => 
      v.attributes[dim] === state.selectedAttributes[dim]
    )
  );
}

/**
 * Check if variant exists with given dimension value
 */
function hasVariantWithSelection(dimension, value) {
  const testAttributes = {
    ...state.selectedAttributes,
    [dimension]: value
  };
  
  return state.currentProduct.variants.some(v => 
    Object.keys(testAttributes).every(d => 
      v.attributes[d] === testAttributes[d]
    )
  );
}

/**
 * Get unique values for a dimension
 */
function getUniqueValues(dimension) {
  if (!state.currentProduct?.variants) return [];
  return [...new Set(
    state.currentProduct.variants.map(v => v.attributes[dimension])
  )].filter(Boolean);
}

// ==================================================
// 5. PACKAGING OPERATIONS
// ==================================================

/**
 * Save packaging data to Firestore
 */
async function savePackagingData() {
   if (!state.activeVariant || !validatePackagingInput()) {
    notify.show({
      message: "Invalid packaging data! Check your inputs",
      type: "error"
    });
    return;
  }
  
  const { packagedQuantity, usedStock } = getInputValues();
  const packagingRef = doc(db, "packaging", state.currentProduct.productId);

  notify.show({
    message: `Saving ${state.currentProduct.name}...`,
    type: "info",
    timeout: 2000
  });
  try {
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(packagingRef);
      const variants = [...docSnap.data().variants];
      
      const variantIndex = variants.findIndex(
        v => v.variantId === state.activeVariant.variantId
      );
      
      if (variantIndex === -1) throw new Error("Variant not found");
      
      const variant = variants[variantIndex];
      const oldValues = {
        packaged: variant.packagedQuantity,
        used: variant.usedStock
      };
      
      // Update values
      if (state.isAdding) {
        variant.packagedQuantity += packagedQuantity;
        variant.usedStock += usedStock;
      } else {
        variant.packagedQuantity = Math.max(0, variant.packagedQuantity - packagedQuantity);
        variant.usedStock = Math.max(0, variant.usedStock - usedStock);
      }
      
      // Update local state
      updateLocalProductState(variant);
      
      // Push to undo stack
      state.undoStack.push({
        productId: state.currentProduct.productId,
        variantId: state.activeVariant.variantId,
        oldValues,
        newValues: {
          packaged: variant.packagedQuantity,
          used: variant.usedStock
        }
      });
      
      transaction.update(packagingRef, { variants });
      // Clear redo stack on new action
      state.redoStack = [];
      updateUndoRedoButtons();
    });
    notify.show({
      message: `Saved successfully! ${state.isAdding ? "Added" : "Subtracted"} 
                ${getInputValues().packagedQuantity} units`,
      type: "success"
    });
    refreshCurrentVariantData();
    resetInputFields();
    
  } catch (error) {
    console.error("Save failed:", error);
    notify.show({
      message: `Save failed: ${error.message}`,
      type: "error",
      timeout: 4000
    });
  }
}

/**
 * Update local product state after save
 */
function updateLocalProductState(variant) {
  const productIndex = state.allProducts.findIndex(
    p => p.productId === state.currentProduct.productId
  );
  if (productIndex !== -1) {
    const variantIndex = state.allProducts[productIndex].variants.findIndex(
      v => v.variantId === state.activeVariant.variantId
    );
    if (variantIndex !== -1) {
      state.allProducts[productIndex].variants[variantIndex] = {
        ...state.allProducts[productIndex].variants[variantIndex],
        packagedQuantity: variant.packagedQuantity,
        usedStock: variant.usedStock
      };
    }
  }
}

/**
 * Refresh variant data from Firestore
 */
async function refreshCurrentVariantData() {
  if (!state.currentProduct?.productId) return;

  const packagingRef = doc(db, "packaging", state.currentProduct.productId);
  const docSnap = await getDoc(packagingRef);

  if (docSnap.exists()) {
    // Update allProducts array
    const productIndex = state.allProducts.findIndex(
      p => p.productId === state.currentProduct.productId
    );
    if (productIndex !== -1) {
      state.allProducts[productIndex] = {
        ...state.allProducts[productIndex],
        variants: docSnap.data().variants
      };
    }

    // Update active variant
    if (state.activeVariant) {
      const updatedVariant = docSnap.data().variants.find(
        v => v.variantId === state.activeVariant.variantId
      );
      if (updatedVariant) {
        state.activeVariant = updatedVariant;
        updateQuantityDisplay();
      }
    }
  }
}

// ==================================================
// 6. UNDO/REDO SYSTEM
// ==================================================

async function undoLastAction() {
  if (state.undoStack.length === 0) return;

  const action = state.undoStack.pop();
  const packagingRef = doc(db, "packaging", action.productId);

  try {
    const product = state.allProducts.find(p => p.productId === action.productId);
    const variant = product?.variants.find(v => v.variantId === action.variantId);
    
    notify.show({
      message: `
        <div class="undo-redo-notification">
          <strong>UNDO APPLIED</strong>
          <div class="variant">${product?.name || 'Product'} - ${variant?.variantName || 'Variant'}</div>
          <div class="change">
            <span class="label">Packaged:</span>
            <span class="from">${action.newValues.packaged}</span>
            <span class="arrow">→</span>
            <span class="to">${action.oldValues.packaged}</span>
          </div>
          <div class="change">
            <span class="label">Used Stock:</span>
            <span class="from">${action.newValues.used}</span>
            <span class="arrow">→</span>
            <span class="to">${action.oldValues.used}</span>
          </div>
        </div>
      `,
      type: "warning",
      timeout: 5000
    });

    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(packagingRef);
      const variants = [...docSnap.data().variants];
      
      const variantIndex = variants.findIndex(
        v => v.variantId === action.variantId
      );
      
      variants[variantIndex] = {
        ...variants[variantIndex],
        packagedQuantity: action.oldValues.packaged,
        usedStock: action.oldValues.used
      };
      
      transaction.update(packagingRef, { variants });
    });

    state.redoStack.push(action);
    updateUndoRedoButtons();
    await refreshCurrentVariantData();

  } catch (error) {
    console.error("Undo failed:", error);
    notify.show({
      message: `Undo failed: ${error.message}`,
      type: "error",
      timeout: 4000
    });
  }
}

async function redoLastAction() {
  if (state.redoStack.length === 0) return;

  const action = state.redoStack.pop();
  const packagingRef = doc(db, "packaging", action.productId);

  try {
    const product = state.allProducts.find(p => p.productId === action.productId);
    const variant = product?.variants.find(v => v.variantId === action.variantId);
    
    notify.show({
      message: `
        <div class="undo-redo-notification">
          <strong>REDO APPLIED</strong>
          <div class="variant">${product?.name || 'Product'} - ${variant?.variantName || 'Variant'}</div>
          <div class="change">
            <span class="label">Packaged:</span>
            <span class="from">${action.oldValues.packaged}</span>
            <span class="arrow">→</span>
            <span class="to">${action.newValues.packaged}</span>
          </div>
          <div class="change">
            <span class="label">Used Stock:</span>
            <span class="from">${action.oldValues.used}</span>
            <span class="arrow">→</span>
            <span class="to">${action.newValues.used}</span>
          </div>
        </div>
      `,
      type: "info",
      timeout: 5000
    });

    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(packagingRef);
      const variants = [...docSnap.data().variants];
      
      const variantIndex = variants.findIndex(
        v => v.variantId === action.variantId
      );
      
      variants[variantIndex] = {
        ...variants[variantIndex],
        packagedQuantity: action.newValues.packaged,
        usedStock: action.newValues.used
      };
      
      transaction.update(packagingRef, { variants });
    });

    state.undoStack.push(action);
    updateUndoRedoButtons();
    await refreshCurrentVariantData();

  } catch (error) {
    console.error("Redo failed:", error);
    notify.show({
      message: `Redo failed: ${error.message}`,
      type: "error",
      timeout: 4000
    });
  }
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undo-button');
  const redoBtn = document.getElementById('redo-button');
  
  undoBtn.disabled = state.undoStack.length === 0;
  redoBtn.disabled = state.redoStack.length === 0;
  
  // Add visual feedback
  undoBtn.style.opacity = undoBtn.disabled ? "0.5" : "1";
  redoBtn.style.opacity = redoBtn.disabled ? "0.5" : "1";
}

// ==================================================
// 7. UI UPDATES AND UTILITIES
// ==================================================

function updateQuantityDisplay() {
  if (!state.activeVariant) {
    dom.currentPackaged.textContent = "0";
    dom.currentUsed.textContent = "0";
    return;
  }
  
  dom.currentPackaged.textContent = state.activeVariant.packagedQuantity ?? 0;
  dom.currentUsed.textContent = state.activeVariant.usedStock ?? 0;
  
}

function updateVariantDisplay() {
  if (state.activeVariant) {
    updateQuantityDisplay();
  } else {
    dom.currentPackaged.textContent = "0";
    dom.currentUsed.textContent = "0";
  }
}

function resetVariantDisplay() {
  dom.currentPackaged.textContent = "0";
  dom.currentUsed.textContent = "0";
  state.activeVariant = null;
}

function resetInputFields() {
  dom.packagedQuantity.value = "";
  dom.usedStock.value = "";
}

function resetProductDetails() {
  resetInputFields();
  resetVariantDisplay();
  state.currentProduct = null;
  state.selectedAttributes = {};
  
  dom.productInput.value = "";
  dom.autocomplete.style.display = "none";
  dom.productDetails.style.display = "none";
  dom.variantSelector.innerHTML = "";
}

// ==================================================
// 8. VALIDATION AND INPUT HANDLING
// ==================================================

function validatePackagingInput() {
  const values = getInputValues();
  
  if (isNaN(values.packagedQuantity) || values.packagedQuantity < 0) {
    alert("Packaged quantity must be ≥ 0");
    return false;
  }
  
  if (isNaN(values.usedStock) || values.usedStock < 0) {
    alert("Used stock must be ≥ 0");
    return false;
  }
  
  return true;
}

function getInputValues() {
  return {
    packagedQuantity: parseInt(dom.packagedQuantity.value) || 0,
    usedStock: parseInt(dom.usedStock.value) || 0
  };
}

// ==================================================
// 9. ADMIN AND DATA MANAGEMENT
// ==================================================

// Generate packaging collection from products
async function generatePackagingCollection() {
   notify.show({
    message: "Generating packaging collection...",
    type: "info",
    timeout: 3000
  });
  const [productsSnapshot, existingPackagingSnapshot] = await Promise.all([
    getDocs(query(collection(db, "products"), where("trackPackaging", "==", true))),
    getDocs(collection(db, "packaging"))
  ]);

  const batch = writeBatch(db);
  const newProductIds = new Set();

  // Process active products
  for (const productDoc of productsSnapshot.docs) {
    const productData = productDoc.data();
    const packagingRef = doc(db, "packaging", productData.productId);
    const packagingSnap = await getDoc(packagingRef);

    newProductIds.add(productData.productId);

    const existingVariants = packagingSnap.exists() ? packagingSnap.data().variants : [];
    const countMap = new Map(existingVariants.map(v => [v.variantId, {
      packaged: v.packagedQuantity,
      used: v.usedStock
    }]));

    const activeVariants = productData.variants
      ?.filter(v => v.isActive !== false)
      ?.map(v => ({
        variantId: v.variantId,
        variantName: v.variantName,
        attributes: v.attributes,
        packagedQuantity: countMap.get(v.variantId)?.packaged || 0,
        usedStock: countMap.get(v.variantId)?.used || 0
      })) || [];

    if (activeVariants.length > 0) {
      batch.set(packagingRef, {
        productId: productData.productId,
        productName: productData.productName,
        variantDimensions: productData.variantDimensions || [],
        variants: activeVariants
      }, { merge: true });
    } else {
      batch.delete(packagingRef);
    }
  }

  // Remove discontinued products
  for (const packagingDoc of existingPackagingSnapshot.docs) {
    const packagingData = packagingDoc.data();
    if (!newProductIds.has(packagingData.productId)) {
      batch.delete(packagingDoc.ref);
    }
  }

   try {
    await batch.commit();
    fetchAllProducts();
    notify.show({
      message: `Updated ${newProductIds.size} products successfully!`,
      type: "success"
    });
  } catch (error) {
    notify.show({
      message: `Generation failed: ${error.message}`,
      type: "error",
      timeout: 5000
    });
  }
}

// Reset all packaging data
async function resetPackagingData() {
  const snapshot = await getDocs(collection(db, "packaging"));
  const batch = writeBatch(db);
  let updatedCount = 0;

  snapshot.docs.forEach(doc => {
    const variants = Array.isArray(doc.data().variants) ? doc.data().variants : [];
    const updatedVariants = variants.map(v => ({
      ...v,
      packagedQuantity: 0,
      usedStock: 0
    }));

    batch.update(doc.ref, { variants: updatedVariants });
    updatedCount++;
  });

  await batch.commit();
  alert(`Packaging data reset for ${updatedCount} products.`);
}

// ==================================================
// 10. EVENT HANDLERS AND TABLE MANAGEMENT
// ==================================================

function setupEventListeners() {
  // Admin controls
  document.getElementById("generate-packaging").addEventListener("click", generatePackagingCollection);
  document.getElementById("toggle-packaging-table").addEventListener("click", togglePackagingTable);
  document.getElementById("save-packaging").addEventListener("click", savePackagingData);
  document.getElementById("reset-packaging").addEventListener("click", () => showConfirmationModal("reset"));
  
  // Product interaction
  document.getElementById("cancel-scan").addEventListener("click", resetProductDetails);
  document.getElementById("scan-barcode").addEventListener("click", () => {
    const product = state.allProducts.find(p => p.name === dom.productInput.value);
    product ? scanBarcode(product.productId) : alert("Product not found!");
  });

  // Operation mode toggle
 document.getElementById("toggle-operation").addEventListener("click", function() {
    state.isAdding = !state.isAdding;
    updateOperationStyle(); // Add this line
});

  // Modal controls
  document.getElementById("cancel-action").addEventListener("click", () => {
    dom.confirmationModal.style.display = "none";
  });

  document.getElementById('undo-button').addEventListener('click', undoLastAction);
  document.getElementById('redo-button').addEventListener('click', redoLastAction);

  // Autocomplete
  dom.productInput.addEventListener("input", handleProductSearch);
  dom.autocomplete.addEventListener("click", handleAutocompleteSelection);
}

function updateOperationStyle() {
    const toggleBtn = document.getElementById('toggle-operation');
    toggleBtn.textContent = state.isAdding ? '+ Add' : '- Subtract';
    toggleBtn.style.backgroundColor = state.isAdding ? '#3498db' : '#e74c3c';
}

function handleProductSearch(e) {
  const input = e.target.value.toLowerCase();
  dom.autocomplete.innerHTML = "";
  
  if (!input) {
    dom.autocomplete.style.display = "none";
    return;
  }

  const filtered = state.allProducts.filter(p => p.name.toLowerCase().includes(input));
  if (filtered.length) {
    dom.autocomplete.style.display = "block";
    filtered.forEach(p => {
      const div = document.createElement("div");
      div.textContent = p.name;
      div.dataset.productId = p.productId;
      dom.autocomplete.appendChild(div);
    });
  }
}

function handleAutocompleteSelection(e) {
  if (e.target.tagName === "DIV") {
    const productId = e.target.dataset.productId;
    dom.productInput.value = e.target.textContent;
    dom.autocomplete.style.display = "none";
    scanBarcode(productId);
  }
}

function setupPackagingTableListener() {
  onSnapshot(collection(db, "packaging"), (snapshot) => {
    dom.packagingTable.innerHTML = '';
    let totalPackaged = 0, totalUsed = 0;

    snapshot.forEach(doc => {
      const { productName, variants } = doc.data();

      variants.forEach(variant => {
        const variantDisplay = variant.variantName || 
          Object.entries(variant.attributes || {})
            .map(([dim, val]) => `${dim}:${val}`)
            .join(', ') || "—";

        totalPackaged += variant.packagedQuantity;
        totalUsed += variant.usedStock;

        dom.packagingTable.innerHTML += `
          <tr>
            <td title="Product ID: ${doc.id}">${productName}</td>
            <td title="Variant ID: ${variant.variantId || '—'}">${variantDisplay}</td>
            <td>${variant.packagedQuantity.toLocaleString()}</td>
            <td>${variant.usedStock.toLocaleString()}</td>
          </tr>
        `;
      });
    });

    // Add totals row
    dom.packagingTable.innerHTML += `
      <tr style="background: #007bff; color: #fff; font-weight: bold;">
        <td colspan="2" style="text-align: center;">Total =</td>
        <td>${totalPackaged.toLocaleString()}</td>
        <td>${totalUsed.toLocaleString()}</td>
      </tr>
    `;

    dom.totalPackaged.textContent = totalPackaged.toLocaleString();
  });
}

function togglePackagingTable() {
  dom.packagingTableContainer.style.display = 
    dom.packagingTableContainer.style.display === "none" ? "block" : "none";
}

function showConfirmationModal(action) {
  if (action === "reset") {
    dom.modalMessage.textContent = "Are you sure you want to reset all packaging data?";
    document.getElementById("confirm-action").onclick = async () => {
      dom.confirmationModal.style.display = "none";
      await resetPackagingData();
    };
  }
  dom.confirmationModal.style.display = "block";
}

// ==================================================
// INITIALIZATION
// ==================================================

// Temporary service worker cleanup (remove in production)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => registration.unregister());
  });
}