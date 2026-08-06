// Assets screen (memo §8.2) — cards sorted by next service, warranty
// countdown, detail with vendor call button and running service history.

import { getState, subscribe, addAsset, updateAsset, deleteAsset, markAssetServiced, addRoutine, updateRoutine, deleteRoutine, nextSaturdayDateStr, visibleSpaceIds, byId } from "../state.js";
import { findByKey } from "../catalog.js";
import { Icon } from "../ui/icons.js";
import { emptyState, field, textInput, catalogField, wireCatalogField, resolveCatalogField, chipGroup, readChipGroup, wireChipGroup, sheetActions, openSheet, closeSheet, showToast } from "../ui/components.js";

let mountEl = null;
let unsubscribe = null;
let onBack = null;
let currentSuggested = [];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr) - new Date()) / 86400000);
}

function warrantyLabel(asset) {
  const d = daysUntil(asset.warrantyUntil);
  if (d === null) return "No warranty on file";
  if (d < 0) return "Warranty expired";
  return `Warranty · ${d} day${d === 1 ? "" : "s"} left`;
}

function serviceLabel(asset) {
  const d = daysUntil(asset.nextServiceDue);
  if (d === null) return "No service schedule";
  if (d < 0) return `Service overdue by ${-d} day${-d === 1 ? "" : "s"}`;
  if (d === 0) return "Service due today";
  return `Service due in ${d} day${d === 1 ? "" : "s"}`;
}

// Scoped to whichever house(s) are currently active (2026-08-05, multi-
// house support) — a single-house household sees every asset exactly as
// before.
function sortedAssets(state) {
  const visible = visibleSpaceIds(state);
  return state.assets.filter((a) => visible.has(a.spaceId)).sort((a, b) => {
    const da = a.nextServiceDue ? new Date(a.nextServiceDue) : Infinity;
    const db = b.nextServiceDue ? new Date(b.nextServiceDue) : Infinity;
    return da - db;
  });
}

function rowHtml(asset, state) {
  const space = byId(state.spaces, asset.spaceId);
  const overdue = daysUntil(asset.nextServiceDue) < 0;
  return `
    <div class="list-row" data-asset-id="${asset.id}">
      <div class="occ-row-icon">${Icon(asset.icon || "warranty", { size: 18 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title named">${asset.name}</div>
        <div class="occ-row-meta" style="${overdue ? "color:var(--tier-damaging);font-weight:var(--fw-semibold);" : ""}">${serviceLabel(asset)} · ${space?.name || ""}</div>
      </div>
    </div>
  `;
}

function render() {
  const state = getState();
  const list = sortedAssets(state);
  mountEl.innerHTML = `
    <div class="topbar">
      <button class="btn btn-ghost" id="back-to-more" style="padding:8px;">${Icon("chevronLeft", { size: 18 })}</button>
      <h1 style="flex:1;">Assets</h1>
      <button class="btn btn-tinted" id="add-asset-btn">${Icon("plus", { size: 16 })} Asset</button>
    </div>
    <div class="today-section">
      ${list.map((a) => rowHtml(a, state)).join("") || emptyState({ message: "No assets tracked yet.", actionLabel: null })}
    </div>
  `;
  wireEvents(state);
}

// Scoped to the currently-visible house(s), plus the asset's own current
// space even if it belongs to a house that isn't selected right now
// (2026-08-05, multi-house support) — editing something from a hidden
// house shouldn't strand it with no matching dropdown option.
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

function assetSpaceOptions(state, currentSpaceId) {
  const visible = visibleSpaceIds(state);
  const multiHouse = state.houses.length > 1;
  return sortSpaces(state.spaces.filter((s) => visible.has(s.id) || s.id === currentSpaceId), state)
    .map((s) => {
      const houseName = multiHouse ? byId(state.houses, s.houseId)?.name : null;
      return { value: s.id, label: houseName ? `${s.name}<span class="chip-house-hint">${houseName}</span>` : s.name };
    });
}

