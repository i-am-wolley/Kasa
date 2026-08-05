// Boot — init, router mount (memo §1.1), auth-gated (build-plan Phase 4,
// 2026-08-05 — Google sign-in + Firestore persistence; see auth.js/db.js).

import { Icon } from "./ui/icons.js";
import { loadPacks } from "./packs.js";
import { getState, subscribe, setActiveHouseIds, hydrateState, resetForNewHousehold, byId } from "./state.js";
import { onAuthChange, completeRedirectSignIn, signOutUser } from "./auth.js";
import { getUserRecord, createHouseholdRemote, joinHouseholdRemote, loadHouseholdRemote, startAutoSave } from "./db.js";
import { openSheet, closeSheet, field, chipGroup, wireChipGroup, readChipGroup, sheetActions, showToast } from "./ui/components.js";
import { mount as mountToday } from "./routes/today.js";
import { mount as mountHouse } from "./routes/house.js";
import { mount as mountStock } from "./routes/stock.js";
import { mount as mountInsights } from "./routes/insights.js";
import { mount as mountWishlist } from "./routes/wishlist.js";
import { mount as mountPeople } from "./routes/people.js";
import { mount as mountAssets } from "./routes/assets.js";
import { mount as mountHouses } from "./routes/houses.js";
import { mount as mountOnboard } from "./routes/onboard.js";
import { mount as mountWelcome } from "./routes/welcome.js";

// A new browser sees Welcome → Join/Create household → the existing
// 6-question onboarding, every time there's no session (2026-08-05, user
// request: "bring the onboarding as first page for new users"; 2026-08-06,
// user request: "make it mandatory to login... remove the skip"). Gating
// is entirely Firebase Auth's own session persistence, resolved via
// onAuthChange below — no localStorage flag, no local-only path anymore.
// The signed-in user driving the current session — kept here so
// onboard.js's onDone callback and the household step's onCreateNew/
// onJoin can write through to Firestore, and so the More sheet can offer
// Sign out.
let currentUser = null;

// Wishlist takes the 5th tab slot that "More" used to occupy — More moved
// to a top-left header button instead (2026-08-03, user request), freeing
// the slot for a primary, frequently-visited feature rather than a menu.
const TABS = [
  { id: "today", icon: "today", label: "Today" },
  { id: "house", icon: "house", label: "House" },
  { id: "stock", icon: "stock", label: "Stock" },
  { id: "insights", icon: "insights", label: "Insights" },
  { id: "wishlist", icon: "wishlist", label: "Wishlist" },
];

// Screens reachable from the header's More button — not primary tabs
// (memo §8.1: 5-tab limit; People/Assets/onboarding live one level down).
const MORE_ITEMS = [
  { id: "assets", icon: "warranty", label: "Assets", meta: "Service schedule, warranties, vendors" },
  { id: "houses", icon: "house", label: "Houses", meta: "Add, rename, or delete houses in this household" },
  { id: "people", icon: "person", label: "People & Household", meta: "Members, help, leave, habits, household code" },
  { id: "onboard", icon: "sparkle", label: "Re-run onboarding", meta: "Rebuild the currently-viewed house from six questions" },
];

let activeTab = "today";

