// Firestore persistence (build-plan Phase 4, 2026-08-05). Google Auth only
// for now, no Storage — matches auth.js's own scope.
//
// Household data lives as ONE document per household, under
// households/{code}/data/main, rather than the fully granular collection-
// per-entity layout the memo's §1.4 sketch implies. Deliberate
// simplification: Kasa's per-household data (a few dozen spaces/items/
// assets/routines) is nowhere near Firestore's 1MiB document ceiling, and
// this way none of state.js's ~30 existing add/update/delete functions
// needed to change at all — they still just mutate the in-memory object
// and call notify(), and startAutoSave() below piggybacks on that exact
// signal to persist in the background. If a household's data ever
// approaches the size ceiling, splitting `data/main` into a few keyed
// docs (data/spaces, data/routines, ...) is a natural next step, not a
// rearchitecture — see firestore.rules, which already scopes access at
// the `data/{key}` level for this reason.
//
// Schema mirrors Miso's own households/{code} + memberUids pattern
// (Pantry-OS-App/firestore.rules) rather than inventing a new shape.

import { db } from "./firebase.js";
import { doc, getDoc, setDoc, updateDoc, arrayUnion, serverTimestamp, onSnapshot } from "firebase/firestore";
import { subscribe, serializeState, hydrateState } from "./state.js";

function householdDocRef(code) {
  return doc(db, "households", code);
}
function householdDataRef(code) {
  return doc(db, "households", code, "data", "main");
}
function userDocRef(uid) {
  return doc(db, "users", uid);
}

async function getUserRecord(uid) {
  const snap = await getDoc(userDocRef(uid));
  return snap.exists() ? snap.data() : null;
}

async function householdExists(code) {
  const snap = await getDoc(householdDocRef(code));
  return snap.exists();
}

// Creates a brand-new household doc (metadata) + its data/main doc, and
// links this user to it via users/{uid}. Called once, right after a fresh
// onboarding run creates the household locally (see boot.js).
async function createHouseholdRemote({ code, uid, email, name }) {
  await setDoc(householdDocRef(code), {
    name: name || "Household",
    memberUids: [uid],
    createdAt: serverTimestamp(),
  });
  await setDoc(householdDataRef(code), serializeState());
  await setDoc(userDocRef(uid), { email, householdCode: code });
}

// Joins an existing household by code — adds this uid to memberUids
// (firestore.rules only allows ADDING yourself, never removing others)
// and points users/{uid} at it. Throws if the code doesn't exist so the
// caller can show an honest "not found" message.
async function joinHouseholdRemote({ code, uid, email }) {
  const exists = await householdExists(code);
  if (!exists) throw new Error("No household found with that code");
  await updateDoc(householdDocRef(code), { memberUids: arrayUnion(uid) });
  await setDoc(userDocRef(uid), { email, householdCode: code });
}

async function loadHouseholdRemote(code) {
  const snap = await getDoc(householdDataRef(code));
  return snap.exists() ? snap.data() : null;
}

// Debounced background save, piggybacking on state.js's own subscribe() —
// every local mutation (any of the existing add/update/delete functions
// across state.js) already calls notify(); this just also schedules a
// write once things settle, rather than one Firestore write per tap.
//
// Real-time multi-device sync (2026-08-06, user request) lives alongside
// it: an onSnapshot listener on the same document picks up changes another
// signed-in device makes and hydrates them in — a household viewed on a
// phone and a tablet at once now sees each other's edits without either
// needing a manual reload. Two things keep this from fighting the local
// save loop:
//   1. `snap.metadata.hasPendingWrites` is true for this device's OWN
//      optimistic local write, before the server has confirmed it —
//      skipped, since hydrating from our own not-yet-committed write
//      would be a pointless no-op at best.
//   2. `lastSavedSnapshot` remembers the JSON we last wrote — when the
//      server confirms OUR OWN write (hasPendingWrites flips to false),
//      the snapshot content matches exactly what we already have locally,
//      so it's skipped too. Only a snapshot that differs from anything
//      this device itself wrote — i.e. a genuine change from elsewhere —
//      actually triggers hydrateState().
// This is still last-write-wins at the whole-document level (Round 18's
// own locked decision — one doc per household, not a granular per-field
// layout), not a real field-level merge: two devices editing at the exact
// same moment can still have one's change overwrite the other's. What
// this adds is that a device that's just sitting open now actually SEES
// changes made elsewhere, close to immediately, instead of only ever
// finding out on its own next reload.
let saveTimer = null;
let unsubscribeSave = null;
let unsubscribeRealtime = null;
let currentCode = null;
let lastSavedSnapshot = null;
let applyingRemote = false; // reentrancy guard — hydrateState()'s own notify() must not re-trigger a save of the data we just received
const SAVE_DEBOUNCE_MS = 1500;

// `initialData` is the blob the caller already fetched via
// loadHouseholdRemote() to hydrate local state right before calling this
// — passing it here seeds lastSavedSnapshot so the very first onSnapshot
// callback (which always fires immediately with current server data)
// doesn't re-hydrate with data we just loaded a moment ago.
function startAutoSave(code, initialData = null) {
  stopAutoSave();
  currentCode = code;
  if (initialData) lastSavedSnapshot = JSON.stringify(initialData);

  unsubscribeSave = subscribe(() => {
    if (applyingRemote) return; // this change came FROM Firestore — don't write it right back
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!currentCode) return;
      const payload = serializeState();
      lastSavedSnapshot = JSON.stringify(payload);
      setDoc(householdDataRef(currentCode), payload).catch((err) => {
        console.warn("[kasa] Firestore save failed:", err);
      });
    }, SAVE_DEBOUNCE_MS);
  });

  unsubscribeRealtime = onSnapshot(
    householdDataRef(code),
    (snap) => {
      if (snap.metadata.hasPendingWrites || !snap.exists()) return;
      const json = JSON.stringify(snap.data());
      if (json === lastSavedSnapshot) return;
      lastSavedSnapshot = json;
      applyingRemote = true;
      hydrateState(snap.data());
      applyingRemote = false;
    },
    (err) => console.warn("[kasa] Firestore realtime sync error:", err),
  );
}

function stopAutoSave() {
  clearTimeout(saveTimer);
  unsubscribeSave?.();
  unsubscribeSave = null;
  unsubscribeRealtime?.();
  unsubscribeRealtime = null;
  currentCode = null;
  lastSavedSnapshot = null;
}

export {
  getUserRecord,
  householdExists,
  createHouseholdRemote,
  joinHouseholdRemote,
  loadHouseholdRemote,
  startAutoSave,
  stopAutoSave,
};
