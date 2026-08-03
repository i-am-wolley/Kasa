// Habits — personal, not household (2026-08-04, user request: "habit can
// be personal only... within a household there can be household routine
// and individual routine"). A habit belongs to exactly one person, tracked
// as a simple daily done/not-done log (habitLog.js), not the 6-trigger
// engine routines use — habits don't have a "due date" or a room, just a
// streak.

export const habits = [
  { id: "hb_meditate", personId: "u_vinod", title: "Meditate", createdAt: "2026-06-01T00:00:00.000Z" },
  { id: "hb_read", personId: "u_vinod", title: "Read 20 minutes", createdAt: "2026-06-01T00:00:00.000Z" },
  { id: "hb_walk", personId: "u_keerthana", title: "Evening walk", createdAt: "2026-06-01T00:00:00.000Z" },
];
