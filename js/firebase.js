// Firebase init (build-plan Phase 4, 2026-08-05). Google Auth + Firestore
// only for now, per direct instruction — Apple/email-link auth and Storage
// are deliberately not wired up ("apple login we can do later, email login
// not needed... storage not needed now"). Analytics is skipped too (not
// asked for, and it pulls in its own SDK + consent considerations).

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD4DPGdrM8mmVBrffHL1TQc6Aii9kbxQDE",
  authDomain: "kasa-prod-13bf5.firebaseapp.com",
  projectId: "kasa-prod-13bf5",
  storageBucket: "kasa-prod-13bf5.firebasestorage.app",
  messagingSenderId: "1098134800941",
  appId: "1:1098134800941:web:c170c46d3ebb9c3def86a4",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Offline persistence (2026-08-06, performance/offline-hardening pass —
// memo §12's own acceptance test: "airplane mode: full read/write,
// correct due dates, sync on reconnect"). Without this, Firestore only
// queues writes made while offline in memory for the current page
// session — a reload while still offline would lose them and fail to
// read anything. persistentLocalCache backs reads/writes with IndexedDB,
// so state loads from the local cache immediately even with no network,
// and queued writes survive a reload and flush once reconnected.
// persistentMultipleTabManager lets more than one Kasa tab on the same
// device share the cache instead of one tab locking the others out of it.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export { app, auth, db };
