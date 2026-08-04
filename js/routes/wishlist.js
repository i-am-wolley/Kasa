// Wishlist screen (2026-08-04, user request) — "an area for a household to
// improve their ways of life, or elevate their life." Three entry types:
// - "asset": a durable thing to buy, catalog-linked (js/catalog.js) same as
//   Assets' own add flow.
// - "item": a stock upgrade/change, same catalog link.
// - "project": a bigger one-off with no single catalog entry (repaint a
//   room, re-tile a bathroom) — free-text title, optionally broken into a
//   checklist of sub-items (2026-08-04 follow-up): plain tasks, or
//   asset/item purchases. Checking an asset/item sub-item opens the real
//   Assets/Stock add sheet — the same full detail-collection modal those
//   screens always use, not a bare-bones create — so a project purchase
//   gets properly onboarded (brand, warranty, service interval, etc.), not
//   just a name and a checkbox. A project auto-completes once every
//   sub-item is done.
// Deliberately NOT recurring (that's Routines/Habits) and not itself a
// purchase record (that's Assets/Stock once acquired) — this is the
// staging area before an idea becomes real.

import { getState, subscribe, addWishlistItem, updateWishlistItem, deleteWishlistItem, genId, byId } from "../state.js";
import { Icon } from "../ui/icons.js";
import { emptyState, field, textInput, catalogField, wireCatalogField, resolveCatalogField, chipGroup, readChipGroup, wireChipGroup, sheetActions, openSheet, closeSheet, showToast } from "../ui/components.js";
import { openAssetSheet } from "./assets.js";
import { openItemSheet } from "./stock.js";

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
const SUBITEM_KINDS = [
  { value: "task", label: "Task" },
  { value: "asset", label: "Asset to buy" },
  { value: "item", label: "Item to buy" },
];
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.label]));

let mountEl = null;
let unsubscribe = null;

function formatCost(cost) {
  if (!cost) return "";
  return `₹${Number(cost).toLocaleString("en-IN")}`;
}

