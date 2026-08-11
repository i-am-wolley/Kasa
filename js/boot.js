// Boot — init, router mount (memo §1.1), auth-gated (build-plan Phase 4,
// 2026-08-05 — Google sign-in + Firestore persistence; see auth.js/db.js).

import { Icon } from "./ui/icons.js";
import { loadPacks } from "./packs.js";
import { getState, subscribe, setActiveHouseIds, hydrateState, resetForNewHousehold, updateNotifySettings, setSmoothingMode, addPersonForJoiningUser, byId } from "./state.js";
import { onAuthChange, completeRedirectSignIn, signOutUser } from "./auth.js";
import { getUserRecord, createHouseholdRemote, joinHouseholdRemote, loadHouseholdRemote, startAutoSave } from "./db.js";
import * as notify from "./notify.js";
import { openSheet, closeSheet, field, textInput, chipGroup, wireChipGroup, readChipGroup, sheetActions, showToast } from "./ui/components.js";
import { mount as mountToday } from "./routes/today.js";
import { mount as mountHouse } from "./routes/house.js";
import { mount as mountStock } from "./routes/stock.js";
import { mount as mountInsights } from "./routes/insights.js";
import { mount as mountWishlist } from "./routes/wishlist.js";
import { mount as mountPeople } from "./routes/people.js";
import { mount as mountAssets } from "./routes/assets.js";
import { mount as mountHouses } from "./routes/houses.js";
import { mount as mountActivity } from "./routes/activity.js";
import { mount as mountRoutinesTasks } from "./routes/routinesTasks.js";
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
// Grouped and ordered deliberately (2026-08-10, user request: "sort the
// items in a logical way for user, now its just there" — items had only
// ever been appended in whatever order they were built): top-down through
// the household's own structure first (Houses contain Spaces contain
// People; Assets and Routines & Tasks are what lives inside those spaces),
// then behavior settings, then the activity log last as a look-back
// utility rather than something reached for day to day.
const MORE_ITEMS = [
  { id: "houses", icon: "house", label: "Houses", meta: "Add, rename, or delete houses in this household", section: "Manage" },
  { id: "people", icon: "person", label: "People & Household", meta: "Members, help, leave, habits, household code", section: "Manage" },
  { id: "assets", icon: "warranty", label: "Assets", meta: "Service schedule, warranties, vendors", section: "Manage" },
  { id: "routinesTasks", icon: "routine", label: "Routines & Tasks", meta: "Every routine and task, grouped by space or category", section: "Manage" },
  { id: "smoothing", icon: "routine", label: "Load smoothing", meta: "Off, automatic, or trigger it yourself from Today", section: "Settings" },
  { id: "notifications", icon: "bell", label: "Notifications", meta: "Daily due-today summary, on this device", section: "Settings" },
  { id: "activity", icon: "activityLog", label: "Activity log", meta: "Everything you and Kasa have changed, clustered by day", section: "History" },
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

function moreSectionsHtml() {
  let lastSection = null;
  return MORE_ITEMS.map((item) => {
    const header = item.section !== lastSection
      ? `<div class="eyebrow" style="margin:${lastSection ? "16px" : "0"} 0 6px;">${item.section}</div>`
      : "";
    lastSection = item.section;
    return `
      ${header}
      <div class="list-row" data-more-item="${item.id}" style="margin-bottom:8px;">
        <div class="occ-row-icon">${Icon(item.icon, { size: 18 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title">${item.label}</div>
          <div class="occ-row-meta">${item.meta}</div>
        </div>
        ${Icon("chevronRight", { size: 16 })}
      </div>
    `;
  }).join("");
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
        ${moreSectionsHtml()}
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
      if (row.dataset.moreItem === "notifications") {
        openNotificationsSheet();
      } else if (row.dataset.moreItem === "smoothing") {
        openSmoothingSheet();
      } else {
        mountScreen(row.dataset.moreItem);
      }
    });
  });
}

// Off, or On with a Manual/Automatic sub-choice (2026-08-10, user request:
// "have a toggle on or off, then automatic or manual" — was previously
// always doing SOMETHING, auto or manual-with-a-button, with no real off
// state). Manual mode surfaces a "Smoothen" chip next to Today's own
// Batches toggle instead of running silently as part of every regenerate();
// Automatic does it quietly. Whenever the household is currently off, the
// sub-choice defaults to Manual the moment it's switched on (2026-08-10,
// user request: "always when switched on let it do a manual first and then
// automatic is switched by user if needed") — flipping back on after
// already having a mode preserves that prior mode instead of resetting it.
function openSmoothingSheet() {
  const state = getState();
  const mode = state.household.smoothingMode || "off";
  const isOn = mode !== "off";
  const subMode = isOn ? mode : "manual";
  openSheet({
    title: "Load smoothing",
    bodyHtml: `
      <p style="color:var(--ink-muted);margin-bottom:16px;">If a week's total cosmetic-routine effort goes over the household's ceiling, some can shift to a lighter week.</p>
      ${field("Load smoothing", chipGroup({ name: "smoothingOn", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }], value: isOn ? "on" : "off" }))}
      <div id="smoothing-submode-field" style="display:${isOn ? "block" : "none"};">
        ${field("Mode", chipGroup({ name: "smoothingSubMode", options: [{ value: "manual", label: "Manual — I'll tap Smoothen" }, { value: "auto", label: "Automatic — do it quietly" }], value: subMode }))}
      </div>
      ${sheetActions({ saveLabel: "Save" })}
    `,
  });
  const root = document.getElementById("sheet-root");
  wireChipGroup(root, "smoothingOn");
  wireChipGroup(root, "smoothingSubMode");
  root.querySelector('[data-field="smoothingOn"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (!btn) return;
    root.querySelector("#smoothing-submode-field").style.display = btn.dataset.value === "on" ? "block" : "none";
  });
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const on = readChipGroup(root, "smoothingOn") === "on";
    setSmoothingMode(on ? (readChipGroup(root, "smoothingSubMode") || "manual") : "off");
    closeSheet();
    showToast("Load smoothing settings saved");
  });
}

