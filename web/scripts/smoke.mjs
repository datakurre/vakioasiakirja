// Headless in-browser smoke test for the typst.ts editor.
//
// Builds confidence that the prototype compiles end-to-end in a real browser
// (typst.ts font preload + WASM init + compile), not only via the matching
// `typst` CLI. It serves web/dist, loads the editor, waits for a successful
// compile, triggers the PDF download and saves it; check the result with
// `pdftotext -bbox` against the standard's positions (56.69 / 121.9 / 317.5 pt).
//
// Needs a Chromium binary and puppeteer-core, both kept out of the build deps:
//   npm run build
//   npm install --no-save puppeteer-core
//   CHROMIUM=/path/to/chromium DOWNLOAD_DIR=/tmp/dl node scripts/smoke.mjs
//   pdftotext -bbox /tmp/dl/<file> -

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import puppeteer from "puppeteer-core";

const DIST = new URL("../dist/", import.meta.url).pathname;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR ?? "/tmp/dl";
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".otf": "font/otf", ".svg": "image/svg+xml", ".json": "application/json",
};

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split("?")[0]));
  if (p === "/") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) {
    res.statusCode = 404;
    return res.end("not found");
  }
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("CONSOLE:", m.text()));

await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });
await page.waitForFunction(
  () => document.getElementById("status")?.textContent === "käännetty",
  { timeout: 120000 },
);
console.log("STATUS:", await page.$eval("#status", (e) => e.textContent));
console.log("PREVIEW_HAS_SVG:", await page.$eval("#preview", (e) => e.querySelector("svg") !== null));

const client = await page.target().createCDPSession();
await client.send("Browser.setDownloadBehavior", {
  behavior: "allowAndName",
  downloadPath: DOWNLOAD_DIR,
  eventsEnabled: true,
});
const done = new Promise((res) =>
  client.on("Browser.downloadProgress", (e) => e.state === "completed" && res(e.guid)),
);
await page.click("#download");
const guid = await done;
await browser.close();
server.close();
console.log("SAVED:", join(DOWNLOAD_DIR, guid));
