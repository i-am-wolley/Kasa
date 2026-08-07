// Activity log (2026-08-10, user request: "a log where all actions are
// tracked... any changes in the app to be captured and put there"). Reached
// from More, same one-level-down pattern as Houses/People/Assets.
//
// The data itself is state.js's own logActivity() calls — one per mutator,
// called at the actual point of change rather than inferred after the fact.
// This file is purely presentation: read state.activityLog, cluster it for
// readability, render it, filter it.
//
// Clustering strategy: group by calendar day (Today/Yesterday/weekday/date),
// then by category within a day, then by exact type within a category. Any
// type with 3+ entries on the same day collapses into one "N things"
// summary row (expandable) instead of listing each individually — a room-
// template add or onboarding pass can create dozens of same-type entries in
// one sitting, and without this a single busy day would bury everything
// else. Fewer than 3 of a type on a given day just list individually, since
// there's nothing to gain by collapsing two things into "2 things".

import { getState, subscribe } from "../state.js";
import { Icon } from "../ui/icons.js";
import { emptyState, chip } from "../ui/components.js";

let mountEl = null;
let unsubscribe = null;
let onBack = null;
let categoryFilter = "all";
let kasaOnly = false;
const expanded = new Set(); // cluster keys the user has opened

const CATEGORY_ICON = {
  routine: "routine", habit: "flame", task: "task", stock: "stock", asset: "warranty",
  house: "house", household: "house", people: "person", wishlist: "wishlist",
};
const CATEGORY_LABEL = {
  routine: "Routines", habit: "Habits", task: "Tasks", stock: "Stock", asset: "Assets",
  house: "House", household: "Household", people: "People", wishlist: "Wishlist",
};
const CATEGORY_ORDER = ["routine", "habit", "task", "stock", "asset", "house", "household", "people", "wishlist"];

const TYPE_PLURAL = {
  routine_added: "routines added", routine_edited: "routines edited", routine_deleted: "routines deleted",
  routine_completed: "routines completed", routine_snoozed: "routines snoozed",
  routine_paused: "routines paused", routine_resumed: "routines resumed",
  habit_added: "habits added", habit_edited: "habits edited", habit_deleted: "habits deleted",
  habit_done: "habits checked off", habit_undone: "habits unchecked",
  task_added: "tasks added", task_edited: "tasks edited", task_deleted: "tasks deleted",
  task_completed: "tasks completed", task_uncompleted: "tasks marked not done",
  item_added: "items added", item_edited: "items edited", item_deleted: "items removed",
  item_qty_adjusted: "stock adjustments", item_depleted: "items auto-depleted",
  asset_added: "assets added", asset_edited: "assets edited", asset_deleted: "assets deleted", asset_serviced: "assets serviced",
  space_added: "spaces added", space_renamed: "spaces renamed", space_deleted: "spaces deleted",
  house_added: "houses added", house_renamed: "houses renamed", house_deleted: "houses deleted",
  person_added: "people added", person_edited: "people edited", person_deleted: "people removed",
  wishlist_added: "wishlist ideas added", wishlist_edited: "wishlist ideas edited",
  wishlist_deleted: "wishlist ideas removed", wishlist_acquired: "wishlist ideas acquired",
  smoothing_run: "smoothing passes", smoothing_mode_changed: "smoothing setting changes",
  household_mode_changed: "household mode changes",
};

function dayLabel(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - d) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function clusterDay(entries) {
  const byCategory = {};
  const catOrder = [];
  for (const e of entries) {
    if (!byCategory[e.category]) { byCategory[e.category] = []; catOrder.push(e.category); }
    byCategory[e.category].push(e);
  }
  catOrder.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));

  return catOrder.map((cat) => {
    const list = byCategory[cat];
    const byType = {};
    const typeOrder = [];
    for (const e of list) {
      if (!byType[e.type]) { byType[e.type] = []; typeOrder.push(e.type); }
      byType[e.type].push(e);
    }
    const rows = [];
    for (const type of typeOrder) {
      const group = byType[type];
      if (group.length >= 3) {
        rows.push({ clustered: true, type, entries: group, ts: group[0].ts });
      } else {
        for (const e of group) rows.push({ clustered: false, entry: e, ts: e.ts });
      }
    }
    rows.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    return { category: cat, rows, count: list.length };
  });
}

function groupByDay(entries) {
  const groups = [];
  let curKey = null, curList = null;
  for (const e of entries) {
    const dKey = e.ts.slice(0, 10);
    if (dKey !== curKey) {
      curKey = dKey;
      curList = [];
      groups.push({ dateKey: dKey, label: dayLabel(e.ts), entries: curList });
    }
    curList.push(e);
  }
  return groups;
}

