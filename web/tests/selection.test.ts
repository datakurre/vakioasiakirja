import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  SelectionHighlighter,
  normalize,
  normalizeRaw,
} from "../src/selection-highlighter.ts";
import { extractTextLines } from "../src/highlight.ts";
import { Broadcaster, Viewer, type SelectionPayload, type Snapshot } from "../src/share.ts";
import { $typst } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";

test("normalize: strips markdown formatting and normalizes whitespace", () => {
  assert.equal(normalize("# Otsikko"), "otsikko");
  assert.equal(normalize("## 2 § Pykälä"), "2 § pykälä");
  assert.equal(normalize("**Vahvennettu teksti**"), "vahvennettu teksti");
  assert.equal(normalize("*Kursivoitu*"), "kursivoitu");
  assert.equal(normalize("- Ensimmäinen kohta"), "ensimmäinen kohta");
  assert.equal(normalize("[Linkkiteksti](https://example.com)"), "linkkiteksti https://example.com");
  assert.equal(normalize("  Useita   välilyöntejä  \n ja rivejä  "), "useita välilyöntejä ja rivejä");
});

test("normalizeRaw: collapses whitespace while preserving punctuation", () => {
  assert.equal(normalizeRaw("   ---   "), "---");
  assert.equal(normalizeRaw("1.  Kohta   "), "1. kohta");
});

test("SelectionHighlighter: null, inactive, or empty selection clears highlights and does nothing", () => {
  const dom = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(0, 10)">
        <rect class="selection-highlight" x="0" y="0" width="100" height="20"></rect>
        <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Teksti</foreignObject></g>
        </g>
      </g>
    </svg>
  `);

  const highlighter = new SelectionHighlighter();
  const root = dom.window.document.body;

  // 1. Initial pre-existing highlight exists
  assert.equal(root.querySelectorAll(".selection-highlight").length, 1);

  // 2. update with null -> clears
  highlighter.update(root, null);
  assert.equal(root.querySelectorAll(".selection-highlight").length, 0);

  // 3. update with active: false -> clears
  const rect = dom.window.document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("class", "selection-highlight");
  root.querySelector("g")!.appendChild(rect);
  assert.equal(root.querySelectorAll(".selection-highlight").length, 1);

  highlighter.update(root, { active: false, text: "Teksti" });
  assert.equal(root.querySelectorAll(".selection-highlight").length, 0);

  // 4. update with whitespace only text -> clears
  highlighter.update(root, { active: true, text: "   \n  " });
  assert.equal(root.querySelectorAll(".selection-highlight").length, 0);
});

test("SelectionHighlighter: matches single line and injects persistent rounded rect", () => {
  const dom = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="p1" transform="translate(0, 10)">
        <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Kokouspöytäkirja</foreignObject></g>
        </g>
      </g>
      <g id="p2" transform="translate(0, 40)">
        <g class="typst-text" data-tid="t2" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Toinen rivi</foreignObject></g>
        </g>
      </g>
    </svg>
  `);

  const highlighter = new SelectionHighlighter({ padX: 2, padY: 1, rx: 2, ry: 2 });
  const root = dom.window.document.body;

  highlighter.update(root, {
    active: true,
    mode: "visual",
    text: "Kokouspöytäkirja",
  });

  const highlights = root.querySelectorAll(".selection-highlight");
  assert.equal(highlights.length, 1);

  const h = highlights[0];
  assert.equal(h.getAttribute("class"), "selection-highlight");
  assert.equal(h.getAttribute("rx"), "2");
  assert.equal(h.getAttribute("ry"), "2");
  // Persistent: no animation property or delay
  assert.equal((h as HTMLElement).style.animationDelay, "");

  // Injected inside parent <g> before line.element
  const p1 = dom.window.document.getElementById("p1")!;
  assert.equal(p1.firstElementChild, h);
  assert.equal(h.nextElementSibling, p1.querySelector("g.typst-text"));
});