function renderTabBar(el) {
  el.innerHTML = TABS.map(
    (t) => `
    <button class="tabbar-item" data-tab="${t.id}" ${t.id === activeTab ? 'aria-current="page"' : ""}>
      ${Icon(t.icon, { size: 22 })}
      <span>${t.label}</span>
    </button>
  `,
  ).join("");

  el.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function renderPlaceholder(el, title, note) {
  el.innerHTML = `
    <div class="topbar"><h1>${title}</h1></div>
    <div class="empty-state"><p>${note}</p></div>
  `;
}

function openMoreSheet() {
  // Household code surfaced here (2026-08-05) rather than only in the
  // one-time creation toast — somewhere to actually find it again later.
  const code = getState().household.code;
  openSheet({
    title: "More",
    bodyHtml: `
      ${code ? `<p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-bottom:12px;">Household code: <span class="font-num" style="color:var(--ink-muted);letter-spacing:0.1em;">${code}</span></p>` : ""}
      <div>
        ${MORE_ITEMS.map(
          (item) => `
          <div class="list-row" data-more-item="${item.id}" style="margin-bottom:8px;">
            <div class="occ-row-icon">${Icon(item.icon, { size: 18 })}</div>
            <div class="occ-row-body">
              <div class="occ-row-title">${item.label}</div>
              <div class="occ-row-meta">${item.meta}</div>
            </div>
            ${Icon("chevronRight", { size: 16 })}
          </div>
        `,
        ).join("")}
      </div>
      ${currentUser ? `
        <div class="list-row" id="sign-out-row" style="margin-bottom:8px;">
          <div class="occ-row-icon">${Icon("person", { size: 18 })}</div>
          <div class="occ-row-body">
            <div class="occ-row-title">Sign out</div>
            <div class="occ-row-meta">Signed in as ${currentUser.email || "your Google account"}</div>
          </div>
        </div>
      ` : ""}
      <p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-top:4px;">Modes, notifications, and export live here in a later phase.</p>
    `,
  });
  document.getElementById("sign-out-row")?.addEventListener("click", async () => {
    closeSheet();
    await signOutUser();
    location.reload();
  });
  document.querySelectorAll("[data-more-item]").forEach((row) => {
    row.addEventListener("click", () => {
      closeSheet();
      mountScreen(row.dataset.moreItem);
    });
  });
}

// House picker (2026-08-05, user request: "an option to select on the top,
// same line as logo, left of more, to select one house or multiple
// houses"). Hidden entirely for the common single-house household —
// nothing to pick between yet. Multi-select, not single-choice ("one
// house or multiple houses") — defaults to every house selected, same as
// there being no filter at all for a single-house household.
function renderHouseBtn() {
  const state = getState();
  const btn = document.getElementById("app-house-btn");
  if (!btn) return;
  if (state.houses.length < 2) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  const active = state.household.activeHouseIds?.length ? state.household.activeHouseIds : state.houses.map((h) => h.id);
  const label =
    active.length >= state.houses.length ? "All houses"
    : active.length === 1 ? (byId(state.houses, active[0])?.name || "House")
    : `${active.length} houses`;
  btn.innerHTML = `${Icon("house", { size: 14 })} <span>${label}</span>`;
}

function openHousePickerSheet() {
  const state = getState();
  const active = state.household.activeHouseIds?.length ? state.household.activeHouseIds : state.houses.map((h) => h.id);
  openSheet({
    title: "Houses",
    bodyHtml: `
      <p style="color:var(--ink-muted);margin-bottom:16px;">View one house at a time, or select several to see them together.</p>
      ${field("Showing", chipGroup({ name: "houseFilter", options: state.houses.map((h) => ({ value: h.id, label: h.name })), value: active, multi: true }))}
      ${sheetActions({ saveLabel: "Done" })}
    `,
  });
  const root = document.getElementById("sheet-root");
  wireChipGroup(root, "houseFilter");
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const ids = readChipGroup(root, "houseFilter") || [];
    if (!ids.length) {
      showToast("Pick at least one house");
      return;
    }
    setActiveHouseIds(ids);
    closeSheet();
  });
}

function mountScreen(screenId) {
  const screenEl = document.getElementById("screen-mount");
  switch (screenId) {
    case "today":
      mountToday(screenEl);
      break;
    case "house":
      mountHouse(screenEl);
      break;
    case "stock":
      mountStock(screenEl);
      break;
    case "insights":
      mountInsights(screenEl);
      break;
    case "wishlist":
      mountWishlist(screenEl);
      break;
    case "people":
      mountPeople(screenEl, { onBack: () => switchTab(activeTab) });
      break;
    case "assets":
      mountAssets(screenEl, { onBack: () => switchTab(activeTab) });
      break;
    case "houses":
      mountHouses(screenEl, { onBack: () => switchTab(activeTab) });
      break;
    case "onboard":
      // "Re-run onboarding" from More always targets the currently-viewed
      // house, never creates a new household — context: "house" so the
      // completion toast reflects that (2026-08-06).
      mountOnboard(screenEl, { context: "house", onDone: () => switchTab("today") });
      break;
    default:
      renderPlaceholder(screenEl, screenId, "Not built yet.");
  }
}

function switchTab(tabId) {
  activeTab = tabId;
  mountScreen(tabId);
  renderTabBar(document.getElementById("tabbar"));
}

// The tab bar and header "More" button don't make sense before a
// household exists — left empty/hidden during Welcome and first-run
// onboarding rather than showing 5 tabs with nothing behind them yet.
function showWelcome() {
  document.getElementById("tabbar").innerHTML = "";
  document.getElementById("app-more-btn").style.display = "none";
  // The signin step has no Create/Join of its own anymore (mandatory
  // login, 2026-08-06) — those only ever show once boot.js's onAuthChange
  // re-mounts this at startStep:"household" for a real signed-in user
  // (see showHouseholdStep below), so no callbacks are needed here.
  mountWelcome(document.getElementById("screen-mount"), {});
}

// A signed-in user with no household on record yet (fresh Google sign-in,
// or a returning session that never finished creating/joining one) skips
// straight to the household step — sign-in is already done, no reason to
// ask again. There's no local-only fallback anymore (2026-08-06, login is
// mandatory) — Create or Join are the only two ways through.
function showHouseholdStep(user) {
  document.getElementById("tabbar").innerHTML = "";
  document.getElementById("app-more-btn").style.display = "none";
  mountWelcome(document.getElementById("screen-mount"), {
    startStep: "household",
    onCreateNew: () => showFirstRunOnboarding(user),
    onJoin: (code) => joinAndEnter(code, user),
  });
}

function showFirstRunOnboarding(user) {
  // A genuinely new household (real sign-in, no prior Firestore record) —
  // clear the mock demo's people/tasks/habits/wishlist before the user
  // even sees the six questions, and seed them as the household's first
  // member using their real Google name/email (2026-08-06, user report:
  // "I see old tasks and habit still... needs to be empty," "remove the
  // help, need to start blank").
  resetForNewHousehold({ name: user.displayName, email: user.email });
  mountOnboard(document.getElementById("screen-mount"), {
    context: "household",
    onDone: async () => {
      const state = getState();
      try {
        await createHouseholdRemote({ code: state.household.code, uid: user.uid, email: user.email, name: state.household.name });
        startAutoSave(state.household.code);
        currentUser = user;
      } catch (err) {
        console.warn("[kasa] couldn't save new household to Firestore:", err);
        showToast("Signed in, but couldn't reach Firestore just now — your data is safe on this device, it just isn't synced yet.");
      }
      startApp();
    },
  });
}

async function joinAndEnter(code, user) {
  await joinHouseholdRemote({ code, uid: user.uid, email: user.email });
  const data = await loadHouseholdRemote(code);
  if (data) hydrateState(data);
  startAutoSave(code);
  currentUser = user;
  startApp();
}

function startApp() {
  renderTabBar(document.getElementById("tabbar"));
  document.getElementById("app-more-btn").style.display = "";
  mountScreen("today");
  document.getElementById("app-more-btn").addEventListener("click", openMoreSheet);
  document.getElementById("app-house-btn").addEventListener("click", openHousePickerSheet);
  renderHouseBtn();
  subscribe(renderHouseBtn);
}

function showLoading() {
  document.getElementById("tabbar").innerHTML = "";
  document.getElementById("app-more-btn").style.display = "none";
  document.getElementById("screen-mount").innerHTML = "";
}

// Auth-gated boot (build-plan Phase 4, 2026-08-05; mandatory login,
// 2026-08-06) — onAuthChange fires once with whatever Firebase Auth
// already knows (from cached persistence, so a returning signed-in user
// resumes without re-clicking anything) and again on any real sign-in/
// out. A signed-in user with a household on record loads it from
// Firestore and goes straight in; signed in with no household yet goes to
// the household step; not signed in at all shows Welcome — there's no
// local-only fallback anymore, sign-in is required.
function boot() {
  loadPacks(); // fire-and-forget — cached for roomTemplates.js's sync reads
  showLoading();
  // Completes a signInWithRedirect() round trip, if this load is the
  // return leg of one (popup-blocked fallback, see auth.js). Errors here
  // (e.g. the user closed/cancelled the redirect) aren't fatal — the
  // onAuthChange listener below still runs either way and falls back to
  // Welcome for a not-signed-in user.
  completeRedirectSignIn().catch((err) => {
    console.warn("[kasa] redirect sign-in didn't complete:", err);
  });
  onAuthChange(async (user) => {
    if (user) {
      try {
        const record = await getUserRecord(user.uid);
        if (record?.householdCode) {
          const data = await loadHouseholdRemote(record.householdCode);
          if (data) hydrateState(data);
          startAutoSave(record.householdCode);
          currentUser = user;
          startApp();
          return;
        }
      } catch (err) {
        console.warn("[kasa] couldn't resolve household for signed-in user:", err);
        showToast("Signed in, but couldn't reach Firestore just now — try again shortly.");
      }
      currentUser = user;
      showHouseholdStep(user);
      return;
    }
    currentUser = null;
    showWelcome();
  });
}

boot();
