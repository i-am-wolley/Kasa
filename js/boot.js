// Boot — init, router mount (memo §1.1). No Firebase yet (Phase 4); this
// just mounts the tab shell and routes to built screens. Auth gate is a
// no-op stub until auth.js/db.js exist.

import { Icon } from "./ui/icons.js";
import { loadPacks } from "./packs.js";
import { getState } from "./state.js";
import { openSheet, closeSheet } from "./ui/components.js";
import { mount as mountToday } from "./routes/today.js";
import { mount as mountHouse } from "./routes/house.js";
import { mount as mountStock } from "./routes/stock.js";
import { mount as mountInsights } from "./routes/insights.js";
import { mount as mountWishlist } from "./routes/wishlist.js";
import { mount as mountPeople } from "./routes/people.js";
import { mount as mountAssets } from "./routes/assets.js";
import { mount as mountOnboard } from "./routes/onboard.js";
import { mount as mountWelcome } from "./routes/welcome.js";

// A new browser sees Welcome → (Skip) → Join/Create household → the
// existing 6-question onboarding, once (2026-08-05, user request: "bring
// the onboarding as first page for new users"). Gated on a localStorage
// flag rather than any real auth/household check — there's no backend
// yet (Phase 4) to actually know if this browser is "already part of a
// household," so this is honestly just "has this browser seen the intro
// once," not a real session check. Re-running onboarding later (via More)
// is a separate, already-existing path and is unaffected by this gate.
const INTRO_DONE_KEY = "kasa_intro_done";

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
  { id: "people", icon: "person", label: "People", meta: "Members, help, leave, habits" },
  { id: "onboard", icon: "sparkle", label: "Re-run onboarding", meta: "Rebuild the house from six questions" },
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
  // one-time creation toast — somewhere to actually find it again later,
  // even though nothing can look it up yet without Firebase (Phase 4).
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
      <p style="color:var(--ink-muted);font-size:var(--fs-meta);margin-top:4px;">Modes, notifications, and export live here in a later phase.</p>
    `,
  });
  document.querySelectorAll("[data-more-item]").forEach((row) => {
    row.addEventListener("click", () => {
      closeSheet();
      mountScreen(row.dataset.moreItem);
    });
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
    case "onboard":
      mountOnboard(screenEl, { onDone: () => switchTab("today") });
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
  mountWelcome(document.getElementById("screen-mount"), { onCreateNew: showFirstRunOnboarding });
}

function showFirstRunOnboarding() {
  mountOnboard(document.getElementById("screen-mount"), { onDone: finishIntro });
}

function finishIntro() {
  localStorage.setItem(INTRO_DONE_KEY, "1");
  startApp();
}

function startApp() {
  renderTabBar(document.getElementById("tabbar"));
  document.getElementById("app-more-btn").style.display = "";
  mountScreen("today");
  document.getElementById("app-more-btn").addEventListener("click", openMoreSheet);
}

function boot() {
  loadPacks(); // fire-and-forget — cached for roomTemplates.js's sync reads
  if (localStorage.getItem(INTRO_DONE_KEY)) {
    startApp();
  } else {
    showWelcome();
  }
}

boot();
