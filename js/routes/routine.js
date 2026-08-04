// The custom routine builder — a plain-language sheet, not a form dump
// (memo §4.2). Shared by every screen that creates or edits a routine
// (House space detail today; reused wherever else needs it later).
//
// Also builds Habits and Tasks (2026-08-04, user requests: "let's have a
// toggle between habit and routine in the same add routine/edit modal",
// then "create a new category called task... needs to be done by a
// specific day"). All three stay separate data models underneath (a
// household Routine uses a space + the 6-trigger engine; a personal Habit
// uses a person + a simple frequency; a Task is a one-off with just a due
// date, no recurrence, no required space/person) — but share this one
// entry sheet with a Kind toggle up top switching which field block shows.

import { getState, addRoutine, updateRoutine, deleteRoutine, addHabit, updateHabit, deleteHabit, addTask, updateTask, deleteTask } from "../state.js";
import { openSheet, closeSheet, field, textInput, chipGroup, readChipGroup, wireChipGroup, sheetActions, showToast } from "../ui/components.js";

const KIND_OPTIONS = [
  { value: "routine", label: "Household routine" },
  { value: "habit", label: "Personal habit" },
  { value: "task", label: "Task" },
];

const TRIGGER_TYPES = [
  { value: "floating_since_last", label: "Every N days since last done" },
  { value: "fixed_calendar", label: "On a calendar schedule" },
  { value: "usage_meter", label: "After N uses of an asset" },
  { value: "condition", label: "When stock runs out" },
  { value: "seasonal", label: "Seasonally" },
  { value: "on_mode", label: "When a mode turns on" },
];

const EFFORT_OPTIONS = [
  { value: "1", label: "2 min" },
  { value: "2", label: "15 min" },
  { value: "3", label: "1 hr" },
  { value: "4", label: "Half day" },
  { value: "5", label: "Call vendor" },
];

const CONSEQUENCE_OPTIONS = ["cosmetic", "degrading", "damaging", "safety"];
const OWNER_OPTIONS = ["member", "help", "vendor", "either"];
const WEEKDAYS = [
  { value: "SU", label: "Sun" }, { value: "MO", label: "Mon" }, { value: "TU", label: "Tue" },
  { value: "WE", label: "Wed" }, { value: "TH", label: "Thu" }, { value: "FR", label: "Fri" }, { value: "SA", label: "Sat" },
];

const HABIT_FREQ_TYPES = [
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekends", label: "Weekends" },
  { value: "custom", label: "Custom days" },
  { value: "weekly_count", label: "N times/week" },
  { value: "every_n_days", label: "Every N days" },
];
// JS Date.getDay() numbering (0=Sun..6=Sat), kept as strings since chip
// data-value always round-trips through the DOM as a string.
const HABIT_WEEKDAYS = [
  { value: "1", label: "Mon" }, { value: "2", label: "Tue" }, { value: "3", label: "Wed" },
  { value: "4", label: "Thu" }, { value: "5", label: "Fri" }, { value: "6", label: "Sat" }, { value: "0", label: "Sun" },
];

function triggerParamsHtml(routine) {
  const t = routine?.trigger || {};
  const rr = t.rrule ? Object.fromEntries(t.rrule.split(";").map((p) => p.split("="))) : {};
  const state = getState();

  return `
    <div data-trigger-block="floating_since_last">
      ${field("Repeat every (days)", textInput({ id: "f-intervalDays", type: "number", value: t.intervalDays ?? 30 }))}
    </div>
    <div data-trigger-block="fixed_calendar">
      ${field("Cadence", chipGroup({ name: "rruleFreq", options: ["Monthly", "Weekly"], value: rr.FREQ === "WEEKLY" ? "Weekly" : "Monthly" }))}
      ${field("Day of month", textInput({ id: "f-bymonthday", type: "number", value: rr.BYMONTHDAY ?? 1 }))}
      ${field("Day of week", chipGroup({ name: "byday", options: WEEKDAYS, value: rr.BYDAY || "SU" }))}
    </div>
    <div data-trigger-block="usage_meter">
      ${field("Linked asset", chipGroup({ name: "assetId", options: state.assets.map((a) => ({ value: a.id, label: a.name })), value: t.assetId ?? routine?.assetId ?? null }))}
      ${field("Due after this many meter units", textInput({ id: "f-meterDelta", type: "number", value: t.meterDelta ?? 1000 }))}
    </div>
    <div data-trigger-block="condition">
      ${field("When this item runs out", chipGroup({ name: "conditionItemId", options: state.items.map((i) => ({ value: i.id, label: i.name })), value: t.condition?.itemId ?? null }))}
    </div>
    <div data-trigger-block="seasonal">
      ${field("Window start month (1-12)", textInput({ id: "f-monthStart", type: "number", value: t.months?.[0] ?? 5 }))}
      ${field("Window end month (1-12)", textInput({ id: "f-monthEnd", type: "number", value: t.months?.[1] ?? 6 }))}
    </div>
    <div data-trigger-block="on_mode">
      ${field("Mode", chipGroup({ name: "onModeKey", options: state.modes.filter((m) => m.key !== "normal").map((m) => ({ value: m.key, label: m.label })), value: t.mode ?? null }))}
    </div>
  `;
}

