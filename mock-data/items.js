// Item (Stock) shapes per build memo §2.1. `status`/`projectedOutAt` are
// seeded plausibly for now — real burn-rate computation (memo §5.2) lands
// in build-plan Phase 5; until then these are static, not derived.

export const items = [
  {
    id: "itm_toothpaste", name: "Toothpaste", spaceId: "sp_bath", category: "bath",
    unit: "piece", qty: 1, packSize: 1, parLevel: 1, burnRate: 0.012,
    projectedOutAt: "2026-08-28", expiryDate: null, status: "low",
    vendorHint: null, autoAddToList: true, source: "pack",
  },
  {
    id: "itm_toiletcleaner", name: "Toilet cleaner", spaceId: "sp_bath", category: "bath",
    unit: "piece", qty: 2, packSize: 1, parLevel: 1, burnRate: 0.03,
    projectedOutAt: "2026-09-10", expiryDate: null, status: "ok",
    vendorHint: null, autoAddToList: true, source: "pack",
  },
  {
    id: "itm_handwash", name: "Handwash refill", spaceId: "sp_bath", category: "bath",
    unit: "ml", qty: 80, packSize: 500, parLevel: 100, burnRate: 8,
    projectedOutAt: "2026-08-04", expiryDate: null, status: "low",
    vendorHint: null, autoAddToList: true, source: "pack",
  },
  {
    id: "itm_toiletpaper", name: "Toilet paper", spaceId: "sp_bath", category: "bath",
    unit: "roll", qty: 4, packSize: 4, parLevel: 2, burnRate: 0.2,
    projectedOutAt: "2026-09-01", expiryDate: null, status: "ok",
    vendorHint: null, autoAddToList: true, source: "pack",
  },
  {
    id: "itm_detergent", name: "Detergent", spaceId: "sp_utility", category: "laundry",
    unit: "kg", qty: 1.5, packSize: 1, parLevel: 1, burnRate: 0.1,
    projectedOutAt: "2026-08-09", expiryDate: null, status: "ok",
    vendorHint: null, autoAddToList: true, source: "pack",
  },
  {
    id: "itm_lpg", name: "LPG cylinder", spaceId: "sp_utility", category: "gas",
    unit: "piece", qty: 0, packSize: 1, parLevel: 1, burnRate: 0.033,
    projectedOutAt: "2026-08-03", expiryDate: null, status: "out",
    vendorHint: "tel:+919800000000", autoAddToList: false, source: "pack",
  },
  {
    id: "itm_mosquito", name: "Mosquito repellent refill", spaceId: "sp_living", category: "living",
    unit: "piece", qty: 2, packSize: 1, parLevel: 1, burnRate: 0.05,
    projectedOutAt: "2026-09-20", expiryDate: null, status: "ok",
    vendorHint: null, autoAddToList: true, source: "pack",
  },
  {
    id: "itm_naphthalene", name: "Naphthalene balls", spaceId: "sp_bath", category: "bath",
    unit: "pack", qty: 0, packSize: 1, parLevel: 1, burnRate: 0.01,
    projectedOutAt: "2026-08-01", expiryDate: null, status: "out",
    vendorHint: null, autoAddToList: true, source: "pack",
  },
];
