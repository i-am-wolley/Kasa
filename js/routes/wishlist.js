// Wishlist screen (2026-08-04, user request) — "an area for a household to
// improve their ways of life, or elevate their life." Three entry types:
// - "asset": a durable thing to buy, catalog-linked (js/catalog.js) same as
//   Assets' own add flow, so "Mark acquired" creates a real tracked asset.
// - "item": a stock upgrade/change, same catalog link, "Mark acquired"
//   creates a real tracked stock item.
// - "project": a bigger one-off with no catalog entry to link to (repaint
//   a room, re-tile a bathroom) — free-text title, "Mark acquired" just
//   marks it done.
// Deliberately NOT recurring (that's Routines/Habits) and not itself a
// purchase record (that's Assets/Stock once acquired) — this is the
// staging area before an idea becomes real.

import { getState, subscribe, addWishlistItem, updateWishlistItem, deleteWishlistItem, markWishlistAcquired, byId } from "../state.js";
import { Icon } from "../ui/icons.js";
import { emptyState, field, textInput, catalogField, wireCatalogField, resolveCatalogField, chipGroup, readChipGroup, wireChipGroup, sheetActions, openSheet, closeSheet, showToast } from "../ui/components.js";

const TYPES = [
  { value: "asset", label: "Asset" },
  { value: "item", label: "Stock item" },
  { value: "project", label: "Project" },
];
const PRIORITIES = [
  { value: "high", label: "High priority" },
  { value: "soon", label: "Soon" },
  { value: "someday", label: "Someday" },
];
const PRIORITY_RANK = { high: 3, soon: 2, someday: 1 };
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.label]));

let mountEl = null;
let unsubscribe = null;

function formatCost(cost) {
  if (!cost) return "";
  return `₹${Number(cost).toLocaleString("en-IN")}`;
}

function tileHtml(entry) {
  const meta = entry.status === "acquired"
    ? (entry.type === "project" ? "Done" : "Acquired")
    : [PRIORITY_LABEL[entry.priority], formatCost(entry.estimatedCost)].filter(Boolean).join(" · ");
  return `
    <div class="tile" data-open-wish="${entry.id}" style="opacity:${entry.status === "acquired" ? 0.55 : 1};">
      <div class="tile-icon">${Icon(entry.icon || "wishlist", { size: 16 })}</div>
      <div class="tile-title">${entry.title}</div>
      <div class="tile-meta">${meta}</div>
    </div>
  `;
}

