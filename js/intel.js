// Phase 5 — intelligent logic (build memo §5.4-§5.9). Deterministic, no
// LLM (§5.10's hard boundary — this file is exactly the kind of hot-path
// logic that must never call one). Pure functions that read `state` and
// return computed insights; the few that represent an actual scheduling
// decision (load smoothing) mutate the occurrence objects they're handed,
// same pattern engine.js/state.js already use for occurrence generation.
//
// Explicitly NOT built here, per direct user instruction (2026-08-05):
// §5.2 burn-rate learning and §5.3 adaptive intervals. Every other §5
// sub-section is covered.

import { stateOf } from "./engine.js";

// Deliberately NOT importing byId from state.js — this file is imported BY
// state.js (regenerate() calls applyLoadSmoothing), and native, unbundled
// ES module circular imports are fragile enough in-browser to avoid rather
// than rely on live-binding hoisting working out. A one-line duplicate is
// the safer trade. engine.js is a safe import (a leaf module, doesn't
// import state.js or intel.js), so stateOf is imported normally.
function byId(list, id) {
  return list.find((x) => x.id === id);
}

// ---- shared helpers --------------------------------------------------------

const CONSEQUENCE_WEIGHT = { cosmetic: 1, degrading: 2, damaging: 3, safety: 4 };

function effortPoints(routine) {
  return (routine.effort || 1) * (CONSEQUENCE_WEIGHT[routine.consequence] || 1);
}

