import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    onSnapshot,
    runTransaction,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// ==================================================
// Global State Management
// ==================================================
const state = {
    currentProduct: null,
    selectedVariantIndex: null,
    isAdding: true,
    allProducts: [] // Store all products for autocomplete
};

// ==================================================
// Helper Functions
// ==================================================

/**
 * Validates the input value to ensure it's a non-negative number.
 * @param {number} value - The input value to validate.
 * @param {string} fieldName - The name of the field being validated (for error messages).
 * @returns {boolean} - Returns true if the input is valid, otherwise false.
 */
function validateInput(value, fieldName) {
    if (isNaN(value) || value < 0) {
        alert(`Please enter a valid number for ${fieldName}.`);
        return false;
    }
    return true;
}

/**
 * Resets the product details UI to its default state.
 */
function resetProductDetailsUI() {
    document.getElementById("current-packaged").textContent = "";
    document.getElementById("current-used").textContent = "";
    document.getElementById("packaged-quantity").value = "";
    document.getElementById("used-stock").value = "";
    document.getElementById("variant-options").innerHTML = "";
}

// ==================================================
// Firestore Operations
// ==================================================

async function fetchAllProducts() {
    const productsSnapshot = await getDocs(collection(db, "products"));
    state.allProducts = productsSnapshot.docs.map(doc => doc.data());
}

/**
 * Fetches a product from Firestore and adds a default variant if none exist.
 * @param {string} productId - The ID of the product to fetch.
 * @returns {Promise<Object|null>} - Returns the product data if found, otherwise null.
 */
async function fetchProduct(productId) {
    const productRef = doc(db, "products", productId);
    const productSnap = await getDoc(productRef);

    if (!productSnap.exists()) return null;

    const productData = productSnap.data();

    // If the product has no variants, add a default variant
    if (!productData.variants || productData.variants.length === 0) {
        productData.variants = [
            {
                variantId: "default",
                name: "Default",
            },
        ];
    }

    return productData;
}

/**
 * Generates the packaging collection from the products collection.
 */
async function generatePackagingCollection() {
    console.log("Generating packaging collection...");
    const productsSnapshot = await getDocs(collection(db, "products"));

    for (const productDoc of productsSnapshot.docs) {
        const productData = productDoc.data();
        if (!productData.productId) continue;

        const packagingRef = doc(db, "packaging", productData.productId);
        const packagingSnap = await getDoc(packagingRef);

        // Only create/update the packaging document if it doesn't exist
        if (!packagingSnap.exists()) {
            let packagingData = {
                productId: productData.productId,
                variants: [],
            };

            // If the product has no variants, add a default variant
            if (!productData.variants || productData.variants.length === 0) {
                packagingData.variants.push({
                    variantId: "default",
                    name: "Default",
                    packagedQuantity: 0,
                    usedStock: 0,
                });
            } else {
                // Add all variants from the product
                productData.variants.forEach((variant) => {
                    packagingData.variants.push({
                        variantId: variant.variantId,
                        name: variant.name,
                        packagedQuantity: 0,
                        usedStock: 0,
                    });
                });
            }

            // Create the packaging document
            await setDoc(packagingRef, packagingData, { merge: true });
        }
    }
    alert("Packaging collection has been created/updated without resetting data!");

    // Reset the UI
    resetProductDetails();
}

/**
 * Handles barcode scanning and displays product details.
 */
async function scanBarcode(productId) {
    const product = await fetchProduct(productId);
    const input = document.getElementById("product-name-input");

    if (product) {
        input.value = ""; // Clear input field
        resetProductDetailsUI();
        state.currentProduct = product;
        document.getElementById("product-name").textContent = product.name;

        const variantOptions = document.getElementById("variant-options");

        if (product.variants.length === 1 && product.variants[0].variantId === "default") {
            // Hide variant selection for products with only a default variant
            variantOptions.style.display = "none";
            state.selectedVariantIndex = 0; // Automatically select the default variant

            // Load packaging data for the default variant
            await loadPackagingData(state.selectedVariantIndex);
        } else {
            // Show variant selection for products with multiple variants
            variantOptions.style.display = "block";
            variantOptions.innerHTML = product.variants
                .map(
                    (v, index) => `
                    <label>
                        <input type="radio" name="variant" value="${index}" data-index="${index}">
                        ${v.name}
                    </label>
                `
                )
                .join("");

            document.querySelectorAll("input[name='variant']").forEach((input) => {
                input.addEventListener("click", function () {
                    state.selectedVariantIndex = this.dataset.index;
                    loadPackagingData(state.selectedVariantIndex);
                });
            });
        }

        document.getElementById("product-details").style.display = "block";
    }
}