// Only items already in the routine's own room are offered — a routine in
// the Bathroom shouldn't be able to consume Kitchen stock (2026-08-03,
// user request). Re-rendered live if the Space chip changes.
function requiresItemsFieldHtml(spaceId, selectedIds) {
  const state = getState();
  const items = state.items.filter((i) => i.spaceId === spaceId);
  return field("Uses this stock (optional)", chipGroup({ name: "requiresItemIds", options: items.map((i) => ({ value: i.id, label: i.name })), value: selectedIds, multi: true }));
}

function routineFieldsHtml(routine, spaceId, state) {
  const initialSpaceId = routine?.spaceId ?? spaceId;
  return `
    ${field("Space", chipGroup({ name: "spaceId", options: state.spaces.map((s) => ({ value: s.id, label: s.name })), value: initialSpaceId }))}
    ${field("Repeats", chipGroup({ name: "triggerType", options: TRIGGER_TYPES, value: routine?.trigger?.type ?? "floating_since_last" }))}
    ${triggerParamsHtml(routine)}
    <div id="requires-items-field">${requiresItemsFieldHtml(initialSpaceId, routine?.requiresItemIds ?? [])}</div>
    ${field("Effort", chipGroup({ name: "effort", options: EFFORT_OPTIONS, value: String(routine?.effort ?? 1) }))}
    ${field("If skipped, it", chipGroup({ name: "consequence", options: CONSEQUENCE_OPTIONS, value: routine?.consequence ?? "cosmetic" }))}
    ${field("Usually done by", chipGroup({ name: "ownerClass", options: OWNER_OPTIONS, value: routine?.ownerClass ?? "either" }))}
    ${field("Default assignee", chipGroup({ name: "defaultAssigneeId", options: state.people.map((p) => ({ value: p.id, label: p.name })), value: routine?.defaultAssigneeId ?? null }))}
    ${field("Pause during", chipGroup({ name: "pauseIn", options: state.modes.filter((m) => m.key !== "normal").map((m) => ({ value: m.key, label: m.label })), value: routine?.modeFilters?.pauseIn ?? [], multi: true }))}
  `;
}

function habitFieldsHtml(habit, defaultPersonId, state) {
  const freq = habit?.frequency || { type: "daily" };
  return `
    ${field("Person", chipGroup({ name: "habitPersonId", options: state.people.map((p) => ({ value: p.id, label: p.name })), value: habit?.personId ?? defaultPersonId ?? state.people[0]?.id }))}
    ${field("How often", chipGroup({ name: "habitFreqType", options: HABIT_FREQ_TYPES, value: freq.type }))}
    <div id="habit-custom-days" style="display:${freq.type === "custom" ? "block" : "none"};">
      ${field("Which days", chipGroup({ name: "habitCustomDays", options: HABIT_WEEKDAYS, value: (freq.days ?? []).map(String), multi: true }))}
    </div>
    <div id="habit-weekly-count" style="display:${freq.type === "weekly_count" ? "block" : "none"};">
      ${field("Times per week", textInput({ id: "f-habit-timesperweek", type: "number", value: freq.timesPerWeek ?? 3, min: 1 }))}
    </div>
    <div id="habit-every-n-days" style="display:${freq.type === "every_n_days" ? "block" : "none"};">
      ${field("Every how many days", textInput({ id: "f-habit-intervaldays", type: "number", value: freq.intervalDays ?? 2, min: 2 }))}
    </div>
  `;
}

// A task is deliberately the lightest of the three: a title (shared field
// above) and a due date, optionally scoped to a space and/or assigned to
// someone — no recurrence, no trigger, no effort/consequence rating.
function taskFieldsHtml(task, defaultSpaceId, state) {
  return `
    ${field("Due date", textInput({ id: "f-task-due", type: "date", value: task?.dueDate ?? new Date().toISOString().slice(0, 10) }))}
    ${field("Space (optional)", chipGroup({ name: "taskSpaceId", options: state.spaces.map((s) => ({ value: s.id, label: s.name })), value: task?.spaceId ?? defaultSpaceId ?? null }))}
    ${field("Assign to (optional)", chipGroup({ name: "taskAssigneeId", options: state.people.map((p) => ({ value: p.id, label: p.name })), value: task?.assigneeId ?? null }))}
  `;
}

