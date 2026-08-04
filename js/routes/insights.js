// Insights (build-plan Phase 6) — deliberately NOT the memo's literal spec.
// The memo's §6 also bundles AI features (photo sweep, bill scan) that need
// a Cloud Function proxy that doesn't exist yet (Phase 4/6 both blocked on
// Firebase) — those are skipped here, not silently dropped: see the note at
// the bottom of render(). What IS built is everything honestly answerable
// from data already in state, without an LLM (memo §5.10's own hard
// boundary, applied to this screen too).
//
// Redesigned 2026-08-04 on direct user feedback ("the score is not
// intuitive, why 78, what needs to be fixed... 7 day trend adds no value"):
// - The health score now ships with an itemized, actionable breakdown
//   instead of one vague sentence — every point lost is a named, counted
//   reason.
// - The 7-day completion trend is gone; it wasn't earning its space.
// - Habit check-in moved to Today (swipe to complete, like a routine) —
//   this screen is now purely the tracking/streak view for habits, not a
//   duplicate action surface, which is most of what's left here now that
//   the trend is gone. Kept as a section rather than spinning up a
//   dedicated Habits screen/tab: a 6th tab would break the memo's own
//   5-tab limit, and there's no other content competing for room here now.

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
  const overdueByTier = { safety: 0, damaging: 0, degrading: 0, cosmetic: 0 };
  for (const occ of state.occurrences) {
    if (occ.state === "done" || occ.state === "snoozed") continue;
    const routine = byId(state.routines, occ.routineId);
    if (!routine || isPausedNow(routine, activeModeKey)) continue;
    if (stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, new Date()) !== "overdue") continue;
    overdueByTier[routine.consequence] = (overdueByTier[routine.consequence] || 0) + 1;
  }
  const overdueCount = Object.values(overdueByTier).reduce((a, b) => a + b, 0);
  let overduePenalty = 0;
  for (const [tier, count] of Object.entries(overdueByTier)) overduePenalty += (TIER_PENALTY[tier] || 1) * count;
  overduePenalty = Math.min(40, overduePenalty);

  const outCount = state.items.filter((i) => i.status === "out").length;
  const lowCount = state.items.filter((i) => i.status === "low").length;
  const stockPenalty = Math.min(30, outCount * 3 + lowCount);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueAssets = state.assets.filter((a) => a.nextServiceDue && new Date(a.nextServiceDue) < today).length;
  const assetPenalty = Math.min(30, overdueAssets * 5);

  const score = Math.max(0, Math.round(100 - overduePenalty - stockPenalty - assetPenalty));
  return { score, overduePenalty, stockPenalty, assetPenalty, overdueCount, overdueByTier, outCount, lowCount, overdueAssets };
}

function scoreLabel(score) {
  if (score >= 90) return "Thriving";
  if (score >= 70) return "Doing well";
  if (score >= 50) return "Needs attention";
  return "Falling behind";
}

// Every point lost gets a named, counted reason — the direct fix for "why
// 78, what needs to be fixed" (2026-08-04 user feedback on the old
// one-sentence explanation).
function scoreBreakdownHtml(h) {
  const rows = [];
  if (h.overduePenalty > 0) {
    const byTier = Object.entries(h.overdueByTier).filter(([, c]) => c > 0).map(([tier, c]) => `${c} ${tier}`).join(", ");
    rows.push({ icon: "today", label: "Overdue routines", points: h.overduePenalty, detail: `${h.overdueCount} item${h.overdueCount === 1 ? "" : "s"} — ${byTier}` });
  }
  if (h.stockPenalty > 0) {
    rows.push({ icon: "stock", label: "Stock running low", points: h.stockPenalty, detail: `${h.outCount} out, ${h.lowCount} low` });
  }
  if (h.assetPenalty > 0) {
    rows.push({ icon: "warranty", label: "Asset service overdue", points: h.assetPenalty, detail: `${h.overdueAssets} asset${h.overdueAssets === 1 ? "" : "s"}` });
  }
  if (!rows.length) {
    return `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">Nothing dragging this down — everything's on track.</p>`;
  }
  return rows
    .map(
      (r) => `
    <div class="list-row" style="cursor:default;">
      <div class="occ-row-icon">${Icon(r.icon, { size: 16 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title">${r.label}</div>
        <div class="occ-row-meta">${r.detail}</div>
      </div>
      <div class="list-row-right font-num" style="color:var(--tier-damaging);">-${r.points}</div>
    </div>
  `,
    )
    .join("");
}

function healthCardHtml(state) {
  const h = computeHealth(state);
  return `
    <div class="today-section">
      <div class="insight-score-card">
        <div class="insight-score-value">${h.score}</div>
        <div class="insight-score-label">${scoreLabel(h.score)}</div>
      </div>
    </div>
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">What's affecting your score</span></div>
      ${scoreBreakdownHtml(h)}
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
// Pure tracking now — check-in itself happens on Today (2026-08-04, user
// request), so this section is the streak/history view, not a second
// place to mark things done.

function habitsSectionHtml(state) {
  if (!state.habits.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Habits</span></div>
      <p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-bottom:12px;">Check these off on Today — this is just the tracking view.</p>
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