function sectionHtml(title, entries) {
  if (!entries.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">${title} (${entries.length})</span></div>
      <div class="tile-grid">${entries.map(tileHtml).join("")}</div>
    </div>
  `;
}

function render() {
  const state = getState();
  const active = state.wishlist.filter((w) => w.status !== "acquired");
  const acquired = state.wishlist.filter((w) => w.status === "acquired");

  const byPriority = { high: [], soon: [], someday: [] };
  for (const w of active) (byPriority[w.priority] || byPriority.someday).push(w);

  mountEl.innerHTML = `
    <div class="topbar">
      <h1>Wishlist</h1>
      <button class="btn btn-tinted" id="add-wish-btn">${Icon("plus", { size: 16 })} Idea</button>
    </div>
    ${sectionHtml("High priority", byPriority.high)}
    ${sectionHtml("Soon", byPriority.soon)}
    ${sectionHtml("Someday", byPriority.someday)}
    ${sectionHtml("Acquired", acquired)}
    ${!state.wishlist.length ? emptyState({ message: "No ideas yet — add something you'd like for the house.", actionLabel: null }) : ""}
  `;

  wireEvents(state);
}

function catalogNameFieldHtml(type, value) {
  return field("Name", catalogField({
    id: "f-wish-name", type, value,
    placeholder: type === "item" ? "Start typing — e.g. Detergent" : "Start typing — e.g. Air purifier",
  }));
}

function openWishSheet({ entry = null, defaultSpaceId = null } = {}) {
  const state = getState();
  const initialType = entry?.type ?? "asset";
  openSheet({
    title: entry ? "Edit idea" : "Add idea",
    bodyHtml: `
      <form id="wish-form">
        ${field("Type", chipGroup({ name: "wishType", options: TYPES, value: initialType }))}
        <div id="catalog-name-wrap" style="display:${initialType === "project" ? "none" : "block"};">
          ${catalogNameFieldHtml(initialType === "item" ? "item" : "asset", initialType !== "project" ? (entry?.title ?? "") : "")}
        </div>
        <div id="plain-name-wrap" style="display:${initialType === "project" ? "block" : "none"};">
          ${field("Title", textInput({ id: "f-wish-title", value: initialType === "project" ? (entry?.title ?? "") : "", placeholder: "e.g. Repaint living room walls" }))}
        </div>
        ${field("Space (optional)", chipGroup({ name: "wishSpaceId", options: state.spaces.map((s) => ({ value: s.id, label: s.name })), value: entry?.spaceId ?? defaultSpaceId ?? null }))}
        ${field("Priority", chipGroup({ name: "wishPriority", options: PRIORITIES, value: entry?.priority ?? "someday" }))}
        ${field("Estimated cost (optional)", textInput({ id: "f-wish-cost", type: "number", value: entry?.estimatedCost ?? "", placeholder: "e.g. 12000", min: 0 }))}
        ${field("Notes (optional)", textInput({ id: "f-wish-notes", value: entry?.notes ?? "", placeholder: "Why, or what to look for" }))}
      </form>
      ${sheetActions({ saveLabel: entry ? "Save changes" : "Add idea", showDelete: !!entry })}
      ${entry && entry.status !== "acquired" ? `<button type="button" class="btn btn-accent" id="mark-acquired-btn" style="width:100%;margin-top:8px;">${Icon("check", { size: 14 })} ${entry.type === "project" ? "Mark done" : "Mark acquired"}</button>` : ""}
    `,
  });
  const root = document.getElementById("sheet-root");
  ["wishType", "wishSpaceId", "wishPriority"].forEach((n) => wireChipGroup(root, n));

  let currentCatalogType = initialType === "item" ? "item" : "asset";
  function wireNameCatalog() {
    wireCatalogField(root, "f-wish-name", currentCatalogType);
  }
  if (initialType !== "project") wireNameCatalog();

  root.querySelectorAll('[data-field="wishType"] [data-value]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.value;
      const catalogWrap = root.querySelector("#catalog-name-wrap");
      const plainWrap = root.querySelector("#plain-name-wrap");
      if (type === "project") {
        catalogWrap.style.display = "none";
        plainWrap.style.display = "block";
        return;
      }
      plainWrap.style.display = "none";
      catalogWrap.style.display = "block";
      // Retyping across asset<->item resets the name — the catalog
      // typeahead searches a different list per type, so a name matched
      // against one wouldn't necessarily resolve against the other.
      if (type !== currentCatalogType) {
        currentCatalogType = type;
        catalogWrap.innerHTML = catalogNameFieldHtml(type, "");
        wireNameCatalog();
      }
    });
  });

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const type = readChipGroup(root, "wishType") || "asset";
    let title, catalogKey, icon;
    if (type === "project") {
      title = root.querySelector("#f-wish-title").value.trim();
      if (!title) return;
      catalogKey = null;
      icon = "wishlist";
    } else {
      const resolved = resolveCatalogField(root, "f-wish-name", type);
      if (!resolved) return;
      title = resolved.name;
      catalogKey = resolved.key;
      icon = resolved.icon;
    }
    const fields = {
      title, type, catalogKey, icon,
      spaceId: readChipGroup(root, "wishSpaceId"),
      priority: readChipGroup(root, "wishPriority") || "someday",
      estimatedCost: Math.max(0, Number(root.querySelector("#f-wish-cost").value) || 0) || null,
      notes: root.querySelector("#f-wish-notes").value.trim(),
    };
    if (entry) updateWishlistItem(entry.id, fields);
    else addWishlistItem(fields);
    closeSheet();
    showToast(entry ? "Idea updated" : "Idea added");
  });

  root.querySelector("#mark-acquired-btn")?.addEventListener("click", () => {
    if (entry.type !== "project" && !entry.spaceId) {
      showToast("Pick a space first so this can be added there");
      return;
    }
    markWishlistAcquired(entry.id);
    closeSheet();
    showToast(entry.type === "project" ? "Marked done" : `Added to ${entry.type === "asset" ? "Assets" : "Stock"}`);
  });

  if (entry) {
    root.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm(`Remove "${entry.title}" from the wishlist?`)) return;
      deleteWishlistItem(entry.id);
      closeSheet();
      showToast("Idea removed");
    });
  }
}

function wireEvents(state) {
  document.getElementById("add-wish-btn")?.addEventListener("click", () => openWishSheet({}));
  mountEl.querySelectorAll("[data-open-wish]").forEach((el) => {
    el.addEventListener("click", () => openWishSheet({ entry: byId(state.wishlist, el.dataset.openWish) }));
  });
}

function mount(el) {
  mountEl = el;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount };
