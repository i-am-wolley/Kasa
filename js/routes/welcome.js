// Welcome gate (2026-08-05, user request) — the very first thing a new
// browser sees, before the tab shell exists. Two steps:
//
// 1. Sign-in: Google/Apple are honest placeholders (show what's coming,
//    don't pretend it works) — only "Skip for now" actually advances.
//    No real auth exists yet (build-plan Phase 4), so there's no "already
//    signed in, load their household" branch to reach in practice; the
//    household step below is what both "not signed in" and "signed in but
//    no household yet" converge on, matching the flow the user described.
// 2. Household: join an existing one by its 6-char code (a real UI, but a
//    stub action — looking a code up needs Firestore, Phase 4) or create a
//    new one, which hands off to the existing 6-question onboarding flow.
//
// Gated behind a localStorage flag in boot.js so this only ever shows once
// per browser, not on every reload — see boot.js's `showWelcome`/`startApp`.

let mountEl = null;
let step = "signin";
let onCreateNew = null;

function markHtml() {
  return `
    <div class="welcome-mark">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="5.5" />
        <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    </div>
  `;
}

function signinHtml() {
  return `
    <div class="welcome-screen">
      ${markHtml()}
      <div class="welcome-wordmark">kasa</div>
      <p class="welcome-tagline">A model of your home — what depletes, what recurs, what ages. Kasa warns before anything fails.</p>
      <div class="welcome-actions">
        <button type="button" class="btn btn-solid welcome-btn" id="google-btn">Continue with Google</button>
        <button type="button" class="btn btn-ghost welcome-btn" id="apple-btn">Continue with Apple</button>
        <button type="button" class="welcome-skip" id="skip-btn">Skip for now</button>
      </div>
    </div>
  `;
}

function householdHtml() {
  return `
    <div class="welcome-screen">
      ${markHtml()}
      <div class="welcome-wordmark" style="font-size:var(--fs-heading);">Your household</div>
      <p class="welcome-tagline">Join one that already exists, or start a new one.</p>
      <div class="welcome-actions">
        <input class="text-input welcome-code-input" id="f-join-code" placeholder="ABC123" maxlength="6" autocomplete="off" autocapitalize="characters" />
        <button type="button" class="btn btn-ghost welcome-btn" id="join-btn">Join household</button>
        <div class="welcome-or">or</div>
        <button type="button" class="btn btn-solid welcome-btn" id="create-btn">Create a new household</button>
      </div>
    </div>
  `;
}

function render() {
  mountEl.innerHTML = step === "signin" ? signinHtml() : householdHtml();
  wireEvents();
}

function wireEvents() {
  document.getElementById("google-btn")?.addEventListener("click", () => {
    showPlaceholderToast();
  });
  document.getElementById("apple-btn")?.addEventListener("click", () => {
    showPlaceholderToast();
  });
  document.getElementById("skip-btn")?.addEventListener("click", () => {
    step = "household";
    render();
  });

  const codeInput = document.getElementById("f-join-code");
  codeInput?.addEventListener("input", () => {
    // Force uppercase, alphanumeric only, capped at 6 — matches the
    // generated code's own shape (state.js's generateHouseholdCode).
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  document.getElementById("join-btn")?.addEventListener("click", () => {
    const code = codeInput?.value.trim();
    if (!code) {
      showToast("Enter a household code first");
      return;
    }
    showToast("Joining a household needs Firebase (Phase 4) — not built yet. Try creating a new one instead.");
  });

  document.getElementById("create-btn")?.addEventListener("click", () => {
    onCreateNew?.();
  });
}

// Minimal inline toast — welcome.js intentionally doesn't import
// ui/components.js's showToast, since that toast root and this screen's
// own root both live under #screen-mount and this needs to work before
// the rest of the app's chrome (and its toast-root append target) is
// necessarily meaningful; a tiny self-contained version avoids coupling
// this very-first-screen to anything else's assumptions.
let toastTimer = null;
function showToast(message) {
  let root = document.getElementById("welcome-toast");
  if (!root) {
    root = document.createElement("div");
    root.id = "welcome-toast";
    root.className = "toast";
    document.body.appendChild(root);
  }
  root.textContent = message;
  root.classList.remove("leaving");
  root.style.display = "flex";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    root.classList.add("leaving");
    setTimeout(() => { root.style.display = "none"; }, 180);
  }, 3200);
}

function showPlaceholderToast() {
  showToast("Sign-in isn't built yet — needs Firebase (Phase 4). Use Skip for now.");
}

function mount(el, { onCreateNew: createNew } = {}) {
  mountEl = el;
  onCreateNew = createNew;
  step = "signin";
  render();
}

export { mount };
