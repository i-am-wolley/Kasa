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

import { getState, subscribe, addWishlistItem, updateWishlistItem, deleteWishlistItem, genId, visibleSpaceIds, byId } from "../state.js";
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
// "asset"/"item" match the catalog-linked Buy flow into the real Assets/
// Stock sheets — labeled "Asset"/"Stock" (2026-08-10, user request: match
// terminology used across the rest of the app, where consumables are
// always "Stock," never "Items"). "items" is new the same round — a plain
// checklist entry with the exact same mechanics as "task" (free text, no
// catalog, Mark done) but a different label/meaning: a physical thing
// worth listing that isn't going through the real Stock/Assets system.
const SUBITEM_KINDS = [
  { value: "task", label: "Task" },
  { value: "items", label: "Items" },
  { value: "asset", label: "Asset" },
  { value: "item", label: "Stock" },
];

let mountEl = null;
let unsubscribe = null;

function formatCost(cost) {
  if (!cost) return "";
  return `₹${Number(cost).toLocaleString("en-IN")}`;
}

// Compact currency for the stat row's tight tiles (2026-08-10) — "₹12,000"
// or "₹1,25,000" comfortably fits a full-width Estimated cost field but not
// a quarter-width stat tile at phone width, so large values abbreviate to
// k/L (thousand/lakh, the Indian grouping this app already uses elsewhere).
function formatCostCompact(n) {
  if (!n) return "₹0";
  const round1 = (x) => Math.round(x * 10) / 10;
  if (n >= 100000) return `₹${round1(n / 100000)}L`;
  if (n >= 1000) return `₹${round1(n / 1000)}k`;
  return `₹${Math.round(n)}`;
}

// The four wishlist metrics, computed over the whole wishlist (the
// All/Projects/Assets/Stock type filter this originally respected was
// removed again the same day it shipped — see render()'s own comment).
// Reworked 2026-08-10 from an Ideas-total/
// Total-cost/Spent/%-complete set into two intuitive pairs instead: how
// many ideas are still open vs. already done (plain entry counts — "Ideas
// in progress" still means ideas, i.e. top-level entries, just re-scoped
// from "all" to "not yet acquired"), and how much money is left to spend
// vs. already spent. The cost pair still drills into each project's own
// checklist ("look inside each project as well," carried over from the
// original request) — a project WITH a checklist contributes each
// sub-item's own cost (not the project entry itself, which would double-
// count, since the project's own status is already derived from its
// checklist); a project with no checklist yet, or a plain asset/item
// entry, contributes its own `estimatedCost`. Cost is always recomputed
// from a project's raw subItems, never read off the entry's own
// `estimatedCost` — Round 42 changed that stored field to mean REMAINING
// cost, not total, so reusing it here would silently undercount any
// project with something already checked off.
function computeWishMetrics(entries) {
  let totalCost = 0, spentCost = 0, ideasInProgress = 0, ideasCompleted = 0;
  for (const w of entries) {
    if (w.status === "acquired") ideasCompleted += 1;
    else ideasInProgress += 1;
    if (w.type === "project" && w.subItems?.length) {
      for (const s of w.subItems) {
        totalCost += s.cost || 0;
        if (s.done) spentCost += s.cost || 0;
      }
    } else {
      const cost = w.estimatedCost || 0;
      totalCost += cost;
      if (w.status === "acquired") spentCost += cost;
    }
  }
  return { ideasInProgress, ideasCompleted, costRemaining: totalCost - spentCost, costCompleted: spentCost };
}

