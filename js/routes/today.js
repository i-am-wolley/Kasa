// Today screen (memo §8.2) — the default screen. Overdue first (only
// damaging/safety visually loud), then due today, then habits due today.
// Completion is one gesture: swipe right = done, left = snooze (routines
// only — tasks/habits have no snooze concept, either direction marks done).
//
// Unifies household Routine occurrences with one-off Tasks (2026-08-04,
// user request: tasks "need to be done by a specific day" — same due-today/
// overdue shape as a routine occurrence, just never recurring) into one
// Overdue/Due Today view, plus a subtle member filter and a quick-add
// button that opens the shared routine/habit/task sheet directly from here.

import { getState, subscribe, completeOccurrence, snoozeOccurrence, setActiveMode, undoLast, isHabitDueToday, toggleHabitToday, taskState, taskOverdueDays, completeTask, uncompleteTask, visibleSpaceIds, runSmoothingNow, adjustItemQty, updateItem, byId } from "../state.js";
import { stateOf, overdueDays } from "../engine.js";
import { Icon } from "../ui/icons.js";
import { chip, emptyState, showToast, openSheet, closeSheet, haptic } from "../ui/components.js";
import { openRoutineEditor } from "./routine.js";
import { bucketOf } from "./stock.js";
import { batches as intelBatches } from "../intel.js";
import { getCurrentUser } from "../auth.js";

// 2026-08-09: consequence tiers renamed (safety->unsafe, degrading->unhygienic)
const TIER_RANK = { unsafe: 4, damaging: 3, unhygienic: 2, cosmetic: 1 };
// Human labels instead of the old "E1"/"E4" shorthand (2026-08-04, user
// feedback: "i dont understand the e4, e3 e1... remove it").
const EFFORT_LABEL = { 1: "2 min", 2: "15 min", 3: "1 hr", 4: "Half day", 5: "Vendor" };

let effortOnly = false;
let memberFilter = null; // personId, or null for everyone
let view = "today"; // "today" | "week" (2026-08-05, user request)
// Off by default (2026-08-05, user request: "keep that as a toggle...
// rather than always on screen") — batching is a nice-to-have suggestion,
// not something that should always claim space above Overdue/Due.
let showBatches = false;
// Set once per render() (2026-08-06, user request: "when multiple houses
// are there house names should come") — read directly by rowHtml rather
// than threaded through every call, same module-level-UI-state pattern
// already used for effortOnly/memberFilter/view.
let multiHouseActive = false;
let mountEl = null;
let unsubscribe = null;

function isPausedNow(routine, activeModeKey) {
  return routine.modeFilters?.pauseIn?.includes(activeModeKey);
}

// Signed day offset from today (0 = today, negative = past). Used by the
// "This week" view to bucket by raw due date instead of the engine's
// window-gated due/pending state — a routine can enter "due" state days
// before its literal due date (memo §5.1's window), which is the right
// call for the Today view but not for "what's happening by which day this
// week" (2026-08-04, user request).
function dayOffset(dueRaw) {
  const d = new Date(dueRaw);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function enrichRoutine(occ, state) {
  const routine = byId(state.routines, occ.routineId);
  const space = routine ? byId(state.spaces, routine.spaceId) : null;
  const asset = routine?.assetId ? byId(state.assets, routine.assetId) : null;
  return {
    type: "routine", occ, routine, space,
    title: routine?.title, tier: routine?.consequence || "cosmetic", effort: routine?.effort ?? null,
    assigneeId: routine?.defaultAssigneeId ?? null,
    assetIcon: asset?.icon ?? null,
    houseName: space ? byId(state.houses, space.houseId)?.name ?? null : null,
    state: stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, new Date()),
    days: overdueDays({ dueAt: occ.dueAt }, new Date()),
    offset: dayOffset(occ.dueAt),
  };
}

function enrichTask(task, state) {
  const space = task.spaceId ? byId(state.spaces, task.spaceId) : null;
  const asset = task.assetId ? byId(state.assets, task.assetId) : null;
  return {
    type: "task", task, space,
    title: task.title, tier: "cosmetic", effort: null,
    assigneeId: task.assigneeId ?? null,
    assetIcon: asset?.icon ?? null,
    houseName: space ? byId(state.houses, space.houseId)?.name ?? null : null,
    state: taskState(task),
    days: taskOverdueDays(task),
    offset: dayOffset(task.dueDate),
  };
}

// Every open, unpaused, filter-matching row — NOT yet split into
// overdue/due-today/due-this-week buckets, since which bucket a "pending"
// row belongs to depends on the Today/This week toggle (see render()).
function visibleRows(state) {
  const activeModeKey = state.household.activeMode;
  // Scoped to whichever house(s) the header picker currently has selected
  // (2026-08-05, multi-house support) — a task with no space at all is
  // never house-scoped in the first place, so it always shows regardless.
  const visibleSpaces = visibleSpaceIds(state);
  const routineRows = state.occurrences
    .filter((o) => o.state !== "done" && o.state !== "snoozed")
    .map((o) => enrichRoutine(o, state))
    .filter((r) => r.routine && !isPausedNow(r.routine, activeModeKey))
    .filter((r) => visibleSpaces.has(r.routine.spaceId))
    .filter((r) => !effortOnly || r.effort === 1);
  const taskRows = state.tasks
    .filter((t) => !t.done && (!t.spaceId || visibleSpaces.has(t.spaceId)))
    .map((t) => enrichTask(t, state));
  const rows = [...routineRows, ...taskRows];
  return memberFilter ? rows.filter((r) => r.assigneeId === memberFilter) : rows;
}

// Weekday label for a few days out ("Due Thu") reads better than "Due in
// 4 days" once the This week view can surface rows beyond tomorrow
// (2026-08-05) — falls back to the old "Due today"/"Overdue by N days"
// wording for the common cases.
function dueLabel(row) {
  if (row.state === "overdue") return `Overdue by ${row.days} day${row.days === 1 ? "" : "s"}`;
  if (row.offset <= 0) return "Due today";
  if (row.offset === 1) return "Due tomorrow";
  const d = new Date();
  d.setDate(d.getDate() + row.offset);
  return `Due ${d.toLocaleDateString("en-IN", { weekday: "short" })}`;
}

function rowHtml(row) {
  const { type, state, tier, title, space, effort } = row;
  const loud = state === "overdue" && (tier === "damaging" || tier === "unsafe");
  const meta = dueLabel(row);
  let metaClass = "occ-row-meta";
  if (loud) metaClass += tier === "unsafe" ? " safety-overdue" : " overdue";
  const entryId = type === "routine" ? row.occ.id : row.task.id;
  // A routine's icon was borrowing its SPACE's icon (2026-08-05, user
  // report: "for water tank cleaning there is washing machine" — Utility's
  // room icon, not anything about the routine itself). Prefer the linked
  // asset's own icon when there is one (genuinely meaningful — "Service
  // geyser" shows the geyser), otherwise fall back to one consistent
  // generic "routine" glyph, never a room icon and never anything that
  // could read as arbitrary.
  const icon = type === "task" ? row.assetIcon || "task" : type === "routine" ? row.assetIcon || "routine" : space?.icon || "house";
  // Routines keep the done/snooze split peek; tasks have no snooze concept
  // — either swipe direction just completes it, so both peek panels read
  // "Done" (matches how habit rows already behave).
  const actionsHtml = type === "routine"
    ? `
      <div class="occ-row-action done">${Icon("check", { size: 18 })} Done</div>
      <div class="occ-row-action snooze">Snooze ${Icon("snooze", { size: 18 })}</div>
    `
    : `
      <div class="occ-row-action done">${Icon("check", { size: 18 })} Done</div>
      <div class="occ-row-action done" style="justify-content:flex-end;">Done ${Icon("check", { size: 18 })}</div>
    `;

  // House name shown right-aligned whenever more than one house is
  // currently active (2026-08-06, user request: "when multiple houses are
  // there house names should come... can be on the right side" — also
  // covers same-titled tasks/routines across different houses, since each
  // gets its own house label). A space-less task has no house to show.
  const houseTag = multiHouseActive && row.houseName ? `<div class="occ-row-house">${row.houseName}</div>` : "";

  return `
    <div class="occ-row-wrap" data-entry-type="${type}" data-entry-id="${entryId}">
      <div class="occ-row-actions">${actionsHtml}</div>
      <div class="occ-row" data-tier="${tier}" data-entry-type="${type}" data-entry-id="${entryId}">
        <div class="occ-row-icon">${Icon(icon, { size: 18 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title">${title}</div>
          <div class="${metaClass}">${meta}${space ? ` · ${space.name}` : ""}${type === "task" ? " · Task" : ""}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;">
          ${effort ? `<div class="occ-row-effort">${EFFORT_LABEL[effort] || ""}</div>` : ""}
          ${houseTag}
        </div>
      </div>
    </div>
  `;
}

