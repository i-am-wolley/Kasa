// Stock screen (memo §8.2) — unified across every room. Out · Low ·
// Expiring · OK. Primary action builds a shopping list; Kasa routes,
// it doesn't order (memo §7) — the list goes to the clipboard for the
// user to paste into WhatsApp, a quick-commerce app, whatever they use.

import { getState, subscribe, addItem, updateItem, deleteItem, adjustItemQty, byId } from "../state.js";
import { Icon } from "../ui/icons.js";
import { emptyState, stepper, field, textInput, catalogField, wireCatalogField, resolveCatalogField, chipGroup, readChipGroup, wireChipGroup, sheetActions, openSheet, closeSheet, showToast, haptic } from "../ui/components.js";

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

// Parallel projection for items tracked "/usage" instead of a day-rate
// (2026-08-03, user request) — "how many more times can this be used
// before it runs out," for items that deplete per-event (a routine
// completing) rather than continuously over time.
function projectedUsesLeft(item) {
  if (!item.perUseQty || item.perUseQty <= 0) return null;
  return Math.floor(item.qty / item.perUseQty);
}

// burnRate is always stored per-day (projectedDaysLeft etc. depend on that);
// the day/week/month chips are purely a display/entry convenience (user
// request: "can i select perday/week/month?"). "/usage" is a different
// axis entirely — not a time rate, so it's never run through this
// conversion — see openItemSheet's period-switch handler.
const PERIOD_DAYS = { day: 1, week: 7, month: 30 };
function toPerDay(amount, period) {
  return amount / (PERIOD_DAYS[period] || 1);
}
function fromPerDay(perDay, period) {
  return perDay * (PERIOD_DAYS[period] || 1);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

function isProjectedSoon(item) {
  const days = projectedDaysLeft(item);
  if (days !== null) return days <= REORDER_LEAD_DAYS;
  const uses = projectedUsesLeft(item);
  return uses !== null && uses <= 1;
}

// A rate-based early warning can flag "low" before the raw quantity number
// crosses par level — memo §5.2's spirit, applied without the learning.
function bucketOf(item) {
  if (item.status === "out") return "out";
  if (isExpiringSoon(item)) return "expiring";
  if (item.status === "low" || isProjectedSoon(item)) return "low";
  return "ok";
}

// Square-ish tile, not a full row (2026-08-03, user request: "simplify with
// squares... just for the look and feel") — same info as before (name, days
// left, qty), just laid out in a grid instead of stacked rows. The space
// name is dropped from the tile face (no room at this size); it's still
// shown in the edit sheet.
function tileHtml(item) {
  const daysLeft = projectedDaysLeft(item);
  const usesLeft = projectedUsesLeft(item);
  const meta = item.binary
    ? item.qty > 0 ? "In stock" : "Out"
    : item.status === "out" ? "Out"
    : usesLeft !== null ? `~${usesLeft} use${usesLeft === 1 ? "" : "s"} left`
    : daysLeft !== null ? `~${daysLeft}d left`
    : `${item.qty} ${item.unit}`;
  const control = item.binary
    ? `<button type="button" class="chip" data-item-toggle="${item.id}" aria-pressed="${item.qty > 0}">${item.qty > 0 ? "In stock" : "Mark in stock"}</button>`
    : stepper(item.qty, { dataAttrs: `data-item-stepper="${item.id}"` });
  return `
    <div class="tile tile-stock" data-item-id="${item.id}">
      <div class="tile-body" data-open-item="${item.id}">
        <div class="tile-icon">${Icon(item.icon || "stock", { size: 16 })}</div>
        <div class="tile-title">${item.name}</div>
        <div class="tile-meta">${meta}</div>
      </div>
      <div class="tile-stepper">${control}</div>
    </div>
  `;
}

function sectionHtml(title, items) {
  if (!items.length) return "";
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">${title} (${items.length})</span></div>
      <div class="tile-grid">${items.map(tileHtml).join("")}</div>
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
    ${sectionHtml("Out", buckets.out)}
    ${sectionHtml("Low", buckets.low)}
    ${sectionHtml("Expiring", buckets.expiring)}
    ${sectionHtml("OK", buckets.ok)}
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

// onSaved lets a caller elsewhere (Wishlist's "buy this" flow — 2026-08-04,
// user request) react to the item just created/updated, after this sheet's
// own save logic has fully run.
function openItemSheet({ item = null, defaultSpaceId = null, defaultName = null, onSaved = null } = {}) {
  const state = getState();
  const isBinary = !!item?.binary;
  // "/usage" means the number is "units consumed per completion of a
  // linked routine" (item.perUseQty), not a time rate — a different field
  // entirely from burnRate, so an item is in one mode or the other.
  const initialPeriod = item?.perUseQty ? "usage" : "day";
  const initialRateValue = initialPeriod === "usage" ? item.perUseQty : (item?.burnRate || "");
  openSheet({
    title: item ? "Edit item" : "Add item",
    bodyHtml: `
      ${item ? `<p style="color:var(--ink-muted);font-size:var(--fs-micro);margin-bottom:10px;">${lastRestockedLabel(item)}${projectedUsesLeft(item) !== null ? ` · ~${projectedUsesLeft(item)} uses left` : projectedDaysLeft(item) !== null ? ` · ~${projectedDaysLeft(item)} days left at current rate` : ""}</p>` : ""}
      <form id="item-form">
        ${field("Name", catalogField({ id: "f-item-name", type: "item", value: item?.name ?? defaultName ?? "", placeholder: "Start typing — e.g. Toilet cleaner" }))}
        ${field("Space", chipGroup({ name: "itemSpaceId", options: state.spaces.map((s) => ({ value: s.id, label: s.name })), value: item?.spaceId ?? defaultSpaceId ?? state.spaces[0]?.id }))}
        ${field("Track as", chipGroup({ name: "trackMode", options: [{ value: "qty", label: "Quantity" }, { value: "binary", label: "Yes / No" }], value: isBinary ? "binary" : "qty" }))}
        <div id="qty-fields" style="display:${isBinary ? "none" : "block"};">
          ${field("Unit", chipGroup({ name: "unit", options: UNITS, value: item?.unit ?? "piece" }))}
          ${field("Quantity", textInput({ id: "f-qty", type: "number", value: item?.qty ?? 1, min: 0 }))}
          ${field("Reorder at (par level)", textInput({ id: "f-par", type: "number", value: item?.parLevel ?? 1, min: 0 }))}
          ${field(
            "Consumption rate (optional)",
            `<div style="display:flex;gap:6px;">
              <div style="width:70px;flex-shrink:0;">${textInput({ id: "f-burnrate", type: "number", value: initialRateValue, placeholder: "0.5" })}</div>
              <div class="rate-period-group" style="flex:1;min-width:0;">${chipGroup({ name: "burnPeriod", options: [{ value: "day", label: "/day" }, { value: "week", label: "/week" }, { value: "month", label: "/month" }, { value: "usage", label: "/usage" }], value: initialPeriod })}</div>
            </div>
            <p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-top:4px;">"/usage" = units used each time a linked routine's "Uses this stock" completes — not a day rate.</p>
            <div id="auto-deplete-row" style="margin-top:8px;display:${initialPeriod === "usage" ? "none" : "block"};">
              <button type="button" class="chip" id="auto-deplete-toggle" aria-pressed="${item?.autoDeplete ? "true" : "false"}">${Icon("refresh", { size: 12 })} Auto-deplete on this schedule</button>
              <p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-top:4px;">When on, quantity actually counts down over time at this rate — not just the "~days left" estimate. Requires a day/week/month rate filled in.</p>
            </div>`,
          )}
        </div>
        <div id="binary-field" style="display:${isBinary ? "block" : "none"};">
          ${field("In stock?", chipGroup({ name: "binaryInStock", options: [{ value: "yes", label: "Yes, we have it" }, { value: "no", label: "No" }], value: item ? (item.qty > 0 ? "yes" : "no") : "yes" }))}
        </div>
        ${field("Expiry date (optional)", textInput({ id: "f-expiry", type: "date", value: item?.expiryDate ?? "" }))}
      </form>
      ${item?.catalogKey ? `<p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-bottom:6px;">Catalog key: <span class="font-num">${item.catalogKey}</span></p>` : ""}
      ${sheetActions({ saveLabel: item ? "Save changes" : "Add item", showDelete: !!item })}
    `,
  });
  const root = document.getElementById("sheet-root");
  ["itemSpaceId", "unit", "trackMode", "binaryInStock"].forEach((n) => wireChipGroup(root, n));
  wireChipGroup(root, "burnPeriod");

  // "Track as" toggles which field block shows — a stocked item is either
  // a quantity you count, or a plain yes/no you have (2026-08-03, user
  // request: "a binary option for the stock without numbers").
  root.querySelectorAll('[data-field="trackMode"] [data-value]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const binary = btn.dataset.value === "binary";
      root.querySelector("#qty-fields").style.display = binary ? "none" : "block";
      root.querySelector("#binary-field").style.display = binary ? "block" : "none";
    });
  });

  // Re-express the entered number when the period chip changes, so
  // switching /day -> /week doesn't silently change what will be saved.
  // "/usage" isn't a time unit, so switching into or out of it never
  // tries to convert the number — it just changes what it means.
  let currentPeriod = initialPeriod;
  const autoDepleteRow = root.querySelector("#auto-deplete-row");
  const autoDepleteToggle = root.querySelector("#auto-deplete-toggle");
  root.querySelectorAll('[data-field="burnPeriod"] [data-value]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const newPeriod = btn.dataset.value;
      if (newPeriod === currentPeriod) return;
      if (newPeriod !== "usage" && currentPeriod !== "usage") {
        const rateInput = root.querySelector("#f-burnrate");
        const raw = Number(rateInput.value);
        if (raw) rateInput.value = round2(fromPerDay(toPerDay(raw, currentPeriod), newPeriod));
      }
      currentPeriod = newPeriod;
      // Auto-deplete only makes sense against a day/week/month rate —
      // "/usage" already depletes automatically via routine completion.
      const isUsage = newPeriod === "usage";
      autoDepleteRow.style.display = isUsage ? "none" : "block";
      if (isUsage) autoDepleteToggle.setAttribute("aria-pressed", "false");
    });
  });

  autoDepleteToggle.addEventListener("click", () => {
    autoDepleteToggle.setAttribute("aria-pressed", autoDepleteToggle.getAttribute("aria-pressed") === "true" ? "false" : "true");
  });

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
    const spaceId = readChipGroup(root, "itemSpaceId");

    // Same catalog item twice in the same room is almost always a mistake
    // (the earlier "no warning" decision was about assets, which can
    // legitimately repeat — e.g. two ACs — stock quantity should just be
    // one tracked total per room instead). Assets are unaffected.
    if (!item) {
      const dup = state.items.find((i) => i.spaceId === spaceId && i.catalogKey === entry.key);
      if (dup) {
        showToast(`${entry.name} is already tracked in this room — adjust it there instead`);
        return;
      }
    }

    const binary = readChipGroup(root, "trackMode") === "binary";
    // Never negative — clamped here for direct typing into the field (the
    // stepper and auto-deplete already clamp their own paths, but a typed
    // "-5" bypassed both, 2026-08-03 user report).
    let qty, parLevel, burnRate, perUseQty, autoDeplete, lastDepletedAt, status;
    if (binary) {
      qty = readChipGroup(root, "binaryInStock") === "yes" ? 1 : 0;
      parLevel = 1;
      burnRate = 0;
      perUseQty = 0;
      autoDeplete = false;
      lastDepletedAt = null;
      status = qty <= 0 ? "out" : "ok";
    } else {
      qty = Math.max(0, Number(root.querySelector("#f-qty").value) || 0);
      parLevel = Math.max(0, Number(root.querySelector("#f-par").value) || 1);
      const rateRaw = Number(root.querySelector("#f-burnrate").value) || 0;
      const period = readChipGroup(root, "burnPeriod") || "day";
      burnRate = period !== "usage" && rateRaw ? toPerDay(rateRaw, period) : 0;
      perUseQty = period === "usage" ? rateRaw : 0;

      autoDeplete = autoDepleteToggle.getAttribute("aria-pressed") === "true";
      if (autoDeplete && (period === "usage" || !rateRaw)) {
        showToast("Auto-deplete needs a day/week/month rate filled in first");
        return;
      }
      // Fresh baseline when just turning it on (or on a new item); keep the
      // existing checkpoint if it was already running so an unrelated edit
      // doesn't reset how much time has "counted" toward depletion.
      lastDepletedAt = autoDeplete ? (item?.autoDeplete && item?.lastDepletedAt ? item.lastDepletedAt : new Date().toISOString()) : null;
      status = qty <= 0 ? "out" : qty <= parLevel ? "low" : "ok";
    }
    const fields = {
      name: entry.name,
      catalogKey: entry.key,
      icon: entry.icon,
      spaceId,
      unit: binary ? "piece" : readChipGroup(root, "unit"),
      binary,
      qty,
      parLevel,
      burnRate,
      perUseQty,
      autoDeplete,
      lastDepletedAt,
      expiryDate: root.querySelector("#f-expiry").value || null,
      status,
    };
    let savedItem;
    if (item) { updateItem(item.id, fields); savedItem = byId(getState().items, item.id); }
    else savedItem = addItem(fields);
    closeSheet();
    showToast(item ? "Item updated" : "Item added");
    onSaved?.(savedItem);
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
        haptic(4);
      });
    });
  });

  mountEl.querySelectorAll("[data-item-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.itemToggle;
      const it = byId(state.items, id);
      if (!it) return;
      const nowIn = it.qty <= 0;
      updateItem(id, { qty: nowIn ? 1 : 0, status: nowIn ? "ok" : "out" });
      haptic(4);
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
