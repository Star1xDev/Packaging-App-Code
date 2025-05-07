import { db } from './firebase-config.js';
import { 
  collection, getDocs, doc, setDoc, 
  writeBatch, runTransaction 
} from 'https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js';

// 1. Archive Packaging Data
document.getElementById('archive-day').addEventListener('click', async () => {
    const statusEl = document.getElementById('archive-status');
    statusEl.textContent = "⏳ Preparing archive...";
    statusEl.className = "status-message processing";
  
    try {
      // 1. Get current packaging data
      const packagingSnapshot = await getDocs(collection(db, "packaging"));
      if (packagingSnapshot.empty) throw new Error("No packaging data found");
  
      // 2. Generate human-readable ID and time
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // "2025-05-21"
      const timeStr = now.toTimeString().slice(0, 5);   // "22:12"
      const archiveId = `${dateStr}_${timeStr.replace(':', '-')}`; // Firestore-safe ID
  
      // 3. Calculate totals
      const items = [];
      let totals = { packaged: 0, used: 0 };
  
      packagingSnapshot.forEach(doc => {
        const data = doc.data();
        items.push(data);
        data.variants?.forEach(v => {
          totals.packaged += v.packagedQuantity || 0;
          totals.used += v.usedStock || 0;
        });
      });
  
      // 4. Save with organized metadata
      await setDoc(doc(db, "packaging_history", archiveId), {
        metadata: {
          date: dateStr,
          time: timeStr,          // "22:12" (human-readable)
          timestamp: now.getTime() // Unix millis for sorting
        },
        items,
        totals
      });
  
      // 5. Success UI
      statusEl.innerHTML = `
        <span class="icon">✅</span>
        <div>
          <strong>Archived at ${timeStr}</strong><br>
          ${items.length} products | Packaged: ${totals.packaged} | Used: ${totals.used}
        </div>
      `;
      statusEl.className = "status-message success";
  
    } catch (error) {
      statusEl.innerHTML = `
        <span class="icon">❌</span>
        <div><strong>Archive failed:</strong> ${error.message}</div>
      `;
      statusEl.className = "status-message error";
      console.error("Archive error:", error);
    }
  });

// 2. Reset Packaging Table
document.getElementById('reset-packaging').addEventListener('click', async () => {
  if (!confirm("Reset ALL packaging data to zero?")) return;

  const packagingSnapshot = await getDocs(collection(db, "packaging"));
  const batch = writeBatch(db);

  packagingSnapshot.forEach(doc => {
    const resetVariants = doc.data().variants.map(v => ({
      ...v,
      packagedQuantity: 0,
      usedStock: 0
    }));
    batch.update(doc.ref, { variants: resetVariants });
  });

  await batch.commit();
  alert("Packaging data reset!");
});