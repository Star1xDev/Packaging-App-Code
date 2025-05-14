import { db } from "./firebase-config.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// App state to track the product creation process
const state = {
    productName: "",
    packagingPrice: 0,
    trackPackaging: false,
    variantDimensions: [],  // Example: ["color", "size"]
    dimensionValues: {},    // Example: { color: ["Red", "Blue"], size: ["S", "M"] }
    variants: []            // Final variant objects with attributes like price/inventory
};

// DOM elements grouped for easy reference
const dom = {
    step1: document.getElementById("step-1"),
    step2: document.getElementById("step-2"),
    step3: document.getElementById("step-3"),
    step4: document.getElementById("step-4"),
    productName: document.getElementById("product-name"),
    packagingPrice: document.getElementById("packaging-price"),
    trackPackaging : document.getElementById("track-packaging"),
    dimensionsContainer: document.getElementById("dimensions-container"),
    selectedDimensions: document.getElementById("selected-dimensions"),
    dimensionValuesContainer: document.getElementById("dimension-values-container"),
    variantsTable: document.getElementById("variants-table").querySelector("tbody"),
    saveProductBtn: document.getElementById("save-product")
};

// ===============================
// Step 1 → Step 2 (Product Name)
// ===============================
// ===============================
// Step 1 → Step 2 (Product Name)
// ===============================
document.getElementById("next-to-step-2").addEventListener("click", () => {
    console.log("Moving to Step 2");
    // Validate that the product name is provided
    if (!dom.productName.value) return alert("Enter a product name!");
    // Validate that the packaging price is not negative
    if (dom.packagingPrice.value < 0) return alert("Enter a valid packaging price!");
    // Default packaging price to 0 if empty
    state.packagingPrice = dom.packagingPrice.value
        ? parseFloat(dom.packagingPrice.value)
        : 0;
    console.log("Packaging Price:", state.packagingPrice);
    // Save product name
    state.productName = dom.productName.value;
    console.log("Product Name:", state.productName);
    // Save checkbox value (true if checked, false otherwise)
    state.trackPackaging = document.getElementById("track-packaging").checked;
    console.log("Track Packaging:", state.trackPackaging);
    // Move to Step 2
    dom.step1.classList.remove("active");
    dom.step2.classList.add("active");
});


// ====================================
// Handle clicking on dimension tags
// ====================================
dom.dimensionsContainer.addEventListener("click", (e) => {
    const tag = e.target.closest(".dimension-tag");  // Make sure click is on a tag
    if (tag) {
        const dimension = tag.dataset.dimension;
        if (!state.variantDimensions.includes(dimension)) {
            state.variantDimensions.push(dimension);
            console.log("Added dimension:", dimension);
            renderSelectedDimensions();
        }
    }
});

// =====================================
// Handle custom dimension input (Enter)
// =====================================
document.getElementById("custom-dimension").addEventListener("keypress", (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
        const dimension = e.target.value.trim().toLowerCase();
        if (!state.variantDimensions.includes(dimension)) {
            state.variantDimensions.push(dimension);
            console.log("Custom dimension added:", dimension);
            renderSelectedDimensions();

            // Create visual tag for new custom dimension
            const tag = document.createElement("div");
            tag.className = "dimension-tag";
            tag.textContent = dimension;
            tag.dataset.dimension = dimension;
            dom.dimensionsContainer.insertBefore(tag, e.target);
        }
        e.target.value = ""; // Clear input
    }
});

// ===========================
// Step 2 → Step 3 or Step 4
// ===========================
document.getElementById("next-to-step-3").addEventListener("click", () => {
    const noVariants = document.getElementById("no-variants-checkbox").checked;

    if (noVariants) {
        // Product has no variants
        console.log("No variants selected. Proceeding to Step 4.");
        state.variants = [{
            variantId: "default",
            variantName: "Standard Product",
            attributes: {},
            currentStock: 0,
            isActive: true
        }];
        dom.step2.classList.remove("active");
        dom.step4.classList.add("active");
        renderVariantsTable();
    } else if (state.variantDimensions.length === 0) {
        alert("Select dimensions or check 'no variants'");
    } else {
        console.log("Dimensions selected:", state.variantDimensions);
        renderDimensionValueInputs();
        dom.step2.classList.remove("active");
        dom.step3.classList.add("active");
    }
});


// If "No Variants" is checked, clear any selected variant dimensions
// to prevent confusion and keep the UI in sync with the logic
document.getElementById("no-variants-checkbox").addEventListener("change", (e) => {
    if (e.target.checked) {
        state.variantDimensions = []; // Clear any dimension selections
        renderSelectedDimensions();   // Clear the visual tags
    }
});


