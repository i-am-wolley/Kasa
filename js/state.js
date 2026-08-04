// In-memory store — subscribe/notify, no framework (memo §1.1). This is
// the Phase 0-3 stand-in for db.js: seeded from mock-data/, mutated
// in-memory, same read shape Firestore reads will produce in Phase 4 so
// route/engine code doesn't change when the data source swaps.

import { household, spaces, items, assets, routines, ledger, people, modes, wishlist, habits, habitLog, tasks, snoozeLog } from "../mock-data/index.js";
import { generateOccurrences, stateOf } from "./engine.js";
import { getOrCreate, findByKey } from "./catalog.js";
import { applyLoadSmoothing } from "./intel.js";

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

// Backfills expectedLifeYears from the catalog's researched default for any
// asset that doesn't already have one set (2026-08-05, user request: keep
// existing assets auto-updated from catalog research rather than only new
// ones) — never overwrites a value someone already set, and always resolves
// through the catalog entry the asset is actually linked to, not a guess.
function withExpectedLife(asset) {
  if (asset.expectedLifeYears != null) return asset;
  const entry = findByKey(asset.catalogKey, "asset");
  return entry?.expectedLifeYears != null ? { ...asset, expectedLifeYears: entry.expectedLifeYears } : asset;
}

const state = {
  household,
  spaces: spaces.map((s) => ({ ...s })),
  items: items.map((i) => withCatalogLink({ ...i }, "item")),
  assets: assets.map((a) => withExpectedLife(withCatalogLink({ ...a }, "asset"))),
  people: people.map((p) => ({ ...p })),
  modes: modes.map((m) => ({ ...m })),
  routines: routines.map((r) => ({ ...r })),
  ledger: ledger.map((l) => ({ ...l })),
  occurrences: [],
  wishlist: wishlist.map((w) => ({ ...w })),
  habits: habits.map((h) => ({ ...h })),
  habitLog: habitLog.map((l) => ({ ...l })),
  tasks: tasks.map((t) => ({ ...t })),
  snoozeLog: snoozeLog.map((s) => ({ ...s })),
  lastSmoothingMoves: [],
};

// A snoozed occurrence never woke back up on its own — nothing anywhere
// transitioned `state: "snoozed"` back to due/overdue once `snoozedUntil`
// passed. Found while building Phase 5's snooze learning (2026-08-05): it
// meant a snoozed item vanished from Today for good, and regenerate()'s
// "no open occurrence exists" check would eventually spawn a SECOND fresh
// occurrence for the same routine alongside the permanently-snoozed one
// (since "snoozed" was never counted as open) the next time anything
// triggered a regenerate(). Also meant `snoozeCount` could never reach 3 —
// the memo's own "snoozed 3x in a row" signal was unreachable. Fixed by
// waking any occurrence whose snooze window has elapsed back to its real
// engine-computed state before anything else reads or regenerates.
function wakeSnoozedOccurrences() {
  const now = new Date();
  for (const occ of state.occurrences) {
    if (occ.state === "snoozed" && occ.snoozedUntil && new Date(occ.snoozedUntil) <= now) {
      occ.state = stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, now);
    }
  }
}

// Re-run the engine over current state, only creating occurrences for
// routines that don't already have one open — same "no open occurrence
// exists" rule the real engine.js tick uses (memo §5.1).
function regenerate() {
  wakeSnoozedOccurrences();
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
  // Phase 5 load smoothing (§5.7) — shifts flexible occurrences ±7 days if
  // a week's total effort exceeds the household ceiling. Runs as part of
  // the same engine pass regenerate() already does, not a separate manual
  // action; each occurrence is only ever smoothed once (applyLoadSmoothing
  // marks `occ.smoothed`), so repeat regenerate() calls don't re-shuffle
  // things that already moved.
  state.lastSmoothingMoves = applyLoadSmoothing(state);
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
  wakeSnoozedOccurrences();
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
  // Logged for Phase 5's snooze-learning day-of-week detection (§5.4) — see
  // intel.js's snoozeSuggestions(). Not restored by the 5s undo toast (only
  // the occurrence/ledger snapshot is) — an undone snooze still happened
  // from a "did the user hesitate on this" signal standpoint.
  const now = new Date();
  state.snoozeLog.push({ id: genId("snz"), routineId: occ.routineId, date: now.toISOString().slice(0, 10), dow: now.getDay() });
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
  return item;
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

// Same "single source of truth, recomputed whenever its inputs change"
// pattern as computeNextServiceDue — feeds Phase 5's failure prediction
// (intel.js's failurePredictions(), §5.9). Purely informational (nothing
// currently acts on replacementDueAt directly); null until both a purchase
// date and an expected life are known.
function computeReplacementDueAt(asset) {
  if (!asset.purchaseDate || !asset.expectedLifeYears) return asset.replacementDueAt ?? null;
  const purchased = new Date(asset.purchaseDate);
  return new Date(purchased.getTime() + asset.expectedLifeYears * 365.25 * 86400000).toISOString().slice(0, 10);
}

function addAsset(fields) {
  const asset = {
    id: genId("ast"), brand: null, model: null, serial: null,
    purchaseDate: null, purchasePrice: null, warrantyUntil: null, amcUntil: null,
    meter: null, serviceIntervalDays: null, serviceIntervalMeter: null,
    lastServicedAt: null, nextServiceDue: null, consumableItemIds: [],
    vendorName: null, vendorPhone: null, docs: [], expectedLifeYears: null,
    replacementDueAt: null, serviceHistory: [], ...fields,
  };
  asset.nextServiceDue = computeNextServiceDue(asset);
  asset.replacementDueAt = computeReplacementDueAt(asset);
  state.assets.push(asset);
  notify();
  return asset;
}

function updateAsset(id, patch) {
  const asset = byId(state.assets, id);
  if (!asset) return;
  Object.assign(asset, patch);
  if (patch.serviceIntervalDays != null) asset.nextServiceDue = computeNextServiceDue(asset);
  if (patch.purchaseDate != null || patch.expectedLifeYears != null) asset.replacementDueAt = computeReplacementDueAt(asset);
  notify();
}

function deleteAsset(id) {
  state.assets = state.assets.filter((a) => a.id !== id);
  notify();
}

// Marks an asset serviced today, re-baselines its meter so the next
// usage_meter/floating computeNext() starts counting fresh from now, and
// appends to serviceHistory — the record intel.js's failurePredictions()
// (§5.9) needs to detect a "rising service frequency" trend, which has
// nothing to measure without at least a few real timestamps.
function markAssetServiced(id) {
  const asset = byId(state.assets, id);
  if (!asset) return;
  const today = new Date().toISOString().slice(0, 10);
  asset.lastServicedAt = today;
  asset.nextServiceDue = computeNextServiceDue(asset);
  asset.serviceHistory = [...(asset.serviceHistory || []), today];
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

// ---- wishlist CRUD (2026-08-04, user request) ---------------------------
// "An area for a household to improve their ways of life" — ideas that
// aren't yet real: a thing to buy (asset or stock item, catalog-linked so
// it resolves through the same getOrCreate() every other add flow uses)
// or a bigger one-off project with no catalog entry to link to (repaint a
// room, re-tile a bathroom). Deliberately NOT routines/habits — those are
// recurring; a wishlist entry is a one-time thing you're moving toward,
// then it's done.

function addWishlistItem(fields) {
  const entry = {
    id: genId("wl"), catalogKey: null, icon: "wishlist", spaceId: null,
    priority: "someday", estimatedCost: null, notes: "", status: "idea",
    createdAt: new Date().toISOString(), acquiredAt: null, ...fields,
  };
  state.wishlist.push(entry);
  notify();
  return entry;
}

function updateWishlistItem(id, patch) {
  const entry = byId(state.wishlist, id);
  if (entry) Object.assign(entry, patch);
  notify();
}

function deleteWishlistItem(id) {
  state.wishlist = state.wishlist.filter((w) => w.id !== id);
  notify();
}

// ---- habit CRUD (2026-08-04, user request) -------------------------------
// Personal, not household — belongs to exactly one person, no space, no
// engine trigger. Just "did I do this today," logged sparsely (a row per
// day it WAS done, same pattern as the ledger — silence means not done,
// not an explicit "false" row for every day that ever existed).

// Was `function addHabit({ personId, title })` — silently dropped every
// other field the caller passed, including `frequency`. Found 2026-08-05
// while testing the new "Every N days" option: routine.js's save handler
// has always correctly built `{ title, personId, frequency }` and called
// addHabit(fields), but the destructured signature here threw `frequency`
// away before it ever reached state.habits, so every habit ever created
// via "Add habit" silently defaulted to daily regardless of what was
// actually picked — invisible until something actually checked the saved
// object, since `isHabitScheduledOn`'s `habit.frequency || {type:"daily"}`
// fallback made a missing frequency look identical to an explicit "Daily"
// choice. Habits created directly in mock-data (which set `frequency`
// literally, not through this function) were never affected.
function addHabit(fields) {
  const habit = { id: genId("hb"), frequency: { type: "daily" }, createdAt: new Date().toISOString(), ...fields };
  state.habits.push(habit);
  notify();
  return habit;
}

function updateHabit(id, patch) {
  const habit = byId(state.habits, id);
  if (habit) Object.assign(habit, patch);
  notify();
}

function deleteHabit(id) {
  state.habits = state.habits.filter((h) => h.id !== id);
  state.habitLog = state.habitLog.filter((l) => l.habitId !== id);
  notify();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isHabitDoneOn(habitId, dateStr) {
  return state.habitLog.some((l) => l.habitId === habitId && l.date === dateStr);
}

// Toggles TODAY only — habits are logged forward from the moment you check
// them, not backfilled (matches the memo's own "no gaming the system"
// spirit for routines, applied here too).
function toggleHabitToday(habitId) {
  const date = todayStr();
  const existing = state.habitLog.find((l) => l.habitId === habitId && l.date === date);
  if (existing) {
    state.habitLog = state.habitLog.filter((l) => l !== existing);
  } else {
    state.habitLog.push({ id: genId("hlg"), habitId, date });
  }
  notify();
}

// Current streak of consecutive done-days ending today or yesterday (a
// miss today doesn't zero out a streak until the day is actually over —
// checks yesterday first if today isn't logged yet).
function habitStreak(habitId) {
  let count = 0;
  const d = new Date();
  if (!isHabitDoneOn(habitId, todayStr())) d.setDate(d.getDate() - 1);
  while (isHabitDoneOn(habitId, d.toISOString().slice(0, 10))) {
    count += 1;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

// Monday-start week, matching how most weekly schedules read locally.
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function countDoneThisWeek(habitId) {
  const start = startOfWeek(new Date());
  return state.habitLog.filter((l) => l.habitId === habitId && new Date(l.date) >= start).length;
}

// Whether a habit was ever "supposed to" happen on a given date, per its
// own frequency — independent of whether it was actually done. Pure and
// date-parameterized (not just "today") so the 72-day grid (2026-08-05,
// user request: "cant have blank days cos it was never planned") can ask
// this retroactively for each of its cells, distinguishing "not scheduled"
// from "scheduled but missed" instead of treating every non-done day the
// same way. `weekly_count` habits are the one deliberate exception — they
// have no specific scheduled days by nature ("3x this week," not "Mon/Wed/
// Fri"), so every day counts as schedulable for them, same as daily.
function isHabitScheduledOn(habit, date) {
  const freq = habit.frequency || { type: "daily" };
  const dow = date.getDay();
  switch (freq.type) {
    case "weekdays": return dow >= 1 && dow <= 5;
    case "weekends": return dow === 0 || dow === 6;
    case "custom": return (freq.days || []).includes(dow);
    case "every_n_days": {
      const n = freq.intervalDays || 2;
      const anchor = new Date(habit.createdAt);
      anchor.setHours(0, 0, 0, 0);
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const daysSince = Math.round((d - anchor) / 86400000);
      return daysSince >= 0 && daysSince % n === 0;
    }
    default: return true; // daily, weekly_count
  }
}

// Habits "needn't be only daily" (2026-08-04, user request) — a habit is
// due today per its own frequency, and only if not already logged today.
// Surfaced on Today so it can be swiped complete there; the streak/grid
// view stays in Insights.
function isHabitDueToday(habit) {
  if (isHabitDoneOn(habit.id, todayStr())) return false;
  if (habit.frequency?.type === "weekly_count") return countDoneThisWeek(habit.id) < (habit.frequency.timesPerWeek || 1);
  return isHabitScheduledOn(habit, new Date());
}

// ---- task CRUD (2026-08-04, user request) --------------------------------
// The third category alongside household Routines and personal Habits: "a
// task is not a routine, but needs to be done by a specific day." No
// recurrence, no trigger engine, no required space/person — just a title
// and a due date, optionally scoped to a space and/or assigned to someone.
// Structured as its own flat list (not occurrences, not routines) since a
// task has exactly one occurrence ever, by definition.

function addTask(fields) {
  const task = { id: genId("tsk"), spaceId: null, assigneeId: null, done: false, doneAt: null, createdAt: new Date().toISOString(), ...fields };
  state.tasks.push(task);
  notify();
  return task;
}

function updateTask(id, patch) {
  const task = byId(state.tasks, id);
  if (task) Object.assign(task, patch);
  notify();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  notify();
}

function completeTask(id) {
  const task = byId(state.tasks, id);
  if (!task) return;
  task.done = true;
  task.doneAt = new Date().toISOString();
  notify();
}

// Toggling done is symmetric, same as habits — lets Today's undo toast just
// call this again instead of needing its own snapshot bookkeeping.
function uncompleteTask(id) {
  const task = byId(state.tasks, id);
  if (!task) return;
  task.done = false;
  task.doneAt = null;
  notify();
}

function taskState(task) {
  if (task.done) return "done";
  const due = new Date(task.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due < today) return "overdue";
  if (due.getTime() === today.getTime()) return "due";
  return "upcoming";
}

function taskOverdueDays(task) {
  const due = new Date(task.dueDate);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - due) / 86400000);
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
  addWishlistItem,
  updateWishlistItem,
  deleteWishlistItem,
  addHabit,
  updateHabit,
  deleteHabit,
  isHabitDoneOn,
  toggleHabitToday,
  habitStreak,
  isHabitDueToday,
  isHabitScheduledOn,
  addTask,
  updateTask,
  deleteTask,
  completeTask,
  uncompleteTask,
  taskState,
  taskOverdueDays,
  byId,
};
