// People screen (memo §8.2) — members and help, roster + leave. Reached
// via More (not a primary tab — memo §8.1 lists 5 tabs, People isn't one).
// "Mark leave" here is the entry point to the Help-on-leave hero feature,
// which isn't built yet (build-plan Phase 7).

import { getState, subscribe, addPerson, updatePerson, deletePerson, addLeave, byId } from "../state.js";
import { Icon } from "../ui/icons.js";
import { emptyState, field, textInput, chipGroup, readChipGroup, wireChipGroup, sheetActions, openSheet, closeSheet, showToast } from "../ui/components.js";

let mountEl = null;
let unsubscribe = null;
let onBack = null;

function subtitleFor(person) {
  if (person.kind === "help") {
    const days = person.schedule?.days?.length ? `${person.schedule.days.length}x/week` : "";
    return [person.role, days, person.schedule?.time].filter(Boolean).join(" · ");
  }
  return "Household member";
}

function rowHtml(person) {
  return `
    <div class="list-row" data-person-id="${person.id}">
      <div class="occ-row-icon" style="color:${person.avatarColor};">${Icon(person.kind === "help" ? "helper" : "person", { size: 18 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title named">${person.name}</div>
        <div class="occ-row-meta">${subtitleFor(person)}${person.leave?.length ? ` · ${person.leave.length} leave entr${person.leave.length === 1 ? "y" : "ies"}` : ""}</div>
      </div>
    </div>
  `;
}

function render() {
  const state = getState();
  mountEl.innerHTML = `
    <div class="topbar">
      <button class="btn btn-ghost" id="back-to-more" style="padding:8px;">${Icon("chevronLeft", { size: 18 })}</button>
      <h1 style="flex:1;">People</h1>
      <button class="btn btn-tinted" id="add-person-btn">${Icon("plus", { size: 16 })} Person</button>
    </div>
    <div class="today-section">
      ${state.people.map(rowHtml).join("") || emptyState({ message: "No one added yet.", actionLabel: null })}
    </div>
  `;
  wireEvents(state);
}

const WEEKDAY_CHIPS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function leaveListHtml(person) {
  if (!person.leave?.length) return `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">No leave on record.</p>`;
  return person.leave
    .map((l) => `<p style="font-size:var(--fs-meta);color:var(--ink-muted);">${l.from} → ${l.to}${l.reason ? ` · ${l.reason}` : ""}</p>`)
    .join("");
}

function openPersonSheet(person) {
  const isHelp = person?.kind === "help";
  openSheet({
    title: person ? "Edit person" : "Add person",
    bodyHtml: `
      <form id="person-form">
        ${field("Name", textInput({ id: "f-person-name", value: person?.name ?? "" }))}
        ${field("Type", chipGroup({ name: "kind", options: ["member", "help"], value: person?.kind ?? "member" }))}
        <div data-kind-block="help" style="display:${isHelp ? "" : "none"};">
          ${field("Role", textInput({ id: "f-person-role", value: person?.role ?? "", placeholder: "e.g. maid, cook, driver" }))}
          ${field("Works on", chipGroup({ name: "scheduleDays", options: WEEKDAY_CHIPS, value: person?.schedule?.days ?? [], multi: true }))}
          ${field("Usual time", textInput({ id: "f-person-time", value: person?.schedule?.time ?? "" }))}
        </div>
        ${person ? `<div class="field"><span class="field-label">Leave</span>${leaveListHtml(person)}</div>` : ""}
        ${person ? `
          <div class="field">
            <span class="field-label">Add leave</span>
            <div style="display:flex;gap:8px;">
              ${textInput({ id: "f-leave-from", type: "date" })}
              ${textInput({ id: "f-leave-to", type: "date" })}
            </div>
            <button type="button" class="btn btn-ghost" id="add-leave-btn" style="margin-top:8px;">Add leave</button>
          </div>
        ` : ""}
      </form>
      ${sheetActions({ saveLabel: person ? "Save changes" : "Add person", showDelete: !!person })}
    `,
  });

  const root = document.getElementById("sheet-root");
  wireChipGroup(root, "kind");
  wireChipGroup(root, "scheduleDays");

  root.querySelector('[data-field="kind"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (!btn) return;
    root.querySelector('[data-kind-block="help"]').style.display = btn.dataset.value === "help" ? "" : "none";
  });

  root.querySelector("#add-leave-btn")?.addEventListener("click", () => {
    const from = root.querySelector("#f-leave-from").value;
    const to = root.querySelector("#f-leave-to").value;
    if (!from || !to) return;
    addLeave(person.id, { from, to });
    closeSheet();
    showToast("Leave added");
  });

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const name = root.querySelector("#f-person-name").value.trim();
    if (!name) return;
    const kind = readChipGroup(root, "kind") || "member";
    const fields = { name, kind };
    if (kind === "help") {
      fields.role = root.querySelector("#f-person-role").value.trim() || null;
      fields.schedule = { days: readChipGroup(root, "scheduleDays") || [], time: root.querySelector("#f-person-time").value || null };
    }
    if (person) updatePerson(person.id, fields);
    else addPerson(fields);
    closeSheet();
    showToast(person ? "Person updated" : "Person added");
  });

  if (person) {
    root.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm(`Remove ${person.name}?`)) return;
      deletePerson(person.id);
      closeSheet();
      showToast("Person removed");
    });
  }
}

function wireEvents(state) {
  document.getElementById("back-to-more")?.addEventListener("click", () => onBack?.());
  document.getElementById("add-person-btn")?.addEventListener("click", () => openPersonSheet(null));
  mountEl.querySelectorAll("[data-person-id]").forEach((row) => {
    row.addEventListener("click", () => openPersonSheet(byId(state.people, row.dataset.personId)));
  });
}

function mount(el, { onBack: back } = {}) {
  mountEl = el;
  onBack = back;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount };
