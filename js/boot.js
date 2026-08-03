// Boot — init, router mount (memo §1.1). No Firebase yet (Phase 4); this
// just mounts the tab shell and routes to built screens. Auth gate is a
// no-op stub until auth.js/db.js exist.

import { Icon } from "./ui/icons.js";
import { loadPacks } from "./packs.js";
import { mount as mountToday } from "./routes/today.js";
import { mount as mountHouse } from "./routes/house.js";
import { mount as mountStock } from "./routes/stock.js";
import { mount as mountPeople } from "./routes/people.js";
import { mount as mountAssets } from "./routes/assets.js";
import { mount as mountOnboard } from "./routes/onboard.js";

const TABS = [
  { id: "today", icon: "today", label: "Today" },
  { id: "house", icon: "house", label: "House" },
  { id: "stock", icon: "stock", label: "Stock" },
  { id: "insights", icon: "insights", label: "Insights" },
  { id: "more", icon: "more", label: "More" },
];

// Screens reachable from "More" that aren't primary tabs (memo §8.1: only
// 5 tabs; People/Modes/Packs/etc. live one level down).
const MORE_ITEMS = [
  { id: "assets", icon: "warranty", label: "Assets", meta: "Service schedule, warranties, vendors" },
  { id: "people", icon: "person", label: "People", meta: "Members, help, leave" },
  { id: "onboard", icon: "sparkle", label: "Re-run onboarding", meta: "Rebuild the house from six questions" },
];

let activeTab = "today";
let activeScreen = "today";

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

function renderMoreMenu(el) {
  el.innerHTML = `
    <div class="topbar"><h1>More</h1></div>
    <div class="today-section">
      ${MORE_ITEMS.map(
        (item) => `
        <div class="list-row" data-more-item="${item.id}">
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
    <div class="today-section">
      <p style="color:var(--ink-muted);font-size:var(--fs-meta);">Modes, packs, notifications, and export live here in a later phase.</p>
    </div>
  `;
  el.querySelectorAll("[data-more-item]").forEach((row) => {
    row.addEventListener("click", () => mountScreen(row.dataset.moreItem));
  });
}

function mountScreen(screenId) {
  activeScreen = screenId;
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
      renderPlaceholder(screenEl, "Insights", "Insights isn't built yet — the health score and card library land in build-plan Phase 6.");
      break;
    case "more":
      renderMoreMenu(screenEl);
      break;
    case "people":
      mountPeople(screenEl, { onBack: () => switchTab("more") });
      break;
    case "assets":
      mountAssets(screenEl, { onBack: () => switchTab("more") });
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
}

boot();