function tileHtml(entry) {
  const subs = entry.subItems || [];
  const meta = entry.status === "acquired"
    ? (entry.type === "project" ? "Done" : "Acquired")
    : subs.length
      ? `${subs.filter((s) => s.done).length}/${subs.length} done`
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

function subItemsChecklistHtml(entry) {
  const subs = entry.subItems || [];
  if (!subs.length) return `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">No checklist items yet — add one below.</p>`;
  const doneCount = subs.filter((s) => s.done).length;
  return `
    <p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-bottom:8px;">${doneCount}/${subs.length} done</p>
    ${subs
      .map(
        (s) => `
      <div class="list-row" style="margin-bottom:6px;opacity:${s.done ? 0.55 : 1};">
        <div class="occ-row-icon">${Icon(s.kind === "task" ? "check" : s.kind === "asset" ? "warranty" : "stock", { size: 14 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title">${s.title}</div>
          <div class="occ-row-meta">${s.kind === "task" ? "Task" : s.kind === "asset" ? "Asset to buy" : "Item to buy"}</div>
        </div>
        <button type="button" class="chip" data-toggle-subitem="${s.id}" aria-pressed="${s.done}" ${s.done ? "disabled" : ""}>${s.done ? "Done" : s.kind === "task" ? "Mark done" : "Buy"}</button>
        <button type="button" class="stepper-btn" data-delete-subitem="${s.id}">${Icon("trash", { size: 12 })}</button>
      </div>`,
      )
      .join("")}
  `;
}

function openWishSheet({ entry = null, defaultSpaceId = null } = {}) {
  const state = getState();
  const initialType = entry?.type ?? "asset";
  const isProject = initialType === "project";
  const hasSubItems = !!entry?.subItems?.length;
  openSheet({
    title: entry ? "Edit idea" : "Add idea",
    bodyHtml: `
      <form id="wish-form">
        ${field("Type", chipGroup({ name: "wishType", options: TYPES, value: initialType }))}
        <div id="catalog-name-wrap" style="display:${isProject ? "none" : "block"};">
          ${catalogNameFieldHtml(initialType === "item" ? "item" : "asset", !isProject ? (entry?.title ?? "") : "")}
        </div>
        <div id="plain-name-wrap" style="display:${isProject ? "block" : "none"};">
          ${field("Title", textInput({ id: "f-wish-title", value: isProject ? (entry?.title ?? "") : "", placeholder: "e.g. Repaint living room walls" }))}
        </div>
        ${field("Space (optional)", chipGroup({ name: "wishSpaceId", options: state.spaces.map((s) => ({ value: s.id, label: s.name })), value: entry?.spaceId ?? defaultSpaceId ?? null }))}
        ${field("Priority", chipGroup({ name: "wishPriority", options: PRIORITIES, value: entry?.priority ?? "someday" }))}
        ${field("Estimated cost (optional)", textInput({ id: "f-wish-cost", type: "number", value: entry?.estimatedCost ?? "", placeholder: "e.g. 12000", min: 0 }))}
        ${field("Notes (optional)", textInput({ id: "f-wish-notes", value: entry?.notes ?? "", placeholder: "Why, or what to look for" }))}
      </form>
      ${entry && isProject ? `
        <div class="field">
          <span class="field-label">Checklist — complete when everything here is done</span>
          <div id="subitems-list">${subItemsChecklistHtml(entry)}</div>
          <div style="margin-top:8px;">
            ${chipGroup({ name: "newSubKind", options: SUBITEM_KINDS, value: "task" })}
            <div style="display:flex;gap:8px;margin-top:8px;">
              <div style="flex:1;">${textInput({ id: "f-new-subitem", placeholder: "e.g. Get quotes from painters" })}</div>
              <button type="button" class="btn btn-ghost" id="add-subitem-btn">Add</button>
            </div>
          </div>
        </div>
      ` : ""}
      ${sheetActions({ saveLabel: entry ? "Save changes" : "Add idea", showDelete: !!entry })}
      ${entry && entry.status !== "acquired" && !(isProject && hasSubItems) ? `<button type="button" class="btn btn-accent" id="mark-acquired-btn" style="width:100%;margin-top:8px;">${Icon("check", { size: 14 })} ${entry.type === "project" ? "Mark done" : "Mark acquired"}</button>` : ""}
    `,
  });
  const root = document.getElementById("sheet-root");
  ["wishType", "wishSpaceId", "wishPriority"].forEach((n) => wireChipGroup(root, n));
  if (entry && isProject) wireChipGroup(root, "newSubKind");

  let currentCatalogType = initialType === "item" ? "item" : "asset";
  function wireNameCatalog() {
    wireCatalogField(root, "f-wish-name", currentCatalogType);
  }
  if (!isProject) wireNameCatalog();

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

  // ---- Project checklist — only wired when editing an existing project;
  // a brand-new entry needs to exist first before sub-items can attach.
  if (entry && isProject) {
    function persistSubItems() {
      const allDone = entry.subItems.length > 0 && entry.subItems.every((s) => s.done);
      const patch = { subItems: entry.subItems };
      if (allDone && entry.status !== "acquired") {
        patch.status = "acquired";
        patch.acquiredAt = new Date().toISOString();
      }
      updateWishlistItem(entry.id, patch);
      Object.assign(entry, patch);
      // The manual "Mark done" button was computed once at sheet-open time
      // (hasSubItems), so adding the first checklist item after opening
      // left it visibly stale — completion should only ever come from the
      // checklist once one exists.
      const acquireBtn = root.querySelector("#mark-acquired-btn");
      if (acquireBtn) acquireBtn.style.display = entry.subItems.length ? "none" : "block";
    }

    function rewireSubItems() {
      root.querySelector("#subitems-list").innerHTML = subItemsChecklistHtml(entry);
      root.querySelectorAll("[data-toggle-subitem]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sub = entry.subItems.find((s) => s.id === btn.dataset.toggleSubitem);
          if (!sub || sub.done) return;
          if (sub.kind === "task") {
            sub.done = true;
            persistSubItems();
            rewireSubItems();
            return;
          }
          // Asset/item sub-item — hand off to the real Assets/Stock add
          // sheet for full detail collection, then come back to this
          // checklist once it's saved.
          const openFn = sub.kind === "asset" ? openAssetSheet : openItemSheet;
          openFn({
            defaultName: sub.title,
            defaultSpaceId: entry.spaceId,
            onSaved: (record) => {
              sub.done = true;
              sub.createdId = record?.id || null;
              persistSubItems();
              openWishSheet({ entry: byId(getState().wishlist, entry.id) });
            },
          });
        });
      });
      root.querySelectorAll("[data-delete-subitem]").forEach((btn) => {
        btn.addEventListener("click", () => {
          entry.subItems = entry.subItems.filter((s) => s.id !== btn.dataset.deleteSubitem);
          persistSubItems();
          rewireSubItems();
        });
      });
    }

    root.querySelector("#add-subitem-btn").addEventListener("click", () => {
      const input = root.querySelector("#f-new-subitem");
      const title = input.value.trim();
      if (!title) return;
      const kind = readChipGroup(root, "newSubKind") || "task";
      entry.subItems = [...(entry.subItems || []), { id: genId("wlsub"), title, kind, done: false, createdId: null }];
      persistSubItems();
      input.value = "";
      rewireSubItems();
    });
  }

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

  // Acquiring now opens the real Assets/Stock add sheet — the same full
  // detail-collection modal those screens always use — instead of a bare
  // create, so an acquired idea is properly onboarded (2026-08-04, user
  // request), same as a project's asset/item sub-items above.
  root.querySelector("#mark-acquired-btn")?.addEventListener("click", () => {
    if (entry.type === "project") {
      updateWishlistItem(entry.id, { status: "acquired", acquiredAt: new Date().toISOString() });
      closeSheet();
      showToast("Marked done");
      return;
    }
    if (!entry.spaceId) {
      showToast("Pick a space first so this can be added there");
      return;
    }
    const openFn = entry.type === "asset" ? openAssetSheet : openItemSheet;
    openFn({
      defaultName: entry.title,
      defaultSpaceId: entry.spaceId,
      onSaved: () => {
        updateWishlistItem(entry.id, { status: "acquired", acquiredAt: new Date().toISOString() });
      },
    });
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
