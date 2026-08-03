// Assets screen (memo §8.2) — cards sorted by next service, warranty
// countdown, detail with vendor call button and running service history.

import { getState, subscribe, addAsset, updateAsset, deleteAsset, markAssetServiced, addRoutine, byId } from "../state.js";
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

function sortedAssets(state) {
  return [...state.assets].sort((a, b) => {
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

function assetFormFields(asset, state, defaultSpaceId) {
  return `
    ${field("Name", catalogField({ id: "f-asset-name", type: "asset", value: asset?.name ?? "", placeholder: "Start typing — e.g. Geyser" }))}
    ${field("Space", chipGroup({ name: "assetSpaceId", options: state.spaces.map((s) => ({ value: s.id, label: s.name })), value: asset?.spaceId ?? defaultSpaceId ?? state.spaces[0]?.id }))}
    ${field("Brand / model", textInput({ id: "f-asset-brand", value: asset?.brand ?? "" }))}
    ${field("Purchase date", textInput({ id: "f-asset-purchased", type: "date", value: asset?.purchaseDate ?? "" }))}
    ${field("Warranty until", textInput({ id: "f-asset-warranty", type: "date", value: asset?.warrantyUntil ?? "" }))}
    ${field("Service every N days", textInput({ id: "f-asset-interval", type: "number", value: asset?.serviceIntervalDays ?? "" }))}
    ${field("Vendor name", textInput({ id: "f-asset-vendor", value: asset?.vendorName ?? "" }))}
    ${field("Vendor phone", textInput({ id: "f-asset-phone", type: "tel", value: (asset?.vendorPhone || "").replace("tel:", "") }))}
  `;
}

// Renders the offered suggestedRoutines as pre-checked toggle chips inside
// the sheet's #suggested-routines-field placeholder. Re-called whenever the
// catalog selection changes (add mode) or the "+ Add suggested routines"
// button is pressed (edit mode) — memo §4.2-shaped templates, see catalog.js.
function renderSuggestedRoutines(root, routines) {
  currentSuggested = routines || [];
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

function openAssetSheet({ asset = null, defaultSpaceId = null } = {}) {
  const state = getState();
  const catalogEntry = asset?.catalogKey ? findByKey(asset.catalogKey, "asset") : null;
  const canOfferMore = asset && catalogEntry?.suggestedRoutines?.length;

  const extraActions = asset
    ? `
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        ${asset.vendorPhone ? `<a class="btn btn-ghost" href="${asset.vendorPhone}" style="flex:1;text-decoration:none;">${Icon("call", { size: 14 })} Call vendor</a>` : ""}
        <button type="button" class="btn btn-ghost" id="mark-serviced-btn" style="flex:1;">${Icon("check", { size: 14 })} Mark serviced</button>
      </div>
      <p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-bottom:16px;">${warrantyLabel(asset)} · ${serviceLabel(asset)}</p>
      ${canOfferMore ? `<button type="button" class="btn btn-ghost" id="show-suggested-btn" style="width:100%;margin-bottom:16px;">${Icon("sparkle", { size: 14 })} Add suggested routines</button>` : ""}
    `
    : "";

  openSheet({
    title: asset ? "Edit asset" : "Add asset",
    bodyHtml: `
      ${extraActions}
      <form id="asset-form">${assetFormFields(asset, state, defaultSpaceId)}</form>
      <div class="field" id="suggested-routines-field"></div>
      ${asset?.catalogKey ? `<p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-bottom:8px;">Catalog key: <span class="font-num">${asset.catalogKey}</span></p>` : ""}
      ${sheetActions({ saveLabel: asset ? "Save changes" : "Add asset", showDelete: !!asset })}
    `,
  });
  const root = document.getElementById("sheet-root");
  wireChipGroup(root, "assetSpaceId");
  currentSuggested = [];

  const nameInput = root.querySelector("#f-asset-name");
  if (asset?.catalogKey) nameInput.dataset.catalogKey = asset.catalogKey;

  wireCatalogField(root, "f-asset-name", "asset", {
    onSelect: (entry) => {
      if (asset) return; // never clobber an existing asset's fields on edit
      if (entry.serviceIntervalDays != null) root.querySelector("#f-asset-interval").value = entry.serviceIntervalDays;
      renderSuggestedRoutines(root, entry.suggestedRoutines);
    },
  });

  root.querySelector("#show-suggested-btn")?.addEventListener("click", (e) => {
    renderSuggestedRoutines(root, catalogEntry.suggestedRoutines);
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
    const spaceId = readChipGroup(root, "assetSpaceId");
    const fields = {
      name: entry.name,
      catalogKey: entry.key,
      icon: entry.icon,
      spaceId,
      brand: root.querySelector("#f-asset-brand").value.trim() || null,
      purchaseDate: root.querySelector("#f-asset-purchased").value || null,
      warrantyUntil: root.querySelector("#f-asset-warranty").value || null,
      serviceIntervalDays: interval ? Number(interval) : null,
      vendorName: root.querySelector("#f-asset-vendor").value.trim() || null,
      vendorPhone: phone ? `tel:${phone}` : null,
    };

    const assetId = asset ? (updateAsset(asset.id, fields), asset.id) : addAsset(fields).id;

    const checkedIndices = [...root.querySelectorAll('#suggested-routines-field [data-routine-index][aria-pressed="true"]')]
      .map((b) => Number(b.dataset.routineIndex));
    let addedRoutines = 0;
    for (const i of checkedIndices) {
      const tmpl = currentSuggested[i];
      if (!tmpl) continue;
      // Same-room only — an AC filter routine in the Bedroom shouldn't
      // silently link to a filter item that happens to live in Utility
      // (2026-08-03, user request, same principle as the manual routine
      // builder's stock picker).
      const requiresItemIds = (tmpl.requiresItemKeys || [])
        .map((k) => getState().items.find((it) => it.catalogKey === k && it.spaceId === spaceId)?.id)
        .filter(Boolean);
      addRoutine({
        title: tmpl.title, spaceId, assetId, trigger: tmpl.trigger,
        effort: tmpl.effort, consequence: tmpl.consequence, ownerClass: tmpl.ownerClass, requiresItemIds,
      });
      addedRoutines += 1;
    }

    closeSheet();
    const routineNote = addedRoutines ? ` + ${addedRoutines} routine${addedRoutines === 1 ? "" : "s"}` : "";
    showToast((asset ? "Asset updated" : "Asset added") + routineNote);
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