function actorTagHtml(actorKind) {
  return actorKind === "kasa"
    ? `<span style="display:inline-flex;align-items:center;gap:3px;color:var(--ink-faint);font-size:var(--fs-micro);">${Icon("sparkle", { size: 11 })}Kasa</span>`
    : "";
}

function entryRowHtml(entry) {
  return `
    <div class="list-row" style="margin-bottom:6px;">
      <div class="occ-row-icon">${Icon(CATEGORY_ICON[entry.category] || "sparkle", { size: 16 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title" style="font-size:var(--fs-meta);font-weight:var(--fw-regular);">${entry.summary}</div>
        <div class="occ-row-meta">${timeLabel(entry.ts)}</div>
      </div>
      ${actorTagHtml(entry.actorKind)}
    </div>
  `;
}

function clusterRowHtml(dayKey, cluster) {
  const key = `${dayKey}:${cluster.type}`;
  const isOpen = expanded.has(key);
  const label = TYPE_PLURAL[cluster.type] || cluster.type;
  const anyKasa = cluster.entries.some((e) => e.actorKind === "kasa");
  return `
    <div>
      <button type="button" class="list-row" data-cluster-toggle="${key}" style="width:100%;text-align:left;margin-bottom:6px;cursor:pointer;background:none;border:none;">
        <div class="occ-row-icon">${Icon(CATEGORY_ICON[cluster.entries[0].category] || "sparkle", { size: 16 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title" style="font-size:var(--fs-meta);font-weight:var(--fw-semibold);">${cluster.entries.length} ${label}</div>
          <div class="occ-row-meta">${timeLabel(cluster.entries[cluster.entries.length - 1].ts)} – ${timeLabel(cluster.entries[0].ts)}</div>
        </div>
        ${anyKasa ? actorTagHtml("kasa") : ""}
        ${Icon(isOpen ? "chevronDown" : "chevronRight", { size: 14 })}
      </button>
      ${isOpen ? `<div style="padding-left:16px;">${cluster.entries.map(entryRowHtml).join("")}</div>` : ""}
    </div>
  `;
}

function dayGroupHtml(day) {
  const clusters = clusterDay(day.entries);
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">${day.label}</span></div>
      ${clusters.map(
        (cat) => `
        <div style="margin-bottom:10px;">
          <div style="color:var(--ink-faint);font-size:var(--fs-micro);font-weight:var(--fw-semibold);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">${CATEGORY_LABEL[cat.category] || cat.category}</div>
          ${cat.rows.map((row) => (row.clustered ? clusterRowHtml(day.dateKey, row) : entryRowHtml(row.entry))).join("")}
        </div>
      `,
      ).join("")}
    </div>
  `;
}

function filterChipsHtml(state) {
  const categories = CATEGORY_ORDER.filter((c) => state.activityLog.some((e) => e.category === c));
  return `
    <div class="member-filter-row">
      ${chip("All", { active: categoryFilter === "all", dataAttrs: 'data-cat-filter="all"' })}
      ${categories.map((c) => chip(CATEGORY_LABEL[c] || c, { active: categoryFilter === c, dataAttrs: `data-cat-filter="${c}"` })).join("")}
      ${chip("By Kasa", { active: kasaOnly, dataAttrs: 'id="kasa-only-toggle"' })}
    </div>
  `;
}

function render() {
  const state = getState();
  let entries = state.activityLog || [];
  if (categoryFilter !== "all") entries = entries.filter((e) => e.category === categoryFilter);
  if (kasaOnly) entries = entries.filter((e) => e.actorKind === "kasa");
  const groups = groupByDay(entries);

  mountEl.innerHTML = `
    <div class="topbar">
      <button class="btn btn-ghost" id="back-to-more" style="padding:8px;">${Icon("chevronLeft", { size: 18 })}</button>
      <h1 style="flex:1;">Activity log</h1>
    </div>
    <div class="today-section" style="padding-top:4px;">
      ${filterChipsHtml(state)}
    </div>
    ${groups.length ? groups.map(dayGroupHtml).join("") : emptyState({ message: "Nothing tracked yet — actions you and Kasa take will show up here.", actionLabel: null })}
  `;
  wireEvents();
}

function wireEvents() {
  document.getElementById("back-to-more")?.addEventListener("click", () => onBack?.());
  mountEl.querySelectorAll("[data-cat-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      categoryFilter = btn.dataset.catFilter;
      render();
    });
  });
  document.getElementById("kasa-only-toggle")?.addEventListener("click", () => {
    kasaOnly = !kasaOnly;
    render();
  });
  mountEl.querySelectorAll("[data-cluster-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.clusterToggle;
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      render();
    });
  });
}

function mount(el, { onBack: back } = {}) {
  mountEl = el;
  onBack = back;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(render);
  render();
}

export { mount };
