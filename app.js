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

// Global variables
let currentProduct = null; // Stores the currently selected product
let selectedVariantIndex = null; // Stores the index of the selected variant
let isAdding = true; // Track whether the user is adding or subtracting

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
 * Fetches a product from Firestore and adds a default variant if none exist.
 * @param {string} productId - The ID of the product to fetch.
 * @returns {Promise<Object|null>} - Returns the product data if found, otherwise null.
 */
export async function fetchProduct(productId) {
    const productRef = doc(db, "products", productId);
    const productSnap = await getDoc(productRef);

    if (!productSnap.exists()) return null;

    const productData = productSnap.data();

    // If the product has no variants, add a default variant
    if (!productData.variants || productData.variants.length === 0) {
        productData.variants = [
            {
                variantId: "default",
                name: "Default"
            }
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
                variants: []
            };

            // If the product has no variants, add a default variant
            if (!productData.variants || productData.variants.length === 0) {
                packagingData.variants.push({
                    variantId: "default",
                    name: "Default",
                    packagedQuantity: 0,
                    usedStock: 0
                });
            } else {
                // Add all variants from the product
                productData.variants.forEach(variant => {
                    packagingData.variants.push({
                        variantId: variant.variantId,
                        name: variant.name,
                        packagedQuantity: 0,
                        usedStock: 0
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
async function scanBarcode() {
    
    const barcode = document.getElementById("barcode").value;
    const product = await fetchProduct(barcode);

    if (product) {
        resetProductDetailsUI();
        currentProduct = product;
        document.getElementById("product-name").textContent = product.name;

        const variantOptions = document.getElementById("variant-options");

        if (product.variants.length === 1 && product.variants[0].variantId === "default") {
            // Hide variant selection for products with only a default variant
            variantOptions.style.display = "none";
            selectedVariantIndex = 0; // Automatically select the default variant

            // Load packaging data for the default variant
            await loadPackagingData(selectedVariantIndex);
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

            document.querySelectorAll("input[name='variant']").forEach(input => {
                input.addEventListener("click", function () {
                    selectedVariantIndex = this.dataset.index;
                    loadPackagingData(selectedVariantIndex);
                });
            });
        }

        document.getElementById("product-details").style.display = "block";
    }
}

/**
 * Loads the packaging data for the selected variant.
 * @param {Object} product - The product data.
 * @param {number} variantIndex - The index of the selected variant.
 */
async function loadPackagingData(variantIndex) {
    if (!currentProduct) return; // Ensure a product is selected

    const packagingRef = doc(db, "packaging", currentProduct.productId);
    const packagingSnap = await getDoc(packagingRef);

    if (packagingSnap.exists()) {
        const packagingData = packagingSnap.data();

        // Ensure the selected variant exists
        if (packagingData.variants && packagingData.variants[variantIndex]) {
            const selectedVariant = packagingData.variants[variantIndex];

            // Display current values
            document.getElementById("current-packaged").textContent = selectedVariant.packagedQuantity;
            document.getElementById("current-used").textContent = selectedVariant.usedStock;
            selectedVariantIndex = variantIndex;

            // Autofocus on the packagedQuantity input field
            document.getElementById("packaged-quantity").focus();
        } else {
            alert("Selected variant does not exist in packaging data.");
        }
    } else {
        // If the packaging document doesn't exist, show an error
        alert("Packaging data not found for this product. Please generate the packaging collection first.");
    }
}

/**
 * Toggles between addition and subtraction modes.
 */
document.getElementById("toggle-operation").addEventListener("click", function () {
    isAdding = !isAdding; // Toggle the state
    this.textContent = isAdding ? "+ Add" : "- Subtract"; // Update button text
    this.classList.toggle("subtract", !isAdding); // Toggle CSS class
});

/**
 * Saves packaging data with addition/subtraction logic.
 */
async function savePackagingData() {
    if (currentProduct && selectedVariantIndex !== null) {
        const packagedQuantity = parseInt(document.getElementById("packaged-quantity").value) || 0;
        const usedStock = parseInt(document.getElementById("used-stock").value) || 0;

        if (!validateInput(packagedQuantity, "Packaged Quantity") || !validateInput(usedStock, "Used Stock")) {
            return;
        }

        // Show the save spinner
        document.getElementById("save-spinner").style.display = "block";

        const packagingRef = doc(db, "packaging", currentProduct.productId);

        try {
            // Use a Firestore transaction
            await runTransaction(db, async (transaction) => {
                // Read the document
                const packagingSnap = await transaction.get(packagingRef);
                if (!packagingSnap.exists()) {
                    throw new Error("Document does not exist!");
                }

                let packagingData = packagingSnap.data();
                const selectedVariant = packagingData.variants[selectedVariantIndex];

                // Apply addition or subtraction
                if (isAdding) {
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

                // Update the document within the transaction
                transaction.update(packagingRef, { variants: packagingData.variants });
            });

            alert("Packaging data updated successfully!");
        } catch (error) {
            alert(error.message); // Show error message to the user
        } finally {
            // Hide the save spinner
            document.getElementById("save-spinner").style.display = "none";
        }

        // Refresh the UI with the updated values
        await loadPackagingData(selectedVariantIndex);

        // Reset the input fields
        document.getElementById("packaged-quantity").value = "";
        document.getElementById("used-stock").value = "";
    } else {
        alert("Please select a product and variant first.");
    }
}

/**
 * Resets all packaging data to 0.
 */
async function resetPackagingData() {
    const isConfirmed = confirm("Are you sure you want to reset all packaging data? This action cannot be undone.");
    if (!isConfirmed) return; // Exit if the user cancels

    console.log("Resetting packaging data...");
    const packagingSnapshot = await getDocs(collection(db, "packaging"));

    for (const packagingDoc of packagingSnapshot.docs) {
        const packagingRef = doc(db, "packaging", packagingDoc.id);
        const packagingData = packagingDoc.data();

        packagingData.variants.forEach(variant => {
            variant.packagedQuantity = 0;
            variant.usedStock = 0;
        });

        await updateDoc(packagingRef, { variants: packagingData.variants });
    }
    alert("All packaging data has been reset!");

    // Reset the UI
    resetProductDetails();
}

/**
 * Resets the product details view.
 */
function resetProductDetails() {
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
    currentProduct = null;
    selectedVariantIndex = null;
}

function resetProductDetailsUI() {
    // Clear the current values
    document.getElementById("current-packaged").textContent = "";
    document.getElementById("current-used").textContent = "";

    // Clear the input fields
    document.getElementById("packaged-quantity").value = "";
    document.getElementById("used-stock").value = "";

    // Clear the variant options
    document.getElementById("variant-options").innerHTML = "";
}

/**
 * Sets up the real-time listener for the packaging table.
 */
function setupPackagingTableListener() {
    const packagingTable = document.getElementById("packaging-table").getElementsByTagName("tbody")[0];
    const totalPackagedElement = document.getElementById("total-packaged");

    onSnapshot(collection(db, "packaging"), async (snapshot) => {
        let totalPackagedQuantity = 0;

        packagingTable.innerHTML = "";
        snapshot.forEach((doc) => {
            const packagingData = doc.data();
            packagingData.variants.forEach(variant => {
                totalPackagedQuantity += variant.packagedQuantity;
            });
        });

        totalPackagedElement.textContent = totalPackagedQuantity.toLocaleString();
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

// Event Listeners
document.getElementById("generate-packaging").addEventListener("click", generatePackagingCollection);
document.getElementById("scan-barcode").addEventListener("click", scanBarcode);
document.getElementById("toggle-packaging-table").addEventListener("click", togglePackagingTable);
document.getElementById("save-packaging").addEventListener("click", savePackagingData);
document.getElementById("reset-packaging").addEventListener("click", () => showConfirmationModal("reset"));
document.getElementById("cancel-scan").addEventListener("click", resetProductDetails);

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
    setupPackagingTableListener();
});