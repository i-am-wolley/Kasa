// Routines & Tasks — a full browsable list of every routine and task in
// the household, not just what's due/overdue on Today (2026-08-10, user
// request: "a full routine/task list clustered or categorised in a nice
// way.. currently we dont have that anywhere"). Reached from More, same
// one-level-down pattern as Houses/People/Assets/Activity log. Habits are
// deliberately not included here — they already have their own tracking
// view (People & Household / Insights) and the request was specifically
// "routine/task".

import { getState, subscribe, byId, visibleSpaceIds, taskState, taskOverdueDays } from "../state.js";
import { Icon } from "../ui/icons.js";
import { emptyState, chip } from "../ui/components.js";
import { openRoutineEditor } from "./routine.js";

let mountEl = null;
let unsubscribe = null;
let onBack = null;
let kind = "routine"; // "routine" | "task"
let statusFilter = "active"; // routines only: "active" | "paused" | "all"
let groupBy = "space"; // routines only: "space" | "tier"

const EFFORT_LABEL = { 1: "2 min", 2: "15 min", 3: "1 hr", 4: "Half day", 5: "Vendor" };
const TIER_RANK = { unsafe: 4, damaging: 3, unhygienic: 2, cosmetic: 1 };
const TIER_TITLE = { unsafe: "Unsafe", damaging: "Damaging", unhygienic: "Unhygienic", cosmetic: "Cosmetic" };
const TIER_ORDER = ["unsafe", "damaging", "unhygienic", "cosmetic"];

// Sorted by house name first, then space name alphabetically within each
// house — same helper already duplicated in routine.js/stock.js/assets.js.
function sortSpaces(spaces, state) {
  return [...spaces].sort((a, b) => {
    const houseA = byId(state.houses, a.houseId)?.name || "";
    const houseB = byId(state.houses, b.houseId)?.name || "";
    if (houseA !== houseB) return houseA.localeCompare(houseB);
    return a.name.localeCompare(b.name);
  });
}

function routineIcon(routine, state) {
  const asset = routine.assetId ? byId(state.assets, routine.assetId) : null;
  return asset?.icon || "routine";
}

function routineRowHtml(routine, state) {
  const space = byId(state.spaces, routine.spaceId);
  return `
    <div class="occ-row" data-tier="${routine.consequence}" data-routine-id="${routine.id}" style="opacity:${routine.active ? 1 : 0.55};">
      <div class="occ-row-icon">${Icon(routineIcon(routine, state), { size: 18 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title named">${routine.title}</div>
        <div class="occ-row-meta">${space?.name || "No space"}${!routine.active ? " · Paused" : ""}</div>
      </div>
      ${routine.effort ? `<div class="occ-row-effort">${EFFORT_LABEL[routine.effort] || ""}</div>` : ""}
    </div>
  `;
}

