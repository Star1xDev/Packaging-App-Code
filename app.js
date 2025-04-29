// Import Firebase configuration and Firestore services
import { db } from "./firebase-config.js";
import {
    collection, getDocs, doc, setDoc, getDoc,
    updateDoc, onSnapshot, runTransaction,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// ==================================================
// STATE MANAGEMENT
// ==================================================
const state = {
    currentProduct: null,       // Currently selected product object
    selectedVariantIndex: null, // Index of selected product variant
    isAdding: true,             // Operation mode (add/subtract)
    allProducts: [],             // Cache of all products for search
    undoStack: [],  // Stores actions for undo
    redoStack: []   // Stores actions for redo
};

// ==================================================
// DOM REFERENCES
// ==================================================
const dom = {
    productInput: document.getElementById("product-name-input"),         // Product search input
    autocomplete: document.getElementById("autocomplete-suggestions"),  // Autocomplete dropdown
    productDetails: document.getElementById("product-details"),          // Product details container
    variantOptions: document.getElementById("variant-options"),          // Variant selection radio buttons
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

// Clear product detail UI elements
function resetProductDetailsUI() {
    dom.currentPackaged.textContent = "";
    dom.currentUsed.textContent = "";
    dom.packagedQuantity.value = "";
    dom.usedStock.value = "";
    dom.variantOptions.innerHTML = "";
}

// Full reset of product details and search
function resetProductDetails() {
    dom.productInput.value = "";
    dom.autocomplete.style.display = "none";
    dom.productDetails.style.display = "none";
    dom.variantOptions.innerHTML = "";
    state.currentProduct = null;
    state.selectedVariantIndex = null;
}

// ==================================================
// FIRESTORE OPERATIONS
// ==================================================

// Fetch all products from Firestore
async function fetchAllProducts() {
    const productsSnapshot = await getDocs(collection(db, "products"));
    state.allProducts = productsSnapshot.docs.map(doc => doc.data());
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
    const productsSnapshot = await getDocs(collection(db, "products"));
    
    // Process each product document
    for (const productDoc of productsSnapshot.docs) {
        const productData = productDoc.data();
        if (!productData.productId) continue;

        const packagingRef = doc(db, "packaging", productData.productId);
        const packagingSnap = await getDoc(packagingRef);
        
        // Create packaging doc if it doesn't exist
        if (!packagingSnap.exists()) {
            const variants = productData.variants?.length ? 
                // Map product variants to packaging structure
                productData.variants.map(v => ({
                    variantId: v.variantId,
                    name: v.name,
                    packagedQuantity: 0,
                    usedStock: 0
                })) : 
                // Create default variant
                [{ variantId: "default", name: "Default", packagedQuantity: 0, usedStock: 0 }];

            // Create new packaging document
            await setDoc(packagingRef, {
                productId: productData.productId,
                variants
            }, { merge: true });
        }
    }
    alert("Packaging collection created/updated!");
    resetProductDetails();
}

// Reset all packaging data to zero
async function resetPackagingData() {
    const packagingSnapshot = await getDocs(collection(db, "packaging"));
    
    // Update each packaging document
    for (const packagingDoc of packagingSnapshot.docs) {
        const packagingRef = doc(db, "packaging", packagingDoc.id);
        const packagingData = packagingDoc.data();
        
        // Reset variant values
        packagingData.variants.forEach(variant => {
            variant.packagedQuantity = 0;
            variant.usedStock = 0;
        });
        
        // Update Firestore document
        await updateDoc(packagingRef, { variants: packagingData.variants });
    }
    
    alert("All packaging data reset!");
    resetProductDetails();
}

// ==================================================
// UI HANDLERS
// ==================================================

// Handle product selection and display details
async function scanBarcode(productId) {
    const product = await fetchProduct(productId);
    if (!product) return;

    // Reset UI and update state
    dom.productInput.value = "";
    resetProductDetailsUI();
    state.currentProduct = product;
    document.getElementById("product-name").textContent = product.name;

    // Handle variant display
    if (product.variants.length === 1 && product.variants[0].variantId === "default") {
        // Single variant handling
        dom.variantOptions.style.display = "none";
        state.selectedVariantIndex = 0;
        await loadPackagingData(0);
    } else {
        // Multiple variants handling
        dom.variantOptions.style.display = "block";
        // Generate radio buttons for variants
        dom.variantOptions.innerHTML = product.variants
            .map((v, index) => `
                <label>
                    <input type="radio" name="variant" value="${index}" data-index="${index}">
                    ${v.name}
                </label>
            `).join("");

        // Add variant selection handlers
        document.querySelectorAll("input[name='variant']").forEach(input => {
            input.addEventListener("click", () => {
                state.selectedVariantIndex = input.dataset.index;
                loadPackagingData(state.selectedVariantIndex);
            });
        });
    }
    dom.productDetails.style.display = "block";
}

// Load and display packaging data for selected variant
async function loadPackagingData(variantIndex) {
    if (!state.currentProduct) return;

    const packagingRef = doc(db, "packaging", state.currentProduct.productId);
    const packagingSnap = await getDoc(packagingRef);

    if (packagingSnap.exists()) {
        const packagingData = packagingSnap.data();
        const variant = packagingData.variants[variantIndex];
        
        if (variant) {
            // Update UI with current values
            dom.currentPackaged.textContent = variant.packagedQuantity;
            dom.currentUsed.textContent = variant.usedStock;
            state.selectedVariantIndex = variantIndex;
            dom.packagedQuantity.focus();
        } else {
            alert("Selected variant not found!");
        }
    } else {
        alert("Packaging data not found!");
    }
}

// Save packaging data changes to Firestore
async function savePackagingData() {
    if (!state.currentProduct || state.selectedVariantIndex === null) {
        alert("Select a product and variant first!");
        return;
    }

    // Get input values
    const packagedQuantity = parseInt(dom.packagedQuantity.value) || 0;
    const usedStock = parseInt(dom.usedStock.value) || 0;

    // Validate inputs
    if (!validateInput(packagedQuantity, "Packaged Quantity") || 
        !validateInput(usedStock, "Used Stock")) return;

    // Show saving indicator
    dom.saveSpinner.style.display = "block";
    const packagingRef = doc(db, "packaging", state.currentProduct.productId);

    try {
        // Firestore transaction for atomic update
        await runTransaction(db, async (transaction) => {
            const packagingSnap = await transaction.get(packagingRef);
            if (!packagingSnap.exists()) throw new Error("Document not found!");

            const packagingData = packagingSnap.data();
            const variant = packagingData.variants[state.selectedVariantIndex];

            // Store OLD values before making changes
            const oldValues = {
                packaged: variant.packagedQuantity,
                used: variant.usedStock
            };

            // Update values based on operation mode
            if (state.isAdding) {
                variant.packagedQuantity += packagedQuantity;
                variant.usedStock += usedStock;
            } else {
                // Validate subtraction
                if (variant.packagedQuantity - packagedQuantity < 0 || 
                    variant.usedStock - usedStock < 0) {
                    throw new Error("Cannot subtract more than current value!");
                }
                variant.packagedQuantity -= packagedQuantity;
                variant.usedStock -= usedStock;
            }

            // Commit transaction
            transaction.update(packagingRef, { variants: packagingData.variants });

            // Record action for undo AFTER successful save
            state.undoStack.push({
                productId: state.currentProduct.productId,
                variantIndex: state.selectedVariantIndex,
                oldValues: oldValues,
                newValues: {
                    packaged: variant.packagedQuantity,
                    used: variant.usedStock
                }
            });

            // Clear redo stack
            state.redoStack = [];
        });

        alert("Data updated successfully!");
        updateUndoRedoButtons(); // Update button states
    } catch (error) {
        alert(error.message);
    } finally {
        // Cleanup after operation
        dom.saveSpinner.style.display = "none";
        await loadPackagingData(state.selectedVariantIndex);
        dom.packagedQuantity.value = "";
        dom.usedStock.value = "";
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
  
    // Revert to old values
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(packagingRef);
      const variants = [...docSnap.data().variants];
      variants[action.variantIndex] = {
        ...variants[action.variantIndex],
        packagedQuantity: action.oldValues.packaged,
        usedStock: action.oldValues.used
      };
      transaction.update(packagingRef, { variants });
    });
  
    // Push to redo stack
    state.redoStack.push(action);
    updateUndoRedoButtons();
  }
  
  // Redo function
  async function redoLastAction() {
    if (state.redoStack.length === 0) return;
  
    const action = state.redoStack.pop();
    const packagingRef = doc(db, "packaging", action.productId);
  
    // Re-apply new values
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(packagingRef);
      const variants = [...docSnap.data().variants];
      variants[action.variantIndex] = {
        ...variants[action.variantIndex],
        packagedQuantity: action.newValues.packaged,
        usedStock: action.newValues.used
      };
      transaction.update(packagingRef, { variants });
    });
  
    // Push back to undo stack
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
    onSnapshot(collection(db, "packaging"), async (snapshot) => {
        dom.loadingSpinner.style.display = "block";
        dom.packagingTable.innerHTML = "";
        let totalPackaged = 0, totalUsed = 0;

        // Process each packaging document
        for (const doc of snapshot.docs) {
            const packagingData = doc.data();
            const product = await fetchProduct(packagingData.productId);

            // Process each variant
            packagingData.variants.forEach(variant => {
                const variantName = product.variants.find(v => v.variantId === variant.variantId)?.name || "Unknown";
                // Update totals
                totalPackaged += variant.packagedQuantity;
                totalUsed += variant.usedStock;

                // Add table row
                dom.packagingTable.innerHTML += `
                    <tr>
                        <td title="ID: ${packagingData.productId}">${product.name}</td>
                        <td title="ID: ${variant.variantId}">${variantName}</td>
                        <td>${variant.packagedQuantity.toLocaleString()}</td>
                        <td>${variant.usedStock.toLocaleString()}</td>
                    </tr>
                `;
            });
        }

        // Add totals row
        dom.packagingTable.innerHTML += `
            <tr style="background: #007bff; color: #fff;">
                <td colspan="2" style="text-align: center; font-weight: bold;">Total =</td>
                <td>${totalPackaged.toLocaleString()}</td>
                <td>${totalUsed.toLocaleString()}</td>
            </tr>
        `;

        // Update UI
        dom.totalPackaged.textContent = totalPackaged.toLocaleString();
        dom.loadingSpinner.style.display = "none";
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