function dateOnly(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Monday-start week key (YYYY-MM-DD of that week's Monday) — same
// convention state.js's habit code already uses for "this week" counts.
function weekKey(dateLike) {
  const d = dateOnly(dateLike);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

function addDays(dateLike, days) {
  return new Date(new Date(dateLike).getTime() + days * 86400000);
}

// ---- §5.4 Snooze learning ---------------------------------------------------
// The richest signal in the app (memo's own words). Three rules:
// - snoozed 3x in a row on the same occurrence → offer to lengthen the
//   interval (floating routines only) or lower its consequence tier.
// - snoozed 5x+ and never completed at all (no ledger history ever) →
//   offer to disable it outright. Bad suggestions must be able to die.
// - snoozed mostly on one day-of-week class (weekday/weekend) but
//   completed mostly on the other → a day-of-week preference, surfaced as
//   information (not auto-applied — rescheduling a routine's actual
//   trigger day is a bigger structural change than this signal alone
//   should force through).
function isWeekday(dow) {
  return dow >= 1 && dow <= 5;
}

function snoozeSuggestions(state) {
  const suggestions = [];
  const everCompleted = new Set(state.ledger.map((l) => l.routineId));

  for (const occ of state.occurrences) {
    if (occ.state === "done") continue;
    const count = occ.snoozeCount || 0;
    if (count < 3) continue;
    const routine = byId(state.routines, occ.routineId);
    if (!routine || !routine.active) continue;

    if (count >= 5 && !everCompleted.has(routine.id)) {
      suggestions.push({
        type: "disable",
        routineId: routine.id,
        occId: occ.id,
        title: routine.title,
        detail: `Snoozed ${count} times and never completed. Offer to turn it off — a bad suggestion should be able to die.`,
      });
      continue; // the disable offer supersedes the lengthen/lower offer for this one
    }

    const canLengthen = routine.trigger?.type === "floating_since_last";
    suggestions.push({
      type: "ease",
      routineId: routine.id,
      occId: occ.id,
      title: routine.title,
      canLengthen,
      currentIntervalDays: canLengthen ? routine.trigger.intervalDays : null,
      detail: `Snoozed ${count} times in a row.${canLengthen ? " Lengthen the interval, or" : " O"}r lower how much it matters.`,
    });
  }

  // Day-of-week preference — needs both snooze-event history (state.snoozeLog)
  // and completion history (state.ledger) for the same routine to compare.
  const byRoutine = {};
  for (const s of state.snoozeLog || []) (byRoutine[s.routineId] ||= { snoozes: [], completions: [] }).snoozes.push(s.dow);
  for (const l of state.ledger) {
    if (!byRoutine[l.routineId]) continue; // only care about routines that also have snooze history
    byRoutine[l.routineId].completions.push(new Date(l.doneAt).getDay());
  }
  for (const [routineId, hist] of Object.entries(byRoutine)) {
    if (hist.snoozes.length < 3 || hist.completions.length < 2) continue;
    const routine = byId(state.routines, routineId);
    if (!routine) continue;
    const snoozeWeekdayShare = hist.snoozes.filter(isWeekday).length / hist.snoozes.length;
    const doneWeekdayShare = hist.completions.filter(isWeekday).length / hist.completions.length;
    // Snoozed mostly on one class, done mostly on the other — a real
    // opposite-ends pattern, not noise.
    if (snoozeWeekdayShare >= 0.7 && doneWeekdayShare <= 0.3) {
      suggestions.push({ type: "day-preference", routineId: routine.id, title: routine.title, detail: `Usually snoozed on weekdays but actually done on weekends — consider scheduling it there.` });
    } else if (snoozeWeekdayShare <= 0.3 && doneWeekdayShare >= 0.7) {
      suggestions.push({ type: "day-preference", routineId: routine.id, title: routine.title, detail: `Usually snoozed on weekends but actually done on weekdays — consider scheduling it there.` });
    }
  }

  return suggestions;
}

// ---- §5.5 Load balancing ---------------------------------------------------
// Rolling 30-day effort-point split across household MEMBERS only (not paid
// help — help doing more of the physical work is the point of having help,
// not an imbalance to flag). Pull-only insight, phrased about the house,
// never about a person specifically underperforming (memo's own framing).
function loadBalance(state) {
  const members = state.people.filter((p) => p.kind === "member");
  if (members.length < 2) return null;

  const cutoff = Date.now() - 30 * 86400000;
  const points = {};
  for (const entry of state.ledger) {
    if (!entry.doneBy) continue;
    if (new Date(entry.doneAt).getTime() < cutoff) continue;
    if (!members.some((m) => m.id === entry.doneBy)) continue;
    const routine = byId(state.routines, entry.routineId);
    if (!routine) continue;
    points[entry.doneBy] = (points[entry.doneBy] || 0) + effortPoints(routine);
  }

  const totals = members.map((p) => ({ person: p, points: points[p.id] || 0 }));
  const grandTotal = totals.reduce((s, t) => s + t.points, 0);
  if (grandTotal === 0) return null;

  const evenShare = 1 / members.length;
  const leaning = totals.reduce((a, b) => (b.points > a.points ? b : a));
  const share = leaning.points / grandTotal;
  if (share - evenShare <= 0.2) return null; // within the memo's ±20% band

  return { leaning: leaning.person, sharePct: Math.round(share * 100), totals, windowDays: 30 };
}

// ---- §5.6 Batching ----------------------------------------------------------
// Same-space and same-vendor clustering for Today's due/overdue list.
// Same-effort-tier batching already exists as Today's "10 free minutes?"
// filter; same-trip shopping batching already exists as Stock's "Build
// shopping list" — both predate this file and aren't duplicated here.
const EFFORT_MINUTES = { 1: 2, 2: 15, 3: 60, 4: 240 }; // effort 5 (vendor) has no "your time" minutes

function spaceBatches(rows) {
  const bySpace = {};
  for (const row of rows) {
    if (!row.space || row.type !== "routine" || row.routine?.ownerClass === "vendor") continue;
    (bySpace[row.space.id] ||= { space: row.space, rows: [] }).rows.push(row);
  }
  return Object.values(bySpace)
    .filter((b) => b.rows.length >= 2)
    .map((b) => ({
      spaceId: b.space.id,
      spaceName: b.space.name,
      spaceIcon: b.space.icon,
      count: b.rows.length,
      minutes: b.rows.reduce((sum, r) => sum + (EFFORT_MINUTES[r.effort] || 0), 0),
      titles: b.rows.map((r) => r.title),
    }));
}

function vendorBatches(state, rows) {
  const byVendor = {};
  for (const row of rows) {
    if (row.type !== "routine" || row.routine?.ownerClass !== "vendor" || !row.routine?.assetId) continue;
    const asset = byId(state.assets, row.routine.assetId);
    if (!asset?.vendorName) continue;
    (byVendor[asset.vendorName] ||= { vendorName: asset.vendorName, rows: [] }).rows.push(row);
  }
  return Object.values(byVendor)
    .filter((b) => b.rows.length >= 2)
    .map((b) => ({ vendorName: b.vendorName, count: b.rows.length, titles: b.rows.map((r) => r.title) }));
}

function batches(state, rows) {
  return { spaces: spaceBatches(rows), vendors: vendorBatches(state, rows) };
}

// ---- §5.7 Load smoothing ---------------------------------------------------
// If a week's total effort exceeds a ceiling, shift flexible occurrences
// (cosmetic|degrading consequence, floating_since_last trigger only) +7
// days into the following week. Never touches damaging/safety or
// fixed-calendar/seasonal/etc. Mutates the occurrence objects it's given
// directly (same "pass the real state, mutate in place" pattern
// engine.js's caller in state.js already uses) and returns the list of
// moves so the caller can show what happened.
//
// Forward-only, and overdue occurrences are excluded from consideration
// entirely (2026-08-05 bug fix — found live: "its moving the routines to
// past... i have the routines still on today"). The original version
// picked whichever adjacent week — before OR after — had more headroom,
// which could and did shift an occurrence's due date INTO A WEEK THAT HAD
// ALREADY PASSED, making it instantly overdue instead of relieving
// anything. It also never excluded already-overdue occurrences from being
// "smoothed" in the first place, which doesn't make sense either — an
// overdue item needs doing, not deferring further. Both fixed: only
// pending/due occurrences (checked via the engine's own stateOf, not the
// stored `occ.state`, which is rarely kept in sync with due/overdue — see
// engine.js's own comment on that) are eligible, and a chosen candidate
// only ever moves +7 days into the future.
const DEFAULT_EFFORT_CEILING = 20;

function applyLoadSmoothing(state, ceiling = DEFAULT_EFFORT_CEILING) {
  const moves = [];
  const now = new Date();
  const openOccs = state.occurrences.filter((o) => {
    if (o.state === "done" || o.state === "snoozed") return false;
    return stateOf({ dueAt: o.dueAt, windowDays: o.windowDays }, now) !== "overdue";
  });

  const loadByWeek = {};
  const occsByWeek = {};
  for (const occ of openOccs) {
    const routine = byId(state.routines, occ.routineId);
    if (!routine) continue;
    const wk = weekKey(occ.dueAt);
    const pts = effortPoints(routine);
    loadByWeek[wk] = (loadByWeek[wk] || 0) + pts;
    (occsByWeek[wk] ||= []).push({ occ, routine, pts });
  }

  for (const wk of Object.keys(loadByWeek)) {
    let excess = loadByWeek[wk] - ceiling;
    if (excess <= 0) continue;

    const candidates = (occsByWeek[wk] || [])
      .filter(
        ({ occ, routine }) =>
          !occ.smoothed &&
          routine.trigger?.type === "floating_since_last" &&
          (routine.consequence === "cosmetic" || routine.consequence === "degrading"),
      )
      .sort((a, b) => b.pts - a.pts); // move the biggest contributors first — fewer moves needed to clear the ceiling

    for (const { occ, routine, pts } of candidates) {
      if (excess <= 0) break;
      const targetKey = weekKey(addDays(wk, 7));

      const fromDueAt = occ.dueAt;
      occ.dueAt = addDays(occ.dueAt, 7).toISOString();
      occ.smoothed = true;
      loadByWeek[wk] -= pts;
      loadByWeek[targetKey] = (loadByWeek[targetKey] || 0) + pts;
      excess -= pts;

      moves.push({ routineId: routine.id, title: routine.title, from: fromDueAt, to: occ.dueAt, weekFrom: wk, weekTo: targetKey });
    }
  }

  return moves;
}

// ---- §5.8 Seasonal intelligence --------------------------------------------
// City → season map. Only Bengaluru is populated with the memo's own real
// data (§5.8) — other cities simply don't get a seasonal boost card yet,
// rather than guessing at a season map for a city the memo never specified.
const CITY_SEASONS = {
  Bengaluru: [
    { key: "pre_monsoon", label: "Pre-monsoon", months: [5, 6], keywords: ["drain", "waterproof", "seepage", "mosquito", "balcony", "terrace", "umbrella", "raincoat"] },
    { key: "monsoon", label: "Monsoon", months: [6, 10], keywords: ["drain", "seepage", "damp", "mosquito"] },
    { key: "dry", label: "Dry season", months: [12, 2], keywords: ["dust", "filter", "ac"] },
    { key: "pre_summer", label: "Pre-summer service window", months: [2, 3], keywords: ["ac", "cooler", "fan"] },
  ],
};

function inWindow(months, now, leadDays = 14) {
  const [startMonth, endMonth] = months;
  const year = now.getFullYear();
  const start = new Date(year, startMonth - 1, 1);
  const startWithLead = new Date(start.getTime() - leadDays * 86400000);
  const end = endMonth >= startMonth ? new Date(year, endMonth, 0) : new Date(year + 1, endMonth, 0);
  return now >= startWithLead && now <= end;
}

function seasonalBoosts(state) {
  const seasons = CITY_SEASONS[state.household.city];
  if (!seasons) return [];
  const now = new Date();
  const boosts = [];
  for (const season of seasons) {
    if (!inWindow(season.months, now)) continue;
    const matches = [];
    for (const occ of state.occurrences) {
      if (occ.state === "done" || occ.state === "snoozed") continue;
      const routine = byId(state.routines, occ.routineId);
      if (!routine) continue;
      const title = routine.title.toLowerCase();
      if (season.keywords.some((kw) => title.includes(kw))) matches.push(routine.title);
    }
    if (matches.length) boosts.push({ season: season.label, key: season.key, titles: [...new Set(matches)] });
  }
  return boosts;
}

// ---- §5.9 Correlation and forecasting --------------------------------------

// Failure prediction: an asset past 80% of its expected life. "Rising
// service frequency" (the memo's second condition) only factors in when
// there's real service history to measure a trend from — with fewer than
// 3 recorded services there's nothing to call "rising," so the copy stays
// honestly age-only rather than claiming a trend that isn't there.
function failurePredictions(state) {
  const now = new Date();
  const predictions = [];
  for (const asset of state.assets) {
    if (!asset.expectedLifeYears || !asset.purchaseDate) continue;
    const ageYears = (now - new Date(asset.purchaseDate)) / (365.25 * 86400000);
    if (ageYears < asset.expectedLifeYears * 0.8) continue;

    const history = asset.serviceHistory || [];
    let risingFrequency = false;
    if (history.length >= 3) {
      const sorted = [...history].sort();
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) gaps.push((new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000);
      const recentGap = gaps[gaps.length - 1];
      const priorAvg = gaps.slice(0, -1).reduce((a, b) => a + b, 0) / (gaps.length - 1);
      risingFrequency = recentGap < priorAvg * 0.75;
    }

    predictions.push({
      assetId: asset.id,
      name: asset.name,
      ageYears: Math.round(ageYears * 10) / 10,
      expectedLifeYears: asset.expectedLifeYears,
      risingFrequency,
      detail: risingFrequency
        ? `${Math.round(ageYears)} years old (expected life ${asset.expectedLifeYears}) and needing service more often lately. Budget for replacement.`
        : `${Math.round(ageYears)} years old, past ${Math.round((asset.expectedLifeYears * 0.8))} years (80% of its expected ${asset.expectedLifeYears}-year life). Worth budgeting for replacement.`,
    });
  }
  return predictions;
}

// Consumable coupling: completing a water-treatment asset's service routine
// recently means its linked filter/cartridge item may need replacing sooner
// than its own calendar projection says — surfaced as information (not an
// automatic qty/date mutation, which would overstate precision this app
// doesn't actually have).
function consumableCoupling(state) {
  const now = new Date();
  const coupled = [];
  for (const asset of state.assets) {
    if (asset.category !== "water_treatment") continue;
    const recentService = asset.lastServicedAt && (now - new Date(asset.lastServicedAt)) / 86400000 <= 14;
    if (!recentService) continue;
    const relatedItems = state.items.filter(
      (i) => i.spaceId === asset.spaceId && (i.category === "filters" || i.category === "utility") && i.catalogKey !== "ITM-LPG-CYLINDER",
    );
    if (!relatedItems.length) continue;
    coupled.push({ assetId: asset.id, assetName: asset.name, items: relatedItems.map((i) => i.name) });
  }
  return coupled;
}

// Neglect clustering: a space where most of its own open occurrences are
// overdue isn't a nagging opportunity — it's a sign those routines might
// not apply anymore ("we stopped using that room," the memo's own example).
function neglectClusters(state) {
  const bySpace = {};
  for (const occ of state.occurrences) {
    if (occ.state === "done" || occ.state === "snoozed") continue;
    const routine = byId(state.routines, occ.routineId);
    if (!routine?.spaceId) continue;
    (bySpace[routine.spaceId] ||= { total: 0, overdue: 0 }).total += 1;
    if (occ.state === "overdue") bySpace[routine.spaceId].overdue += 1;
  }
  const clusters = [];
  for (const [spaceId, counts] of Object.entries(bySpace)) {
    if (counts.total < 2) continue; // one lonely overdue item isn't a "cluster"
    const rate = counts.overdue / counts.total;
    if (rate < 0.6) continue;
    const space = byId(state.spaces, spaceId);
    if (!space) continue;
    clusters.push({ spaceId, spaceName: space.name, overdueCount: counts.overdue, totalCount: counts.total });
  }
  return clusters;
}

export {
  effortPoints,
  snoozeSuggestions,
  loadBalance,
  batches,
  applyLoadSmoothing,
  DEFAULT_EFFORT_CEILING,
  seasonalBoosts,
  failurePredictions,
  consumableCoupling,
  neglectClusters,
};
