// Aggregator — a stand-in for a Firestore read layer during the mock-data
// phase (build-plan Phase 0-3). state.js seeds from this; db.js swaps it
// for real Firestore reads in Phase 4 without changing state.js's shape.

export { household } from "./household.js";
export { spaces } from "./spaces.js";
export { items } from "./items.js";
export { assets } from "./assets.js";
export { routines } from "./routines.js";
export { ledger } from "./ledger.js";
export { people } from "./people.js";
export { modes } from "./modes.js";
export { wishlist } from "./wishlist.js";
export { habits } from "./habits.js";
export { habitLog } from "./habitLog.js";
export { tasks } from "./tasks.js";
export { snoozeLog } from "./snoozeLog.js";
