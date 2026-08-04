// Snooze event history (2026-08-05, Phase 5 — snooze learning, §5.4). Each
// entry is one snooze tap: which routine, which day-of-week it happened on.
// Feeds intel.js's day-of-week preference detection alongside the ledger's
// completion dates. Computed relative to "today" (not hardcoded dates), same
// pattern habitLog.js already uses, so the demo pattern holds regardless of
// when this is opened.
//
// `dow` is read off the local Date object before it's stringified — reading
// it back out of the ISO string later would risk an off-by-one from UTC/
// local timezone skew around midnight, a classic JS date trap worth naming
// explicitly so nobody "simplifies" this into re-parsing the string.
function mostRecentWeekday(fromDaysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - fromDaysAgo);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return { date: d.toISOString().slice(0, 10), dow: d.getDay() };
}

// Three separate weekday snoozes on "Mop living room" (rt_mop_living) —
// paired with an extra weekend completion added in ledger.js — demos the
// "snoozed on weekdays, actually done on weekends" pattern without needing
// to live-snooze the same occurrence three times across real days.
const w1 = mostRecentWeekday(2);
const w2 = mostRecentWeekday(9);
const w3 = mostRecentWeekday(16);

export const snoozeLog = [
  { id: "snz_1", routineId: "rt_mop_living", date: w1.date, dow: w1.dow },
  { id: "snz_2", routineId: "rt_mop_living", date: w2.date, dow: w2.dow },
  { id: "snz_3", routineId: "rt_mop_living", date: w3.date, dow: w3.dow },
];