test("SelectionHighlighter: matches markdown formatting against plain rendered text", () => {
  const dom = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="p1" transform="translate(0, 10)">
        <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">1 § Kokouksen avaus</foreignObject></g>
        </g>
      </g>
    </svg>
  `);

  const highlighter = new SelectionHighlighter();
  const root = dom.window.document.body;

  // Selected Markdown heading: "## 1 § Kokouksen avaus"
  highlighter.update(root, {
    active: true,
    mode: "visual",
    text: "## 1 § Kokouksen avaus",
  });

  const highlights = root.querySelectorAll(".selection-highlight");
  assert.equal(highlights.length, 1);
});

test("SelectionHighlighter: matches multi-line selection spanning consecutive SVG lines", () => {
  const dom = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="p1" transform="translate(0, 10)">
        <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Alkurivi ennen valintaa</foreignObject></g>
        </g>
      </g>
      <g id="p2" transform="translate(0, 30)">
        <g class="typst-text" data-tid="t2" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Valittu ensimmäinen rivi</foreignObject></g>
        </g>
      </g>
      <g id="p3" transform="translate(0, 50)">
        <g class="typst-text" data-tid="t3" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Valittu toinen rivi</foreignObject></g>
        </g>
      </g>
      <g id="p4" transform="translate(0, 70)">
        <g class="typst-text" data-tid="t4" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Loppurivi valinnan jälkeen</foreignObject></g>
        </g>
      </g>
    </svg>
  `);

  const highlighter = new SelectionHighlighter();
  const root = dom.window.document.body;

  highlighter.update(root, {
    active: true,
    mode: "linewise",
    text: "Valittu ensimmäinen rivi\nValittu toinen rivi\n",
  });

  const highlights = root.querySelectorAll(".selection-highlight");
  assert.equal(highlights.length, 2);

  // Exactly p2 and p3 are highlighted, p1 and p4 are not
  const p1 = dom.window.document.getElementById("p1")!;
  const p2 = dom.window.document.getElementById("p2")!;
  const p3 = dom.window.document.getElementById("p3")!;
  const p4 = dom.window.document.getElementById("p4")!;

  assert.equal(p1.querySelectorAll(".selection-highlight").length, 0);
  assert.equal(p2.querySelectorAll(".selection-highlight").length, 1);
  assert.equal(p3.querySelectorAll(".selection-highlight").length, 1);
  assert.equal(p4.querySelectorAll(".selection-highlight").length, 0);
});

test("SelectionHighlighter: resolves ambiguity using relPos", () => {
  const dom = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="top-title" transform="translate(0, 10)">
        <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Pöytäkirja</foreignObject></g>
        </g>
      </g>
      <g id="mid-1" transform="translate(0, 30)">
        <g class="typst-text" data-tid="t2" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Asia 1</foreignObject></g>
        </g>
      </g>
      <g id="mid-2" transform="translate(0, 50)">
        <g class="typst-text" data-tid="t3" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Asia 2</foreignObject></g>
        </g>
      </g>
      <g id="bottom-ref" transform="translate(0, 70)">
        <g class="typst-text" data-tid="t4" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Pöytäkirja</foreignObject></g>
        </g>
      </g>
    </svg>
  `);

  const highlighter = new SelectionHighlighter();
  const root = dom.window.document.body;

  // 1. relPos = 0.95 -> matches bottom-ref
  highlighter.update(root, {
    active: true,
    text: "Pöytäkirja",
    relPos: 0.95,
  });

  const bottomRef = dom.window.document.getElementById("bottom-ref")!;
  const topTitle = dom.window.document.getElementById("top-title")!;
  assert.equal(bottomRef.querySelectorAll(".selection-highlight").length, 1);
  assert.equal(topTitle.querySelectorAll(".selection-highlight").length, 0);

  // 2. relPos = 0.05 -> matches top-title
  highlighter.update(root, {
    active: true,
    text: "Pöytäkirja",
    relPos: 0.05,
  });

  assert.equal(topTitle.querySelectorAll(".selection-highlight").length, 1);
  assert.equal(bottomRef.querySelectorAll(".selection-highlight").length, 0);
});

test("SelectionHighlighter: resolves ambiguity using prefix and suffix context", () => {
  const dom = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="item-1-prefix" transform="translate(0, 10)">
        <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Ensimmäinen osio</foreignObject></g>
        </g>
      </g>
      <g id="item-1-target" transform="translate(0, 30)">
        <g class="typst-text" data-tid="t2" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Hyväksyttiin</foreignObject></g>
        </g>
      </g>
      <g id="item-2-prefix" transform="translate(0, 50)">
        <g class="typst-text" data-tid="t3" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Toinen osio</foreignObject></g>
        </g>
      </g>
      <g id="item-2-target" transform="translate(0, 70)">
        <g class="typst-text" data-tid="t4" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Hyväksyttiin</foreignObject></g>
        </g>
      </g>
      <g id="item-2-suffix" transform="translate(0, 90)">
        <g class="typst-text" data-tid="t5" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">yksimielisesti</foreignObject></g>
        </g>
      </g>
    </svg>
  `);

  const highlighter = new SelectionHighlighter();
  const root = dom.window.document.body;

  // Selected "Hyväksyttiin" preceded by "Toinen osio" and followed by "yksimielisesti"
  highlighter.update(root, {
    active: true,
    text: "Hyväksyttiin",
    prefix: "Toinen osio ",
    suffix: " yksimielisesti",
  });

  const item1 = dom.window.document.getElementById("item-1-target")!;
  const item2 = dom.window.document.getElementById("item-2-target")!;

  assert.equal(item1.querySelectorAll(".selection-highlight").length, 0);
  assert.equal(item2.querySelectorAll(".selection-highlight").length, 1);
});

test("SelectionHighlighter: multi-page card rendering targets correct visible page card", () => {
  const dom = new JSDOM(`
    <div id="pages">
      <svg class="page" viewBox="0 0 100 200">
        <g class="typst-page" transform="translate(0, 0)">
          <g id="p1-text-parent" transform="translate(0, 10)">
            <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
              <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Sivu yksi otsikko</foreignObject></g>
            </g>
          </g>
        </g>
        <g class="typst-page" transform="translate(0, 200)">
          <g id="p1-p2-hidden" transform="translate(0, 10)">
            <g class="typst-text" data-tid="t2" transform="scale(0.011, -0.011)">
              <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Sivu kaksi otsikko</foreignObject></g>
            </g>
          </g>
        </g>
      </svg>
      <svg class="page" viewBox="0 200 100 200">
        <g class="typst-page" transform="translate(0, 0)">
          <g id="p2-p1-hidden" transform="translate(0, 10)">
            <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
              <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Sivu yksi otsikko</foreignObject></g>
            </g>
          </g>
        </g>
        <g class="typst-page" transform="translate(0, 200)">
          <g id="p2-text-parent" transform="translate(0, 10)">
            <g class="typst-text" data-tid="t2" transform="scale(0.011, -0.011)">
              <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Sivu kaksi otsikko</foreignObject></g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  `);

  const highlighter = new SelectionHighlighter();
  const root = dom.window.document.getElementById("pages")!;

  // Target page 2 text
  highlighter.update(root, {
    active: true,
    text: "Sivu kaksi otsikko",
  });

  const p2Target = dom.window.document.getElementById("p2-text-parent")!;
  assert.equal(p2Target.querySelectorAll(".selection-highlight").length, 1);

  // Hidden copy on card 1 must not be highlighted
  const hiddenOnCard1 = dom.window.document.getElementById("p1-p2-hidden")!;
  assert.equal(hiddenOnCard1.querySelectorAll(".selection-highlight").length, 0);
});

