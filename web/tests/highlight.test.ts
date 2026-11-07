import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync, readdirSync } from "node:fs";
import {
  diffLines,
  parseScale,
  getBBoxInParent,
  extractTextLines,
  HighlightTracker,
} from "../src/highlight.ts";
import { $typst } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";
import { preloadRemoteFonts } from "@myriaddreamin/typst.ts";

test("diffLines: correctly identifies added and modified lines", () => {
  // 1. Empty prev -> all lines added
  assert.deepEqual(Array.from(diffLines([], ["A", "B"])), [0, 1]);

  // 2. Identical -> nothing added
  assert.deepEqual(Array.from(diffLines(["A", "B", "C"], ["A", "B", "C"])), []);

  // 3. Line inserted at start (shifts lines down) -> only index 0 added
  assert.deepEqual(
    Array.from(diffLines(["A", "B", "C"], ["NEW", "A", "B", "C"])),
    [0]
  );

  // 4. Line inserted in middle -> only index 1 added
  assert.deepEqual(
    Array.from(diffLines(["A", "B", "C"], ["A", "NEW", "B", "C"])),
    [1]
  );

  // 5. Line appended at end -> only index 3 added
  assert.deepEqual(
    Array.from(diffLines(["A", "B", "C"], ["A", "B", "C", "NEW"])),
    [3]
  );

  // 6. Line modified in middle -> only modified index added
  assert.deepEqual(
    Array.from(diffLines(["A", "B", "C"], ["A", "B_EDITED", "C"])),
    [1]
  );

  // 7. Line deleted -> no lines added
  assert.deepEqual(Array.from(diffLines(["A", "B", "C"], ["A", "C"])), []);

  // 8. Line wrapped into two lines
  assert.deepEqual(
    Array.from(diffLines(["A", "B", "C"], ["A", "B1", "B2", "C"])),
    [1, 2]
  );

  // 9. Repeated / duplicate lines
  assert.deepEqual(
    Array.from(diffLines(["A", "B", "A"], ["A", "B", "A", "A"])),
    [3]
  );
});

test("parseScale: extracts scale factors across formats", () => {
  assert.deepEqual(parseScale(null), { sx: 1, sy: 1 });
  assert.deepEqual(parseScale(""), { sx: 1, sy: 1 });
  assert.deepEqual(parseScale("scale(2)"), { sx: 2, sy: 2 });
  assert.deepEqual(parseScale("scale(0.011, -0.011)"), { sx: 0.011, sy: -0.011 });
  assert.deepEqual(parseScale("scale(16 -16)"), { sx: 16, sy: -16 });
  assert.deepEqual(parseScale("scale(1.25e-2, -1.25e-2)"), { sx: 0.0125, sy: -0.0125 });
});

test("getBBoxInParent: computes accurate bounding box in parent coordinates", () => {
  const dom = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0, 10)">
        <g class="typst-text" data-tid="g1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)">
            <foreignObject x="0" y="-55.88" width="200" height="62.50"></foreignObject>
          </g>
        </g>
      </g>
    </svg>
  `);
  const textNode = dom.window.document.querySelector<SVGGElement>("g.typst-text")!;
  const bbox = getBBoxInParent(textNode);
  assert.ok(bbox !== null);

  // scaleX = 0.011 * 16 = 0.176
  // scaleY = -0.011 * -16 = 0.176
  assert.equal(bbox.x, 0);
  assert.ok(Math.abs(bbox.y - (-55.88 * 0.176)) < 1e-4);
  assert.ok(Math.abs(bbox.width - (200 * 0.176)) < 1e-4);
  assert.ok(Math.abs(bbox.height - (62.5 * 0.176)) < 1e-4);
});

test("HighlightTracker: initial baseline load does NOT highlight document", () => {
  const dom = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0, 10)">
        <g class="typst-text" data-tid="tid-line-1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)">
            <foreignObject x="0" y="-50" width="100" height="60"></foreignObject>
          </g>
        </g>
      </g>
      <g transform="translate(0, 30)">
        <g class="typst-text" data-tid="tid-line-2" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)">
            <foreignObject x="0" y="-50" width="100" height="60"></foreignObject>
          </g>
        </g>
      </g>
    </svg>
  `);

  const tracker = new HighlightTracker();
  tracker.process(dom.window.document.body, false, 1000);

  // No highlights injected
  const rects = dom.window.document.querySelectorAll(".neon-highlight");
  assert.equal(rects.length, 0);
  assert.deepEqual(tracker.getPrevTids(), ["tid-line-1", "tid-line-2"]);
  assert.equal(tracker.getActiveHighlights().size, 0);
});