function bodyHtml(routine, habit, task, spaceId, defaultPersonId, defaultKind) {
  const state = getState();
  const kind = habit ? "habit" : task ? "task" : routine ? "routine" : (defaultKind || "routine");
  const saveLabels = { routine: "Add routine", habit: "Add habit", task: "Add task" };
  return `
    <form id="routine-form">
      ${field("Kind", chipGroup({ name: "kind", options: KIND_OPTIONS, value: kind }))}
      ${field("Title", textInput({ id: "f-title", value: (routine || habit || task)?.title ?? "", placeholder: kind === "habit" ? "e.g. Meditate" : kind === "task" ? "e.g. Renew passport" : "e.g. Clean ceiling fans" }))}
      <div id="routine-fields" style="display:${kind === "routine" ? "block" : "none"};">${routineFieldsHtml(routine, spaceId, state)}</div>
      <div id="habit-fields" style="display:${kind === "habit" ? "block" : "none"};">${habitFieldsHtml(habit, defaultPersonId, state)}</div>
      <div id="task-fields" style="display:${kind === "task" ? "block" : "none"};">${taskFieldsHtml(task, spaceId, state)}</div>
    </form>
    ${sheetActions({ saveLabel: (routine || habit || task) ? "Save changes" : saveLabels[kind], showDelete: !!(routine || habit || task) })}
  `;
}

function showTriggerBlock(root, type) {
  root.querySelectorAll("[data-trigger-block]").forEach((el) => {
    el.style.display = el.dataset.triggerBlock === type ? "" : "none";
  });
}

function buildTrigger(root) {
  const type = readChipGroup(root, "triggerType");
  switch (type) {
    case "floating_since_last":
      return { type, intervalDays: Number(root.querySelector("#f-intervalDays").value) || 30 };
    case "fixed_calendar": {
      const freq = readChipGroup(root, "rruleFreq");
      const rrule = freq === "Weekly"
        ? `FREQ=WEEKLY;BYDAY=${readChipGroup(root, "byday") || "SU"}`
        : `FREQ=MONTHLY;BYMONTHDAY=${Number(root.querySelector("#f-bymonthday").value) || 1}`;
      return { type, rrule };
    }
    case "usage_meter":
      return { type, meterDelta: Number(root.querySelector("#f-meterDelta").value) || 1000 };
    case "condition":
      return { type, condition: { source: "item", itemId: readChipGroup(root, "conditionItemId"), op: "eq", value: "out" } };
    case "seasonal":
      return {
        type,
        months: [
          Number(root.querySelector("#f-monthStart").value) || 1,
          Number(root.querySelector("#f-monthEnd").value) || 1,
        ],
      };
    case "on_mode":
      return { type, mode: readChipGroup(root, "onModeKey") };
    default:
      return { type: "floating_since_last", intervalDays: 30 };
  }
}

function buildHabitFrequency(root) {
  const type = readChipGroup(root, "habitFreqType") || "daily";
  const frequency = { type };
  if (type === "custom") frequency.days = (readChipGroup(root, "habitCustomDays") || []).map(Number);
  if (type === "weekly_count") frequency.timesPerWeek = Number(root.querySelector("#f-habit-timesperweek").value) || 1;
  if (type === "every_n_days") frequency.intervalDays = Math.max(2, Number(root.querySelector("#f-habit-intervaldays").value) || 2);
  return frequency;
}

function openRoutineEditor({ routine = null, habit = null, task = null, defaultSpaceId = null, defaultPersonId = null, defaultKind = null, onSaved = null } = {}) {
  const editingKind = habit ? "habit" : task ? "task" : routine ? "routine" : null;
  const editLabels = { habit: "Edit habit", task: "Edit task", routine: "Edit routine" };
  openSheet({
    title: editingKind ? editLabels[editingKind] : "Add routine, habit, or task",
    bodyHtml: bodyHtml(routine, habit, task, defaultSpaceId, defaultPersonId, defaultKind),
  });
  const root = document.getElementById("sheet-root");

  ["kind", "spaceId", "triggerType", "rruleFreq", "byday", "assetId", "conditionItemId", "onModeKey", "requiresItemIds", "effort", "consequence", "ownerClass", "defaultAssigneeId", "pauseIn", "habitPersonId", "habitFreqType", "habitCustomDays", "taskSpaceId", "taskAssigneeId"]
    .forEach((name) => wireChipGroup(root, name));

  // Kind toggle swaps which of the three field blocks shows — same sheet
  // builds all of them (2026-08-04, user requests: "a toggle between habit
  // and routine", then "a new category called task").
  const saveLabels = { routine: "Add routine", habit: "Add habit", task: "Add task" };
  root.querySelector('[data-field="kind"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (!btn) return;
    const kind = btn.dataset.value;
    root.querySelector("#routine-fields").style.display = kind === "routine" ? "block" : "none";
    root.querySelector("#habit-fields").style.display = kind === "habit" ? "block" : "none";
    root.querySelector("#task-fields").style.display = kind === "task" ? "block" : "none";
    if (!editingKind) {
      root.querySelector('[data-action="save"]').textContent = saveLabels[kind];
    }
  });

  root.querySelector('[data-field="habitFreqType"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (!btn) return;
    root.querySelector("#habit-custom-days").style.display = btn.dataset.value === "custom" ? "block" : "none";
    root.querySelector("#habit-weekly-count").style.display = btn.dataset.value === "weekly_count" ? "block" : "none";
    root.querySelector("#habit-every-n-days").style.display = btn.dataset.value === "every_n_days" ? "block" : "none";
  });

  showTriggerBlock(root, routine?.trigger?.type ?? "floating_since_last");
  root.querySelector('[data-field="triggerType"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (btn) showTriggerBlock(root, btn.dataset.value);
  });

  // Switching rooms resets the stock selection rather than carrying over
  // ids that won't exist in the new room's filtered list — but only on an
  // actual change. Bug fix (2026-08-03, user report: "Uses this stock"
  // clicking/unclicking "not normal"): this used to fire on every click
  // inside the Space chip-group, including re-clicking the space that was
  // already selected, silently wiping whatever the user had just checked
  // under "Uses this stock" for no visible reason.
  let currentSpaceId = routine?.spaceId ?? defaultSpaceId;
  root.querySelector('[data-field="spaceId"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (!btn || btn.dataset.value === currentSpaceId) return;
    currentSpaceId = btn.dataset.value;
    const container = root.querySelector("#requires-items-field");
    container.innerHTML = requiresItemsFieldHtml(currentSpaceId, []);
    wireChipGroup(root, "requiresItemIds");
  });

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const title = root.querySelector("#f-title").value.trim();
    if (!title) return;
    const kind = readChipGroup(root, "kind") || "routine";

    if (kind === "habit") {
      const personId = readChipGroup(root, "habitPersonId");
      if (!personId) {
        showToast("Pick a person for this habit");
        return;
      }
      const fields = { title, personId, frequency: buildHabitFrequency(root) };
      if (habit) updateHabit(habit.id, fields);
      else addHabit(fields);
      closeSheet();
      showToast(habit ? "Habit updated" : "Habit added");
      onSaved?.();
      return;
    }

    if (kind === "task") {
      const dueDate = root.querySelector("#f-task-due").value;
      if (!dueDate) {
        showToast("Pick a due date for this task");
        return;
      }
      const fields = {
        title, dueDate,
        spaceId: readChipGroup(root, "taskSpaceId"),
        assigneeId: readChipGroup(root, "taskAssigneeId"),
      };
      if (task) updateTask(task.id, fields);
      else addTask(fields);
      closeSheet();
      showToast(task ? "Task updated" : "Task added");
      onSaved?.();
      return;
    }

    const fields = {
      title,
      spaceId: readChipGroup(root, "spaceId"),
      trigger: buildTrigger(root),
      effort: Number(readChipGroup(root, "effort")) || 1,
      consequence: readChipGroup(root, "consequence") || "cosmetic",
      ownerClass: readChipGroup(root, "ownerClass") || "either",
      defaultAssigneeId: readChipGroup(root, "defaultAssigneeId"),
      requiresItemIds: readChipGroup(root, "requiresItemIds") || [],
      modeFilters: { pauseIn: readChipGroup(root, "pauseIn") || [], boostIn: routine?.modeFilters?.boostIn ?? [] },
    };
    if (routine?.trigger?.type === "usage_meter" || fields.trigger.type === "usage_meter") {
      fields.assetId = readChipGroup(root, "assetId");
    }
    if (routine) updateRoutine(routine.id, fields);
    else addRoutine(fields);
    closeSheet();
    showToast(routine ? "Routine updated" : "Routine added");
    onSaved?.();
  });

  if (routine || habit || task) {
    root.querySelector('[data-action="delete"]').addEventListener("click", () => {
      const entity = habit || task || routine;
      if (!confirm(`Delete "${entity.title}"? This can't be undone.`)) return;
      if (habit) deleteHabit(habit.id);
      else if (task) deleteTask(task.id);
      else deleteRoutine(routine.id);
      closeSheet();
      showToast(`${habit ? "Habit" : task ? "Task" : "Routine"} deleted`);
      onSaved?.();
    });
  }
}

export { openRoutineEditor };