function assetFormFields(asset, state, defaultSpaceId, defaultName) {
  const hasInterval = asset?.serviceIntervalDays > 0;
  return `
    ${field("Name", catalogField({ id: "f-asset-name", type: "asset", value: asset?.name ?? defaultName ?? "", placeholder: "Start typing — e.g. Geyser" }))}
    ${field("Space", chipGroup({ name: "assetSpaceId", options: assetSpaceOptions(state, asset?.spaceId), value: asset?.spaceId ?? defaultSpaceId ?? [...visibleSpaceIds(state)][0] ?? state.spaces[0]?.id }))}
    ${field("Brand / model", textInput({ id: "f-asset-brand", value: asset?.brand ?? "" }))}
    ${field("Purchase date", textInput({ id: "f-asset-purchased", type: "date", value: asset?.purchaseDate ?? "" }))}
    ${field("Warranty until", textInput({ id: "f-asset-warranty", type: "date", value: asset?.warrantyUntil ?? "" }))}
    ${field("Service every N days", textInput({ id: "f-asset-interval", type: "number", value: asset?.serviceIntervalDays ?? "", min: 1 }))}
    <div id="last-serviced-field" style="display:${hasInterval ? "block" : "none"};">
      ${field("Last service date (optional)", textInput({ id: "f-asset-last-serviced", type: "date", value: asset?.lastServicedAt ?? "" }))}
      <p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-top:-6px;margin-bottom:12px;">Used to work out when the next service is actually due — leave blank and it'll start from the following Saturday instead.</p>
    </div>
    ${field("Expected life (years)", textInput({ id: "f-asset-life", type: "number", value: asset?.expectedLifeYears ?? "", placeholder: "e.g. 10", min: 1 }))}
    ${field("Vendor name", textInput({ id: "f-asset-vendor", value: asset?.vendorName ?? "" }))}
    ${field("Vendor phone", textInput({ id: "f-asset-phone", type: "tel", value: (asset?.vendorPhone || "").replace("tel:", "") }))}
  `;
}

