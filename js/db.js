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
import { doc, getDoc, setDoc, updateDoc, arrayUnion, serverTimestamp } from "firebase/firestore";
import { subscribe, serializeState } from "./state.js";

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
let saveTimer = null;
let unsubscribeSave = null;
let currentCode = null;
const SAVE_DEBOUNCE_MS = 1500;

function startAutoSave(code) {
  stopAutoSave();
  currentCode = code;
  unsubscribeSave = subscribe(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!currentCode) return;
      setDoc(householdDataRef(currentCode), serializeState()).catch((err) => {
        console.warn("[kasa] Firestore save failed:", err);
      });
    }, SAVE_DEBOUNCE_MS);
  });
}

function stopAutoSave() {
  clearTimeout(saveTimer);
  unsubscribeSave?.();
  unsubscribeSave = null;
  currentCode = null;
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
