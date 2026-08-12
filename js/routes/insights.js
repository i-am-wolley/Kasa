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
// - The "Attention needed" digest was also removed on a second round of
//   feedback — with the score breakdown now pointing at specifics and
//   Today already listing overdue/due items directly, it was redundant
//   with both rather than adding a third view of the same handful of facts.

import { getState, subscribe, habitStreak, byId, updateRoutine, toggleRoutineActive, visibleSpaceIds, taskState } from "../state.js";
import { stateOf } from "../engine.js";
import { Icon } from "../ui/icons.js";
import { showToast, openSheet } from "../ui/components.js";
import { habitGridHtml } from "../ui/habitGrid.js";
import { snoozeSuggestions, loadBalance, seasonalBoosts, failurePredictions, consumableCoupling, neglectClusters } from "../intel.js";
import { classifyAssetLife } from "./assets.js";

let mountEl = null;
let unsubscribe = null;

function isPausedNow(routine, activeModeKey) {
  return routine.modeFilters?.pauseIn?.includes(activeModeKey);
}

// ---- House health score ---------------------------------------------------

// 2026-08-09: consequence tiers renamed (degrading->unhygienic, safety->unsafe)
const TIER_PENALTY = { unsafe: 8, damaging: 5, unhygienic: 2, cosmetic: 1 };

