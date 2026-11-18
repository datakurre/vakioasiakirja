// Service worker for the SFS 2487:2024 editor PWA.
//
// The app is a fully static, self-contained bundle (a ~28 MB Typst compiler
// WASM, fonts, JS/CSS — all immutable, content-hashed by Vite).
//
// Upgrade & caching strategy:
// - Navigation requests (index.html, page refresh) use Network-First with cache fallback.
//   This ensures a standard page refresh always fetches the latest deployment when online.
// - Content-hashed assets (/assets/*) use Cache-First because hashed filenames are immutable.
// - Other same-origin static assets use Stale-While-Revalidate with background revalidation.
// - Automatic activation via skipWaiting() and clients.claim(), plus SKIP_WAITING message listener.

const CACHE = "sfs2487-v2";

self.addEventListener("install", () => {
  // Take over immediately when a new service worker is installed
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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  // 1. Navigation requests (page refresh, document load): Network-First
  // Guarantees that any usual page refresh retrieves the latest index.html if online.
  const isNavigation =
    req.mode === "navigate" ||
    req.destination === "document" ||
    url.pathname.endsWith(".html") ||
    url.pathname === self.location.pathname.replace(/\/sw\.js$/, "/");

  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const networkRes = await fetch(req);
          if (networkRes && networkRes.ok) {
            const cache = await caches.open(CACHE);
            cache.put(req, networkRes.clone());
            return networkRes;
          }
        } catch {
          // Network failed (offline) -> fall through to cache
        }
        const cache = await caches.open(CACHE);
        const cached =
          (await cache.match(req)) ||
          (await cache.match("index.html")) ||
          (await cache.match("./"));
        if (cached) return cached;
        throw new Error("Offline and no cached shell");
      })(),
    );
    return;
  }

  // 2. Content-hashed static assets (/assets/*): Cache-First
  // Vite embeds cryptographic content hashes in filenames, so they are immutable.
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // 3. Other same-origin GET requests (fonts, icons, manifest): Stale-While-Revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(fetchPromise);
        return cached;
      }
      const res = await fetchPromise;
      if (res) return res;
      throw new Error("Resource unavailable offline");
    })(),
  );
});
