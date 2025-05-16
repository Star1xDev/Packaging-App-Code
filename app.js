// Import Firebase configuration and Firestore services
import { db } from "./firebase-config.js";
import {
    collection, getDocs, doc, setDoc, getDoc, writeBatch,
    updateDoc, onSnapshot, runTransaction, query, where,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// ==================================================
// STATE MANAGEMENT
// ==================================================
const state = {
  currentProduct: null,
  isAdding: true,
  allProducts: [],
  undoStack: [],
  redoStack: [],
  selectedAttributes: {},  // Simple {color: "red", size: "large"} 
  activeVariant: null,  // This will be set when a variant is selected
};



// ==================================================
// DOM REFERENCES
// ==================================================
const dom = {
    productInput: document.getElementById("product-name-input"),         // Product search input
    autocomplete: document.getElementById("autocomplete-suggestions"),  // Autocomplete dropdown
    productDetails: document.getElementById("product-details"),          // Product details container
    currentPackaged: document.getElementById("current-packaged"),        // Current packaged quantity display
    currentUsed: document.getElementById("current-used"),                // Current used stock display
    packagedQuantity: document.getElementById("packaged-quantity"),      // Packaged quantity input
    usedStock: document.getElementById("used-stock"),                    // Used stock input
    saveSpinner: document.getElementById("save-spinner"),                // Saving progress indicator
    loadingSpinner: document.getElementById("loading-spinner"),          // Loading progress indicator
    packagingTable: document.getElementById("packaging-table").querySelector("tbody"), // Data table body
    totalPackaged: document.getElementById("total-packaged"),            // Total packaged display
    packagingTableContainer: document.getElementById("packaging-table-container"), // Table container
    confirmationModal: document.getElementById("confirmation-modal"),    // Confirmation dialog
    modalMessage: document.getElementById("modal-message")               // Modal message text
};

// ==================================================
// HELPER FUNCTIONS
// ==================================================

// Validate numeric input values
function validateInput(value, fieldName) {
    if (isNaN(value) || value < 0) {
        alert(`Please enter a valid number for ${fieldName}.`);
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

// Full reset of product details and search
function resetProductDetails() {
  // Clear inputs
  dom.packagedQuantity.value = "";
  dom.usedStock.value = "";
  
  // Reset ALL displays to 0 (crucial fix)
  dom.currentPackaged.textContent = "0";
  dom.currentUsed.textContent = "0";
  
  // Clear state
  state.currentProduct = null;
  state.selectedAttributes = {};
  state.activeVariant = null;
  
  // UI Cleanup
  dom.productInput.value = "";
  dom.autocomplete.style.display = "none";
  dom.productDetails.style.display = "none";
  document.getElementById("variant-selector").innerHTML = "";
}

// Get unique values for a dimension (e.g. ["Red", "Blue"] for "color")
function getUniqueValues(dimension) {
  if (!state.currentProduct?.variants) return [];
  return [...new Set(
    state.currentProduct.variants.map(v => v.attributes[dimension])
  )].filter(Boolean); // Remove undefined/empty
}

// Simple deep equality check (for variant matching)
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function updateQuantityDisplay() {
  if (!state.activeVariant) return;
  
  // FIX 3: Ensure we show current values even if null/undefined
  dom.currentPackaged.textContent = state.activeVariant.packagedQuantity ?? 0;
  dom.currentUsed.textContent = state.activeVariant.usedStock ?? 0;
  
  // FIX 4: Visual feedback for current mode
  const toggleBtn = document.getElementById('toggle-operation');
  toggleBtn.textContent = state.isAdding ? '+ Add' : '- Subtract';
  toggleBtn.style.backgroundColor = state.isAdding ? '#3498db' : '#e74c3c';
}

// ==================================================
// FIRESTORE OPERATIONS
// ==================================================

// Fetch all products from Firestore
// Add this to fetchAllProducts() to ensure fresh data
async function fetchAllProducts() {
  const snapshot = await getDocs(collection(db, "packaging"));
  state.allProducts = snapshot.docs.map(doc => ({
    productId: doc.id,
    name: doc.data().productName,
    variants: doc.data().variants.map(v => ({
      ...v,
      // Ensure numeric values
      packagedQuantity: Number(v.packagedQuantity) || 0,
      usedStock: Number(v.usedStock) || 0
    })),
    variantDimensions: doc.data().variantDimensions
  }));
}

// Get single product with variant handling
async function fetchProduct(productId) {
    const productRef = doc(db, "products", productId);
    const productSnap = await getDoc(productRef);
    if (!productSnap.exists()) return null;

    const productData = productSnap.data();
    // Add default variant if none exist
    if (!productData.variants?.length) {
        productData.variants = [{ variantId: "default", name: "Default" }];
    }
    return productData;
}

// Initialize packaging collection from products
async function generatePackagingCollection() {
  const [productsSnapshot, existingPackagingSnapshot] = await Promise.all([
    getDocs(query(collection(db, "products"), where("trackPackaging", "==", true))),
    getDocs(collection(db, "packaging"))
  ]);

  const batch = writeBatch(db);

  // Keep track of all packaging productIds
  const activeProductIds = new Set();
  const newProductIds = new Set();

  // STEP 1: Process all active products
  for (const productDoc of productsSnapshot.docs) {
    const productData = productDoc.data();
    const packagingRef = doc(db, "packaging", productData.productId);
    const packagingSnap = await getDoc(packagingRef);

    newProductIds.add(productData.productId);

    const existingData = packagingSnap.exists() ? packagingSnap.data() : null;
    const existingVariants = existingData?.variants || [];

    const countMap = new Map();
    existingVariants.forEach(v => {
      countMap.set(v.variantId, {
        packaged: v.packagedQuantity,
        used: v.usedStock
      });
    });

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

  // STEP 2: Delete packaging docs for products that are no longer tracking packaging
  for (const packagingDoc of existingPackagingSnapshot.docs) {
    const packagingData = packagingDoc.data();
    const packagingProductId = packagingData.productId;

    if (!newProductIds.has(packagingProductId)) {
      const packagingRef = doc(db, "packaging", packagingProductId);
      batch.delete(packagingRef);
    }
  }

  await batch.commit();
  fetchAllProducts(); // Refresh product list
  alert("Packaging collection updated safely!");
}


// Reset all packaging data to zero
async function resetPackagingData() {
  const snapshot = await getDocs(collection(db, "packaging"));
  const batch = writeBatch(db);
  let updatedCount = 0;

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const variants = Array.isArray(data.variants) ? data.variants : [];

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
// UI HANDLERS
// ==================================================

// Handle product selection and display details
// ==================================================
// MODIFY scanBarcode()
// ==================================================
// Update scanBarcode()
async function scanBarcode(productId) {
  // Reset everything first (new)
  resetProductDetails();
  
  const product = state.allProducts.find(p => p.productId === productId);
  if (!product?.variants?.length) return;

  state.currentProduct = product;
  document.getElementById("product-name").textContent = product.name;

  if (product.variants.length === 1) {
    autoSelectVariant(product.variants[0]);
  } else {
    renderVariantChips();
  }
  
  dom.productDetails.style.display = "block";
}


// ==================================================
// VARIANT SELECTION SYSTEM (Complete Implementation)
// ==================================================

function autoSelectVariant(variant) {
  state.selectedAttributes = {...variant.attributes};
  state.activeVariant = variant;
  updateQuantityDisplay();
  renderVariantChips(); // Re-render to show selection
}

/**
 * Checks if a variant exists with the given attributes
 * @param {Object} attributes - The attributes to check (e.g. {color: "red"})
 * @returns {boolean} True if at least one variant matches
 */
function isVariantAvailable(attributes) {
  return state.currentProduct.variants.some(v => {
    // Check if variant matches all currently selected attributes
    return Object.keys(attributes).every(
      dim => v.attributes[dim] === attributes[dim]
    );
  });
}

/**
 * Renders dimension chips with proper enabled/disabled states
 */
function renderVariantChips() {
  const container = document.getElementById('variant-selector');
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
            
            // Only disable if:
            // 1. Not currently selected
            // 2. No variants exist with this value + other selections
            const shouldDisable = !isSelected && 
              !hasVariantWithSelection(dim, val);

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

  // Add event listeners
  container.querySelectorAll('.chip:not(.disabled)').forEach(chip => {
    chip.addEventListener('click', handleChipClick);
  });
}

// Helper to check for variant existence
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
 * Handles chip selection and updates application state
 */
function handleChipClick(e) {
  const chip = e.currentTarget;
  const dim = chip.dataset.dim;
  const val = chip.dataset.val;

  // Toggle selection
  if (state.selectedAttributes[dim] === val) {
    // DESELECT - Clear this dimension
    delete state.selectedAttributes[dim];
    
    // SPECIAL CASE: If this was the last dimension
    if (Object.keys(state.selectedAttributes).length === 0) {
      state.activeVariant = null;
      dom.currentPackaged.textContent = "0";
      dom.currentUsed.textContent = "0";
    }
  } else {
    // SELECT - Update selection
    state.selectedAttributes[dim] = val;
  }

  // Always find matching variant (may be null)
  state.activeVariant = findVariant();
  
  // Update UI based on current state
  if (state.activeVariant) {
    updateQuantityDisplay();
  } else {
    // Explicitly clear if no variant matches
    dom.currentPackaged.textContent = "0";
    dom.currentUsed.textContent = "0";
  }

  // Re-render chips to update visual states
  renderVariantChips();
}

/**
 * Finds the first variant matching current attribute selections
 * @returns {Object|null} The matching variant or null
 */
function findVariant() {
  const selectedDims = Object.keys(state.selectedAttributes);
  
  // No selection case
  if (selectedDims.length === 0) return null;
  
  // Check against product's variant dimensions
  const allDims = state.currentProduct.variantDimensions || [];
  
  // Only match if ALL dimensions are selected
  if (selectedDims.length !== allDims.length) return null;
  
  return state.currentProduct.variants.find(v => 
    allDims.every(dim => 
      v.attributes[dim] === state.selectedAttributes[dim]
    )
  );
}


// Save packaging data changes to Firestore
async function savePackagingData() {
  if (!state.activeVariant || !validatePackagingInput()) return;
  
  const { packagedQuantity, usedStock } = getInputValues();
  const packagingRef = doc(db, "packaging", state.currentProduct.productId);

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
      
      // Update local state (NEW)
      const productIndex = state.allProducts.findIndex(
        p => p.productId === state.currentProduct.productId
      );
      if (productIndex !== -1) {
        const variantIndexLocal = state.allProducts[productIndex].variants.findIndex(
          v => v.variantId === state.activeVariant.variantId
        );
        if (variantIndexLocal !== -1) {
          state.allProducts[productIndex].variants[variantIndexLocal] = {
            ...state.allProducts[productIndex].variants[variantIndexLocal],
            packagedQuantity: variant.packagedQuantity,
            usedStock: variant.usedStock
          };
        }
      }
      
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
    });
    
    refreshCurrentVariantData();
    dom.packagedQuantity.value = "";
    dom.usedStock.value = "";
    
  } catch (error) {
    console.error("Save failed:", error);
    alert("Save error: " + error.message);
  }
}

// Add this new helper function
async function refreshCurrentVariantData() {
  if (!state.currentProduct?.productId) return;

  const packagingRef = doc(db, "packaging", state.currentProduct.productId);
  const docSnap = await getDoc(packagingRef);

  if (docSnap.exists()) {
    // Update allProducts array (NEW)
    const productIndex = state.allProducts.findIndex(
      p => p.productId === state.currentProduct.productId
    );
    if (productIndex !== -1) {
      state.allProducts[productIndex] = {
        ...state.allProducts[productIndex],
        variants: docSnap.data().variants
      };
    }

    // Update active variant if exists
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

// Update button states
function updateUndoRedoButtons() {
    document.getElementById('undo-button').disabled = state.undoStack.length === 0;
    document.getElementById('redo-button').disabled = state.redoStack.length === 0;
  }
  
// Undo function
async function undoLastAction() {
  if (state.undoStack.length === 0) return;

  const action = state.undoStack.pop();
  const packagingRef = doc(db, "packaging", action.productId);

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

  // Update UI
  if (state.currentProduct?.productId === action.productId) {
    state.activeVariant.packagedQuantity = action.oldValues.packaged;
    state.activeVariant.usedStock = action.oldValues.used;
    updateQuantityDisplay();
  }
  
  state.redoStack.push(action);
  updateUndoRedoButtons();
}

async function redoLastAction() {
  if (state.redoStack.length === 0) return;

  const action = state.redoStack.pop();
  const packagingRef = doc(db, "packaging", action.productId);

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

  // Update UI
  if (state.currentProduct?.productId === action.productId) {
    state.activeVariant.packagedQuantity = action.newValues.packaged;
    state.activeVariant.usedStock = action.newValues.used;
    updateQuantityDisplay();
  }
  
  state.undoStack.push(action);
  updateUndoRedoButtons();
}

// ==================================================
// AUTOCOMPLETE HANDLERS
// ==================================================

// Handle product search input
dom.productInput.addEventListener("input", function(e) {
    const input = e.target.value.toLowerCase();
    dom.autocomplete.innerHTML = "";
    
    if (!input) {
        dom.autocomplete.style.display = "none";
        return;
    }

    // Filter products based on search input
    const filtered = state.allProducts.filter(p => p.name.toLowerCase().includes(input));
    if (filtered.length) {
        dom.autocomplete.style.display = "block";
        // Create suggestion items
        filtered.forEach(p => {
            const div = document.createElement("div");
            div.textContent = p.name;
            div.dataset.productId = p.productId;
            dom.autocomplete.appendChild(div);
        });
    }
});

// Handle autocomplete selection
dom.autocomplete.addEventListener("click", e => {
    if (e.target.tagName === "DIV") {
        const productId = e.target.dataset.productId;
        dom.productInput.value = e.target.textContent;
        dom.autocomplete.style.display = "none";
        scanBarcode(productId);
    }
});

// ==================================================
// TABLE HANDLERS
// ==================================================

// Set up real-time packaging table updates
function setupPackagingTableListener() {
  onSnapshot(collection(db, "packaging"), (snapshot) => {
    dom.packagingTable.innerHTML = '';
    let totalPackaged = 0, totalUsed = 0;

    snapshot.forEach(doc => {
      const { productName, variants } = doc.data();

      variants.forEach(variant => {
        // Generate readable variant display
        const variantDisplay = variant.variantName || 
          Object.entries(variant.attributes || {})
            .map(([dim, val]) => `${dim}:${val}`)
            .join(', ') || "—";

        // Update totals
        totalPackaged += variant.packagedQuantity;
        totalUsed += variant.usedStock;

        // Append table row with tooltips
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

    // Append totals row with visual styling
    dom.packagingTable.innerHTML += `
      <tr style="background: #007bff; color: #fff; font-weight: bold;">
        <td colspan="2" style="text-align: center;">Total =</td>
        <td>${totalPackaged.toLocaleString()}</td>
        <td>${totalUsed.toLocaleString()}</td>
      </tr>
    `;

    // Update header total display
    dom.totalPackaged.textContent = totalPackaged.toLocaleString();
  });

   
}


// Toggle packaging table visibility
function togglePackagingTable() {
    dom.packagingTableContainer.style.display = 
        dom.packagingTableContainer.style.display === "none" ? "block" : "none";
}

// ==================================================
// EVENT LISTENERS & INITIALIZATION
// ==================================================

// Set up all event listeners
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
        this.textContent = state.isAdding ? "+ Add" : "- Subtract";
        this.classList.toggle("subtract", !state.isAdding);
    });

    // Modal controls
    document.getElementById("cancel-action").addEventListener("click", () => {
        dom.confirmationModal.style.display = "none";
    });

    document.getElementById('undo-button').addEventListener('click', undoLastAction);
    document.getElementById('redo-button').addEventListener('click', redoLastAction);
}

// Show confirmation dialog for destructive actions
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

// // PWA Installation Handler
// window.addEventListener('beforeinstallprompt', e => {
//     e.preventDefault();
//     // Create install button
//     const installBtn = document.createElement('button');
//     installBtn.id = 'installBtn';
//     installBtn.textContent = 'Install App';
//     installBtn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:1000;';
    
//     // Handle install button click
//     installBtn.addEventListener('click', () => {
//         installBtn.style.display = 'none';
//         e.prompt().then(() => e = null);
//     });
    
//     document.body.appendChild(installBtn);
// });

// Initialize application
window.addEventListener("load", () => {
    fetchAllProducts();           // Load product data
    setupPackagingTableListener();// Start real-time table updates
    setupEventListeners();        // Register event handlers
});

// ⚠️ Temporary code - REMOVE LATER ⚠️
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => registration.unregister());
      console.log('All Service Workers unregistered');
    });
  }