// Scoped to whichever house(s) the header picker currently has selected
// (2026-08-05, multi-house support) — a single-house household sees the
// exact same score as before.
function computeHealth(state) {
  const activeModeKey = state.household.activeMode;
  const visible = visibleSpaceIds(state);
  const overdueByTier = { unsafe: 0, damaging: 0, unhygienic: 0, cosmetic: 0 };
  for (const occ of state.occurrences) {
    if (occ.state === "done" || occ.state === "snoozed") continue;
    const routine = byId(state.routines, occ.routineId);
    if (!routine || isPausedNow(routine, activeModeKey) || !visible.has(routine.spaceId)) continue;
    if (stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, new Date()) !== "overdue") continue;
    overdueByTier[routine.consequence] = (overdueByTier[routine.consequence] || 0) + 1;
  }
  const overdueCount = Object.values(overdueByTier).reduce((a, b) => a + b, 0);
  let overduePenalty = 0;
  for (const [tier, count] of Object.entries(overdueByTier)) overduePenalty += (TIER_PENALTY[tier] || 1) * count;
  overduePenalty = Math.min(40, overduePenalty);

  const visibleItems = state.items.filter((i) => visible.has(i.spaceId));
  const outCount = visibleItems.filter((i) => i.status === "out").length;
  const lowCount = visibleItems.filter((i) => i.status === "low").length;
  const stockPenalty = Math.min(30, outCount * 3 + lowCount);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueAssets = state.assets.filter((a) => visible.has(a.spaceId) && a.nextServiceDue && new Date(a.nextServiceDue) < today).length;
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
    rows.push({ icon: "today", label: "Overdue routines", points: h.overduePenalty, detail: `${h.overdueCount} item${h.overdueCount === 1 ? "" : "s"} — ${byTier}`, nav: "today" });
  }
  if (h.stockPenalty > 0) {
    rows.push({ icon: "stock", label: "Stock running low", points: h.stockPenalty, detail: `${h.outCount} out, ${h.lowCount} low`, nav: "stock" });
  }
  if (h.assetPenalty > 0) {
    rows.push({ icon: "warranty", label: "Asset service overdue", points: h.assetPenalty, detail: `${h.overdueAssets} asset${h.overdueAssets === 1 ? "" : "s"}`, nav: null });
  }
  if (!rows.length) {
    return `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">Nothing dragging this down — everything's on track.</p>`;
  }
  return rows
    .map(
      (r) => `
    <div class="list-row" ${r.nav ? `data-breakdown-nav="${r.nav}" style="cursor:pointer;"` : `style="cursor:default;"`}>
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

// ---- Per-room health ranking (2026-08-10, user request) -------------------
// A genuinely different formula from computeHealth() above, not a rescoped
// copy — shared with the user as a worked example and approved before
// building. Same overall shape (100 minus capped penalties from three
// buckets), each bucket redefined:
//
// 1. Routines/tasks, max 40 — counts DUE as well as overdue now (not just
//    overdue), due weighted at half severity since it hasn't actually been
//    missed yet. Routines use the existing TIER_PENALTY weights; tasks have
//    no consequence tier, so they use a flat 3 (roughly "damaging"-severity).
// 2. Aging assets, max 30 — reuses the exact lifecycle classification the
//    Assets bar already computes (classifyAssetLife, Round 51), not the
//    old "service overdue" check: 6 points for an asset already past its
//    expected life, 3 for one with under 2 years of life left.
// 3. Understocked, max 30 — same out×3 + low×1 weighting computeHealth()
//    already uses for the household number.
function computeSpaceHealth(state, spaceId) {
  const activeModeKey = state.household.activeMode;
  let routineTaskPenalty = 0;
  const routineDetail = { overdue: 0, due: 0 };
  for (const occ of state.occurrences) {
    if (occ.state === "done" || occ.state === "snoozed") continue;
    const routine = byId(state.routines, occ.routineId);
    if (!routine || isPausedNow(routine, activeModeKey) || routine.spaceId !== spaceId) continue;
    const st = stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, new Date());
    const weight = TIER_PENALTY[routine.consequence] || 1;
    if (st === "overdue") { routineTaskPenalty += weight; routineDetail.overdue += 1; }
    else if (st === "due") { routineTaskPenalty += weight * 0.5; routineDetail.due += 1; }
  }
  const taskDetail = { overdue: 0, due: 0 };
  for (const task of state.tasks) {
    if (task.done || task.spaceId !== spaceId) continue;
    const st = taskState(task);
    if (st === "overdue") { routineTaskPenalty += 3; taskDetail.overdue += 1; }
    else if (st === "due") { routineTaskPenalty += 1.5; taskDetail.due += 1; }
  }
  routineTaskPenalty = Math.min(40, routineTaskPenalty);

  let assetPenalty = 0;
  const assetDetail = { over: 0, nearing: 0 };
  for (const asset of state.assets) {
    if (asset.spaceId !== spaceId) continue;
    const bucket = classifyAssetLife(asset);
    if (bucket === "over") { assetPenalty += 6; assetDetail.over += 1; }
    else if (bucket === "nearing") { assetPenalty += 3; assetDetail.nearing += 1; }
  }
  assetPenalty = Math.min(30, assetPenalty);

  const spaceItems = state.items.filter((i) => i.spaceId === spaceId);
  const outCount = spaceItems.filter((i) => i.status === "out").length;
  const lowCount = spaceItems.filter((i) => i.status === "low").length;
  const stockPenalty = Math.min(30, outCount * 3 + lowCount);

  // A room with zero routines AND zero tasks scores a perfect 100 under
  // this formula (nothing to be overdue on) — which would hide it
  // completely even though "nothing is being watched here" is arguably
  // the more useful signal. Tracked separately so it surfaces regardless
  // of score (see roomHealthSectionHtml's own gating).
  const untracked = !state.routines.some((r) => r.spaceId === spaceId) && !state.tasks.some((t) => t.spaceId === spaceId);

  const score = Math.max(0, Math.round(100 - routineTaskPenalty - assetPenalty - stockPenalty));
  return { score, untracked, routineTaskPenalty, assetPenalty, stockPenalty, routineDetail, taskDetail, assetDetail, outCount, lowCount };
}

function scoreTone(score) {
  if (score >= 90) return "var(--done)";
  if (score >= 70) return "var(--ink-muted)";
  // var(--amber), not var(--gold) — --gold aliases to the brand accent
  // (orange as of the 2026-08-12 mock-based rework), which reads as
  // "action," not "caution," here.
  if (score >= 50) return "var(--amber)";
  return "var(--danger)";
}

// Same "named, counted reason per lost point" shape scoreBreakdownHtml
// already uses for the household score, just built from computeSpaceHealth's
// per-room detail instead.
function spaceBreakdownRows(h) {
  const rows = [];
  if (h.routineTaskPenalty > 0) {
    const bits = [];
    if (h.routineDetail.overdue) bits.push(`${h.routineDetail.overdue} routine${h.routineDetail.overdue === 1 ? "" : "s"} overdue`);
    if (h.routineDetail.due) bits.push(`${h.routineDetail.due} due`);
    if (h.taskDetail.overdue) bits.push(`${h.taskDetail.overdue} task${h.taskDetail.overdue === 1 ? "" : "s"} overdue`);
    if (h.taskDetail.due) bits.push(`${h.taskDetail.due} task${h.taskDetail.due === 1 ? "" : "s"} due`);
    rows.push({ label: "Routines & tasks", points: Math.round(h.routineTaskPenalty * 10) / 10, detail: bits.join(", ") });
  }
  if (h.assetPenalty > 0) {
    const bits = [];
    if (h.assetDetail.over) bits.push(`${h.assetDetail.over} past expected life`);
    if (h.assetDetail.nearing) bits.push(`${h.assetDetail.nearing} nearing end of life`);
    rows.push({ label: "Aging assets", points: h.assetPenalty, detail: bits.join(", ") });
  }
  if (h.stockPenalty > 0) {
    rows.push({ label: "Stock", points: h.stockPenalty, detail: `${h.outCount} out, ${h.lowCount} low` });
  }
  return rows;
}

// Tapping a room pops up its own reasoning (2026-08-10, user request) —
// same itemized "why" pattern the household score already has, just
// scoped to this one room. Plain "Close" button (data-action="cancel")
// reuses openSheet()'s own generic cancel wiring rather than the full
// Save/Delete sheetActions() shape, since there's nothing to save here.
function openSpaceHealthSheet(space, h) {
  const rows = spaceBreakdownRows(h);
  openSheet({
    title: `${space.name} — ${h.untracked ? "Untracked" : h.score}`,
    bodyHtml: `
      ${h.untracked
        ? `<p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-bottom:12px;">No routines or tasks are tracked in this room yet — its score reads as perfect by default, but that just means there's nothing to check it against.</p>`
        : `<p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-bottom:12px;">${scoreLabel(h.score)}</p>
           ${rows.length
             ? rows.map((r) => `
                <div class="list-row" style="cursor:default;">
                  <div class="occ-row-body">
                    <div class="occ-row-title">${r.label}</div>
                    <div class="occ-row-meta">${r.detail}</div>
                  </div>
                  <div class="list-row-right font-num" style="color:var(--tier-damaging);">-${r.points}</div>
                </div>`).join("")
             : `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">Nothing dragging this down.</p>`}`
      }
      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-action="cancel" style="width:100%;">Close</button></div>
    `,
  });
}

// Section only appears if there's something worth surfacing — a room
// scoring under 80, or a room with nothing tracked at all (2026-08-10,
// user request: "let it be shown... only if there are rooms with less
// than 80 score... also highlight spaces with no routines/tasks"). Lists
// only the rooms that actually need a look, worst-first, not a full
// ranking of every room including perfect scores — matches how every
// other Insights section only surfaces what needs attention.
function roomHealthSectionHtml(state) {
  const visible = visibleSpaceIds(state);
  const spaces = state.spaces.filter((s) => visible.has(s.id));
  const withHealth = spaces.map((s) => ({ space: s, h: computeSpaceHealth(state, s.id) }));
  const lowScoring = withHealth.filter((r) => !r.h.untracked && r.h.score < 80).sort((a, b) => a.h.score - b.h.score);
  // Whole home is excluded from the untracked callout specifically
  // (2026-08-11, user request) — it's not a room in itself, it's the
  // mandatory catch-all scope for household-wide routines that don't map
  // to a physical space, so "nothing tracked in Whole home" reads as a
  // false alarm about a room that was never meant to be evaluated that
  // way. Still eligible for the scored/ranked list above if it genuinely
  // has overdue/aging/understocked things linked to it — only the
  // "nothing tracked at all" framing doesn't make sense for it.
  const untracked = withHealth.filter((r) => r.h.untracked && r.space.type !== "whole_home");
  if (!lowScoring.length && !untracked.length) return "";

  const scoredRow = (r) => `
    <div class="list-row" data-space-health-id="${r.space.id}">
      <div class="occ-row-icon">${Icon(r.space.icon || "house", { size: 16 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title">${r.space.name}</div>
        <div class="occ-row-meta">${scoreLabel(r.h.score)}</div>
      </div>
      <div class="list-row-right font-num" style="color:${scoreTone(r.h.score)};font-weight:var(--fw-semibold);font-size:16px;">${r.h.score}</div>
    </div>
  `;
  const untrackedRow = (r) => `
    <div class="list-row" data-space-health-id="${r.space.id}">
      <div class="occ-row-icon">${Icon(r.space.icon || "house", { size: 16 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title">${r.space.name}</div>
        <div class="occ-row-meta">No routines or tasks tracked here</div>
      </div>
    </div>
  `;

  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Room health</span></div>
      ${lowScoring.map(scoredRow).join("")}
      ${untracked.length ? `<p style="color:var(--ink-faint);font-size:var(--fs-micro);margin:${lowScoring.length ? "10px" : "0"} 0 4px;">Nothing tracked yet</p>${untracked.map(untrackedRow).join("")}` : ""}
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

// ---- Asset value — cost, depreciation, overdelivery (2026-08-11) ---------
// `cost` is optional and only exists on assets edited/added since Round 54,
// so this section is deliberately built around "of the assets that HAVE
// cost data" rather than pretending it covers the whole household — see
// the completeness caption in assetValueSectionHtml. Straight-line
// depreciation only (no accelerated/declining-balance option — nothing in
// this app's data model would justify picking a curve over the plain
// linear one already implied by `expectedLifeYears`).
const ASSET_VALUE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function computeAssetValue(state) {
  const visible = visibleSpaceIds(state);
  const assets = state.assets.filter((a) => visible.has(a.spaceId));
  const costed = assets.filter((a) => a.cost != null);
  const totalSpent = costed.reduce((sum, a) => sum + a.cost, 0);

  let depreciationConsumed = 0;
  let overdelivering = 0;
  let savings = 0;
  for (const a of costed) {
    if (!a.purchaseDate || !(a.expectedLifeYears > 0)) continue;
    const ageYears = (Date.now() - new Date(a.purchaseDate).getTime()) / ASSET_VALUE_YEAR_MS;
    const annualDep = a.cost / a.expectedLifeYears;
    depreciationConsumed += Math.min(a.cost, annualDep * ageYears);
    if (ageYears >= a.expectedLifeYears) {
      overdelivering += 1;
      savings += annualDep * (ageYears - a.expectedLifeYears);
    }
  }
  const currentValue = totalSpent - depreciationConsumed;
  const pctDepreciated = totalSpent > 0 ? Math.round((depreciationConsumed / totalSpent) * 100) : 0;

  return { totalSpent, currentValue, depreciationConsumed, pctDepreciated, overdelivering, savings, trackedCount: costed.length, totalCount: assets.length };
}

function formatAssetCost(n) {
  if (!n) return "₹0";
  const round1 = (x) => Math.round(x * 10) / 10;
  if (Math.abs(n) >= 100000) return `₹${round1(n / 100000)}L`;
  if (Math.abs(n) >= 1000) return `₹${round1(n / 1000)}k`;
  return `₹${Math.round(n)}`;
}

// Nothing to show until at least one asset has cost data — matches every
// other Insights section's "don't render an empty/meaningless section"
// convention.
function assetValueSectionHtml(state) {
  const v = computeAssetValue(state);
  if (!v.trackedCount) return "";
  const tiles = [
    { value: formatAssetCost(v.totalSpent), label: "Total spent", tone: null },
    { value: formatAssetCost(v.currentValue), label: "Current value", tone: "var(--done)" },
    { value: formatAssetCost(v.depreciationConsumed), label: "Depreciation consumed", tone: null },
    { value: `${v.pctDepreciated}%`, label: "Value depreciated", tone: null },
    { value: v.overdelivering, label: "Overdelivering assets", tone: v.overdelivering ? "var(--done)" : null },
    { value: formatAssetCost(v.savings), label: "Savings from overdelivery", tone: v.overdelivering ? "var(--done)" : null },
  ];
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Asset value</span></div>
      <div class="stat-row asset-value-row">
        ${tiles.map((t) => `<div class="stat-tile"><div class="stat-tile-value" style="${t.tone ? `color:${t.tone};` : ""}">${t.value}</div><div class="stat-tile-label">${t.label}</div></div>`).join("")}
      </div>
      <p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-top:8px;">${v.trackedCount} of ${v.totalCount} assets have cost tracked — these numbers only cover those.</p>
    </div>
  `;
}

// ---- Habits — 72-day grid per person's habit -------------------------
// Pure tracking now — check-in itself happens on Today (2026-08-04, user
// request), so this section is the streak/history view, not a second
// place to mark things done.
//
// Personal by nature (2026-08-06, user request: "shown only to the
// person who is doing it, not to rest of household") — with more than
// one person owning a habit, this section shows nothing until a specific
// person is picked (same privacy default as Today's own habit section);
// a single habit-owner has nothing to leak, so their grids always show.

let habitsPersonFilter = null;

function habitsPersonFilterHtml(state, owners) {
  if (owners.length < 2) return "";
  return `
    <div class="member-filter-row" style="margin-bottom:12px;">
      ${owners.map((p) => `<button type="button" class="member-chip" data-habits-person-filter="${p.id}" aria-pressed="${habitsPersonFilter === p.id}">${p.name}</button>`).join("")}
    </div>
  `;
}

function habitsSectionHtml(state) {
  if (!state.habits.length) return "";
  const owners = [...new Set(state.habits.map((h) => h.personId))].map((id) => byId(state.people, id)).filter(Boolean);
  const visible = owners.length < 2 ? state.habits : state.habits.filter((h) => h.personId === habitsPersonFilter);
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Habits</span></div>
      <p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-bottom:12px;">Check these off on Today — this is just the tracking view.</p>
      ${habitsPersonFilterHtml(state, owners)}
      ${
        visible.length
          ? visible
              .map((h) => {
                const person = byId(state.people, h.personId);
                const streak = habitStreak(h.id);
                return `
              <div style="margin-bottom:18px;">
                <div class="occ-row-title named">${h.title}</div>
                <div class="occ-row-meta" style="margin-bottom:8px;">${person?.name || "—"} · ${streak > 0 ? `${streak} day streak` : "no streak yet"}</div>
                ${habitGridHtml(h)}
              </div>
            `;
              })
              .join("")
          : owners.length < 2
            ? ""
            : `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">Pick a person above to see their habits.</p>`
      }
    </div>
  `;
}

// ---- Phase 5 — intelligent logic (memo §5.4-§5.9, 2026-08-05) -------------
// §5.2 burn-rate learning and §5.3 adaptive intervals are explicitly NOT
// built (user direction) — everything below is §5.4-§5.9's UI surface.

function smoothingNoticeHtml(state) {
  const moves = state.lastSmoothingMoves || [];
  if (!moves.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">This week was smoothed</span></div>
      <p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-bottom:8px;">${moves.length} flexible routine${moves.length === 1 ? "" : "s"} moved to keep the week under the household's effort ceiling — never anything damaging/unsafe, never a fixed-calendar item.</p>
      ${moves
        .map(
          (m) => `
        <div class="list-row" style="cursor:default;">
          <div class="occ-row-icon">${Icon("today", { size: 16 })}</div>
          <div class="occ-row-body">
            <div class="occ-row-title">${m.title}</div>
            <div class="occ-row-meta">${new Date(m.from).toLocaleDateString("en-IN", { month: "short", day: "numeric" })} → ${new Date(m.to).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}</div>
          </div>
        </div>`,
        )
        .join("")}
    </div>
  `;
}

// §5.4 snooze learning — the richest signal in the app. "ease" suggestions
// get real actions (lengthen/lower/disable); "day-preference" is shown as
// information only (rescheduling a routine's actual trigger day is a
// bigger structural change than this signal alone should force through).
function snoozeSuggestionsHtml(state) {
  const suggestions = snoozeSuggestions(state);
  if (!suggestions.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Worth a second look</span></div>
      ${suggestions
        .map((s) => {
          if (s.type === "disable") {
            return `
            <div class="list-row" style="cursor:default;">
              <div class="occ-row-icon">${Icon("snooze", { size: 16 })}</div>
              <div class="occ-row-body">
                <div class="occ-row-title">${s.title}</div>
                <div class="occ-row-meta">${s.detail}</div>
              </div>
              <button type="button" class="chip" data-disable-routine="${s.routineId}">Turn off</button>
            </div>`;
          }
          if (s.type === "ease") {
            return `
            <div class="list-row" style="cursor:default;">
              <div class="occ-row-icon">${Icon("snooze", { size: 16 })}</div>
              <div class="occ-row-body">
                <div class="occ-row-title">${s.title}</div>
                <div class="occ-row-meta">${s.detail}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0;">
                ${s.canLengthen ? `<button type="button" class="chip" data-lengthen-routine="${s.routineId}" data-current-interval="${s.currentIntervalDays}">Lengthen</button>` : ""}
                <button type="button" class="chip" data-lower-routine="${s.routineId}">Lower priority</button>
              </div>
            </div>`;
          }
          // day-preference — informational
          return `
            <div class="list-row" style="cursor:default;">
              <div class="occ-row-icon">${Icon("sparkle", { size: 16 })}</div>
              <div class="occ-row-body">
                <div class="occ-row-title">${s.title}</div>
                <div class="occ-row-meta">${s.detail}</div>
              </div>
            </div>`;
        })
        .join("")}
    </div>
  `;
}

// §5.5 load balancing — pull-only, phrased about the house, never about a
// person underperforming (memo's own framing). Members only, not paid help.
function loadBalanceHtml(state) {
  const lb = loadBalance(state);
  if (!lb) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">This month's load</span></div>
      <div class="list-row" style="cursor:default;">
        <div class="occ-row-icon">${Icon("person", { size: 16 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title">The house has been leaning on ${lb.leaning.name}</div>
          <div class="occ-row-meta">${lb.sharePct}% of the last ${lb.windowDays} days' effort points, across ${lb.totals.length} people</div>
        </div>
      </div>
    </div>
  `;
}

// §5.8 seasonal intelligence — city-mapped windows (Bengaluru only, per the
// memo's own data), keyword-matched against routines already due/overdue.
function seasonalHtml(state) {
  const boosts = seasonalBoosts(state);
  if (!boosts.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Seasonal</span></div>
      ${boosts
        .map(
          (b) => `
        <div class="list-row" style="cursor:default;">
          <div class="occ-row-icon">${Icon("sparkle", { size: 16 })}</div>
          <div class="occ-row-body">
            <div class="occ-row-title">${b.season} window</div>
            <div class="occ-row-meta">${b.titles.length} thing${b.titles.length === 1 ? "" : "s"} to check: ${b.titles.join(", ")}</div>
          </div>
        </div>`,
        )
        .join("")}
    </div>
  `;
}

const FORECAST_CATEGORY_LABEL = {
  water_heating: "Water heating", water_treatment: "Water treatment", climate: "Climate & air",
  power: "Power", appliance: "Appliances", safety: "Safety", electronics: "Electronics",
};
function forecastCategoryLabel(category) {
  return FORECAST_CATEGORY_LABEL[category] || (category ? category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Other");
}

function forecastRowHtml(icon, title, detail) {
  return `
    <div class="list-row" style="cursor:default;">
      <div class="occ-row-icon">${Icon(icon, { size: 16 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title">${title}</div>
        <div class="occ-row-meta">${detail}</div>
      </div>
    </div>
  `;
}

// Combines same-name aging-asset predictions within a category into one
// strip instead of one per asset (2026-08-10, user request: "instead of
// multiple strips, combine similar strips for similar assets") — three
// exhaust fans read as three near-identical rows before this; now one row,
// "3× Exhaust fan", with an age range and a rising-frequency count instead
// of the same sentence repeated three times. A lone asset (the common
// case) renders exactly as before — nothing to combine.
function combineFailureGroup(name, group) {
  if (group.length === 1) return { icon: group[0].icon, title: name, detail: group[0].detail };
  const ages = group.map((f) => f.ageYears);
  const minAge = Math.min(...ages), maxAge = Math.max(...ages);
  const ageRange = minAge === maxAge ? `${minAge} years old` : `${minAge}–${maxAge} years old`;
  const risingCount = group.filter((f) => f.risingFrequency).length;
  const risingNote = risingCount > 0 ? ` ${risingCount} of ${group.length} needing service more often lately.` : "";
  return {
    icon: group[0].icon,
    title: `${group.length}× ${name}`,
    detail: `${ageRange} (expected life ${group[0].expectedLifeYears}).${risingNote} Worth budgeting for replacement.`,
  };
}

// §5.9 correlation and forecasting — failure prediction, consumable
// coupling, neglect clustering. Redesigned 2026-08-10 on direct user
// feedback ("can it be clustered somehow, like similar assets together") —
// was one flat list interleaving three unrelated signal types with no
// visual distinction at all. Now: a labeled sub-section per signal type
// (only the ones that actually have anything to show), and within "Aging
// assets" specifically — the one that can genuinely grow long in a bigger
// household — a further cluster by the asset's own catalog category
// (water heating, climate, appliances, ...), biggest cluster first, with
// the more urgent "service frequency rising" assets sorted to the top
// within each. The category sub-label itself only renders when there's
// more than one category present — clustering a single-category household
// into one redundantly-labeled group wouldn't add anything.
function forecastHtml(state) {
  const failures = failurePredictions(state);
  const coupled = consumableCoupling(state);
  const neglect = neglectClusters(state);
  if (!failures.length && !coupled.length && !neglect.length) return "";

  const byCategory = {};
  const catOrder = [];
  for (const f of failures) {
    if (!byCategory[f.category]) { byCategory[f.category] = []; catOrder.push(f.category); }
    byCategory[f.category].push(f);
  }
  catOrder.sort((a, b) => byCategory[b].length - byCategory[a].length);
  const showCategoryLabels = catOrder.length > 1;

  const sectionLabel = (label) => `<div style="color:var(--ink-faint);font-size:var(--fs-micro);font-weight:var(--fw-semibold);text-transform:uppercase;letter-spacing:0.04em;margin:10px 0 6px;">${label}</div>`;

  const failuresHtml = failures.length
    ? `
      ${sectionLabel("Aging assets")}
      ${catOrder
        .map((cat) => {
          const byName = {};
          const nameOrder = [];
          for (const f of byCategory[cat]) {
            if (!byName[f.name]) { byName[f.name] = []; nameOrder.push(f.name); }
            byName[f.name].push(f);
          }
          // Most urgent group first: any rising-frequency asset beats a
          // group with none, then by the oldest asset in the group.
          nameOrder.sort((a, b) => {
            const risingA = byName[a].some((f) => f.risingFrequency);
            const risingB = byName[b].some((f) => f.risingFrequency);
            if (risingA !== risingB) return risingA ? -1 : 1;
            return Math.max(...byName[b].map((f) => f.ageYears)) - Math.max(...byName[a].map((f) => f.ageYears));
          });
          return `
        ${showCategoryLabels ? `<div style="color:var(--ink-muted);font-size:var(--fs-micro);margin:6px 0 2px;">${forecastCategoryLabel(cat)}</div>` : ""}
        ${nameOrder.map((name) => { const c = combineFailureGroup(name, byName[name]); return forecastRowHtml(c.icon, c.title, c.detail); }).join("")}
      `;
        })
        .join("")}
    `
    : "";

  const coupledHtml = coupled.length
    ? `
      ${sectionLabel("Consumables to watch")}
      ${coupled.map((c) => forecastRowHtml("stock", c.assetName, `Recently serviced — ${c.items.join(", ")} may need replacing sooner than the calendar suggests.`)).join("")}
    `
    : "";

  const neglectHtml = neglect.length
    ? `
      ${sectionLabel("Neglected spaces")}
      ${neglect.map((n) => forecastRowHtml("house", n.spaceName, `${n.overdueCount} of ${n.totalCount} routines here are overdue — still apply, or worth pausing/removing some?`)).join("")}
    `
    : "";

  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Forecast</span></div>
      ${failuresHtml}${coupledHtml}${neglectHtml}
    </div>
  `;
}

function wireEvents(state) {
  // Score-breakdown rows jump to the screen that actually explains the
  // number (2026-08-05, user request: "idelaly when clicked needs to take
  // to stock or today page") — reuses the tabbar's own click wiring
  // (same data-tab lookup pattern already used elsewhere) rather than a
  // new cross-module navigation function.
  mountEl.querySelectorAll("[data-breakdown-nav]").forEach((row) => {
    row.addEventListener("click", () => {
      document.querySelector(`[data-tab="${row.dataset.breakdownNav}"]`)?.click();
    });
  });

  // Tapping a room pops up its own reasoning (2026-08-10, user request).
  mountEl.querySelectorAll("[data-space-health-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const space = byId(state.spaces, row.dataset.spaceHealthId);
      if (!space) return;
      openSpaceHealthSheet(space, computeSpaceHealth(getState(), space.id));
    });
  });

  mountEl.querySelectorAll("[data-habits-person-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.habitsPersonFilter;
      habitsPersonFilter = habitsPersonFilter === id ? null : id;
      render();
    });
  });

  mountEl.querySelectorAll("[data-disable-routine]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleRoutineActive(btn.dataset.disableRoutine);
      showToast("Routine turned off");
    });
  });
  mountEl.querySelectorAll("[data-lengthen-routine]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const routine = byId(state.routines, btn.dataset.lengthenRoutine);
      if (!routine) return;
      const current = Number(btn.dataset.currentInterval) || routine.trigger.intervalDays;
      const longer = Math.round(current * 1.5);
      updateRoutine(routine.id, { trigger: { ...routine.trigger, intervalDays: longer } });
      showToast(`Interval lengthened to every ${longer} days`);
    });
  });
  mountEl.querySelectorAll("[data-lower-routine]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const routine = byId(state.routines, btn.dataset.lowerRoutine);
      if (!routine) return;
      const order = ["unsafe", "damaging", "unhygienic", "cosmetic"];
      const idx = order.indexOf(routine.consequence);
      const alreadyLowest = idx === -1 || idx >= order.length - 1;
      if (alreadyLowest) {
        showToast("Already at the lowest tier");
        return;
      }
      updateRoutine(routine.id, { consequence: order[idx + 1] });
      showToast("Priority lowered");
    });
  });
}

function render() {
  const state = getState();
  mountEl.innerHTML = `
    <div class="topbar"><h1>Insights</h1></div>
    ${healthCardHtml(state)}
    ${roomHealthSectionHtml(state)}
    ${smoothingNoticeHtml(state)}
    ${snoozeSuggestionsHtml(state)}
    ${loadBalanceHtml(state)}
    ${forecastHtml(state)}
    ${/* Seasonal section hidden (2026-08-10, direct user request: "hide
       this section for now") — logic (intel.js's seasonalBoosts) and
       rendering (seasonalHtml below) both left intact, just not called
       here, so re-enabling later is a one-line change. */ ""}
    ${helpLeaveSectionHtml(state)}
    ${habitsSectionHtml(state)}
    ${assetValueSectionHtml(state)}
    <div class="today-section">
      <p style="color:var(--ink-faint);font-size:var(--fs-micro);">Photo sweep, bill scan, and the weekly AI digest need a Cloud Function proxy (memo §5.10's own no-client-side-LLM rule) — those land with Phase 4/6's Firebase pass, not before.</p>
    </div>
  `;
  wireEvents(state);
}

function mount(el) {
  mountEl = el;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount };
