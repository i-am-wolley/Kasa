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

function seedLog(habitId, keepDay) {
  return last72Dates()
    .filter((_, i) => keepDay(i))
    .map((date, idx) => ({ id: `${habitId}_log_${idx}`, habitId, date }));
}

export const habitLog = [
  ...seedLog("hb_meditate", (i) => i % 3 !== 0), // ~67% of days
  ...seedLog("hb_read", (i) => i % 2 === 0), // ~50% of days
  ...seedLog("hb_walk", (i) => i % 4 !== 3), // ~75% of days
];