function sectionHtml(title, rows, { sortByOffset = false } = {}) {
  if (!rows.length) return "";
  const sorted = [...rows].sort((a, b) => {
    const rankDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (rankDiff !== 0) return rankDiff;
    // Due-today rows are all offset 0 so this is a no-op there; This week
    // rows span offset 0-6, so break tier ties chronologically instead of
    // falling back to `days` (always 0 for anything not yet overdue).
    return sortByOffset ? a.offset - b.offset : b.days - a.days;
  });
  const sectionId = title === "Overdue" ? "section-overdue" : "section-due";
  return `
    <div class="today-section" id="${sectionId}">
      <div class="section-head"><span class="eyebrow">${title}</span></div>
      ${sorted.map(rowHtml).join("")}
    </div>
  `;
}

// Habits, personal and separate from routines/tasks (2026-08-04): due-today
// habits (per their own frequency) get the same swipeable row as routines/
// tasks — swiping either direction marks it done. The row disappears once
// done; the 72-day grid/streak view lives in Insights, not here.
function habitRowHtml(habit) {
  return `
    <div class="occ-row-wrap" data-habit-id="${habit.id}">
      <div class="occ-row-actions">
        <div class="occ-row-action done">${Icon("check", { size: 18 })} Done</div>
        <div class="occ-row-action done" style="justify-content:flex-end;">Done ${Icon("check", { size: 18 })}</div>
      </div>
      <div class="occ-row" data-habit-id="${habit.id}">
        <div class="occ-row-icon">${Icon("flame", { size: 18 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title">${habit.title}</div>
          <div class="occ-row-meta">Habit</div>
        </div>
      </div>
    </div>
  `;
}

// Habits are personal — a shared Today screen shouldn't surface one
// household member's private check-in to whoever else happens to be
// looking at the same device (2026-08-06, user request: "shown only to
// the person who is doing it, not to rest of household"). With more than
// one person in the household, habits only appear once a specific person
// is picked via the member filter above; a single-person household has
// nothing to leak, so its one person's habits always show.
//
// "Everyone" no longer means "nobody's habits" (2026-08-10, user request:
// "all the respective logged in users habit needs to appear if that habit
// is scheduled for the day") — the signed-in person's OWN habits should
// just be there by default, not require tapping their own name first
// every time. Resolved by matching the Firebase Auth email to a Person
// record, same lookup addPersonForJoiningUser already uses elsewhere.
// Anyone ELSE's habits still stay hidden under "Everyone" — this only
// removes the friction of seeing your own, the privacy boundary between
// different people's habits is unchanged.
function currentPersonId(state) {
  const email = getCurrentUser()?.email;
  if (!email) return null;
  return state.people.find((p) => p.email && p.email.toLowerCase() === email.toLowerCase())?.id ?? null;
}

function visibleDueHabits(state) {
  const relevantPeopleCount = state.people.filter((p) => p.kind === "member" || p.kind === "help").length;
  if (relevantPeopleCount < 2) return state.habits.filter((h) => isHabitDueToday(h));
  const effectiveFilter = memberFilter ?? currentPersonId(state);
  return effectiveFilter ? state.habits.filter((h) => isHabitDueToday(h) && h.personId === effectiveFilter) : [];
}

