// Boot — init, router mount (memo §1.1). No Firebase yet (Phase 4); this
// just mounts the tab shell and routes to built screens. Auth gate is a
// no-op stub until auth.js/db.js exist.

import { Icon } from "./ui/icons.js";
import { loadPacks } from "./packs.js";
import { openSheet, closeSheet } from "./ui/components.js";
import { mount as mountToday } from "./routes/today.js";
import { mount as mountHouse } from "./routes/house.js";
import { mount as mountStock } from "./routes/stock.js";
import { mount as mountInsights } from "./routes/insights.js";
import { mount as mountWishlist } from "./routes/wishlist.js";
import { mount as mountPeople } from "./routes/people.js";
import { mount as mountAssets } from "./routes/assets.js";
import { mount as mountOnboard } from "./routes/onboard.js";

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
  openSheet({
    title: "More",
    bodyHtml: `
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

function boot() {
  loadPacks(); // fire-and-forget — cached for roomTemplates.js's sync reads
  renderTabBar(document.getElementById("tabbar"));
  mountScreen("today");
  document.getElementById("app-more-btn").addEventListener("click", openMoreSheet);
}

boot();
