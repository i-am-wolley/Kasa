// House screen (memo §8.2) — spaces grid → space detail with its routines,
// stock, and assets. "Where users browse and prune."

import { getState, subscribe, addSpace, updateSpace, deleteSpace, addItem, addAsset, addRoutine, toggleRoutineActive, deleteRoutine, visibleSpaceIds, MANDATORY_SPACE_TYPES, nextSaturdayDateStr, byId } from "../state.js";
import { templateFor } from "../roomTemplates.js";
import { Icon } from "../ui/icons.js";
import { emptyState, field, textInput, chipGroup, readChipGroup, wireChipGroup, sheetActions, openSheet, closeSheet, showToast } from "../ui/components.js";
import { openRoutineEditor } from "./routine.js";
import { openItemSheet } from "./stock.js";
import { openAssetSheet } from "./assets.js";

// {value,label} pairs, not a flat string array, so the chip text reads
// "Whole home" instead of the raw "whole_home" key (bug the user flagged
// 2026-08-03 — every type had this problem, not just whole_home, since
// the chip label previously fell back to the raw value with no mapping).
const SPACE_TYPES = [
  { value: "bath", label: "Bathroom" },
  { value: "bedroom", label: "Bedroom" },
  { value: "living", label: "Living room" },
  { value: "kitchen", label: "Kitchen" },
  { value: "utility", label: "Utility" },
  { value: "balcony", label: "Balcony" },
  { value: "study", label: "Study" },
  { value: "entry", label: "Entry" },
  { value: "storage", label: "Storage" },
  { value: "whole_home", label: "Whole home" },
  { value: "outside", label: "Outside" },
  { value: "pooja", label: "Pooja room" },
  { value: "entertainment", label: "Entertainment room" },
  { value: "dining", label: "Dining room" },
  { value: "garage", label: "Garage" },
  { value: "terrace", label: "Terrace" },
];

let mountEl = null;
let unsubscribe = null;
let view = "grid";
let selectedSpaceId = null;

// Whole home and Utility are mandatory PER HOUSE (2026-08-05/06) — a
// house's last remaining space of either type can't be deleted, same
// guard state.js's deleteSpace() enforces at the actual mutation boundary;
// this just keeps the button from ever being the first place a user hits it.
function canDeleteSpace(space, state) {
  if (!MANDATORY_SPACE_TYPES.includes(space.type)) return true;
  return state.spaces.filter((s) => s.houseId === space.houseId && s.type === space.type).length > 1;
}

function gridHtml(state) {
  // Scoped to whichever house(s) the header picker currently has selected
  // (2026-08-05, multi-house support) — the common single-house household
  // sees every space exactly as before, since "visible" there is just
  // "all of them." A house-name caption only appears on the tile when more
  // than one house is active at once, so viewing a single house (the
  // default) stays exactly as uncluttered as it always was.
  const visible = visibleSpaceIds(state);
  const multiHouse = state.household.activeHouseIds?.length > 1 || state.houses.length > 1 && !state.household.activeHouseIds?.length;
  const spaces = state.spaces.filter((sp) => visible.has(sp.id));
  const cards = spaces
    .map((sp) => {
      const houseName = multiHouse ? byId(state.houses, sp.houseId)?.name : null;
      // Whole home/Utility get a small lock badge instead of a text label
      // (2026-08-06, user request: "show that visually somehow with
      // minimal or no text") — every other tile is unbadged, same as before.
      const locked = MANDATORY_SPACE_TYPES.includes(sp.type);
      return `
    <div class="tile" data-space-id="${sp.id}">
      ${locked ? `<div class="tile-badge" title="Always included">${Icon("lock", { size: 11 })}</div>` : ""}
      <div class="tile-icon">${Icon(sp.icon || "house", { size: 18 })}</div>
      <div class="tile-title named">${sp.name}</div>
      ${houseName ? `<div class="tile-meta">${houseName}</div>` : ""}
    </div>
  `;
    })
    .join("");

  return `
    <div class="topbar">
      <h1>House</h1>
      <button class="btn btn-tinted" id="add-space-btn">${Icon("plus", { size: 16 })} Space</button>
    </div>
    <div class="today-section">
      ${cards ? `<div class="tile-grid">${cards}</div>` : emptyState({ message: "No spaces yet.", actionLabel: null })}
    </div>
  `;
}

function detailHtml(state) {
  const space = byId(state.spaces, selectedSpaceId);
  // Also bails back to the grid if this space's house was just deselected
  // in the header house picker (2026-08-05) — a stale detail view for a
  // room that's no longer in scope would be confusing to land back on.
  if (!space || !visibleSpaceIds(state).has(space.id)) { view = "grid"; return gridHtml(state); }

  const routineRows = state.routines
    .filter((r) => r.spaceId === space.id)
    .map(
      (r) => `
      <div class="list-row" style="opacity:${r.active ? 1 : 0.5};">
        <div class="occ-row-body" data-edit-routine="${r.id}">
          <div class="occ-row-title named">${r.title}</div>
          <div class="occ-row-meta">${r.trigger.type.replace(/_/g, " ")} · effort ${r.effort} · ${r.consequence}</div>
        </div>
        <button class="chip" data-toggle-routine="${r.id}" style="min-height:auto;padding:6px 10px;">${r.active ? "Pause" : "Resume"}</button>
        <button class="stepper-btn" data-delete-routine="${r.id}">${Icon("trash", { size: 14 })}</button>
      </div>`,
    )
    .join("");

  // Tiles, not rows, matching House's own space grid and Stock's item grid
  // (2026-08-03, user request — "similar to the one we did before"). No
  // inline trash button on the tile face — there's no room at this size —
  // deleting still works from inside the edit sheet each tile opens, same
  // as Stock's own top-level tiles never had inline delete either.
  const itemRows = state.items
    .filter((i) => i.spaceId === space.id)
    .map(
      (i) => `
      <div class="tile" data-open-item="${i.id}">
        <div class="tile-icon">${Icon(i.icon || "stock", { size: 16 })}</div>
        <div class="tile-title">${i.name}</div>
        <div class="tile-meta">${i.qty} ${i.unit}</div>
      </div>`,
    )
    .join("");

  const assetRows = state.assets
    .filter((a) => a.spaceId === space.id)
    .map(
      (a) => `
      <div class="tile" data-open-asset="${a.id}">
        <div class="tile-icon">${Icon(a.icon || "warranty", { size: 16 })}</div>
        <div class="tile-title named">${a.name}</div>
        <div class="tile-meta">${a.nextServiceDue ? `Due ${a.nextServiceDue}` : "—"}</div>
      </div>`,
    )
    .join("");

  return `
    <div class="topbar">
      <button class="btn btn-ghost" id="back-to-grid" style="padding:8px;">${Icon("chevronLeft", { size: 18 })}</button>
      <h1 style="flex:1;">${space.name}</h1>
      <button class="btn btn-ghost" id="rename-space-btn" style="padding:8px;">${Icon("edit", { size: 16 })}</button>
      ${canDeleteSpace(space, state) ? `<button class="btn btn-ghost" id="delete-space-btn" style="padding:8px;">${Icon("trash", { size: 16 })}</button>` : ""}
    </div>
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Routines</span><button class="chip" id="add-routine-btn">${Icon("plus", { size: 12 })} Add</button></div>
      ${routineRows || emptyState({ message: "No routines in this space.", actionLabel: null })}
    </div>
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Stock</span><button class="chip" id="add-item-btn">${Icon("plus", { size: 12 })} Add</button></div>
      ${itemRows ? `<div class="tile-grid">${itemRows}</div>` : emptyState({ message: "No stock tracked here.", actionLabel: null })}
    </div>
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Assets</span><button class="chip" id="add-asset-btn">${Icon("plus", { size: 12 })} Add</button></div>
      ${assetRows ? `<div class="tile-grid">${assetRows}</div>` : emptyState({ message: "No assets here.", actionLabel: null })}
    </div>
  `;
}

function openAddSpaceSheet() {
  openSheet({
    title: "Add space",
    bodyHtml: `
      <form id="space-form">
        ${field("Name", textInput({ id: "f-space-name", placeholder: "e.g. Guest bedroom" }))}
        ${field("Type", chipGroup({ name: "spaceType", options: SPACE_TYPES, value: "living" }))}
      </form>
      ${sheetActions({ saveLabel: "Add space" })}
    `,
  });
  const root = document.getElementById("sheet-root");
  wireChipGroup(root, "spaceType");
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const name = root.querySelector("#f-space-name").value.trim();
    if (!name) return;
    const type = readChipGroup(root, "spaceType");
    const space = addSpace({ name, type, icon: type === "whole_home" ? "wholeHome" : type });
    if (!space) {
      showToast(`This house already has a room named "${name}" — try another name`);
      return;
    }
    selectedSpaceId = space.id;
    view = "detail";

    const template = templateFor(type);
    if (template) {
      openRoomTemplateSheet(space, template);
    } else {
      closeSheet();
      showToast("Space added");
      render();
    }
  });
}

// Confirm-don't-create review of a room type's suggested assets/items/
// routines (memo §3's onboarding principle, applied at single-room scale —
// added 2026-08-03, user request). Everything pre-checked, one tap per row
// to skip it, nothing forced.
function openRoomTemplateSheet(space, template) {
  const { assetEntries, itemEntries, routines } = template;

  const suggestionRow = (icon, title, dataAttr, index) => `
    <div class="list-row" style="cursor:default;">
      ${icon ? `<div class="occ-row-icon">${Icon(icon, { size: 16 })}</div>` : ""}
      <div class="occ-row-body"><div class="occ-row-title">${title}</div></div>
      <button type="button" class="chip" aria-pressed="true" data-${dataAttr}-index="${index}">Keep</button>
    </div>
  `;

  const section = (label, html) => (html ? `<div class="today-section" style="padding:0 0 12px;"><span class="eyebrow">${label}</span>${html}</div>` : "");

  openSheet({
    title: `Suggested for ${space.name}`,
    bodyHtml: `
      <p style="color:var(--ink-muted);margin-bottom:16px;">Everything here is a suggestion — skip anything that doesn't fit, add more later from House.</p>
      ${section("Assets", assetEntries.map((e, i) => suggestionRow(e.icon, e.name, "asset", i)).join(""))}
      ${section("Stock", itemEntries.map((e, i) => suggestionRow(e.icon, e.name, "item", i)).join(""))}
      ${section("Routines", routines.map((r, i) => suggestionRow(null, r.title, "routine", i)).join(""))}
      ${sheetActions({ saveLabel: "Add selected" })}
    `,
  });

  const root = document.getElementById("sheet-root");
  root.querySelectorAll("[data-asset-index], [data-item-index], [data-routine-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kept = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", String(!kept));
      btn.textContent = kept ? "Skip" : "Keep";
    });
  });

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    let added = 0;

    // Items first, then assets/routines — a suggestedRoutines lookup below
    // needs this room's items to already exist in state to link to them
    // (e.g. an AC's "Clean filter" routine linking to this same template's
    // suggested filter item), not just items that predate this save.
    root.querySelectorAll('[data-item-index][aria-pressed="true"]').forEach((btn) => {
      const entry = itemEntries[Number(btn.dataset.itemIndex)];
      if (!entry) return;
      addItem({ name: entry.name, catalogKey: entry.key, icon: entry.icon, spaceId: space.id, unit: entry.unit, qty: entry.parLevel, packSize: entry.packSize, parLevel: entry.parLevel, burnRate: entry.defaultBurnRate ?? 0 });
      added += 1;
    });

    root.querySelectorAll('[data-asset-index][aria-pressed="true"]').forEach((btn) => {
      const entry = assetEntries[Number(btn.dataset.assetIndex)];
      if (!entry) return;
      const createdAsset = addAsset({ name: entry.name, catalogKey: entry.key, icon: entry.icon, spaceId: space.id, serviceIntervalDays: entry.serviceIntervalDays ?? null, expectedLifeYears: entry.expectedLifeYears ?? null });
      added += 1;

      // Same catalog entry, same suggestedRoutines the standalone Add Asset
      // flow offers pre-checked — this room-template path skipped that
      // until now, which is exactly the gap the user flagged (2026-08-03:
      // "those assets are not having the standard routines already checked
      // in"). Auto-add them here rather than a second layer of toggles.
      // Same-room only when resolving requiresItemKeys (2026-08-03, user
      // request — routines shouldn't silently link to another room's item
      // just because it shares a catalog key).
      for (const tmpl of entry.suggestedRoutines || []) {
        const requiresItemIds = (tmpl.requiresItemKeys || [])
          .map((k) => getState().items.find((it) => it.catalogKey === k && it.spaceId === space.id)?.id)
          .filter(Boolean);
        // New asset's suggested routines default to next Saturday, not
        // today (2026-08-07, user request) — same treatment as assets.js's
        // own standalone Add Asset flow.
        const trigger = tmpl.trigger.type === "floating_since_last" ? { ...tmpl.trigger, startDate: nextSaturdayDateStr() } : tmpl.trigger;
        addRoutine({
          title: tmpl.title, spaceId: space.id, assetId: createdAsset.id, trigger,
          effort: tmpl.effort, consequence: tmpl.consequence, ownerClass: tmpl.ownerClass, requiresItemIds,
        });
        added += 1;
      }
    });

    root.querySelectorAll('[data-routine-index][aria-pressed="true"]').forEach((btn) => {
      const tmpl = routines[Number(btn.dataset.routineIndex)];
      if (!tmpl) return;
      addRoutine({ title: tmpl.title, spaceId: space.id, trigger: tmpl.trigger, effort: tmpl.effort, consequence: tmpl.consequence, ownerClass: tmpl.ownerClass });
      added += 1;
    });

    closeSheet();
    showToast(added ? `Space added — ${added} thing${added === 1 ? "" : "s"} set up` : "Space added");
    render();
  });
}

function openRenameSheet(space) {
  openSheet({
    title: "Rename space",
    bodyHtml: `
      <form id="rename-form">${field("Name", textInput({ id: "f-rename", value: space.name }))}</form>
      ${sheetActions({ saveLabel: "Save" })}
    `,
  });
  const root = document.getElementById("sheet-root");
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const name = root.querySelector("#f-rename").value.trim();
    if (!name) return;
    const updated = updateSpace(space.id, { name });
    if (!updated) {
      showToast(`This house already has a room named "${name}" — try another name`);
      return;
    }
    closeSheet();
    showToast("Space renamed");
  });
}

function openDeleteSpaceSheet(space) {
  const state = getState();
  // Reassign targets stay within the same house (2026-08-05) — moving a
  // room's contents into a different house's space would silently relocate
  // them across the new house boundary, which nothing about "delete this
  // space" implies.
  const others = state.spaces.filter((s) => s.id !== space.id && s.houseId === space.houseId);
  const hasContents =
    state.items.some((i) => i.spaceId === space.id) ||
    state.assets.some((a) => a.spaceId === space.id) ||
    state.routines.some((r) => r.spaceId === space.id);

  openSheet({
    title: `Delete ${space.name}?`,
    bodyHtml: `
      <p style="color:var(--ink-muted);margin-bottom:16px;">${hasContents ? "This space still has routines, stock, or assets. Move them somewhere first, or delete everything with it." : "This space is empty."}</p>
      ${hasContents ? field("Move contents to", chipGroup({ name: "reassignTo", options: [{ value: "", label: "Delete everything" }, ...others.map((s) => ({ value: s.id, label: s.name }))], value: "" })) : ""}
      ${sheetActions({ saveLabel: "Delete space" })}
    `,
  });
  const root = document.getElementById("sheet-root");
  if (hasContents) wireChipGroup(root, "reassignTo");
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const reassignToId = hasContents ? readChipGroup(root, "reassignTo") || null : null;
    deleteSpace(space.id, { reassignToId });
    view = "grid";
    closeSheet();
    showToast("Space deleted");
    render();
  });
}

function render() {
  const state = getState();
  mountEl.innerHTML = view === "grid" ? gridHtml(state) : detailHtml(state);
  wireEvents();
}

function wireEvents() {
  const state = getState();

  document.getElementById("add-space-btn")?.addEventListener("click", openAddSpaceSheet);

  mountEl.querySelectorAll("[data-space-id]").forEach((row) => {
    row.addEventListener("click", () => {
      selectedSpaceId = row.dataset.spaceId;
      view = "detail";
      render();
    });
  });

  document.getElementById("back-to-grid")?.addEventListener("click", () => {
    view = "grid";
    render();
  });

  document.getElementById("add-routine-btn")?.addEventListener("click", () => {
    openRoutineEditor({ defaultSpaceId: selectedSpaceId });
  });

  document.getElementById("add-item-btn")?.addEventListener("click", () => {
    openItemSheet({ defaultSpaceId: selectedSpaceId });
  });

  document.getElementById("add-asset-btn")?.addEventListener("click", () => {
    openAssetSheet({ defaultSpaceId: selectedSpaceId });
  });

  mountEl.querySelectorAll("[data-open-item]").forEach((el) => {
    el.addEventListener("click", () => openItemSheet({ item: byId(state.items, el.dataset.openItem) }));
  });

  mountEl.querySelectorAll("[data-open-asset]").forEach((el) => {
    el.addEventListener("click", () => openAssetSheet({ asset: byId(state.assets, el.dataset.openAsset) }));
  });

  document.getElementById("rename-space-btn")?.addEventListener("click", () => {
    openRenameSheet(byId(state.spaces, selectedSpaceId));
  });

  document.getElementById("delete-space-btn")?.addEventListener("click", () => {
    openDeleteSpaceSheet(byId(state.spaces, selectedSpaceId));
  });

  mountEl.querySelectorAll("[data-edit-routine]").forEach((el) => {
    el.addEventListener("click", () => openRoutineEditor({ routine: byId(state.routines, el.dataset.editRoutine) }));
  });

  mountEl.querySelectorAll("[data-toggle-routine]").forEach((el) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); toggleRoutineActive(el.dataset.toggleRoutine); });
  });

  mountEl.querySelectorAll("[data-delete-routine]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Delete this routine?")) deleteRoutine(el.dataset.deleteRoutine);
    });
  });

}

function mount(el) {
  mountEl = el;
  view = "grid";
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount, SPACE_TYPES };
