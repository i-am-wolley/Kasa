// Schema-version migration mechanism (2026-08-05, user request: "when
// certain attributes are made and we might need to migrate old data,
// create a mechanism for version bump to migrate old data"). Numbered,
// idempotent steps applied in order against whatever schemaVersion a
// loaded household actually carries. The mock household starts
// unversioned (no schemaVersion field at all — treated as version 1),
// the same shape a Firestore-loaded household will have once Phase 4
// lands: old documents don't gain new fields on their own just because
// the code that reads them changed, something has to walk them forward.
// Each step is written to be safe to run twice (guarded by checking
// whether its own target shape already exists), so a household stuck on
// an old version and one already current both come out the same either
// way.
//
// To add a future migration: write a new numbered function below, bump
// CURRENT_SCHEMA_VERSION. Nothing else changes — state.js calls migrate()
// once at load and isn't aware of individual steps.

import { findByKey } from "./catalog.js";

let migIdSeq = 0;
function migId(prefix) {
  migIdSeq += 1;
  return `${prefix}_mig${Date.now().toString(36)}${migIdSeq}`;
}

const CURRENT_SCHEMA_VERSION = 8;

// Keyed by the version a step upgrades TO — migrations[2] takes a v1
// household to v2, etc.
const migrations = {
  // v1 -> v2 (2026-08-05): introduces multi-house support ("a household
  // can have more than one house, with its own spaces, routines, assets").
  // A pre-v2 household has spaces with no houseId at all — wrap them into
  // one default house so every space still resolves to a real house
  // rather than needing a "houseless space" special case scattered
  // through every screen that filters by house.
  2: (state) => {
    if (state.houses?.length) return; // already migrated
    const house = { id: migId("house"), name: "My Home", createdAt: new Date().toISOString() };
    state.houses = [house];
    for (const space of state.spaces) {
      if (!space.houseId) space.houseId = house.id;
    }
    state.household.activeHouseIds = [house.id];
  },

  // v2 -> v3 (2026-08-06): a household-level notification preference — a
  // daily consolidated "what's due" summary, off by default, toggleable
  // in More (see notify.js). A pre-v3 household has no notifySettings
  // field at all.
  3: (state) => {
    if (state.household.notifySettings) return;
    state.household.notifySettings = { enabled: false, time: "07:00" };
  },

  // v3 -> v4 (2026-08-07): auto/manual load-smoothing preference — "auto"
  // preserves the exact behavior every household already had (smoothing
  // ran automatically as part of every regenerate()), so this is a pure
  // backfill, not a behavior change for anyone who doesn't touch the
  // new setting.
  4: (state) => {
    if (state.household.smoothingMode) return;
    state.household.smoothingMode = "auto";
  },

  // v4 -> v5 (2026-08-09): consequence tier rename — "safety" -> "unsafe"
  // (same meaning, plainer word) and "degrading" retired in favour of
  // "unhygienic" for the routines that were actually about cleanliness
  // (RO/water filters, showerheads, pest/damp, coffee makers, pool
  // filters, etc.) or "damaging" for the rest (appliance servicing,
  // vehicle maintenance, financial paperwork) — mirrors the exact
  // reclassification applied to catalog.js/packs/roomTemplates.js this
  // same round, keyed by routine title so it's a real per-routine
  // decision, not a blind find-replace. Anything not in the list (a
  // household's own custom routine) falls back to "damaging", the safer
  // generic bucket. Idempotent — matches based on the OLD values, so
  // running it twice is a no-op the second time.
  5: (state) => {
    const UNHYGIENIC_TITLES = new Set([
      "Service RO unit", "Replace furnace filter", "Clean evaporative cooler pads",
      "Replace air purifier filter", "Clean chimney filter mesh", "Sanitize water dispenser",
      "Descale coffee maker", "Clean pool pump filter", "Descale showerhead and taps",
      "Check storage for pests and damp",
    ]);
    const COSMETIC_TITLES = new Set(["Review and file warranty documents"]);
    for (const routine of state.routines || []) {
      if (routine.consequence === "safety") routine.consequence = "unsafe";
      else if (routine.consequence === "degrading") {
        routine.consequence = COSMETIC_TITLES.has(routine.title)
          ? "cosmetic"
          : UNHYGIENIC_TITLES.has(routine.title) ? "unhygienic" : "damaging";
      }
    }
  },

  // v5 -> v6 (2026-08-10): the activity log (state.js's logActivity()) — a
  // pre-v6 household has no activityLog field at all.
  6: (state) => {
    if (state.activityLog) return;
    state.activityLog = [];
  },

  // v6 -> v7 (2026-08-10): backfills `category` onto every existing asset
  // from its catalog entry — a real gap found while building Insights'
  // Forecast clustering (user request: "similar assets together"), which
  // needs `category` to group by. The catalog has always carried a
  // `category` per entry, but nothing ever copied it onto the asset
  // RECORD itself the way `icon`/`expectedLifeYears` already are — assets.js
  // now stamps it on every future add/edit, this one-time pass catches
  // everything that already existed before that.
  7: (state) => {
    for (const asset of state.assets || []) {
      if (asset.category != null || !asset.catalogKey) continue;
      const entry = findByKey(asset.catalogKey, "asset");
      if (entry?.category) asset.category = entry.category;
    }
  },

  // v7 -> v8 (2026-08-10): backfills `cost: 0` onto every wishlist project
  // checklist sub-item that predates the per-item cost field (user
  // request: "for the already created projects with assets/items/tasks –
  // put 0 as the default during migration as else it will be redundancy")
  // — sumSubItemCosts() (wishlist.js) treats a missing cost as 0 anyway,
  // but stamping it explicitly here keeps the stored data itself honest
  // rather than leaning on a runtime fallback everywhere it's read.
  8: (state) => {
    for (const entry of state.wishlist || []) {
      for (const sub of entry.subItems || []) {
        if (sub.cost == null) sub.cost = 0;
      }
    }
  },
};

function migrate(state) {
  const from = state.household.schemaVersion || 1;
  for (let v = from + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    migrations[v]?.(state);
  }
  state.household.schemaVersion = CURRENT_SCHEMA_VERSION;
}

export { migrate, CURRENT_SCHEMA_VERSION };
