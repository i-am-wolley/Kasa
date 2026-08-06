// Content pack loader + archetype seeder (memo §10, §3.1 Step 3). Packs are
// content, not code — this file is the only thing that turns pack JSON +
// onboarding answers into real spaces/items/assets/routines. Adding a new
// pack should never require touching engine.js (memo's own acceptance
// test, memo build-plan Phase 3).

import { getOrCreate } from "./catalog.js";
import { genId } from "./state.js";

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

// Every home is assumed to have bath/kitchen/utility for now — good
// enough until a studio/no-help edge case actually needs modelling (memo
// doesn't specify per-archetype space omission rules yet). Kitchen added
// 2026-08-06 (user request: "1RK should have living room, kitchen, whole
// home, utility, bathroom by default") — was missing entirely before;
// every home has one, not just 1RK, so it's in the universal base list,
// not size-gated the way bedroom count is (see packs.json's own
// generateFromArchetype, which post-processes bedroom count separately).
function impliedSpaceTypes(answers) {
  const base = ["bath", "bedroom", "living", "kitchen", "utility", "entry", "whole_home"];
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

// 2026-08-08 fix — REAL BUG FOUND: this used to be a bare local counter
// (`${prefix}_${idSeq}`, idSeq starting at 0 every fresh page load), with
// no session differentiation at all. Any two separate app sessions that
// each ran generateFromArchetype() (onboarding, or houses.js's "Add
// house", which runs the exact same wizard) produced IDENTICAL space/
// asset/item/routine ids for their Nth/Nth+1/etc. generated entity —
// "sp_1", "sp_2", "sp_3"... every single time, regardless of what already
// existed in the household from an earlier session. Reproduced directly:
// a household with an existing "studio" house (spaces sp_1/sp_3/sp_4/
// sp_10/sp_19/sp_60, from an earlier onboarding run) would get a BRAND
// NEW house's spaces assigned those exact same ids again on this session's
// very first onboarding run, since idSeq restarts at 0 on every load. That
// silently creates two DIFFERENT space objects (different houseId,
// different name) sharing one id in `state.spaces` — every byId() lookup
// for that id (used constantly: icon resolution, space-name display,
// edit-sheet targeting, delete) then resolves to whichever one Array.find
// hits first, cross-contaminating data between the two houses. This is
// very plausibly the root cause behind the "duplication happening on
// mobile, not reproducible on web" report — a fresh app open (much more
// frequent on mobile, where the OS/browser aggressively kills backgrounded
// PWA tabs) is exactly the trigger, while a desktop browser tab tends to
// stay in one long-lived session where idSeq just keeps counting up and
// never collides with itself. Fixed by delegating to state.js's own
// genId() (`${prefix}_${Date.now().toString(36)}${idSeq}` — a session
// timestamp baked into every id, not just a bare counter), the same
// generator every other entity in the app already safely uses.
function makeId(prefix) {
  return genId(prefix);
}

// How many separate bedroom spaces a home's size implies (2026-08-06, user
// request: "3BHK ideally 3 bedrooms should be shown up") — the pack-driven
// space list below always produces exactly one deduped "bedroom" space
// regardless of size (packs reference a spaceTYPE, not a count); this is
// applied as a post-pass to expand or drop it. 1RK folds sleeping into the
// one general room, same as Studio — no separate bedroom.
function bedroomCountForSize(size) {
  if (size === "1RK" || size === "Studio") return 0;
  const match = /^(\d+)BHK/.exec(size || "");
  return match ? Number(match[1]) : 1;
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

  // Guarantee every baseline implied space type actually exists, even if
  // no applicable pack happens to declare or reference it (2026-08-06) —
  // spaces have only ever been created as a side effect of a pack's own
  // `pack.spaces` array or its assets/routines referencing a spaceType,
  // which happened to cover every type EXCEPT the newly-added "kitchen"
  // (no dedicated kitchen.json pack exists). A no-op for any type a pack
  // already created (ensureSpace returns the existing id without
  // touching it), so this only ever fills a real gap.
  const BASE_SPACE_NAMES = { bath: "Bathroom", bedroom: "Bedroom", living: "Living room", kitchen: "Kitchen", utility: "Utility", entry: "Entry", whole_home: "Whole home", balcony: "Balcony" };
  for (const type of impliedSpaceTypes(answers)) {
    ensureSpace(type, BASE_SPACE_NAMES[type] || type);
  }

  // Expand/collapse the single deduped "bedroom" space to match the
  // home's actual size (see bedroomCountForSize above). Any item/asset/
  // routine that referenced the original single bedroom id is left
  // pointing at a now-possibly-renumbered or removed space — harmless,
  // since onboard.js's review step (2026-08-06) no longer seeds
  // items/assets/routines at all, only the reviewed space list itself.
  const bedroomIdx = spaces.findIndex((s) => s.type === "bedroom");
  if (bedroomIdx !== -1) {
    const count = bedroomCountForSize(answers.size);
    const original = spaces[bedroomIdx];
    if (count === 0) {
      spaces.splice(bedroomIdx, 1);
    } else if (count > 1) {
      const expanded = [];
      for (let i = 1; i <= count; i++) {
        expanded.push({ ...original, id: i === 1 ? original.id : makeId("sp"), name: `Bedroom ${i}`, order: original.order + i - 1 });
      }
      spaces.splice(bedroomIdx, 1, ...expanded);
    }
    // count === 1: the single generated "Bedroom" space is left as-is.
  }

  return { spaces, items, assets, routines, usedPackIds };
}

export { loadPacks, getCachedPacks, generateFromArchetype, packApplies, impliedSpaceTypes, bedroomCountForSize };
