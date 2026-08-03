// Shared UI primitives — template-literal string builders (no framework,
// no JSX; per memo §1.1). Callers assign the returned HTML via innerHTML
// and wire listeners against `data-*` attributes afterwards. Component
// shapes ported from Miso (Card/Pill/Badge/Toast) — see
// ~/.claude/skills/miso-design/components/. Filled in incrementally as
// screens need them; this is the Phase 0-1 subset.

import { Icon } from "./icons.js";
import { findMatches, findExact, getOrCreate } from "../catalog.js";

// Minimal, light haptic feedback (2026-08-03, user request) — a short
// single pulse, not a pattern. navigator.vibrate is Android-Chrome-only
// (iOS Safari has no Vibration API at all), so this is silently a no-op
// there rather than an error; feature-detected once per call, no fallback
// needed.
function haptic(ms = 8) {
  navigator.vibrate?.(ms);
}

function chip(label, { active = false, dataAttrs = "" } = {}) {
  return `<button class="chip" aria-pressed="${active}" ${dataAttrs}>${label}</button>`;
}

function badge(label, tier = "cosmetic") {
  const color = `var(--tier-${tier})`;
  const bg = tier === "cosmetic" ? "var(--surface-sunk)" : `color-mix(in srgb, ${color} 14%, transparent)`;
  const fg = tier === "cosmetic" ? "var(--ink-muted)" : color;
  return `<span style="display:inline-flex;align-items:center;padding:3px 9px;font-size:var(--fs-micro);font-weight:var(--fw-bold);border-radius:var(--radius-full);background:${bg};color:${fg};">${label}</span>`;
}

function emptyState({ message, actionLabel, dataAction = "" }) {
  return `
    <div class="empty-state">
      <p>${message}</p>
      ${actionLabel ? `<button class="btn btn-tinted" data-action="${dataAction}">${actionLabel}</button>` : ""}
    </div>
  `;
}

function listRow({ icon, title, meta, right = "", dataAttrs = "" }) {
  return `
    <div class="list-row" ${dataAttrs}>
      ${icon ? `<div class="occ-row-icon">${icon}</div>` : ""}
      <div class="occ-row-body">
        <div class="occ-row-title named">${title}</div>
        ${meta ? `<div class="occ-row-meta">${meta}</div>` : ""}
      </div>
      ${right ? `<div class="list-row-right">${right}</div>` : ""}
    </div>
  `;
}

function stepper(value, { min = 0, dataAttrs = "" } = {}) {
  return `
    <div class="stepper" ${dataAttrs}>
      <button class="stepper-btn" data-step="-1" ${value <= min ? "disabled" : ""}>−</button>
      <span class="stepper-value font-num">${value}</span>
      <button class="stepper-btn" data-step="1">+</button>
    </div>
  `;
}

// ---- Sheet form fields — labeled input / chip-group, for add/edit sheets ----

function field(label, inputHtml) {
  return `<label class="field"><span class="field-label">${label}</span>${inputHtml}</label>`;
}

function textInput({ id, value = "", placeholder = "", type = "text", min = null }) {
  return `<input class="text-input" id="${id}" type="${type}" value="${value}" placeholder="${placeholder}" ${min !== null ? `min="${min}"` : ""} />`;
}

// ---- Catalog typeahead — the name field for items/assets. Typing surfaces
// matching catalog entries to select (reuses their key + icon); if nothing
// is selected, saving mints a new catalog entry instead of a bare string,
// so the same real-world thing always resolves to the same key next time
// it's typed (see js/catalog.js). ------------------------------------------

function catalogField({ id, type, value = "", placeholder = "" }) {
  return `
    <div style="position:relative;">
      <input class="text-input" id="${id}" type="text" value="${value}" placeholder="${placeholder}" autocomplete="off" />
      <div class="catalog-suggestions" id="${id}-suggestions" style="display:none;"></div>
    </div>
  `;
}

function renderCatalogSuggestions(input, dropdown, type, onSelect) {
  const matches = findMatches(input.value, type);
  if (!matches.length) {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    return;
  }
  dropdown.innerHTML = matches
    .map(
      (m) => `
      <button type="button" class="catalog-suggestion" data-key="${m.key}">
        ${Icon(m.icon, { size: 16 })}
        <span>${m.name}</span>
      </button>`,
    )
    .join("");
  dropdown.style.display = "block";
  // pointerdown, not mousedown/click (2026-08-03, user report: catalog
  // selection "had issue in phone") — on real touch, mousedown's ordering
  // relative to the input's own blur is inconsistent across mobile
  // browsers, which is exactly the kind of thing that shows up as "usually
  // works, sometimes doesn't." pointerdown is the unified pointer-events
  // entry point and fires before blur when preventDefault is called on it.
  dropdown.querySelectorAll("[data-key]").forEach((btn, i) => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault(); // stops the input from blurring before this runs
      const entry = matches[i];
      input.value = entry.name;
      input.dataset.catalogKey = entry.key;
      dropdown.style.display = "none";
      onSelect?.(entry);
    });
  });
}

