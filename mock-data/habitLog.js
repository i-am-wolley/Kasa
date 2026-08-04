// Sparse "done" log for the last 72 days, generated relative to whatever
// "today" actually is (not hardcoded dates) so the demo grid in Insights
// always shows a full 72-day history regardless of when this is opened.
// Deterministic patterns, not Math.random() — a mock dataset that reshuffles
// itself on every reload would look like a bug, not a feature.

function last72Dates() {
  const dates = [];
  const today = new Date();
  for (let i = 71; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// keepDaysAgo(n) — n=0 is today, n=71 is 71 days ago. Keeping the "days
// ago" semantics explicit here (rather than a raw array index) avoids the
// off-by-71 mistake it's easy to make otherwise: last72Dates() returns
// oldest-first, so array index 71 — not 0 — is today.
function seedLog(habitId, keepDaysAgo) {
  return last72Dates()
    .map((date, idx) => ({ date, daysAgo: 71 - idx }))
    .filter(({ daysAgo }) => keepDaysAgo(daysAgo))
    .map(({ date }, i) => ({ id: `${habitId}_log_${i}`, habitId, date }));
}

export const habitLog = [
  ...seedLog("hb_meditate", (n) => n % 3 !== 0), // ~67% of days, not done today — shows up due on Today
  ...seedLog("hb_read", (n) => n % 2 === 0), // ~50% of days, done today
  ...seedLog("hb_walk", (n) => n % 4 !== 3), // ~75% of days, done today
  ...seedLog("hb_gym", (n) => n % 3 === 1), // ~3x/week rhythm, not done today — shows up due on Today
];
