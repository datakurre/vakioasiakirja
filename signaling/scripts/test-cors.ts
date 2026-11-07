import test from "node:test";
import assert from "node:assert/strict";

import { getAllowedOrigins, isAllowedOrigin, corsHeaders } from "../src/cors.ts";

test("CORS: fallback to default allowed origins when ALLOWED_ORIGINS is unset", () => {
  const allowed = getAllowedOrigins(undefined);
  assert.ok(allowed.has("https://datakurre.github.io"));
  assert.ok(allowed.has("http://localhost:5173"));
  assert.equal(isAllowedOrigin("https://datakurre.github.io", undefined), true);
  assert.equal(isAllowedOrigin("https://evil.example.com", undefined), false);
});

test("CORS: strict ALLOWED_ORIGINS exclusively allows association domain and excludes defaults", () => {
  const config = "https://asiakirjat.yhdistys.fi, https://collab.yhdistys.fi";

  const allowed = getAllowedOrigins(config);
  assert.equal(allowed.size, 2);
  assert.ok(allowed.has("https://asiakirjat.yhdistys.fi"));
  assert.ok(allowed.has("https://collab.yhdistys.fi"));

  // Crucial security requirement: datakurre.github.io MUST NOT be permitted when association sets its own domain
  assert.equal(allowed.has("https://datakurre.github.io"), false);
  assert.equal(isAllowedOrigin("https://datakurre.github.io", config), false);
  assert.equal(isAllowedOrigin("https://asiakirjat.yhdistys.fi", config), true);
  assert.equal(isAllowedOrigin("https://asiakirjat.yhdistys.fi/", config), true); // trailing slash handled
  assert.equal(isAllowedOrigin("https://unauthorized.org", config), false);
});

test("CORS: corsHeaders returns correct headers with origin matching", () => {
  const origin = "https://asiakirjat.yhdistys.fi";
  const headers = corsHeaders(origin);
  assert.equal(headers["Access-Control-Allow-Origin"], origin);
  assert.ok(headers["Access-Control-Allow-Methods"].includes("POST"));
});
