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

// ---- fixed_calendar: minimal RRULE subset -----------------------------
// Supports FREQ=MONTHLY;BYMONTHDAY=N and FREQ=WEEKLY;BYDAY=XX (one day).
// Enough for pack content (society dues, weekly resets); extend as real
// packs need richer recurrence.

const WEEKDAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(rrule) {
  const parts = Object.fromEntries(
    rrule.split(";").map((p) => p.split("=")),
  );
  return parts;
}

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
    const targetDow = WEEKDAY_INDEX[p.BYDAY];
    let candidate = new Date(start);
    do {
      candidate = addDays(candidate, 1);
    } while (candidate.getDay() !== targetDow);
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

// ---- per-trigger-type computeNext --------------------------------------

function computeNext(routine, ctx) {
  const { now, lastDoneAt, assetsById, itemsById, activeModeKeys } = ctx;
  const t = routine.trigger;

  switch (t.type) {
    case "fixed_calendar": {
      const after = lastDoneAt || addDays(now, -1);
      const dueAt = nextRRuleOccurrence(t.rrule, after);
      return dueAt ? { dueAt, windowDays: DEFAULT_WINDOW_DAYS } : null;
    }

    case "floating_since_last": {
      const dueAt = lastDoneAt ? addDays(lastDoneAt, t.intervalDays) : now;
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
