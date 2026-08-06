// In-memory store — subscribe/notify, no framework (memo §1.1). This is
// the Phase 0-3 stand-in for db.js: seeded from mock-data/, mutated
// in-memory, same read shape Firestore reads will produce in Phase 4 so
// route/engine code doesn't change when the data source swaps.

import { household, spaces, items, assets, routines, ledger, people, modes, wishlist, habits, habitLog, tasks, snoozeLog } from "../mock-data/index.js";
import { generateOccurrences, stateOf } from "./engine.js";
import { getOrCreate, findByKey } from "./catalog.js";
import { applyLoadSmoothing } from "./intel.js";
import { migrate } from "./migrations.js";

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

// Household invite code — 6-char alphanumeric, same shape as Miso's own
// households/{code} pattern (2026-08-05, user request). Charset excludes
// visually-ambiguous characters (0/O, 1/I/L) — a code meant to be read off
// one screen and typed into another shouldn't hinge on font rendering.
// Session-only like everything else pre-Firebase (Phase 4): this doesn't
// get looked up anywhere yet, it's just displayed so the shape of the
// real thing exists before the backend that makes it functional does.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateHouseholdCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
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
  household: { code: generateHouseholdCode(), ...household },
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

// Walks the (possibly unversioned, mock-seeded) state above forward to the
// current schema — see migrations.js. Right now this is what actually
// creates `state.houses` and stamps `houseId` onto the mock spaces; a
// Firestore-loaded household in Phase 4 would run through the exact same
// call on read.
migrate(state);

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
  // things that already moved. Skipped entirely in "manual" smoothing mode
  // (2026-08-07, user request) — see runSmoothingNow() for the on-demand
  // equivalent, triggered from Today's "Smoothen" chip in that mode.
  state.lastSmoothingMoves = state.household.smoothingMode === "manual" ? state.lastSmoothingMoves : applyLoadSmoothing(state);
}

regenerate();

