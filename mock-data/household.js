// Seed household — 2BHK, couple + one helper, Bengaluru. Matches the
// archetype onboarding would generate (memo §3.1 Step 3), used here as the
// Phase 0-3 mock data source before Firebase lands (memo build-plan Phase 4).

export const household = {
  id: "hh_demo",
  name: "Vinod & Keerthana's home",
  homeType: "apartment",
  size: "2bhk",
  whoLivesHere: "couple",
  city: "Bengaluru",
  memberUids: ["u_vinod", "u_keerthana"],
  modes: ["normal", "travel", "guests_arriving", "help_on_leave"],
  activeMode: "normal",
  settings: {
    notifyTime: "08:30",
    quietHours: { start: "21:30", end: "07:30" },
    oneNotifPerDay: true,
  },
  packVersions: {
    core: 1, bath: 1, laundry: 1, help: 1, appliances: 1,
    utility: 1, bedroom: 1, living: 1, plants: 1, admin: 1, entry: 1, vehicle: 1, study: 1,
  },
};
