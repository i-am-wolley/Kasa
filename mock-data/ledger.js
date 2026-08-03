// Completion log per build memo §2.1 (`households/{hid}/ledger/{entryId}`).
// engine.js derives each floating/fixed routine's lastCompletion from the
// most recent entry here — nothing computes lastDoneAt any other way.

export const ledger = [
  { id: "lg_1", routineId: "rt_descale_showerhead", doneAt: "2026-05-20", doneBy: "u_vinod" },
  { id: "lg_2", routineId: "rt_deepclean_bath", doneAt: "2026-07-20", doneBy: "p_lakshmi" },
  { id: "lg_3", routineId: "rt_clean_fans", doneAt: "2026-06-01", doneBy: "u_keerthana" },
  { id: "lg_4", routineId: "rt_watertank", doneAt: "2026-01-20", doneBy: null },
  { id: "lg_5", routineId: "rt_wipe_doormat", doneAt: "2026-07-10", doneBy: "u_vinod" },
  { id: "lg_6", routineId: "rt_mop_living", doneAt: "2026-07-31", doneBy: "p_lakshmi" },
  { id: "lg_7", routineId: "rt_paysociety", doneAt: "2026-07-05", doneBy: "u_vinod" },
  { id: "lg_8", routineId: "rt_changesheets", doneAt: "2026-07-26", doneBy: "u_keerthana" },
  { id: "lg_9", routineId: "rt_reorder_lpg", doneAt: "2026-07-01", doneBy: "u_vinod" },
];
