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

import { getState, subscribe, completeOccurrence, snoozeOccurrence, setActiveMode, undoLast, isHabitDueToday, toggleHabitToday, taskState, taskOverdueDays, completeTask, uncompleteTask, byId } from "../state.js";
import { stateOf, overdueDays } from "../engine.js";
import { Icon } from "../ui/icons.js";
import { chip, emptyState, showToast, openSheet, closeSheet, haptic } from "../ui/components.js";
import { openRoutineEditor } from "./routine.js";
import { bucketOf } from "./stock.js";

const TIER_RANK = { safety: 4, damaging: 3, degrading: 2, cosmetic: 1 };
// Human labels instead of the old "E1"/"E4" shorthand (2026-08-04, user
// feedback: "i dont understand the e4, e3 e1... remove it").
const EFFORT_LABEL = { 1: "2 min", 2: "15 min", 3: "1 hr", 4: "Half day", 5: "Vendor" };

let effortOnly = false;
let memberFilter = null; // personId, or null for everyone
let view = "today"; // "today" | "week" (2026-08-05, user request)
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
  return {
    type: "routine", occ, routine, space,
    title: routine?.title, tier: routine?.consequence || "cosmetic", effort: routine?.effort ?? null,
    assigneeId: routine?.defaultAssigneeId ?? null,
    state: stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, new Date()),
    days: overdueDays({ dueAt: occ.dueAt }, new Date()),
    offset: dayOffset(occ.dueAt),
  };
}

