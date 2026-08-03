// Global asset + item catalog — master data, not household data. Every
// asset and stock item in Kasa carries a stable `catalogKey` back to one
// of these entries (or a session-generated custom one), so the same
// real-world thing always resolves to the same key instead of spawning a
// new free-text row every time someone types its name again. That key is
// what later automation (service-interval defaults, consumable coupling,
// cross-household benchmarking) will hang off — memo doesn't spec this
// catalog explicitly, but §2.2's "content, not code" principle and §5.9's
// "consumable coupling" both assume some stable identity for a thing
// beyond its free-text name, which is what this file provides.
//
// Curated to span more than one climate/region/market — not just the
// Indian-apartment archetype the mock household and packs use today:
// storage geysers (South/Southeast Asia) sit next to tankless heaters
// (Europe/Japan) and US-style tank heaters; evaporative coolers (hot-dry
// US Southwest, Middle East, North Africa) sit next to boilers (European
// central heating) and furnaces (North America); inverters/UPS (India,
// anywhere with grid instability) sit next to generators and solar.
//
// Icons are looked up by name from js/ui/icons.js — one per asset entry
// (distinct identity per the user's request), one per item *category*
// (memo's own icon table groups consumables by category too, e.g.
// "Water", "Power & gas" — same pattern, applied at catalog granularity).

// `suggestedRoutines` (memo §4.1/§4.2-shaped: title/trigger/effort/consequence/
// ownerClass, optional requiresItemKeys — catalog item keys, resolved to real
// item ids only if that item already exists in the household) are offered as
// pre-checked chips when the asset is added from this catalog entry (added
// 2026-08-03, user request — "will changing service days automatically add a
// routine?" answer: only if you accept one of these at add time). Left empty
// deliberately wherever no real household chore applies (mobile phone, sofa's
// neighbours like a bookshelf, etc.) — memo's own principle: if it doesn't
// help the house tell you something before it becomes a problem, it doesn't
// belong.
const ASSETS = [
  // Water heating
  { key: "AST-GEYSER", name: "Geyser", icon: "waterHeaterTank", category: "water_heating", serviceIntervalDays: 365, expectedLifeYears: 8,
    suggestedRoutines: [
      { title: "Service geyser", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 3, consequence: "degrading", ownerClass: "vendor" },
      { title: "Check pressure relief valve", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 1, consequence: "safety", ownerClass: "member" },
    ] },
  { key: "AST-WATER-HEATER-TANKLESS", name: "Tankless / instant water heater", icon: "waterHeaterTankless", category: "water_heating", serviceIntervalDays: 365, expectedLifeYears: 12,
    suggestedRoutines: [{ title: "Descale tankless heater", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 2, consequence: "degrading", ownerClass: "vendor" }] },
  { key: "AST-WATER-HEATER-TANK", name: "Tank water heater", icon: "waterHeaterTank", category: "water_heating", serviceIntervalDays: 365, expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Flush water heater tank", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 2, consequence: "degrading", ownerClass: "member" }] },
  { key: "AST-SOLAR-WATER-HEATER", name: "Solar water heater", icon: "solarWaterHeater", category: "water_heating", serviceIntervalDays: 365, expectedLifeYears: 15,
    suggestedRoutines: [{ title: "Inspect solar water heater panel", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 2, consequence: "degrading", ownerClass: "vendor" }] },

  // Water treatment & supply
  { key: "AST-RO-UNIT", name: "RO / water purifier", icon: "roUnit", category: "water_treatment", serviceIntervalDays: 180, serviceIntervalMeter: 3000, expectedLifeYears: 7,
    suggestedRoutines: [{ title: "Service RO unit", trigger: { type: "usage_meter", meterDelta: 3000 }, effort: 3, consequence: "degrading", ownerClass: "vendor" }] },
  { key: "AST-WATER-SOFTENER", name: "Water softener", icon: "waterSoftener", category: "water_treatment", serviceIntervalDays: 180, expectedLifeYears: 12,
    suggestedRoutines: [{ title: "Refill water softener salt", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "degrading", ownerClass: "member" }] },
  { key: "AST-OVERHEAD-TANK", name: "Overhead water tank", icon: "waterTank", category: "water_treatment", serviceIntervalDays: 180, expectedLifeYears: 15,
    suggestedRoutines: [{ title: "Clean overhead water tank", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 4, consequence: "safety", ownerClass: "vendor" }] },
  { key: "AST-SUMP-PUMP", name: "Sump pump", icon: "sumpPump", category: "water_treatment", serviceIntervalDays: 365, expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Test sump pump", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 1, consequence: "damaging", ownerClass: "member" }] },
  { key: "AST-WELL-PUMP", name: "Well pump", icon: "wellPump", category: "water_treatment", serviceIntervalDays: 365, expectedLifeYears: 12,
    suggestedRoutines: [{ title: "Inspect well pump", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 2, consequence: "damaging", ownerClass: "vendor" }] },
  { key: "AST-SEPTIC-TANK", name: "Septic tank", icon: "septicTank", category: "water_treatment", serviceIntervalDays: 1095, expectedLifeYears: 30,
    suggestedRoutines: [{ title: "Pump septic tank", trigger: { type: "floating_since_last", intervalDays: 1095 }, effort: 4, consequence: "safety", ownerClass: "vendor" }] },

  // Climate control
  { key: "AST-AC-SPLIT", name: "Split AC", icon: "acSplit", category: "climate", serviceIntervalDays: 180, expectedLifeYears: 10,
    suggestedRoutines: [
      { title: "Service AC", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 3, consequence: "degrading", ownerClass: "vendor" },
      { title: "Clean AC filter", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either", requiresItemKeys: ["ITM-AC-FILTER"] },
    ] },
  { key: "AST-AC-WINDOW", name: "Window AC", icon: "acWindow", category: "climate", serviceIntervalDays: 180, expectedLifeYears: 8,
    suggestedRoutines: [
      { title: "Service AC", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 3, consequence: "degrading", ownerClass: "vendor" },
      { title: "Clean AC filter", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either", requiresItemKeys: ["ITM-AC-FILTER"] },
    ] },
  { key: "AST-AC-CENTRAL", name: "Central air conditioning", icon: "acCentral", category: "climate", serviceIntervalDays: 180, expectedLifeYears: 15,
    suggestedRoutines: [
      { title: "Service AC", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 3, consequence: "degrading", ownerClass: "vendor" },
      { title: "Clean AC filter", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either", requiresItemKeys: ["ITM-AC-FILTER"] },
    ] },
  { key: "AST-FURNACE", name: "Furnace", icon: "furnace", category: "climate", serviceIntervalDays: 365, expectedLifeYears: 18,
    suggestedRoutines: [
      { title: "Service furnace", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 3, consequence: "safety", ownerClass: "vendor" },
      { title: "Replace furnace filter", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 1, consequence: "degrading", ownerClass: "either" },
    ] },
  { key: "AST-BOILER", name: "Boiler", icon: "boiler", category: "climate", serviceIntervalDays: 365, expectedLifeYears: 15,
    suggestedRoutines: [{ title: "Service boiler", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 3, consequence: "safety", ownerClass: "vendor" }] },
  { key: "AST-HEAT-PUMP", name: "Heat pump", icon: "heatPump", category: "climate", serviceIntervalDays: 365, expectedLifeYears: 15,
    suggestedRoutines: [{ title: "Service heat pump", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 3, consequence: "degrading", ownerClass: "vendor" }] },
  { key: "AST-SPACE-HEATER", name: "Space heater", icon: "spaceHeater", category: "climate", serviceIntervalDays: 365, expectedLifeYears: 6 },
  { key: "AST-EVAP-COOLER", name: "Evaporative cooler", icon: "evapCooler", category: "climate", serviceIntervalDays: 120, expectedLifeYears: 8,
    suggestedRoutines: [{ title: "Clean evaporative cooler pads", trigger: { type: "floating_since_last", intervalDays: 120 }, effort: 2, consequence: "degrading", ownerClass: "either" }] },
  { key: "AST-CEILING-FAN", name: "Ceiling fan", icon: "ceilingFan", category: "climate", serviceIntervalDays: 365, expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Clean ceiling fan blades", trigger: { type: "floating_since_last", intervalDays: 60 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-EXHAUST-FAN", name: "Exhaust fan", icon: "exhaustFan", category: "climate", serviceIntervalDays: 365, expectedLifeYears: 8,
    suggestedRoutines: [{ title: "Clean exhaust fan", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-DEHUMIDIFIER", name: "Dehumidifier", icon: "dehumidifier", category: "climate", serviceIntervalDays: 180, expectedLifeYears: 6,
    suggestedRoutines: [{ title: "Clean dehumidifier tank and filter", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-HUMIDIFIER", name: "Humidifier", icon: "humidifier", category: "climate", serviceIntervalDays: 90, expectedLifeYears: 5,
    suggestedRoutines: [{ title: "Clean humidifier tank", trigger: { type: "floating_since_last", intervalDays: 14 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-AIR-PURIFIER", name: "Air purifier", icon: "airPurifier", category: "climate", serviceIntervalDays: 90, expectedLifeYears: 6,
    suggestedRoutines: [{ title: "Replace air purifier filter", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 1, consequence: "degrading", ownerClass: "either" }] },

  // Power
  { key: "AST-INVERTER", name: "Inverter / UPS", icon: "inverter", category: "power", serviceIntervalDays: 365, expectedLifeYears: 5,
    suggestedRoutines: [{ title: "Top up inverter battery water", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 1, consequence: "damaging", ownerClass: "member" }] },
  { key: "AST-GENERATOR", name: "Generator", icon: "generator", category: "power", serviceIntervalDays: 180, expectedLifeYears: 15,
    suggestedRoutines: [
      { title: "Service generator", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 3, consequence: "degrading", ownerClass: "vendor" },
      { title: "Test-run generator", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "damaging", ownerClass: "member" },
    ] },
  { key: "AST-SOLAR-PANEL", name: "Solar panel system", icon: "solarPanel", category: "power", serviceIntervalDays: 365, expectedLifeYears: 25,
    suggestedRoutines: [{ title: "Clean solar panels", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 2, consequence: "degrading", ownerClass: "either" }] },

  // Laundry appliances (service tracking only — pantry stock stays in Miso)
  { key: "AST-WASHING-MACHINE", name: "Washing machine", icon: "washingMachine", category: "appliance", serviceIntervalMeter: 150, expectedLifeYears: 10,
    suggestedRoutines: [
      { title: "Service washing machine", trigger: { type: "usage_meter", meterDelta: 150 }, effort: 3, consequence: "degrading", ownerClass: "vendor" },
      { title: "Clean washing machine drum and filter", trigger: { type: "floating_since_last", intervalDays: 60 }, effort: 1, consequence: "cosmetic", ownerClass: "either" },
    ] },
  { key: "AST-DRYER", name: "Clothes dryer", icon: "dryer", category: "appliance", serviceIntervalMeter: 150, expectedLifeYears: 12,
    suggestedRoutines: [{ title: "Clean dryer lint trap", trigger: { type: "floating_since_last", intervalDays: 14 }, effort: 1, consequence: "safety", ownerClass: "either" }] },
  { key: "AST-FRIDGE", name: "Refrigerator", icon: "fridge", category: "appliance", serviceIntervalDays: 365, expectedLifeYears: 12,
    suggestedRoutines: [
      { title: "Defrost and clean fridge", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 2, consequence: "cosmetic", ownerClass: "either" },
      { title: "Clean fridge coils", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 2, consequence: "degrading", ownerClass: "either" },
    ] },
  { key: "AST-DISHWASHER", name: "Dishwasher", icon: "dishwasher", category: "appliance", serviceIntervalMeter: 150, expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Clean dishwasher filter", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-VACUUM", name: "Vacuum cleaner", icon: "vacuum", category: "appliance", serviceIntervalDays: 365, expectedLifeYears: 6,
    suggestedRoutines: [{ title: "Empty and clean vacuum", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-ROBOT-VACUUM", name: "Robot vacuum", icon: "robotVacuum", category: "appliance", expectedLifeYears: 5,
    suggestedRoutines: [
      { title: "Empty robot vacuum bin and clean sensors", trigger: { type: "floating_since_last", intervalDays: 14 }, effort: 1, consequence: "cosmetic", ownerClass: "either" },
      { title: "Replace robot vacuum brushes and filter", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 1, consequence: "degrading", ownerClass: "either" },
    ] },

  // Safety & security
  { key: "AST-SMOKE-DETECTOR", name: "Smoke / CO detector", icon: "detector", category: "safety", serviceIntervalDays: 180, expectedLifeYears: 10,
    suggestedRoutines: [
      { title: "Test smoke / CO detector", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 1, consequence: "safety", ownerClass: "member" },
      { title: "Replace detector battery", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 1, consequence: "safety", ownerClass: "member", requiresItemKeys: ["ITM-BATTERIES-AA"] },
    ] },
  { key: "AST-FIRE-EXTINGUISHER", name: "Fire extinguisher", icon: "fireExtinguisher", category: "safety", serviceIntervalDays: 365, expectedLifeYears: 12,
    suggestedRoutines: [{ title: "Check fire extinguisher pressure", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 1, consequence: "safety", ownerClass: "member" }] },
  { key: "AST-SECURITY-CAMERA", name: "Security camera", icon: "securityCamera", category: "safety", serviceIntervalDays: 365, expectedLifeYears: 6,
    suggestedRoutines: [{ title: "Check security camera footage and storage", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "degrading", ownerClass: "member" }] },
  { key: "AST-GARAGE-DOOR-OPENER", name: "Garage door opener", icon: "garageDoorOpener", category: "safety", serviceIntervalDays: 365, expectedLifeYears: 12,
    suggestedRoutines: [
      { title: "Test garage door auto-reverse safety", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 1, consequence: "safety", ownerClass: "member" },
      { title: "Lubricate garage door tracks", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 1, consequence: "degrading", ownerClass: "either" },
    ] },

  // Electronics & AV (added 2026-08-03, user request for broader coverage —
  // most electronics deliberately get no suggested routines, see file note)
  { key: "AST-LAPTOP", name: "Laptop", icon: "laptop", category: "electronics", expectedLifeYears: 5 },
  { key: "AST-DESKTOP", name: "Desktop computer", icon: "desktopComputer", category: "electronics", expectedLifeYears: 6 },
  { key: "AST-MONITOR", name: "Monitor", icon: "monitor", category: "electronics", expectedLifeYears: 7 },
  { key: "AST-PRINTER", name: "Printer", icon: "printer", category: "electronics", serviceIntervalDays: 365, expectedLifeYears: 6,
    suggestedRoutines: [{ title: "Clean printer heads", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-ROUTER", name: "Wi-Fi router", icon: "router", category: "electronics", expectedLifeYears: 5,
    suggestedRoutines: [{ title: "Restart router", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-TELEVISION", name: "Television", icon: "television", category: "electronics", expectedLifeYears: 8 },
  { key: "AST-SET-TOP-BOX", name: "Streaming / set-top box", icon: "setTopBox", category: "electronics", expectedLifeYears: 5 },
  { key: "AST-AMPLIFIER", name: "Amplifier", icon: "amplifier", category: "electronics", expectedLifeYears: 12 },
  { key: "AST-MUSIC-SYSTEM", name: "Music system / stereo", icon: "musicSystem", category: "electronics", expectedLifeYears: 10 },
  { key: "AST-SPEAKERS", name: "Speakers", icon: "speakers", category: "electronics", expectedLifeYears: 10 },
  { key: "AST-HOME-THEATER", name: "Home theater system", icon: "homeTheater", category: "electronics", expectedLifeYears: 8 },
  { key: "AST-GAMING-CONSOLE", name: "Gaming console", icon: "gamingConsole", category: "electronics", expectedLifeYears: 6 },
  { key: "AST-PROJECTOR", name: "Projector", icon: "projector", category: "electronics", serviceIntervalDays: 365, expectedLifeYears: 6,
    suggestedRoutines: [{ title: "Clean projector filter and lens", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 1, consequence: "degrading", ownerClass: "either" }] },
  { key: "AST-MOBILE-PHONE", name: "Mobile phone", icon: "mobilePhone", category: "electronics", expectedLifeYears: 3 },
  { key: "AST-TABLET", name: "Tablet", icon: "tablet", category: "electronics", expectedLifeYears: 4 },
  { key: "AST-SMARTWATCH", name: "Smartwatch", icon: "smartwatch", category: "electronics", expectedLifeYears: 3 },
  { key: "AST-CAMERA", name: "Camera", icon: "camera", category: "electronics", expectedLifeYears: 8 },

  // Furniture — no service schedule typically, tracked for age/replacement
  { key: "AST-SOFA", name: "Sofa", icon: "sofa", category: "furniture", expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Vacuum and rotate sofa cushions", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-BED-FRAME", name: "Bed / cot", icon: "bedFrame", category: "furniture", expectedLifeYears: 15 },
  { key: "AST-MATTRESS", name: "Mattress", icon: "mattress", category: "furniture", expectedLifeYears: 8,
    suggestedRoutines: [{ title: "Flip / rotate mattress", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 2, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-DINING-TABLE", name: "Dining table", icon: "diningTable", category: "furniture", expectedLifeYears: 15 },
  { key: "AST-WARDROBE", name: "Wardrobe", icon: "wardrobe", category: "furniture", expectedLifeYears: 15,
    suggestedRoutines: [{ title: "Air out wardrobe, check for moisture", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-RECLINER", name: "Recliner", icon: "recliner", category: "furniture", expectedLifeYears: 10 },
  { key: "AST-OFFICE-CHAIR", name: "Office chair", icon: "officeChair", category: "furniture", expectedLifeYears: 7 },
  { key: "AST-BOOKSHELF", name: "Bookshelf", icon: "bookshelf", category: "furniture", expectedLifeYears: 15 },
  { key: "AST-TV-UNIT", name: "TV unit", icon: "tvUnit", category: "furniture", expectedLifeYears: 12 },
  { key: "AST-CURTAINS", name: "Curtains / blinds", icon: "curtains", category: "furniture", expectedLifeYears: 6,
    suggestedRoutines: [{ title: "Wash curtains", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 2, consequence: "cosmetic", ownerClass: "either" }] },

  // Kitchen-adjacent appliances (asset/service tracking only — pantry stock stays in Miso)
  { key: "AST-MICROWAVE", name: "Microwave", icon: "microwave", category: "appliance", serviceIntervalDays: 365, expectedLifeYears: 9,
    suggestedRoutines: [{ title: "Deep clean microwave", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-CHIMNEY", name: "Chimney / exhaust hood", icon: "chimney", category: "appliance", serviceIntervalDays: 180, expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Clean chimney filter mesh", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 2, consequence: "degrading", ownerClass: "either" }] },
  { key: "AST-INDUCTION-COOKTOP", name: "Induction cooktop", icon: "inductionCooktop", category: "appliance", expectedLifeYears: 8 },
  { key: "AST-GAS-STOVE", name: "Gas stove", icon: "gasStove", category: "appliance", serviceIntervalDays: 365, expectedLifeYears: 10,
    suggestedRoutines: [
      { title: "Clean gas stove burners", trigger: { type: "floating_since_last", intervalDays: 14 }, effort: 1, consequence: "cosmetic", ownerClass: "either" },
      { title: "Check gas stove for leaks", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 1, consequence: "safety", ownerClass: "vendor" },
    ] },
  { key: "AST-WATER-DISPENSER", name: "Water dispenser", icon: "waterDispenser", category: "appliance", serviceIntervalDays: 180, expectedLifeYears: 7,
    suggestedRoutines: [{ title: "Sanitize water dispenser", trigger: { type: "floating_since_last", intervalDays: 60 }, effort: 1, consequence: "degrading", ownerClass: "either" }] },
  { key: "AST-COFFEE-MAKER", name: "Coffee maker", icon: "coffeeMaker", category: "appliance", expectedLifeYears: 5,
    suggestedRoutines: [{ title: "Descale coffee maker", trigger: { type: "floating_since_last", intervalDays: 60 }, effort: 1, consequence: "degrading", ownerClass: "either" }] },
  { key: "AST-KETTLE", name: "Electric kettle", icon: "kettle", category: "appliance", expectedLifeYears: 4,
    suggestedRoutines: [{ title: "Descale kettle", trigger: { type: "floating_since_last", intervalDays: 60 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
  { key: "AST-TOASTER", name: "Toaster", icon: "toaster", category: "appliance", expectedLifeYears: 5 },
  { key: "AST-MIXER-GRINDER", name: "Mixer grinder", icon: "mixerGrinder", category: "appliance", expectedLifeYears: 6 },

  // Outdoor & garden equipment
  { key: "AST-LAWN-MOWER", name: "Lawn mower", icon: "lawnMower", category: "outdoor", serviceIntervalDays: 365, expectedLifeYears: 8,
    suggestedRoutines: [
      { title: "Service lawn mower", trigger: { type: "floating_since_last", intervalDays: 365 }, effort: 2, consequence: "degrading", ownerClass: "vendor" },
      { title: "Sharpen mower blade", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 1, consequence: "degrading", ownerClass: "either" },
    ] },
  { key: "AST-HEDGE-TRIMMER", name: "Hedge trimmer", icon: "hedgeTrimmer", category: "outdoor", expectedLifeYears: 7 },
  { key: "AST-PRESSURE-WASHER", name: "Pressure washer", icon: "pressureWasher", category: "outdoor", expectedLifeYears: 8 },
  { key: "AST-POOL-PUMP", name: "Pool pump", icon: "poolPump", category: "outdoor", serviceIntervalDays: 90, expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Clean pool pump filter", trigger: { type: "floating_since_last", intervalDays: 14 }, effort: 1, consequence: "degrading", ownerClass: "either" }] },
  { key: "AST-BBQ-GRILL", name: "BBQ grill", icon: "bbqGrill", category: "outdoor", expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Deep clean BBQ grill", trigger: { type: "floating_since_last", intervalDays: 60 }, effort: 2, consequence: "cosmetic", ownerClass: "either" }] },

  // Vehicles
  { key: "AST-CAR", name: "Car", icon: "car", category: "vehicle", serviceIntervalDays: 180, expectedLifeYears: 12,
    suggestedRoutines: [
      { title: "Service car", trigger: { type: "floating_since_last", intervalDays: 180 }, effort: 3, consequence: "degrading", ownerClass: "vendor" },
      { title: "Check tire pressure", trigger: { type: "floating_since_last", intervalDays: 30 }, effort: 1, consequence: "damaging", ownerClass: "member" },
    ] },
  { key: "AST-MOTORCYCLE", name: "Motorcycle / scooter", icon: "motorcycle", category: "vehicle", serviceIntervalDays: 90, expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Service motorcycle", trigger: { type: "floating_since_last", intervalDays: 90 }, effort: 2, consequence: "degrading", ownerClass: "vendor" }] },
  { key: "AST-BICYCLE", name: "Bicycle", icon: "bicycle", category: "vehicle", expectedLifeYears: 10,
    suggestedRoutines: [{ title: "Oil bicycle chain", trigger: { type: "floating_since_last", intervalDays: 60 }, effort: 1, consequence: "cosmetic", ownerClass: "either" }] },
];

const ITEMS = [
  // Bath & personal care
  { key: "ITM-TOOTHPASTE", name: "Toothpaste", icon: "bathSupply", category: "bath", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.012 },
  { key: "ITM-TOILET-CLEANER", name: "Toilet cleaner", icon: "bathSupply", category: "bath", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.03 },
  { key: "ITM-HANDWASH", name: "Handwash refill", icon: "bathSupply", category: "bath", unit: "ml", parLevel: 100, packSize: 500, defaultBurnRate: 8 },
  { key: "ITM-SHAMPOO", name: "Shampoo", icon: "bathSupply", category: "bath", unit: "ml", parLevel: 100, packSize: 400, defaultBurnRate: 6 },
  { key: "ITM-CONDITIONER", name: "Conditioner", icon: "bathSupply", category: "bath", unit: "ml", parLevel: 100, packSize: 400, defaultBurnRate: 5 },
  { key: "ITM-HAND-SANITIZER", name: "Hand sanitizer", icon: "bathSupply", category: "bath", unit: "ml", parLevel: 50, packSize: 250, defaultBurnRate: 5 },
  { key: "ITM-SHAVING-CREAM", name: "Shaving cream", icon: "bathSupply", category: "bath", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.02 },
  { key: "ITM-COTTON-SWABS", name: "Cotton swabs", icon: "bathSupply", category: "bath", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.02 },
  { key: "ITM-TOILET-PAPER", name: "Toilet paper", icon: "bathSupply", category: "bath", unit: "roll", parLevel: 2, packSize: 4, defaultBurnRate: 0.2 },
  { key: "ITM-NAPHTHALENE", name: "Naphthalene balls", icon: "bathSupply", category: "bath", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.01 },
  { key: "ITM-BODY-WASH", name: "Body wash", icon: "bathSupply", category: "bath", unit: "ml", parLevel: 100, packSize: 400, defaultBurnRate: 6 },

  // Laundry
  { key: "ITM-DETERGENT", name: "Detergent", icon: "laundrySupply", category: "laundry", unit: "kg", parLevel: 1, packSize: 1, defaultBurnRate: 0.1 },
  { key: "ITM-FABRIC-SOFTENER", name: "Fabric softener", icon: "laundrySupply", category: "laundry", unit: "ml", parLevel: 200, packSize: 1000, defaultBurnRate: 20 },
  { key: "ITM-STAIN-REMOVER", name: "Stain remover", icon: "laundrySupply", category: "laundry", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.02 },
  { key: "ITM-DRYER-SHEETS", name: "Dryer sheets", icon: "laundrySupply", category: "laundry", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.03 },

  // Cleaning
  { key: "ITM-ALL-PURPOSE-CLEANER", name: "All-purpose cleaner", icon: "cleaningSupply", category: "cleaning", unit: "ml", parLevel: 150, packSize: 500, defaultBurnRate: 10 },
  { key: "ITM-GLASS-CLEANER", name: "Glass cleaner", icon: "cleaningSupply", category: "cleaning", unit: "ml", parLevel: 100, packSize: 500, defaultBurnRate: 8 },
  { key: "ITM-FLOOR-CLEANER", name: "Floor cleaner", icon: "cleaningSupply", category: "cleaning", unit: "ml", parLevel: 150, packSize: 1000, defaultBurnRate: 15 },
  { key: "ITM-DISINFECTANT-WIPES", name: "Disinfectant wipes", icon: "cleaningSupply", category: "cleaning", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.03 },
  { key: "ITM-SPONGES", name: "Sponges", icon: "cleaningSupply", category: "cleaning", unit: "piece", parLevel: 2, packSize: 4, defaultBurnRate: 0.1 },
  { key: "ITM-DISHWASHING-LIQUID", name: "Dishwashing liquid", icon: "cleaningSupply", category: "cleaning", unit: "ml", parLevel: 150, packSize: 500, defaultBurnRate: 10 },
  { key: "ITM-DISHWASHER-TABLETS", name: "Dishwasher tablets", icon: "cleaningSupply", category: "cleaning", unit: "piece", parLevel: 5, packSize: 20, defaultBurnRate: 1 },

  // Paper & disposables
  { key: "ITM-PAPER-TOWELS", name: "Paper towels", icon: "paperGoods", category: "paper", unit: "roll", parLevel: 2, packSize: 6, defaultBurnRate: 0.15 },
  { key: "ITM-TISSUES", name: "Tissues", icon: "paperGoods", category: "paper", unit: "box", parLevel: 1, packSize: 1, defaultBurnRate: 0.05 },
  { key: "ITM-TRASH-BAGS", name: "Trash bags", icon: "paperGoods", category: "paper", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.05 },
  { key: "ITM-ALUMINIUM-FOIL", name: "Aluminium foil", icon: "paperGoods", category: "paper", unit: "roll", parLevel: 1, packSize: 1, defaultBurnRate: 0.02 },

  // Pest control
  { key: "ITM-MOSQUITO-REPELLENT", name: "Mosquito repellent refill", icon: "pestControl", category: "pest", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.05 },
  { key: "ITM-COCKROACH-GEL", name: "Cockroach gel", icon: "pestControl", category: "pest", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.01 },
  { key: "ITM-RAT-TRAPS", name: "Rat traps", icon: "pestControl", category: "pest", unit: "piece", parLevel: 1, packSize: 2, defaultBurnRate: 0.01 },

  // Utility consumables
  { key: "ITM-LPG-CYLINDER", name: "LPG cylinder", icon: "utilityConsumable", category: "utility", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.033 },
  { key: "ITM-DRINKING-WATER-CAN", name: "Drinking water can", icon: "utilityConsumable", category: "utility", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.15 },
  { key: "ITM-RO-FILTER-CARTRIDGE", name: "RO filter cartridge", icon: "filterCartridge", category: "utility", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.003 },

  // Batteries & electrical
  { key: "ITM-BATTERIES-AA", name: "AA / AAA batteries", icon: "batterySupply", category: "electrical", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.02 },
  { key: "ITM-LIGHT-BULBS", name: "Light bulbs", icon: "batterySupply", category: "electrical", unit: "piece", parLevel: 2, packSize: 2, defaultBurnRate: 0.02 },
  { key: "ITM-FUSES", name: "Fuses", icon: "batterySupply", category: "electrical", unit: "piece", parLevel: 2, packSize: 5, defaultBurnRate: 0.01 },

  // Fragrance
  { key: "ITM-ROOM-FRESHENER", name: "Room freshener", icon: "fragrance", category: "fragrance", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.03 },
  { key: "ITM-INCENSE-STICKS", name: "Incense sticks", icon: "fragrance", category: "fragrance", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.04 },
  { key: "ITM-CANDLES", name: "Candles", icon: "fragrance", category: "fragrance", unit: "piece", parLevel: 1, packSize: 2, defaultBurnRate: 0.02 },

  // Safety
  { key: "ITM-FIRST-AID-KIT", name: "First aid kit refill", icon: "safetySupply", category: "safety", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.005 },
  { key: "ITM-FACE-MASKS", name: "Face masks", icon: "safetySupply", category: "safety", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.02 },

  // Garden
  { key: "ITM-PLANT-FERTILIZER", name: "Plant fertilizer", icon: "gardenSupply", category: "garden", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.01 },
  { key: "ITM-PESTICIDE-SPRAY", name: "Pesticide spray", icon: "gardenSupply", category: "garden", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.01 },
  { key: "ITM-POTTING-SOIL", name: "Potting soil", icon: "gardenSupply", category: "garden", unit: "kg", parLevel: 2, packSize: 5, defaultBurnRate: 0.05 },

  // Pet
  { key: "ITM-PET-FOOD", name: "Pet food", icon: "petSupply", category: "pet", unit: "kg", parLevel: 1, packSize: 3, defaultBurnRate: 0.1 },
  { key: "ITM-PET-LITTER", name: "Pet litter", icon: "petSupply", category: "pet", unit: "kg", parLevel: 1, packSize: 5, defaultBurnRate: 0.15 },

  // Vehicle
  { key: "ITM-ENGINE-OIL", name: "Engine oil", icon: "vehicleSupply", category: "vehicle", unit: "litre", parLevel: 1, packSize: 4, defaultBurnRate: 0.01 },
  { key: "ITM-WIPER-FLUID", name: "Wiper fluid", icon: "vehicleSupply", category: "vehicle", unit: "litre", parLevel: 1, packSize: 2, defaultBurnRate: 0.02 },

  // Filters (non-water)
  { key: "ITM-AC-FILTER", name: "AC filter", icon: "filterCartridge", category: "filters", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.003 },
  { key: "ITM-VACUUM-BAGS", name: "Vacuum bags", icon: "filterCartridge", category: "filters", unit: "piece", parLevel: 1, packSize: 3, defaultBurnRate: 0.01 },

  // Admin / stationery
  { key: "ITM-PRINTER-PAPER", name: "Printer paper", icon: "adminSupply", category: "admin", unit: "pack", parLevel: 1, packSize: 1, defaultBurnRate: 0.005 },
  { key: "ITM-INK-CARTRIDGE", name: "Ink cartridge", icon: "adminSupply", category: "admin", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.003 },

  // Electronics accessories
  { key: "ITM-POWER-STRIP", name: "Power strip", icon: "electronicsAccessory", category: "electronics_accessory", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.002 },
  { key: "ITM-CHARGING-CABLE", name: "Charging cable", icon: "electronicsAccessory", category: "electronics_accessory", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.005 },
  { key: "ITM-HDMI-CABLE", name: "HDMI cable", icon: "electronicsAccessory", category: "electronics_accessory", unit: "piece", parLevel: 1, packSize: 1, defaultBurnRate: 0.002 },
];

// Session-only custom entries — anything typed that doesn't match the base
// catalog gets registered here so typing the *same* name again resolves to
// the same key instead of minting a new one each time ("not to recreate
// the same"). A real backend would persist this per-household in Firestore
// (Phase 4); for now it lives for the life of the tab.
const custom = { asset: [], item: [] };
let customSeq = 0;

function baseFor(type) {
  return type === "asset" ? ASSETS : ITEMS;
}

function allEntries(type) {
  return [...baseFor(type), ...custom[type]];
}

function findMatches(query, type, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return allEntries(type)
    .filter((e) => e.name.toLowerCase().includes(q))
    .slice(0, limit);
}

function findExact(name, type) {
  const q = name.trim().toLowerCase();
  return allEntries(type).find((e) => e.name.toLowerCase() === q) || null;
}

function findByKey(key, type) {
  return allEntries(type).find((e) => e.key === key) || null;
}

// Resolves a typed name to a catalog entry: exact match reuses its key;
// no match registers a new custom entry (with its own generated key) so
// future lookups of the same name find it instead of duplicating it.
function getOrCreate(name, type) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = findExact(trimmed, type);
  if (existing) return existing;

  customSeq += 1;
  const entry = {
    key: `${type === "asset" ? "AST" : "ITM"}-CUSTOM-${customSeq}`,
    name: trimmed,
    icon: type === "asset" ? "warranty" : "stock",
    category: "custom",
    custom: true,
  };
  custom[type].push(entry);
  return entry;
}

export { findMatches, findExact, findByKey, getOrCreate, allEntries };
