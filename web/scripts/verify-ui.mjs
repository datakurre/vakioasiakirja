// One-off manual UI check (not part of CI): verifies the bottom status bar,
// the Vim mode indicator, the visible visual-mode selection, and that errors
// surface as toasts. Run after `npm run build`:
//   CHROMIUM=/path/to/chrome node scripts/verify-ui.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import puppeteer from "puppeteer-core";

const DIST = new URL("../dist/", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".otf": "font/otf", ".svg": "image/svg+xml", ".json": "application/json",
};
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(req.url.split("?")[0]));
  if (p === "/") p = "/index.html";
  const file = join(DIST, p);
  if (!existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
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

// Controls now live in the bottom status bar.
const inBar = await page.$$eval("#statusbar button, #statusbar #vim-mode, #statusbar #vim",
  (els) => els.map((e) => e.id));
console.log("STATUSBAR_CONTROLS:", inBar.join(", "));

async function dragSelectFirstLine() {
  const box = await page.$eval(".cm-line", (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2, w: r.width };
  });
  await page.mouse.move(box.x + 4, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(120, box.w - 8), box.y, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 120));
}

// Baseline: a plain mouse selection must be painted (drawSelection + theme).
await dragSelectFirstLine();
const plainSel = await page.$$eval(".cm-selectionBackground", (els) => els.map((e) => getComputedStyle(e).backgroundColor));
console.log("PLAIN_SELECTION_BACKGROUNDS:", JSON.stringify(plainSel));

// Enable Vim and check the mode badge appears as NORMAL.
await page.click("#vim");
await page.click(".cm-content"); // focus the editor
await new Promise((r) => setTimeout(r, 100));
const normal = await page.$eval("#vim-mode", (e) => ({ hidden: e.hidden, text: e.textContent, mode: e.dataset.mode }));
console.log("VIM_MODE_NORMAL:", JSON.stringify(normal));

// A mouse drag in Vim mode enters visual mode; the selection must be painted.
await dragSelectFirstLine();
const visual = await page.$eval("#vim-mode", (e) => ({ text: e.textContent, mode: e.dataset.mode }));
const sel = await page.$$eval(".cm-selectionBackground", (els) =>
  els.map((e) => getComputedStyle(e).backgroundColor),
);
console.log("VIM_MODE_VISUAL:", JSON.stringify(visual));
console.log("SELECTION_BACKGROUNDS:", JSON.stringify(sel));

// Trigger a conversion error and confirm it surfaces as a bottom-right toast,
// while the header keeps its single short line (no reflow).
const headerBefore = await page.$eval("header", (e) => e.getBoundingClientRect().height);
await page.click("#vim"); // back to plain editing for a reliable select-all
await page.click(".cm-content");
await page.keyboard.down("Control");
await page.keyboard.press("a");
await page.keyboard.up("Control");
await page.keyboard.type("---\nagenda: true\n---\n\nHei.\n");
await new Promise((r) => setTimeout(r, 700));
const toast = await page.evaluate(() => {
  const t = document.querySelector("#toasts .toast");
  return { count: document.querySelectorAll("#toasts .toast").length, text: t ? t.textContent.slice(0, 40) : null };
});
const headerAfter = await page.$eval("header", (e) => e.getBoundingClientRect().height);
const status = await page.$eval("#status", (e) => e.textContent);
console.log("TOAST:", JSON.stringify(toast));
console.log("STATUS_AFTER_ERROR:", status);
console.log("HEADER_HEIGHT_STABLE:", headerBefore === headerAfter, headerBefore, headerAfter);
await browser.close();
server.close();