function enrichTask(task, state) {
  const space = task.spaceId ? byId(state.spaces, task.spaceId) : null;
  return {
    type: "task", task, space,
    title: task.title, tier: "cosmetic", effort: null,
    assigneeId: task.assigneeId ?? null,
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
  const routineRows = state.occurrences
    .filter((o) => o.state !== "done" && o.state !== "snoozed")
    .map((o) => enrichRoutine(o, state))
    .filter((r) => r.routine && !isPausedNow(r.routine, activeModeKey))
    .filter((r) => !effortOnly || r.effort === 1);
  const taskRows = state.tasks
    .filter((t) => !t.done)
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
  const loud = state === "overdue" && (tier === "damaging" || tier === "safety");
  const meta = dueLabel(row);
  let metaClass = "occ-row-meta";
  if (loud) metaClass += tier === "safety" ? " safety-overdue" : " overdue";
  const entryId = type === "routine" ? row.occ.id : row.task.id;
  const icon = space?.icon || (type === "task" ? "task" : "house");
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

  return `
    <div class="occ-row-wrap" data-entry-type="${type}" data-entry-id="${entryId}">
      <div class="occ-row-actions">${actionsHtml}</div>
      <div class="occ-row" data-tier="${tier}" data-entry-type="${type}" data-entry-id="${entryId}">
        <div class="occ-row-icon">${Icon(icon, { size: 18 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title">${title}</div>
          <div class="${metaClass}">${meta}${space ? ` · ${space.name}` : ""}${type === "task" ? " · Task" : ""}</div>
        </div>
        ${effort ? `<div class="occ-row-effort">${EFFORT_LABEL[effort] || ""}</div>` : ""}
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

function habitsSectionHtml(state) {
  const due = state.habits.filter((h) => isHabitDueToday(h) && (!memberFilter || h.personId === memberFilter));
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

function statRowHtml(state) {
  const activeModeKey = state.household.activeMode;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const openRoutineRows = state.occurrences
    .filter((occ) => occ.state !== "done" && occ.state !== "snoozed")
    .map((occ) => enrichRoutine(occ, state))
    .filter((r) => r.routine && !isPausedNow(r.routine, activeModeKey));
  const openTaskRows = state.tasks.filter((t) => !t.done).map((t) => enrichTask(t, state));
  const openRows = [...openRoutineRows, ...openTaskRows];

  const overdueCount = openRows.filter((r) => r.state === "overdue").length;
  const dueTodayCount = openRows.filter((r) => r.state === "due").length;
  const weekCount = openRows.filter((r) => r.offset >= 0 && r.offset <= 6).length;

  const withinLast7 = (dateStr) => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    const offset = Math.round((today - d) / 86400000);
    return offset >= 0 && offset <= 6;
  };
  const completedCount = state.ledger.filter((entry) => withinLast7(entry.doneAt)).length
    + state.tasks.filter((t) => t.done && t.doneAt && withinLast7(t.doneAt)).length;

  // Out/low/expiring stock, same bucketing Stock itself uses (js/routes/
  // stock.js's bucketOf) so this always matches what tapping through
  // actually shows. One extra number here beats a second list on Today
  // (2026-08-05, user request: see what needs restocking "without making
  // it cluttered").
  const stockAlertCount = state.items.filter((i) => bucketOf(i) !== "ok").length;

  const tiles = [
    { id: "overdue", value: overdueCount, label: "Overdue", tone: overdueCount ? "var(--terracotta)" : null, action: "jump:section-overdue" },
    { id: "due-today", value: dueTodayCount, label: "Due today", tone: dueTodayCount ? "var(--gold)" : null, action: "jump:section-due" },
    { id: "this-week", value: weekCount, label: "This week", tone: null, action: "week:section-due" },
    { id: "low-stock", value: stockAlertCount, label: "Low stock", tone: stockAlertCount ? "var(--terracotta)" : null, action: "tab:stock" },
    { id: "completed-week", value: completedCount, label: "Completed this week", tone: "var(--done)", action: null },
  ];

  return `
    <div class="stat-row">
      ${tiles
        .map(
          (t) => `
        <div class="stat-tile" ${t.action ? `data-tile-action="${t.action}" role="button" tabindex="0"` : ""}>
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
  const rows = visibleRows(state);
  const overdue = rows.filter((r) => r.state === "overdue");
  // "Today" view keeps the engine's window-gated due state (matches every
  // prior round's behavior). "This week" view instead buckets by raw due
  // date offset (0-6 days out), which also surfaces "pending" rows whose
  // window hasn't opened yet but whose due date already falls this week
  // (2026-08-05, user request: a toggle to see the whole week at a glance).
  const due = view === "week" ? rows.filter((r) => r.offset >= 0 && r.offset <= 6) : rows.filter((r) => r.state === "due");
  const dueHabits = state.habits.filter((h) => isHabitDueToday(h) && (!memberFilter || h.personId === memberFilter));

  mountEl.innerHTML = `
    ${topbarHtml(state)}
    ${statRowHtml(state)}
    <div class="today-section" style="padding-top:4px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${chip("10 free minutes?", { active: effortOnly, dataAttrs: 'id="effort-filter"' })}
        ${chip("Today", { active: view === "today", dataAttrs: 'data-view="today"' })}
        ${chip("This week", { active: view === "week", dataAttrs: 'data-view="week"' })}
      </div>
      ${memberFilterHtml(state)}
    </div>
    ${sectionHtml("Overdue", overdue)}
    ${sectionHtml(view === "week" ? "Due this week" : "Due today", due, { sortByOffset: view === "week" })}
    ${habitsSectionHtml(state)}
    ${
      !overdue.length && !due.length && !dueHabits.length
        ? emptyState({ message: "Nothing due right now. The house is quiet.", actionLabel: null })
        : ""
    }
  `;

  wireEvents();
}

function wireEvents() {
  const state = getState();

  document.getElementById("effort-filter")?.addEventListener("click", () => {
    effortOnly = !effortOnly;
    render();
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

  // Stat tiles: "jump" scrolls to a section already on screen, "week"
  // switches to the This week view first (then scrolls once it's
  // rendered), "tab" hands off to the Stock tab's own tabbar button
  // (2026-08-05) rather than duplicating boot.js's routing here.
  mountEl.querySelectorAll("[data-tile-action]").forEach((tile) => {
    tile.addEventListener("click", () => {
      const [kind, target] = tile.dataset.tileAction.split(":");
      if (kind === "jump") {
        document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (kind === "week") {
        view = "week";
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
  completeOccurrence(occId);
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
