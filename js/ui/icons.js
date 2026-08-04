// Kasa icon set — same technique as Miso's line-icon set (24x24 viewBox,
// 1.8 stroke, round caps/joins, currentColor, no fill except tiny accent
// dots): ~/.claude/skills/miso-design/components/icon/Icon.jsx. Reusable
// generic glyphs are ported verbatim (marked below); everything else is
// drawn new for Kasa's house domain. No build step, no JSX — this exports
// a function returning an SVG string for template-literal rendering.
//
// Filled in incrementally as screens need them (memo build-plan Phase 0
// note) — this is the Today-screen subset, not the full §9.4 table yet.

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  // ---- tab bar ------------------------------------------------------
  today: `<circle cx="12" cy="12" r="9"/><polyline points="8,12.5 10.5,15 16,9"/>`,
  house: `<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/>`,
  stock: `<rect x="4" y="4" width="16" height="16" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/>`,
  insights: `<line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="7"/><line x1="18" y1="20" x2="18" y2="16"/>`,
  wishlist: `<path d="M12 3.5l2.6 5.5 6 .9-4.3 4.3 1 6-5.3-2.9-5.3 2.9 1-6-4.3-4.3 6-.9z" stroke-linejoin="round"/>`,
  flame: `<path d="M12 2.5c1.2 3-2.5 4.2-2.5 8a2.5 2.5 0 1 0 5 0c1 1.2 1.5 2.8 1.5 4.2a4.5 4.5 0 1 1-9 0C7 10 12 8 12 2.5z" stroke-linejoin="round"/>`,
  task: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3V2.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V3"/><polyline points="8.5,12.5 10.5,14.5 15.5,9.5"/>`,
  more: `<circle cx="5" cy="12" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="19" cy="12" r="1.1" fill="currentColor"/>`,

  // ---- spaces ---------------------------------------------------------
  bath: `<path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-3z"/><path d="M6 12V6a2 2 0 0 1 3.2-1.6"/><line x1="8" y1="19" x2="8" y2="21"/><line x1="16" y1="19" x2="16" y2="21"/>`,
  bedroom: `<path d="M3 19v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 19v2M21 19v2"/><path d="M5 13v-2a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  living: `<path d="M4 12v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/><path d="M4 12a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2"/><path d="M6 18v2M18 18v2"/>`,
  utility: `<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="13" r="4.5"/><line x1="8" y1="6.5" x2="9.6" y2="6.5"/>`,
  balcony: `<path d="M4 9h16v11" fill="none"/><line x1="4" y1="9" x2="4" y2="20"/><line x1="8" y1="9" x2="8" y2="20"/><line x1="12" y1="9" x2="12" y2="20"/><line x1="16" y1="9" x2="16" y2="20"/><line x1="20" y1="9" x2="20" y2="20"/><line x1="2" y1="9" x2="22" y2="9"/>`,
  entry: `<rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="14.5" cy="12" r="0.9" fill="currentColor"/>`,
  wholeHome: `<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><line x1="9" y1="20" x2="9" y2="14" /><line x1="15" y1="20" x2="15" y2="14"/><line x1="9" y1="14" x2="15" y2="14"/>`,
  study: `<rect x="3" y="15" width="18" height="2" rx="1"/><rect x="7" y="6" width="10" height="8" rx="1"/><line x1="12" y1="14" x2="12" y2="15"/><line x1="5" y1="17" x2="5" y2="20"/><line x1="19" y1="17" x2="19" y2="20"/>`,
  storage: `<rect x="4" y="11" width="7" height="7" rx="1"/><rect x="13" y="11" width="7" height="7" rx="1"/><rect x="8.5" y="4" width="7" height="7" rx="1"/>`,
  outside: `<path d="M12 21v-6"/><path d="M12 15c-4.5 0-7-3-7-6.5C8 8.5 10 10 12 12c2-2 4-3.5 7-3.5C19 12 16.5 15 12 15z"/>`,
  pooja: `<path d="M12 3c1.3 1.6 2 2.8 2 4a2 2 0 1 1-4 0c0-1.2.7-2.4 2-4z"/><path d="M5 21v-9a7 7 0 0 1 14 0v9"/><line x1="3" y1="21" x2="21" y2="21"/>`,
  entertainment: `<rect x="3" y="5" width="18" height="14" rx="2"/><polygon points="10,9 16,12 10,15" fill="currentColor" stroke="none"/>`,
  dining: `<ellipse cx="12" cy="13" rx="7" ry="5"/><line x1="6" y1="4" x2="6" y2="10"/><line x1="18" y1="4" x2="18" y2="10"/>`,
  garage: `<path d="M3 10 12 4l9 6"/><rect x="4" y="10" width="16" height="10"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="4" y1="17" x2="20" y2="17"/>`,
  terrace: `<line x1="3" y1="20" x2="21" y2="20"/><line x1="5" y1="20" x2="5" y2="14"/><line x1="9" y1="20" x2="9" y2="14"/><line x1="13" y1="20" x2="13" y2="14"/><line x1="17" y1="20" x2="17" y2="14"/><line x1="3" y1="14" x2="19" y2="14"/><circle cx="18" cy="6" r="2.5"/>`,

  // ---- occurrence row actions ------------------------------------------
  check: `<polyline points="5,13 10,18 19,7"/>`,
  snooze: `<circle cx="12" cy="13" r="8"/><polyline points="12,9 12,13 15,15"/><line x1="9" y1="2" x2="15" y2="2"/>`,

  // ---- misc ---------------------------------------------------------------
  plus: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
  minus: `<line x1="5" y1="12" x2="19" y2="12"/>`,
  chevronRight: `<polyline points="9,5 16,12 9,19"/>`,
  chevronDown: `<polyline points="5,9 12,16 19,9"/>`,
  chevronLeft: `<polyline points="15,5 8,12 15,19"/>`,
  close: `<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`,
  edit: `<path d="M4 20h4l11-11a2.4 2.4 0 0 0-4-4L4 16v4z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/>`,
  trash: `<path d="M5 7h14"/><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/><path d="M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13"/>`,
  call: `<path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2 2C10.5 19 5 13.5 5 6a2 2 0 0 1 1-3z"/>`,
  warranty: `<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><polyline points="9,12 11,14 15,10"/>`,
  gauge: `<path d="M4 15a8 8 0 1 1 16 0"/><line x1="12" y1="15" x2="15.5" y2="10.5"/><circle cx="12" cy="15" r="1"/>`,
  calendar: `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
  person: `<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>`,
  helper: `<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a5 5 0 0 1 5-5h1"/><path d="M14 13.5A5 5 0 0 1 19 18.5V21"/><path d="M15.5 8a2.5 2.5 0 1 0 0-5"/>`,

  // ---- asset catalog icons — one per catalog entry, not shared, per the
  // user's request (2026-08-03) so assets read as distinct at a glance and
  // can carry their own identity into later automation. Drawn to the same
  // 24x24/1.8-stroke technique as the rest of the set. -----------------------
  waterHeaterTank: `<rect x="7" y="2" width="10" height="20" rx="4"/><path d="M9.5 18c1-1 1-2 0-3s-1-2 0-3" /><path d="M14.5 18c1-1 1-2 0-3s-1-2 0-3"/>`,
  waterHeaterTankless: `<rect x="6" y="3" width="12" height="18" rx="2"/><polyline points="13,7 10,13 14,13 11,19"/>`,
  solarWaterHeater: `<path d="M3 9l9-4 9 4"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="6" y1="9" x2="6" y2="7.5"/><line x1="12" y1="9" x2="12" y2="6.5"/><line x1="18" y1="9" x2="18" y2="7.5"/><rect x="7" y="13" width="10" height="7" rx="2"/>`,
  roUnit: `<path d="M12 3c3 4 5 6.5 5 9.5a5 5 0 0 1-10 0C7 9.5 9 7 12 3z"/><line x1="9.5" y1="13" x2="14.5" y2="13"/>`,
  waterSoftener: `<rect x="3" y="6" width="8" height="15" rx="3"/><rect x="13" y="3" width="8" height="18" rx="3"/><line x1="11" y1="12" x2="13" y2="12"/>`,
  waterTank: `<ellipse cx="12" cy="8" rx="7" ry="3"/><path d="M5 8v6c0 1.7 3.1 3 7 3s7-1.3 7-3V8"/><line x1="7" y1="17" x2="6" y2="21"/><line x1="17" y1="17" x2="18" y2="21"/><line x1="12" y1="17.5" x2="12" y2="21.5"/>`,
  sumpPump: `<path d="M4 4v13a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V4"/><line x1="2" y1="4" x2="22" y2="4"/><polyline points="9,13 12,9 15,13"/><line x1="12" y1="9" x2="12" y2="17"/>`,
  wellPump: `<circle cx="12" cy="7" r="4"/><line x1="12" y1="11" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="9" y1="7" x2="15" y2="7"/>`,
  septicTank: `<rect x="3" y="10" width="18" height="9" rx="2"/><line x1="2" y1="10" x2="22" y2="10" stroke-dasharray="1.5 2.5"/><line x1="12" y1="10" x2="12" y2="4"/><line x1="9" y1="6" x2="12" y2="4"/><line x1="15" y1="6" x2="12" y2="4"/>`,
  acSplit: `<rect x="3" y="6" width="18" height="6" rx="2"/><line x1="6" y1="9" x2="16" y2="9"/><path d="M9 15c1.5 1 1.5 3 3 4M13 15c1.5 1 1.5 3 3 4"/>`,
  acWindow: `<rect x="3" y="4" width="18" height="16" rx="1"/><rect x="6" y="8" width="12" height="8" rx="1"/><line x1="9" y1="8" x2="9" y2="16"/><line x1="15" y1="8" x2="15" y2="16"/>`,
  acCentral: `<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v10h12V10"/><path d="M9 22v-4a3 3 0 0 1 6 0v4"/>`,
  furnace: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 8c1.5 1.5 1.5 3 0 4.5C10.5 11 10.5 9.5 12 8z"/><line x1="8" y1="17" x2="16" y2="17"/>`,
  boiler: `<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 7c1 1 1 2 0 3s-1 2 0 3"/><circle cx="15" cy="9" r="1" fill="currentColor" stroke="none"/>`,
  heatPump: `<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M9 12h-3M9 12l1.5-1.5M9 12l1.5 1.5"/><path d="M15 12h3M15 12l-1.5-1.5M15 12l-1.5 1.5"/>`,
  spaceHeater: `<rect x="4" y="12" width="16" height="7" rx="1.5"/><path d="M7 12V8c0-1 .8-2 2-2h1M12 12V6M17 12V8c0-1-.8-2-2-2h-1"/>`,
  evapCooler: `<rect x="4" y="4" width="16" height="14" rx="2"/><path d="M8 21c0-1 .8-1 .8-2s-.8-1-.8-2M12 21c0-1 .8-1 .8-2s-.8-1-.8-2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/>`,
  ceilingFan: `<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><path d="M12 12C12 7 9 5 6 5.5c1 3 3 5 6 6.5z"/><path d="M12 12c4.5 1 7-1 7.5-4.5-3-1-6 0-7.5 4.5z"/><path d="M12 12c-2 4-1 7 2 8.5 1.5-3 1-6-2-8.5z"/>`,
  exhaustFan: `<circle cx="12" cy="12" r="8"/><path d="M12 12 8 8M12 12l5-1M12 12l-1 5.5"/><path d="M20 12h2"/>`,
  dehumidifier: `<rect x="5" y="3" width="14" height="17" rx="2"/><path d="M12 8a2.5 2.5 0 0 1 2 4 2.5 2.5 0 0 1-4 0 2.5 2.5 0 0 1 2-4z"/><line x1="8" y1="17" x2="16" y2="17"/>`,
  humidifier: `<path d="M9 22h6M12 22v-8"/><path d="M8 14a4 4 0 0 1 8 0c0 2-4 3-4 3s-4-1-4-3z"/><path d="M12 2c1.3 1.6 2 2.8 2 4a2 2 0 1 1-4 0c0-1.2.7-2.4 2-4z"/>`,
  airPurifier: `<rect x="7" y="3" width="10" height="18" rx="3"/><path d="M9.5 8c1.5-1 3.5-1 5 0M9.5 12c1.5-1 3.5-1 5 0M9.5 16c1.5-1 3.5-1 5 0"/>`,
  inverter: `<rect x="6" y="3" width="10" height="18" rx="2"/><polyline points="13,7 10,13 14,13 11,19"/><path d="M18 9v6M18 9l-2 2M18 9l2 2M18 15l-2-2M18 15l2-2"/>`,
  generator: `<rect x="3" y="8" width="14" height="10" rx="2"/><circle cx="8" cy="13" r="2"/><line x1="17" y1="11" x2="21" y2="11"/><line x1="17" y1="15" x2="21" y2="15"/><polyline points="12,10 11,13 13,13 12,16"/>`,
  solarPanel: `<path d="M3 8l3-5h12l3 5z"/><path d="M3 8h18v11H3z"/><line x1="9" y1="8" x2="9" y2="19"/><line x1="15" y1="8" x2="15" y2="19"/><line x1="3" y1="13.5" x2="21" y2="13.5"/>`,
  washingMachine: `<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="6" y1="6" x2="9" y2="6"/><circle cx="12" cy="14" r="5"/><path d="M9.5 12c1 1.5 3.5 1.5 5 0"/>`,
  dryer: `<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="6" y1="6" x2="9" y2="6"/><circle cx="12" cy="14" r="5"/><path d="M9 16c1-2.5 4-2.5 6-1"/>`,
  fridge: `<rect x="6" y="2" width="12" height="20" rx="2"/><line x1="6" y1="10" x2="18" y2="10"/><line x1="9" y1="5" x2="9" y2="7"/><line x1="9" y1="13" x2="9" y2="15"/>`,
  dishwasher: `<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="4" y1="8" x2="20" y2="8"/><circle cx="7" cy="5.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="9.5" cy="5.5" r="0.6" fill="currentColor" stroke="none"/><rect x="7" y="11" width="10" height="7" rx="1"/>`,
  vacuum: `<circle cx="7" cy="17" r="3"/><path d="M9.5 15.5 16 6"/><path d="M16 6h4v3h-3.5"/><path d="M5.5 14.5 4 12"/>`,
  robotVacuum: `<circle cx="12" cy="13" r="7"/><circle cx="12" cy="13" r="2"/><line x1="12" y1="6" x2="12" y2="8"/>`,
  garageDoorOpener: `<rect x="4" y="4" width="16" height="16" rx="1"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="13" x2="20" y2="13"/><line x1="4" y1="17" x2="20" y2="17"/>`,
  detector: `<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.3"/><line x1="12" y1="2" x2="12" y2="4.5"/>`,
  fireExtinguisher: `<rect x="9" y="6" width="7" height="15" rx="2"/><path d="M12.5 6V4a1 1 0 0 1 1-1H15"/><path d="M9 10H6l-1 2"/><line x1="12.5" y1="2" x2="12.5" y2="3.5"/>`,
  securityCamera: `<path d="M3 8l10-3 3 9-10 3z"/><circle cx="9.5" cy="9.5" r="2.3"/><path d="M16 9l5-2v7l-5-1.5"/>`,

  // ---- electronics & AV (added 2026-08-03, user request for broader
  // asset coverage) -----------------------------------------------------
  laptop: `<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20l-2-3H4z"/>`,
  desktopComputer: `<rect x="5" y="4" width="14" height="10" rx="1.5"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="12" y1="14" x2="12" y2="18"/>`,
  monitor: `<rect x="4" y="4" width="16" height="11" rx="1.5"/><line x1="9" y1="19" x2="15" y2="19"/><line x1="12" y1="15" x2="12" y2="19"/>`,
  printer: `<rect x="5" y="8" width="14" height="8" rx="1.5"/><path d="M7 8V4h10v4"/><rect x="8" y="14" width="8" height="6" rx="1"/>`,
  router: `<rect x="4" y="10" width="16" height="6" rx="2"/><line x1="8" y1="10" x2="7" y2="4"/><line x1="16" y1="10" x2="17" y2="4"/><circle cx="17" cy="13" r="0.8" fill="currentColor" stroke="none"/>`,
  television: `<rect x="3" y="4" width="18" height="12" rx="1.5"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/>`,
  setTopBox: `<rect x="4" y="9" width="16" height="6" rx="1.5"/><circle cx="17" cy="12" r="0.8" fill="currentColor" stroke="none"/><line x1="7" y1="9" x2="7" y2="7"/>`,
  amplifier: `<rect x="3" y="7" width="18" height="10" rx="1.5"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>`,
  musicSystem: `<rect x="3" y="6" width="18" height="12" rx="1.5"/><circle cx="7.5" cy="12" r="2.5"/><circle cx="16.5" cy="12" r="2.5"/><circle cx="7.5" cy="12" r="0.6" fill="currentColor" stroke="none"/><circle cx="16.5" cy="12" r="0.6" fill="currentColor" stroke="none"/>`,
  speakers: `<rect x="7" y="2" width="10" height="20" rx="3"/><circle cx="12" cy="8" r="2.5"/><circle cx="12" cy="16" r="2"/>`,
  homeTheater: `<rect x="2" y="16" width="20" height="4" rx="1"/><path d="M6 16c0-5 2.5-9 6-9s6 4 6 9"/>`,
  gamingConsole: `<rect x="3" y="9" width="18" height="7" rx="3"/><circle cx="7" cy="12.5" r="1"/><circle cx="17" cy="11" r="0.8"/><circle cx="17" cy="14" r="0.8"/>`,
  projector: `<rect x="3" y="8" width="14" height="8" rx="2"/><circle cx="17" cy="12" r="2.5"/><line x1="6" y1="8" x2="6" y2="6"/>`,

  // ---- furniture ------------------------------------------------------
  sofa: `<path d="M4 12V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><rect x="3" y="12" width="18" height="6" rx="1.5"/><line x1="4" y1="18" x2="4" y2="20"/><line x1="20" y1="18" x2="20" y2="20"/>`,
  bedFrame: `<rect x="3" y="10" width="18" height="9" rx="2"/><rect x="5" y="7" width="5" height="4" rx="1.5"/><line x1="3" y1="19" x2="3" y2="21"/><line x1="21" y1="19" x2="21" y2="21"/>`,
  mattress: `<rect x="3" y="8" width="18" height="9" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/>`,
  diningTable: `<rect x="3" y="8" width="18" height="2.5" rx="1"/><line x1="6" y1="10.5" x2="6" y2="19"/><line x1="18" y1="10.5" x2="18" y2="19"/>`,
  wardrobe: `<rect x="5" y="3" width="14" height="18" rx="1.5"/><line x1="12" y1="3" x2="12" y2="21"/><circle cx="10" cy="12" r="0.6" fill="currentColor" stroke="none"/><circle cx="14" cy="12" r="0.6" fill="currentColor" stroke="none"/>`,
  recliner: `<path d="M4 20v-6a2 2 0 0 1 2-2h5V9a2 2 0 0 1 2-2h5"/><path d="M11 12h7v6a2 2 0 0 1-2 2H6"/><line x1="4" y1="20" x2="20" y2="20"/>`,
  officeChair: `<rect x="7" y="9" width="10" height="2" rx="1"/><path d="M8 11l-1 5M16 11l1 5"/><line x1="12" y1="16" x2="12" y2="19"/><line x1="8" y1="21" x2="16" y2="21"/><path d="M8 9V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v4"/>`,
  bookshelf: `<rect x="4" y="3" width="16" height="18" rx="1"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>`,
  tvUnit: `<rect x="3" y="14" width="18" height="6" rx="1.5"/><line x1="8" y1="14" x2="8" y2="17"/><line x1="16" y1="14" x2="16" y2="17"/>`,
  curtains: `<line x1="4" y1="4" x2="20" y2="4"/><path d="M7 4c-1 6 1 10-1 16"/><path d="M17 4c1 6-1 10 1 16"/>`,

  // ---- kitchen-adjacent appliances (asset/service tracking only — pantry
  // stock for these stays in Miso) ---------------------------------------
  microwave: `<rect x="3" y="6" width="18" height="12" rx="1.5"/><rect x="5" y="8" width="10" height="8" rx="1"/><circle cx="18" cy="10" r="0.8" fill="currentColor" stroke="none"/><line x1="16.5" y1="13" x2="19.5" y2="13"/>`,
  chimney: `<path d="M6 21V11l6-6 6 6v10"/><line x1="9" y1="21" x2="9" y2="15"/><line x1="15" y1="21" x2="15" y2="15"/><path d="M9 15c1 1.5 5 1.5 6 0"/>`,
  inductionCooktop: `<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="3"/><circle cx="16" cy="9" r="1.6"/><circle cx="16" cy="15" r="1.6"/>`,
  gasStove: `<rect x="3" y="9" width="18" height="10" rx="1.5"/><circle cx="8" cy="14" r="2.3"/><circle cx="16" cy="14" r="2.3"/>`,
  waterDispenser: `<rect x="7" y="3" width="10" height="8" rx="1.5"/><path d="M7 11h10v9a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z"/><circle cx="10" cy="14" r="0.7" fill="currentColor" stroke="none"/><circle cx="14" cy="14" r="0.7" fill="currentColor" stroke="none"/>`,
  coffeeMaker: `<path d="M6 3h9v6a4.5 4.5 0 0 1-4.5 4.5h0A4.5 4.5 0 0 1 6 9z"/><path d="M9 13.5V17"/><path d="M11 13.5V17"/><rect x="6" y="17" width="9" height="4" rx="1"/>`,
  kettle: `<path d="M5 20h11a2 2 0 0 0 2-2v-4a5 5 0 0 0-5-5H8a3 3 0 0 0-3 3z"/><path d="M18 11l4-2"/><line x1="9" y1="4" x2="9" y2="7"/>`,
  toaster: `<rect x="4" y="8" width="16" height="10" rx="2"/><line x1="8" y1="4" x2="8" y2="8"/><line x1="12" y1="4" x2="12" y2="8"/><line x1="16" y1="4" x2="16" y2="8"/><path d="M9 8v4M15 8v4"/>`,
  mixerGrinder: `<path d="M8 3h8l-1 8H9z"/><rect x="6" y="11" width="12" height="9" rx="2"/><line x1="10" y1="15" x2="14" y2="15"/>`,

  // ---- personal electronics ----------------------------------------------
  mobilePhone: `<rect x="7" y="2" width="10" height="20" rx="2.5"/><line x1="10" y1="19" x2="14" y2="19"/>`,
  tablet: `<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="10.5" y1="19" x2="13.5" y2="19"/>`,
  smartwatch: `<rect x="8" y="7" width="8" height="10" rx="2"/><path d="M9 7V4h6v3M9 17v3h6v-3"/>`,

  // ---- outdoor & garden equipment -----------------------------------------
  lawnMower: `<circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="18" r="2.5"/><path d="M7 18h6l4-9h3"/><path d="M13 9V6h-3"/>`,
  hedgeTrimmer: `<rect x="2" y="10" width="10" height="4" rx="1"/><line x1="12" y1="12" x2="20" y2="12"/><path d="M14 9l2 3-2 3M17 9l2 3-2 3"/>`,
  pressureWasher: `<rect x="4" y="12" width="8" height="6" rx="1.5"/><line x1="12" y1="14" x2="20" y2="10"/><path d="M18 8l3-1"/>`,
  poolPump: `<circle cx="12" cy="13" r="6"/><path d="M12 7V4M8 5l1.5 2M16 5l-1.5 2"/>`,
  bbqGrill: `<ellipse cx="12" cy="10" rx="8" ry="3"/><path d="M6 10v3a6 3 0 0 0 12 0v-3"/><line x1="8" y1="16" x2="6" y2="21"/><line x1="16" y1="16" x2="18" y2="21"/>`,

  // ---- vehicles -------------------------------------------------------
  car: `<path d="M5 16 6 10a2 2 0 0 1 2-1.5h8A2 2 0 0 1 20 10l1 6"/><path d="M7 10h10"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7.5" cy="20" r="1.2"/><circle cx="16.5" cy="20" r="1.2"/><line x1="9" y1="10" x2="9" y2="6.5"/><line x1="15" y1="10" x2="15" y2="6.5"/><line x1="9" y1="6.5" x2="15" y2="6.5"/>`,
  motorcycle: `<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17h5l3-7h4"/><path d="M10.5 10h3"/><path d="M14 17l2-4"/>`,
  bicycle: `<circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-9h4l4 9"/><path d="M10 8h3"/><path d="M14 17H9l4-6"/>`,

  // ---- item-catalog category icons — one per household-consumable
  // category (memo's own icon table groups by category too, e.g. "Water",
  // "Power & gas" — this follows the same pattern at the item-catalog
  // level rather than one icon per individual SKU). ---------------------------
  bathSupply: `<path d="M8 2v4a2 2 0 0 0 2 2h1V2"/><path d="M9 8v13a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V8"/><path d="M16 22c3-1 3-4 0-6-1 1.5-1 3 0 6z"/>`,
  laundrySupply: `<path d="M12 3c2.5 3 4 5 4 7.5a4 4 0 0 1-8 0C8 8 9.5 6 12 3z"/><path d="M5 21c1-2 2-2 3 0s2 2 3 0 2-2 3 0 2 2 3 0"/>`,
  cleaningSupply: `<rect x="9" y="8" width="6" height="13" rx="1.5"/><path d="M11 8V5a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3"/><path d="M15 4h3v3h-3"/>`,
  paperGoods: `<rect x="4" y="4" width="10" height="16" rx="5"/><line x1="16" y1="8" x2="21" y2="8"/><line x1="16" y1="12" x2="21" y2="12"/><line x1="16" y1="16" x2="19" y2="16"/>`,
  pestControl: `<ellipse cx="12" cy="13" rx="4" ry="6"/><line x1="12" y1="7" x2="12" y2="19"/><line x1="8" y1="10" x2="4" y2="8"/><line x1="8" y1="16" x2="4" y2="18"/><line x1="16" y1="10" x2="20" y2="8"/><line x1="16" y1="16" x2="20" y2="18"/><circle cx="12" cy="5.5" r="1.3"/>`,
  utilityConsumable: `<path d="M9 2h6l1 4H8z"/><path d="M8 6h8v14a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/><line x1="8" y1="12" x2="16" y2="12"/>`,
  batterySupply: `<rect x="3" y="8" width="16" height="9" rx="2"/><line x1="21" y1="11" x2="21" y2="14"/><line x1="7" y1="8" x2="7" y2="6"/><line x1="12" y1="8" x2="12" y2="6"/>`,
  fragrance: `<path d="M12 3c1.3 1.6 2 2.8 2 4a2 2 0 1 1-4 0c0-1.2.7-2.4 2-4z"/><path d="M8 21h8M9 21v-8a3 3 0 0 1 6 0v8"/>`,
  safetySupply: `<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="9.5" y1="11.5" x2="14.5" y2="11.5"/>`,
  gardenSupply: `<path d="M12 21V11"/><path d="M12 11c0-5-4-8-8-7 0 5 3 8 8 7z"/><path d="M12 14c0-4 3.5-6.5 7-6 0 4-2.5 6.5-7 6z"/>`,
  petSupply: `<ellipse cx="12" cy="16" rx="4.5" ry="3.5"/><circle cx="6.5" cy="10" r="1.6"/><circle cx="10.5" cy="6.5" r="1.6"/><circle cx="13.5" cy="6.5" r="1.6"/><circle cx="17.5" cy="10" r="1.6"/>`,
  vehicleSupply: `<path d="M4 16l1.5-5A2 2 0 0 1 7.4 9.5h9.2a2 2 0 0 1 1.9 1.5L20 16"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7.5" cy="20" r="1.2"/><circle cx="16.5" cy="20" r="1.2"/>`,
  filterCartridge: `<path d="M4 4h16l-6 8v7l-4 2v-9z"/>`,
  adminSupply: `<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="13" y2="15"/>`,
  electronicsAccessory: `<rect x="3" y="14" width="18" height="4" rx="1"/><line x1="6" y1="14" x2="6" y2="10"/><line x1="10" y1="14" x2="10" y2="10"/><line x1="14" y1="14" x2="14" y2="10"/><line x1="18" y1="14" x2="18" y2="10"/>`,

  // ---- unmatched-catalog fallbacks (2026-08-03) — getOrCreate() in
  // catalog.js hands these to any typed-in asset/item name that doesn't
  // match an existing entry, so a custom entry reads as "not yet a real
  // icon" rather than borrowing warranty's/stock's shape (those are real
  // icons used elsewhere and looked misleading on a custom entry). Dashed
  // outline is the "unidentified" cue; asset gets a box, item gets a tag.
  customAsset: `<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.5"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>`,
  customItem: `<path d="M13 4h4a2 2 0 0 1 2 2v4a2 2 0 0 1-.6 1.4l-8 8a2 2 0 0 1-2.8 0l-4-4a2 2 0 0 1 0-2.8l8-8A2 2 0 0 1 13 4z" stroke-dasharray="3 2.5"/><circle cx="16.5" cy="7.5" r="0.9" fill="currentColor" stroke="none"/>`,

  // ---- reusable generic glyphs, ported verbatim from Miso ------------------
  sparkle: `<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.5 2.5M16 16l2.5 2.5M18.5 5.5L16 8M8 16l-2.5 2.5"/>`,
  refresh: `<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>`,
  camera: `<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>`,
  receipt: `<path d="M4 2h16v20l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5Z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>`,
};

function Icon(name, { size = 20, style = "" } = {}) {
  const body = PATHS[name];
  if (!body) return "";
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;flex-shrink:0;${style}"><svg viewBox="0 0 24 24" width="${size}" height="${size}" ${STROKE}>${body}</svg></span>`;
}

export { Icon };
