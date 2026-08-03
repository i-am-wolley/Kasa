// Mode shapes per build memo §2.1.

export const modes = [
  {
    key: "normal", label: "Normal", active: true, since: "2026-01-01", until: null,
    pauseRoutineIds: [], boostRoutineIds: [], addRoutineIds: [], auto: false,
  },
  {
    key: "travel", label: "Travel", active: false, since: null, until: null,
    pauseRoutineIds: ["rt_mop_living", "rt_deepclean_bath", "rt_changesheets"],
    boostRoutineIds: [], addRoutineIds: [], auto: false,
  },
  {
    key: "guests_arriving", label: "Guests arriving", active: false, since: null, until: null,
    pauseRoutineIds: [], boostRoutineIds: [], addRoutineIds: ["rt_guest_deepclean"], auto: false,
  },
  {
    key: "help_on_leave", label: "Help on leave", active: false, since: null, until: null,
    pauseRoutineIds: [], boostRoutineIds: [], addRoutineIds: [], auto: true,
  },
];
