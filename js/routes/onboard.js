// Onboarding (memo §3.1) — six chip questions, generate, then a room-only
// review (2026-08-06, user request: "allow options to add spaces (some
// defaults) automatically, but let's not add any assets/routines/tasks/
// habits — doesn't make sense"). Sign-in (Step 1) is skipped here — that's
// welcome.js's own job now (build-plan Phase 4).
//
// Reused for two contexts (2026-08-06): "household" (welcome.js's Create
// new / More's Re-run onboarding — the existing behavior) and "house"
// (houses.js's Add house, new this round — same wizard, different target
// and toast copy, since nothing about the household's own code changes).

import { loadPacks, generateFromArchetype } from "../packs.js";
import { seedHousehold, getState, genId, MANDATORY_SPACE_TYPES } from "../state.js";
import { chipGroup, readChipGroup, wireChipGroup, field, textInput, showToast, openSheet, closeSheet, sheetActions } from "../ui/components.js";
import { Icon } from "../ui/icons.js";
import { SPACE_TYPES } from "./house.js";

const QUESTIONS = [
  { name: "homeType", label: "Home type", options: ["Apartment", "Independent house", "Villa", "Studio"] },
  { name: "size", label: "Size", options: ["1RK", "1BHK", "2BHK", "3BHK", "4BHK+"] },
  { name: "whoLivesHere", label: "Who lives here", options: ["Just me", "Couple", "With kids", "With parents", "Shared"] },
  { name: "householdHelp", label: "Household help", options: ["None", "Maid", "Cook", "Both", "Maid+cook+driver"] },
];

const HAS_OPTIONS = ["Plants", "Pets", "Vehicle", "Balcony/garden"];

// Types offered when adding a room by hand in review — Whole home/Utility
// are always-included defaults, not something you'd deliberately add a
// second one of here.
const ADDABLE_SPACE_TYPES = SPACE_TYPES.filter((t) => !MANDATORY_SPACE_TYPES.includes(t.value));

let mountEl = null;
let onDone = null;
let context = "household"; // "household" | "house" — toast copy differs, see confirm handler
let step = "questions";
let generated = null; // { answers, usedPackIds } — spaces/items/assets/routines from generateFromArchetype, only .spaces actually used
let spaces = []; // the working, user-editable room list for review

function questionsHtml() {
  return `
    <div class="topbar"><h1>Tell us about your home</h1></div>
    <div class="today-section" style="padding-top:0;">
      <p style="color:var(--ink-muted);margin-bottom:20px;">Six taps, no typing except your city — about 40 seconds.</p>
      <form id="onboard-form">
        ${QUESTIONS.map((q) => field(q.label, chipGroup({ name: q.name, options: q.options, value: null }))).join("")}
        ${field("Do you have", chipGroup({ name: "has", options: HAS_OPTIONS, value: [], multi: true }))}
        ${field("City", textInput({ id: "f-city", placeholder: "e.g. Bengaluru" }))}
      </form>
      <button class="btn btn-solid" id="generate-btn" style="width:100%;" disabled>${Icon("sparkle", { size: 16 })} Generate my house</button>
    </div>
  `;
}

function generatingHtml() {
  return `
    <div class="topbar"><h1>Building your house</h1></div>
    <div class="today-section">
      <div class="skeleton" style="height:64px;margin-bottom:8px;"></div>
      <div class="skeleton" style="height:64px;margin-bottom:8px;"></div>
      <div class="skeleton" style="height:64px;margin-bottom:8px;"></div>
    </div>
  `;
}

// Rooms only — no assets/stock/routines at this step (2026-08-06, direct
// instruction). Same square-tile grid as House's own space grid, not the
// old "N routines · N stock · N assets" strip-row review, per direct
// request. Whole home/Utility get House's own lock badge instead of a
// remove button — always included, never deleted here either.
function reviewHtml() {
  const cards = spaces
    .map((sp) => {
      const locked = MANDATORY_SPACE_TYPES.includes(sp.type);
      return `
    <div class="tile" data-space-id="${sp.id}">
      ${locked ? `<div class="tile-badge" title="Always included">${Icon("lock", { size: 11 })}</div>` : `<button type="button" class="tile-remove" data-remove-space="${sp.id}" aria-label="Remove ${sp.name}">${Icon("trash", { size: 11 })}</button>`}
      <div class="tile-icon">${Icon(sp.icon || "house", { size: 18 })}</div>
      <div class="tile-title named">${sp.name}</div>
    </div>
  `;
    })
    .join("");

  return `
    <div class="topbar"><h1>Here's your house</h1></div>
    <div class="today-section" style="padding-top:0;">
      <p style="color:var(--ink-muted);margin-bottom:16px;">These are the rooms we'll set up — add, remove, or rename any of them. Stock, assets, and routines come next, room by room, once you're in.</p>
      <div class="tile-grid">${cards}</div>
      <button type="button" class="btn btn-tinted" id="add-review-space-btn" style="width:100%;margin-top:16px;">${Icon("plus", { size: 16 })} Add a room</button>
      <button type="button" class="btn btn-solid" id="confirm-btn" style="width:100%;margin-top:12px;">Looks good — take me to Today</button>
    </div>
  `;
}

function render() {
  if (step === "questions") mountEl.innerHTML = questionsHtml();
  else if (step === "generating") mountEl.innerHTML = generatingHtml();
  else mountEl.innerHTML = reviewHtml();
  wireEvents();
}

function requiredAnswersComplete(root) {
  return QUESTIONS.every((q) => readChipGroup(root, q.name));
}

// Checked against the local working `spaces` list — nothing here is in
// global state yet (2026-08-06, same "don't allow two spaces to have the
// same name" rule state.js's addSpace/updateSpace enforce for the real
// House screen).
function roomNameTaken(name, excludeId = null) {
  const trimmed = name.trim().toLowerCase();
  return spaces.some((s) => s.id !== excludeId && s.name.trim().toLowerCase() === trimmed);
}

function openAddRoomSheet() {
  openSheet({
    title: "Add a room",
    bodyHtml: `
      <form id="add-room-form">
        ${field("Name", textInput({ id: "f-room-name", placeholder: "e.g. Guest bedroom" }))}
        ${field("Type", chipGroup({ name: "roomType", options: ADDABLE_SPACE_TYPES, value: "living" }))}
      </form>
      ${sheetActions({ saveLabel: "Add room" })}
    `,
  });
  const root = document.getElementById("sheet-root");
  wireChipGroup(root, "roomType");
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const name = root.querySelector("#f-room-name").value.trim();
    if (!name) return;
    if (roomNameTaken(name)) {
      showToast(`There's already a room named "${name}" — try another name`);
      return;
    }
    const type = readChipGroup(root, "roomType");
    spaces.push({ id: genId("sp"), name, type, icon: type === "whole_home" ? "wholeHome" : type, order: spaces.length + 1, active: true });
    closeSheet();
    render();
  });
}

function openRenameRoomSheet(sp) {
  openSheet({
    title: "Rename room",
    bodyHtml: `
      <form id="rename-room-form">${field("Name", textInput({ id: "f-room-rename", value: sp.name }))}</form>
      ${sheetActions({ saveLabel: "Save" })}
    `,
  });
  const root = document.getElementById("sheet-root");
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const name = root.querySelector("#f-room-rename").value.trim();
    if (!name) return;
    if (roomNameTaken(name, sp.id)) {
      showToast(`There's already a room named "${name}" — try another name`);
      return;
    }
    sp.name = name;
    closeSheet();
    render();
  });
}

function wireEvents() {
  const root = mountEl;

  if (step === "questions") {
    QUESTIONS.forEach((q) => wireChipGroup(root, q.name));
    wireChipGroup(root, "has");

    const generateBtn = document.getElementById("generate-btn");
    const updateEnabled = () => { generateBtn.disabled = !requiredAnswersComplete(root); };
    root.querySelectorAll("[data-field] [data-value]").forEach((btn) => btn.addEventListener("click", updateEnabled));

    generateBtn.addEventListener("click", async () => {
      const answers = {
        homeType: readChipGroup(root, "homeType"),
        size: readChipGroup(root, "size"),
        whoLivesHere: readChipGroup(root, "whoLivesHere"),
        householdHelp: readChipGroup(root, "householdHelp"),
        has: readChipGroup(root, "has") || [],
        city: document.getElementById("f-city").value.trim() || "Bengaluru",
      };
      step = "generating";
      render();

      const packs = await loadPacks();
      const result = generateFromArchetype(answers, packs);
      generated = { answers, usedPackIds: result.usedPackIds };
      spaces = result.spaces; // rooms only — items/assets/routines are deliberately discarded

      await new Promise((r) => setTimeout(r, 600));
      step = "review";
      render();
    });
  }

  if (step === "review") {
    document.getElementById("add-review-space-btn").addEventListener("click", openAddRoomSheet);

    root.querySelectorAll("[data-remove-space]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        spaces = spaces.filter((s) => s.id !== btn.dataset.removeSpace);
        render();
      });
    });

    root.querySelectorAll("[data-space-id]").forEach((tile) => {
      tile.addEventListener("click", () => {
        const sp = spaces.find((s) => s.id === tile.dataset.spaceId);
        if (sp) openRenameRoomSheet(sp);
      });
    });

    document.getElementById("confirm-btn").addEventListener("click", () => {
      const packVersions = Object.fromEntries(generated.usedPackIds.map((id) => [id, 1]));
      seedHousehold({
        spaces,
        items: [], assets: [], routines: [],
        answers: generated.answers,
        packVersions,
      });
      step = "questions";
      if (context === "household") {
        // seedHousehold() generates a fresh 6-char code (state.js) only the
        // first time a household is ever created — surfaced here so a
        // brand-new household sees it once.
        showToast(`Household created — code ${getState().household.code}`, { durationMs: 4000 });
      } else {
        showToast("House set up — add stock, assets, and routines room by room whenever you're ready.");
      }
      onDone?.();
    });
  }
}

function mount(el, { onDone: done, context: ctx = "household" } = {}) {
  mountEl = el;
  onDone = done;
  context = ctx;
  step = "questions";
  generated = null;
  spaces = [];
  render();
}

export { mount };
