// Wishlist seed — a few realistic starter ideas so the screen doesn't open
// empty on first load (added 2026-08-04, user request: "a house wishlist
// where we can add home improvement ideas"). Mixes all three entry types
// (see js/routes/wishlist.js for the shape/rationale): a catalog-linked
// asset, a catalog-linked stock upgrade, and a free-form project with no
// catalog entry to link to.

export const wishlist = [
  {
    id: "wl_air_purifier",
    title: "Air purifier",
    type: "asset",
    catalogKey: "AST-AIR-PURIFIER",
    icon: "airPurifier",
    spaceId: "sp_bed",
    priority: "soon",
    estimatedCost: 12000,
    notes: "Bedroom air quality dips badly during Bengaluru's dusty months.",
    status: "idea",
    createdAt: "2026-07-20T09:00:00.000Z",
    acquiredAt: null,
  },
  {
    id: "wl_dishwasher",
    title: "Dishwasher",
    type: "asset",
    catalogKey: "AST-DISHWASHER",
    icon: "dishwasher",
    spaceId: "sp_utility",
    priority: "someday",
    estimatedCost: 35000,
    notes: "Would save real time on weeknights — waiting for a sale.",
    status: "idea",
    createdAt: "2026-07-10T09:00:00.000Z",
    acquiredAt: null,
  },
  {
    id: "wl_eco_detergent",
    title: "Switch to eco-friendly detergent",
    type: "item",
    catalogKey: "ITM-DETERGENT",
    icon: "laundrySupply",
    spaceId: "sp_utility",
    priority: "soon",
    estimatedCost: 450,
    notes: "Try the plant-based one next refill and see if it works as well.",
    status: "idea",
    createdAt: "2026-07-28T09:00:00.000Z",
    acquiredAt: null,
  },
  {
    id: "wl_repaint_living",
    title: "Repaint living room walls",
    type: "project",
    catalogKey: null,
    icon: "wishlist",
    spaceId: "sp_living",
    priority: "someday",
    estimatedCost: 18000,
    notes: "Current colour has been up for 6 years — thinking a warm sand tone.",
    status: "idea",
    createdAt: "2026-06-15T09:00:00.000Z",
    acquiredAt: null,
  },
];