// Single-line at every width (2026-08-10, user request: "let it be in a
// single line even on mobile so build the size accordingly") — reuses
// Today's .stat-row/.stat-tile shapes with a scoped .wish-stat-row override
// (app.css) that tightens sizing enough for 4 tiles to fit one row on a
// phone, rather than the 2/3-column-then-wrap layout Today's own 5-tile
// row uses. Labels are the fuller, more descriptive names as directly
// requested ("Ideas in progress," not a truncated "In progress") — the
// tile-label font is small enough (and free to wrap to 2 lines within its
// own tile) that the longer text fits without pushing the row itself onto
// a second line.
// Tone washes each tile's own background, not just the number (2026-08-11,
// user follow-up: "more pronounced... but keeping it premium and
// soothing") — "in progress" numbers get the same amber "still to do" tone
// Today's own stat row uses, "completed" numbers get --done green, same
// soft color-mix technique throughout the app.
function wishStatRowHtml(entries) {
  const { ideasInProgress, ideasCompleted, costRemaining, costCompleted } = computeWishMetrics(entries);
  const tile = (value, label, tone) => `
    <div class="stat-tile" style="${tone ? `background:color-mix(in srgb, ${tone} 8%, var(--surface));border-color:color-mix(in srgb, ${tone} 24%, var(--line));` : ""}">
      <div class="stat-tile-value" style="${tone ? `color:${tone};` : ""}">${value}</div>
      <div class="stat-tile-label">${label}</div>
    </div>`;
  return `
    <div class="stat-row wish-stat-row">
      ${tile(ideasInProgress, "Ideas in progress", ideasInProgress ? "var(--amber)" : null)}
      ${tile(ideasCompleted, "Completed", ideasCompleted ? "var(--done)" : null)}
      ${tile(formatCostCompact(costRemaining), "Cost remaining", costRemaining ? "var(--amber)" : null)}
      ${tile(formatCostCompact(costCompleted), "Cost of completed", costCompleted ? "var(--done)" : null)}
    </div>
  `;
}

// Sum of every NOT-YET-DONE checklist sub-item's own cost — a project's
// Estimated cost is what's still left to spend, not the original total
// (2026-08-10, user request: "when something is completed inside the
// project, the total cost to be subtracted... from the estimated cost").
// Marking an item done drops its cost out of this sum immediately, since
// syncCostField()/persistSubItems() re-run it on every toggle.
function sumSubItemCosts(subItems) {
  return subItems.reduce((sum, s) => sum + (s.done ? 0 : (s.cost || 0)), 0);
}

// Footer is two centered halves on one line — cost bottom-left, checklist
// progress bottom-right (2026-08-04, user request: drop the redundant
// Soon/Someday label from the tile since the section header above it
// already says that; show cost + task count instead). The count side
// shows "—" rather than going blank when there's no checklist (2026-08-05,
// user request) — a visible "not applicable" beats an unexplained gap.
function tileFootHtml(entry) {
  const subs = entry.subItems || [];
  const cost = entry.estimatedCost ? formatCost(entry.estimatedCost) : "";
  const count = subs.length ? `${subs.filter((s) => s.done).length}/${subs.length}` : "—";
  return `<div class="tile-foot"><span>${cost}</span><span>${count}</span></div>`;
}

function tileHtml(entry) {
  const isAcquired = entry.status === "acquired";
  return `
    <div class="tile" data-open-wish="${entry.id}" style="opacity:${isAcquired ? 0.55 : 1};">
      <div class="tile-icon">${Icon(entry.icon || "wishlist", { size: 16 })}</div>
      <div class="tile-title">${entry.title}</div>
      ${isAcquired ? `<div class="tile-meta">${entry.type === "project" ? "Done" : "Acquired"}</div>` : tileFootHtml(entry)}
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

// The All/Projects/Assets/Stock type filter (Round 42) was removed again
// the same day it shipped (2026-08-10, direct follow-up) — back to always
// showing everything, grouped by priority as before.
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
    ${state.wishlist.length ? wishStatRowHtml(state.wishlist) : ""}
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

// The checklist's own "add item" name field gets the same catalog
// typeahead as everywhere else when its kind is asset/item (2026-08-04,
// user request: "i want the assets and items... to come when i type
// similar to other places") — a plain task doesn't have a catalog to
// search, so it stays a bare text input.
function subitemNameFieldHtml(kind, value) {
  if (kind === "task" || kind === "items") {
    return textInput({ id: "f-new-subitem", value, placeholder: kind === "items" ? "e.g. Curtains" : "e.g. Get quotes from painters" });
  }
  return catalogField({
    id: "f-new-subitem", type: kind, value,
    placeholder: kind === "item" ? "Start typing — e.g. Detergent" : "Start typing — e.g. Floor lamp",
  });
}

// Takes the plain array directly, not an entry (2026-08-10 — the checklist
// now works before a project has even been saved, see openWishSheet's
// `subItems` local, so there isn't always an `entry` to read it from).
// Tapping a row's title/meta area (not its Mark-done/Buy/Undo or delete
// buttons) opens a dedicated full-screen edit sheet for that one item —
// title+cost inline in the cramped list row was tried first and reverted
// (2026-08-10, user report: "difficult to edit in mobile... bring a modal
// when clicked as separate screen then go back") — see openSubItemEditSheet.
function subItemsChecklistHtml(subs) {
  if (!subs.length) return `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">No checklist items yet — add one below.</p>`;
  const doneCount = subs.filter((s) => s.done).length;
  return `
    <p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-bottom:8px;">${doneCount}/${subs.length} done</p>
    ${subs
      .map(
        (s) => `
      <div class="list-row" style="margin-bottom:6px;opacity:${s.done ? 0.55 : 1};">
        <div class="occ-row-icon">${Icon(s.icon || (s.kind === "task" || s.kind === "items" ? "check" : s.kind === "asset" ? "warranty" : "stock"), { size: 14 })}</div>
        <div class="occ-row-body" data-edit-subitem="${s.id}" style="cursor:pointer;">
          <div class="occ-row-title">${s.title}</div>
          <div class="occ-row-meta">${s.kind === "task" ? "Task" : s.kind === "items" ? "Items" : s.kind === "asset" ? "Asset" : "Stock"}</div>
        </div>
        ${s.cost ? `<span style="font-size:var(--fs-micro);color:var(--ink-muted);white-space:nowrap;margin-right:2px;">${formatCost(s.cost)}</span>` : ""}
        <button type="button" class="chip" data-toggle-subitem="${s.id}" aria-pressed="${s.done}">${s.done ? "Undo" : s.kind === "task" || s.kind === "items" ? "Mark done" : "Buy"}</button>
        <button type="button" class="stepper-btn" data-delete-subitem="${s.id}">${Icon("trash", { size: 12 })}</button>
      </div>`,
      )
      .join("")}
  `;
}

