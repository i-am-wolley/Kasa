// Houses management (2026-08-05, user request: "a household can have more
// than one house... there should be an option in more to delete houses").
// Reached from More, same one-level-down pattern as Assets/People & Household.
// The header's house picker (boot.js) handles day-to-day switching between
// which house(s) are in view; this screen is for naming, adding, and
// removing the houses themselves.

import { getState, subscribe, addHouse, updateHouse, deleteHouse, byId } from "../state.js";
import { Icon } from "../ui/icons.js";
import { emptyState, field, textInput, sheetActions, openSheet, closeSheet, showToast } from "../ui/components.js";
import { mount as mountOnboard } from "./onboard.js";

let mountEl = null;
let unsubscribe = null;
let onBack = null;

function rowHtml(house, state) {
  const spaceCount = state.spaces.filter((s) => s.houseId === house.id).length;
  return `
    <div class="list-row" data-house-id="${house.id}">
      <div class="occ-row-icon">${Icon("house", { size: 18 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title named">${house.name}</div>
        <div class="occ-row-meta">${spaceCount} space${spaceCount === 1 ? "" : "s"}</div>
      </div>
    </div>
  `;
}

function render() {
  const state = getState();
  mountEl.innerHTML = `
    <div class="topbar">
      <button class="btn btn-ghost" id="back-to-more" style="padding:8px;">${Icon("chevronLeft", { size: 18 })}</button>
      <h1 style="flex:1;">Houses</h1>
      <button class="btn btn-tinted" id="add-house-btn">${Icon("plus", { size: 16 })} House</button>
    </div>
    <div class="today-section">
      <p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-bottom:12px;">Each house has its own spaces, stock, assets, and routines. Switch which one you're viewing from the picker next to the logo.</p>
      ${state.houses.map((h) => rowHtml(h, state)).join("") || emptyState({ message: "No houses yet.", actionLabel: null })}
    </div>
  `;
  wireEvents(state);
}

// Adding a house now hands straight off to the same six-question wizard
// used for a brand-new household (2026-08-06, user request: "the new
// onboarding is nice — let's trigger that when a new house is added").
// addHouse() already stamps this house's mandatory Whole home/Utility
// spaces and makes it the sole active house before the wizard opens, so
// seedHousehold() (called when the wizard's own review step confirms)
// correctly targets it without any extra plumbing here.
function launchOnboardingForNewHouse() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  mountOnboard(mountEl, {
    context: "house",
    onDone: () => mount(mountEl, { onBack }),
  });
}

function openHouseSheet(house) {
  openSheet({
    title: house ? "Rename house" : "Add house",
    bodyHtml: `
      <form id="house-form">${field("Name", textInput({ id: "f-house-name", value: house?.name ?? "", placeholder: "e.g. Weekend home" }))}</form>
      ${sheetActions({ saveLabel: house ? "Save" : "Add house", showDelete: !!house })}
    `,
  });
  const root = document.getElementById("sheet-root");
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const name = root.querySelector("#f-house-name").value.trim();
    if (!name) return;
    if (house) {
      const updated = updateHouse(house.id, { name });
      if (!updated) {
        showToast(`You already have a house named "${name}" — try another name`);
        return;
      }
      closeSheet();
      showToast("House renamed");
    } else {
      const created = addHouse({ name });
      if (!created) {
        showToast(`You already have a house named "${name}" — try another name`);
        return;
      }
      closeSheet();
      launchOnboardingForNewHouse();
    }
  });
  if (house) {
    root.querySelector('[data-action="delete"]').addEventListener("click", () => {
      const state = getState();
      if (state.houses.length <= 1) {
        showToast("Every household needs at least one house — can't delete the last one");
        return;
      }
      const spaceCount = state.spaces.filter((s) => s.houseId === house.id).length;
      const warn = spaceCount ? ` Every space, stock item, asset, and routine in it (${spaceCount} space${spaceCount === 1 ? "" : "s"}) goes too.` : "";
      if (!confirm(`Delete "${house.name}"?${warn} This can't be undone.`)) return;
      const ok = deleteHouse(house.id);
      closeSheet();
      showToast(ok ? "House deleted" : "Couldn't delete — every household needs at least one house");
    });
  }
}

function wireEvents(state) {
  document.getElementById("back-to-more")?.addEventListener("click", () => onBack?.());
  document.getElementById("add-house-btn")?.addEventListener("click", () => openHouseSheet(null));
  mountEl.querySelectorAll("[data-house-id]").forEach((row) => {
    row.addEventListener("click", () => openHouseSheet(byId(state.houses, row.dataset.houseId)));
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
