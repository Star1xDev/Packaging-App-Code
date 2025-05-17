import { db } from "./firebase-config.js";
import { 
    collection, getDocs, doc, setDoc, writeBatch, query, where,
    onSnapshot, runTransaction
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { NotificationSystem as notify } from './notification.js';


// DOM Elements
const dom = {
    tabs: {
        packaging: document.getElementById("packaging-tab"),
        returns: document.getElementById("returns-tab"),
        buttons: document.querySelectorAll(".tab-btn")
    },
    tables: {
        packaging: {
            body: document.querySelector("#packaging-table tbody"),
            container: document.querySelector("#packaging-tab .table-container")
        },
        returns: {
            body: document.querySelector("#returns-table tbody"),
            container: document.querySelector("#returns-tab .table-container")
        }
    },
    actionButtons: {
        generatePackaging: document.getElementById("generate-packaging"),
        archivePackaging: document.getElementById("archive-packaging"),
        resetPackaging: document.getElementById("reset-packaging"),
        generateReturns: document.getElementById("generate-returns"),
        archiveReturns: document.getElementById("archive-returns"),
        resetReturns: document.getElementById("reset-returns")
    },
    modal: {
        element: document.getElementById("archive-modal"),
        close: document.querySelector(".close-modal"),
        confirm: document.getElementById("confirm-archive"),
        resetCheckbox: document.getElementById("reset-after-archive"),
        title: document.getElementById("modal-title"),
        summaryType: document.getElementById("summary-type"),
        productCount: document.getElementById("product-count"),
        unitCount: document.getElementById("unit-count")
    }
};

// State Management
const state = {
    currentTab: "packaging",
    currentArchiveType: "packaging",
    packagingData: [],
    returnsData: []
};

// Initialize the manager dashboard
function initManager() {
    notify.init();
    setupTabNavigation();
    setupEventListeners();
    loadInitialData();
    enableTableEditing();
}

// Tab Navigation
function setupTabNavigation() {
    dom.tabs.buttons.forEach(button => {
        button.addEventListener("click", () => {
            const tabName = button.dataset.tab;
            
            // Update UI
            dom.tabs.buttons.forEach(btn => btn.classList.remove("active"));
            button.classList.add("active");
            
            document.querySelectorAll(".tab-content").forEach(tab => {
                tab.classList.remove("active");
            });
            document.getElementById(`${tabName}-tab`).classList.add("active");
            
            // Update state
            state.currentTab = tabName;
        });
    });
}

// Load initial data
async function loadInitialData() {
    try {
        // Load packaging data
        const packagingSnapshot = await getDocs(collection(db, "packaging"));
        console.log("Packaging data loaded:", packagingSnapshot.docs);
        // Format and store data
        state.packagingData = packagingSnapshot.docs.map(formatProductData);
        renderPackagingTable();
        
        // Load returns data
        const returnsSnapshot = await getDocs(collection(db, "returns"));
        console.log("Returns data loaded:", returnsSnapshot.docs);
        // Format and store data
        state.returnsData = returnsSnapshot.docs.map(formatProductData);
        renderReturnsTable();
        
        // Set up real-time listeners
        setupRealtimeListeners();
    } catch (error) {
        console.error("Initial load failed:", error);
        alert("Failed to load data. Check console for details.");
    }
}

// Format product data for consistency
function formatProductData(doc) {
    const data = doc.data();
    return {
        id: doc.id,
        name: data.productName,
        variants: data.variants?.map(v => ({
            ...v,
            packagedQuantity: Number(v.packagedQuantity) || 0,
            usedStock: Number(v.usedStock) || 0,
            returnedQuantity: Number(v.returnedQuantity) || 0
        })) || []
    };
}

// Render packaging table
function renderPackagingTable() {
    dom.tables.packaging.body.innerHTML = state.packagingData
        .flatMap(product => 
            product.variants.map(variant => `
                <tr data-product-id="${product.id}" data-variant-id="${variant.variantId}">
                    <td>${product.name}</td>
                    <td>${variant.variantName || Object.values(variant.attributes).join(" ")}</td>
                    <td class="editable" data-field="packagedQuantity">${variant.packagedQuantity}</td>
                    <td class="editable" data-field="usedStock">${variant.usedStock}</td>
                    <td>
                        <button class="btn-save">💾 Save</button>
                    </td>
                </tr>
            `)
        )
        .join("");
}

// Render returns table
function renderReturnsTable() {
    dom.tables.returns.body.innerHTML = state.returnsData
        .flatMap(product => 
            product.variants.map(variant => `
                <tr data-product-id="${product.id}" data-variant-id="${variant.variantId}">
                    <td>${product.name}</td>
                    <td>${variant.variantName || Object.values(variant.attributes).join(" ")}</td>
                    <td class="editable" data-field="returnedQuantity">${variant.returnedQuantity}</td>
                    <td>
                        <button class="btn-save">💾 Save</button>
                    </td>
                </tr>
            `)
        )
        .join("");
}

// Set up real-time listeners
function setupRealtimeListeners() {
    // Packaging listener
    onSnapshot(collection(db, "packaging"), (snapshot) => {
        state.packagingData = snapshot.docs.map(formatProductData);
        if (state.currentTab === "packaging") {
            renderPackagingTable();
        }
    });

    // Returns listener
    onSnapshot(collection(db, "returns"), (snapshot) => {
        state.returnsData = snapshot.docs.map(formatProductData);
        if (state.currentTab === "returns") {
            renderReturnsTable();
        }
    });
}

// Enable table editing functionality
function enableTableEditing() {
    // Add event delegation for editable cells
    document.addEventListener("click", (e) => {
        // Save button handler
        if (e.target.classList.contains("btn-save")) {
            const row = e.target.closest("tr");
            saveRowChanges(row);
        }
        
        // Cell editing handler
        if (e.target.classList.contains("editable")) {
            makeCellEditable(e.target);
        }
    });
}

// Make a table cell editable
function makeCellEditable(cell) {
    const currentValue = cell.textContent;
    cell.innerHTML = `<input type="number" value="${currentValue}" min="0">`;
    const input = cell.querySelector("input");
    input.focus();
    
    // Save on blur or Enter key
    input.addEventListener("blur", saveCell);
    input.addEventListener("keyup", (e) => {
        if (e.key === "Enter") saveCell(e);
    });
    
    function saveCell(e) {
        cell.textContent = input.value;
        const row = cell.closest("tr");
        // Only save if value changed
        if (input.value !== currentValue) {
            saveRowChanges(row);
        }
    }
}

// Save changes from a table row
async function saveRowChanges(row) {
    const productId = row.dataset.productId;
    const variantId = row.dataset.variantId;
    const collectionName = state.currentTab; // "packaging" or "returns"
    const fields = {};
    
    row.querySelectorAll(".editable").forEach(cell => {
        fields[cell.dataset.field] = Number(cell.textContent);
    });
    
    try {
        await runTransaction(db, async (transaction) => {
            const docRef = doc(db, collectionName, productId);
            const docSnap = await transaction.get(docRef);
            
            const updatedVariants = docSnap.data().variants.map(v => {
                if (v.variantId === variantId) {
                    return { ...v, ...fields };
                }
                return v;
            });
            
            transaction.update(docRef, { variants: updatedVariants });
        });
    } catch (error) {
        console.error("Save failed:", error);
        alert("Failed to save changes. Check console for details.");
    }
}

// Show reset modal
function showResetModal(type) {
    const modal = document.getElementById('reset-modal');
    document.getElementById('reset-message').textContent = 
        `Are you sure you want to reset all ${type} data? This cannot be undone.`;
    
    modal.style.display = 'flex';
    
    // Set up confirmation handler
    const confirmBtn = document.getElementById('confirm-reset');
    confirmBtn.onclick = async () => {
        modal.style.display = 'none';
        await resetData(type);
    };
    
    // Cancel handler
    document.getElementById('cancel-reset').onclick = () => {
        modal.style.display = 'none';
    };
}

// Show archive modal
function showArchiveModal(type) {
    state.currentArchiveType = type;
    const data = type === 'packaging' ? state.packagingData : state.returnsData;
    const unitField = type === 'packaging' ? 'packagedQuantity' : 'returnedQuantity';
    
    // Calculate metrics
    const productCount = new Set(data.map(p => p.id)).size;
    const variantCount = data.reduce((sum, p) => sum + p.variants.length, 0);
    const totalUnits = data.reduce((sum, p) => sum + 
        p.variants.reduce((vSum, v) => vSum + v[unitField], 0), 0);

    // Update modal display
    document.getElementById('summary-type').textContent = 
        type === 'packaging' ? '📦 Packaging Data' : '🔄 Returns Data';
    document.getElementById('product-count').textContent = productCount;
    document.getElementById('variant-count').textContent = variantCount;
    document.getElementById('total-units').textContent = totalUnits;
    document.getElementById('unit-label').textContent = 
        type === 'packaging' ? 'Total Packaged' : 'Total Returned';

    // Show modal
    document.getElementById('archive-modal').style.display = 'flex';
}

// Confirm archive action
async function confirmArchive() {
    const shouldReset = document.getElementById('reset-after-archive').checked;
    const type = state.currentArchiveType;
    const data = type === "packaging" ? state.packagingData : state.returnsData;
    const unitField = type === "packaging" ? "packagedQuantity" : "returnedQuantity";
    const batch = writeBatch(db);
    const archiveDate = new Date().toISOString().split("T")[0];
    const archiveCollection = `${type}_archive`;
    
    // Calculate totals
    const totalUnits = data.reduce((sum, product) => sum + 
        product.variants.reduce((vSum, variant) => vSum + variant[unitField], 0), 0);

    // 1. Create enhanced archive document
    const archiveRef = doc(collection(db, archiveCollection), archiveDate);
    batch.set(archiveRef, {
        date: archiveDate,
        [type === "packaging" ? "totalPackaged" : "totalReturned"]: totalUnits,
        products: data.map(product => ({
            productId: product.id,
            productName: product.name,
            variants: product.variants.map(v => ({
                variantId: v.variantId,
                [unitField]: v[unitField]
            }))
        }))
    });
    
    // 2. Reset data if requested
    if (shouldReset) {
        data.forEach(product => {
            const docRef = doc(db, type, product.id);
            batch.update(docRef, {
                variants: product.variants.map(v => ({
                    ...v,
                    [unitField]: 0,
                    ...(type === "packaging" && { usedStock: 0 })
                }))
            });
        });
    }
    
    try {
        await batch.commit();
        document.getElementById('archive-modal').style.display = "none";
        notify.show({
            message: `${type} data archived with totals!`,
            type: "success"
        });
    } catch (error) {
        console.error("Archive failed:", error);
        notify.show({
            message: `Archive failed: ${error.message}`,
            type: "error"
        });
    }
}
// Generate packaging collection from products
async function generatePackagingCollection() {
    try {
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

        // Process products
        productsSnapshot.forEach(productDoc => {
            const productData = productDoc.data();
            newProductIds.add(productData.productId);
            const docRef = doc(db, "packaging", productData.productId);
            
            // Find existing data
            const existingDoc = existingPackagingSnapshot.docs.find(d => d.id === productData.productId);
            const existingVariants = existingDoc?.data()?.variants || [];
            
            // Map existing quantities
            const quantityMap = new Map(
                existingVariants.map(v => [v.variantId, {
                    packaged: v.packagedQuantity,
                    used: v.usedStock
                }])
            );

            // Prepare variants
            const variants = productData.variants
                ?.filter(v => v.isActive !== false)
                ?.map(v => ({
                    variantId: v.variantId,
                    variantName: v.variantName,
                    attributes: v.attributes,
                    packagedQuantity: quantityMap.get(v.variantId)?.packaged || 0,
                    usedStock: quantityMap.get(v.variantId)?.used || 0
                })) || [];

            if (variants.length > 0) {
                batch.set(docRef, {
                    productId: productData.productId,
                    productName: productData.productName,
                    variantDimensions: productData.variantDimensions || [],
                    variants
                }, { merge: true });
            } else {
                batch.delete(docRef);
            }
        });

        // Remove discontinued
        existingPackagingSnapshot.docs.forEach(doc => {
            if (!newProductIds.has(doc.id)) {
                batch.delete(doc.ref);
            }
        });

        await batch.commit();
        
        // Update local state
        const updatedSnapshot = await getDocs(collection(db, "packaging"));
        state.packagingData = updatedSnapshot.docs.map(formatProductData);
        if (state.currentTab === "packaging") {
            renderPackagingTable();
        }
        
        notify.show({
            message: `Packaging data updated (${newProductIds.size} products)`,
            type: "success"
        });
    } catch (error) {
        console.error("Generation failed:", error);
        notify.show({
            message: `Generation failed: ${error.message}`,
            type: "error",
            timeout: 5000
        });
    }
}

// Generate returns collection from products
async function generateReturnsCollection() {
    try {
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

        productsSnapshot.forEach(productDoc => {
            const productData = productDoc.data();
            newProductIds.add(productData.productId);
            const docRef = doc(db, "returns", productData.productId);
            
            const existingDoc = existingReturnsSnapshot.docs.find(d => d.id === productData.productId);
            const existingVariants = existingDoc?.data()?.variants || [];
            const returnMap = new Map(existingVariants.map(v => [v.variantId, v.returnedQuantity]));

            const variants = productData.variants
                ?.filter(v => v.isActive !== false)
                ?.map(v => ({
                    variantId: v.variantId,
                    variantName: v.variantName || formatVariantName(v.attributes),
                    attributes: v.attributes || {},
                    returnedQuantity: returnMap.get(v.variantId) || 0
                })) || [];

            if (variants.length > 0) {
                batch.set(docRef, {
                    productId: productData.productId,
                    productName: productData.productName,
                    variantDimensions: productData.variantDimensions || [],
                    variants
                }, { merge: true });
            } else {
                batch.delete(docRef);
            }
        });

        // Clean up discontinued
        existingReturnsSnapshot.docs.forEach(doc => {
            if (!newProductIds.has(doc.id)) {
                batch.delete(doc.ref);
            }
        });

        await batch.commit();
        
        // Update local state
        const updatedSnapshot = await getDocs(collection(db, "returns"));
        state.returnsData = updatedSnapshot.docs.map(formatProductData);
        if (state.currentTab === "returns") {
            renderReturnsTable();
        }
        
        notify.show({
            message: `Returns data updated (${newProductIds.size} products)`,
            type: "success"
        });
    } catch (error) {
        console.error("Generation failed:", error);
        notify.show({
            message: `Generation failed: ${error.message}`,
            type: "error",
            timeout: 5000
        });
    }
}

// Helper function
function formatVariantName(attributes) {
    return attributes ? Object.values(attributes).join(" - ") : "default";
}

// Reset data
async function resetData(type) {
  const data = type === "packaging" ? state.packagingData : state.returnsData;
  const batch = writeBatch(db);
  
  data.forEach(product => {
    const docRef = doc(db, type, product.id);
    batch.update(docRef, {
      variants: product.variants.map(v => ({
        ...v,
        [type === "packaging" ? "packagedQuantity" : "returnedQuantity"]: 0,
        ...(type === "packaging" && { usedStock: 0 })
      }))
    });
  });
  
  await batch.commit();
  notify.show({
    message: `${type} data reset successfully`,
    type: "success"
  });
}

// Set up event listeners
function setupEventListeners() {
    // Modal controls
    dom.modal.close.addEventListener("click", () => dom.modal.element.style.display = "none");
    dom.modal.confirm.addEventListener("click", confirmArchive);
    
    // Packaging actions
    dom.actionButtons.generatePackaging.addEventListener("click", generatePackagingCollection);
    dom.actionButtons.archivePackaging.addEventListener("click", () => showArchiveModal("packaging"));
    dom.actionButtons.resetPackaging.addEventListener("click", () => showResetModal('packaging'));
    
    // Returns actions
    dom.actionButtons.generateReturns.addEventListener("click", generateReturnsCollection);
    dom.actionButtons.archiveReturns.addEventListener("click", () => showArchiveModal("returns"));
    dom.actionButtons.resetReturns.addEventListener("click", () => showResetModal("returns"));
    
    // Click outside modal to close
    window.addEventListener("click", (e) => {
        if (e.target === dom.modal.element) {
            dom.modal.element.style.display = "none";
        }
    });
}

// Initialize when DOM loads
document.addEventListener("DOMContentLoaded", initManager);