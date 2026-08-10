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

import { getState, subscribe, habitStreak, byId, updateRoutine, toggleRoutineActive, visibleSpaceIds } from "../state.js";
import { stateOf } from "../engine.js";
import { Icon } from "../ui/icons.js";
import { showToast } from "../ui/components.js";
import { habitGridHtml } from "../ui/habitGrid.js";
import { snoozeSuggestions, loadBalance, seasonalBoosts, failurePredictions, consumableCoupling, neglectClusters } from "../intel.js";

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
// Exact same weighting as computeHealth() above, just scoped to one space's
// own routines/items/assets instead of the whole household — "which room
// needs attention" answered directly, rather than only the one aggregate
// number. Ranked worst-first, since that's the actual useful reading order
// (where to look first), not alphabetical.
function computeSpaceHealth(state, spaceId) {
  const activeModeKey = state.household.activeMode;
  const overdueByTier = { unsafe: 0, damaging: 0, unhygienic: 0, cosmetic: 0 };
  for (const occ of state.occurrences) {
    if (occ.state === "done" || occ.state === "snoozed") continue;
    const routine = byId(state.routines, occ.routineId);
    if (!routine || isPausedNow(routine, activeModeKey) || routine.spaceId !== spaceId) continue;
    if (stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, new Date()) !== "overdue") continue;
    overdueByTier[routine.consequence] = (overdueByTier[routine.consequence] || 0) + 1;
  }
  let overduePenalty = 0;
  for (const [tier, count] of Object.entries(overdueByTier)) overduePenalty += (TIER_PENALTY[tier] || 1) * count;
  overduePenalty = Math.min(40, overduePenalty);

  const spaceItems = state.items.filter((i) => i.spaceId === spaceId);
  const outCount = spaceItems.filter((i) => i.status === "out").length;
  const lowCount = spaceItems.filter((i) => i.status === "low").length;
  const stockPenalty = Math.min(30, outCount * 3 + lowCount);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueAssets = state.assets.filter((a) => a.spaceId === spaceId && a.nextServiceDue && new Date(a.nextServiceDue) < today).length;
  const assetPenalty = Math.min(30, overdueAssets * 5);

  const score = Math.max(0, Math.round(100 - overduePenalty - stockPenalty - assetPenalty));
  return { score };
}

function scoreTone(score) {
  if (score >= 90) return "var(--done)";
  if (score >= 70) return "var(--ink-muted)";
  if (score >= 50) return "var(--gold)";
  return "var(--danger)";
}

function roomHealthSectionHtml(state) {
  const visible = visibleSpaceIds(state);
  const spaces = state.spaces.filter((s) => visible.has(s.id));
  if (spaces.length < 2) return ""; // nothing to rank against with one room
  const ranked = spaces
    .map((s) => ({ space: s, score: computeSpaceHealth(state, s.id).score }))
    .sort((a, b) => a.score - b.score);
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Room health</span></div>
      ${ranked
        .map(
          (r) => `
        <div class="list-row" style="cursor:default;">
          <div class="occ-row-icon">${Icon(r.space.icon || "house", { size: 16 })}</div>
          <div class="occ-row-body">
            <div class="occ-row-title">${r.space.name}</div>
            <div class="occ-row-meta">${scoreLabel(r.score)}</div>
          </div>
          <div class="list-row-right font-num" style="color:${scoreTone(r.score)};font-weight:var(--fw-semibold);font-size:16px;">${r.score}</div>
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
    ${seasonalHtml(state)}
    ${helpLeaveSectionHtml(state)}
    ${habitsSectionHtml(state)}
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
