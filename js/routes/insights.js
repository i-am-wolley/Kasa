// Insights (build-plan Phase 6) — deliberately NOT the memo's literal spec.
// The memo's §6 also bundles AI features (photo sweep, bill scan) that need
// a Cloud Function proxy that doesn't exist yet (Phase 4/6 both blocked on
// Firebase) — those are skipped here, not silently dropped: see the "not
// built yet" note at the bottom of this file's render(). What IS built is
// everything that's honestly answerable from data already in state, without
// an LLM (memo §5.10's own hard boundary, applied to this screen too):
//
// - House health score: one number, composite of overdue severity, stock
//   health, and asset service compliance — a synthesis Today/House/Stock
//   don't give you (they show lists, not a "how are we doing" signal).
// - This week: a 7-day completion trend from the ledger — shows the SHAPE
//   of the week (which days things get done), not just Today's single
//   "completed this week" count.
// - Attention needed: the top ~5 things across routines/stock/assets
//   ranked together, so you don't have to check three screens to find
//   what actually matters most right now.
// - Help on leave impact (memo §6.3's own "hero feature"): cross-references
//   a helper's leave dates against routines they normally own, due in that
//   window — a genuine insight (connecting two otherwise-separate records),
//   not just a re-list.
// - Habits: each person's 72-day grid (js/ui/habitGrid.js).

import { getState, subscribe, habitStreak, byId } from "../state.js";
import { stateOf, overdueDays } from "../engine.js";
import { Icon } from "../ui/icons.js";
import { habitGridHtml } from "../ui/habitGrid.js";

let mountEl = null;
let unsubscribe = null;

function isPausedNow(routine, activeModeKey) {
  return routine.modeFilters?.pauseIn?.includes(activeModeKey);
}

// ---- House health score ---------------------------------------------------

const TIER_PENALTY = { safety: 8, damaging: 5, degrading: 2, cosmetic: 1 };

function computeHealth(state) {
  const activeModeKey = state.household.activeMode;
  let overduePenalty = 0;
  for (const occ of state.occurrences) {
    if (occ.state === "done" || occ.state === "snoozed") continue;
    const routine = byId(state.routines, occ.routineId);
    if (!routine || isPausedNow(routine, activeModeKey)) continue;
    if (stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, new Date()) !== "overdue") continue;
    overduePenalty += TIER_PENALTY[routine.consequence] || 1;
  }
  overduePenalty = Math.min(40, overduePenalty);

  const outCount = state.items.filter((i) => i.status === "out").length;
  const lowCount = state.items.filter((i) => i.status === "low").length;
  const stockPenalty = Math.min(30, outCount * 3 + lowCount);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueAssets = state.assets.filter((a) => a.nextServiceDue && new Date(a.nextServiceDue) < today).length;
  const assetPenalty = Math.min(30, overdueAssets * 5);

  const score = Math.max(0, Math.round(100 - overduePenalty - stockPenalty - assetPenalty));
  return { score, overduePenalty, stockPenalty, assetPenalty, outCount, lowCount, overdueAssets };
}

function scoreLabel(score) {
  if (score >= 90) return "Thriving";
  if (score >= 70) return "Doing well";
  if (score >= 50) return "Needs attention";
  return "Falling behind";
}

function scoreExplain(h) {
  const top = Math.max(h.overduePenalty, h.stockPenalty, h.assetPenalty);
  if (top === 0) return "Nothing dragging this down right now.";
  if (top === h.overduePenalty) return "Overdue routines are the biggest drag — clear the loud ones on Today first.";
  if (top === h.stockPenalty) return `${h.outCount} item${h.outCount === 1 ? "" : "s"} out, ${h.lowCount} running low.`;
  return `${h.overdueAssets} asset${h.overdueAssets === 1 ? "" : "s"} overdue for service.`;
}

function healthCardHtml(state) {
  const h = computeHealth(state);
  return `
    <div class="today-section">
      <div class="insight-score-card">
        <div class="insight-score-value">${h.score}</div>
        <div class="insight-score-label">${scoreLabel(h.score)}</div>
        <div class="insight-score-explain">${scoreExplain(h)}</div>
      </div>
    </div>
  `;
}

// ---- This week trend --------------------------------------------------

function weekTrendHtml(state) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = state.ledger.filter((l) => l.doneAt.slice(0, 10) === dateStr).length;
    days.push({ count, label: d.toLocaleDateString("en-IN", { weekday: "narrow" }), isToday: i === 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.count));
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">This week</span></div>
      <div class="week-trend">
        ${days
          .map(
            (d) => `
          <div class="week-trend-col">
            <div class="week-trend-count font-num">${d.count || ""}</div>
            <div class="week-trend-bar${d.isToday ? " today" : ""}" style="height:${d.count ? Math.max(6, Math.round((d.count / max) * 48)) : 3}px;"></div>
            <div class="week-trend-label">${d.label}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
}

// ---- Attention needed — top-5 digest across routines/stock/assets --------

function attentionItems(state) {
  const activeModeKey = state.household.activeMode;
  const out = [];

  for (const occ of state.occurrences) {
    if (occ.state === "done" || occ.state === "snoozed") continue;
    const routine = byId(state.routines, occ.routineId);
    if (!routine || isPausedNow(routine, activeModeKey)) continue;
    if (stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, new Date()) !== "overdue") continue;
    if (routine.consequence !== "safety" && routine.consequence !== "damaging") continue;
    const days = overdueDays({ dueAt: occ.dueAt }, new Date());
    const space = byId(state.spaces, routine.spaceId);
    out.push({
      icon: space?.icon || "house", title: routine.title, meta: `Overdue by ${days}d · ${space?.name || ""}`,
      rank: (routine.consequence === "safety" ? 100 : 80) + days,
    });
  }

  for (const item of state.items) {
    if (item.status !== "out") continue;
    const space = byId(state.spaces, item.spaceId);
    out.push({ icon: item.icon || "stock", title: item.name, meta: `Out of stock · ${space?.name || ""}`, rank: 70 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const asset of state.assets) {
    if (!asset.nextServiceDue || new Date(asset.nextServiceDue) >= today) continue;
    const space = byId(state.spaces, asset.spaceId);
    out.push({ icon: asset.icon || "warranty", title: `${asset.name} service`, meta: `Overdue · ${space?.name || ""}`, rank: 75 });
  }

  return out.sort((a, b) => b.rank - a.rank).slice(0, 5);
}

function attentionSectionHtml(state) {
  const items = attentionItems(state);
  if (!items.length) {
    return `
      <div class="today-section">
        <div class="section-head"><span class="eyebrow">Attention needed</span></div>
        <p style="color:var(--ink-muted);font-size:var(--fs-meta);">Nothing urgent across routines, stock, or assets right now.</p>
      </div>
    `;
  }
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Attention needed</span></div>
      ${items
        .map(
          (i) => `
        <div class="list-row" style="cursor:default;">
          <div class="occ-row-icon">${Icon(i.icon, { size: 16 })}</div>
          <div class="occ-row-body">
            <div class="occ-row-title">${i.title}</div>
            <div class="occ-row-meta">${i.meta}</div>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

// ---- Help on leave impact (memo §6.3 hero feature) ------------------------

function helpLeaveImpacts(state) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 7);

  const impacts = [];
  for (const person of state.people) {
    if (person.kind !== "help") continue;
    for (const l of person.leave || []) {
      const from = new Date(l.from);
      const to = new Date(l.to);
      if (to < today || from > soon) continue;
      const affected = state.occurrences
        .filter((occ) => {
          if (occ.state === "done" || occ.state === "snoozed") return false;
          const routine = byId(state.routines, occ.routineId);
          if (!routine || routine.ownerClass !== "help") return false;
          const due = new Date(occ.dueAt);
          return due >= from && due <= to;
        })
        .map((occ) => byId(state.routines, occ.routineId)?.title)
        .filter(Boolean);
      if (affected.length) impacts.push({ person, from: l.from, to: l.to, affected });
    }
  }
  return impacts;
}

function helpLeaveSectionHtml(state) {
  const impacts = helpLeaveImpacts(state);
  if (!impacts.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Help on leave</span></div>
      ${impacts
        .map(
          (imp) => `
        <div class="list-row" style="cursor:default;">
          <div class="occ-row-icon">${Icon("helper", { size: 16 })}</div>
          <div class="occ-row-body">
            <div class="occ-row-title">${imp.person.name} away ${imp.from} → ${imp.to}</div>
            <div class="occ-row-meta">${imp.affected.length} routine${imp.affected.length === 1 ? "" : "s"} due then: ${imp.affected.join(", ")}</div>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

// ---- Habits — 72-day grid per person's habit -------------------------

function habitsSectionHtml(state) {
  if (!state.habits.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Habits</span></div>
      ${state.habits
        .map((h) => {
          const person = byId(state.people, h.personId);
          const streak = habitStreak(h.id);
          return `
          <div style="margin-bottom:18px;">
            <div class="occ-row-title named">${h.title}</div>
            <div class="occ-row-meta" style="margin-bottom:8px;">${person?.name || "—"} · ${streak > 0 ? `${streak} day streak` : "no streak yet"}</div>
            ${habitGridHtml(h.id)}
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

function render() {
  const state = getState();
  mountEl.innerHTML = `
    <div class="topbar"><h1>Insights</h1></div>
    ${healthCardHtml(state)}
    ${weekTrendHtml(state)}
    ${attentionSectionHtml(state)}
    ${helpLeaveSectionHtml(state)}
    ${habitsSectionHtml(state)}
    <div class="today-section">
      <p style="color:var(--ink-faint);font-size:var(--fs-micro);">Photo sweep, bill scan, and the weekly AI digest need a Cloud Function proxy (memo §5.10's own no-client-side-LLM rule) — those land with Phase 4/6's Firebase pass, not before.</p>
    </div>
  `;
}

function mount(el) {
  mountEl = el;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount };
