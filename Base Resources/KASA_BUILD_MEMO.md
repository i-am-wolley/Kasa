# Kasa — Build Memo

**Household operating system. Sibling app to Miso (kitchen).**
Target: mobile-first PWA, tablet-adaptive, desktop-usable. Firebase backend. Google + Apple sign-in.
Audience for this document: Claude CLI, to produce a build plan and execute it.

---

## 0. One-paragraph thesis

Kasa is not a chore app and not a to-do list. It is a **model of a house** that knows what depletes, what recurs, and what ages — and warns you before anything fails. Its promise to the user is *"nothing in this house breaks without warning."* Everything in this spec serves that sentence. If a feature does not help the house tell you something before it becomes a problem, it does not belong.

Miso runs the kitchen. Kasa runs everything else. They are separate apps sharing an auth identity and a household ID.

### Non-goals (enforce these — scope creep kills this app)

- No generic to-do items. Every entry has a type and a trigger.
- No calendar replacement, no notes, no personal habit tracking, no fitness.
- No device control, no ordering, no OAuth to third parties, no stored credentials.
- No social features, no sharing outside the household.
- Kasa **tracks and suggests only.** Where action is required it routes: `tel:` links, share sheets, deep-link searches, clipboard.

---

## 1. Architecture

### 1.1 Shape

Buildless, like Miso, but not one file. One HTML shell plus native ES modules over CDN. No bundler, no npm install, no compile step — edit and refresh. This keeps Miso's development ergonomics while staying navigable at Kasa's scale.

```
/index.html            shell: <head>, root div, importmap, boot script
/tokens.css            *** shared with Miso — single source of truth, never forked ***
/app.css               all styles, consumes tokens.css only
/js/
  boot.js              init firebase, auth gate, router mount
  auth.js              Google + Apple + email link
  db.js                Firestore read/write, offline cache, sync queue
  state.js             in-memory store, subscribe/notify, no framework
  engine.js            *** trigger engine — the core of the product ***
  intel.js             adaptive intervals, burn rate, snooze learning
  insights.js          derived metrics and cards
  packs.js             content pack loader, seeding, versioning
  ai.js                Gemini Flash calls, credit metering
  notify.js            local scheduling + FCM
  routes/
    today.js  spaces.js  stock.js  assets.js  people.js
    insights.js  item.js  routine.js  settings.js  onboard.js
  ui/
    components.js      sheet, list-row, chip, stepper, empty-state, toast
    icons.js
/packs/                seeded JSON, also served remotely from Firestore
  core.json  bath.json  laundry.json  bedroom.json  living.json
  utility.json  plants.json  appliances.json  admin.json
  vehicle.json  help.json  entry.json  study.json
/sw.js                 service worker, offline shell + data cache
/manifest.json
```

**Rules for the CLI:** no framework, no JSX, no TypeScript, no build tooling. Vanilla ES modules, `<template>` elements or template literals for rendering, CSS custom properties for theming. Any file exceeding ~800 lines gets split.

### 1.2 Platform

- PWA installable on iOS/Android. Capacitor wrapper later if native notifications or widgets are needed — write nothing that blocks it.
- Breakpoints: `<600px` single column with bottom tab bar · `600–1024px` two-pane (list + detail) · `>1024px` three-pane with persistent sidebar.
- Tablet is a first-class target, not a stretched phone. Two-pane on tablet is where household review actually happens.
- Touch targets ≥44px. Everything reachable one-thumbed in the lower two-thirds on phone.

### 1.3 Firebase

- **Auth:** Google, Apple, email magic link. Apple sign-in is mandatory for App Store if Google is offered — implement both from day one. Handle Apple's private relay email and the fact that Apple returns the display name *only on first authorization* — capture and persist it immediately or it is lost forever.
- **Firestore:** primary store, offline persistence enabled.
- **Cloud Functions:** AI proxy only (never call Gemini from the client — the key must not ship), credit ledger, pack distribution, scheduled digest jobs.
- **FCM:** push for the daily digest and safety-tier alerts.
- **Storage:** photos from onboarding sweeps and asset receipts.
- **App Check:** enable, or the AI proxy becomes a free Gemini endpoint for anyone who reads your JS.

### 1.4 Firestore layout

```
households/{hid}
  profile, members[], modes, settings, packVersions{}
  /spaces/{spaceId}
  /items/{itemId}          Stock
  /assets/{assetId}
  /routines/{routineId}    Cycle definitions
  /occurrences/{occId}     instances (the hot collection)
  /people/{personId}       members + household help
  /ledger/{entryId}        completion log
  /events/{eventId}        append-only audit for learning
users/{uid}
  households[], activeHousehold, prefs, pushTokens[]
packs/{packId}             remote content, versioned
```

**Indexes required:** `occurrences` on `(state, dueAt)`, `(assigneeId, state, dueAt)`, `(spaceId, state)`. `items` on `(status, projectedOutAt)`. Write these into `firestore.indexes.json` up front — discovering them in production is painful.

**Security rules:** all household subcollections gated on `request.auth.uid in resource.data.memberUids` via a denormalized `memberUids` array on the household doc, mirrored onto hot subcollection docs to avoid a `get()` on every read.

---

## 2. Data model

### 2.1 Core entities

```js
space = {
  id, name, type,        // bath|bedroom|living|utility|balcony|study|entry|storage|whole_home|outside
  icon, order, active
}

item = {                  // STOCK — things that deplete
  id, name, spaceId, category,
  unit,                  // ml|g|piece|pack|roll|litre
  qty, packSize,
  parLevel,              // reorder threshold
  burnRate,              // units/day, learned (see §5.2)
  projectedOutAt,        // computed
  expiryDate,            // nullable — meds, sealed goods
  status,                // ok|low|out|expiring
  vendorHint,            // free text or tel: number
  autoAddToList,         // bool
  source                 // pack|sweep|manual
}

asset = {                 // things that age and need service
  id, name, spaceId, category,
  brand, model, serial,
  purchaseDate, purchasePrice,
  warrantyUntil, amcUntil,
  meter: { type, value, unit, updatedAt },  // runtime_hours|cycles|litres|km
  serviceIntervalDays, serviceIntervalMeter,
  lastServicedAt, nextServiceDue,
  consumableItemIds[],   // its filters, bags, cartridges
  vendorName, vendorPhone,
  docs[],                // storage refs: invoice, warranty card
  expectedLifeYears, replacementDueAt
}

routine = {               // CYCLE — things that recur
  id, title, spaceId, assetId?,
  trigger: {
    type,                // fixed_calendar|floating_since_last|usage_meter|condition|seasonal|on_mode
    // per type:
    rrule?,              // fixed_calendar
    intervalDays?,       // floating
    meterDelta?,         // usage
    condition?,          // { source, op, value }
    months?, window?,    // seasonal e.g. [5,6] pre-monsoon
    mode?                // on_mode
  },
  effort,                // 1=2min 2=15min 3=hour 4=half_day 5=call_vendor
  consequence,           // cosmetic|degrading|damaging|safety
  ownerClass,            // member|help|vendor|either
  defaultAssigneeId,
  requiresItemIds[],     // stock needed to actually do it
  modeFilters: { pauseIn[], boostIn[] },
  steps[],               // optional checklist
  notes, active, source, packId, userEdited
}

occurrence = {
  id, routineId, dueAt, windowDays,
  state,                 // pending|due|overdue|done|skipped|snoozed
  assigneeId, doneBy, doneAt,
  snoozeCount, snoozedUntil,
  effortActual,          // optional user feedback
  generatedAt
}

person = {
  id, name, kind,        // member|help
  role,                  // cook|maid|driver|nanny|gardener
  schedule: { days[], time },
  leave[],               // {from,to,reason}
  payDay, payAmount, advances[],
  handoverRoutineIds[],  // what falls to members when absent
  avatarColor
}

mode = {
  key, label, active, since, until,
  pauseRoutineIds[], boostRoutineIds[], addRoutineIds[],
  auto                   // set automatically by a rule
}
```

### 2.2 Why this shape

Three primitives cover every domain in a house. Adding a new domain is **content, not code** — a new pack JSON, no schema migration, no app release. The CLI should verify this by adding a domain late in the build without touching `engine.js`.

---

## 3. Onboarding

The single highest-risk surface. A whole-home inventory is an unwinnable cold start if asked for directly. Four principles:

1. **Value before data entry.** The user sees a populated house before typing anything meaningful.
2. **Never a blank screen.** Every empty state has a seed action.
3. **One room at a time, always skippable.** No progress bar implying an obligation to finish.
4. **Everything proposed is rejectable in one tap.** Kasa suggests; the user decides.

### 3.1 Flow

**Step 1 — Sign in.** Google / Apple / email link. Nothing else on the screen.

**Step 2 — Six questions (~40 seconds).** Tappable chips only, no keyboard.

| Q | Options |
|---|---|
| Home type | Apartment · Independent house · Villa · Studio |
| Size | 1BHK · 2BHK · 3BHK · 4BHK+ |
| Who lives here | Just me · Couple · With kids · With parents · Shared |
| Household help | None · Maid · Cook · Both · Maid+cook+driver |
| Do you have | Plants · Pets · Vehicle · Balcony/garden *(multi-select)* |
| City | autocomplete, defaults from locale |

**Step 3 — Generate.** From the archetype, seed spaces, ~45–70 routines, ~25 stock items, ~8 asset placeholders. Show a brief generation animation, then land the user on a **populated Today screen**. This is the moment the product either lands or doesn't — the user must think *"it already knows my house."*

City matters more than it looks: it drives hard-water descale intervals, monsoon window months, pest-control cadence, and AC-service season.

**Step 4 — Confirm, don't create.** A single reviewable list grouped by room. Each row has a checkmark and an X. Bulk "remove this whole room." No forced field entry. This inverts the work from *authoring* to *editing*, which is roughly 10× cheaper cognitively.

**Step 5 — Optional deepening,** offered as dismissible cards on Today, never as a blocking flow:

- **Photo sweep** — "Add your bathroom in 30 seconds." User shoots 3–5 photos, Gemini Flash vision returns proposed items and assets, user accepts/rejects. Batch all photos into one call.
- **Bill scan** — one appliance invoice → asset with purchase date, warranty expiry, model, and its full service schedule and consumables auto-attached. Highest value-per-tap in the entire app.
- **Add your help** — roster and leave days. Unlocks the hero feature (§6.3).

### 3.2 Empty and near-empty states

Every list, when empty, shows: one sentence of what belongs here, one primary seed action, one secondary manual-add. Never an illustration with "Nothing here yet."

---

## 4. Extensibility — every home is different

This is the requirement most likely to be under-built. Homes vary enormously; a rigid app is abandoned in week two. Enforce a hard rule: **anything Kasa can create, the user can edit, rename, move, duplicate, disable, or delete.**

### 4.1 Guarantees

| Object | User can |
|---|---|
| Space | Add, rename, re-icon, reorder, merge, delete (with contents reassign prompt) |
| Item | Add, edit unit/par/pack, move space, delete |
| Asset | Add, edit any field, detach consumables, delete |
| Routine | Add, retitle, change trigger type entirely, change interval, effort, consequence, owner, steps, disable, delete |
| Pack | Install, uninstall, per-item cherry-pick at install |
| Mode | Create custom modes with own pause/boost sets |
| Person | Add, edit schedule, mark leave, delete |

### 4.2 Custom routine builder

Full trigger expressiveness in a plain-language sheet, not a form dump:

> **[Clean the balcony drain]** — repeat **[every 3 months]** — needs **[15 min]** — if skipped **[causes damage]** — usually done by **[Kasa+me]** — pause during **[Travel]**

Each bracket is a tap-to-change chip. Interval picker offers *every N days/weeks/months/years* · *on the Nth of the month* · *N days after last done* · *every N units of use* · *seasonally in months X–Y* · *only when mode Z is on*.

### 4.3 Pack governance

- Packs carry `packId` + `version`. User edits set `userEdited: true`.
- Pack updates **never overwrite** user-edited objects. New objects from a pack update arrive in a "3 new suggestions" card, dismissible in bulk.
- Uninstalling a pack removes only untouched objects and asks about the rest.

### 4.4 Deletion

Soft-delete with 30-day recovery in Settings → Recently removed. Deleting a space asks whether to delete contents or move them. Deleting a routine with history keeps the ledger entries — insights must not develop holes.

---

## 5. Intelligent logic

### 5.1 The trigger engine (`engine.js`)

The heart of Kasa. Deterministic, no LLM, runs client-side on app open and on a 6-hour background tick.

```
generateOccurrences(now, horizon = now + 60d):
  for each active routine:
    if paused by active mode: skip
    nextDue = computeNext(routine, lastCompletion, meters, conditions, season)
    if nextDue <= horizon and no open occurrence exists:
      create occurrence(pending)

computeNext by trigger type:
  fixed_calendar      → next RRULE instance after lastDone
  floating_since_last → lastDoneAt + adaptedInterval   (see 5.3)
  usage_meter         → when meter.value >= lastServiceMeter + meterDelta
                         estimate date from observed meter velocity
  condition           → evaluate against latest known state; if true and
                         cooldown elapsed, due now
  seasonal            → first day of window, adjusted by city monsoon/summer map
  on_mode             → generated at mode activation, expires at deactivation

stateOf(occurrence, now):
  now <  dueAt - windowDays  → pending
  within window              → due
  now >  dueAt               → overdue (severity scales with consequence tier)
```

**Never generate more than 60 days ahead.** Beyond that the list becomes noise and Firestore reads become expensive.

### 5.2 Burn-rate learning (stock)

```
On each qty decrement:
  observed = Δqty / Δdays
  burnRate = 0.7 * burnRate + 0.3 * observed     // EWMA, resists one-off restocks
  projectedOutAt = now + (qty - parLevel) / burnRate
  if projectedOutAt < now + leadTimeDays: status = low
```

`leadTimeDays` defaults to 3, or 7 for vendor-delivered goods (gas, tanker water). Ignore observations where Δdays < 1 or where qty increased (restock). Require ≥3 observations before trusting the learned rate; use the pack default until then.

### 5.3 Adaptive intervals (cycles)

The interval the user actually lives by is more useful than the interval the pack proposed.

```
On completion of a floating routine:
  actualGap = doneAt - previousDoneAt
  if |actualGap - interval| / interval > 0.25 for 3 consecutive completions:
      propose new interval = median(last 5 gaps)
      → non-blocking card: "You clean the fans about every 60 days,
         not 45. Update?"  [Update] [Keep 45]
```

Propose, never silently change. Silent adjustment destroys trust in a system whose entire value is predictability.

### 5.4 Snooze learning

Snooze is the richest signal in the app.

- Same routine snoozed 3× in a row → offer to lengthen the interval or lower its priority.
- Routine consistently snoozed on weekdays, done on weekends → learn a **day-of-week preference** and schedule it there from then on.
- Routine snoozed >5× and never completed → offer to disable it. Bad suggestions must be able to die.

### 5.5 Load balancing

```
effortPoints = effort × consequenceWeight
rolling 30-day split per member
if |split - 50%| > 20% for 2 consecutive weeks → surface once, gently
```

Round-robin assignment for `ownerClass: either`, weighted by current load and observed completion rate. **The app absorbs blame and never redistributes it:** the load view is pull-only, never pushed as a notification, and phrased about *the house*, not about a person. "The house has been leaning on Vinod this month" — not "Keerthana has done less."

### 5.6 Batching

Before rendering Today, cluster occurrences by:

- **Same space** — "You're already in the bathroom: 3 things, 10 minutes total."
- **Same vendor** — "Calling the electrician? Two other things need him."
- **Same trip** — all `low` items across every room become one shopping list, grouped by likely store.
- **Same effort tier** — "10 free minutes?" surfaces only effort-1 items.

Batching is the difference between a list of 14 chores and three coherent errands.

### 5.7 Load smoothing

If any week exceeds a household effort ceiling (default 20 points), shift flexible occurrences (`consequence: cosmetic|degrading`, `trigger: floating`) ±7 days to flatten the curve. Never move `damaging` or `safety` items. Never move fixed-calendar items. Show what moved.

### 5.8 Seasonal intelligence

City → season map. For Bengaluru: pre-monsoon window May–Jun, monsoon Jun–Oct, dry Dec–Feb, pre-summer service window Feb–Mar. Seasonal routines fire at window start, not on a fixed date. Ahead of monsoon, boost: balcony/terrace drains, damp and seepage checks, waterproofing inspection, mosquito screens, drying-rack plan, umbrella and raincoat check.

### 5.9 Correlation and forecasting

- **Failure prediction:** asset past `expectedLifeYears × 0.8`, with rising service frequency → "Your geyser is 7 years old and has needed two repairs this year. Budget for replacement."
- **Consumable coupling:** RO membrane replaced → sediment and carbon filters due sooner than the calendar says; adjust.
- **Neglect clustering:** if a whole space's completion rate drops below 40%, don't nag — ask whether those routines still apply. Often the honest answer is "we stopped using that room."

### 5.10 AI placement — hard boundary

**LLM at authoring time. Deterministic at runtime.**

| Uses AI | Never uses AI |
|---|---|
| Photo sweep → object extraction | Deciding what's due today |
| Bill/receipt → asset creation | Computing burn rate |
| Natural-language routine creation | Scheduling or notifications |
| Weekly narrative summary (1 call/week) | Any hot path or repeated loop |
| "What's a sane interval for X?" | Anything that must be reproducible |

Predictable credit burn, reproducible behaviour, and the app works fully offline once seeded.

---

## 6. Insights

Insights must be **specific, actionable, and rare**. One good insight per week beats twelve dashboard tiles. All computed in `insights.js` from the ledger; none require AI except the optional weekly narrative.

### 6.1 House health score (0–100)

Weighted, and transparent — tapping it always shows the arithmetic.

```
40%  overdue-weighted-by-consequence  (safety overdue hurts 8× cosmetic)
25%  stock readiness (% items above par)
20%  asset service compliance
15%  routine completion rate, 30-day rolling
```

Show trend, not just value. A rising 62 is better news than a falling 78.

### 6.2 Card library

**Risk**
- "3 things are overdue that can cause damage." *(damaging/safety only)*
- "Your gas regulator is 6 years old. Replacement is due at 5."
- "No smoke alarm registered. Add one?"
- "Water tank was last cleaned 9 months ago — 6 is the recommendation."

**Money**
- "You spent ₹X on AC repairs in 12 months. A ₹Y AMC would have covered it."
- "Warranty on the washing machine expires in 34 days. Two service visits are still free."
- "You're replacing all three RO filters together. The sediment filter needs it 3× as often — buying separately saves ~₹Z/year."
- Annual running cost per asset, from logged service and consumable spend.

**Rhythm**
- "Sundays carry 60% of your household load. Three of these could move to Wednesday."
- "You do the deep clean every 21 days, not the 14 you set. Want to make that official?"
- "Nine routines haven't been completed once in 60 days. Prune them?"

**Load**
- 30-day effort split, pull-only, framed about the house.
- "Help was on leave 4 days this month. Those days added 6 hours to the two of you."

**Seasonal**
- "Monsoon starts in ~3 weeks. Six things are worth doing first." → one-tap generate.
- "Pre-summer AC servicing window opens next month. Book before the rush."

**Weekly digest** (Sunday morning, one push, one AI call): what got done, what's coming, the single thing most worth doing this week.

### 6.3 The hero feature — Help on leave

One tap. Kasa lists everything that silently stops happening, splits it between household members by current load, and adjusts the week's other routines to absorb the extra hours. Reverts on return. This demos in five seconds, is nearly unique to the Indian market, and is the strongest single reason to install the app.

---

## 7. Automation

Automation in Kasa means *removing decisions*, not controlling devices.

| Automation | Mechanism |
|---|---|
| Occurrence generation | Engine tick on open + every 6h background |
| Auto-add to shopping list | Item hits `low` → appended, deduped |
| Auto-assign | Round-robin by load and completion rate |
| Auto-snooze during modes | Travel pauses everything indoor-recurring |
| Auto-reassign | Help leave → handover list redistributes |
| Auto-escalate | Damaging/safety overdue >7d → priority + push |
| Auto-defer | Weekly load ceiling exceeded → smooth flexible items |
| Auto-service-schedule | Asset created → service routine + consumables generated |
| Auto-interval-tuning | Proposed after 3 consistent deviations |
| Seasonal batch | Window opens → prep bundle offered |
| Warranty watch | 30 days before expiry → prompt |
| Meter estimation | Runtime extrapolated from observed usage pattern |

### Routing, not acting

- Shopping list → share sheet / clipboard / WhatsApp
- Gas cylinder → `tel:` saved distributor
- AC service → `tel:` saved vendor, or deep-link search
- Repeat purchase → deep link into quick-commerce search query
- Society dues → open saved portal URL

---

## 8. App structure

### 8.1 Navigation

Bottom tabs (phone) / sidebar (tablet+): **Today · House · Stock · Insights · More**

### 8.2 Screens

**Today** — default. Active mode chip. House Line (§9). Overdue first (only damaging/safety visually loud), then due today, then batched suggestions. Swipe right = done, left = snooze. Long-press = reassign. Bottom: "10 free minutes?" effort-1 filter.

**House** — spaces grid → space detail with its routines, stock, and assets. Where users browse and prune.

**Stock** — unified across every room. Sections: Out · Low · Expiring · OK. Quantity steppers. Primary action: build shopping list. Secondary: barcode/photo add.

**Assets** — cards sorted by next service. Warranty countdown ring. Detail: specs, service history, linked consumables, documents, vendor call button, running-cost total.

**People** — members and help. Roster, leave calendar, load split, dues and advances. "Mark leave" is the entry point to the hero feature.

**Insights** — health score, trend, card feed, weekly digest archive.

**Routine detail** — plain-language editor (§4.2), history, steps, linked items.

**More** — modes, packs, notifications, household members, export, recently removed, credits.

### 8.3 Interaction rules

- Completion is always one gesture from Today. If marking something done takes more than one action, the app fails.
- Undo toast on every destructive or completing action, 5 seconds.
- Optimistic writes; queue and reconcile offline.
- No modal blocks anything except destructive confirmation.
- Adding anything is reachable in ≤2 taps from any screen.

### 8.4 Notifications

Ruthless restraint — over-notifying is how this category dies.

| Trigger | Channel | Cap |
|---|---|---|
| Daily digest, if anything is due | 1 push, user-set time | 1/day |
| Safety/damaging overdue >3d | 1 push | 1/week per routine |
| Weekly summary | 1 push, Sunday | 1/week |
| Everything else | in-app only | — |

Cosmetic and degrading items **never** push. Quiet hours respected. Global "one notification a day, maximum" setting, on by default.

### 8.5 Offline

Full read/write offline via Firestore persistence. Engine is client-side, so due dates compute without network. Queue AI calls until online. Service worker caches shell and packs. The app must be fully usable in airplane mode after first load.

---

## 9. Design system — inherited from Miso

Kasa is a sibling of Miso, not a new brand. It uses the **Nature Distilled** system already running in Miso: warm cream ground, gold accent, earthy secondaries, editorial serif display against a humanist body face. A user moving between the two apps should feel they're in the same house.

The CLI must not invent tokens. Pull the real values from `Pantry-OS-App` and re-emit them as a shared `tokens.css` consumed by both apps. The values below are the current known state and serve as the fallback if extraction is incomplete.

### 9.1 Inherited tokens

```css
:root {
  /* ground */
  --bg:            #F6F1EB;   /* warm cream */
  --surface:       #FFFFFF;
  --surface-sunk:  #EFE8DF;
  --line:          #E8E0D5;

  /* ink */
  --ink:           #1A1512;
  --ink-muted:     #6E6259;
  --ink-faint:     #9A8E82;

  /* accent */
  --gold:          #B8865A;   /* primary accent */
  --gold-soft:     rgba(184,134,90,0.12);
  --gold-glow:     rgba(184,134,90,0.30);

  /* earth secondaries */
  --terracotta:    #B5563C;
  --sand:          #D9C7AE;
}

[data-theme="dark"] {
  --bg:            #0F0D0A;
  --surface:       #17130F;
  --surface-sunk:  #0A0908;
  --line:          #2A2219;
  --ink:           #F2EAE0;
  --ink-muted:     #A2958A;
  --ink-faint:     #6E6259;
  --gold:          #C8A96E;
  --gold-soft:     rgba(200,169,110,0.14);
  --gold-glow:     rgba(200,169,110,0.32);
  --terracotta:    #C4664A;
  --sand:          #8A7A64;
}
```

**Type** — `Playfair Display SC` for display and section headings, used at three sizes only. `Karla` for body and all UI. Serif italic is Miso's signature for named things — in Miso it's dish names; in Kasa it carries **routine titles and asset names**, which is the direct equivalent and keeps the family resemblance. Tabular numerals (`.font-num`) everywhere quantities, days, intervals, and counts appear.

Body `line-height: 1.65`. Headings `1.22` with `letter-spacing: -0.01em`.

**Radius** — 22px sheets and modals, 16px cards, 14px pills and inputs, 10px chips.

**Motion** — `--dur-micro 120ms`, `--dur-fast 180ms`, `--dur-base 260ms`; spring `cubic-bezier(0.34, 1.56, 0.64, 1)` for sheets and toasts. `prefers-reduced-motion` kills all of it.

**Interaction** — 44px minimum touch targets, `button:active { transform: scale(0.96) }`, `touch-action: manipulation`, `:focus-visible` gold ring at 2.5px / 0.7 opacity, modal backdrop `blur(6px)`, `.miso-skeleton` shimmer for loading. Spacing on an 8dp grid.

### 9.2 New tokens Kasa needs

Kasa has one requirement Miso doesn't: **consequence tier must be legible by colour**. Rather than importing generic status red/amber/green — which would break the warm palette immediately — derive all four tiers from the existing earth family. They read as a single considered range, not a traffic light.

```css
:root {
  --tier-cosmetic:   transparent;   /* no colour at all */
  --tier-degrading:  #B8865A;       /* the existing gold */
  --tier-damaging:   #B5563C;       /* the existing terracotta */
  --tier-safety:     #7A3428;       /* deep ember — used ~3 times ever */

  --done:            #6E7A56;       /* muted olive, sits in the earth family */
  --done-soft:       rgba(110,122,86,0.12);
}
```

Two hard rules:

1. **Cosmetic tier gets no colour.** If everything is coloured, nothing is urgent. Roughly 60% of a household's routines are cosmetic, so most of Today should be plain ink on cream.
2. **Gold keeps its Miso meaning.** In Miso gold means *the good thing, the accent, the affirmative*. In Kasa it also carries the degrading tier, which is compatible — gold is attention, not alarm. Terracotta and ember are the only escalation.

### 9.3 Signature element — the House Line

Miso's signature is the weekly plan card assembling in place. Kasa's equivalent is the **House Line**: a single horizontal band at the top of Today showing 30 daily ticks. Tick height = effort load that day. Tick colour = heaviest consequence tier due. Cream where the house is clear.

Rendered in the Miso register — hairline `--line` baseline, ticks in the tier colours, no gridlines, no axis labels, one italic serif caption beneath reading the month. Tap a tick to jump to that day. It is the only ornamental-looking element in the app and it is made entirely of information.

Everything else stays quiet: generous whitespace, hairline dividers, one accent per screen, no gradients, no shadow deeper than `0 2px 8px rgba(26,21,18,0.06)` outside modals.

### 9.4 Icon language

Miso's icon set doesn't cover a house. Kasa needs new icons drawn to the same rules so they sit alongside the existing set without a seam.

**Construction rules**
- 24×24 grid, 20px live area, 2px padding
- 1.75px stroke, `round` caps and joins, `currentColor`, no fills except state badges
- Slightly softened geometry — corners at 2px radius, no perfectly mechanical forms. Nature Distilled is organic; a hard-edged icon set will look borrowed
- One visual idea per icon. If it needs two objects to read, it's the wrong metaphor
- Optical weight matched to Karla at 15px, not to Playfair
- Never use colour to carry meaning inside an icon — colour lives in the tier system only

**Icons to draw** (none of these exist in Lucide, Feather, or Phosphor in a usable form):

| Group | Icons |
|---|---|
| Spaces | bathroom, bedroom, living room, utility/laundry, balcony, study, entry, storage, whole home |
| Water | water tanker, sump, overhead tank, RO unit, RO membrane, motor/pump, tap descale |
| Power & gas | gas cylinder, gas regulator, inverter, battery top-up, meter reading, fuse/spare bulb |
| Appliances | geyser, chimney, AC unit, AC filter, washing machine drum, dishwasher, exhaust fan |
| Structure | drain, seepage/damp patch, mosquito screen, grout/sealant, door hinge, doormat |
| Home life | household help, leave day, handover, society/apartment block, maintenance dues |
| Primitives | stock, cycle, asset, effort tiers 1–5, consequence tiers ×4, mode chip |
| Modes | guests arriving, travel, help on leave, festival prep, monsoon, sick |

Deliver as a single `icons.js` exporting inline SVG path strings, one export per icon, so they inherit `currentColor` and cost no network requests.

### 9.5 Copy

Miso's rule holds: **show, don't tell.** In an app the equivalent is stating facts, not narrating them.

Plain verbs, active voice, sentence case, no exclamation marks, never cute. "Overdue by 4 days," not "Oops, this slipped!" Errors say what happened and what to do next. Empty states are invitations with a button attached, not apologies. An action keeps its name through the whole flow — the button that says "Mark done" produces a toast that says "Marked done."

### 9.6 Quality floor

Responsive to 360px. Visible keyboard focus. `prefers-reduced-motion` respected. WCAG AA contrast in both themes — check `--ink-muted` on `--bg` specifically, it is the most likely failure. Dark mode from day one; this app gets opened at night.

## 10. Content packs