// On-demand equivalent of regenerate()'s own smoothing pass, for
// "manual" smoothing mode (2026-08-07, user request) — Today's own
// "Smoothen" chip calls this directly rather than waiting for it to run
// automatically. Returns the moves so the caller can show a toast.
function runSmoothingNow() {
  const moves = applyLoadSmoothing(state);
  state.lastSmoothingMoves = moves;
  notify();
  return moves;
}

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
// A real bug, found 2026-08-09 while chasing a "Batches/Smoothen chip needs
// several clicks" report: getState() runs this on every call, including the
// ones render()/wireEvents() make on themselves right after a notify() this
// function just fired. Each pass stamped lastDepletedAt to "now", so the
// very next (synchronous, re-entrant) pass always saw a technically-nonzero
// but microscopic elapsed time — the reentrancy guard only blocks a call
// that's DIRECTLY nested inside its own notify(), not one that comes back
// around after that notify() call returns — so a chain of render -> getState
// -> tiny depletion -> notify -> render (recursive) -> ... -> back to the
// outer render's own wireEvents -> getState -> still-nonzero elapsed time ->
// notify again could cascade 5-10+ synchronous re-renders off a SINGLE
// click, replacing the chip row's DOM (and rebinding its listeners) out from
// under the user's actual next click. A minimum meaningful elapsed time
// fixes this at the root — real depletion only ever needs day-scale
// granularity, so 60 real seconds is a floor no legitimate catch-up would
// ever hit, while every re-entrant call above is microseconds.
const MIN_DEPLETION_ELAPSED_MS = 60000;
let applyingDepletion = false;
function applyAutoDepletion() {
  if (applyingDepletion) return; // reentrancy guard — notify() below can loop back into getState()
  const now = Date.now();
  let changed = false;
  for (const item of state.items) {
    if (!item.autoDeplete || !item.burnRate || !item.lastDepletedAt) continue;
    const elapsedMs = now - new Date(item.lastDepletedAt).getTime();
    if (elapsedMs < MIN_DEPLETION_ELAPSED_MS) continue;
    const elapsedDays = elapsedMs / 86400000;
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

// ---- Firestore persistence (build-plan Phase 4, 2026-08-05) --------------
// db.js is the only caller of these — state.js itself stays unaware of
// Firestore entirely, same "route/engine code doesn't change when the data
// source swaps" boundary this file's own header comment describes.

// A plain-object snapshot safe to hand to Firestore's setDoc. Excludes
// `occurrences` (derived by the engine from routines/ledger/assets/items on
// every load — regenerating them locally after a hydrate is both cheaper
// and more correct than trying to keep a derived collection in sync across
// devices) and `lastSmoothingMoves` (a transient "what just moved" notice,
// not data worth persisting).
function serializeState() {
  const { occurrences, lastSmoothingMoves, ...rest } = state;
  return JSON.parse(JSON.stringify(rest));
}

// Replaces the in-memory state wholesale with a Firestore-loaded snapshot —
// mirrors seedHousehold()'s own "replace, then migrate/regenerate" pattern,
// just for everything instead of one house. Always runs the result through
// migrate() before use, so a snapshot written before a later schema change
// still comes up current rather than needing its own one-off backfill.
function hydrateState(blob) {
  Object.assign(state, blob);
  state.occurrences = [];
  state.lastSmoothingMoves = [];
  migrate(state);
  regenerate();
  notify();
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

// Replaces ONE house's spaces/items/assets/routines with freshly pack-
// generated content (memo §3.1 Step 3 — "Generate"). People/modes are
// household-wide, not per-house, and are left as-is: onboarding's 6
// questions don't collect them ("Add your help" is a later optional
// deepening card, memo §3.1 Step 5).
//
// Targets whichever house is currently the sole active selection, falling
// back to the household's first house otherwise (2026-08-05, multi-house
// support) — other houses in the same household are never touched by this,
// whether this is the very first onboarding run (targeting the one
// migrated/default house) or a later "Re-run onboarding" from More.
function seedHousehold({ spaces, items, assets, routines, answers, packVersions }) {
  const active = state.household.activeHouseIds;
  const targetHouseId = (active?.length === 1 ? active[0] : null) || state.houses[0]?.id;
  const stampedSpaces = spaces.map((s) => ({ ...s, houseId: targetHouseId }));

  const otherSpaceIds = new Set(state.spaces.filter((s) => s.houseId !== targetHouseId).map((s) => s.id));
  state.spaces = [...state.spaces.filter((s) => s.houseId !== targetHouseId), ...stampedSpaces];
  state.items = [...state.items.filter((i) => otherSpaceIds.has(i.spaceId)), ...items];
  state.assets = [...state.assets.filter((a) => otherSpaceIds.has(a.spaceId)), ...assets];
  state.routines = [...state.routines.filter((r) => otherSpaceIds.has(r.spaceId)), ...routines];

  // Drop this house's old ledger/occurrence history along with its old
  // routines (just replaced above) — anything still pointing at a routine
  // that belongs to a different, untouched house survives.
  const remainingRoutineIds = new Set(state.routines.map((r) => r.id));
  state.ledger = state.ledger.filter((l) => remainingRoutineIds.has(l.routineId));
  state.occurrences = state.occurrences.filter((o) => remainingRoutineIds.has(o.routineId));

  state.household.activeHouseIds = [targetHouseId];
  Object.assign(state.household, {
    homeType: answers.homeType, size: answers.size, whoLivesHere: answers.whoLivesHere,
    householdHelp: answers.householdHelp, has: answers.has, city: answers.city,
    packVersions,
    // Was unconditionally regenerated on every seedHousehold call, including
    // a later "Re-run onboarding" against an ALREADY-existing household —
    // silently changing its invite code every time someone re-ran the six
    // questions (2026-08-05, caught while wiring multi-house re-onboarding).
    // Now only assigned once, the first time a household is ever seeded.
    code: state.household.code || generateHouseholdCode(),
  });
  regenerate();
  // Grace period (2026-08-05, user request) — a freshly onboarded house
  // shouldn't open to a wall of already-due/overdue items just because
  // regenerate() computed some routines' first-ever occurrence as due
  // today (floating routines with no lastDoneAt default to `dueAt: now`,
  // per engine.js's computeNext). Scoped to just the routines this call
  // itself just seeded (`newRoutineIds`) — an untouched house's genuinely
  // due/overdue occurrences must never get clamped forward by someone
  // re-onboarding a DIFFERENT house in the same household.
  const newRoutineIds = new Set(routines.map((r) => r.id));
  const graceUntil = Date.now() + 4 * 86400000;
  for (const occ of state.occurrences) {
    if (!newRoutineIds.has(occ.routineId)) continue;
    if (new Date(occ.dueAt).getTime() < graceUntil) occ.dueAt = new Date(graceUntil).toISOString();
  }
  notify();
}

// A brand-new household (real Google sign-in, no prior data) shouldn't
// inherit the mock demo's people/tasks/habits/wishlist — seedHousehold()
// only ever replaces ONE house's own spaces/items/assets/routines, so
// without this, household-WIDE collections would otherwise leak the mock
// "Vinod/Keerthana/Lakshmi" data into every fresh signup forever
// (2026-08-06, user report: "I see old tasks and habit still... needs to
// be empty," "remove the help, need to start blank"). Household name
// defaults to the signed-in person's first name — editable afterward via
// updateHouseholdName() (People & Household).
function resetForNewHousehold({ name, email }) {
  state.people = [];
  state.tasks = [];
  state.habits = [];
  state.habitLog = [];
  state.wishlist = [];
  state.snoozeLog = [];
  const firstName = (name || "").trim().split(/\s+/)[0] || "My";
  state.household.name = `${firstName}'s home`;
  if (email) {
    state.people.push({
      id: genId("u"), kind: "member", name: name || "You", role: null, schedule: null, email,
      leave: [], payDay: null, payAmount: null, advances: [], handoverRoutineIds: [],
      avatarColor: "var(--gold)",
    });
  }
  notify();
}

// The following Saturday (never today, even if today IS Saturday) as a
// YYYY-MM-DD string — used as the default `trigger.startDate` for a new
// asset's suggested/service routines (2026-08-07, user request: "always
// set the starting date of those new routines for new asset on the
// following Saturday and not today"), so a freshly added asset doesn't
// dump a chore on today the moment it's created.
function nextSaturdayDateStr() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const daysUntilSat = ((6 - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + daysUntilSat);
  return d.toISOString().slice(0, 10);
}

function updateHouseholdName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return;
  state.household.name = trimmed;
  notify();
}

// Daily notification preference (2026-08-06, user request) — see notify.js
// for what actually reads this.
function updateNotifySettings(patch) {
  state.household.notifySettings = { ...state.household.notifySettings, ...patch };
  notify();
}

// "auto" (default, existing behavior) or "manual" (2026-08-07, user
// request) — see regenerate()'s own smoothingMode check and
// runSmoothingNow() above.
function setSmoothingMode(mode) {
  state.household.smoothingMode = mode === "manual" ? "manual" : "auto";
  regenerate();
  notify();
}

function setActiveMode(key) {
  for (const m of state.modes) m.active = m.key === key;
  state.household.activeMode = key;
  regenerate();
  notify();
}

// ---- house CRUD (2026-08-05, user request) -------------------------------
// "A household can have more than one house, with its own spaces,
// routines, assets." A house is the layer above Space — every space now
// belongs to exactly one house (`space.houseId`), and items/assets/
// routines inherit that scoping transitively through their own spaceId
// rather than carrying a second houseId of their own. Firestore-shaped on
// purpose (2026-08-05, user request: "will need to be incorporated in
// firebase") — a flat `houses` collection keyed by id with a `houseId`
// foreign key on spaces maps directly onto a `households/{code}/houses/
// {houseId}` subcollection later, no reshaping needed, just a data-source
// swap like everything else pre-Firebase.

// Names must be unique within the household — case/whitespace-insensitive
// (2026-08-06, user request: "don't allow same house name"). Returns null
// on a collision so the caller can prompt for a different one instead of
// closing the sheet.
function addHouse({ name }) {
  const trimmed = (name || "New house").trim();
  if (state.houses.some((h) => h.name.trim().toLowerCase() === trimmed.toLowerCase())) return null;
  const house = { id: genId("house"), name: trimmed, createdAt: new Date().toISOString() };
  state.houses.push(house);
  // A brand-new house gets both its mandatory spaces immediately (mirrors
  // the guarantee every onboarded/migrated house already has) — otherwise
  // there'd be a window where this house exists but "Uses this stock"'s
  // shared-supplies reach (Utility) or the always-included Whole home
  // space has nothing to find. The onboarding wizard that launches right
  // after this (houses.js, 2026-08-06) will replace these via
  // seedHousehold() with the reviewed set, which always includes both too
  // — this is just the safety net if that wizard never gets finished.
  state.spaces.push({ id: genId("sp"), name: "Utility", type: "utility", icon: "utility", houseId: house.id, order: 1, active: true });
  state.spaces.push({ id: genId("sp"), name: "Whole home", type: "whole_home", icon: "wholeHome", houseId: house.id, order: 2, active: true });
  // Switches focus to the house just created — same "jump to what you just
  // made" convention Add Space already follows.
  state.household.activeHouseIds = [house.id];
  notify();
  return house;
}

function updateHouse(id, patch) {
  const house = byId(state.houses, id);
  if (!house) return null;
  if (patch.name != null) {
    const trimmed = patch.name.trim();
    if (state.houses.some((h) => h.id !== id && h.name.trim().toLowerCase() === trimmed.toLowerCase())) return null;
    patch = { ...patch, name: trimmed };
  }
  Object.assign(house, patch);
  notify();
  return house;
}

// A household always has at least one house — refused here at the actual
// mutation boundary (same pattern as Utility's own mandatory-space guard),
// not just hidden in the UI. Cascades: every space that belonged to this
// house, and everything scoped to those spaces, goes with it.
function deleteHouse(id) {
  if (state.houses.length <= 1) return false;
  const houseSpaceIds = new Set(state.spaces.filter((s) => s.houseId === id).map((s) => s.id));
  state.items = state.items.filter((i) => !houseSpaceIds.has(i.spaceId));
  state.assets = state.assets.filter((a) => !houseSpaceIds.has(a.spaceId));
  state.routines = state.routines.filter((r) => !houseSpaceIds.has(r.spaceId));
  state.occurrences = state.occurrences.filter((o) => byId(state.routines, o.routineId));
  state.spaces = state.spaces.filter((s) => s.houseId !== id);
  state.houses = state.houses.filter((h) => h.id !== id);
  state.household.activeHouseIds = (state.household.activeHouseIds || []).filter((hid) => hid !== id);
  if (!state.household.activeHouseIds.length) state.household.activeHouseIds = state.houses.map((h) => h.id);
  notify();
  return true;
}

function setActiveHouseIds(ids) {
  state.household.activeHouseIds = ids?.length ? ids : state.houses.map((h) => h.id);
  notify();
}

// Every space belonging to one of the currently-selected houses — the one
// filter every space/item/asset/routine-listing screen reads through, so
// "which houses are visible right now" lives in exactly one place rather
// than being re-derived per screen.
function visibleSpaceIds(st) {
  const allIds = st.houses.map((h) => h.id);
  const active = st.household.activeHouseIds?.length ? st.household.activeHouseIds : allIds;
  const activeSet = new Set(active);
  return new Set(st.spaces.filter((s) => activeSet.has(s.houseId)).map((s) => s.id));
}

// ---- space CRUD (memo §4.1) --------------------------------------------

// Space names must be unique within their own house — case/whitespace-
// insensitive (2026-08-06, user request: "don't allow two spaces to have
// same name (in same house), prompt to give another"). Returns null on a
// collision so the caller can show a toast and let the user retry instead
// of silently creating a confusing duplicate.
function addSpace({ name, type, icon, houseId = null }) {
  const targetHouseId = houseId || (state.household.activeHouseIds?.length === 1 ? state.household.activeHouseIds[0] : null) || state.houses[0]?.id;
  const trimmed = (name || "").trim();
  if (state.spaces.some((s) => s.houseId === targetHouseId && s.name.trim().toLowerCase() === trimmed.toLowerCase())) return null;
  const space = { id: genId("sp"), name: trimmed, type, icon, houseId: targetHouseId, order: state.spaces.length + 1, active: true };
  state.spaces.push(space);
  notify();
  return space;
}

function updateSpace(id, patch) {
  const sp = byId(state.spaces, id);
  if (!sp) return null;
  if (patch.name != null) {
    const trimmed = patch.name.trim();
    if (state.spaces.some((s) => s.id !== id && s.houseId === sp.houseId && s.name.trim().toLowerCase() === trimmed.toLowerCase())) return null;
    patch = { ...patch, name: trimmed };
  }
  Object.assign(sp, patch);
  notify();
  return sp;
}

// Whole home and Utility are mandatory PER HOUSE — Utility since
// 2026-08-05 (Uses-this-stock's shared-supplies reach needs somewhere to
// find), Whole home added 2026-08-06 (user request: "let whole home &
// utility be default – no deletion of those"). Every house always keeps
// at least one of each type; exported so house.js/onboard.js can badge
// these tiles instead of re-deriving the same list.
const MANDATORY_SPACE_TYPES = ["utility", "whole_home"];

// Deleting a space either reassigns its contents to `reassignToId` or
// deletes them with it (memo §4.4: "Deleting a space asks whether to
// delete contents or move them"). Guarded here, the actual mutation
// boundary, not just hidden in the UI — house.js also disables the delete
// button so the guard is never the first thing a user hits.
function deleteSpace(id, { reassignToId = null } = {}) {
  const space = byId(state.spaces, id);
  if (!space) return;
  if (MANDATORY_SPACE_TYPES.includes(space.type)) {
    const siblings = state.spaces.filter((s) => s.houseId === space.houseId && s.type === space.type);
    if (siblings.length <= 1) return;
  }
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
    replacementDueAt: null, serviceHistory: [],
    // The routine auto-created from "Service every N days" (2026-08-07,
    // user request), if any — lets assets.js find/update/delete exactly
    // that one routine on later edits instead of title-matching.
    serviceRoutineId: null,
    ...fields,
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
  // Also completes the auto-created "Service every N days" routine's own
  // open occurrence, if this asset has one (2026-08-07) — lets the
  // routine's own floating-since-last engine logic take over from a real
  // completion date from here, same as swiping it done on Today would.
  if (asset.serviceRoutineId) {
    const openOcc = state.occurrences.find((o) => o.routineId === asset.serviceRoutineId && o.state !== "done" && o.state !== "snoozed");
    if (openOcc) completeOccurrence(openOcc.id, null);
  }
  notify();
}

// A new person joining an existing household (2026-08-08, user request:
// "when a new person logs in and adds themselves to a household with new
// email id, new person to be created with their first and last name and
// email automatically") — resetForNewHousehold above already does the
// equivalent for a brand-new household's very first member; this is the
// same idea for someone joining one that already exists. Skipped entirely
// if a person with this email is already on the roster (the household
// owner pre-added them as Help/Member in anticipation, or they're
// rejoining after already having a record) — never creates a second entry
// for the same real person. `name` is whatever Google's own displayName
// gives (already first+last together — the Person model has no separate
// first/last fields to split it into).
function addPersonForJoiningUser({ name, email }) {
  if (!email) return null;
  const existing = state.people.find((p) => p.email && p.email.toLowerCase() === email.toLowerCase());
  if (existing) return existing;
  const person = {
    id: genId("u"), kind: "member", name: name || email, role: null, schedule: null, email,
    leave: [], payDay: null, payAmount: null, advances: [], handoverRoutineIds: [],
    avatarColor: "var(--gold)",
  };
  state.people.push(person);
  notify();
  return person;
}

// ---- person CRUD (memo §2.1) --------------------------------------------

function addPerson(fields) {
  state.people.push({
    id: genId(fields.kind === "help" ? "p" : "u"), role: null, schedule: null, email: null,
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

// What happens to a person's linked data when they leave the household
// (2026-08-09, user question) — previously nothing: the person record just
// vanished and every reference to their id was left dangling. Routines and
// tasks are household-level things that merely happen to have an optional
// assignee hint, so they survive with that hint cleared (unassigned, not
// deleted — the chore itself doesn't stop needing doing). Habits are
// different: they're inherently personal (person-scoped, no space, no
// meaning without an owner per the original "Habits are personal" design
// call), so they're deleted along with the person, taking their habit-log
// history with them. Ledger completions (`doneBy`) are deliberately left
// alone — they're a historical record of who actually did something, which
// stays true even after that person leaves, same as how leaving an
// employer doesn't retroactively un-happen the work already done.
function deletePerson(id) {
  state.routines.forEach((r) => { if (r.defaultAssigneeId === id) r.defaultAssigneeId = null; });
  state.tasks.forEach((t) => { if (t.assigneeId === id) t.assigneeId = null; });
  const habitIds = new Set(state.habits.filter((h) => h.personId === id).map((h) => h.id));
  state.habits = state.habits.filter((h) => h.personId !== id);
  state.habitLog = state.habitLog.filter((l) => !habitIds.has(l.habitId));
  state.people = state.people.filter((p) => p.id !== id);
  notify();
}

// Counts what deletePerson(id) above would actually change, so the
// confirmation dialog can say so instead of the deletion being a silent
// surprise (same "cascade-warning confirm" pattern already used for
// deleting a house).
function personDeletionImpact(id) {
  return {
    routines: state.routines.filter((r) => r.defaultAssigneeId === id).length,
    tasks: state.tasks.filter((t) => t.assigneeId === id).length,
    habits: state.habits.filter((h) => h.personId === id).length,
  };
}

function addLeave(personId, { from, to, reason = "" }) {
  const person = byId(state.people, personId);
  if (!person) return;
  person.leave.push({ from, to, reason });
  notify();
}

// ---- routine CRUD (memo §4.2) --------------------------------------------

function addRoutine(fields) {
  const routine = {
    id: genId("rt"), assetId: null, effort: 1, consequence: "cosmetic",
    ownerClass: "either", defaultAssigneeId: null, requiresItemIds: [],
    modeFilters: { pauseIn: [], boostIn: [] }, steps: [], notes: "",
    active: true, source: "manual", packId: null, userEdited: true, ...fields,
  };
  state.routines.push(routine);
  regenerate();
  notify();
  return routine;
}

function updateRoutine(id, patch) {
  const routine = byId(state.routines, id);
  if (!routine) return;
  Object.assign(routine, patch, { userEdited: true });
  // A routine that's never been completed yet has an open occurrence
  // sitting at whatever date it was originally generated for — editing
  // its start date should actually move that occurrence, not leave it
  // stale until the routine happens to regenerate on its own (which,
  // per engine.js's own "no open occurrence exists" rule, it won't,
  // since one already exists). Only ever the FIRST occurrence; once
  // completed once, engine.js's own per-trigger-type logic takes back
  // over (2026-08-07, user request: "when a routine's start date is
  // changed to a future date, adjust the existing routine[s occurrence]
  // to start on the future date"). Generalized from floating_since_last
  // only to every trigger type (2026-08-08, "start date mandatory for all
  // routines and repeat types") — rather than stamping the occurrence's
  // dueAt to the raw startDate directly (which would strand a PAST edited
  // date as instantly overdue, ignoring computeNext's own past-vs-future
  // handling), the stale occurrence is dropped and regenerate() below
  // rebuilds it fresh via the engine, so past/future/repeat-type handling
  // is always computed the one real way, not duplicated here.
  if (routine.trigger?.startDate) {
    const everCompleted = state.ledger.some((l) => l.routineId === id);
    if (!everCompleted) {
      state.occurrences = state.occurrences.filter(
        (o) => !(o.routineId === id && o.state !== "done" && o.state !== "snoozed"),
      );
    }
  }
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
  const task = { id: genId("tsk"), spaceId: null, assetId: null, assigneeId: null, done: false, doneAt: null, createdAt: new Date().toISOString(), ...fields };
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
  serializeState,
  hydrateState,
  resetForNewHousehold,
  addPersonForJoiningUser,
  updateHouseholdName,
  updateNotifySettings,
  setSmoothingMode,
  runSmoothingNow,
  nextSaturdayDateStr,
  addHouse,
  updateHouse,
  deleteHouse,
  setActiveHouseIds,
  visibleSpaceIds,
  MANDATORY_SPACE_TYPES,
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
  personDeletionImpact,
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
