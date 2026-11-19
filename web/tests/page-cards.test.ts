import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  hoistSvgStyles,
  pageSignature,
  reconcilePageCards,
  SHARED_STYLE_ATTR,
  type PageCardEntry,
} from "../src/page-cards.ts";

function docSvg(dom: JSDOM, pages: { tid: string; text: string }[]): SVGSVGElement {
  const holder = dom.window.document.createElement("div");
  holder.innerHTML = `<svg class="typst-doc" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 596 ${842 * pages.length}" data-width="596">
    <style>.typst-text { pointer-events: bounding-box; }</style>
    <defs class="glyph"><path id="g1" d="M0 0"/></defs>
    ${pages
      .map(
        (p, i) =>
          `<g class="typst-page" transform="translate(0, ${842 * i})" data-tid="${p.tid}" data-page-width="596" data-page-height="842"><g class="typst-text" data-tid="t${i}"><use href="#g1"/>${p.text}</g></g>`,
      )
      .join("")}
  </svg>`;
  return holder.querySelector("svg") as unknown as SVGSVGElement;
}

function render(dom: JSDOM, container: Element, prev: PageCardEntry[], pages: { tid: string; text: string }[], modified: boolean[] = []) {
  const base = docSvg(dom, pages);
  hoistSvgStyles(base, dom.window.document);
  const groups = Array.from(base.querySelectorAll("g.typst-page"));
  return reconcilePageCards(container, base, groups, prev, modified);
}

test("page-cards: initial render builds one wrapped, cropped card per page", () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="pages"></div></body></html>`);
  const container = dom.window.document.getElementById("pages")!;
  const { entries, rebuilt } = render(dom, container, [], [
    { tid: "pA", text: "one" },
    { tid: "pB", text: "two" },
  ]);
  assert.deepEqual(rebuilt, [0, 1]);
  assert.equal(container.children.length, 2);
  const cards = container.querySelectorAll("div.page-wrap > svg.page");
  assert.equal(cards.length, 2);
  // Each card holds exactly one page plus the shared glyph defs, no styles.
  for (const card of Array.from(cards)) {
    assert.equal(card.querySelectorAll("g.typst-page").length, 1);
    assert.equal(card.querySelectorAll("defs.glyph").length, 1);
    assert.equal(card.querySelectorAll("style").length, 0);
    assert.equal(card.hasAttribute("data-width"), false);
  }
  assert.equal(cards[1].getAttribute("viewBox"), "0 842 596 842");
  assert.equal(entries[0].w, 596);
  assert.equal(entries[0].h, 842);
});

test("page-cards: typst styles are hoisted once into a shared head <style>", () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="pages"></div></body></html>`);
  const container = dom.window.document.getElementById("pages")!;
  let prev = render(dom, container, [], [{ tid: "pA", text: "a" }]).entries;
  prev = render(dom, container, prev, [{ tid: "pB", text: "b" }]).entries;
  const shared = dom.window.document.head.querySelectorAll(`style[${SHARED_STYLE_ATTR}]`);
  assert.equal(shared.length, 1);
  assert.match(shared[0].textContent ?? "", /typst-text/);
  assert.equal(container.querySelectorAll("style").length, 0);
});

test("page-cards: unchanged pages keep their mounted card; only changed pages are rebuilt", () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="pages"></div></body></html>`);
  const container = dom.window.document.getElementById("pages")!;
  const first = render(dom, container, [], [
    { tid: "pA", text: "one" },
    { tid: "pB", text: "two" },
    { tid: "pC", text: "three" },
  ]);
  const [w0, w1, w2] = first.entries.map((e) => e.wrap);

  const second = render(
    dom,
    container,
    first.entries,
    [
      { tid: "pA", text: "one" },
      { tid: "pB2", text: "two!" },
      { tid: "pC", text: "three" },
    ],
    [false, true, false],
  );
  assert.deepEqual(second.rebuilt, [1]);
  assert.equal(container.children[0], w0, "page 1 card reused");
  assert.notEqual(container.children[1], w1, "page 2 card rebuilt");
  assert.equal(container.children[2], w2, "page 3 card reused");
  assert.ok((container.children[1] as Element).classList.contains("page-pulse"));
  assert.ok(container.children[1].querySelector("svg.page")!.classList.contains("page-pulse"));
  assert.equal((container.children[0] as Element).classList.contains("page-pulse"), false);
  assert.match(container.children[1].textContent ?? "", /two!/);
});

test("page-cards: removed pages are dropped and added pages appended", () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="pages"></div></body></html>`);
  const container = dom.window.document.getElementById("pages")!;
  const a = render(dom, container, [], [
    { tid: "pA", text: "1" },
    { tid: "pB", text: "2" },
  ]);
  const b = render(dom, container, a.entries, [{ tid: "pA", text: "1" }]);
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0], a.entries[0].wrap);
  assert.deepEqual(b.rebuilt, []);
  const c = render(dom, container, b.entries, [
    { tid: "pA", text: "1" },
    { tid: "pB", text: "2" },
    { tid: "pC", text: "3" },
  ]);
  assert.deepEqual(c.rebuilt, [1, 2]);
  assert.equal(container.children.length, 3);
});

test("page-cards: foreign container content is replaced", () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="pages"><p>placeholder</p></div></body></html>`);
  const container = dom.window.document.getElementById("pages")!;
  render(dom, container, [], [{ tid: "pA", text: "x" }]);
  assert.equal(container.children.length, 1);
  assert.equal(container.querySelector("p"), null);
});

test("page-cards: signature uses the page content hash and geometry, with markup fallback", () => {
  const dom = new JSDOM(`<!doctype html><body></body>`);
  const base = docSvg(dom, [{ tid: "pA", text: "x" }]);
  const page = base.querySelector("g.typst-page")!;
  const withTid = pageSignature(page);
  assert.match(withTid, /^pA\|/);
  page.setAttribute("transform", "translate(0, 10)");
  assert.notEqual(pageSignature(page), withTid, "geometry is part of the signature");
  page.removeAttribute("data-tid");
  assert.match(pageSignature(page), /<use/, "falls back to markup without a hash");
});