`packs/*.json`, seeded locally and updatable from Firestore without an app release.

```json
{
  "packId": "bath", "version": 3, "label": "Bathrooms",
  "appliesWhen": { "spaces": ["bath"] },
  "spaces": [{ "type": "bath", "name": "Bathroom" }],
  "items": [
    { "name": "Toothpaste", "unit": "piece", "parLevel": 1,
      "packSize": 1, "defaultBurnRate": 0.012 }
  ],
  "assets": [
    { "name": "Geyser", "category": "water_heater",
      "serviceIntervalDays": 365, "expectedLifeYears": 8,
      "consumables": ["Anode rod"] }
  ],
  "routines": [
    { "title": "Descale showerhead and taps",
      "trigger": { "type": "floating_since_last", "intervalDays": 60 },
      "effort": 2, "consequence": "degrading", "ownerClass": "either",
      "regionalOverrides": { "hard_water_city": { "intervalDays": 30 } } }
  ]
}
```

Packs to author, in order of value: **core, bath, laundry, help, appliances, utility (water/power/gas), bedroom, living, plants, admin, entry, vehicle, study.**

Content quality is the moat. A global chore app cannot model water tankers, gas cylinder cycles, society maintenance dues, inverter battery top-ups, monsoon seepage checks, pre-summer AC booking rushes, or a cook's leave day. Write these intervals from real Indian household practice, not from generic web sources.

---

## 11. Credits and AI budget

Reuse Miso's credit ledger; one shared balance across both apps.

| Operation | Cost | Frequency |
|---|---|---|
| Archetype seed | 0 (deterministic) | once |
| Photo sweep, per room | ~4 | ≤8 lifetime |
| Bill scan | ~2 | occasional |
| NL routine creation | ~1 | rare |
| Weekly narrative | ~2 | 52/year |
| Interval suggestion | ~1 | rare |

Realistic steady state: **~120 credits/year/household.** Onboarding is the only burst. Free tier of 5,000 is not remotely at risk — which means AI can be generous where it creates the "it already knows my house" moment, and absent everywhere else.

---

## 12. Build order for the CLI

0. Extract Miso's tokens from `Pantry-OS-App/index.html` into a shared `tokens.css`. Draw the icon set (§9.4). Nothing visual gets built before this exists.
1. Shell, auth (Google + Apple + email link), Firestore schema, security rules, indexes.
2. `engine.js` with all six trigger types + unit tests. **Nothing else until this is correct.**
3. Today screen, complete/snooze gestures, ledger writes.
4. Archetype onboarding + core/bath/laundry packs. First end-to-end usable build.
5. House, Stock, custom routine builder, full CRUD everywhere (§4.1 guarantees).
6. Assets, service scheduling, warranty tracking, bill scan.
7. People, help roster, leave, **Help-on-leave hero feature**.
8. Modes, load smoothing, batching.
9. Intelligence: burn rate, adaptive intervals, snooze learning.
10. Insights and weekly digest.
11. Remaining packs (content only — verify no engine changes are needed).
12. Notifications, offline hardening, performance pass.

### Acceptance tests

- A new user reaches a populated Today screen in under 90 seconds without typing a word.
- Marking anything done takes exactly one gesture.
- Every pack-created object can be deleted; no orphans, no crashes.
- Adding pack #13 requires zero changes to `engine.js`.
- Airplane mode: full read/write, correct due dates, sync on reconnect.
- A household with 200 routines renders Today in under 400ms on a mid-range Android device.
- Notification count for a typical week: ≤8.
- No hardcoded hex value appears anywhere outside `tokens.css`.
- Kasa and Miso screenshotted side by side read as the same product family.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Onboarding abandonment | Archetype seeding; value before any data entry |
| Week-three abandonment | Batching + effort tiers; only 4 tiers ever notify |
| Becoming a nagging surface | Cosmetic/degrading never push; load view is pull-only |
| Content feels wrong for a given home | Everything editable; adaptive intervals; prune prompts |
| Overlap with Miso | Hard boundary: kitchen consumables stay in Miso. Kasa reads Miso's low-stock list into the shared shopping list only |
| Single-file sprawl | 800-line file ceiling; engine isolated and tested |
| Design drift from Miso | Shared `tokens.css`, no local hex values, side-by-side screenshot check each milestone |
| Firestore read cost | 60-day horizon cap; occurrences paginated; aggressive local cache |
