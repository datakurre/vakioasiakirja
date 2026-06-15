// Service worker for the SFS 2487:2024 editor PWA.
//
// The app is a fully static, self-contained bundle (a ~28 MB Typst compiler
// WASM, fonts, JS/CSS — all immutable, content-hashed by Vite). A cache-first
// strategy therefore makes relaunches instant and the installed app work
// offline, which is what "installed to the home screen" should feel like.
//
// Same-origin GET requests are served from the cache when present and refreshed
// in the background (stale-while-revalidate); a cache miss falls through to the
// network and is stored. Navigations fall back to the cached shell when offline.
// Scope is the SW's own directory, so it works at any base path (GitHub Pages'
// project subpath as well as the dev root).

const CACHE = "sfs2487-v1";

self.addEventListener("install", () => {
  // Take over as soon as the new worker is ready; we have no precache step.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions so a deploy cannot serve stale assets.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) {
        // Refresh in the background so a later visit picks up any change.
        event.waitUntil(
          fetch(req)
            .then((res) => res.ok && cache.put(req, res.clone()))
            .catch(() => {}),
        );
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        // Offline and uncached: serve the app shell for navigations.
        if (req.mode === "navigate") {
          const shell = (await cache.match("index.html")) || (await cache.match("./"));
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
