// The custom routine builder — a plain-language sheet, not a form dump
// (memo §4.2). Shared by every screen that creates or edits a routine
// (House space detail today; reused wherever else needs it later).

import { getState, addRoutine, updateRoutine, deleteRoutine } from "../state.js";
import { openSheet, closeSheet, field, textInput, chipGroup, readChipGroup, wireChipGroup, sheetActions, showToast } from "../ui/components.js";

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

function bodyHtml(routine, spaceId) {
  const state = getState();
  return `
    <form id="routine-form">
      ${field("Title", textInput({ id: "f-title", value: routine?.title ?? "", placeholder: "e.g. Clean ceiling fans" }))}
      ${field("Space", chipGroup({ name: "spaceId", options: state.spaces.map((s) => ({ value: s.id, label: s.name })), value: routine?.spaceId ?? spaceId }))}
      ${field("Repeats", chipGroup({ name: "triggerType", options: TRIGGER_TYPES, value: routine?.trigger?.type ?? "floating_since_last" }))}
      ${triggerParamsHtml(routine)}
      ${field("Uses this stock (optional)", chipGroup({ name: "requiresItemIds", options: state.items.map((i) => ({ value: i.id, label: i.name })), value: routine?.requiresItemIds ?? [], multi: true }))}
      ${field("Effort", chipGroup({ name: "effort", options: EFFORT_OPTIONS, value: String(routine?.effort ?? 1) }))}
      ${field("If skipped, it", chipGroup({ name: "consequence", options: CONSEQUENCE_OPTIONS, value: routine?.consequence ?? "cosmetic" }))}
      ${field("Usually done by", chipGroup({ name: "ownerClass", options: OWNER_OPTIONS, value: routine?.ownerClass ?? "either" }))}
      ${field("Default assignee", chipGroup({ name: "defaultAssigneeId", options: state.people.map((p) => ({ value: p.id, label: p.name })), value: routine?.defaultAssigneeId ?? null }))}
      ${field("Pause during", chipGroup({ name: "pauseIn", options: state.modes.filter((m) => m.key !== "normal").map((m) => ({ value: m.key, label: m.label })), value: routine?.modeFilters?.pauseIn ?? [], multi: true }))}
    </form>
    ${sheetActions({ saveLabel: routine ? "Save changes" : "Add routine", showDelete: !!routine })}
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

function openRoutineEditor({ routine = null, defaultSpaceId = null } = {}) {
  openSheet({ title: routine ? "Edit routine" : "Add routine", bodyHtml: bodyHtml(routine, defaultSpaceId) });
  const root = document.getElementById("sheet-root");

  ["spaceId", "triggerType", "rruleFreq", "byday", "assetId", "conditionItemId", "onModeKey", "requiresItemIds", "effort", "consequence", "ownerClass", "defaultAssigneeId", "pauseIn"]
    .forEach((name) => wireChipGroup(root, name));

  showTriggerBlock(root, routine?.trigger?.type ?? "floating_since_last");
  root.querySelector('[data-field="triggerType"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (btn) showTriggerBlock(root, btn.dataset.value);
  });

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const title = root.querySelector("#f-title").value.trim();
    if (!title) return;
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
  });

  if (routine) {
    root.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm(`Delete "${routine.title}"? This can't be undone.`)) return;
      deleteRoutine(routine.id);
      closeSheet();
      showToast("Routine deleted");
    });
  }
}

export { openRoutineEditor };
