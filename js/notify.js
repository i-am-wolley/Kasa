// Client-side "what's due" notifications (2026-08-06, user request) — a
// once-a-day consolidated summary (overdue + due today + low stock),
// shown at or after a chosen time, on-device.
//
// This is deliberately NOT true background push — a notification that
// arrives while the app/browser is fully closed needs a server that can
// wake the device on a schedule (Firebase Cloud Messaging + a scheduled
// Cloud Function + upgrading the Firebase project to the Blaze billing
// plan), none of which is built. What's here is the honest, fully-
// client-side version: request permission (must be a real user gesture —
// browsers refuse a silent request), then check on load and periodically
// while a Kasa tab stays open. Good enough for "I have Kasa open most of
// the morning anyway"; not good enough for "notify me even if I never
// open the app." The Notifications sheet (boot.js) says so directly
// rather than pretending this is the real thing — same "never fake
// completeness" rule the rest of this project follows.

import { getState } from "./state.js";
import { stateOf } from "./engine.js";
import { bucketOf } from "./routes/stock.js";

const LAST_SHOWN_KEY = "kasa_notif_last_shown_date";

function isSupported() {
  return typeof Notification !== "undefined";
}

function permissionState() {
  return isSupported() ? Notification.permission : "unsupported";
}

// Must be called from a real click handler — browsers silently ignore (or
// reject) a permission request that isn't triggered by a user gesture.
function requestPermission() {
  if (!isSupported()) return Promise.resolve("unsupported");
  return Notification.requestPermission();
}

function buildSummary(state) {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let overdue = 0;
  let dueToday = 0;
  for (const occ of state.occurrences) {
    if (occ.state === "done" || occ.state === "snoozed") continue;
    const s = stateOf({ dueAt: occ.dueAt, windowDays: occ.windowDays }, now);
    if (s === "overdue") overdue += 1;
    else if (s === "due") dueToday += 1;
  }
  for (const t of state.tasks) {
    if (t.done) continue;
    const due = new Date(t.dueDate);
    due.setHours(0, 0, 0, 0);
    if (due < today) overdue += 1;
    else if (due.getTime() === today.getTime()) dueToday += 1;
  }
  const lowStock = state.items.filter((i) => bucketOf(i) !== "ok").length;
  return { overdue, dueToday, lowStock };
}

function summaryText({ overdue, dueToday, lowStock }) {
  const parts = [];
  if (overdue) parts.push(`${overdue} overdue`);
  if (dueToday) parts.push(`${dueToday} due today`);
  if (lowStock) parts.push(`${lowStock} low on stock`);
  return parts.length ? parts.join(" · ") : "Nothing due — the house is quiet.";
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function alreadyShownToday() {
  return localStorage.getItem(LAST_SHOWN_KEY) === todayStr();
}

function showNow(state) {
  if (!isSupported() || Notification.permission !== "granted") return;
  new Notification("Kasa — today", {
    body: summaryText(buildSummary(state)),
    icon: "./icons/icon.svg",
    tag: "kasa-daily-summary", // replaces any earlier one instead of stacking
  });
  localStorage.setItem(LAST_SHOWN_KEY, todayStr());
}

// Safe to call anytime — no-ops unless the setting is on, permission was
// actually granted, today's summary hasn't already gone out, and the set
// time has passed.
function checkAndNotify() {
  const state = getState();
  const settings = state.household.notifySettings;
  if (!settings?.enabled) return;
  if (permissionState() !== "granted") return;
  if (alreadyShownToday()) return;
  const [h, m] = (settings.time || "07:00").split(":").map(Number);
  const target = new Date();
  target.setHours(h || 0, m || 0, 0, 0);
  if (new Date() < target) return;
  showNow(state);
}

let intervalHandle = null;

// Called once from boot.js's startApp() — checks immediately, then every
// 5 minutes while the tab stays open. 5 minutes is plenty; this only ever
// needs to catch "has the set time passed yet today," not fire with
// second-level precision.
function startChecking() {
  checkAndNotify();
  if (intervalHandle) return;
  intervalHandle = setInterval(checkAndNotify, 5 * 60 * 1000);
}

export { isSupported, permissionState, requestPermission, checkAndNotify, startChecking, buildSummary, summaryText };
