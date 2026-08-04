// Habits — personal, not household (2026-08-04, user request: "habit can
// be personal only... within a household there can be household routine
// and individual routine"). A habit belongs to exactly one person, tracked
// as a simple done/not-done log (habitLog.js), not the 6-trigger engine
// routines use — habits don't have a due date or a room, just a frequency
// and a streak. `frequency` mirrors what routine.js's habit fields collect
// — mixed here on purpose to demo more than the "daily" case.

export const habits = [
  { id: "hb_meditate", personId: "u_vinod", title: "Meditate", frequency: { type: "daily" }, createdAt: "2026-06-01T00:00:00.000Z" },
  { id: "hb_read", personId: "u_vinod", title: "Read 20 minutes", frequency: { type: "daily" }, createdAt: "2026-06-01T00:00:00.000Z" },
  { id: "hb_walk", personId: "u_keerthana", title: "Evening walk", frequency: { type: "weekdays" }, createdAt: "2026-06-01T00:00:00.000Z" },
  { id: "hb_gym", personId: "u_keerthana", title: "Gym session", frequency: { type: "weekly_count", timesPerWeek: 3 }, createdAt: "2026-06-01T00:00:00.000Z" },
];
