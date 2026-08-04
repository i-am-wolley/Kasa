// Per-space-type suggestions, offered when a new space is created in House
// (added 2026-08-03, user request). Two sources, merged:
//
// 1. Pack-derived — bath/bedroom/living/utility/entry/whole_home/study/
//    admin are already fully described in packs/*.json (memo §10) for
//    onboarding, plus balcony (plants.json) and outside (vehicle.json)
//    now contribute pack content alongside their hand-authored entry below.
//    Rather than hand-duplicating the same routines twice (the original
//    version of this file did, and drifted immediately — and `study` did
//    it again the moment a real study.json pack shipped, 2026-08-05, until
//    its stale hand-authored stub was removed), pack-covered types are read
//    live from whatever packs.js has cached, filtered by each pack entry's
//    own `spaceType` field. Requires packs to be preloaded — boot.js kicks
//    off `loadPacks()` at startup; `getCachedPacks()` returns [] before
//    that resolves, so an "Add space" in the first instant of a page load
//    may show fewer suggestions than usual (see CLAUDE.md known
//    limitations). Routines are NOT deduped between the hand-authored and
//    pack-derived halves (only assets/items are, by catalog key) — if a
//    space type keeps both an entry here AND gains pack content, check
//    titles don't collide the way `study`'s did.
// 2. Hand-authored — every space type no pack fully covers (balcony/
//    outside partially, plus storage/pooja/entertainment/dining/garage/
//    terrace entirely) stays directly authored here, in the same modest
//    2-4 assets / 2-5 items / 1-3 routines shape.
//
// Either way the public API returns resolved catalog entry objects, not
// raw keys/names — house.js doesn't need to know which source they came
// from.

import { findExact, findByKey } from "./catalog.js";
import { getCachedPacks } from "./packs.js";

const HAND_AUTHORED = {
  balcony: {
    assetKeys: [],
    itemKeys: ["ITM-PLANT-FERTILIZER"],
    routines: [
      { title: "Clear balcony drain before monsoon", trigger: { type: "seasonal", months: [5, 6] }, effort: 2, consequence: "damaging", ownerClass: "either" },
    ],
  },
  storage: {
    assetKeys: [],
    itemKeys: ["ITM-NAPHTHALENE"],
    routines: [
      { title: "Check storage for pests and damp", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 1, consequence: "degrading", ownerClass: "either" },
    ],
  },
  outside: {
    assetKeys: ["AST-LAWN-MOWER", "AST-CAR"],
    itemKeys: [],
    routines: [
      { title: "Mow lawn", trigger: { type: "floating_since_last", intervalDays: 14 }, effort: 2, consequence: "cosmetic", ownerClass: "either" },
    ],
  },
  pooja: {
    assetKeys: [],
    itemKeys: ["ITM-INCENSE-STICKS", "ITM-CANDLES"],
    routines: [
      { title: "Clean pooja room", trigger: { type: "floating_since_last", intervalDays: 7 }, effort: 1, consequence: "cosmetic", ownerClass: "either" },
      { title: "Change flowers", trigger: { type: "floating_since_last", intervalDays: 3 }, effort: 1, consequence: "cosmetic", ownerClass: "either" },
    ],
  },
  entertainment: {
    assetKeys: ["AST-TELEVISION", "AST-HOME-THEATER", "AST-GAMING-CONSOLE", "AST-SPEAKERS"],
    itemKeys: [],
    routines: [
      { title: "Dust entertainment console", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either" },
    ],
  },
  dining: {
    assetKeys: ["AST-DINING-TABLE"],
    itemKeys: [],
    routines: [
      { title: "Wipe dining table", trigger: { type: "floating_since_last", intervalDays: 7 }, effort: 1, consequence: "cosmetic", ownerClass: "either" },
    ],
  },
  garage: {
    assetKeys: ["AST-CAR", "AST-GARAGE-DOOR-OPENER", "AST-LAWN-MOWER"],
    itemKeys: ["ITM-ENGINE-OIL", "ITM-WIPER-FLUID"],
    routines: [
      { title: "Organize garage", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 2, consequence: "cosmetic", ownerClass: "either" },
    ],
  },
  terrace: {
    assetKeys: ["AST-SOLAR-PANEL"],
    itemKeys: ["ITM-PLANT-FERTILIZER", "ITM-PESTICIDE-SPRAY"],
    routines: [
      { title: "Clear terrace drain before monsoon", trigger: { type: "seasonal", months: [5, 6] }, effort: 2, consequence: "damaging", ownerClass: "either" },
      { title: "Water rooftop plants", trigger: { type: "floating_since_last", intervalDays: 3 }, effort: 1, consequence: "cosmetic", ownerClass: "either" },
    ],
  },
};

function fromPacks(spaceType) {
  const assetNames = [];
  const itemNames = [];
  const routines = [];
  for (const pack of getCachedPacks()) {
    for (const a of pack.assets || []) if (a.spaceType === spaceType) assetNames.push(a.name);
    for (const i of pack.items || []) if (i.spaceType === spaceType) itemNames.push(i.name);
    for (const r of pack.routines || []) if (r.spaceType === spaceType) routines.push(r);
  }
  return { assetNames, itemNames, routines };
}

function dedupeByKey(entries) {
  const seen = new Set();
  return entries.filter((e) => e && !seen.has(e.key) && (seen.add(e.key), true));
}

function templateFor(spaceType) {
  const hand = HAND_AUTHORED[spaceType];
  const packed = fromPacks(spaceType);

  const assetEntries = dedupeByKey([
    ...(hand?.assetKeys || []).map((k) => findByKey(k, "asset")),
    ...packed.assetNames.map((n) => findExact(n, "asset")),
  ]);
  const itemEntries = dedupeByKey([
    ...(hand?.itemKeys || []).map((k) => findByKey(k, "item")),
    ...packed.itemNames.map((n) => findExact(n, "item")),
  ]);
  const routines = [...(hand?.routines || []), ...packed.routines];

  if (!assetEntries.length && !itemEntries.length && !routines.length) return null;
  return { assetEntries, itemEntries, routines };
}

export { templateFor };
