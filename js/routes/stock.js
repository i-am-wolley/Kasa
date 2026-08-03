// Stock screen (memo §8.2) — unified across every room. Out · Low ·
// Expiring · OK. Primary action builds a shopping list; Kasa routes,
// it doesn't order (memo §7) — the list goes to the clipboard for the
// user to paste into WhatsApp, a quick-commerce app, whatever they use.

import { getState, subscribe, addItem, updateItem, deleteItem, adjustItemQty, byId } from "../state.js";
import { Icon } from "../ui/icons.js";
import { emptyState, stepper, field, textInput, catalogField, wireCatalogField, resolveCatalogField, chipGroup, readChipGroup, wireChipGroup, sheetActions, openSheet, closeSheet, showToast } from "../ui/components.js";

const UNITS = ["piece", "ml", "g", "kg", "pack", "roll", "litre"];
const EXPIRING_WITHIN_DAYS = 14;

let mountEl = null;
let unsubscribe = null;

const REORDER_LEAD_DAYS = 3;

function isExpiringSoon(item) {
  if (!item.expiryDate) return false;
  const days = (new Date(item.expiryDate) - new Date()) / 86400000;
  return days >= 0 && days <= EXPIRING_WITHIN_DAYS;
}

// Static projection from the optional consumption rate — "at this rate, how
// many days of stock are left" — not the memo §5.2 EWMA-learned burn rate
// (that's still Phase 5); this is a light, honest precursor using whatever
// rate the user (or the catalog default) gave it. null if no rate is set.
function projectedDaysLeft(item) {
  if (!item.burnRate || item.burnRate <= 0) return null;
  return Math.round(item.qty / item.burnRate);
}

function isProjectedSoon(item) {
  const days = projectedDaysLeft(item);
  return days !== null && days <= REORDER_LEAD_DAYS;
}

// A rate-based early warning can flag "low" before the raw quantity number
// crosses par level — memo §5.2's spirit, applied without the learning.
function bucketOf(item) {
  if (item.status === "out") return "out";
  if (isExpiringSoon(item)) return "expiring";
  if (item.status === "low" || isProjectedSoon(item)) return "low";
  return "ok";
}

function rowHtml(item, state) {
  const space = byId(state.spaces, item.spaceId);
  const daysLeft = projectedDaysLeft(item);
  const projectedNote = daysLeft !== null && item.status !== "out" ? ` · ~${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "";
  return `
    <div class="list-row" data-item-id="${item.id}">
      <div class="occ-row-icon">${Icon(item.icon || "stock", { size: 16 })}</div>
      <div class="occ-row-body" data-open-item="${item.id}">
        <div class="occ-row-title">${item.name}</div>
        <div class="occ-row-meta">${space?.name || ""}${item.expiryDate ? ` · expires ${item.expiryDate}` : ""}${projectedNote}</div>
      </div>
      ${stepper(item.qty, { dataAttrs: `data-item-stepper="${item.id}"` })}
    </div>
  `;
}

function sectionHtml(title, items, state) {
  if (!items.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">${title} (${items.length})</span></div>
      ${items.map((i) => rowHtml(i, state)).join("")}
    </div>
  `;
}

function render() {
  const state = getState();
  const buckets = { out: [], low: [], expiring: [], ok: [] };
  for (const item of state.items) buckets[bucketOf(item)].push(item);

  mountEl.innerHTML = `
    <div class="topbar">
      <h1>Stock</h1>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-tinted" id="add-item-btn">${Icon("plus", { size: 16 })} Item</button>
      </div>
    </div>
    <div class="today-section" style="padding-top:4px;">
      <button class="btn btn-solid" id="build-list-btn" style="width:100%;">${Icon("receipt", { size: 16 })} Build shopping list</button>
    </div>
    ${sectionHtml("Out", buckets.out, state)}
    ${sectionHtml("Low", buckets.low, state)}
    ${sectionHtml("Expiring", buckets.expiring, state)}
    ${sectionHtml("OK", buckets.ok, state)}
    ${!state.items.length ? emptyState({ message: "Nothing tracked yet.", actionLabel: null }) : ""}
  `;

  wireEvents(state);
}

function lastRestockedLabel(item) {
  if (!item.lastRestockedAt) return "No refill on record";
  const days = Math.round((Date.now() - new Date(item.lastRestockedAt)) / 86400000);
  if (days <= 0) return "Refilled today";
  return `Last refilled ${days} day${days === 1 ? "" : "s"} ago`;
}

function openItemSheet({ item = null, defaultSpaceId = null } = {}) {
  const state = getState();
  openSheet({
    title: item ? "Edit item" : "Add item",
    bodyHtml: `
      ${item ? `<p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-bottom:16px;">${lastRestockedLabel(item)}${projectedDaysLeft(item) !== null ? ` · ~${projectedDaysLeft(item)} days left at current rate` : ""}</p>` : ""}
      <form id="item-form">
        ${field("Name", catalogField({ id: "f-item-name", type: "item", value: item?.name ?? "", placeholder: "Start typing — e.g. Toilet cleaner" }))}
        ${field("Space", chipGroup({ name: "itemSpaceId", options: state.spaces.map((s) => ({ value: s.id, label: s.name })), value: item?.spaceId ?? defaultSpaceId ?? state.spaces[0]?.id }))}
        ${field("Unit", chipGroup({ name: "unit", options: UNITS, value: item?.unit ?? "piece" }))}
        ${field("Quantity", textInput({ id: "f-qty", type: "number", value: item?.qty ?? 1 }))}
        ${field("Reorder at (par level)", textInput({ id: "f-par", type: "number", value: item?.parLevel ?? 1 }))}
        ${field("Consumption rate — units/day (optional)", textInput({ id: "f-burnrate", type: "number", value: item?.burnRate || "", placeholder: "e.g. 0.05" }))}
        ${field("Expiry date (optional)", textInput({ id: "f-expiry", type: "date", value: item?.expiryDate ?? "" }))}
      </form>
      ${item?.catalogKey ? `<p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-bottom:8px;">Catalog key: <span class="font-num">${item.catalogKey}</span></p>` : ""}
      ${sheetActions({ saveLabel: item ? "Save changes" : "Add item", showDelete: !!item })}
    `,
  });
  const root = document.getElementById("sheet-root");
  ["itemSpaceId", "unit"].forEach((n) => wireChipGroup(root, n));

  const nameInput = root.querySelector("#f-item-name");
  if (item?.catalogKey) nameInput.dataset.catalogKey = item.catalogKey;

  wireCatalogField(root, "f-item-name", "item", {
    onSelect: (entry) => {
      // Only pre-fill from the catalog default when adding fresh — never
      // clobber a value the user is actively editing.
      if (item) return;
      const unitGroup = root.querySelector('[data-field="unit"]');
      unitGroup.querySelectorAll("[data-value]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === entry.unit)));
      if (entry.parLevel != null) root.querySelector("#f-par").value = entry.parLevel;
      if (entry.parLevel != null) root.querySelector("#f-qty").value = entry.parLevel;
      if (entry.defaultBurnRate != null) root.querySelector("#f-burnrate").value = entry.defaultBurnRate;
    },
  });

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const entry = resolveCatalogField(root, "f-item-name", "item");
    if (!entry) return;
    const qty = Number(root.querySelector("#f-qty").value) || 0;
    const parLevel = Number(root.querySelector("#f-par").value) || 1;
    const burnRate = Number(root.querySelector("#f-burnrate").value) || 0;
    const fields = {
      name: entry.name,
      catalogKey: entry.key,
      icon: entry.icon,
      spaceId: readChipGroup(root, "itemSpaceId"),
      unit: readChipGroup(root, "unit"),
      qty,
      parLevel,
      burnRate,
      expiryDate: root.querySelector("#f-expiry").value || null,
      status: qty <= 0 ? "out" : qty <= parLevel ? "low" : "ok",
    };
    if (item) updateItem(item.id, fields);
    else addItem(fields);
    closeSheet();
    showToast(item ? "Item updated" : "Item added");
  });

  if (item) {
    root.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm(`Remove "${item.name}" from Stock?`)) return;
      deleteItem(item.id);
      closeSheet();
      showToast("Item removed");
    });
  }
}

function buildShoppingList() {
  const state = getState();
  const needed = state.items.filter((i) => i.status === "out" || i.status === "low");
  if (!needed.length) {
    showToast("Nothing to reorder right now");
    return;
  }
  const text = needed.map((i) => `- ${i.name} (${byId(state.spaces, i.spaceId)?.name || ""})`).join("\n");
  navigator.clipboard?.writeText(text).then(
    () => showToast(`Shopping list copied — ${needed.length} item${needed.length === 1 ? "" : "s"}`),
    () => showToast("Couldn't copy — clipboard unavailable"),
  );
}

function wireEvents(state) {
  document.getElementById("add-item-btn")?.addEventListener("click", () => openItemSheet());
  document.getElementById("build-list-btn")?.addEventListener("click", buildShoppingList);

  mountEl.querySelectorAll("[data-open-item]").forEach((el) => {
    el.addEventListener("click", () => openItemSheet({ item: byId(state.items, el.dataset.openItem) }));
  });

  mountEl.querySelectorAll("[data-item-stepper]").forEach((stepperEl) => {
    const id = stepperEl.dataset.itemStepper;
    stepperEl.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        adjustItemQty(id, Number(btn.dataset.step));
      });
    });
  });
}

function mount(el) {
  mountEl = el;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount, openItemSheet };
