import { db } from './firebase-config.js';
import { 
    collection, getDocs, doc, setDoc, getDoc,
    updateDoc, onSnapshot, runTransaction
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';

// ==================================================
// STATE MANAGEMENT
// ==================================================
const state = {
    currentProduct: null,       // Currently selected product object
    selectedVariantIndex: null, // Index of selected product variant
    allProducts: [],            // Cache of all products for search
    isAdding: true,             // Operation mode (add/subtract)
    undoStack: [],              // Stores actions for undo
    redoStack: []               // Stores actions for redo
};

// ==================================================
// DOM REFERENCES
// ==================================================
const dom = {
    productInput: document.getElementById("product-name-input"),
    autocomplete: document.getElementById("autocomplete-suggestions"),
    productDetails: document.getElementById("product-details"),
    variantOptions: document.getElementById("variant-options"),
    currentReturned: document.getElementById("current-returned"),
    returnedQty: document.getElementById("returned-qty"),
    saveSpinner: document.getElementById("save-spinner"),
    loadingSpinner: document.getElementById("loading-spinner"),
    returnsTable: document.getElementById("returns-table").querySelector("tbody"),
    totalReturns: document.getElementById("total-returns"),
    returnsTableContainer: document.getElementById("returns-table-container"),
    confirmationModal: document.getElementById("confirmation-modal"),
    modalMessage: document.getElementById("modal-message")
};

// ==================================================
// HELPER FUNCTIONS
// ==================================================

function validateInput(value, fieldName) {
    if (isNaN(value) || value < 0) {
        alert(`Please enter a valid number for ${fieldName}.`);
        return false;
    }
    return true;
}

function resetProductDetailsUI() {
    dom.currentReturned.textContent = "";
    dom.returnedQty.value = "";
    dom.variantOptions.innerHTML = "";
}

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

async function fetchAllProducts() {
    const productsSnapshot = await getDocs(collection(db, "products"));
    state.allProducts = productsSnapshot.docs.map(doc => doc.data());
}

async function fetchProduct(productId) {
    const productRef = doc(db, "products", productId);
    const productSnap = await getDoc(productRef);
    if (!productSnap.exists()) return null;

    const productData = productSnap.data();
    if (!productData.variants?.length) {
        productData.variants = [{ variantId: "default", name: "Default" }];
    }
    return productData;
}

async function generateReturnsCollection() {
    const productsSnapshot = await getDocs(collection(db, "products"));
    
    for (const productDoc of productsSnapshot.docs) {
        const productData = productDoc.data();
        if (!productData.productId) continue;

        const returnsRef = doc(db, "returns", productData.productId);
        const returnsSnap = await getDoc(returnsRef);
        
        if (!returnsSnap.exists()) {
            const variants = productData.variants?.length ? 
                productData.variants.map(v => ({
                    variantId: v.variantId,
                    name: v.name,
                    returnedQuantity: 0
                })) : 
                [{ variantId: "default", name: "Default", returnedQuantity: 0 }];

            await setDoc(returnsRef, {
                productId: productData.productId,
                variants
            }, { merge: true });
        }
    }
    alert("Returns collection created/updated!");
    resetProductDetails();
}

// ==================================================
// UI HANDLERS
// ==================================================

async function scanBarcode(productId) {
    const product = await fetchProduct(productId);
    if (!product) return;

    dom.productInput.value = "";
    resetProductDetailsUI();
    state.currentProduct = product;
    document.getElementById("product-name").textContent = product.name;

    if (product.variants.length === 1 && product.variants[0].variantId === "default") {
        dom.variantOptions.style.display = "none";
        state.selectedVariantIndex = 0;
        await loadReturnData(0);
    } else {
        dom.variantOptions.style.display = "block";
        dom.variantOptions.innerHTML = product.variants
            .map((v, index) => `
                <label>
                    <input type="radio" name="variant" value="${index}" data-index="${index}">
                    ${v.name}
                </label>
            `).join("");

        document.querySelectorAll("input[name='variant']").forEach(input => {
            input.addEventListener("click", () => {
                state.selectedVariantIndex = input.dataset.index;
                loadReturnData(state.selectedVariantIndex);
            });
        });
    }
    dom.productDetails.style.display = "block";
}

async function loadReturnData(variantIndex) {
    if (!state.currentProduct) return;

    const returnsRef = doc(db, "returns", state.currentProduct.productId);
    const returnsSnap = await getDoc(returnsRef);

    if (returnsSnap.exists()) {
        const returnsData = returnsSnap.data();
        const variant = returnsData.variants[variantIndex];
        
        if (variant) {
            dom.currentReturned.textContent = variant.returnedQuantity;
            state.selectedVariantIndex = variantIndex;
            dom.returnedQty.focus();
        } else {
            alert("Selected variant not found!");
        }
    } else {
        alert("Returns data not found!");
    }
}

async function saveReturn() {
    // Validate selection and inputs
    if (!state.currentProduct || state.selectedVariantIndex === null) {
        alert("Please select a product and variant first!");
        return;
    }

    const returnedQuantity = parseInt(dom.returnedQty.value) || 0;
    if (!validateInput(returnedQuantity, "Returned Quantity")) return;

    // Show saving indicator
    dom.saveSpinner.style.display = "block";
    const returnsRef = doc(db, "returns", state.currentProduct.productId);

    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(returnsRef);
            if (!docSnap.exists()) throw new Error("Returns document not found!");

            const returnsData = docSnap.data();
            const variant = returnsData.variants[state.selectedVariantIndex];

            // Store old values for undo
            const oldValues = {
                returned: variant.returnedQuantity
            };

            // Calculate new value based on operation mode
            let newQuantity;
            if (state.isAdding) {
                newQuantity = variant.returnedQuantity + returnedQuantity;
            } else {
                newQuantity = variant.returnedQuantity - returnedQuantity;
                if (newQuantity < 0) {
                    throw new Error("Cannot have negative returned quantity!");
                }
            }

            // Update variant
            variant.returnedQuantity = newQuantity;

            // Commit transaction
            transaction.update(returnsRef, { variants: returnsData.variants });

            // Record action for undo
            state.undoStack.push({
                productId: state.currentProduct.productId,
                variantIndex: state.selectedVariantIndex,
                oldValues: oldValues,
                newValues: {
                    returned: newQuantity
                }
            });

            // Clear redo stack
            state.redoStack = [];
        });

        // Success feedback
        alert(`Return ${state.isAdding ? 'added' : 'subtracted'} successfully!`);
        updateUndoRedoButtons();
        
    } catch (error) {
        console.error("Save failed:", error);
        alert(`Error: ${error.message}`);
    } finally {
        // Cleanup
        dom.saveSpinner.style.display = "none";
        await loadReturnData(state.selectedVariantIndex);
        dom.returnedQty.value = "";
    }
}