// ==================================================
// Autocomplete Functionality
// ==================================================
document.getElementById("product-name-input").addEventListener("input", function(e) {
    const input = e.target.value.toLowerCase();
    const suggestions = document.getElementById("autocomplete-suggestions");
    
    suggestions.innerHTML = "";
    if (!input) {
        suggestions.style.display = "none";
        return;
    }

    const filteredProducts = state.allProducts.filter(product => 
        product.name.toLowerCase().includes(input)
    );

    if (filteredProducts.length > 0) {
        suggestions.style.display = "block";
        filteredProducts.forEach(product => {
            const div = document.createElement("div");
            div.textContent = product.name;
            div.dataset.productId = product.productId;
            suggestions.appendChild(div);
        });
    }
});

document.getElementById("autocomplete-suggestions").addEventListener("click", function(e) {
    if (e.target.tagName === "DIV") {
        const productId = e.target.dataset.productId;
        document.getElementById("product-name-input").value = e.target.textContent;
        this.style.display = "none";
        scanBarcode(productId);
    }
});

/**
 * Loads the packaging data for the selected variant.
 * @param {number} variantIndex - The index of the selected variant.
 */
async function loadPackagingData(variantIndex) {
    if (!state.currentProduct) return; // Ensure a product is selected

    const packagingRef = doc(db, "packaging", state.currentProduct.productId);
    const packagingSnap = await getDoc(packagingRef);

    if (packagingSnap.exists()) {
        const packagingData = packagingSnap.data();

        // Ensure the selected variant exists
        if (packagingData.variants && packagingData.variants[variantIndex]) {
            const selectedVariant = packagingData.variants[variantIndex];

            // Display current values
            document.getElementById("current-packaged").textContent = selectedVariant.packagedQuantity;
            document.getElementById("current-used").textContent = selectedVariant.usedStock;
            state.selectedVariantIndex = variantIndex;

            // Autofocus on the packagedQuantity input field
            document.getElementById("packaged-quantity").focus();
        } else {
            alert("Selected variant does not exist in packaging data.");
        }
    } else {
        alert("Packaging data not found for this product. Please generate the packaging collection first.");
    }
}

/**
 * Saves packaging data with addition/subtraction logic.
 */
async function savePackagingData() {
    if (state.currentProduct && state.selectedVariantIndex !== null) {
        const packagedQuantity = parseInt(document.getElementById("packaged-quantity").value) || 0;
        const usedStock = parseInt(document.getElementById("used-stock").value) || 0;

        if (!validateInput(packagedQuantity, "Packaged Quantity") || !validateInput(usedStock, "Used Stock")) {
            return;
        }

        // Show the save spinner
        document.getElementById("save-spinner").style.display = "block";

        const packagingRef = doc(db, "packaging", state.currentProduct.productId);

        try {
            await runTransaction(db, async (transaction) => {
                const packagingSnap = await transaction.get(packagingRef);
                if (!packagingSnap.exists()) {
                    throw new Error("Document does not exist!");
                }

                let packagingData = packagingSnap.data();
                const selectedVariant = packagingData.variants[state.selectedVariantIndex];

                // Apply addition or subtraction
                if (state.isAdding) {
                    selectedVariant.packagedQuantity += packagedQuantity;
                    selectedVariant.usedStock += usedStock;
                } else {
                    // Prevent negative values
                    if (selectedVariant.packagedQuantity - packagedQuantity < 0 || selectedVariant.usedStock - usedStock < 0) {
                        throw new Error("Cannot subtract more than the current value!");
                    }
                    selectedVariant.packagedQuantity -= packagedQuantity;
                    selectedVariant.usedStock -= usedStock;
                }

                transaction.update(packagingRef, { variants: packagingData.variants });
            });

            alert("Packaging data updated successfully!");
        } catch (error) {
            alert(error.message);
        } finally {
            // Hide the save spinner
            document.getElementById("save-spinner").style.display = "none";
            await loadPackagingData(state.selectedVariantIndex); // Refresh the UI
            document.getElementById("packaged-quantity").value = "";
            document.getElementById("used-stock").value = "";
        }
    } else {
        alert("Please select a product and variant first.");
    }
}

/**
 * Resets all packaging data to 0.
 */
async function resetPackagingData() {
    console.log("Resetting packaging data...");
    const packagingSnapshot = await getDocs(collection(db, "packaging"));

    for (const packagingDoc of packagingSnapshot.docs) {
        const packagingRef = doc(db, "packaging", packagingDoc.id);
        const packagingData = packagingDoc.data();

        packagingData.variants.forEach((variant) => {
            variant.packagedQuantity = 0;
            variant.usedStock = 0;
        });

        await updateDoc(packagingRef, { variants: packagingData.variants });
    }
    
    alert("All packaging data has been reset!");
    resetProductDetails();  // Let the real-time listener update the table
}

/**
 * Resets the product details view.
 */
function resetProductDetails() {
    // Clear additional elements
    document.getElementById("product-name-input").value = "";
    document.getElementById("autocomplete-suggestions").style.display = "none";

    // Hide the product details section
    document.getElementById("product-details").style.display = "none";

    // Clear the barcode input
    document.getElementById("barcode").value = "";

    // Clear the input fields
    document.getElementById("packaged-quantity").value = "";
    document.getElementById("used-stock").value = "";

    // Clear the variant options
    document.getElementById("variant-options").innerHTML = "";

    // Clear the current values
    document.getElementById("current-packaged").textContent = "";
    document.getElementById("current-used").textContent = "";

    // Reset global variables
    state.currentProduct = null;
    state.selectedVariantIndex = null;
}

