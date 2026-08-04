// Tasks — one-off, due-by-a-specific-day items (2026-08-04, user request:
// "a task is not a routine, but needs to be done by a specific day"). No
// recurrence, no trigger engine, no Space requirement — the third category
// alongside household Routines and personal Habits, all built through the
// same shared sheet in routine.js. Dates are relative to "today" so the
// demo always shows one overdue and one due-today example regardless of
// when this is opened.

function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export const tasks = [
  { id: "tsk_passport", title: "Renew Vinod's passport", dueDate: daysFromToday(-2), spaceId: null, assigneeId: "u_vinod", done: false, doneAt: null, createdAt: "2026-07-25T09:00:00.000Z" },
  { id: "tsk_society", title: "Submit society NOC form", dueDate: daysFromToday(0), spaceId: null, assigneeId: null, done: false, doneAt: null, createdAt: "2026-08-01T09:00:00.000Z" },
];