// ========================
// Generate variant combos
// ========================
document.getElementById("generate-variants").addEventListener("click", () => {
    // First: Validate that all inputs are filled
    const missingValues = state.variantDimensions.filter(dim => {
        const input = document.querySelector(`input[data-dimension="${dim}"]`);
        return !input.value.trim();
    });

    if (missingValues.length > 0) {
        return alert(`Enter values for: ${missingValues.join(", ")}`);
    }

    // Now: Build `dimensionValues` from inputs
    state.dimensionValues = {};
    state.variantDimensions.forEach(dim => {
        const input = document.querySelector(`input[data-dimension="${dim}"]`);
        state.dimensionValues[dim] = input.value
            .split(",")
            .map(v => v.trim())
            .filter(Boolean); // Removes empty strings
    });

    console.log("Dimension values:", state.dimensionValues);

    // Now that `state.dimensionValues` exists — validate for duplicates
    const hasDuplicateValues = state.variantDimensions.some(dim => {
        const values = state.dimensionValues[dim];
        const normalized = values.map(v => v.toLowerCase());
        const uniqueValues = new Set(normalized);
        return uniqueValues.size !== values.length;
    });

    if (hasDuplicateValues) {
        return alert("❌ Remove duplicate values (e.g., 'Red, red')");
    }

    // Generate all combinations (Cartesian product)
    state.variants = generateAllCombinations();
    console.log("Generated variants:", state.variants);

    if (state.variants.length === 0) {
        return alert("❌ No variants generated. Please check your input values.");
    }

    renderVariantsTable();
    dom.step3.classList.remove("active");
    dom.step4.classList.add("active");
});


// ============================
// Save product to Firestore
// ============================
dom.saveProductBtn.addEventListener("click", async () => {
    const productId = state.productName.toLowerCase().replace(/\s+/g, "_");
    const productRef = doc(db, "products", productId);

    console.log("Saving product to Firestore:", productId);

    try {
        await setDoc(productRef, {
            productId,
            productName: state.productName,
            packagingPrice: state.packagingPrice, // Always include packaging price
            trackPackaging: state.trackPackaging,
            variantDimensions: state.variantDimensions,
            variants: state.variants.filter(v => v.isActive)  // Save only active variants
        });
        alert("Product saved successfully!");
        window.location.href = "index.html";
    } catch (error) {
        console.error("Firestore save error:", error);
        alert("Error saving product: " + error.message);
    }
});

// =======================
// Render selected tags
// =======================
function renderSelectedDimensions() {
    dom.selectedDimensions.innerHTML = state.variantDimensions
        .map(dim => `<span class="dimension-tag">${dim}</span>`)
        .join("");
}

// ======================================
// Show inputs for dimension values
// ======================================
function renderDimensionValueInputs() {
    dom.dimensionValuesContainer.innerHTML = state.variantDimensions
        .map(dim => `
            <label>
                ${dim} values (comma-separated):
                <input 
                    type="text" 
                    data-dimension="${dim}" 
                    placeholder="e.g., ${dim === 'color' ? 'Red, Blue' : 'S, M'}"
                    required
                >
            </label>
        `).join("");
}

// ==================================================
// Generate all combinations of entered dimensions
// ==================================================
function generateAllCombinations() {
    const dimensions = state.variantDimensions;
    const values = dimensions.map(dim => state.dimensionValues[dim]);
    const combinations = cartesianProduct(values);

    return combinations.map(combo => {
        const attributes = {};
        const dimensionValues = dimensions.map((dim, i) => combo[i]);
        
        // Generate display-friendly name (e.g. "Red - Large")
        const variantName = dimensionValues.join(" - "); 
        
        // Generate ID (e.g. "red_large")
        const variantId = dimensionValues.map(v => v.toLowerCase()).join("_");

        dimensions.forEach((dim, i) => {
            attributes[dim] = combo[i];
        });

        return {
            variantId,
            variantName,
            attributes,
            currentStock: 0,
            isActive: true
        };
    });
}

// ====================================
// Cartesian Product Utility Function
// ====================================
function cartesianProduct(arr) {
    return arr.reduce((a, b) =>
        a.flatMap(x => b.map(y => [...x, y])), [[]]);
}

// ===========================
// Render variants table
// ===========================
function renderVariantsTable() {
    dom.variantsTable.innerHTML = state.variants.map(variant => `
        <tr data-variant-id="${variant.variantId}">
            <td><input type="checkbox" class="variant-checkbox" 
                 ${variant.isActive ? 'checked' : ''}></td>
            <td>${variant.variantName}</td>  <!-- Use display name -->
            <td>${JSON.stringify(variant.attributes)}</td>
            <td><input type="number" class="variant-stock" 
                 value="${variant.currentStock}"></td>
        </tr>
    `).join("");

    // Update event listener to handle currentStock instead of inventory
    dom.variantsTable.addEventListener('change', (e) => {
        const row = e.target.closest('tr');
        const variantId = row.dataset.variantId;
        const variant = state.variants.find(v => v.variantId === variantId);

        if (e.target.classList.contains('variant-checkbox')) {
            variant.isActive = e.target.checked;
        } 
        else if (e.target.classList.contains('variant-stock')) {
            variant.currentStock = parseInt(e.target.value) || 0;
        }
    });
}