/**
 * Sets up the real-time listener for the packaging table.
 */
function setupPackagingTableListener() {
    const packagingTable = document.getElementById("packaging-table").getElementsByTagName("tbody")[0];
    const totalPackagedElement = document.getElementById("total-packaged");

    // Set up a real-time listener for the packaging collection
    const packagingCollection = collection(db, "packaging");
    onSnapshot(packagingCollection, async (snapshot) => {
        // Show loading spinner
        document.getElementById("loading-spinner").style.display = "block";

        // Clear the table before populating it with new data
        packagingTable.innerHTML = "";

        let totalPackagedQuantity = 0;
        let totalUsedStock = 0;

        for (const packagingDoc of snapshot.docs) {
            const packagingData = packagingDoc.data();
            const product = await fetchProduct(packagingData.productId);

            packagingData.variants.forEach((variant) => {
                const variantDetails = product.variants.find((v) => v.variantId === variant.variantId);
                const variantName = variantDetails ? variantDetails.name : "Unknown";

                // Add to totals
                totalPackagedQuantity += variant.packagedQuantity;
                totalUsedStock += variant.usedStock;

                // Insert a row for the variant
                let row = packagingTable.insertRow();
                row.innerHTML = `
                    <td title="ID: ${packagingData.productId}">${product.name}</td>
                    <td title="ID: ${variant.variantId}">${variantName}</td>
                    <td>${variant.packagedQuantity.toLocaleString()}</td>
                    <td>${variant.usedStock.toLocaleString()}</td>
                `;
            });
        }

        // Update the total packaged quantity in the header
        totalPackagedElement.textContent = totalPackagedQuantity.toLocaleString();

        // Add a total row at the bottom of the table
        let totalRow = packagingTable.insertRow();
        totalRow.style.backgroundColor = "#007bff";
        totalRow.style.color = "#fff";
        totalRow.style.borderRadius = "8px";
        totalRow.style.marginTop = "10px";
        totalRow.innerHTML = `
            <td colspan="2" style="text-align: center; font-weight: bold;">Total =</td>
            <td style="font-weight: bold;">${totalPackagedQuantity.toLocaleString()}</td>
            <td style="font-weight: bold;">${totalUsedStock.toLocaleString()}</td>
        `;

        // Hide loading spinner
        document.getElementById("loading-spinner").style.display = "none";
    });
}

/**
 * Toggles the packaging table visibility.
 */
function togglePackagingTable() {
    const tableContainer = document.getElementById("packaging-table-container");
    if (tableContainer.style.display === "none") {
        tableContainer.style.display = "block";
    } else {
        tableContainer.style.display = "none";
    }
}

// ==================================================
// Event Listeners
// ==================================================

document.getElementById("generate-packaging").addEventListener("click", generatePackagingCollection);
document.getElementById("toggle-packaging-table").addEventListener("click", togglePackagingTable);
document.getElementById("save-packaging").addEventListener("click", savePackagingData);
document.getElementById("reset-packaging").addEventListener("click", () => showConfirmationModal("reset"));
document.getElementById("cancel-scan").addEventListener("click", resetProductDetails);
// Add this instead (optional scan button):
document.getElementById("scan-barcode").addEventListener("click", () => {
    const input = document.getElementById("product-name-input");
    const suggestions = document.getElementById("autocomplete-suggestions");
    const product = state.allProducts.find(p => p.name === input.value);
    
    suggestions.style.display = "none"; // Hide dropdown
    
    if (product) {
        scanBarcode(product.productId);
        input.value = ""; // Clear input after successful scan
    } else {
        alert("Product not found!");
    }
});

document.getElementById("toggle-operation").addEventListener("click", function() {
    state.isAdding = !state.isAdding;
    this.textContent = state.isAdding ? "+ Add" : "- Subtract";
    this.classList.toggle("subtract", !state.isAdding);
});

// Confirmation Modal Logic
function showConfirmationModal(action) {
    const modal = document.getElementById("confirmation-modal");
    const modalMessage = document.getElementById("modal-message");
    const confirmButton = document.getElementById("confirm-action");

    if (action === "reset") {
        modalMessage.textContent = "Are you sure you want to reset all packaging data? This action cannot be undone.";
        confirmButton.onclick = async () => {
            hideConfirmationModal();
            await resetPackagingData();
        };
    }

    modal.style.display = "block";
}

function hideConfirmationModal() {
    document.getElementById("confirmation-modal").style.display = "none";
}

document.getElementById("cancel-action").addEventListener("click", hideConfirmationModal);

// Initialize the real-time listener when the page loads
window.addEventListener("load", () => {
    fetchAllProducts(); // Add this line
    setupPackagingTableListener();
});

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('SW registered:', registration);
        })
        .catch(error => {
          console.log('SW registration failed:', error);
        });
    });
  }