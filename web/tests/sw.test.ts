import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const swPath = path.resolve(currentDir, "../public/sw.js");
const mainPath = path.resolve(currentDir, "../src/main.ts");

test("Service Worker: sw.js contains upgrade, network-first navigation, and cache pruning logic", () => {
  const content = fs.readFileSync(swPath, "utf-8");

  // Cache version defined
  assert.match(content, /const CACHE = ["']sfs2487-v2["'];/, "Defines sfs2487-v2 cache");

  // Immediate takeover on install
  assert.match(content, /self\.addEventListener\(["']install["'].*self\.skipWaiting\(\)/s, "Calls self.skipWaiting() on install");

  // Old cache cleanup & clients.claim on activate
  assert.match(content, /self\.addEventListener\(["']activate["'].*caches\.delete.*self\.clients\.claim\(\)/s, "Cleans old caches and claims clients on activate");

  // SKIP_WAITING message listener
  assert.match(content, /self\.addEventListener\(["']message["'].*SKIP_WAITING.*self\.skipWaiting\(\)/s, "Supports SKIP_WAITING postMessage");

  // Navigation requests: Network-First
  assert.match(content, /req\.mode === ["']navigate["']/, "Checks for navigate mode");
  assert.match(content, /networkRes && networkRes\.ok/, "Fetches from network first for navigations");

  // Immutable hashed assets: Cache-First
  assert.match(content, /url\.pathname\.includes\(["']\/assets\/["']\)/, "Routes /assets/* to cache-first");
});

test("Service Worker: main.ts initiates update on load, visibilitychange, and auto-reloads on controllerchange", () => {
  const content = fs.readFileSync(mainPath, "utf-8");

  // Register with update call
  assert.match(content, /reg\.update\(\)/, "Explicitly checks for service worker updates on load");

  // Visibility change check
  assert.match(content, /visibilitychange.*reg\.update\(\)/s, "Checks for SW updates on tab focus/visibility");

  // Auto-reload on controllerchange
  assert.match(content, /controllerchange.*window\.location\.reload\(\)/s, "Auto-reloads window on controllerchange");

  // Handles waiting and updatefound worker
  assert.match(content, /reg\.waiting.*SKIP_WAITING/s, "Activates already-waiting workers");
  assert.match(content, /updatefound.*installed.*SKIP_WAITING/s, "Activates newly installed workers");
});
