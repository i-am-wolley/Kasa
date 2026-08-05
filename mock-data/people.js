// Person shapes per build memo §2.1.

export const people = [
  {
    id: "u_vinod", name: "Vinod", kind: "member", role: null, email: "vinod@example.com",
    schedule: null, leave: [], payDay: null, payAmount: null, advances: [],
    handoverRoutineIds: [], avatarColor: "var(--gold)",
  },
  {
    id: "u_keerthana", name: "Keerthana", kind: "member", role: null, email: "keerthana@example.com",
    schedule: null, leave: [], payDay: null, payAmount: null, advances: [],
    handoverRoutineIds: [], avatarColor: "var(--terracotta)",
  },
  {
    id: "p_lakshmi", name: "Lakshmi", kind: "help", role: "maid",
    schedule: { days: ["mon", "tue", "wed", "thu", "fri", "sat"], time: "08:00" },
    leave: [], payDay: 5, payAmount: 4000, advances: [],
    handoverRoutineIds: ["rt_deepclean_bath", "rt_mop_living"],
    avatarColor: "var(--done)",
  },
];