// Sorted by house name first, then space name alphabetically within each
// house, with a house-name hint on the chip when more than one house is
// active — same pattern already used in routine.js/stock.js/assets.js
// (2026-08-09, user report: wishlist's own Space field was neither tagged
// nor sorted, just `state.spaces` in raw insertion order).
function wishSpaceOptions(state, currentSpaceId) {
  const visible = visibleSpaceIds(state);
  const multiHouse = state.houses.length > 1;
  return [...state.spaces.filter((s) => visible.has(s.id) || s.id === currentSpaceId)]
    .sort((a, b) => {
      const houseA = byId(state.houses, a.houseId)?.name || "";
      const houseB = byId(state.houses, b.houseId)?.name || "";
      if (multiHouse && houseA !== houseB) return houseA.localeCompare(houseB);
      return a.name.localeCompare(b.name);
    })
    .map((s) => {
      const houseName = multiHouse ? byId(state.houses, s.houseId)?.name : null;
      return { value: s.id, label: houseName ? `${s.name}<span class="chip-house-hint">${houseName}</span>` : s.name };
    });
}

// `draft` carries a project add-form's in-progress field values across a
// round trip through the real Assets/Stock add sheet (2026-08-10, user
// request: the checklist — and now its Add-item controls — should work
// while ADDING a new project, not only once it already exists to edit).
// Opening that nested sheet fully replaces sheet-root, so anything typed
// into this form so far (title, space, priority, notes, the checklist
// itself) would otherwise be lost the moment it closes; `draft` is a plain
// snapshot of those fields, captured right before the nested sheet opens,
// used to rebuild this same in-progress Add form instead of starting over.
function openWishSheet({ entry = null, defaultSpaceId = null, draft = null } = {}) {
  const state = getState();
  // `draft.type` (when present) wins over `entry.type` — it means the
  // Type chip was just switched mid-edit (see the wishType click handler
  // below) and should take effect immediately rather than reverting to
  // whatever the persisted entry still says. Falls back to "project" for
  // the older draft shape (the nested Assets/Stock-sheet round trip below
  // never sets `type`, since it only ever hands off from a project's own
  // checklist).
  const initialType = draft?.type ?? entry?.type ?? (draft ? "project" : "asset");
  const isProject = initialType === "project";
  // The one working set of checklist items regardless of add vs. edit mode
  // — seeded from whichever of entry/draft actually has them, `[]` for a
  // genuinely brand-new project. Reassigned (not just mutated) by the
  // delete-subitem handler below, so `let`, not `const`.
  let subItems = entry?.subItems ? [...entry.subItems] : draft?.subItems ? [...draft.subItems] : [];
  openSheet({
    title: entry ? "Edit idea" : "Add idea",
    bodyHtml: `
      <form id="wish-form">
        ${field("Type", chipGroup({ name: "wishType", options: TYPES, value: initialType }))}
        <div id="catalog-name-wrap" style="display:${isProject ? "none" : "block"};">
          ${catalogNameFieldHtml(initialType === "item" ? "item" : "asset", !isProject ? (entry?.title ?? "") : "")}
        </div>
        <div id="plain-name-wrap" style="display:${isProject ? "block" : "none"};">
          ${field("Title", textInput({ id: "f-wish-title", value: isProject ? (draft?.title ?? entry?.title ?? "") : "", placeholder: "e.g. Repaint living room walls" }))}
        </div>
        ${field("Space (optional)", chipGroup({ name: "wishSpaceId", options: wishSpaceOptions(state, entry?.spaceId ?? draft?.spaceId), value: entry?.spaceId ?? draft?.spaceId ?? defaultSpaceId ?? null }))}
        ${field("Priority", chipGroup({ name: "wishPriority", options: PRIORITIES, value: entry?.priority ?? draft?.priority ?? "someday" }))}
        ${field(
          subItems.length ? "Estimated cost (remaining, sum of unchecked items)" : "Estimated cost (optional)",
          textInput({ id: "f-wish-cost", type: "number", value: subItems.length ? sumSubItemCosts(subItems) : (entry?.estimatedCost ?? ""), placeholder: "e.g. 12000", min: 0 }),
        )}
        ${field("Notes (optional)", textInput({ id: "f-wish-notes", value: draft?.notes ?? entry?.notes ?? "", placeholder: "Why, or what to look for" }))}
      </form>
      ${isProject ? `
        <div class="field">
          <span class="field-label">Checklist — complete when everything here is done</span>
          <div id="subitems-list">${subItemsChecklistHtml(subItems)}</div>
          <div style="margin-top:8px;">
            ${chipGroup({ name: "newSubKind", options: SUBITEM_KINDS, value: "task" })}
            <div style="display:flex;gap:8px;margin-top:8px;align-items:flex-start;">
              <div id="subitem-name-wrap" style="flex:1;position:relative;">${subitemNameFieldHtml("task", "")}</div>
              <div style="width:88px;flex:none;">${textInput({ id: "f-subitem-cost", type: "number", placeholder: "₹ cost", min: 0 })}</div>
              <button type="button" class="btn btn-ghost" id="add-subitem-btn">Add</button>
            </div>
          </div>
        </div>
      ` : ""}
      ${sheetActions({ saveLabel: entry ? "Save changes" : "Add idea", showDelete: !!entry })}
      ${entry && entry.status !== "acquired" && !(isProject && subItems.length) ? `<button type="button" class="btn btn-accent" id="mark-acquired-btn" style="width:100%;margin-top:8px;">${Icon("check", { size: 14 })} ${entry.type === "project" ? "Mark done" : "Mark acquired"}</button>` : ""}
    `,
  });
  const root = document.getElementById("sheet-root");
  ["wishType", "wishSpaceId", "wishPriority"].forEach((n) => wireChipGroup(root, n));

  let currentSubKind = "task";
  function wireSubitemNameField() {
    if (currentSubKind === "task" || currentSubKind === "items") return;
    wireCatalogField(root, "f-new-subitem", currentSubKind);
  }
  if (isProject) {
    wireChipGroup(root, "newSubKind");
    root.querySelectorAll('[data-field="newSubKind"] [data-value]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.value;
        if (kind === currentSubKind) return;
        currentSubKind = kind;
        root.querySelector("#subitem-name-wrap").innerHTML = subitemNameFieldHtml(kind, "");
        wireSubitemNameField();
      });
    });
  }

  let currentCatalogType = initialType === "item" ? "item" : "asset";
  function wireNameCatalog() {
    wireCatalogField(root, "f-wish-name", currentCatalogType);
  }
  if (!isProject) wireNameCatalog();

  root.querySelectorAll('[data-field="wishType"] [data-value]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.value;
      // Switching in or out of "project" reopens the sheet with the
      // current field values carried over as a draft (2026-08-10, real
      // bug found live: clicking the Project chip on a fresh "Add idea"
      // sheet — default type "asset" — never revealed the checklist. Its
      // markup only exists in this sheet's initial bodyHtml when isProject
      // was already true at OPEN time, so there was nothing in the DOM for
      // this handler to reveal). A full re-render is simpler and more
      // consistent with the draft-preservation mechanism already used for
      // the nested Assets/Stock sheet round trip than teaching this
      // handler to inject and wire the checklist's markup in place.
      if ((type === "project") !== isProject) {
        openWishSheet({
          entry,
          defaultSpaceId,
          draft: {
            type,
            title: isProject ? (root.querySelector("#f-wish-title")?.value ?? "") : "",
            spaceId: readChipGroup(root, "wishSpaceId"),
            priority: readChipGroup(root, "wishPriority"),
            notes: root.querySelector("#f-wish-notes")?.value ?? "",
            subItems: isProject ? subItems : [],
          },
        });
        return;
      }
      const catalogWrap = root.querySelector("#catalog-name-wrap");
      const plainWrap = root.querySelector("#plain-name-wrap");
      // Below here isProject never actually changed (a redundant reclick of
      // the already-selected type, or an asset<->item switch — neither is a
      // project transition) — restore the plain type-based show/hide rather
      // than assuming "not a transition" means "must be catalog-backed."
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

  // ---- Project checklist — now wired for a brand-new project too
  // (2026-08-10, user request: "when I add a project itself I want the add
  // items, asset, task to come in the modal, currently it only comes in
  // edit"). `subItems` (declared above, in the outer openWishSheet scope)
  // is the one working set either way; the only real difference is WHEN it
  // gets persisted — immediately, for an existing entry, or bundled into
  // the initial addWishlistItem() call once "Add idea" is actually clicked.
  if (isProject) {
    // Captures this in-progress Add form's current field values — used
    // right before handing off to the real Assets/Stock add sheet below,
    // so returning from it can rebuild the same in-progress form instead
    // of losing everything typed so far (see openWishSheet's own `draft`
    // param comment).
    function currentDraft() {
      return {
        title: root.querySelector("#f-wish-title")?.value ?? "",
        spaceId: readChipGroup(root, "wishSpaceId"),
        priority: readChipGroup(root, "wishPriority"),
        notes: root.querySelector("#f-wish-notes")?.value ?? "",
        subItems: [...subItems],
      };
    }

    // Keeps the Estimated cost field showing the live checklist sum
    // (2026-08-10, user request: cost "automatically sums to the total of
    // the project cost") — read-only once there's anything to sum, so it
    // can't drift out of sync with a manually-typed number.
    function syncCostField() {
      const costInput = root.querySelector("#f-wish-cost");
      if (!costInput) return;
      if (subItems.length) {
        costInput.value = sumSubItemCosts(subItems);
        costInput.readOnly = true;
      } else {
        costInput.readOnly = false;
      }
    }

    function persistSubItems() {
      syncCostField();
      if (!entry) return; // add-mode: nothing to persist until "Add idea" is clicked — see the save handler below
      const allDone = subItems.length > 0 && subItems.every((s) => s.done);
      const patch = { subItems, estimatedCost: subItems.length ? sumSubItemCosts(subItems) : entry.estimatedCost };
      if (allDone && entry.status !== "acquired") {
        patch.status = "acquired";
        patch.acquiredAt = new Date().toISOString();
      } else if (!allDone && entry.status === "acquired") {
        // Undoing a sub-item after the project auto-completed reopens it
        // (2026-08-04, user request: accidental taps need a way back).
        patch.status = "idea";
        patch.acquiredAt = null;
      }
      updateWishlistItem(entry.id, patch);
      Object.assign(entry, patch);
      // The manual "Mark done" button was computed once at sheet-open time,
      // so adding the first checklist item after opening left it visibly
      // stale — completion should only ever come from the checklist once
      // one exists.
      const acquireBtn = root.querySelector("#mark-acquired-btn");
      if (acquireBtn) acquireBtn.style.display = subItems.length ? "none" : "block";
    }

    // A dedicated full-screen sheet for editing one checklist item's title
    // and cost (2026-08-10, user request — an inline edit tried first in
    // this same session was reverted: "the edit is difficult... bring a
    // modal when clicked as separate screen then go back, as its difficult
    // to edit in mobile"). Same draft-snapshot-before-nesting technique
    // already used for the "Buy" hand-off below — a brand-new project isn't
    // saved yet, so returning has to rebuild the same in-progress Add form,
    // not just closeSheet() back to nothing.
    function openSubItemEditSheet(sub) {
      const draftSnapshot = entry ? null : currentDraft();
      const returnToProjectSheet = () => {
        if (entry) openWishSheet({ entry: byId(getState().wishlist, entry.id) });
        else openWishSheet({ draft: { ...draftSnapshot, subItems } });
      };
      openSheet({
        title: "Edit checklist item",
        bodyHtml: `
          <form id="subitem-edit-form">
            ${field("Title", textInput({ id: "f-subitem-edit-title", value: sub.title }))}
            ${field("Cost (optional)", textInput({ id: "f-subitem-edit-cost", type: "number", value: sub.cost || "", placeholder: "e.g. 500", min: 0 }))}
          </form>
          ${sheetActions({ saveLabel: "Save", showDelete: true })}
        `,
      });
      const editRoot = document.getElementById("sheet-root");
      // openSheet() already wires the generic Cancel button to closeSheet()
      // — this second listener runs right after it (both fire), landing
      // back on the project sheet instead of closing everything and losing
      // it. Tapping the backdrop still fully closes, same as every sheet in
      // the app (openSheet()'s own generic behavior, not overridden here) —
      // the same limitation already exists for the nested "Buy" hand-off
      // below, so this isn't a new gap, just not a place worth diverging
      // from how every other sheet in Kasa already behaves.
      editRoot.querySelector('[data-action="cancel"]').addEventListener("click", returnToProjectSheet);
      editRoot.querySelector('[data-action="delete"]').addEventListener("click", () => {
        subItems = subItems.filter((s) => s.id !== sub.id);
        persistSubItems();
        returnToProjectSheet();
      });
      editRoot.querySelector('[data-action="save"]').addEventListener("click", () => {
        const title = editRoot.querySelector("#f-subitem-edit-title").value.trim();
        if (!title) { showToast("Enter a title"); return; }
        sub.title = title;
        sub.cost = Math.max(0, Number(editRoot.querySelector("#f-subitem-edit-cost").value) || 0);
        persistSubItems();
        returnToProjectSheet();
      });
    }

    function rewireSubItems() {
      root.querySelector("#subitems-list").innerHTML = subItemsChecklistHtml(subItems);
      root.querySelectorAll("[data-edit-subitem]").forEach((el) => {
        el.addEventListener("click", () => {
          const sub = subItems.find((s) => s.id === el.dataset.editSubitem);
          if (sub) openSubItemEditSheet(sub);
        });
      });
      root.querySelectorAll("[data-toggle-subitem]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sub = subItems.find((s) => s.id === btn.dataset.toggleSubitem);
          if (!sub) return;
          if (sub.done) {
            // Undo — protects against an accidental tap (2026-08-04, user
            // request). Only reverts the checklist's own done flag; an
            // asset/item sub-item's already-created real Stock/Assets
            // record (if any) is left alone, not deleted.
            sub.done = false;
            persistSubItems();
            rewireSubItems();
            return;
          }
          if (sub.kind === "task" || sub.kind === "items") {
            sub.done = true;
            persistSubItems();
            rewireSubItems();
            return;
          }
          // Asset/item sub-item — hand off to the real Assets/Stock add
          // sheet for full detail collection, then come back to this
          // checklist once it's saved. Capture a draft BEFORE opening it
          // if this project hasn't been saved yet — openSheet() is about
          // to replace sheet-root out from under this form entirely.
          const draftSnapshot = entry ? null : currentDraft();
          const openFn = sub.kind === "asset" ? openAssetSheet : openItemSheet;
          openFn({
            defaultName: sub.title,
            defaultSpaceId: entry?.spaceId ?? draftSnapshot?.spaceId,
            onSaved: (record) => {
              sub.done = true;
              sub.createdId = record?.id || null;
              if (entry) {
                persistSubItems();
                openWishSheet({ entry: byId(getState().wishlist, entry.id) });
              } else {
                openWishSheet({ draft: { ...draftSnapshot, subItems } });
              }
            },
          });
        });
      });
      root.querySelectorAll("[data-delete-subitem]").forEach((btn) => {
        btn.addEventListener("click", () => {
          subItems = subItems.filter((s) => s.id !== btn.dataset.deleteSubitem);
          persistSubItems();
          rewireSubItems();
        });
      });
    }
    // Wires the checklist rows already baked into this sheet's initial
    // bodyHtml. Previously only called from inside "Add" below, so any
    // pre-existing sub-item's Mark done/Buy/delete buttons were dead on
    // arrival until a new one was added first in the same sheet session —
    // the actual cause of "can't mark done or bought" (2026-08-04 bug
    // report), not a mobile-specific issue, just harder to notice on
    // desktop while actively adding items during testing.
    rewireSubItems();
    syncCostField();

    root.querySelector("#add-subitem-btn").addEventListener("click", () => {
      const kind = readChipGroup(root, "newSubKind") || "task";
      let title, catalogKey, icon;
      if (kind === "task" || kind === "items") {
        title = root.querySelector("#f-new-subitem").value.trim();
        if (!title) return;
        catalogKey = null;
        icon = null;
      } else {
        const resolved = resolveCatalogField(root, "f-new-subitem", kind);
        if (!resolved) return;
        title = resolved.name;
        catalogKey = resolved.key;
        icon = resolved.icon;
      }
      const cost = Math.max(0, Number(root.querySelector("#f-subitem-cost").value) || 0);
      subItems.push({ id: genId("wlsub"), title, kind, catalogKey, icon, done: false, createdId: null, cost });
      persistSubItems();
      root.querySelector("#subitem-name-wrap").innerHTML = subitemNameFieldHtml(currentSubKind, "");
      root.querySelector("#f-subitem-cost").value = "";
      wireSubitemNameField();
      rewireSubItems();
    });
  }

  // Reads + validates the form's current field values — shared by "Save
  // changes" AND "Mark acquired" below. Bug found and fixed (2026-08-09,
  // caught during a live simulation pass): "Mark acquired" checked the
  // closed-over `entry.spaceId` — the value from when the sheet first
  // opened — instead of whatever the user had just picked in the Space
  // chip-group on screen. Picking a space and immediately clicking "Mark
  // acquired" (the natural flow — nothing suggests you need to hit "Save
  // changes" first) silently failed the "pick a space first" check even
  // though a space was clearly selected right there in the form. Returns
  // null if the form doesn't validate (having already returned early, same
  // as before).
  function readWishFields() {
    const type = readChipGroup(root, "wishType") || "asset";
    let title, catalogKey, icon;
    if (type === "project") {
      title = root.querySelector("#f-wish-title").value.trim();
      if (!title) return null;
      catalogKey = null;
      icon = "wishlist";
    } else {
      const resolved = resolveCatalogField(root, "f-wish-name", type);
      if (!resolved) return null;
      title = resolved.name;
      catalogKey = resolved.key;
      icon = resolved.icon;
    }
    return {
      title, type, catalogKey, icon,
      spaceId: readChipGroup(root, "wishSpaceId"),
      priority: readChipGroup(root, "wishPriority") || "someday",
      estimatedCost: Math.max(0, Number(root.querySelector("#f-wish-cost").value) || 0) || null,
      notes: root.querySelector("#f-wish-notes").value.trim(),
      // Bundled in here (not just persisted incrementally as each sub-item
      // changes) so a brand-new project's checklist — built entirely before
      // this entry exists at all — actually gets saved on first "Add idea".
      ...(type === "project" ? { subItems } : {}),
    };
  }

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const fields = readWishFields();
    if (!fields) return;
    // A project whose checklist was fully finished before ever hitting
    // "Add idea" (e.g. every sub-item was a plain task, checked off during
    // the add flow) should land already-acquired, same as persistSubItems
    // already does for an existing entry.
    if (fields.type === "project" && fields.subItems?.length && fields.subItems.every((s) => s.done)) {
      fields.status = "acquired";
      fields.acquiredAt = new Date().toISOString();
    }
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
    // Save whatever's currently in the form first, so a space picked (or
    // any other field changed) just before clicking this isn't lost.
    const fields = readWishFields();
    if (!fields) return;
    updateWishlistItem(entry.id, fields);
    if (!fields.spaceId) {
      showToast("Pick a space first so this can be added there");
      return;
    }
    const openFn = fields.type === "asset" ? openAssetSheet : openItemSheet;
    openFn({
      defaultName: fields.title,
      defaultSpaceId: fields.spaceId,
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
