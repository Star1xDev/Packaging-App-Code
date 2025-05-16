// Import Firebase configuration and Firestore services
import { db } from "./firebase-config.js";
import {
    collection, getDocs, doc, setDoc, getDoc, writeBatch,
    updateDoc, onSnapshot, runTransaction, query, where
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { NotificationSystem as notify } from './notification.js';

// ==================================================
// 1. STATE MANAGEMENT AND DOM REFERENCES
// ==================================================

const state = {
    currentProduct: null,
    isAdding: true,
    allProducts: [],
    undoStack: [],
    redoStack: [],
    selectedAttributes: {},
    activeVariant: null
};

const dom = {
    productInput: document.getElementById("product-name-input"),
    returnedQty: document.getElementById("returned-qty"),
    currentReturned: document.getElementById("current-returned"),
    totalReturns: document.getElementById("total-returns"),
    productDetails: document.getElementById("product-details"),
    returnsTable: document.getElementById("returns-table").querySelector("tbody"),
    returnsTableContainer: document.getElementById("returns-table-container"),
    variantSelector: document.getElementById("variant-selector"),
    autocomplete: document.getElementById("autocomplete-suggestions"),
    confirmationModal: document.getElementById("confirmation-modal"),
    saveSpinner: document.getElementById("save-spinner"),
    loadingSpinner: document.getElementById("loading-spinner"),
    modalMessage: document.getElementById("modal-message")
};

// ==================================================
// 2. CORE APPLICATION FUNCTIONS
// ==================================================

function initializeApp() {
    fetchAllProducts();
    setupReturnsTableListener();
    setupEventListeners();
    notify.init();
}

window.addEventListener("load", initializeApp);

// ==================================================
// 3. PRODUCT MANAGEMENT
// ==================================================

async function fetchAllProducts() {
    const snapshot = await getDocs(collection(db, "returns"));
    state.allProducts = snapshot.docs.map(doc => ({
        productId: doc.id,
        name: doc.data().productName,
        variants: doc.data().variants
            ?.filter(v => v.isActive !== false)
            ?.map(v => ({
                ...v,
                returnedQuantity: Number(v.returnedQuantity) || 0
            })) || [],
        variantDimensions: doc.data().variantDimensions
    }));
}

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

function autoSelectVariant(variant) {
    state.selectedAttributes = {...variant.attributes};
    state.activeVariant = variant;
    updateQuantityDisplay();
    renderVariantChips();
}

// ==================================================
// 4. VARIANT SELECTION SYSTEM
// ==================================================

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

    container.querySelectorAll('.chip:not(.disabled)').forEach(chip => {
        chip.addEventListener('click', handleChipClick);
    });
}

function handleChipClick(e) {
    const chip = e.currentTarget;
    const dim = chip.dataset.dim;
    const val = chip.dataset.val;

    if (state.selectedAttributes[dim] === val) {
        delete state.selectedAttributes[dim];
        if (Object.keys(state.selectedAttributes).length === 0) {
            resetVariantDisplay();
        }
    } else {
        state.selectedAttributes[dim] = val;
    }

    state.activeVariant = findVariant();
    updateVariantDisplay();
    renderVariantChips();
}

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

function getUniqueValues(dimension) {
    if (!state.currentProduct?.variants) return [];
    return [...new Set(
        state.currentProduct.variants.map(v => v.attributes[dimension])
    )].filter(Boolean);
}

// ==================================================
// 5. RETURNS OPERATIONS
// ==================================================

async function saveReturn() {
    if (!state.activeVariant || !validateReturnInput()) {
        notify.show({
            message: "Invalid return data! Check your inputs",
            type: "error"
        });
        return;
    }
    
    const returnedQuantity = parseInt(dom.returnedQty.value) || 0;
    const returnsRef = doc(db, "returns", state.currentProduct.productId);

    notify.show({
        message: `Processing return for ${state.currentProduct.name}...`,
        type: "info",
        timeout: 2000
    });

    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(returnsRef);
            const variants = [...docSnap.data().variants];
            
            const variantIndex = variants.findIndex(
                v => v.variantId === state.activeVariant.variantId
            );
            
            if (variantIndex === -1) throw new Error("Variant not found");
            
            const variant = variants[variantIndex];
            const oldValues = {
                returned: variant.returnedQuantity
            };
            
            if (state.isAdding) {
                variant.returnedQuantity += returnedQuantity;
            } else {
                variant.returnedQuantity = Math.max(0, variant.returnedQuantity - returnedQuantity);
            }
            
            updateLocalProductState(variant);
            
            state.undoStack.push({
                productId: state.currentProduct.productId,
                variantId: state.activeVariant.variantId,
                oldValues,
                newValues: {
                    returned: variant.returnedQuantity
                }
            });
            
            transaction.update(returnsRef, { variants });
            state.redoStack = [];
            updateUndoRedoButtons();
        });
        
        notify.show({
            message: `Return ${state.isAdding ? 'added' : 'subtracted'} successfully!`,
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
                returnedQuantity: variant.returnedQuantity
            };
        }
    }
}

