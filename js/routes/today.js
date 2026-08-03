// Today screen (memo §8.2) — the default screen. House Line, overdue first
// (only damaging/safety visually loud), then due today, then the effort-1
// filter. Completion is one gesture: swipe right = done, left = snooze.

import { getState, subscribe, completeOccurrence, snoozeOccurrence, setActiveMode, undoLast, byId } from "../state.js";
import { stateOf, overdueDays } from "../engine.js";
import { Icon } from "../ui/icons.js";
import { chip, emptyState, showToast, openSheet, closeSheet } from "../ui/components.js";

const TIER_RANK = { safety: 4, damaging: 3, degrading: 2, cosmetic: 1 };
const TIER_WEIGHT = { safety: 4, damaging: 2.5, degrading: 1.5, cosmetic: 1 };
const HOUSE_LINE_PAST_DAYS = 6;
const HOUSE_LINE_FUTURE_DAYS = 23;

let effortOnly = false;
let mountEl = null;
let unsubscribe = null;

function enrich(occ, state) {
  const routine = byId(state.routines, occ.routineId);
  const space = routine ? byId(state.spaces, routine.spaceId) : null;
  return {
    occ,
    routine,
    space,
    state: stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, new Date()),
    days: overdueDays({ dueAt: occ.dueAt }, new Date()),
  };
}

function isPausedNow(routine, activeModeKey) {
  return routine.modeFilters?.pauseIn?.includes(activeModeKey);
}

function visibleRows(state) {
  const activeModeKey = state.household.activeMode;
  return state.occurrences
    .filter((o) => o.state !== "done" && o.state !== "snoozed")
    .map((o) => enrich(o, state))
    .filter((r) => r.routine && !isPausedNow(r.routine, activeModeKey))
    .filter((r) => r.state === "due" || r.state === "overdue")
    .filter((r) => !effortOnly || r.routine.effort === 1);
}

function rowHtml({ occ, routine, space, state, days }) {
  const tier = routine.consequence;
  const loud = state === "overdue" && (tier === "damaging" || tier === "safety");
  let meta = state === "overdue" ? `Overdue by ${days} day${days === 1 ? "" : "s"}` : "Due today";
  let metaClass = "occ-row-meta";
  if (loud) metaClass += tier === "safety" ? " safety-overdue" : " overdue";

  return `
    <div class="occ-row-wrap" data-occ-id="${occ.id}">
      <div class="occ-row-actions">
        <div class="occ-row-action done">${Icon("check", { size: 18 })} Done</div>
        <div class="occ-row-action snooze">Snooze ${Icon("snooze", { size: 18 })}</div>
      </div>
      <div class="occ-row" data-tier="${tier}" data-occ-id="${occ.id}">
        <div class="occ-row-icon">${Icon(space?.icon || "house", { size: 18 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title named">${routine.title}</div>
          <div class="${metaClass}">${meta} · ${space ? space.name : ""}</div>
        </div>
        <div class="occ-row-effort">E${routine.effort}</div>
      </div>
    </div>
  `;
}

