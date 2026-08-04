// 72-day habit square grid (2026-08-04, user request: "habit i want to be
// tracked across the last 72 days as small squares similar to the habit
// app in insight"). Read-only — a reading-order grid (oldest day top-left,
// today bottom-right), not GitHub's week-column layout, which needs
// weekday-alignment padding that isn't worth the complexity for what's
// asked here: 72 small squares you can scan at a glance.

import { isHabitDoneOn, isHabitScheduledOn } from "../state.js";

// Takes the full habit object now, not just its id (2026-08-05, user
// request: "cant have blank days cos it was never planned") — a day the
// habit's own frequency never scheduled (a weekend for a weekdays-only
// habit, an off-cycle day for an every-N-days habit, or any day before the
// habit even existed) renders as a distinct neutral "not scheduled" cell
// instead of looking like a missed one. weekly_count habits have no
// specific scheduled days by design (matches isHabitScheduledOn's own
// exception), so every day stays in the plain done/not-done binary for them.
function habitGridHtml(habit, { days = 72 } = {}) {
  const cells = [];
  const today = new Date();
  const createdDate = new Date(habit.createdAt);
  createdDate.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const done = isHabitDoneOn(habit.id, dateStr);
    const isToday = i === 0;
    const scheduled = d >= createdDate && isHabitScheduledOn(habit, d);
    const cls = done ? "done" : !scheduled ? "not-scheduled" : "";
    const label = done ? " — done" : !scheduled ? " — not planned" : " — not done";
    cells.push(`<div class="habit-cell${cls ? ` ${cls}` : ""}${isToday ? " today" : ""}" title="${dateStr}${label}"></div>`);
  }
  return `<div class="habit-grid">${cells.join("")}</div>`;
}

export { habitGridHtml };
