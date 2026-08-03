// In-memory store — subscribe/notify, no framework (memo §1.1). This is
// the Phase 0-3 stand-in for db.js: seeded from mock-data/, mutated
// in-memory, same read shape Firestore reads will produce in Phase 4 so
// route/engine code doesn't change when the data source swaps.

import { household, spaces, items, assets, routines, ledger, people, modes } from "../mock-data/index.js";
import { generateOccurrences } from "./engine.js";
import { getOrCreate } from "./catalog.js";

const listeners = new Set();

function activeModeKeySet(modeList) {
  return new Set(modeList.filter((m) => m.active).map((m) => m.key));
}

// The hand-seeded mock household predates the catalog — resolve each item
// and asset's name against it here so the boot-time demo also carries real
// catalogKey/icon links, same as pack-generated and user-created content.
function withCatalogLink(record, type) {
  if (record.catalogKey) return record;
  const entry = getOrCreate(record.name, type);
  return { ...record, catalogKey: entry.key, icon: record.icon || entry.icon };
}

const state = {
  household,
  spaces: spaces.map((s) => ({ ...s })),
  items: items.map((i) => withCatalogLink({ ...i }, "item")),
  assets: assets.map((a) => withCatalogLink({ ...a }, "asset")),
  people: people.map((p) => ({ ...p })),
  modes: modes.map((m) => ({ ...m })),
  routines: routines.map((r) => ({ ...r })),
  ledger: ledger.map((l) => ({ ...l })),
  occurrences: [],
};

// Re-run the engine over current state, only creating occurrences for
// routines that don't already have one open — same "no open occurrence
// exists" rule the real engine.js tick uses (memo §5.1).
function regenerate() {
  const openRoutineIds = new Set(
    state.occurrences
      .filter((o) => o.state !== "done" && o.state !== "snoozed")
      .map((o) => o.routineId),
  );
  const fresh = generateOccurrences({
    routines: state.routines,
    ledger: state.ledger,
    assets: state.assets,
    items: state.items,
    activeModeKeys: activeModeKeySet(state.modes),
    existingOpenRoutineIds: openRoutineIds,
    now: new Date(),
  });
  state.occurrences.push(...fresh);
}

regenerate();