// Notifications settings — a sheet, not a routed screen (2026-08-06),
// same weight as the Houses picker. See notify.js for what this actually
// can and can't do (on-device only, not true background push).
function openNotificationsSheet() {
  const state = getState();
  const settings = state.household.notifySettings || { enabled: false, time: "07:00" };
  const supported = notify.isSupported();
  const permission = notify.permissionState();
  let enabled = settings.enabled;

  openSheet({
    title: "Notifications",
    bodyHtml: `
      <p style="color:var(--ink-muted);margin-bottom:16px;">A once-a-day summary of what's overdue, due today, and low on stock.</p>
      ${!supported ? `<p style="color:var(--tier-damaging);font-size:var(--fs-meta);margin-bottom:12px;">Notifications aren't supported in this browser.</p>` : ""}
      ${supported && permission === "denied" ? `<p style="color:var(--tier-damaging);font-size:var(--fs-meta);margin-bottom:12px;">Notifications are blocked for this site in your browser's settings — allow them there first.</p>` : ""}
      <div class="list-row" style="cursor:default;">
        <div class="occ-row-body">
          <div class="occ-row-title">Daily summary</div>
          <div class="occ-row-meta">Checked while Kasa is open on this device</div>
        </div>
        <button type="button" class="chip" id="notif-toggle" aria-pressed="${enabled}" ${supported ? "" : "disabled"}>${enabled ? "On" : "Off"}</button>
      </div>
      ${field("Time", textInput({ id: "f-notif-time", type: "time", value: settings.time || "07:00" }))}
      <p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-top:-6px;">This only fires while a Kasa tab is open on this device — it's not a true background push (that needs a server sending it while your phone's screen is off, which isn't built yet).</p>
      ${sheetActions({ saveLabel: "Save" })}
    `,
  });

  const root = document.getElementById("sheet-root");
  const toggleBtn = document.getElementById("notif-toggle");
  toggleBtn?.addEventListener("click", async () => {
    if (!enabled) {
      const perm = await notify.requestPermission();
      if (perm !== "granted") {
        showToast("Notifications need permission — check your browser's site settings.");
        return;
      }
    }
    enabled = !enabled;
    toggleBtn.setAttribute("aria-pressed", String(enabled));
    toggleBtn.textContent = enabled ? "On" : "Off";
  });

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const time = root.querySelector("#f-notif-time").value || "07:00";
    updateNotifySettings({ enabled, time });
    closeSheet();
    showToast("Notification settings saved");
    notify.checkAndNotify(); // re-evaluate right away in case today's time already passed
  });
}

// Light/dark toggle (2026-08-11, user request: "have the light mode dark
// mode switch on the top, left of the house selection"). A device-level
// preference, not household data — wired once, unconditionally, at the
// very start of boot() below, so it works on Welcome/loading screens too,
// before any sign-in or household has resolved. The actual theme is
// applied by the inline script in index.html's <head> (before first
// paint, to avoid a flash of the wrong theme); this just keeps the button
// icon in sync and handles the toggle itself. Icon shows the mode you'd
// switch TO (sun while dark, moon while light) — the common convention.
const THEME_COLOR = { light: "#BF5892", dark: "#D888B6" };
function renderThemeBtn() {
  const btn = document.getElementById("app-theme-btn");
  if (!btn) return;
  const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  btn.innerHTML = Icon(theme === "dark" ? "sun" : "moon", { size: 15 });
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("kasa_theme", theme);
  document.getElementById("theme-color-meta")?.setAttribute("content", THEME_COLOR[theme]);
  renderThemeBtn();
}
function wireThemeToggle() {
  renderThemeBtn();
  document.getElementById("app-theme-btn")?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
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
    case "activity":
      mountActivity(screenEl, { onBack: () => switchTab(activeTab) });
      break;
    case "routinesTasks":
      mountRoutinesTasks(screenEl, { onBack: () => switchTab(activeTab) });
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
  startAutoSave(code, data);
  // Auto-add the joining person to the roster (2026-08-08, user request) —
  // called after startAutoSave so the mutation's notify() actually reaches
  // a live save subscription instead of firing before one exists.
  addPersonForJoiningUser({ name: user.displayName, email: user.email });
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
  notify.startChecking();
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
  wireThemeToggle();
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
          startAutoSave(record.householdCode, data);
          // Defensive backfill (2026-08-08) — covers a household that was
          // joined before this feature existed; a no-op (idempotent by
          // email) for every normal returning session where the person
          // record is already there.
          addPersonForJoiningUser({ name: user.displayName, email: user.email });
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
