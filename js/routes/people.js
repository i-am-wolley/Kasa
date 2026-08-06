// People & Household screen (memo §8.2) — members and help, roster + leave,
// plus the household itself (2026-08-05, user request: "make it people
// and household where I can onboard to a household anytime"). Reached via
// More (not a primary tab — memo §8.1 lists 5 tabs, People isn't one).
// "Mark leave" here is the entry point to the Help-on-leave hero feature,
// which isn't built yet (build-plan Phase 7).
//
// Members vs help is a real distinction, not just a label (2026-08-05,
// user request): a member represents an eventual real account and needs
// an email on file for that; help (maid/cook/driver) is added by a member
// and never needs one of its own.

import { getState, subscribe, addPerson, updatePerson, deletePerson, addLeave, deleteHabit, toggleHabitToday, habitStreak, isHabitDoneOn, updateHouseholdName, hydrateState, byId } from "../state.js";
import { getCurrentUser } from "../auth.js";
import { joinHouseholdRemote, loadHouseholdRemote, startAutoSave, stopAutoSave } from "../db.js";
import { Icon } from "../ui/icons.js";
import { emptyState, field, textInput, chipGroup, readChipGroup, wireChipGroup, sheetActions, openSheet, closeSheet, showToast } from "../ui/components.js";
import { openRoutineEditor } from "./routine.js";

let mountEl = null;
let unsubscribe = null;
let onBack = null;

function subtitleFor(person) {
  if (person.kind === "help") {
    const days = person.schedule?.days?.length ? `${person.schedule.days.length}x/week` : "";
    return [person.role, days, person.schedule?.time].filter(Boolean).join(" · ");
  }
  return person.email || "Household member";
}

function rowHtml(person) {
  return `
    <div class="list-row" data-person-id="${person.id}">
      <div class="occ-row-icon" style="color:${person.avatarColor};">${Icon(person.kind === "help" ? "helper" : "person", { size: 18 })}</div>
      <div class="occ-row-body">
        <div class="occ-row-title named">${person.name}</div>
        <div class="occ-row-meta">${subtitleFor(person)}${person.leave?.length ? ` · ${person.leave.length} leave entr${person.leave.length === 1 ? "y" : "ies"}` : ""}</div>
      </div>
    </div>
  `;
}

// Household code, name (editable — 2026-08-06, user request: "allow to
// edit that as well"), and "join a different household" — the same
// honest join stub welcome.js's first-run flow uses, reachable here
// anytime afterward too, not just on first launch.
function householdSectionHtml(state) {
  return `
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Household</span></div>
      <div class="list-row" data-edit-household-name="1">
        <div class="occ-row-icon">${Icon("wholeHome", { size: 16 })}</div>
        <div class="occ-row-body">
          <div class="occ-row-title">${state.household.name || "Your household"}</div>
          <div class="occ-row-meta">Code: <span class="font-num">${state.household.code || "—"}</span></div>
        </div>
        ${Icon("edit", { size: 14 })}
      </div>
      <button type="button" class="chip" id="join-household-btn" style="margin-top:8px;">Join different</button>
    </div>
  `;
}

function openEditHouseholdNameSheet(state) {
  openSheet({
    title: "Household name",
    bodyHtml: `
      <form id="household-name-form">${field("Name", textInput({ id: "f-household-name", value: state.household.name ?? "" }))}</form>
      ${sheetActions({ saveLabel: "Save" })}
    `,
  });
  const root = document.getElementById("sheet-root");
  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const name = root.querySelector("#f-household-name").value.trim();
    if (!name) return;
    updateHouseholdName(name);
    closeSheet();
    showToast("Household renamed");
  });
}

function render() {
  const state = getState();
  const members = state.people.filter((p) => p.kind === "member");
  const help = state.people.filter((p) => p.kind === "help");
  mountEl.innerHTML = `
    <div class="topbar">
      <button class="btn btn-ghost" id="back-to-more" style="padding:8px;">${Icon("chevronLeft", { size: 18 })}</button>
      <h1 style="flex:1;">People & Household</h1>
      <button class="btn btn-tinted" id="add-person-btn">${Icon("plus", { size: 16 })} Person</button>
    </div>
    ${householdSectionHtml(state)}
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Members</span></div>
      ${members.map(rowHtml).join("") || emptyState({ message: "No members added yet.", actionLabel: null })}
    </div>
    <div class="today-section">
      <div class="section-head"><span class="eyebrow">Help</span></div>
      ${help.length ? help.map(rowHtml).join("") : `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">No help added yet.</p>`}
    </div>
  `;
  wireEvents(state);
}

// Real now (2026-08-06, user request) — joins by code, then swaps which
// household is actively syncing on this device: stops the CURRENT
// household's autosave/realtime-sync first, then loads and hydrates the
// new one, then starts sync on that instead. Stopping before switching
// matters — without it, a save already in flight for the old household
// (or a stray mutation firing between hydrate and re-subscribe) could
// land on the wrong Firestore document.
function openJoinHouseholdSheet() {
  openSheet({
    title: "Join a different household",
    bodyHtml: `
      <p style="color:var(--ink-muted);margin-bottom:16px;">This switches your device to a different household — you'll stop seeing this one.</p>
      ${field("Household code", textInput({ id: "f-join-code-people", placeholder: "ABC123" }))}
      ${sheetActions({ saveLabel: "Join" })}
    `,
  });
  const root = document.getElementById("sheet-root");
  const codeInput = root.querySelector("#f-join-code-people");
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });
  const saveBtn = root.querySelector('[data-action="save"]');
  saveBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) {
      showToast("Enter a household code first");
      return;
    }
    const user = getCurrentUser();
    if (!user) {
      showToast("You need to be signed in to join a household.");
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Joining…";
    try {
      await joinHouseholdRemote({ code, uid: user.uid, email: user.email });
      stopAutoSave(); // stop syncing the OLD household before this device starts hydrating the new one
      const data = await loadHouseholdRemote(code);
      if (data) hydrateState(data);
      startAutoSave(code, data);
      closeSheet();
      showToast(`Joined household ${code}`);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Join";
      showToast(err?.message || "Couldn't join — check the code and try again.");
    }
  });
}

const WEEKDAY_CHIPS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function leaveListHtml(person) {
  if (!person.leave?.length) return `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">No leave on record.</p>`;
  return person.leave
    .map((l) => `<p style="font-size:var(--fs-meta);color:var(--ink-muted);">${l.from} → ${l.to}${l.reason ? ` · ${l.reason}` : ""}</p>`)
    .join("");
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Habits are personal, not household (2026-08-04, user request) — created
// and edited through the same shared sheet routine.js uses for routines
// (its Kind toggle), reached here via "+ Add habit" / tapping a habit's
// title. "Mark done" is a quick inline toggle for today only; the 72-day
// grid view lives in Insights, not repeated here.
function freqLabel(freq) {
  if (!freq || freq.type === "daily") return "Daily";
  if (freq.type === "weekdays") return "Weekdays";
  if (freq.type === "weekends") return "Weekends";
  if (freq.type === "weekly_count") return `${freq.timesPerWeek || 1}x/week`;
  if (freq.type === "custom") {
    const names = { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
    return (freq.days || []).map((d) => names[d]).join("/") || "Custom days";
  }
  return "Daily";
}

function habitsListHtml(person, state) {
  const list = state.habits.filter((h) => h.personId === person.id);
  if (!list.length) return `<p style="color:var(--ink-muted);font-size:var(--fs-meta);">No habits yet.</p>`;
  return list
    .map((h) => {
      const doneToday = isHabitDoneOn(h.id, todayStr());
      const streak = habitStreak(h.id);
      return `
      <div class="list-row" style="margin-bottom:6px;">
        <div class="occ-row-icon">${Icon("flame", { size: 16 })}</div>
        <div class="occ-row-body" data-edit-habit="${h.id}">
          <div class="occ-row-title">${h.title}</div>
          <div class="occ-row-meta">${freqLabel(h.frequency)} · ${streak > 0 ? `${streak} day streak` : "No streak yet"}</div>
        </div>
        <button type="button" class="chip" data-toggle-habit="${h.id}" aria-pressed="${doneToday}">${doneToday ? "Done today" : "Mark done"}</button>
        <button type="button" class="stepper-btn" data-delete-habit="${h.id}">${Icon("trash", { size: 14 })}</button>
      </div>`;
    })
    .join("");
}

function openPersonSheet(person) {
  const isHelp = person?.kind === "help";
  openSheet({
    title: person ? "Edit person" : "Add person",
    bodyHtml: `
      <form id="person-form">
        ${field("Name", textInput({ id: "f-person-name", value: person?.name ?? "" }))}
        ${field("Type", chipGroup({ name: "kind", options: ["member", "help"], value: person?.kind ?? "member" }))}
        <div data-kind-block="member" style="display:${isHelp ? "none" : ""};">
          ${field("Email", textInput({ id: "f-person-email", type: "email", value: person?.email ?? "", placeholder: "name@example.com" }))}
          <p style="color:var(--ink-faint);font-size:var(--fs-micro);margin-top:-6px;margin-bottom:10px;">Members need an email — they'll eventually sign in and get onboarded to the household with it. Add as Help below if that's not needed.</p>
        </div>
        <div data-kind-block="help" style="display:${isHelp ? "" : "none"};">
          ${field("Role", textInput({ id: "f-person-role", value: person?.role ?? "", placeholder: "e.g. maid, cook, driver" }))}
          ${field("Works on", chipGroup({ name: "scheduleDays", options: WEEKDAY_CHIPS, value: person?.schedule?.days ?? [], multi: true }))}
          ${field("Usual time", textInput({ id: "f-person-time", value: person?.schedule?.time ?? "" }))}
        </div>
        ${person ? `<div class="field"><span class="field-label">Leave</span>${leaveListHtml(person)}</div>` : ""}
        ${person ? `
          <div class="field">
            <span class="field-label">Add leave</span>
            <div style="display:flex;gap:8px;">
              ${textInput({ id: "f-leave-from", type: "date" })}
              ${textInput({ id: "f-leave-to", type: "date" })}
            </div>
            <button type="button" class="btn btn-ghost" id="add-leave-btn" style="margin-top:8px;">Add leave</button>
          </div>
        ` : ""}
        ${person ? `
          <div class="field">
            <span class="field-label">Habits (personal)</span>
            <div id="habits-list">${habitsListHtml(person, getState())}</div>
            <button type="button" class="btn btn-ghost" id="add-habit-btn" style="margin-top:8px;">${Icon("plus", { size: 14 })} Add habit</button>
          </div>
        ` : ""}
      </form>
      ${sheetActions({ saveLabel: person ? "Save changes" : "Add person", showDelete: !!person })}
    `,
  });

  const root = document.getElementById("sheet-root");
  wireChipGroup(root, "kind");
  wireChipGroup(root, "scheduleDays");

  function rewireHabits() {
    root.querySelector("#habits-list").innerHTML = habitsListHtml(person, getState());
    root.querySelectorAll("[data-toggle-habit]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHabitToday(btn.dataset.toggleHabit);
        rewireHabits();
      });
    });
    root.querySelectorAll("[data-delete-habit]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm("Delete this habit?")) return;
        deleteHabit(btn.dataset.deleteHabit);
        rewireHabits();
      });
    });
    // Tapping a habit's title reopens it in the same routine/habit builder
    // routine.js uses — editing frequency etc. needs more room than fits
    // inline here.
    root.querySelectorAll("[data-edit-habit]").forEach((el) => {
      el.addEventListener("click", () => {
        const h = byId(getState().habits, el.dataset.editHabit);
        openRoutineEditor({ habit: h, defaultPersonId: person.id, onSaved: () => openPersonSheet(byId(getState().people, person.id)) });
      });
    });
  }
  if (person) {
    rewireHabits();
    root.querySelector("#add-habit-btn").addEventListener("click", () => {
      openRoutineEditor({ defaultPersonId: person.id, defaultKind: "habit", onSaved: () => openPersonSheet(byId(getState().people, person.id)) });
    });
  }

  root.querySelector('[data-field="kind"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (!btn) return;
    const nowHelp = btn.dataset.value === "help";
    root.querySelector('[data-kind-block="help"]').style.display = nowHelp ? "" : "none";
    root.querySelector('[data-kind-block="member"]').style.display = nowHelp ? "none" : "";
  });

  root.querySelector("#add-leave-btn")?.addEventListener("click", () => {
    const from = root.querySelector("#f-leave-from").value;
    const to = root.querySelector("#f-leave-to").value;
    if (!from || !to) return;
    addLeave(person.id, { from, to });
    closeSheet();
    showToast("Leave added");
  });

  root.querySelector('[data-action="save"]').addEventListener("click", () => {
    const name = root.querySelector("#f-person-name").value.trim();
    if (!name) return;
    const kind = readChipGroup(root, "kind") || "member";
    const fields = { name, kind };
    if (kind === "help") {
      fields.role = root.querySelector("#f-person-role").value.trim() || null;
      fields.schedule = { days: readChipGroup(root, "scheduleDays") || [], time: root.querySelector("#f-person-time").value || null };
      fields.email = null;
    } else {
      // Members represent a real account-to-be, so an email is required
      // (2026-08-05, user request) — help never needs one, added by a
      // member rather than having its own account.
      const email = root.querySelector("#f-person-email").value.trim();
      if (!email) {
        showToast("Members need an email on file. Add as Help instead if that's not needed.");
        return;
      }
      fields.email = email;
    }
    if (person) updatePerson(person.id, fields);
    else addPerson(fields);
    closeSheet();
    showToast(person ? "Person updated" : "Person added");
  });

  if (person) {
    root.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (!confirm(`Remove ${person.name}?`)) return;
      deletePerson(person.id);
      closeSheet();
      showToast("Person removed");
    });
  }
}

function wireEvents(state) {
  document.getElementById("back-to-more")?.addEventListener("click", () => onBack?.());
  document.getElementById("add-person-btn")?.addEventListener("click", () => openPersonSheet(null));
  document.getElementById("join-household-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openJoinHouseholdSheet();
  });
  document.querySelector("[data-edit-household-name]")?.addEventListener("click", () => {
    openEditHouseholdNameSheet(state);
  });
  mountEl.querySelectorAll("[data-person-id]").forEach((row) => {
    row.addEventListener("click", () => openPersonSheet(byId(state.people, row.dataset.personId)));
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