function notify() {
  for (const fn of listeners) fn(state);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Real, passive time-based depletion — opt-in per item via the "Auto-
// deplete on this schedule" toggle in Stock's edit sheet (2026-08-03, user
// request: a day/week/month rate should be able to actually count qty down,
// not just feed the "~N days left" estimate). Runs lazily on every
// getState() read rather than a timer/interval — cheap no-op once caught up
// (elapsedDays <= 0 short-circuits), and correct regardless of how long the
// tab was closed, since it's driven by real elapsed wall-clock time against
// each item's own lastDepletedAt checkpoint rather than a running clock.
let applyingDepletion = false;
function applyAutoDepletion() {
  if (applyingDepletion) return; // reentrancy guard — notify() below can loop back into getState()
  const now = Date.now();
  let changed = false;
  for (const item of state.items) {
    if (!item.autoDeplete || !item.burnRate || !item.lastDepletedAt) continue;
    const elapsedDays = (now - new Date(item.lastDepletedAt).getTime()) / 86400000;
    if (elapsedDays <= 0) continue;
    const newQty = Math.max(0, item.qty - item.burnRate * elapsedDays);
    if (newQty !== item.qty) {
      item.qty = newQty;
      item.status = item.qty <= 0 ? "out" : item.qty <= item.parLevel ? "low" : "ok";
      changed = true;
    }
    item.lastDepletedAt = new Date(now).toISOString();
  }
  if (changed) {
    applyingDepletion = true;
    notify();
    applyingDepletion = false;
  }
}

function getState() {
  applyAutoDepletion();
  return state;
}

function byId(list, id) {
  return list.find((x) => x.id === id);
}

let idSeq = 0;
function genId(prefix) {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${idSeq}`;
}

// ---- last-action snapshot for the 5s undo toast (memo §8.3) --------------

let lastSnapshot = null;

function snapshotOccurrence(occ) {
  lastSnapshot = { occ: { ...occ }, ledgerLength: state.ledger.length };
}

function undoLast() {
  if (!lastSnapshot) return false;
  const occ = byId(state.occurrences, lastSnapshot.occ.id);
  if (occ) Object.assign(occ, lastSnapshot.occ);
  state.ledger.length = lastSnapshot.ledgerLength;
  lastSnapshot = null;
  notify();
  return true;
}

// ---- occurrence actions ----------------------------------------------

function completeOccurrence(occId, doneBy = null) {
  const occ = byId(state.occurrences, occId);
  if (!occ) return;
  snapshotOccurrence(occ);
  const now = new Date().toISOString();
  occ.state = "done";
  occ.doneAt = now;
  occ.doneBy = doneBy;
  state.ledger.push({ id: genId("lg"), routineId: occ.routineId, doneAt: now, doneBy });

  // Consume linked stock (memo's requiresItemIds field, wired up 2026-08-03,
  // user request: "routines can consume an item which can as well go out of
  // stock"). Amount is the item's own perUseQty if it's tracked "/usage"
  // (2026-08-03, follow-up request: "automated reduction... based on the
  // routine frequency" — this completion IS that automation, scaled by
  // however much this item is actually used per completion instead of a
  // flat 1). Falls back to 1 for items without perUseQty set. Not undone
  // by the 5s undo toast, only the occurrence/ledger are restored (see
  // undoLast).
  const routine = byId(state.routines, occ.routineId);
  for (const itemId of routine?.requiresItemIds || []) {
    const linkedItem = byId(state.items, itemId);
    const amount = linkedItem?.perUseQty > 0 ? linkedItem.perUseQty : 1;
    adjustItemQty(itemId, -amount);
  }

  notify();
}

function snoozeOccurrence(occId, days = 1) {
  const occ = byId(state.occurrences, occId);
  if (!occ) return;
  snapshotOccurrence(occ);
  occ.state = "snoozed";
  occ.snoozeCount = (occ.snoozeCount || 0) + 1;
  occ.snoozedUntil = new Date(Date.now() + days * 86400000).toISOString();
  notify();
}

// Replaces the household's spaces/items/assets/routines with freshly
// pack-generated content (memo §3.1 Step 3 — "Generate"). People/modes are
// left as-is: onboarding's 6 questions don't collect them ("Add your help"
// is a later optional deepening card, memo §3.1 Step 5).
function seedHousehold({ spaces, items, assets, routines, answers, packVersions }) {
  state.spaces = spaces;
  state.items = items;
  state.assets = assets;
  state.routines = routines;
  state.ledger = [];
  state.occurrences = [];
  Object.assign(state.household, {
    homeType: answers.homeType, size: answers.size, whoLivesHere: answers.whoLivesHere,
    householdHelp: answers.householdHelp, has: answers.has, city: answers.city,
    packVersions,
  });
  regenerate();
  notify();
}

function setActiveMode(key) {
  for (const m of state.modes) m.active = m.key === key;
  state.household.activeMode = key;
  regenerate();
  notify();
}

// ---- space CRUD (memo §4.1) --------------------------------------------

function addSpace({ name, type, icon }) {
  const space = { id: genId("sp"), name, type, icon, order: state.spaces.length + 1, active: true };
  state.spaces.push(space);
  notify();
  return space;
}

function updateSpace(id, patch) {
  const sp = byId(state.spaces, id);
  if (sp) Object.assign(sp, patch);
  notify();
}

// Deleting a space either reassigns its contents to `reassignToId` or
// deletes them with it (memo §4.4: "Deleting a space asks whether to
// delete contents or move them").
function deleteSpace(id, { reassignToId = null } = {}) {
  const moveOrDrop = (list) => {
    if (reassignToId) {
      for (const x of list) if (x.spaceId === id) x.spaceId = reassignToId;
      return list;
    }
    return list.filter((x) => x.spaceId !== id);
  };
  state.items = moveOrDrop(state.items);
  state.assets = moveOrDrop(state.assets);
  state.routines = moveOrDrop(state.routines);
  state.spaces = state.spaces.filter((s) => s.id !== id);
  notify();
}

// ---- item (Stock) CRUD (memo §2.1) -------------------------------------

function addItem(fields) {
  const item = {
    id: genId("itm"), qty: 0, packSize: 1, parLevel: 1, burnRate: 0,
    projectedOutAt: null, expiryDate: null, status: "ok", vendorHint: null,
    autoAddToList: true, source: "manual", lastRestockedAt: null, ...fields,
  };
  if (item.qty > 0 && !item.lastRestockedAt) item.lastRestockedAt = new Date().toISOString();
  state.items.push(item);
  notify();
}

function updateItem(id, patch) {
  const item = byId(state.items, id);
  if (!item) return;
  const qtyIncreased = patch.qty != null && patch.qty > item.qty;
  Object.assign(item, patch);
  if (qtyIncreased) item.lastRestockedAt = new Date().toISOString();
  notify();
}

function deleteItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  notify();
}

function adjustItemQty(id, delta) {
  const item = byId(state.items, id);
  if (!item) return;
  item.qty = Math.max(0, item.qty + delta);
  item.status = item.qty <= 0 ? "out" : item.qty <= item.parLevel ? "low" : "ok";
  if (delta > 0) item.lastRestockedAt = new Date().toISOString();
  notify();
}

// ---- asset CRUD (memo §2.1) ---------------------------------------------

// Single source of truth for "next service due" — baselines from the last
// actual service if known, otherwise from today. Called whenever an asset
// is created/edited with a serviceIntervalDays, not just on markAssetServiced,
// so the Assets card never shows a stale date after an edit (bug found
// 2026-08-03: updateAsset was a blind Object.assign that never touched it).
function computeNextServiceDue(asset) {
  if (!asset.serviceIntervalDays) return asset.nextServiceDue ?? null;
  const base = asset.lastServicedAt ? new Date(asset.lastServicedAt) : new Date();
  return new Date(base.getTime() + asset.serviceIntervalDays * 86400000).toISOString().slice(0, 10);
}

function addAsset(fields) {
  const asset = {
    id: genId("ast"), brand: null, model: null, serial: null,
    purchaseDate: null, purchasePrice: null, warrantyUntil: null, amcUntil: null,
    meter: null, serviceIntervalDays: null, serviceIntervalMeter: null,
    lastServicedAt: null, nextServiceDue: null, consumableItemIds: [],
    vendorName: null, vendorPhone: null, docs: [], expectedLifeYears: null,
    replacementDueAt: null, ...fields,
  };
  asset.nextServiceDue = computeNextServiceDue(asset);
  state.assets.push(asset);
  notify();
  return asset;
}

function updateAsset(id, patch) {
  const asset = byId(state.assets, id);
  if (!asset) return;
  Object.assign(asset, patch);
  if (patch.serviceIntervalDays != null) asset.nextServiceDue = computeNextServiceDue(asset);
  notify();
}

function deleteAsset(id) {
  state.assets = state.assets.filter((a) => a.id !== id);
  notify();
}

// Marks an asset serviced today and re-baselines its meter, so the next
// usage_meter/floating computeNext() starts counting fresh from now.
function markAssetServiced(id) {
  const asset = byId(state.assets, id);
  if (!asset) return;
  asset.lastServicedAt = new Date().toISOString().slice(0, 10);
  asset.nextServiceDue = computeNextServiceDue(asset);
  if (asset.meter) asset.lastServiceMeterValue = asset.meter.value;
  notify();
}

// ---- person CRUD (memo §2.1) --------------------------------------------

function addPerson(fields) {
  state.people.push({
    id: genId(fields.kind === "help" ? "p" : "u"), role: null, schedule: null,
    leave: [], payDay: null, payAmount: null, advances: [], handoverRoutineIds: [],
    avatarColor: "var(--gold)", ...fields,
  });
  notify();
}

function updatePerson(id, patch) {
  const person = byId(state.people, id);
  if (person) Object.assign(person, patch);
  notify();
}

function deletePerson(id) {
  state.people = state.people.filter((p) => p.id !== id);
  notify();
}

function addLeave(personId, { from, to, reason = "" }) {
  const person = byId(state.people, personId);
  if (!person) return;
  person.leave.push({ from, to, reason });
  notify();
}

// ---- routine CRUD (memo §4.2) --------------------------------------------

function addRoutine(fields) {
  state.routines.push({
    id: genId("rt"), assetId: null, effort: 1, consequence: "cosmetic",
    ownerClass: "either", defaultAssigneeId: null, requiresItemIds: [],
    modeFilters: { pauseIn: [], boostIn: [] }, steps: [], notes: "",
    active: true, source: "manual", packId: null, userEdited: true, ...fields,
  });
  regenerate();
  notify();
}

function updateRoutine(id, patch) {
  const routine = byId(state.routines, id);
  if (!routine) return;
  Object.assign(routine, patch, { userEdited: true });
  regenerate();
  notify();
}

function deleteRoutine(id) {
  state.routines = state.routines.filter((r) => r.id !== id);
  state.occurrences = state.occurrences.filter((o) => o.routineId !== id);
  notify();
}

function toggleRoutineActive(id) {
  const routine = byId(state.routines, id);
  if (!routine) return;
  routine.active = !routine.active;
  regenerate();
  notify();
}

export {
  getState,
  subscribe,
  genId,
  completeOccurrence,
  snoozeOccurrence,
  setActiveMode,
  seedHousehold,
  undoLast,
  addSpace,
  updateSpace,
  deleteSpace,
  addItem,
  updateItem,
  deleteItem,
  adjustItemQty,
  addAsset,
  updateAsset,
  deleteAsset,
  markAssetServiced,
  addPerson,
  updatePerson,
  deletePerson,
  addLeave,
  addRoutine,
  updateRoutine,
  deleteRoutine,
  toggleRoutineActive,
  byId,
};
