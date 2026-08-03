// 72-day habit square grid (2026-08-04, user request: "habit i want to be
// tracked across the last 72 days as small squares similar to the habit
// app in insight"). Read-only — a reading-order grid (oldest day top-left,
// today bottom-right), not GitHub's week-column layout, which needs
// weekday-alignment padding that isn't worth the complexity for what's
// asked here: 72 small squares you can scan at a glance.

import { isHabitDoneOn } from "../state.js";

function habitGridHtml(habitId, { days = 72 } = {}) {
  const cells = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const done = isHabitDoneOn(habitId, dateStr);
    const isToday = i === 0;
    cells.push(
      `<div class="habit-cell${done ? " done" : ""}${isToday ? " today" : ""}" title="${dateStr}${done ? " — done" : " — not done"}"></div>`,
    );
  }
  return `<div class="habit-grid">${cells.join("")}</div>`;
}

export { habitGridHtml };