function taskDueLabel(task) {
  const st = taskState(task);
  if (st === "done") return "Done";
  if (st === "overdue") { const d = taskOverdueDays(task); return `Overdue by ${d} day${d === 1 ? "" : "s"}`; }
  if (st === "due") return "Due today";
  return new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function taskRowHtml(task, state) {
  const space = task.spaceId ? byId(state.spaces, task.spaceId) : null;
  return `
    <div class="occ-row" data-task-id="${task.id}" style="opacity:${task.done ? 0.55 : 1};">
      <div class="occ-row-icon">${Icon("task", { size: 18 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title">${task.title}</div>
        <div class="occ-row-meta">${taskDueLabel(task)}${space ? ` · ${space.name}` : ""}</div>
      </div>
    </div>
  `;
}

function routinesFilterRowHtml() {
  return `
    <div class="member-filter-row">
      ${chip("Active", { active: statusFilter === "active", dataAttrs: 'data-status-filter="active"' })}
      ${chip("Paused", { active: statusFilter === "paused", dataAttrs: 'data-status-filter="paused"' })}
      ${chip("All", { active: statusFilter === "all", dataAttrs: 'data-status-filter="all"' })}
      <span style="width:1px;background:var(--line);margin:2px 4px;flex-shrink:0;"></span>
      ${chip("By space", { active: groupBy === "space", dataAttrs: 'data-group-by="space"' })}
      ${chip("By category", { active: groupBy === "tier", dataAttrs: 'data-group-by="tier"' })}
    </div>
  `;
}

function routinesBodyHtml(state, visible) {
  let routines = state.routines.filter((r) => visible.has(r.spaceId));
  if (statusFilter === "active") routines = routines.filter((r) => r.active);
  else if (statusFilter === "paused") routines = routines.filter((r) => !r.active);

  if (!routines.length) {
    return routinesFilterRowHtml() + emptyState({ message: "No routines match this filter.", actionLabel: null });
  }

  let sections;
  if (groupBy === "space") {
    const spaces = sortSpaces(state.spaces.filter((s) => visible.has(s.id)), state);
    const multiHouse = state.houses.length > 1;
    sections = spaces
      .map((sp) => {
        const list = routines
          .filter((r) => r.spaceId === sp.id)
          .sort((a, b) => (TIER_RANK[b.consequence] || 0) - (TIER_RANK[a.consequence] || 0) || a.title.localeCompare(b.title));
        if (!list.length) return "";
        const houseName = multiHouse ? byId(state.houses, sp.houseId)?.name : null;
        return `
          <div class="today-section">
            <div class="section-head"><span class="eyebrow">${sp.name}${houseName ? ` · ${houseName}` : ""} (${list.length})</span></div>
            ${list.map((r) => routineRowHtml(r, state)).join("")}
          </div>
        `;
      })
      .join("");
  } else {
    sections = TIER_ORDER.map((tier) => {
      const list = routines.filter((r) => r.consequence === tier).sort((a, b) => a.title.localeCompare(b.title));
      if (!list.length) return "";
      return `
        <div class="today-section">
          <div class="section-head"><span class="eyebrow">${TIER_TITLE[tier]} (${list.length})</span></div>
          ${list.map((r) => routineRowHtml(r, state)).join("")}
        </div>
      `;
    }).join("");
  }

  return routinesFilterRowHtml() + sections;
}

function tasksBodyHtml(state, visible) {
  const tasks = state.tasks.filter((t) => !t.spaceId || visible.has(t.spaceId));
  if (!tasks.length) return emptyState({ message: "No tasks yet.", actionLabel: null });

  const buckets = { overdue: [], due: [], upcoming: [], done: [] };
  for (const t of tasks) buckets[taskState(t)].push(t);
  buckets.overdue.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  buckets.due.sort((a, b) => a.title.localeCompare(b.title));
  buckets.upcoming.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  buckets.done.sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt));

  return [
    ["overdue", "Overdue"],
    ["due", "Due today"],
    ["upcoming", "Upcoming"],
    ["done", "Done"],
  ]
    .map(([key, label]) => {
      const list = buckets[key];
      if (!list.length) return "";
      return `
        <div class="today-section">
          <div class="section-head"><span class="eyebrow">${label} (${list.length})</span></div>
          ${list.map((t) => taskRowHtml(t, state)).join("")}
        </div>
      `;
    })
    .join("");
}

function render() {
  const state = getState();
  const visible = visibleSpaceIds(state);

  mountEl.innerHTML = `
    <div class="topbar">
      <button class="btn btn-ghost" id="back-to-more" style="padding:8px;">${Icon("chevronLeft", { size: 18 })}</button>
      <h1 style="flex:1;">Routines &amp; Tasks</h1>
      <button class="btn btn-tinted" id="add-btn">${Icon("plus", { size: 16 })} Add</button>
    </div>
    <div class="today-section" style="padding-top:4px;">
      <div class="member-filter-row">
        ${chip("Routines", { active: kind === "routine", dataAttrs: 'data-kind="routine"' })}
        ${chip("Tasks", { active: kind === "task", dataAttrs: 'data-kind="task"' })}
      </div>
    </div>
    ${kind === "routine" ? routinesBodyHtml(state, visible) : tasksBodyHtml(state, visible)}
  `;
  wireEvents(state);
}

function wireEvents(state) {
  document.getElementById("back-to-more")?.addEventListener("click", () => onBack?.());
  document.getElementById("add-btn")?.addEventListener("click", () => {
    openRoutineEditor({ defaultKind: kind });
  });
  mountEl.querySelectorAll("[data-kind]").forEach((btn) => {
    btn.addEventListener("click", () => { kind = btn.dataset.kind; render(); });
  });
  mountEl.querySelectorAll("[data-status-filter]").forEach((btn) => {
    btn.addEventListener("click", () => { statusFilter = btn.dataset.statusFilter; render(); });
  });
  mountEl.querySelectorAll("[data-group-by]").forEach((btn) => {
    btn.addEventListener("click", () => { groupBy = btn.dataset.groupBy; render(); });
  });
  mountEl.querySelectorAll("[data-routine-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const routine = byId(state.routines, row.dataset.routineId);
      if (routine) openRoutineEditor({ routine });
    });
  });
  mountEl.querySelectorAll("[data-task-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const task = byId(state.tasks, row.dataset.taskId);
      if (task) openRoutineEditor({ task });
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