test("HighlightTracker: live edit highlights newly added lines, not shifted lines", () => {
  const tracker = new HighlightTracker();

  // 1. Initial snapshot establishes baseline
  const dom1 = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="p1" transform="translate(0, 10)">
        <g class="typst-text" data-tid="tid-1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g>
        </g>
      </g>
      <g id="p2" transform="translate(0, 30)">
        <g class="typst-text" data-tid="tid-2" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g>
        </g>
      </g>
    </svg>
  `);
  tracker.process(dom1.window.document.body, false, 1000);

  // 2. Subsequent live edit: line inserted at the top, shifting tid-1 and tid-2 down
  const dom2 = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="p-new" transform="translate(0, 10)">
        <g class="typst-text" data-tid="tid-new" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="120" height="60"></foreignObject></g>
        </g>
      </g>
      <g id="p1" transform="translate(0, 30)">
        <g class="typst-text" data-tid="tid-1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g>
        </g>
      </g>
      <g id="p2" transform="translate(0, 50)">
        <g class="typst-text" data-tid="tid-2" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g>
        </g>
      </g>
    </svg>
  `);
  tracker.process(dom2.window.document.body, true, 1100);

  // ONLY tid-new must have a highlight injected. tid-1 and tid-2 must NOT!
  const rects = dom2.window.document.querySelectorAll(".neon-highlight");
  assert.equal(rects.length, 1);

  const rect = rects[0] as SVGRectElement;
  assert.equal(rect.getAttribute("class"), "neon-highlight");
  assert.equal(rect.getAttribute("rx"), "2");
  assert.equal(rect.getAttribute("ry"), "2");

  // Injected inside parent group before text node
  const parentG = dom2.window.document.getElementById("p-new")!;
  assert.equal(rect.parentElement, parentG);
  assert.equal(rect.nextElementSibling, parentG.querySelector("g.typst-text"));

  // Check that shifted lines have no rects
  assert.equal(dom2.window.document.getElementById("p1")!.querySelectorAll(".neon-highlight").length, 0);
  assert.equal(dom2.window.document.getElementById("p2")!.querySelectorAll(".neon-highlight").length, 0);
});

test("HighlightTracker: consecutive typing updates preserve elapsed animation time without flicker", () => {
  const tracker = new HighlightTracker({ fadeDurationMs: 3000 });

  // Baseline at t = 0
  const dom0 = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="p1"><g class="typst-text" data-tid="lineA"><g transform="scale(16,-16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g></g></g>
    </svg>
  `);
  tracker.process(dom0.window.document.body, false, 0);

  // Edit 1 at t = 1000: Line A edited to A1
  const dom1 = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="p1"><g class="typst-text" data-tid="lineA1"><g transform="scale(16,-16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g></g></g>
    </svg>
  `);
  tracker.process(dom1.window.document.body, true, 1000);

  const rect1 = dom1.window.document.querySelector<SVGRectElement>(".neon-highlight")!;
  assert.ok(rect1);
  // Brand new highlight starts with 0 delay (no negative delay set)
  assert.equal(rect1.style.animationDelay, "");

  // Edit 2 at t = 1500 (500ms later): Line B added below Line A1
  const dom2 = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="p1"><g class="typst-text" data-tid="lineA1"><g transform="scale(16,-16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g></g></g>
      <g id="p2"><g class="typst-text" data-tid="lineB1"><g transform="scale(16,-16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g></g></g>
    </svg>
  `);
  tracker.process(dom2.window.document.body, true, 1500);

  const p1Rect = dom2.window.document.getElementById("p1")!.querySelector<SVGRectElement>(".neon-highlight")!;
  const p2Rect = dom2.window.document.getElementById("p2")!.querySelector<SVGRectElement>(".neon-highlight")!;

  assert.ok(p1Rect, "Line A1 highlight still present across re-render");
  assert.ok(p2Rect, "Line B1 highlight present");

  // Line A1 has 500ms elapsed -> negative animation-delay preserves progress
  assert.equal(p1Rect.style.animationDelay, "-500ms");
  // Line B1 is new -> starts at 0ms
  assert.equal(p2Rect.style.animationDelay, "");

  // Edit 3 at t = 4200: 3200ms after Line A1 was highlighted (> 3000ms fade duration)
  // Line C is added
  const dom3 = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="p1"><g class="typst-text" data-tid="lineA1"><g transform="scale(16,-16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g></g></g>
      <g id="p2"><g class="typst-text" data-tid="lineB1"><g transform="scale(16,-16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g></g></g>
      <g id="p3"><g class="typst-text" data-tid="lineC1"><g transform="scale(16,-16)"><foreignObject x="0" y="-50" width="100" height="60"></foreignObject></g></g></g>
    </svg>
  `);
  tracker.process(dom3.window.document.body, true, 4200);

  // Line A1 expired (> 3000ms): NO highlight rect
  assert.equal(dom3.window.document.getElementById("p1")!.querySelectorAll(".neon-highlight").length, 0);

  // Line B1 (4200 - 1500 = 2700ms < 3000ms): still active with -2700ms
  const p2Rect3 = dom3.window.document.getElementById("p2")!.querySelector<SVGRectElement>(".neon-highlight")!;
  assert.ok(p2Rect3);
  assert.equal(p2Rect3.style.animationDelay, "-2700ms");

  // Line C1 is new -> starts at 0ms
  const p3Rect3 = dom3.window.document.getElementById("p3")!.querySelector<SVGRectElement>(".neon-highlight")!;
  assert.ok(p3Rect3);
  assert.equal(p3Rect3.style.animationDelay, "");
});

