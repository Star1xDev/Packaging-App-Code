// Import Firebase SDKs
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// Your Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDPNvRLxw8g2C6ZEHWQs5ykgxVBopSyLC8",
    authDomain: "packaging-app-49d09.firebaseapp.com",
    projectId: "packaging-app-49d09",
    storageBucket: "packaging-app-49d09.appspot.com",
    messagingSenderId: "799081260006",
    appId: "1:799081260006:web:0de6730a0e8aeafebcec27"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Export database instance
export { db };
