// The trigger engine — the heart of Kasa (build memo §5.1). Deterministic,
// no LLM, pure functions. Runs client-side on app open and (once notify.js
// exists) on a 6-hour background tick. Never generate more than `horizon`
// ahead — the list becomes noise and Firestore reads become expensive.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 3;
const DEFAULT_HORIZON_DAYS = 60;

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysBetween(a, b) {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

// "Always on Saturday" toggle (2026-08-10, user request: "even though i
// give the repeat every days, when this toggle is on it automatically
// chooses the following saturday") — snaps a computed floating_since_last
// due date forward to the nearest Saturday on/after it. Never moves an
// already-Saturday date, and never goes backward — whatever the interval
// computes lands on the Saturday of that same window, not a full week
// later. Distinct from nextSaturdayDateStr() (used for a brand-new
// routine's default start date, which deliberately always jumps a full
// week even if today IS Saturday) — this snaps an already-computed date
// forward by at most 6 days, since the interval itself is what's driving
// roughly when it's next due.
function snapToSaturday(date) {
  const d = new Date(date);
  const daysUntilSat = (6 - d.getDay() + 7) % 7;
  if (daysUntilSat > 0) d.setDate(d.getDate() + daysUntilSat);
  return d;
}

// ---- fixed_calendar: minimal RRULE subset -----------------------------
// Supports FREQ=MONTHLY;BYMONTHDAY=N and FREQ=WEEKLY;BYDAY=XX[,XX...] (one
// or more comma-separated days, standard RRULE syntax — 2026-08-07, user
// request: "multiple weekdays could be selected and the routine can occur
// accordingly"). Enough for pack content (society dues, weekly resets);
// extend as real packs need richer recurrence.

const WEEKDAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(rrule) {
  const parts = Object.fromEntries(
    rrule.split(";").map((p) => p.split("=")),
  );
  return parts;
}

// Strictly forward from a genuine ledger completion — used only when
// `lastDoneAt` is real (the routine has actually been done before). This
// one's correctly forward-only and always has been: `after` is a real
// timestamp that only ever moves forward as completions happen, so there's
// no session-reload staleness to worry about here, unlike the
// never-completed case below.
function nextRRuleOccurrence(rrule, after) {
  const p = parseRRule(rrule);
  const start = new Date(after.getFullYear(), after.getMonth(), after.getDate());

  if (p.FREQ === "MONTHLY" && p.BYMONTHDAY) {
    const dom = Number(p.BYMONTHDAY);
    let candidate = new Date(start.getFullYear(), start.getMonth(), dom);
    if (candidate <= start) {
      candidate = new Date(start.getFullYear(), start.getMonth() + 1, dom);
    }
    return candidate;
  }

  if (p.FREQ === "WEEKLY" && p.BYDAY) {
    // One or more days — the nearest upcoming match among whichever were
    // selected wins (e.g. "MO,TH" due next on whichever of Monday/
    // Thursday comes first after `start`).
    const targetDows = p.BYDAY.split(",").map((d) => WEEKDAY_INDEX[d]).filter((d) => d !== undefined);
    if (!targetDows.length) return null;
    let candidate = new Date(start);
    for (let i = 0; i < 7; i++) {
      candidate = addDays(candidate, 1);
      if (targetDows.includes(candidate.getDay())) return candidate;
    }
    return null;
  }

  return null;
}

// For a NEVER-completed routine — the same class of bug just fixed in
// firstFloatingOccurrence, found by auditing every trigger type after that
// fix (2026-08-10, user request: "check for all repeats options"). The old
// code faked `after = now - 1 day` and reused nextRRuleOccurrence's
// strictly-forward search — for a MONTHLY/WEEKLY day that had already
// passed this cycle, that always jumped to the NEXT cycle (next month /
// next week), silently discarding the missed occurrence on every session
// reload, exactly like the floating_since_last bug. Fix: compute THIS
// cycle's occurrence directly (this month's BYMONTHDAY, or the most recent
// matching weekday within the last 7 days) and let it be in the past —
// that's what makes it overdue. Only walks forward past it when the
// result would predate the routine's own start date (it can't have missed
// an occurrence that happened before it existed) — mirrors
// firstFloatingOccurrence's own start-date floor.
function currentRRuleOccurrence(rrule, startDateStr, now) {
  const p = parseRRule(rrule);
  const today = dateOnly(now);
  const start = startDateStr ? dateOnly(new Date(startDateStr)) : null;

  if (p.FREQ === "MONTHLY" && p.BYMONTHDAY) {
    const dom = Number(p.BYMONTHDAY);
    let candidate = new Date(today.getFullYear(), today.getMonth(), dom);
    if (start && candidate < start) {
      candidate = new Date(start.getFullYear(), start.getMonth(), dom);
      if (candidate < start) candidate = new Date(start.getFullYear(), start.getMonth() + 1, dom);
    }
    return candidate;
  }

  if (p.FREQ === "WEEKLY" && p.BYDAY) {
    const targetDows = p.BYDAY.split(",").map((d) => WEEKDAY_INDEX[d]).filter((d) => d !== undefined);
    if (!targetDows.length) return null;
    let candidate = null;
    for (let i = 0; i < 7; i++) {
      const c = addDays(today, -i);
      if (targetDows.includes(c.getDay())) { candidate = c; break; }
    }
    if (start && candidate && candidate < start) {
      for (let i = 0; i < 7; i++) {
        const c = addDays(start, i);
        if (targetDows.includes(c.getDay())) { candidate = c; break; }
      }
    }
    return candidate;
  }

  return null;
}

// ---- seasonal: city-agnostic month window (memo §5.8 city map is a later
// pack-content concern; this just fires at window start for given months) --

function nextSeasonalWindow(months, now) {
  const [startMonth, endMonth] = months;
  const year = now.getFullYear();
  const candidateThisYear = new Date(year, startMonth - 1, 1);
  const stillInOrBeforeWindow = now.getMonth() + 1 <= endMonth;
  return stillInOrBeforeWindow
    ? candidateThisYear
    : new Date(year + 1, startMonth - 1, 1);
}

// ---- start date (2026-08-08, user request: "make the start date
// mandatory for all routines and repeat types... if in the past, the next
// occurrence should be based on the repeat selected. If in the future, the
// first occurrence should be then.") ---------------------------------------
//
// A start date in the future always wins outright, for every trigger type:
// the first occurrence is exactly that date. A start date in the past (or
// today) is handled per trigger type below — every type except
// floating_since_last already computes "the next occurrence from today" on
// its own when there's no completion history, which already IS "based on
// the repeat selected" for a calendar/velocity/season-anchored trigger, so
// no extra branching is needed for those. floating_since_last is the one
// exception: its interval is anchored to a point in time (normally the last
// completion), so a past start date has to walk the interval forward from
// that anchor to land on the correct point in the cycle — see
// firstFloatingOccurrence. Missing `startDate` (legacy routines created
// before this field existed) falls through to each type's original
// behavior, unchanged.
// Compared at day granularity, not exact timestamp (2026-08-10, real bug
// found live: a routine with startDate = today was skipping straight to
// its NEXT occurrence instead of occurring today first). `start` parses a
// date-only string to local midnight, so on the very day it's set, `start`
// is always a few hours behind `now` — an exact-timestamp comparison read
// that as "already past," walked the interval forward once, and skipped
// today entirely. Comparing calendar dates instead (same dateOnly()
// convention stateOf()/overdueDays already use, see their own comments)
// means "today" correctly counts as the start, not the past.
//
// Walks to the MOST RECENTLY PASSED grid point (start, start+interval,
// start+2*interval, ...), not the next future one (2026-08-10, real bug
// found live: a routine created yesterday with a 2-day interval, never
// completed, correctly showed as due/overdue that same session — but on
// the very next app reload it read as "due tomorrow" instead of overdue).
// Root cause: occurrences aren't persisted (state.js's hydrateState()
// wipes and rebuilds them every session) — so this function reruns from
// scratch on every reload with a later `now` than before, and the OLD
// walk-forward-to-first-point->=now logic can, by construction, never
// return a date before `now` — a routine that's fallen behind its
// schedule was silently pushed to the next FUTURE grid point every single
// reload, never once surfacing as overdue. Walking to the last point
// <= now instead means a missed occurrence stays exactly where it was
// (still overdue, by however many days) no matter how many times it gets
// regenerated — while still capping how "wildly overdue" a long-neglected
// routine can ever look, since the result is never more than one interval
// older than `now` (this was the actual point of the walk in the first
// place — see Round 23's own worked example: a start date 25 days back
// with a 10-day interval should read as a few days overdue, not 25).
function firstFloatingOccurrence(startDateStr, intervalDays, now) {
  if (!startDateStr) return now;
  const start = new Date(startDateStr);
  if (dateOnly(start) >= dateOnly(now)) return start;
  let candidate = start;
  while (dateOnly(addDays(candidate, intervalDays)) <= dateOnly(now)) {
    candidate = addDays(candidate, intervalDays);
  }
  return candidate;
}

// ---- per-trigger-type computeNext --------------------------------------

function computeNext(routine, ctx) {
  const { now, lastDoneAt, assetsById, itemsById, activeModeKeys } = ctx;
  const t = routine.trigger;

  if (!lastDoneAt && t.startDate && t.type !== "floating_since_last") {
    const start = new Date(t.startDate);
    if (start > now) return { dueAt: start, windowDays: DEFAULT_WINDOW_DAYS };
  }

  switch (t.type) {
    case "fixed_calendar": {
      // Genuinely completed before -> strictly the next occurrence after
      // that. Never completed -> this cycle's occurrence, which may
      // already be in the past (overdue) — see currentRRuleOccurrence's
      // own comment for why these can't share one code path.
      const dueAt = lastDoneAt
        ? nextRRuleOccurrence(t.rrule, lastDoneAt)
        : currentRRuleOccurrence(t.rrule, t.startDate, now);
      return dueAt ? { dueAt, windowDays: DEFAULT_WINDOW_DAYS } : null;
    }

    case "floating_since_last": {
      let dueAt = lastDoneAt ? addDays(lastDoneAt, t.intervalDays) : firstFloatingOccurrence(t.startDate, t.intervalDays, now);
      if (t.snapToSaturday) dueAt = snapToSaturday(dueAt);
      return { dueAt, windowDays: DEFAULT_WINDOW_DAYS };
    }

    case "usage_meter": {
      const asset = routine.assetId ? assetsById[routine.assetId] : null;
      if (!asset || !asset.meter) return null;
      const consumed = asset.meter.value - (asset.lastServiceMeterValue ?? 0);
      if (consumed >= t.meterDelta) {
        return { dueAt: now, windowDays: DEFAULT_WINDOW_DAYS };
      }
      // Estimate a future date from observed velocity (units/day since last service).
      if (!asset.lastServicedAt) return null;
      const lastServiced = new Date(asset.lastServicedAt);
      const elapsedDays = daysBetween(lastServiced, now);
      if (elapsedDays <= 0) return null;
      const velocity = consumed / elapsedDays;
      if (velocity <= 0) return null;
      const remaining = t.meterDelta - consumed;
      const daysOut = remaining / velocity;
      return { dueAt: addDays(now, daysOut), windowDays: DEFAULT_WINDOW_DAYS };
    }

    case "condition": {
      const c = t.condition;
      if (c.source === "item") {
        const item = itemsById[c.itemId];
        if (!item) return null;
        const matches = c.op === "eq" ? item.status === c.value : false;
        if (!matches) return null;
        // Cooldown (memo §5.1: "if true and cooldown elapsed, due now") —
        // without it, completing the occurrence while the underlying
        // condition is still true (e.g. stock hasn't actually arrived yet)
        // would regenerate it on the very next engine tick.
        const cooldownDays = c.cooldownDays ?? 1;
        if (lastDoneAt && daysBetween(lastDoneAt, now) < cooldownDays) return null;
        return { dueAt: now, windowDays: 0 };
      }
      return null;
    }

    case "seasonal": {
      const dueAt = nextSeasonalWindow(t.months, now);
      return { dueAt, windowDays: DEFAULT_WINDOW_DAYS };
    }

    case "on_mode": {
      return activeModeKeys.has(t.mode)
        ? { dueAt: now, windowDays: 0 }
        : null;
    }

    default:
      return null;
  }
}

// ---- state derivation (memo §5.1) ----------------------------------------
// Compared at day granularity, not exact timestamps — an occurrence is
// "due" for the whole calendar day, not just up to the millisecond it was
// generated (condition/on_mode triggers set dueAt = the generation instant,
// which would otherwise flicker into "overdue by 0 days" a moment later).

function dateOnly(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function stateOf(occurrence, now) {
  const dueDate = dateOnly(occurrence.dueAt);
  const windowStart = addDays(dueDate, -occurrence.windowDays);
  const nowDate = dateOnly(now);
  if (nowDate < windowStart) return "pending";
  if (nowDate <= dueDate) return "due";
  return "overdue";
}

function overdueDays(occurrence, now) {
  return Math.max(0, Math.round(daysBetween(dateOnly(occurrence.dueAt), dateOnly(now))));
}

// ---- generation ----------------------------------------------------------
// Builds a lookup of most-recent ledger completion per routine, then calls
// computeNext per active, unpaused routine. Skips routines that already
// have an open occurrence (memo: "no open occurrence exists").

function lastDoneByRoutine(ledger) {
  const map = {};
  for (const entry of ledger) {
    const prev = map[entry.routineId];
    if (!prev || new Date(entry.doneAt) > new Date(prev)) {
      map[entry.routineId] = entry.doneAt;
    }
  }
  return map;
}

function isPaused(routine, activeModeKeys) {
  return routine.modeFilters?.pauseIn?.some((m) => activeModeKeys.has(m));
}

let occSeq = 0;
function nextOccId() {
  occSeq += 1;
  return `occ_gen_${occSeq}`;
}

function generateOccurrences({
  routines,
  ledger,
  assets,
  items,
  activeModeKeys,
  existingOpenRoutineIds,
  now = new Date(),
  horizonDays = DEFAULT_HORIZON_DAYS,
}) {
  const horizon = addDays(now, horizonDays);
  const lastDone = lastDoneByRoutine(ledger);
  const assetsById = Object.fromEntries(assets.map((a) => [a.id, a]));
  const itemsById = Object.fromEntries(items.map((i) => [i.id, i]));
  const modeKeys = new Set(activeModeKeys);

  const created = [];

  for (const routine of routines) {
    if (!routine.active) continue;
    if (isPaused(routine, modeKeys)) continue;
    if (existingOpenRoutineIds.has(routine.id)) continue;

    const lastDoneAt = lastDone[routine.id] ? new Date(lastDone[routine.id]) : null;
    const result = computeNext(routine, {
      now,
      lastDoneAt,
      assetsById,
      itemsById,
      activeModeKeys: modeKeys,
    });

    if (!result || result.dueAt > horizon) continue;

    created.push({
      id: nextOccId(),
      routineId: routine.id,
      dueAt: result.dueAt.toISOString(),
      windowDays: result.windowDays,
      state: "pending",
      assigneeId: routine.defaultAssigneeId,
      doneBy: null,
      doneAt: null,
      snoozeCount: 0,
      snoozedUntil: null,
      effortActual: null,
      generatedAt: now.toISOString(),
    });
  }

  return created;
}

export { generateOccurrences, computeNext, stateOf, overdueDays, DEFAULT_HORIZON_DAYS };