test("Real Typst SVG integration: end-to-end highlighting on live document edits", async () => {
  const compilerWasm = readFileSync("node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm");
  const rendererWasm = readFileSync("node_modules/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm");
  const fontFiles = readdirSync("public/fonts").filter((f) => f.endsWith(".otf"));
  const fontBuffers = fontFiles.map((f) => new Uint8Array(readFileSync(`public/fonts/${f}`).buffer));

  $typst.setCompilerInitOptions({
    getModule: () => compilerWasm,
    beforeBuild: [preloadRemoteFonts(fontBuffers, { assets: false })],
  });
  $typst.setRendererInitOptions({ getModule: () => rendererWasm });

  const tracker = new HighlightTracker();

  // Step 1: Initial document
  const svg1 = await $typst.svg({
    mainContent: "= Kokouspöytäkirja\n\n1. Pykälä yksi\n\n2. Pykälä kaksi",
  });
  const dom1 = new JSDOM(svg1);
  tracker.process(dom1.window.document.body, false, 1000);

  // Baseline has no highlights
  assert.equal(dom1.window.document.querySelectorAll(".neon-highlight").length, 0);

  // Step 2: Live edit — presenter edits section 2 and inserts section 3
  const svg2 = await $typst.svg({
    mainContent: "= Kokouspöytäkirja\n\n1. Pykälä yksi\n\n2. Pykälä kaksi muokattu\n\n3. Pykälä kolme uusi",
  });
  const dom2 = new JSDOM(svg2);
  tracker.process(dom2.window.document.body, true, 1500);

  const rects = dom2.window.document.querySelectorAll(".neon-highlight");
  // Exactly 3 text elements changed/added: modified section 2 text, new section number "3.", new section text
  assert.equal(rects.length, 3);

  for (const rect of rects) {
    assert.equal(rect.getAttribute("class"), "neon-highlight");
    assert.equal(rect.getAttribute("rx"), "2");
    assert.equal(rect.getAttribute("ry"), "2");
  }

  // The title and section 1 (both number and text) must NOT be highlighted
  const textLines = extractTextLines(dom2.window.document.body);
  const uneditedTitle = textLines[0]; // Title
  assert.equal(uneditedTitle.parent.querySelectorAll(".neon-highlight").length, 0);
  const uneditedNum1 = textLines[1]; // "1."
  assert.equal(uneditedNum1.parent.querySelectorAll(".neon-highlight").length, 0);
  const uneditedText1 = textLines[2]; // "Pykälä yksi"
  assert.equal(uneditedText1.parent.querySelectorAll(".neon-highlight").length, 0);
  const uneditedNum2 = textLines[3]; // "2."
  assert.equal(uneditedNum2.parent.querySelectorAll(".neon-highlight").length, 0);
});

test("HighlightTracker: duplicate tids (e.g. repeated bullets/symbols) do not cause false-positive highlights", async () => {
  const tracker = new HighlightTracker();

  // Initial document with 2 bullet points
  const svg1 = await $typst.svg({
    mainContent: "= Lista\n\n- Omena\n- Banaani",
  });
  const dom1 = new JSDOM(svg1);
  tracker.process(dom1.window.document.body, false, 1000);
  assert.equal(dom1.window.document.querySelectorAll(".neon-highlight").length, 0);

  // Presenter appends a 3rd bullet item
  const svg2 = await $typst.svg({
    mainContent: "= Lista\n\n- Omena\n- Banaani\n- Sitruuna",
  });
  const dom2 = new JSDOM(svg2);
  tracker.process(dom2.window.document.body, true, 1500);

  // Exactly 2 text elements added: 3rd bullet symbol and "Sitruuna"
  const rects = dom2.window.document.querySelectorAll(".neon-highlight");
  assert.equal(rects.length, 2);

  // The first two bullets must NOT be highlighted!
  const textLines = extractTextLines(dom2.window.document.body);
  // textLines: [Title, Bullet1, "Omena", Bullet2, "Banaani", Bullet3, "Sitruuna"]
  const bullet1 = textLines[1];
  assert.equal(bullet1.parent.querySelectorAll(".neon-highlight").length, 0);
  const omena = textLines[2];
  assert.equal(omena.parent.querySelectorAll(".neon-highlight").length, 0);
  const bullet2 = textLines[3];
  assert.equal(bullet2.parent.querySelectorAll(".neon-highlight").length, 0);
  const banaani = textLines[4];
  assert.equal(banaani.parent.querySelectorAll(".neon-highlight").length, 0);

  // Only bullet 3 and "Sitruuna" are highlighted
  const bullet3 = textLines[5];
  assert.equal(bullet3.parent.querySelectorAll(".neon-highlight").length, 1);
  const sitruuna = textLines[6];
  assert.equal(sitruuna.parent.querySelectorAll(".neon-highlight").length, 1);
});