function wireCatalogField(root, id, type, { onSelect } = {}) {
  const input = root.querySelector(`#${id}`);
  const dropdown = root.querySelector(`#${id}-suggestions`);
  if (!input || !dropdown) return;
  input.addEventListener("input", () => {
    delete input.dataset.catalogKey;
    renderCatalogSuggestions(input, dropdown, type, onSelect);
  });
  input.addEventListener("focus", () => renderCatalogSuggestions(input, dropdown, type, onSelect));
  // Widened from 100ms — a bit more headroom for slower devices where the
  // pointerdown->onSelect handler above hasn't finished before blur fires.
  input.addEventListener("blur", () => {
    setTimeout(() => { dropdown.style.display = "none"; }, 180);
  });
}

// Resolves the field's current value to a catalog entry — the selected
// suggestion if the text still matches it exactly, otherwise a fresh
// lookup-or-create (typing an existing name without clicking a suggestion
// still resolves to the same key via findExact inside getOrCreate).
function resolveCatalogField(root, id, type) {
  const input = root.querySelector(`#${id}`);
  if (!input || !input.value.trim()) return null;
  if (input.dataset.catalogKey) {
    const entry = findExact(input.value, type);
    if (entry && entry.key === input.dataset.catalogKey) return entry;
  }
  return getOrCreate(input.value, type);
}

function chipGroup({ name, options, value, multi = false }) {
  return `
    <div class="chip-group" data-field="${name}" data-multi="${multi}">
      ${options
        .map((opt) => {
          const optValue = typeof opt === "object" ? opt.value : opt;
          const optLabel = typeof opt === "object" ? opt.label : opt;
          const active = multi ? (value || []).includes(optValue) : value === optValue;
          return `<button type="button" class="chip" aria-pressed="${active}" data-value="${optValue}">${optLabel}</button>`;
        })
        .join("")}
    </div>
  `;
}

function readChipGroup(root, name) {
  const group = root.querySelector(`[data-field="${name}"]`);
  if (!group) return null;
  const active = [...group.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.value);
  return group.dataset.multi === "true" ? active : active[0] ?? null;
}

function wireChipGroup(root, name) {
  const group = root.querySelector(`[data-field="${name}"]`);
  if (!group) return;
  const multi = group.dataset.multi === "true";
  group.querySelectorAll("[data-value]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!multi) {
        group.querySelectorAll("[data-value]").forEach((b) => b.setAttribute("aria-pressed", "false"));
      }
      btn.setAttribute("aria-pressed", btn.getAttribute("aria-pressed") === "true" ? "false" : "true");
    });
  });
}

function sheetActions({ saveLabel = "Save", showDelete = false }) {
  return `
    <div class="sheet-actions">
      ${showDelete ? `<button type="button" class="btn btn-danger" data-action="delete">Delete</button>` : ""}
      <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
      <button type="button" class="btn btn-solid" data-action="save" style="flex:1;">${saveLabel}</button>
    </div>
  `;
}

// ---- Toast — imperative, since it's transient and outlives any one render ----

let toastTimer = null;

function showToast(message, { durationMs = 5000, onUndo = null } = {}) {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }
  root.innerHTML = `
    <div class="toast" id="active-toast" style="display:flex;align-items:center;gap:14px;">
      <span>${message}</span>
      ${onUndo ? `<button id="toast-undo" style="background:none;border:none;color:var(--gold);font-weight:var(--fw-bold);font-size:var(--fs-sm);cursor:pointer;padding:0;">Undo</button>` : ""}
    </div>
  `;
  if (onUndo) {
    document.getElementById("toast-undo").addEventListener("click", () => {
      onUndo();
      dismissToast(root);
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dismissToast(root), durationMs);
}

function dismissToast(root) {
  const el = document.getElementById("active-toast");
  if (!el) return;
  el.classList.add("leaving");
  setTimeout(() => { root.innerHTML = ""; }, 180);
}

// ---- Sheet — bottom sheet (phone) / centered modal (tablet+) ---------------

function openSheet({ title, bodyHtml }) {
  let root = document.getElementById("sheet-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "sheet-root";
    document.body.appendChild(root);
  }
  root.innerHTML = `
    <div class="sheet-backdrop" id="sheet-backdrop">
      <div class="sheet" role="dialog" aria-modal="true">
        ${title ? `<div class="sheet-title">${title}</div>` : ""}
        ${bodyHtml}
      </div>
    </div>
  `;
  document.getElementById("sheet-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "sheet-backdrop") closeSheet();
  });
  // Generic — every sheetActions() include a Cancel button, wired once
  // here instead of by each of the ~8 callers.
  root.querySelector('[data-action="cancel"]')?.addEventListener("click", closeSheet);
}

function closeSheet() {
  const root = document.getElementById("sheet-root");
  if (root) root.innerHTML = "";
}

export {
  haptic,
  chip,
  badge,
  emptyState,
  listRow,
  stepper,
  field,
  textInput,
  catalogField,
  wireCatalogField,
  resolveCatalogField,
  chipGroup,
  readChipGroup,
  wireChipGroup,
  sheetActions,
  showToast,
  openSheet,
  closeSheet,
};
