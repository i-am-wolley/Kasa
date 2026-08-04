// Content pack loader + archetype seeder (memo §10, §3.1 Step 3). Packs are
// content, not code — this file is the only thing that turns pack JSON +
// onboarding answers into real spaces/items/assets/routines. Adding a new
// pack should never require touching engine.js (memo's own acceptance
// test, memo build-plan Phase 3).

import { getOrCreate } from "./catalog.js";

const PACK_IDS = [
  "core", "bath", "laundry", "help", "appliances",
  // Phase 7, 2026-08-05 — remaining packs per memo §10's priority order.
  "utility", "bedroom", "living", "plants", "admin", "entry", "vehicle", "study",
];

let cachedPacks = null;

async function loadPacks() {
  if (cachedPacks) return cachedPacks;
  const packs = await Promise.all(
    PACK_IDS.map((id) => fetch(`./packs/${id}.json`).then((r) => r.json())),
  );
  cachedPacks = packs;
  return packs;
}

// Sync accessor for callers that can't await (e.g. roomTemplates.js's
// pack-derived suggestions, rendered synchronously from a click handler).
// Returns [] if loadPacks() hasn't resolved yet — boot.js kicks it off at
// startup so in practice it's ready well before anyone opens "Add space".
function getCachedPacks() {
  return cachedPacks || [];
}

// Every home is assumed to have bath/utility for now — good enough until a
// studio/no-help edge case actually needs modelling (memo doesn't specify
// per-archetype space omission rules yet).
function impliedSpaceTypes(answers) {
  const base = ["bath", "bedroom", "living", "utility", "entry", "whole_home"];
  if ((answers.has || []).includes("Balcony/garden")) base.push("balcony");
  return base;
}

function packApplies(pack, answers) {
  const w = pack.appliesWhen || {};
  if (w.always) return true;
  if (w.spaces) {
    const implied = impliedSpaceTypes(answers);
    if (w.spaces.some((t) => implied.includes(t))) return true;
  }
  if (w.householdHelp) {
    if (w.householdHelp.includes(answers.householdHelp)) return true;
  }
  if (w.has) {
    if ((answers.has || []).some((h) => w.has.includes(h))) return true;
  }
  return false;
}

let idSeq = 0;
function makeId(prefix) {
  idSeq += 1;
  return `${prefix}_${idSeq}`;
}

// Builds real {spaces, items, assets, routines} from every applicable pack.
// Spaces are deduped by type across packs (bath.json and appliances.json
// can both mention "utility" without creating it twice).
function generateFromArchetype(answers, allPacks) {
  const applicable = allPacks.filter((p) => packApplies(p, answers));

  const spaces = [];
  const spaceIdByType = {};
  function ensureSpace(type, name) {
    if (spaceIdByType[type]) return spaceIdByType[type];
    const id = makeId("sp");
    spaceIdByType[type] = id;
    spaces.push({ id, name, type, icon: type === "whole_home" ? "wholeHome" : type, order: spaces.length + 1, active: true });
    return id;
  }

  const items = [];
  const assets = [];
  const routines = [];
  const usedPackIds = [];

  for (const pack of applicable) {
    usedPackIds.push(pack.packId);
    for (const sp of pack.spaces || []) ensureSpace(sp.type, sp.name);

    const assetIdByName = {};

    for (const a of pack.assets || []) {
      const id = makeId("ast");
      assetIdByName[a.name] = id;
      const catalogEntry = getOrCreate(a.name, "asset");
      assets.push({
        id, name: a.name, catalogKey: catalogEntry.key, icon: catalogEntry.icon,
        spaceId: ensureSpace(a.spaceType, a.spaceType), category: a.category,
        brand: null, model: null, serial: null, purchaseDate: null, purchasePrice: null,
        warrantyUntil: null, amcUntil: null,
        meter: a.meterType ? { type: a.meterType, value: 0, unit: a.meterUnit, updatedAt: null } : null,
        serviceIntervalDays: a.serviceIntervalDays ?? null,
        serviceIntervalMeter: a.serviceIntervalMeter ?? null,
        lastServiceMeterValue: 0,
        lastServicedAt: null, nextServiceDue: null,
        consumableItemIds: [], vendorName: null, vendorPhone: null, docs: [],
        expectedLifeYears: a.expectedLifeYears ?? null, replacementDueAt: null,
        source: "pack", packId: pack.packId,
      });
    }

    for (const i of pack.items || []) {
      const catalogEntry = getOrCreate(i.name, "item");
      items.push({
        id: makeId("itm"), name: i.name, catalogKey: catalogEntry.key, icon: catalogEntry.icon,
        spaceId: ensureSpace(i.spaceType, i.spaceType),
        category: pack.packId, unit: i.unit, qty: i.qty ?? i.parLevel, packSize: i.packSize,
        parLevel: i.parLevel, burnRate: i.defaultBurnRate ?? 0,
        projectedOutAt: null, expiryDate: null,
        status: (i.qty ?? i.parLevel) <= i.parLevel ? "low" : "ok",
        vendorHint: null, autoAddToList: true, source: "pack", packId: pack.packId,
      });
    }

    for (const r of pack.routines || []) {
      routines.push({
        id: makeId("rt"), title: r.title, spaceId: ensureSpace(r.spaceType, r.spaceType),
        assetId: r.assetRef ? assetIdByName[r.assetRef] ?? null : null,
        trigger: r.trigger, effort: r.effort, consequence: r.consequence, ownerClass: r.ownerClass,
        defaultAssigneeId: null, requiresItemIds: [],
        modeFilters: { pauseIn: r.pauseIn || [], boostIn: [] },
        steps: [], notes: "", active: true, source: "pack", packId: pack.packId, userEdited: false,
      });
    }
  }

  return { spaces, items, assets, routines, usedPackIds };
}

export { loadPacks, getCachedPacks, generateFromArchetype, packApplies, impliedSpaceTypes };