async function refreshCurrentVariantData() {
    if (!state.currentProduct?.productId) return;

    const returnsRef = doc(db, "returns", state.currentProduct.productId);
    const docSnap = await getDoc(returnsRef);

    if (docSnap.exists()) {
        const productIndex = state.allProducts.findIndex(
            p => p.productId === state.currentProduct.productId
        );
        if (productIndex !== -1) {
            state.allProducts[productIndex] = {
                ...state.allProducts[productIndex],
                variants: docSnap.data().variants
            };
        }

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
    const returnsRef = doc(db, "returns", action.productId);

    try {
        const product = state.allProducts.find(p => p.productId === action.productId);
        const variant = product?.variants.find(v => v.variantId === action.variantId);
        
        notify.show({
            message: `
                <div class="undo-redo-notification">
                    <strong>UNDO APPLIED</strong>
                    <div class="variant">${product?.name || 'Product'} - ${variant?.variantName || 'Variant'}</div>
                    <div class="change">
                        <span class="label">Returned:</span>
                        <span class="from">${action.newValues.returned}</span>
                        <span class="arrow">→</span>
                        <span class="to">${action.oldValues.returned}</span>
                    </div>
                </div>
            `,
            type: "warning",
            timeout: 5000
        });

        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(returnsRef);
            const variants = [...docSnap.data().variants];
            
            const variantIndex = variants.findIndex(
                v => v.variantId === action.variantId
            );
            
            variants[variantIndex] = {
                ...variants[variantIndex],
                returnedQuantity: action.oldValues.returned
            };
            
            transaction.update(returnsRef, { variants });
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
    const returnsRef = doc(db, "returns", action.productId);

    try {
        const product = state.allProducts.find(p => p.productId === action.productId);
        const variant = product?.variants.find(v => v.variantId === action.variantId);
        
        notify.show({
            message: `
                <div class="undo-redo-notification">
                    <strong>REDO APPLIED</strong>
                    <div class="variant">${product?.name || 'Product'} - ${variant?.variantName || 'Variant'}</div>
                    <div class="change">
                        <span class="label">Returned:</span>
                        <span class="from">${action.oldValues.returned}</span>
                        <span class="arrow">→</span>
                        <span class="to">${action.newValues.returned}</span>
                    </div>
                </div>
            `,
            type: "info",
            timeout: 5000
        });

        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(returnsRef);
            const variants = [...docSnap.data().variants];
            
            const variantIndex = variants.findIndex(
                v => v.variantId === action.variantId
            );
            
            variants[variantIndex] = {
                ...variants[variantIndex],
                returnedQuantity: action.newValues.returned
            };
            
            transaction.update(returnsRef, { variants });
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
    
    undoBtn.style.opacity = undoBtn.disabled ? "0.5" : "1";
    redoBtn.style.opacity = redoBtn.disabled ? "0.5" : "1";
}

// ==================================================
// 7. UI UPDATES AND UTILITIES
// ==================================================

function updateQuantityDisplay() {
    if (!state.activeVariant) {
        dom.currentReturned.textContent = "0";
        return;
    }
    
    dom.currentReturned.textContent = state.activeVariant.returnedQuantity ?? 0;
}

function updateVariantDisplay() {
    if (state.activeVariant) {
        updateQuantityDisplay();
    } else {
        dom.currentReturned.textContent = "0";
    }
}

function resetVariantDisplay() {
    dom.currentReturned.textContent = "0";
    state.activeVariant = null;
}

function resetInputFields() {
    dom.returnedQty.value = "";
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

function validateReturnInput() {
    const returnedQuantity = parseInt(dom.returnedQty.value) || 0;
    
    if (isNaN(returnedQuantity) || returnedQuantity < 0) {
        alert("Returned quantity must be ≥ 0");
        return false;
    }
    
    return true;
}

// ==================================================
// 8. ADMIN AND DATA MANAGEMENT
// ==================================================

async function generateReturnsCollection() {
    notify.show({
        message: "Generating returns collection...",
        type: "info",
        timeout: 3000
    });

    const [productsSnapshot, existingReturnsSnapshot] = await Promise.all([
        getDocs(collection(db, "products")),
        getDocs(collection(db, "returns"))
    ]);

    const batch = writeBatch(db);
    const newProductIds = new Set();

    // Process all products (not filtered by trackPackaging)
    productsSnapshot.forEach(productDoc => {
        const productData = productDoc.data();
        const returnsRef = doc(db, "returns", productData.productId);
        newProductIds.add(productData.productId);

        // Find existing returns data if it exists
        const existingReturnsDoc = existingReturnsSnapshot.docs.find(d => d.id === productData.productId);
        const existingVariants = existingReturnsDoc?.data()?.variants || [];
        const countMap = new Map(existingVariants.map(v => [v.variantId, v.returnedQuantity]));

        // Create variants array preserving existing quantities
        const activeVariants = productData.variants
            ?.filter(v => v.isActive !== false)
            ?.map(v => ({
                variantId: v.variantId,
                variantName: v.variantName || `${v.attributes?.color} - ${v.attributes?.size}`,
                attributes: v.attributes || {},
                returnedQuantity: countMap.get(v.variantId) || 0 // Preserve existing or default to 0
            })) || [];

        if (activeVariants.length > 0) {
            batch.set(returnsRef, {
                productId: productData.productId,
                productName: productData.productName,
                variantDimensions: productData.variantDimensions || [],
                variants: activeVariants
            }, { merge: true });
        } else {
            batch.delete(returnsRef);
        }
    });

    // Remove returns for discontinued products
    existingReturnsSnapshot.docs.forEach(doc => {
        if (!newProductIds.has(doc.id)) {
            batch.delete(doc.ref);
        }
    });

    try {
        await batch.commit();
        fetchAllProducts();
        notify.show({
            message: "Returns collection updated successfully!",
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

async function resetReturnsData() {
    const snapshot = await getDocs(collection(db, "returns"));
    const batch = writeBatch(db);
    let updatedCount = 0;

    snapshot.docs.forEach(doc => {
        const variants = Array.isArray(doc.data().variants) ? doc.data().variants : [];
        const updatedVariants = variants.map(v => ({
            ...v,
            returnedQuantity: 0
        }));

        batch.update(doc.ref, { variants: updatedVariants });
        updatedCount++;
    });

    await batch.commit();
    notify.show({
        message: `Reset ${updatedCount} products in returns collection`,
        type: "success"
    });
}

// ==================================================
// 9. TABLE MANAGEMENT
// ==================================================

function setupReturnsTableListener() {
    onSnapshot(collection(db, "returns"), (snapshot) => {
        dom.returnsTable.innerHTML = '';
        let totalReturns = 0;

        snapshot.forEach(doc => {
            const { productName, variants } = doc.data();

            variants.forEach(variant => {
                const variantDisplay = variant.variantName || 
                    Object.entries(variant.attributes || {})
                        .map(([dim, val]) => `${dim}:${val}`)
                        .join(', ') || "—";

                totalReturns += variant.returnedQuantity;

                dom.returnsTable.innerHTML += `
                    <tr>
                        <td title="Product ID: ${doc.id}">${productName}</td>
                        <td title="Variant ID: ${variant.variantId || '—'}">${variantDisplay}</td>
                        <td>${variant.returnedQuantity.toLocaleString()}</td>
                    </tr>
                `;
            });
        });

        dom.returnsTable.innerHTML += `
            <tr style="background: #007bff; color: #fff; font-weight: bold;">
                <td colspan="2" style="text-align: center;">Total =</td>
                <td>${totalReturns.toLocaleString()}</td>
            </tr>
        `;

        dom.totalReturns.textContent = totalReturns.toLocaleString();
    });
}

function toggleReturnsTable() {
    dom.returnsTableContainer.style.display = 
        dom.returnsTableContainer.style.display === "none" ? "block" : "none";
}

// ==================================================
// 10. EVENT HANDLERS
// ==================================================

function setupEventListeners() {
    // Admin controls
    document.getElementById("generate-returns").addEventListener("click", generateReturnsCollection);
    document.getElementById("toggle-returns-table").addEventListener("click", toggleReturnsTable);
    document.getElementById("save-return").addEventListener("click", saveReturn);
    document.getElementById("reset-returns").addEventListener("click", () => showConfirmationModal("reset"));
    
    // Product interaction
    document.getElementById("cancel-return").addEventListener("click", resetProductDetails);
    document.getElementById("find-product").addEventListener("click", () => {
        const product = state.allProducts.find(p => p.name === dom.productInput.value);
        product ? scanBarcode(product.productId) : alert("Product not found!");
    });

    // Operation mode toggle
    document.getElementById("toggle-operation").addEventListener("click", function() {
        state.isAdding = !state.isAdding;
        this.textContent = state.isAdding ? "+ Add" : "- Subtract";
        this.style.backgroundColor = state.isAdding ? "#3498db" : "#e74c3c";
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

function showConfirmationModal(action) {
    if (action === "reset") {
        dom.modalMessage.textContent = "Are you sure you want to reset all returns data?";
        document.getElementById("confirm-action").onclick = async () => {
            dom.confirmationModal.style.display = "none";
            await resetReturnsData();
        };
    }
    dom.confirmationModal.style.display = "block";
}