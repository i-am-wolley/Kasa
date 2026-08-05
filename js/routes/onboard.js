// Onboarding (memo §3.1) — six chip questions, generate, confirm-don't-
// create review. "The single highest-risk surface" per the memo: value
// before data entry, never a blank screen, everything rejectable in one
// tap. Sign-in (Step 1) is skipped — no auth yet (build-plan Phase 4).

import { loadPacks, generateFromArchetype } from "../packs.js";
import { seedHousehold, getState } from "../state.js";
import { chipGroup, readChipGroup, wireChipGroup, field, textInput, showToast } from "../ui/components.js";
import { Icon } from "../ui/icons.js";

const QUESTIONS = [
  { name: "homeType", label: "Home type", options: ["Apartment", "Independent house", "Villa", "Studio"] },
  { name: "size", label: "Size", options: ["1BHK", "2BHK", "3BHK", "4BHK+"] },
  { name: "whoLivesHere", label: "Who lives here", options: ["Just me", "Couple", "With kids", "With parents", "Shared"] },
  { name: "householdHelp", label: "Household help", options: ["None", "Maid", "Cook", "Both", "Maid+cook+driver"] },
];

const HAS_OPTIONS = ["Plants", "Pets", "Vehicle", "Balcony/garden"];

let mountEl = null;
let onDone = null;
let step = "questions";
let generated = null;
let removedSpaceIds = new Set();

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

function reviewHtml(state) {
  const bySpace = generated.spaces.map((sp) => ({
    space: sp,
    routines: generated.routines.filter((r) => r.spaceId === sp.id),
    items: generated.items.filter((i) => i.spaceId === sp.id),
    assets: generated.assets.filter((a) => a.spaceId === sp.id),
  }));

  const rows = bySpace
    .map(({ space, routines, items, assets }) => {
      const removed = removedSpaceIds.has(space.id);
      return `
      <div class="list-row" style="opacity:${removed ? 0.4 : 1};cursor:default;">
        <div class="occ-row-icon">${Icon(space.icon, { size: 18 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title named">${space.name}</div>
          <div class="occ-row-meta">${routines.length} routines · ${items.length} stock · ${assets.length} assets</div>
        </div>
        <button class="chip" data-toggle-space="${space.id}" aria-pressed="${removed}">${removed ? "Removed" : "Keep"}</button>
      </div>
    `;
    })
    .join("");

  return `
    <div class="topbar"><h1>Here's your house</h1></div>
    <div class="today-section" style="padding-top:0;">
      <p style="color:var(--ink-muted);margin-bottom:20px;">Everything here is a suggestion — remove a whole room in one tap, fine-tune anything later.</p>
      ${rows}
      <button class="btn btn-solid" id="confirm-btn" style="width:100%;margin-top:16px;">Looks good — take me to Today</button>
    </div>
  `;
}

function render() {
  const state = getState();
  if (step === "questions") mountEl.innerHTML = questionsHtml();
  else if (step === "generating") mountEl.innerHTML = generatingHtml();
  else mountEl.innerHTML = reviewHtml(state);
  wireEvents();
}

function requiredAnswersComplete(root) {
  return QUESTIONS.every((q) => readChipGroup(root, q.name));
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
      generated = generateFromArchetype(answers, packs);
      generated.answers = answers;
      removedSpaceIds = new Set();

      await new Promise((r) => setTimeout(r, 600));
      step = "review";
      render();
    });
  }

  if (step === "review") {
    root.querySelectorAll("[data-toggle-space]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.toggleSpace;
        if (removedSpaceIds.has(id)) removedSpaceIds.delete(id);
        else removedSpaceIds.add(id);
        render();
      });
    });

    document.getElementById("confirm-btn").addEventListener("click", () => {
      const keptSpaceIds = new Set(generated.spaces.filter((s) => !removedSpaceIds.has(s.id)).map((s) => s.id));
      const packVersions = Object.fromEntries(generated.usedPackIds.map((id) => [id, 1]));
      seedHousehold({
        spaces: generated.spaces.filter((s) => keptSpaceIds.has(s.id)),
        items: generated.items.filter((i) => keptSpaceIds.has(i.spaceId)),
        assets: generated.assets.filter((a) => keptSpaceIds.has(a.spaceId)),
        routines: generated.routines.filter((r) => keptSpaceIds.has(r.spaceId)),
        answers: generated.answers,
        packVersions,
      });
      step = "questions";
      // seedHousehold() generates a fresh 6-char code (state.js) — surfaced
      // here so a brand-new household sees it once, same "nice and smooth"
      // first-run spirit the welcome gate asks for (2026-08-05).
      showToast(`Household created — code ${getState().household.code}`, { durationMs: 4000 });
      onDone?.();
    });
  }
}

function mount(el, { onDone: done } = {}) {
  mountEl = el;
  onDone = done;
  step = "questions";
  generated = null;
  removedSpaceIds = new Set();
  render();
}

export { mount };
