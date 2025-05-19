import { db } from "./firebase-config.js";
import { 
    collection, getDocs, doc, runTransaction, writeBatch,
    onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { NotificationSystem as notify } from './notification.js';

// DOM Elements with clear stock-specific names
const stockDOM = {
    tableBody: document.querySelector("#stock-table tbody"),
    addBtn: document.getElementById("add-product"),
    resetBtn: document.getElementById("reset-stock")
};

// State Management
let stockProducts = [];

// Initialize Stock Page
function initializeStockManager() {
    console.log("Initializing stock manager");
    setupStockEventHandlers();
    loadStockProducts();
}

// Load stock data
async function loadStockProducts() {
    try {
        const productsQuery = query(
            collection(db, "products"),
            orderBy("productName")
        );
        
        const snapshot = await getDocs(productsQuery);
        stockProducts = processStockProducts(snapshot);
        renderStockTable();
        setupStockRealtimeUpdates();
    } catch (error) {
        console.error("Error loading stock:", error);
        notify.show({
            message: "Failed to load stock data",
            type: "error"
        });
    }
}

// Process Firestore data
function processStockProducts(snapshot) {
    return snapshot.docs
        .map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.productName,
                variantDimensions: data.variantDimensions || [],
                variants: (data.variants || [])
                    .filter(v => v.isActive !== false)
                    .map(v => ({
                        ...v,
                        currentStock: Number(v.currentStock) || 0
                    }))
            };
        })
        .filter(product => product.variants.length > 0);
}

// Set up real-time listener
function setupStockRealtimeUpdates() {
    const productsQuery = query(
        collection(db, "products"),
        orderBy("productName")
    );
    
    onSnapshot(productsQuery, (snapshot) => {
        stockProducts = processStockProducts(snapshot);
        renderStockTable();
    });
}

// Render stock table
function renderStockTable() {
    stockDOM.tableBody.innerHTML = stockProducts.flatMap(product => 
        product.variants.map(variant => `
            <tr data-stock-product-id="${product.id}" data-stock-variant-id="${variant.variantId}">
                <td>${product.name}</td>
                <td>${variant.variantName || formatStockVariantName(variant.attributes)}</td>
                <td class="stock-editable-cell" data-stock-field="currentStock">${variant.currentStock}</td>
                <td>
                    <button class="stock-save-btn">💾 Save</button>
                </td>
            </tr>
        `)
    ).join("");
}

// Format variant name
function formatStockVariantName(attributes) {
    return attributes ? Object.values(attributes).join(" / ") : "Default";
}

// Set up event listeners
function setupStockEventHandlers() {
    // Table event delegation
    stockDOM.tableBody.addEventListener('click', (e) => {
        // Handle cell clicks
        if (e.target.classList.contains('stock-editable-cell')) {
            makeStockCellEditable(e.target);
        }
        
        // Handle save button clicks
        if (e.target.classList.contains('stock-save-btn')) {
            const row = e.target.closest('tr');
            saveStockRow(row);
        }
    });
    
    // Add product button
    stockDOM.addBtn.addEventListener('click', () => {
        window.location.href = "create_product.html";
    });
    
    // Reset stock button
    stockDOM.resetBtn.addEventListener('click', () => {
        if (confirm("Reset ALL stock values to 0?")) {
            notify.show({
                message: "Reset functionality coming soon!",
                type: "info"
            });
        }
    });
}

// Make a cell editable
function makeStockCellEditable(cell) {
    const currentValue = cell.textContent;
    cell.innerHTML = `<input type="number" value="${currentValue}" min="0">`;
    const input = cell.querySelector('input');
    input.focus();
    
    input.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            cell.textContent = input.value;
            if (input.value !== currentValue) {
                const row = cell.closest('tr');
                saveStockRow(row);
            }
        }
    });
}

// Save row changes
async function saveStockRow(row) {
    const productId = row.dataset.stockProductId;
    const variantId = row.dataset.stockVariantId;
    const newStock = parseInt(row.querySelector('.stock-editable-cell').textContent);
    
    if (isNaN(newStock) || newStock < 0) {
        notify.show({
            message: "Invalid stock value! Must be positive number.",
            type: "error"
        });
        return;
    }

    try {
        await updateStockQuantity(productId, variantId, newStock);
        notify.show({
            message: "Stock updated successfully!",
            type: "success",
            timeout: 2000
        });
    } catch (error) {
        console.error("Save failed:", error);
        notify.show({
            message: "Failed to update stock",
            type: "error"
        });
    }
}

// Update stock in Firestore
async function updateStockQuantity(productId, variantId, newStock) {
    const productRef = doc(db, "products", productId);
    
    await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(productRef);
        const variants = [...docSnap.data().variants];
        const variantIndex = variants.findIndex(v => v.variantId === variantId);
        
        variants[variantIndex] = {
            ...variants[variantIndex],
            currentStock: newStock
        };
        
        transaction.update(productRef, { variants });
    });
}

// Initialize when DOM loads
document.addEventListener("DOMContentLoaded", initializeStockManager);