function sectionHtml(title, rows) {
  if (!rows.length) return "";
  const sorted = [...rows].sort((a, b) => {
    const rankDiff = TIER_RANK[b.routine.consequence] - TIER_RANK[a.routine.consequence];
    if (rankDiff !== 0) return rankDiff;
    return b.days - a.days;
  });
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">${title}</span></div>
      ${sorted.map(rowHtml).join("")}
    </div>
  `;
}

function houseLineHtml(state) {
  const activeModeKey = state.household.activeMode;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const byDate = {};
  for (const occ of state.occurrences) {
    if (occ.state === "done" || occ.state === "snoozed") continue;
    const routine = byId(state.routines, occ.routineId);
    if (!routine || isPausedNow(routine, activeModeKey)) continue;
    const d = new Date(occ.dueAt);
    d.setHours(0, 0, 0, 0);
    const offset = Math.round((d - today) / 86400000);
    if (offset < -HOUSE_LINE_PAST_DAYS || offset > HOUSE_LINE_FUTURE_DAYS) continue;
    const key = offset;
    if (!byDate[key]) byDate[key] = { points: 0, tier: "cosmetic" };
    byDate[key].points += routine.effort * TIER_WEIGHT[routine.consequence];
    if (TIER_RANK[routine.consequence] > TIER_RANK[byDate[key].tier]) {
      byDate[key].tier = routine.consequence;
    }
  }

  const maxPoints = Math.max(4, ...Object.values(byDate).map((d) => d.points));
  const ticks = [];
  for (let offset = -HOUSE_LINE_PAST_DAYS; offset <= HOUSE_LINE_FUTURE_DAYS; offset++) {
    const day = byDate[offset];
    const height = day ? Math.max(4, Math.round((day.points / maxPoints) * 40)) : 3;
    const color = day && day.tier !== "cosmetic" ? `var(--tier-${day.tier})` : "var(--line)";
    const isToday = offset === 0;
    const d = new Date(today.getTime() + offset * 86400000);
    ticks.push(
      `<div class="house-line-tick" style="height:${height}px;background:${isToday ? "var(--gold)" : color};" title="${d.toDateString()}"></div>`,
    );
  }

  const monthLabel = today.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return `
    <div class="house-line">
      <div class="house-line-track">${ticks.join("")}</div>
      <div class="house-line-caption">${monthLabel} — the house, at a glance</div>
    </div>
  `;
}

function topbarHtml(state) {
  const activeMode = state.modes.find((m) => m.key === state.household.activeMode);
  return `
    <div class="topbar">
      <h1>Today</h1>
      <button class="mode-chip" id="mode-chip-btn">${Icon("sparkle", { size: 14 })} ${activeMode?.label || "Normal"}</button>
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
  const due = rows.filter((r) => r.state === "due");

  mountEl.innerHTML = `
    ${topbarHtml(state)}
    ${houseLineHtml(state)}
    <div class="today-section" style="padding-top:4px;">
      ${chip("10 free minutes?", { active: effortOnly, dataAttrs: 'id="effort-filter"' })}
    </div>
    ${sectionHtml("Overdue", overdue)}
    ${sectionHtml("Due today", due)}
    ${
      !overdue.length && !due.length
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

  document.getElementById("mode-chip-btn")?.addEventListener("click", () => {
    openSheet({ title: "Set mode", bodyHtml: modesSheetHtml(state) });
    document.querySelectorAll("[data-mode-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveMode(btn.dataset.modeKey);
        closeSheet();
      });
    });
  });

  mountEl.querySelectorAll(".occ-row").forEach((row) => attachSwipe(row));
}

const SWIPE_THRESHOLD = 90;

function attachSwipe(row) {
  const occId = row.dataset.occId;
  let startX = 0;
  let dx = 0;
  let dragging = false;

  row.addEventListener("pointerdown", (e) => {
    dragging = true;
    startX = e.clientX;
    row.setPointerCapture(e.pointerId);
    row.style.transition = "none";
  });

  row.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    row.style.transform = `translateX(${dx}px)`;
  });

  function finish() {
    if (!dragging) return;
    dragging = false;
    row.style.transition = "transform var(--dur-fast) var(--ease-std)";
    if (dx > SWIPE_THRESHOLD) {
      row.style.transform = "translateX(120%)";
      setTimeout(() => markDone(occId), 140);
    } else if (dx < -SWIPE_THRESHOLD) {
      row.style.transform = "translateX(-120%)";
      setTimeout(() => markSnoozed(occId), 140);
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
  showToast(`Marked done${routine ? ` — ${routine.title}` : ""}`, { onUndo: undoLast });
}

function markSnoozed(occId) {
  const state = getState();
  const routine = byId(state.routines, byId(state.occurrences, occId)?.routineId);
  snoozeOccurrence(occId, 1);
  showToast(`Snoozed${routine ? ` — ${routine.title}` : ""}`, { onUndo: undoLast });
}

function mount(el) {
  mountEl = el;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount };
