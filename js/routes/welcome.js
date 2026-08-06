// Welcome gate — the very first thing a new browser sees, before the tab
// shell exists. Two steps:
//
// 1. Sign-in: Google is real (build-plan Phase 4, 2026-08-05) via
//    auth.js's signInWithGoogle(). Apple is an honest placeholder — "we
//    can do later" per direct instruction, so it still just explains
//    that rather than pretending to work.
// 2. Household: join an existing one by its 6-char code, or create a new
//    one (hands off to the existing 6-question onboarding flow).
//
// Sign-in is mandatory (2026-08-06, user request: "let's make it
// mandatory to login to use the app... remove the skip for now... its
// either new household or join existing one") — there's no local-only
// path anymore, so this screen has no Skip option on either step. Gating
// is entirely Firebase Auth's own session persistence (boot.js's
// onAuthChange) — no localStorage flag needed.

import { signInWithGoogle } from "../auth.js";

let mountEl = null;
let step = "signin";
let onCreateNew = null;
let onJoin = null;

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
        <button type="button" class="btn btn-solid welcome-btn" id="google-btn">Sign in with Google</button>
        <button type="button" class="btn btn-ghost welcome-btn" id="apple-btn">Sign in with Apple</button>
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
  const googleBtn = document.getElementById("google-btn");
  googleBtn?.addEventListener("click", async () => {
    googleBtn.disabled = true;
    googleBtn.textContent = "Signing in…";
    try {
      // boot.js's onAuthChange listener picks up the resulting sign-in and
      // takes it from here (loads or asks for a household) — nothing else
      // to do in this handler on success.
      await signInWithGoogle();
    } catch (err) {
      googleBtn.disabled = false;
      googleBtn.textContent = "Sign in with Google";
      // A closed popup isn't really a failure worth a toast.
      if (err?.code !== "auth/popup-closed-by-user" && err?.code !== "auth/cancelled-popup-request") {
        showToast("Google sign-in didn't go through — try again.");
      }
    }
  });

  document.getElementById("apple-btn")?.addEventListener("click", () => {
    showToast("Apple sign-in is coming later — use Google for now.");
  });

  const codeInput = document.getElementById("f-join-code");
  codeInput?.addEventListener("input", () => {
    // Force uppercase, alphanumeric only, capped at 6 — matches the
    // generated code's own shape (state.js's generateHouseholdCode).
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  const joinBtn = document.getElementById("join-btn");
  joinBtn?.addEventListener("click", async () => {
    const code = codeInput?.value.trim();
    if (!code) {
      showToast("Enter a household code first");
      return;
    }
    if (!onJoin) {
      showToast("Sign in with Google first to join a household by code.");
      return;
    }
    joinBtn.disabled = true;
    joinBtn.textContent = "Joining…";
    try {
      await onJoin(code);
    } catch (err) {
      joinBtn.disabled = false;
      joinBtn.textContent = "Join household";
      showToast(err?.message || "Couldn't join — check the code and try again.");
    }
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

function mount(el, { onCreateNew: createNew, onJoin: join, startStep = "signin" } = {}) {
  mountEl = el;
  onCreateNew = createNew;
  onJoin = join;
  step = startStep;
  render();
}

export { mount };