function habitsSectionHtml(state) {
  const due = visibleDueHabits(state);
  if (!due.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Habits</span></div>
      ${due.map(habitRowHtml).join("")}
    </div>
  `;
}

// Subtle by design (2026-08-04, user request: "shouldnt look cluttered") —
// no border unless active, small muted text, hidden entirely for a
// single-person household where filtering has nothing to offer.
function memberFilterHtml(state) {
  const people = state.people.filter((p) => p.kind === "member" || p.kind === "help");
  if (people.length < 2) return "";
  return `
    <div class="member-filter-row">
      <button type="button" class="member-chip" data-member-filter="" aria-pressed="${memberFilter === null}">Everyone</button>
      ${people.map((p) => `<button type="button" class="member-chip" data-member-filter="${p.id}" aria-pressed="${memberFilter === p.id}">${p.name}</button>`).join("")}
    </div>
  `;
}

// §5.6 batching (2026-08-05) — "you're already in the room, do these
// together" clustering for whatever's actually overdue/due right now.
// Same-effort-tier batching already exists as the "10 free min?" chip
// and same-trip shopping batching already exists as Stock's "Build
// shopping list" — this section is the two genuinely new clusters: same
// space, same vendor. Tapping a card just jumps to the list below (reuses
// the stat tiles' own data-tile-action wiring) rather than adding a third
// filter dimension on top of the member filter and view toggle. Gated
// behind the "Batches" chip (default off, 2026-08-05 follow-up) — nice as
// a suggestion, not something that should always claim space above
// Overdue/Due.
function batchesSectionHtml(state, actionableRows) {
  const { spaces, vendors } = intelBatches(state, actionableRows);
  if (!spaces.length && !vendors.length) return "";
  const spaceCards = spaces
    .map(
      (b) => `
    <div class="list-row" data-tile-action="jump:section-overdue" style="cursor:pointer;">
      <div class="occ-row-icon">${Icon(b.spaceIcon || "house", { size: 16 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title">You're already in ${b.spaceName}</div>
        <div class="occ-row-meta">${b.count} things${b.minutes ? ` · ~${b.minutes} min total` : ""} — ${b.titles.join(", ")}</div>
      </div>
    </div>`,
    )
    .join("");
  const vendorCards = vendors
    .map(
      (b) => `
    <div class="list-row" data-tile-action="jump:section-overdue" style="cursor:pointer;">
      <div class="occ-row-icon">${Icon("call", { size: 16 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title">Calling ${b.vendorName}?</div>
        <div class="occ-row-meta">${b.count} other things need them — ${b.titles.join(", ")}</div>
      </div>
    </div>`,
    )
    .join("");
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Batch these together</span></div>
      ${spaceCards}${vendorCards}
    </div>
  `;
}

// Out/low stock, shown as tappable pills at the very bottom of Today
// (2026-08-10, user request) — same bucketing Stock itself uses
// (stock.js's own bucketOf, already relied on for the "Low stock" stat
// tile above), so this always matches what Stock would show. Tapping a
// pill restocks by the smallest possible step — +1 for a quantity item
// (the same increment the Stock screen's own stepper "+1" button uses),
// or "mark in stock" for a binary yes/no item — rather than opening a
// sheet, since the whole point is a fast one-tap top-up from Today.
// A flex-wrap row of small rounded pills, not a full-width row per item
// (2026-08-10, user request: "very similar to Miso shopping list") —
// pulled directly from Miso's own actual shopping-list implementation
// (Pantry-OS-App/index.html's missing-ingredients chips).
//
// Grouped by catalogKey — the same "real-world thing" identity the rest of
// the app already uses (falling back to lowercased name for a custom item
// with no catalog link) — rather than by individual per-room item record,
// so the same consumable being low in several rooms shows as ONE pill with
// a count instead of one pill per room (2026-08-10 follow-up: "let it not
// show the room but instead if same item across rooms are low then put a
// count similar to miso like x3" — Miso's own list does exactly this for
// an ingredient needed by more than one dish). Tapping a grouped pill
// restocks every item in the group, not just one — buying "3× Toilet
// cleaner" naturally means topping up all three rooms' own copies, not an
// arbitrary single one. Worst status within the group wins (any "out"
// makes the whole pill red, even if others in the group are only "low").
function shoppingListSectionHtml(state) {
  const visibleSpaces = visibleSpaceIds(state);
  const eligible = state.items
    .filter((i) => visibleSpaces.has(i.spaceId))
    .map((i) => ({ item: i, bucket: bucketOf(i) }))
    .filter((x) => x.bucket === "out" || x.bucket === "low");
  if (!eligible.length) return "";

  const groups = new Map();
  for (const { item, bucket } of eligible) {
    const key = item.catalogKey || item.name.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, { name: item.name, itemIds: [], worst: "low" });
    const g = groups.get(key);
    g.itemIds.push(item.id);
    if (bucket === "out") g.worst = "out";
  }

  const pillHtml = (g) => {
    // var(--amber), not var(--gold) — since the 2026-08-11 palette rework,
    // --gold aliases to the new purple brand accent, not the warm "caution"
    // tone Low stock actually needs here.
    const tone = g.worst === "out" ? "var(--danger)" : "var(--amber)";
    return `
      <div class="shopping-pill" data-shopping-restock="${g.itemIds.join(",")}" style="background:color-mix(in srgb, ${tone} 10%, var(--surface));border-color:color-mix(in srgb, ${tone} 32%, var(--line));">
        ${g.name}${g.itemIds.length > 1 ? `<span class="shopping-pill-count">×${g.itemIds.length}</span>` : ""}
      </div>
    `;
  };
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Shopping list</span></div>
      <div class="shopping-pill-row">${[...groups.values()].map(pillHtml).join("")}</div>
    </div>
  `;
}

function statRowHtml(state) {
  const activeModeKey = state.household.activeMode;
  const visibleSpaces = visibleSpaceIds(state);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const openRoutineRows = state.occurrences
    .filter((occ) => occ.state !== "done" && occ.state !== "snoozed")
    .map((occ) => enrichRoutine(occ, state))
    .filter((r) => r.routine && !isPausedNow(r.routine, activeModeKey))
    .filter((r) => visibleSpaces.has(r.routine.spaceId));
  const openTaskRows = state.tasks
    .filter((t) => !t.done && (!t.spaceId || visibleSpaces.has(t.spaceId)))
    .map((t) => enrichTask(t, state));
  const openRows = [...openRoutineRows, ...openTaskRows];

  const overdueCount = openRows.filter((r) => r.state === "overdue").length;
  // Same literal-today fix as render()'s own due bucket, so the stat tile
  // and the section beneath it always agree.
  const dueTodayCount = openRows.filter((r) => r.state === "due" && r.offset === 0).length;
  const weekCount = openRows.filter((r) => r.offset >= 0 && r.offset <= 6).length;

  const withinLast7 = (dateStr) => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    const offset = Math.round((today - d) / 86400000);
    return offset >= 0 && offset <= 6;
  };
  const completedCount = state.ledger.filter((entry) => {
      if (!withinLast7(entry.doneAt)) return false;
      const routine = byId(state.routines, entry.routineId);
      return routine && visibleSpaces.has(routine.spaceId);
    }).length
    + state.tasks.filter((t) => t.done && t.doneAt && withinLast7(t.doneAt) && (!t.spaceId || visibleSpaces.has(t.spaceId))).length;

  // Out/low/expiring stock, same bucketing Stock itself uses (js/routes/
  // stock.js's bucketOf) so this always matches what tapping through
  // actually shows. One extra number here beats a second list on Today
  // (2026-08-05, user request: see what needs restocking "without making
  // it cluttered").
  const stockAlertCount = state.items.filter((i) => visibleSpaces.has(i.spaceId) && bucketOf(i) !== "ok").length;

  // Order: Overdue, Due today, This week, Completed, Low stock (2026-08-09,
  // user request) — was Low stock before Completed.
  const tiles = [
    { id: "overdue", value: overdueCount, label: "Overdue", tone: overdueCount ? "var(--terracotta)" : null, action: "jump:section-overdue" },
    // var(--amber), not var(--gold) — since the 2026-08-11 palette rework,
    // --gold aliases to the new purple brand accent, which this tile
    // shouldn't borrow just because something's due (not yet urgent).
    { id: "due-today", value: dueTodayCount, label: "Due today", tone: dueTodayCount ? "var(--amber)" : null, action: "today:section-due" },
    { id: "this-week", value: weekCount, label: "This week", tone: null, action: "week:section-due" },
    { id: "completed-week", value: completedCount, label: "Completed", tone: "var(--done)", action: null },
    { id: "low-stock", value: stockAlertCount, label: "Low stock", tone: stockAlertCount ? "var(--terracotta)" : null, action: "tab:stock" },
  ];

  // Tone now also washes the tile's own background, not just the number
  // (2026-08-11, user follow-up: "more pronounced... but keeping it
  // premium and soothing") — a soft color-mix tint, same restrained
  // technique already used for Insights' score card and consequence-tier
  // rows, so five tiles' worth of color reads as considered rather than a
  // wall of plain white cards with just colored digits on them.
  return `
    <div class="stat-row">
      ${tiles
        .map(
          (t) => `
        <div class="stat-tile" ${t.action ? `data-tile-action="${t.action}" role="button" tabindex="0"` : ""} style="${t.tone ? `background:color-mix(in srgb, ${t.tone} 8%, var(--surface));border-color:color-mix(in srgb, ${t.tone} 24%, var(--line));` : ""}">
          <div class="stat-tile-value" style="${t.tone ? `color:${t.tone};` : ""}">${t.value}</div>
          <div class="stat-tile-label">${t.label}</div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function topbarHtml(state) {
  const activeMode = state.modes.find((m) => m.key === state.household.activeMode);
  return `
    <div class="topbar">
      <h1>Today</h1>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="icon-chip-btn" id="quick-add-btn" aria-label="Add routine, habit, or task">${Icon("plus", { size: 16 })}</button>
        <button class="mode-chip" id="mode-chip-btn">${Icon("sparkle", { size: 14 })} ${activeMode?.label || "Normal"}</button>
      </div>
    </div>
  `;
}

function modesSheetHtml(state) {
  const rows = state.modes
    .map(
      (m) => `
      <button class="chip" data-mode-key="${m.key}" aria-pressed="${m.active}" style="width:100%;justify-content:flex-start;margin-bottom:8px;">
        ${m.label}
      </button>`,
    )
    .join("");
  return rows;
}

function render() {
  const state = getState();
  multiHouseActive = (state.household.activeHouseIds?.length ?? state.houses.length) > 1;
  const rows = visibleRows(state);
  const overdue = rows.filter((r) => r.state === "overdue");
  // "Today" view keeps the engine's window-gated due state (matches every
  // prior round's behavior). "This week" view instead buckets by raw due
  // date offset (0-6 days out), which also surfaces "pending" rows whose
  // window hasn't opened yet but whose due date already falls this week
  // (2026-08-05, user request: a toggle to see the whole week at a glance).
  // "Due today" means literally due today, not merely inside the engine's
  // multi-day due-window (2026-08-08, user report: "only today should
  // come not the entire week") — a row whose actual due date is a few
  // days out but already inside its `windowDays` head-start (memo §5.1)
  // used to qualify as `state === "due"` and leak into this section early.
  // The "This week" toggle is the intentional place to look ahead; the
  // default view now strictly checks the literal day offset.
  const due = view === "week" ? rows.filter((r) => r.offset >= 0 && r.offset <= 6) : rows.filter((r) => r.state === "due" && r.offset === 0);
  const dueHabits = visibleDueHabits(state);

  mountEl.innerHTML = `
    ${topbarHtml(state)}
    ${statRowHtml(state)}
    <div class="today-section" style="padding-top:4px;">
      <div class="today-chip-row">
        ${chip("10 free min?", { active: effortOnly, dataAttrs: 'id="effort-filter"' })}
        ${chip("Today", { active: view === "today", dataAttrs: 'data-view="today"' })}
        ${chip("This week", { active: view === "week", dataAttrs: 'data-view="week"' })}
        ${chip("Batches", { active: showBatches, dataAttrs: 'id="batches-toggle"' })}
        ${state.household.smoothingMode === "manual" ? chip("Smoothen", { active: false, dataAttrs: 'id="smoothen-btn"' }) : ""}
      </div>
      ${memberFilterHtml(state)}
    </div>
    ${showBatches ? batchesSectionHtml(state, [...overdue, ...due]) : ""}
    ${sectionHtml("Overdue", overdue)}
    ${sectionHtml(view === "week" ? "Due this week" : "Due today", due, { sortByOffset: view === "week" })}
    ${habitsSectionHtml(state)}
    ${
      !overdue.length && !due.length && !dueHabits.length
        ? emptyState({ message: "Nothing due right now. The house is quiet.", actionLabel: null })
        : ""
    }
    ${shoppingListSectionHtml(state)}
  `;

  wireEvents();
}

function wireEvents() {
  const state = getState();

  document.getElementById("effort-filter")?.addEventListener("click", () => {
    effortOnly = !effortOnly;
    render();
  });

  document.getElementById("batches-toggle")?.addEventListener("click", () => {
    showBatches = !showBatches;
    render();
  });

  document.getElementById("smoothen-btn")?.addEventListener("click", () => {
    const moves = runSmoothingNow();
    showToast(moves.length ? `${moves.length} routine${moves.length === 1 ? "" : "s"} rescheduled to balance the week` : "Nothing needed rescheduling");
  });

  mountEl.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view = btn.dataset.view;
      render();
    });
  });

  document.getElementById("quick-add-btn")?.addEventListener("click", () => {
    openRoutineEditor({ defaultKind: "task" });
  });

  mountEl.querySelectorAll("[data-member-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      memberFilter = btn.dataset.memberFilter || null;
      render();
    });
  });

  document.getElementById("mode-chip-btn")?.addEventListener("click", () => {
    openSheet({ title: "Set mode", bodyHtml: modesSheetHtml(state) });
    document.querySelectorAll("[data-mode-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveMode(btn.dataset.modeKey);
        closeSheet();
      });
    });
  });

  mountEl.querySelectorAll(".occ-row[data-entry-type='routine']").forEach((row) => {
    const occId = row.dataset.entryId;
    attachSwipe(row, { onSwipeRight: () => markDone(occId), onSwipeLeft: () => markSnoozed(occId) });
  });

  mountEl.querySelectorAll(".occ-row[data-entry-type='task']").forEach((row) => {
    const taskId = row.dataset.entryId;
    attachSwipe(row, { onSwipeRight: () => markTaskDone(taskId), onSwipeLeft: () => markTaskDone(taskId) });
  });

  // Habits swipe too, but there's no "snooze" equivalent — either
  // direction just marks it done (2026-08-04, user request).
  mountEl.querySelectorAll(".occ-row[data-habit-id]").forEach((row) => {
    const habitId = row.dataset.habitId;
    attachSwipe(row, { onSwipeRight: () => markHabitDone(habitId), onSwipeLeft: () => markHabitDone(habitId) });
  });

  // Shopping list tiles restock by the smallest step on tap — +1 for a
  // quantity item, "mark in stock" for a binary one (2026-08-10) — same
  // mutations Stock's own stepper/toggle buttons already use.
  mountEl.querySelectorAll("[data-shopping-restock]").forEach((tile) => {
    tile.addEventListener("click", () => {
      // Comma-separated when the pill represents the same item low/out
      // across more than one room (shoppingListSectionHtml's own grouping)
      // — restocking the pill tops up every one of them, not just one.
      const ids = tile.dataset.shoppingRestock.split(",");
      let name = "";
      for (const id of ids) {
        const item = byId(getState().items, id);
        if (!item) continue;
        name = item.name;
        if (item.binary) updateItem(id, { qty: 1, status: "ok" });
        else adjustItemQty(id, 1);
      }
      haptic(4);
      showToast(ids.length > 1 ? `Restocked ${ids.length} — ${name}` : `Restocked — ${name}`);
    });
  });

  // Stat tiles: "jump" scrolls to a section already on screen, "today"/
  // "week" switch to that view first (then scroll once it's rendered —
  // 2026-08-09, user report: clicking "Due today" while already in the
  // This week view just scrolled to whatever was on screen instead of
  // actually showing today's due list), "tab" hands off to the Stock
  // tab's own tabbar button (2026-08-05) rather than duplicating boot.js's
  // routing here.
  mountEl.querySelectorAll("[data-tile-action]").forEach((tile) => {
    tile.addEventListener("click", () => {
      const [kind, target] = tile.dataset.tileAction.split(":");
      if (kind === "jump") {
        document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (kind === "today" || kind === "week") {
        view = kind;
        render();
        requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }));
      } else if (kind === "tab") {
        document.querySelector(`[data-tab="${target}"]`)?.click();
      }
    });
  });
}

const SWIPE_THRESHOLD = 90;
const SWIPE_DIRECTION_THRESHOLD = 8; // px of movement before committing to horizontal vs vertical

// Direction disambiguation + rAF-batched transform writes (2026-08-03, user
// report: "scrolling is not very smooth"). The old version captured the
// pointer and wrote row.style.transform on every single pointermove from
// the moment a finger touched a row — including pure vertical scrolls,
// which made every scroll starting on a row fight the swipe handler's JS
// for the same touch instead of just letting the browser's native scroll
// compositor run. Now direction is decided first (bail out to native
// scroll if the gesture is more vertical than horizontal), and only a
// committed horizontal drag ever calls setPointerCapture or touches style.
// Generalized to {onSwipeRight, onSwipeLeft} callbacks (2026-08-04) so the
// same gesture code serves routine/task/habit rows instead of being
// hardcoded to markDone/markSnoozed.
function attachSwipe(row, { onSwipeRight, onSwipeLeft } = {}) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let pointerId = null;
  let rafPending = false;

  function applyTransform() {
    rafPending = false;
    row.style.transform = `translateX(${dx}px)`;
  }

  row.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dragging = false;
    pointerId = e.pointerId;
    row.style.transition = "none";
  });

  row.addEventListener("pointermove", (e) => {
    if (pointerId === null) return;
    const moveX = e.clientX - startX;
    const moveY = e.clientY - startY;

    if (!dragging) {
      if (Math.abs(moveX) < SWIPE_DIRECTION_THRESHOLD && Math.abs(moveY) < SWIPE_DIRECTION_THRESHOLD) return;
      if (Math.abs(moveY) > Math.abs(moveX)) {
        pointerId = null; // vertical intent — hand off to native scroll entirely
        return;
      }
      dragging = true;
      row.setPointerCapture(pointerId);
    }

    dx = moveX;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(applyTransform);
    }
  });

  function finish() {
    pointerId = null;
    if (!dragging) return;
    dragging = false;
    row.style.transition = "transform var(--dur-fast) var(--ease-std)";
    if (dx > SWIPE_THRESHOLD) {
      row.style.transform = "translateX(120%)";
      setTimeout(() => onSwipeRight?.(), 140);
    } else if (dx < -SWIPE_THRESHOLD) {
      row.style.transform = "translateX(-120%)";
      setTimeout(() => onSwipeLeft?.(), 140);
    } else {
      row.style.transform = "translateX(0)";
    }
    dx = 0;
  }

  row.addEventListener("pointerup", finish);
  row.addEventListener("pointercancel", finish);
}

function markDone(occId) {
  const state = getState();
  const routine = byId(state.routines, byId(state.occurrences, occId)?.routineId);
  // Attributed to the routine's default assignee (2026-08-05) — completeOccurrence
  // was never passed a doneBy at all before this, so the ledger's attribution
  // field went permanently unused and Phase 5's load balancing (§5.5) had
  // nothing to compute from. There's no "who actually did this" prompt in the
  // UI (not asked for), so this is a reasonable stand-in: who it's normally
  // assigned to, same person already shown on the row.
  completeOccurrence(occId, routine?.defaultAssigneeId ?? null);
  haptic(10);
  showToast(`Marked done${routine ? ` — ${routine.title}` : ""}`, { onUndo: undoLast });
}

function markSnoozed(occId) {
  const state = getState();
  const routine = byId(state.routines, byId(state.occurrences, occId)?.routineId);
  snoozeOccurrence(occId, 1);
  haptic(6);
  showToast(`Snoozed${routine ? ` — ${routine.title}` : ""}`, { onUndo: undoLast });
}

// completeTask/uncompleteTask are symmetric, so undo is just calling the
// reverse — no snapshot bookkeeping needed the way occurrence undo works.
function markTaskDone(taskId) {
  const task = byId(getState().tasks, taskId);
  completeTask(taskId);
  haptic(10);
  showToast(`Marked done${task ? ` — ${task.title}` : ""}`, { onUndo: () => uncompleteTask(taskId) });
}

// toggleHabitToday is a pure toggle, so calling it again in onUndo exactly
// reverses this — no snapshot bookkeeping needed the way occurrences use.
function markHabitDone(habitId) {
  const habit = byId(getState().habits, habitId);
  toggleHabitToday(habitId);
  haptic(10);
  showToast(`Marked done${habit ? ` — ${habit.title}` : ""}`, { onUndo: () => toggleHabitToday(habitId) });
}

function mount(el) {
  mountEl = el;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount };
