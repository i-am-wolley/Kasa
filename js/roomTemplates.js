// Per-space-type suggestions, offered when a new space is created in House
// (added 2026-08-03, user request). Two sources, merged:
//
// 1. Pack-derived — bath/bedroom/living/utility/entry/whole_home are already
//    fully described in packs/*.json (memo §10) for onboarding. Rather than
//    hand-duplicating the same routines twice (the original version of this
//    file did, and drifted immediately), those types are read live from
//    whatever packs.js has cached, filtered by each pack entry's own
//    `spaceType` field. Requires packs to be preloaded — boot.js kicks off
//    `loadPacks()` at startup; `getCachedPacks()` returns [] before that
//    resolves, so an "Add space" in the first instant of a page load may
//    show fewer suggestions than usual (see CLAUDE.md known limitations).
// 2. Hand-authored — every space type no pack covers (balcony plus study/
//    storage/outside/pooja/entertainment/dining/garage/terrace) stays
//    directly authored here, in the same modest 2-4 assets / 2-5 items /
//    1-3 routines shape.
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
  study: {
    assetKeys: ["AST-DESKTOP", "AST-OFFICE-CHAIR", "AST-PRINTER"],
    itemKeys: ["ITM-PRINTER-PAPER", "ITM-INK-CARTRIDGE"],
    routines: [
      { title: "Dust desk and electronics", trigger: { type: "floating_since_last", intervalDays: 14 }, effort: 1, consequence: "cosmetic", ownerClass: "either" },
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
