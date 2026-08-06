// Stock screen (memo §8.2) — unified across every room. Out · Low ·
// Expiring · OK. Primary action builds a shopping list; Kasa routes,
// it doesn't order (memo §7) — the list goes to the clipboard for the
// user to paste into WhatsApp, a quick-commerce app, whatever they use.

import { getState, subscribe, addItem, updateItem, deleteItem, adjustItemQty, visibleSpaceIds, byId } from "../state.js";
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
// "Per month" is purely a display/entry convenience converted through this
// on the way in — see consumeModeToFields below.
const PERIOD_DAYS = { day: 1, month: 30 };
function toPerDay(amount, period) {
  return amount / (PERIOD_DAYS[period] || 1);
}
function fromPerDay(perDay, period) {
  return perDay * (PERIOD_DAYS[period] || 1);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// Consumption model, reworked twice now for one intuitive control instead
// of three (a rate number + a day/week/month/usage period chip + a
// separate "auto-deplete" toggle) — 2026-08-08, user request: "keep it
// simple... intuitive." "Automate consumption" picks Off / Per day / Per
// month / Per routine use; picking Day or Month always live-depletes the
// actual quantity. Countable units (piece/pack/roll) and measured units
// (ml/g/kg/litre) share the exact same three modes, just with copy that
// reads naturally either way.
//
// Follow-up the same day: rather than asking directly for a rate ("how
// much is used per day" — a hard number to know off the top of your
// head), ask the easier real-world question instead — "how many days
// does 1 [unit] last?" — and derive the rate automatically as 1 divided
// by that answer. "1 roll lasts about 40 days" is something most people
// can actually estimate; "I use 0.025 rolls a day" isn't.
const COUNTABLE_UNITS = ["piece", "pack", "roll"];
function isCountableUnit(unit) {
  return COUNTABLE_UNITS.includes(unit);
}
const MODE_PERIOD_PLURAL = { day: "days", month: "months", usage: "uses" };
function timesPerUnitLabel(unit, mode) {
  return `How many ${MODE_PERIOD_PLURAL[mode] || "days"} does 1 ${unit} last?`;
}

// Derives an item's current consumption mode + "how many X does 1 unit
// last" from its stored burnRate/perUseQty (the underlying storage is
// unchanged — this is purely a UI reframing, same as the first rework).
// timesPerUnit is just the reciprocal of whichever per-time amount is
// actually stored.
function consumeModeOf(item) {
  if (item?.perUseQty > 0) return { mode: "usage", timesPerUnit: round2(1 / item.perUseQty) };
  if (item?.burnRate > 0) return { mode: "day", timesPerUnit: round2(1 / item.burnRate) };
  return { mode: "off", timesPerUnit: "" };
}

// Space options scoped to the currently-visible house(s), plus the item's
// own current space even if it belongs to a house that isn't selected
// right now (2026-08-05, multi-house support) — editing something from a
// hidden house shouldn't strand it with no matching dropdown option.
// Sorted by house name first, then space name alphabetically within each
// house (2026-08-09, user request — matches House's own grid).
function sortSpaces(spaces, state) {
  return [...spaces].sort((a, b) => {
    const houseA = byId(state.houses, a.houseId)?.name || "";
    const houseB = byId(state.houses, b.houseId)?.name || "";
    if (houseA !== houseB) return houseA.localeCompare(houseB);
    return a.name.localeCompare(b.name);
  });
}

function itemSpaceOptions(state, currentSpaceId) {
  const visible = visibleSpaceIds(state);
  const multiHouse = state.houses.length > 1;
  return sortSpaces(state.spaces.filter((s) => visible.has(s.id) || s.id === currentSpaceId), state)
    .map((s) => {
      const houseName = multiHouse ? byId(state.houses, s.houseId)?.name : null;
      return { value: s.id, label: houseName ? `${s.name}<span class="chip-house-hint">${houseName}</span>` : s.name };
    });
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
  // Scoped to whichever house(s) are currently active (2026-08-05,
  // multi-house support) — a single-house household sees every item
  // exactly as before.
  const visible = visibleSpaceIds(state);
  const buckets = { out: [], low: [], expiring: [], ok: [] };
  for (const item of state.items) {
    if (!visible.has(item.spaceId)) continue;
    buckets[bucketOf(item)].push(item);
  }

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
  const initialUnit = item?.unit ?? "piece";
  const { mode: initialMode, timesPerUnit: initialTimesPerUnit } = consumeModeOf(item);
  // Reconstructed from stored fields, not stored itself — "reorder when
  // this many uses are left" is just `parLevel` expressed as a count
  // instead of a raw quantity (parLevel = usesLeft / timesPerUnit, so
  // usesLeft = parLevel * timesPerUnit). Defaults to 3 for a fresh item
  // or one with nothing to reconstruct from.
  const initialReorderUses = item && initialTimesPerUnit ? round2(item.parLevel * initialTimesPerUnit) || 3 : 3;
  openSheet({
    title: item ? "Edit item" : "Add item",
    bodyHtml: `
      ${item ? `<p style="color:var(--ink-muted);font-size:var(--fs-micro);margin-bottom:10px;">${lastRestockedLabel(item)}${projectedUsesLeft(item) !== null ? ` · ~${projectedUsesLeft(item)} uses left` : projectedDaysLeft(item) !== null ? ` · ~${projectedDaysLeft(item)} days left at current rate` : ""}</p>` : ""}
      <form id="item-form">
        ${field("Name", catalogField({ id: "f-item-name", type: "item", value: item?.name ?? defaultName ?? "", placeholder: "Start typing — e.g. Toilet cleaner" }))}
        ${field("Space", chipGroup({ name: "itemSpaceId", options: itemSpaceOptions(state, item?.spaceId), value: item?.spaceId ?? defaultSpaceId ?? [...visibleSpaceIds(state)][0] ?? state.spaces[0]?.id }))}
        ${field("Track as", chipGroup({ name: "trackMode", options: [{ value: "qty", label: "Quantity" }, { value: "binary", label: "Yes / No" }], value: isBinary ? "binary" : "qty" }))}
        <div id="qty-fields" style="display:${isBinary ? "none" : "block"};">
          ${field("Unit", chipGroup({ name: "unit", options: UNITS, value: initialUnit }))}
          ${field("Quantity now", textInput({ id: "f-qty", type: "number", value: item?.qty ?? 1, min: 0 }))}
          ${field(
            "Automate consumption",
            `${chipGroup({ name: "consumeMode", options: [{ value: "off", label: "Off" }, { value: "day", label: "Per day" }, { value: "month", label: "Per month" }, { value: "usage", label: "Per routine use" }], value: initialMode })}
            <div id="consume-amount-row" style="margin-top:8px;display:${initialMode === "off" ? "none" : "block"};">
              ${textInput({ id: "f-times-per-unit", type: "number", value: initialTimesPerUnit, placeholder: "e.g. 40", min: 0 })}
              <p id="times-per-unit-label" style="color:var(--ink-faint);font-size:var(--fs-micro);margin-top:4px;">${timesPerUnitLabel(initialUnit, initialMode === "off" ? "day" : initialMode)}</p>
            </div>`,
          )}
          <div id="reorder-qty-row" style="display:${initialMode === "off" ? "block" : "none"};">
            ${field("Reorder when this many are left", textInput({ id: "f-par", type: "number", value: item?.parLevel ?? 1, min: 0 }))}
          </div>
          <div id="reorder-uses-row" style="display:${initialMode === "off" ? "none" : "block"};">
            ${field("Reorder when this many uses are left", textInput({ id: "f-reorder-uses", type: "number", value: initialReorderUses, min: 0 }))}
            <p id="reorder-uses-caption" style="color:var(--ink-faint);font-size:var(--fs-micro);margin-top:-8px;margin-bottom:12px;"></p>
          </div>
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
  ["itemSpaceId", "unit", "trackMode", "binaryInStock", "consumeMode"].forEach((n) => wireChipGroup(root, n));

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

  // Consumption mode + unit both feed the "how many X does 1 unit last"
  // label ("How many days does 1 roll last?" vs. "How many uses does 1 ml
  // last?") — whichever changes, re-read both current values and
  // re-render it. Mode also flips which Reorder field shows (a raw
  // quantity when Off, a "uses left" count otherwise) and keeps that
  // count's quantity-equivalent caption live.
  let currentMode = initialMode;
  let currentUnit = initialUnit;
  const consumeAmountRow = root.querySelector("#consume-amount-row");
  const timesPerUnitLabelEl = root.querySelector("#times-per-unit-label");
  const reorderQtyRow = root.querySelector("#reorder-qty-row");
  const reorderUsesRow = root.querySelector("#reorder-uses-row");
  const reorderUsesCaption = root.querySelector("#reorder-uses-caption");

  function refreshReorderCaption() {
    const timesPerUnit = Number(root.querySelector("#f-times-per-unit").value) || 0;
    const usesLeft = Number(root.querySelector("#f-reorder-uses").value) || 0;
    if (!timesPerUnit || !usesLeft) {
      reorderUsesCaption.textContent = "";
      return;
    }
    const qtyEquivalent = round2(usesLeft / timesPerUnit);
    reorderUsesCaption.textContent = `≈ ${qtyEquivalent} ${currentUnit} left`;
  }

  function refreshConsumeLabel() {
    const off = currentMode === "off";
    consumeAmountRow.style.display = off ? "none" : "block";
    reorderQtyRow.style.display = off ? "block" : "none";
    reorderUsesRow.style.display = off ? "none" : "block";
    if (!off) {
      timesPerUnitLabelEl.textContent = timesPerUnitLabel(currentUnit, currentMode);
      refreshReorderCaption();
    }
  }
  root.querySelectorAll('[data-field="consumeMode"] [data-value]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const newMode = btn.dataset.value;
      // Re-express the number when switching Day <-> Month specifically, so
      // it doesn't silently mean something different once saved (e.g. "40"
      // meant 40 days a moment ago, now means 40 months unless converted).
      if ((newMode === "day" || newMode === "month") && (currentMode === "day" || currentMode === "month") && newMode !== currentMode) {
        const timesInput = root.querySelector("#f-times-per-unit");
        const raw = Number(timesInput.value);
        if (raw) timesInput.value = round2((raw * PERIOD_DAYS[currentMode]) / PERIOD_DAYS[newMode]);
      }
      currentMode = newMode;
      refreshConsumeLabel();
    });
  });
  root.querySelectorAll('[data-field="unit"] [data-value]').forEach((btn) => {
    btn.addEventListener("click", () => {
      currentUnit = btn.dataset.value;
      refreshConsumeLabel();
    });
  });
  root.querySelector("#f-times-per-unit").addEventListener("input", refreshReorderCaption);
  root.querySelector("#f-reorder-uses").addEventListener("input", refreshReorderCaption);

  const nameInput = root.querySelector("#f-item-name");
  if (item?.catalogKey) nameInput.dataset.catalogKey = item.catalogKey;

  wireCatalogField(root, "f-item-name", "item", {
    onSelect: (entry) => {
      // Only pre-fill from the catalog default when adding fresh — never
      // clobber a value the user is actively editing.
      if (item) return;
      const unitGroup = root.querySelector('[data-field="unit"]');
      unitGroup.querySelectorAll("[data-value]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === entry.unit)));
      currentUnit = entry.unit;
      refreshConsumeLabel();
      if (entry.parLevel != null) root.querySelector("#f-par").value = entry.parLevel;
      if (entry.parLevel != null) root.querySelector("#f-qty").value = entry.parLevel;
      if (entry.defaultBurnRate > 0) {
        // Catalog defaults are still stored as a per-day rate — converted
        // to "how many days does 1 unit last" (the reciprocal) for the new
        // framing.
        root.querySelector("#f-times-per-unit").value = round2(1 / entry.defaultBurnRate);
        // A catalog default rate means something to consume, so switch the
        // mode chip to Day too — otherwise the field would be filled in
        // but hidden behind an untouched "Off" selection.
        currentMode = "day";
        root.querySelectorAll('[data-field="consumeMode"] [data-value]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === "day")));
        refreshConsumeLabel();
      }
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
      const mode = readChipGroup(root, "consumeMode") || "off";
      const timesPerUnit = Math.max(0, Number(root.querySelector("#f-times-per-unit").value) || 0);
      if (mode !== "off" && !timesPerUnit) {
        showToast("Enter how many it lasts, or set Automate consumption back to Off");
        return;
      }
      // "How many X does 1 unit last" (timesPerUnit) is the number actually
      // typed (2026-08-08, user request — easier to estimate than a raw
      // rate); the per-time amount used everywhere else is just its
      // reciprocal, in the item's own unit.
      const perTimeAmount = timesPerUnit > 0 ? 1 / timesPerUnit : 0;
      // Per day/Per month both live-deplete the actual quantity now — the
      // old separate "rate set but not counting down" state is gone
      // (2026-08-08, user request: "keep it simple"). Per routine use still
      // only depletes when a linked routine's "Uses this stock" completes,
      // same as before.
      burnRate = mode === "day" ? perTimeAmount : mode === "month" ? toPerDay(perTimeAmount, "month") : 0;
      perUseQty = mode === "usage" ? perTimeAmount : 0;
      autoDeplete = mode === "day" || mode === "month";
      // Reorder threshold: a plain quantity when consumption isn't
      // automated (nothing to convert a "uses" count against), or "reorder
      // when N uses are left" translated into the equivalent quantity
      // (N * perTimeAmount) when it is — the user types a round, easy
      // number like "3 uses left"; the actual quantity threshold this
      // implies is computed here, never typed directly (2026-08-08, user
      // request: "auto fill this... use the right unit but auto
      // populated").
      if (mode === "off") {
        parLevel = Math.max(0, Number(root.querySelector("#f-par").value) || 1);
      } else {
        const reorderUses = Math.max(0, Number(root.querySelector("#f-reorder-uses").value) || 0);
        parLevel = round2(reorderUses * perTimeAmount) || 0;
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
  const visible = visibleSpaceIds(state);
  const needed = state.items.filter((i) => visible.has(i.spaceId) && (i.status === "out" || i.status === "low"));
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

export { mount, openItemSheet, bucketOf };