// Renders the offered suggestedRoutines as pre-checked toggle chips inside
// the sheet's #suggested-routines-field placeholder. Re-called whenever the
// catalog selection changes (add mode) or the "+ Add suggested routines"
// button is pressed (edit mode) — memo §4.2-shaped templates, see catalog.js.
//
// `existingTitles` (2026-08-07, user report: "it shouldn't again prompt
// for suggested routines unless the old one was deleted... duplicate
// routines can be created") — a template whose title already exists as a
// real routine linked to this asset is dropped from the offered list
// entirely, not just left unchecked, so re-opening "+ Add suggested
// routines" on an asset that already has them all linked has nothing
// left to offer. Only relevant in edit mode; a brand-new asset being
// created has no existing routines to check against.
function renderSuggestedRoutines(root, routines, existingTitles = new Set()) {
  currentSuggested = (routines || []).filter((r) => !existingTitles.has(r.title));
  const container = root.querySelector("#suggested-routines-field");
  if (!container) return;
  if (!currentSuggested.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <span class="field-label">Suggested routines</span>
    <div class="chip-group">
      ${currentSuggested
        .map((r, i) => `<button type="button" class="chip" aria-pressed="true" data-routine-index="${i}">${r.title}</button>`)
        .join("")}
    </div>
  `;
  container.querySelectorAll("[data-routine-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.setAttribute("aria-pressed", btn.getAttribute("aria-pressed") === "true" ? "false" : "true");
    });
  });
}

// onSaved lets a caller elsewhere in the app (Wishlist's "buy this" flow —
// 2026-08-04, user request: acquiring a wishlist asset should collect the
// same real details this sheet always has, not a bare-bones create) react
// to the asset that was just created/updated, after this sheet's own save
// logic (incl. suggestedRoutines) has fully run.
function openAssetSheet({ asset = null, defaultSpaceId = null, defaultName = null, onSaved = null } = {}) {
  const state = getState();
  const catalogEntry = asset?.catalogKey ? findByKey(asset.catalogKey, "asset") : null;
  // Titles already linked to this asset — offering them again would just
  // create duplicates (2026-08-07 fix, see renderSuggestedRoutines).
  const existingRoutineTitles = asset ? new Set(state.routines.filter((r) => r.assetId === asset.id).map((r) => r.title)) : new Set();
  const canOfferMore = asset && catalogEntry?.suggestedRoutines?.some((r) => !existingRoutineTitles.has(r.title));

  // "Mark serviced" only makes sense once there's an actual schedule to
  // mark against (2026-08-07, user request: "if no service number is
  // given... remove mark as serviced button") — an asset with no service
  // interval has nothing here to complete.
  const hasServiceSchedule = asset?.serviceIntervalDays > 0;
  const extraActions = asset
    ? `
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        ${asset.vendorPhone ? `<a class="btn btn-ghost" href="${asset.vendorPhone}" style="flex:1;text-decoration:none;">${Icon("call", { size: 14 })} Call vendor</a>` : ""}
        ${hasServiceSchedule ? `<button type="button" class="btn btn-ghost" id="mark-serviced-btn" style="flex:1;">${Icon("check", { size: 14 })} Mark serviced</button>` : ""}
      </div>
      <p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-bottom:16px;">${warrantyLabel(asset)} · ${serviceLabel(asset)}</p>
      ${canOfferMore ? `<button type="button" class="btn btn-ghost" id="show-suggested-btn" style="width:100%;margin-bottom:16px;">${Icon("sparkle", { size: 14 })} Add suggested routines</button>` : ""}
    `
    : "";

  openSheet({
    title: asset ? "Edit asset" : "Add asset",
    bodyHtml: `
      ${extraActions}
      <form id="asset-form">${assetFormFields(asset, state, defaultSpaceId, defaultName)}</form>
      <div class="field" id="suggested-routines-field"></div>
      ${asset?.catalogKey ? `<p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-bottom:8px;">Catalog key: <span class="font-num">${asset.catalogKey}</span></p>` : ""}
      ${sheetActions({ saveLabel: asset ? "Save changes" : "Add asset", showDelete: !!asset })}
    `,
  });
  const root = document.getElementById("sheet-root");
  wireChipGroup(root, "assetSpaceId");
  currentSuggested = [];

  root.querySelector("#f-asset-interval").addEventListener("input", (e) => {
    root.querySelector("#last-serviced-field").style.display = Number(e.target.value) > 0 ? "block" : "none";
  });

  const nameInput = root.querySelector("#f-asset-name");
  if (asset?.catalogKey) nameInput.dataset.catalogKey = asset.catalogKey;

  wireCatalogField(root, "f-asset-name", "asset", {
    onSelect: (entry) => {
      if (asset) return; // never clobber an existing asset's fields on edit
      if (entry.serviceIntervalDays != null) root.querySelector("#f-asset-interval").value = entry.serviceIntervalDays;
      if (entry.expectedLifeYears != null) root.querySelector("#f-asset-life").value = entry.expectedLifeYears;
      renderSuggestedRoutines(root, entry.suggestedRoutines);
    },
  });

  root.querySelector("#show-suggested-btn")?.addEventListener("click", (e) => {
    renderSuggestedRoutines(root, catalogEntry.suggestedRoutines, existingRoutineTitles);
    e.target.remove();
  });

  root.querySelector("#mark-serviced-btn")?.addEventListener("click", () => {
    markAssetServiced(asset.id);
    closeSheet();
    showToast("Marked serviced today");
  });

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const entry = resolveCatalogField(root, "f-asset-name", "asset");
    if (!entry) return;
    const phone = root.querySelector("#f-asset-phone").value.trim();
    const interval = root.querySelector("#f-asset-interval").value;
    const serviceIntervalDays = interval ? Number(interval) : null;
    const lastServicedAt = root.querySelector("#f-asset-last-serviced")?.value || null;
    const spaceId = readChipGroup(root, "assetSpaceId");

    // Soft nudge, not a block (2026-08-09 — Round 7's "no warning, add
    // freely" call for assets stands: two ACs in one room is genuinely
    // legitimate) — but a SAME-named asset in the SAME room is far more
    // often an accidental double-add than a deliberate second one (see
    // CLAUDE.md finding 4.3: an untitled duplicate "Geyser" sitting in one
    // bathroom with zero way to tell the two apart is exactly the
    // confusing case this catches). Only asked when adding fresh — editing
    // an existing asset never triggers it against itself.
    if (!asset) {
      const dup = getState().assets.find((a) => a.spaceId === spaceId && a.name === entry.name);
      if (dup && !confirm(`There's already a ${entry.name} in this room. Add another one anyway?`)) return;
    }

    const fields = {
      name: entry.name,
      catalogKey: entry.key,
      icon: entry.icon,
      spaceId,
      brand: root.querySelector("#f-asset-brand").value.trim() || null,
      purchaseDate: root.querySelector("#f-asset-purchased").value || null,
      warrantyUntil: root.querySelector("#f-asset-warranty").value || null,
      serviceIntervalDays,
      expectedLifeYears: root.querySelector("#f-asset-life").value ? Number(root.querySelector("#f-asset-life").value) : null,
      vendorName: root.querySelector("#f-asset-vendor").value.trim() || null,
      vendorPhone: phone ? `tel:${phone}` : null,
    };
    if (serviceIntervalDays) fields.lastServicedAt = lastServicedAt;

    const assetId = asset ? (updateAsset(asset.id, fields), asset.id) : addAsset(fields).id;
    const savedAsset = byId(getState().assets, assetId);

    // "Service every N days" auto-creates/updates/removes its own linked
    // routine (2026-08-07, user request) — tracked via
    // asset.serviceRoutineId so this is a real find-or-create, never a
    // second duplicate routine on a later edit. Due date comes from the
    // given last-service date + interval if provided, otherwise the same
    // "next Saturday, not today" default new suggested routines get.
    if (serviceIntervalDays > 0) {
      const startDate = lastServicedAt
        ? new Date(new Date(lastServicedAt).getTime() + serviceIntervalDays * 86400000).toISOString().slice(0, 10)
        : nextSaturdayDateStr();
      const trigger = { type: "floating_since_last", intervalDays: serviceIntervalDays, startDate };
      if (savedAsset.serviceRoutineId && byId(getState().routines, savedAsset.serviceRoutineId)) {
        updateRoutine(savedAsset.serviceRoutineId, { trigger });
      } else {
        const routine = addRoutine({
          title: `Service ${savedAsset.name}`, spaceId, assetId, trigger,
          // Skipping a service interval leads to breakdown/wear, not a
          // hygiene issue — "damaging" fits better than "unhygienic" here
          // (2026-08-09 tier rename).
          effort: 3, consequence: "damaging", ownerClass: "vendor",
        });
        updateAsset(assetId, { serviceRoutineId: routine.id });
      }
    } else if (savedAsset.serviceRoutineId) {
      // Interval cleared — the auto-created routine no longer has
      // anything to base itself on, so it goes too.
      deleteRoutine(savedAsset.serviceRoutineId);
      updateAsset(assetId, { serviceRoutineId: null });
    }

    const checkedIndices = [...root.querySelectorAll('#suggested-routines-field [data-routine-index][aria-pressed="true"]')]
      .map((b) => Number(b.dataset.routineIndex));
    // Defensive re-check at the actual save point, not just the render-
    // time filter above (2026-08-07 fix) — the same "don't duplicate an
    // already-linked suggested routine" guard, re-read fresh in case
    // anything changed between opening this sheet and clicking save.
    const alreadyLinkedTitles = new Set(getState().routines.filter((r) => r.assetId === assetId).map((r) => r.title));
    let addedRoutines = 0;
    for (const i of checkedIndices) {
      const tmpl = currentSuggested[i];
      if (!tmpl || alreadyLinkedTitles.has(tmpl.title)) continue;
      // Same-room only — an AC filter routine in the Bedroom shouldn't
      // silently link to a filter item that happens to live in Utility
      // (2026-08-03, user request, same principle as the manual routine
      // builder's stock picker).
      const requiresItemIds = (tmpl.requiresItemKeys || [])
        .map((k) => getState().items.find((it) => it.catalogKey === k && it.spaceId === spaceId)?.id)
        .filter(Boolean);
      // New asset's suggested routines default to next Saturday, not
      // today (2026-08-07, user request). Applied to every trigger type
      // now that a start date is mandatory for all of them (2026-08-08) —
      // engine.js's computeNext already knows how to use it per type (a
      // future date wins outright for every type; only floating_since_last
      // needs it to anchor its own interval math).
      const trigger = { ...tmpl.trigger, startDate: tmpl.trigger.startDate ?? nextSaturdayDateStr() };
      addRoutine({
        title: tmpl.title, spaceId, assetId, trigger,
        effort: tmpl.effort, consequence: tmpl.consequence, ownerClass: tmpl.ownerClass, requiresItemIds,
      });
      addedRoutines += 1;
    }

    closeSheet();
    const routineNote = addedRoutines ? ` + ${addedRoutines} routine${addedRoutines === 1 ? "" : "s"}` : "";
    showToast((asset ? "Asset updated" : "Asset added") + routineNote);
    onSaved?.(byId(getState().assets, assetId));
  });

  if (asset) {
    root.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm(`Remove "${asset.name}"?`)) return;
      deleteAsset(asset.id);
      closeSheet();
      showToast("Asset removed");
    });
  }
}

function wireEvents(state) {
  document.getElementById("back-to-more")?.addEventListener("click", () => onBack?.());
  document.getElementById("add-asset-btn")?.addEventListener("click", () => openAssetSheet());
  mountEl.querySelectorAll("[data-asset-id]").forEach((row) => {
    row.addEventListener("click", () => openAssetSheet({ asset: byId(state.assets, row.dataset.assetId) }));
  });
}

function mount(el, { onBack: back } = {}) {
  mountEl = el;
  onBack = back;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount, openAssetSheet };