test("Broadcaster and Viewer: selection payload synchronization across data channel", async () => {
  // Mock RTCDataChannel and Broadcaster / Viewer message flow
  let viewerHandler: ((e: MessageEvent) => void) | undefined;
  const sentMessages: string[] = [];

  const mockChannel = {
    readyState: "open",
    send(data: string) {
      sentMessages.push(data);
      if (viewerHandler) {
        viewerHandler({ data } as MessageEvent);
      }
    },
    addEventListener(event: string, cb: any) {
      if (event === "message") viewerHandler = cb;
    },
  };

  const broadcaster = new Broadcaster(
    () => {},
    () => {},
  );

  // Inject mock channel into broadcaster's dcs
  (broadcaster as any).dcs.set("v1", mockChannel);

  let receivedPayload: SelectionPayload | null | undefined = undefined;
  const viewer = new Viewer(
    "ROOM123",
    () => {},
    () => {},
    () => {},
    (payload) => {
      receivedPayload = payload;
    },
  );

  // Wire mock channel into viewer
  (viewer as any).accept = async () => {};
  const mockEvent = { channel: mockChannel };
  // Trigger datachannel event on viewer's pc mock if needed, or invoke the handler directly
  mockChannel.addEventListener("message", (ev: MessageEvent) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "selection") {
      (viewer as any).onSelection?.(msg.data);
    }
  });

  // 1. Broadcaster pushes selection payload
  const payload: SelectionPayload = {
    active: true,
    mode: "visual",
    text: "Tärkeä päätös",
    prefix: "Kokous ",
    suffix: " tehtiin",
    fromLine: 10,
    toLine: 10,
    relPos: 0.42,
  };

  broadcaster.pushSelection(payload);

  assert.equal(sentMessages.length, 1);
  const sent = JSON.parse(sentMessages[0]);
  assert.equal(sent.type, "selection");
  assert.deepEqual(sent.data, payload);
  assert.deepEqual(receivedPayload, payload);

  // 2. Host exits visual mode -> sends null
  broadcaster.pushSelection(null);

  assert.equal(sentMessages.length, 2);
  const sentNull = JSON.parse(sentMessages[1]);
  assert.equal(sentNull.type, "selection");
  assert.equal(sentNull.data, null);
  assert.equal(receivedPayload, null);
});

test("Real Typst SVG integration: end-to-end selection highlight on rendered document", async () => {
  const svg = await $typst.svg({
    mainContent: "= Kokouspöytäkirja 1/2026\n\n1. Kokouksen avaus\nPuheenjohtaja avasi kokouksen klo 10.00.\n\n2. Laillisuus ja päätösvaltaisuus\nKokous todettiin lailliseksi ja päätösvaltaiseksi.",
  });

  const dom = new JSDOM(svg);
  const root = dom.window.document.body;
  const highlighter = new SelectionHighlighter();

  // 1. Host selects section 2 heading in visual mode
  highlighter.update(root, {
    active: true,
    mode: "visual",
    text: "2. Laillisuus ja päätösvaltaisuus",
    relPos: 0.6,
  });

  let rects = root.querySelectorAll(".selection-highlight");
  assert.ok(rects.length >= 1);

  for (const rect of rects) {
    assert.equal(rect.getAttribute("class"), "selection-highlight");
    assert.equal(rect.getAttribute("rx"), "2");
    assert.equal(rect.getAttribute("ry"), "2");
    assert.ok(parseFloat(rect.getAttribute("width") || "0") > 0);
    assert.ok(parseFloat(rect.getAttribute("height") || "0") > 0);
  }

  // Verify that the title "= Kokouspöytäkirja 1/2026" is NOT highlighted
  const textLines = extractTextLines(root);
  const titleLine = textLines[0];
  assert.equal(titleLine.parent.querySelectorAll(".selection-highlight").length, 0);

  // 2. Host deselects / exits visual mode
  highlighter.update(root, null);
  assert.equal(root.querySelectorAll(".selection-highlight").length, 0);
});
