// Kasa service worker — offline app shell (build-plan Phase 7).
//
// Scope: this repo's buildless vanilla-JS PWA only. Firebase/Firestore
// (build-plan Phase 4) isn't wired up yet, so there's no real read/write
// sync queue to manage here — the memo's §8.5 "full read/write offline"
// bar is a Phase-4-and-later target. What *is* achievable now, and what
// this file does: cache the static shell (HTML/CSS/JS/packs) so the app's
// router, engine, and mock-data boot and render with no network at all,
// satisfying "the app must be fully usable in airplane mode after first
// load" for everything the app currently does (mock-data mode, in-memory
// state — nothing here depends on a live connection anyway).
//
// No Workbox, no build step — plain Cache Storage API, matching the
// project's whole "no framework, no build tooling" constraint.

const VERSION = "v2";
const SHELL_CACHE = `kasa-shell-${VERSION}`;
const RUNTIME_CACHE = `kasa-runtime-${VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE]);

// The app shell: every file the router/engine/mock-data need to boot and
// render with zero network. Kept as an explicit list (not a glob — there's
// no build step to generate one) so it's easy to eyeball against the repo.
// Cross-checked against a live `Glob` of the repo before shipping this file
// — see the task report for the verification note.
const PRECACHE_URLS = [
  // shell
  "./",
  "./index.html",
  "./tokens.css",
  "./app.css",
  "./manifest.json",
  "./icons/icon.svg",

  // js — top level
  "./js/boot.js",
  "./js/state.js",
  "./js/engine.js",
  "./js/intel.js",
  "./js/catalog.js",
  "./js/packs.js",
  "./js/roomTemplates.js",

  // js/ui
  "./js/ui/components.js",
  "./js/ui/icons.js",
  "./js/ui/habitGrid.js",

  // js/routes
  "./js/routes/today.js",
  "./js/routes/house.js",
  "./js/routes/stock.js",
  "./js/routes/insights.js",
  "./js/routes/wishlist.js",
  "./js/routes/people.js",
  "./js/routes/assets.js",
  "./js/routes/routine.js",
  "./js/routes/onboard.js",

  // mock-data (stands in for db.js reads until Phase 4)
  "./mock-data/index.js",
  "./mock-data/household.js",
  "./mock-data/spaces.js",
  "./mock-data/items.js",
  "./mock-data/assets.js",
  "./mock-data/routines.js",
  "./mock-data/ledger.js",
  "./mock-data/people.js",
  "./mock-data/modes.js",
  "./mock-data/wishlist.js",
  "./mock-data/habits.js",
  "./mock-data/habitLog.js",
  "./mock-data/tasks.js",
  "./mock-data/snoozeLog.js",

  // content packs
  "./packs/core.json",
  "./packs/bath.json",
  "./packs/laundry.json",
  "./packs/help.json",
  "./packs/appliances.json",
  "./packs/utility.json",
  "./packs/bedroom.json",
  "./packs/living.json",
  "./packs/plants.json",
  "./packs/admin.json",
  "./packs/entry.json",
  "./packs/vehicle.json",
  "./packs/study.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Deliberately NOT cache.addAll(PRECACHE_URLS) — addAll fails the
      // *entire* install the moment any single URL 404s or errors, which
      // would mean one stale path in this list (a file renamed/removed by
      // ongoing route/state work elsewhere in the repo) bricks offline
      // support for everything, not just that one file. Cache each file
      // independently instead: a miss is logged and skipped, and the
      // fetch handler below still cache-on-the-fly's it the first time
      // it's actually requested online.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-cache" });
            if (res && res.ok) {
              await cache.put(url, res);
            } else {
              console.warn("[kasa sw] precache skipped (bad response):", url);
            }
          } catch (err) {
            console.warn("[kasa sw] precache skipped (fetch failed):", url, err);
          }
        }),
      );
      // Activate this version immediately rather than waiting for all
      // tabs of the old SW to close — this is a PWA polish pass, not a
      // data-migration-sensitive update, so there's nothing to protect by
      // waiting.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("kasa-") && !CURRENT_CACHES.has(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only same-origin GETs — this app has no cross-origin dependencies
  // (no CDN fonts/scripts, importmap is empty per index.html's own
  // comment), so anything else just falls through to the network
  // untouched.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations (opening the app / a hard refresh): try the network first
  // so a change to index.html shows up promptly when online, but fall
  // back to the cached shell doc when offline — this is what makes
  // "airplane mode after first load" actually work for the entry point.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch (err) {
          const cache = await caches.open(SHELL_CACHE);
          const cached = (await cache.match("./index.html")) || (await cache.match("./"));
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // Everything else same-origin (JS modules, CSS, packs, icons): network
  // first, falling back to cache only when actually offline.
  //
  // This was cache-first in the original pass, which turned out to be a
  // real bug, not just a style choice (2026-08-05, caught mid-verification
  // when a batch of brand-new Today/Insights code silently kept running
  // the pre-edit version after a hard refresh): this whole project is
  // still pre-Firebase and under heavy active iteration — every session so
  // far has been edit-a-file-then-hard-refresh-to-verify. A cache-first SW
  // serves the FIRST-ever-cached copy of every module forever after,
  // regardless of how many times the underlying file changes or how hard
  // the page is refreshed (Ctrl+Shift+R bypasses the HTTP cache but not a
  // Service Worker's own Cache Storage) — silently masking every edit
  // behind the one it happened to precache first. Network-first keeps
  // "airplane mode after first load" working via the catch fallback below,
  // while never standing between an online browser and the real current
  // file — the right tradeoff for a single-household app with no CDN and
  // no cache-lifetime pressure to justify serving stale content when a
  // live network is right there.
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw err;
      }
    })(),
  );
});