function updateUndoRedoButtons() {
    document.getElementById('undo-button').disabled = state.undoStack.length === 0;
    document.getElementById('redo-button').disabled = state.redoStack.length === 0;
}

async function undoLastAction() {
    if (state.undoStack.length === 0) return;

    const action = state.undoStack.pop();
    const returnsRef = doc(db, "returns", action.productId);

    await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(returnsRef);
        const variants = [...docSnap.data().variants];
        variants[action.variantIndex] = {
            ...variants[action.variantIndex],
            returnedQuantity: action.oldValues.returned
        };
        transaction.update(returnsRef, { variants });
    });

    state.redoStack.push(action);
    updateUndoRedoButtons();
}

async function redoLastAction() {
    if (state.redoStack.length === 0) return;

    // Get the last undone action (don't pop yet)
    const action = state.redoStack[state.redoStack.length - 1];
    const returnsRef = doc(db, "returns", action.productId);

    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(returnsRef);
            const variants = [...docSnap.data().variants];
            
            // Apply the redo values
            variants[action.variantIndex] = {
                ...variants[action.variantIndex],
                returnedQuantity: action.newValues.returned
            };
            
            transaction.update(returnsRef, { variants });
        });

        // Move action from redo stack back to undo stack
        state.redoStack.pop();
        state.undoStack.push(action);
        
        updateUndoRedoButtons();
    } catch (error) {
        console.error("Redo failed:", error);
        alert("Error during redo: " + error.message);
    }
}

// ==================================================
// TABLE HANDLERS
// ==================================================

function setupReturnsTableListener() {
    onSnapshot(collection(db, "returns"), async (snapshot) => {
        dom.loadingSpinner.style.display = "block";
        dom.returnsTable.innerHTML = "";
        let totalReturns = 0;

        for (const doc of snapshot.docs) {
            const returnsData = doc.data();
            const product = await fetchProduct(doc.id);

            returnsData.variants.forEach(variant => {
                const variantName = product?.variants.find(v => v.variantId === variant.variantId)?.name || "Unknown";
                totalReturns += variant.returnedQuantity;

                // REMOVE THE CONDITION - ALWAYS SHOW ROW
                dom.returnsTable.innerHTML += `
                    <tr>
                        <td title="ID: ${returnsData.productId}">${product?.name || doc.id}</td>
                        <td title="ID: ${variant.variantId}">${variantName}</td>
                        <td>${variant.returnedQuantity.toLocaleString()}</td>
                    </tr>
                `;
            });
        }

        dom.returnsTable.innerHTML += `
            <tr style="background: #007bff; color: #fff;">
                <td colspan="2" style="text-align: center; font-weight: bold;">Total =</td>
                <td>${totalReturns.toLocaleString()}</td>
            </tr>
        `;

        dom.totalReturns.textContent = totalReturns.toLocaleString();
        dom.loadingSpinner.style.display = "none";
    });
}

function toggleReturnsTable() {
    dom.returnsTableContainer.style.display = 
        dom.returnsTableContainer.style.display === "none" ? "block" : "none";
}

// ==================================================
// EVENT LISTENERS & INITIALIZATION
// ==================================================

function setupEventListeners() {

    // Add to your setupEventListeners() function
    document.getElementById("toggle-operation").addEventListener("click", function() {
        state.isAdding = !state.isAdding;
        this.textContent = state.isAdding ? "+ Add" : "- Subtract";
        this.classList.toggle("subtract", !state.isAdding);
    });
    // Admin controls
    document.getElementById("generate-returns").addEventListener("click", generateReturnsCollection);
    document.getElementById("toggle-returns-table").addEventListener("click", toggleReturnsTable);
    document.getElementById("save-return").addEventListener("click", saveReturn);
    document.getElementById("reset-returns").addEventListener("click", () => showConfirmationModal("reset"));
    
    // Product interaction
    document.getElementById("cancel-return").addEventListener("click", resetProductDetails);
    document.getElementById("scan-barcode").addEventListener("click", () => {
        const product = state.allProducts.find(p => p.name === dom.productInput.value);
        product ? scanBarcode(product.productId) : alert("Product not found!");
    });

    // Modal controls
    document.getElementById("cancel-action").addEventListener("click", () => {
        dom.confirmationModal.style.display = "none";
    });

    document.getElementById('undo-button').addEventListener('click', undoLastAction);
    document.getElementById('redo-button').addEventListener('click', redoLastAction);

    // Autocomplete
    dom.productInput.addEventListener("input", function(e) {
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
    });

    dom.autocomplete.addEventListener("click", e => {
        if (e.target.tagName === "DIV") {
            const productId = e.target.dataset.productId;
            dom.productInput.value = e.target.textContent;
            dom.autocomplete.style.display = "none";
            scanBarcode(productId);
        }
    });
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

async function resetReturnsData() {
    const returnsSnapshot = await getDocs(collection(db, "returns"));
    
    for (const returnsDoc of returnsSnapshot.docs) {
        const returnsRef = doc(db, "returns", returnsDoc.id);
        const returnsData = returnsDoc.data();
        
        returnsData.variants.forEach(variant => {
            variant.returnedQuantity = 0;
        });
        
        await updateDoc(returnsRef, { variants: returnsData.variants });
    }
    
    alert("All returns data reset!");
    resetProductDetails();
}

// Initialize application
window.addEventListener("load", () => {
    fetchAllProducts();
    setupReturnsTableListener();
    setupEventListeners();
});