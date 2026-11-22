import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { $typst } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";
import { preloadRemoteFonts } from "@myriaddreamin/typst.ts";
import { markdownToTypst } from "../src/md-to-typst.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(currentDir, "..");
const compilerWasm = readFileSync(
  resolve(webDir, "node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm"),
);
const rendererWasm = readFileSync(
  resolve(webDir, "node_modules/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm"),
);
const fontFiles = readdirSync(resolve(webDir, "public/fonts")).filter((f) => f.endsWith(".otf"));
const fontBuffers = fontFiles.map((f) => new Uint8Array(readFileSync(resolve(webDir, `public/fonts/${f}`)).buffer));

$typst.setCompilerInitOptions({
  getModule: () => compilerWasm,
  beforeBuild: [preloadRemoteFonts(fontBuffers, { assets: false })],
});
$typst.setRendererInitOptions({ getModule: () => rendererWasm });

const sfsTypst = readFileSync(resolve(webDir, "src/sfs-2487-2024.typ"), "utf-8");

function getElementTotalTransform(element: Element): { x: number; y: number } {
  let curr: Element | null = element;
  let totalX = 0;
  let totalY = 0;
  while (curr && curr.tagName !== "svg") {
    const tr = curr.getAttribute ? curr.getAttribute("transform") : null;
    if (tr) {
      const match = /translate\(([-0-9.]+)[, ]+([-0-9.]+)\)/.exec(tr);
      if (match) {
        totalX += parseFloat(match[1]);
        totalY += parseFloat(match[2]);
      }
    }
    curr = curr.parentElement;
  }
  return { x: totalX, y: totalY };
}

test("md-to-typst: escapes dot and leading list markers in frontmatter list fields", () => {
  const md = `---
doctype: Pöytäkirja
title: Hallituksen kokous
date: 2026-11-17
attachments:
  - 1. Toimintasuunnitelma vuodelle 2027
  - 2. Talousarvio vuodelle 2027
  - "- Luonnosasiakirja"
  - "+ Lisäliite"
  - "/ Termiliite: selite"
  - "= Otsikkoliite"
recipient:
  - Asunto Oy Esimerkki
  - 1. linja 12
  - 00530 Helsinki
distribution:
  - 1. Hallitus
  - 2. Tilintarkastajat
forinformation:
  - 1. Jäsenistö
contact:
  name: Esimerkki ry
  lines:
    - 1. Toimipiste
    - PL 100
---

Kokous avattiin.
`;

  const typst = markdownToTypst(md);

  // Assert dots are escaped so Typst does not parse as enum
  assert.ok(typst.includes("1\\. Toimintasuunnitelma vuodelle 2027"));
  assert.ok(typst.includes("2\\. Talousarvio vuodelle 2027"));
  assert.ok(typst.includes("\\- Luonnosasiakirja"));
  assert.ok(typst.includes("\\+ Lisäliite"));
  assert.ok(typst.includes("\\/ Termiliite: selite"));
  assert.ok(typst.includes("\\= Otsikkoliite"));
  assert.ok(typst.includes("1\\. linja 12"));
  assert.ok(typst.includes("1\\. Hallitus"));
  assert.ok(typst.includes("1\\. Jäsenistö"));
  assert.ok(typst.includes("1\\. Toimipiste"));
});

test("md-to-typst: multiline scalar strings in list fields are converted to lines with \\ breaks", () => {
  const md = `---
doctype: Pöytäkirja
title: Hallituksen kokous
date: 2026-11-17
attachments: |
  1. Toimintasuunnitelma
  2. Talousarvio
---

Kokous avattiin.
`;

  const typst = markdownToTypst(md);
  assert.ok(typst.includes("attachments: [1\\. Toimintasuunnitelma \\ 2\\. Talousarvio]"));
});

test("md-to-typst: en-dash (--), em-dash (---) and hyphenated words are preserved", () => {
  const md = `---
doctype: Pöytäkirja
title: Hallituksen kokous
date: 2026-11-17
---

Aika oli 12.30--13.45.
Kyseessä on SFS-2487-standardi.
Ajatusviiva --- pitkä viiva.
`;

  const typst = markdownToTypst(md);
  // Typst source should retain '--' and '---' for Typst ligature replacement
  assert.ok(typst.includes("12\\.30--13\\.45"));
  assert.ok(typst.includes("SFS-2487-standardi"));
  assert.ok(typst.includes("---"));
});

test("Real Typst SVG integration: attachments with numbers and dots align perfectly without hanging indent", async () => {
  await $typst.mapShadow("/sfs-2487-2024.typ", new TextEncoder().encode(sfsTypst));

  const md = `---
doctype: Pöytäkirja
title: Hallituksen kokous
date: 2026-11-17
attachments:
  - 1. Toimintasuunnitelma vuodelle 2027
  - 2. Talousarvio vuodelle 2027
  - 3. Toiminnantarkastuskertomus vuodelta 2026
---

Kokous avattiin.
`;

  const typst = markdownToTypst(md);
  const svg = await $typst.svg({ mainContent: typst });
  const dom = new JSDOM(svg);

  // Extract all rendered text entries related to attachments
  const matching: Array<{ text: string; x: number; y: number }> = [];
  for (const div of dom.window.document.querySelectorAll(".tsel")) {
    const text = div.textContent?.trim() || "";
    if (
      text.includes("Liitteet") ||
      text.includes("Toimintasuunnitelma") ||
      text.includes("Talousarvio") ||
      text.includes("Toiminnantarkastus") ||
      text === "1." ||
      text === "2." ||
      text === "3."
    ) {
      const pos = getElementTotalTransform(div);
      matching.push({ text, x: Math.round(pos.x * 1000) / 1000, y: Math.round(pos.y * 1000) / 1000 });
    }
  }

  // 1. "1." must NOT be detached as a separate enum marker
  const separate1 = matching.find((m) => m.text === "1.");
  assert.equal(separate1, undefined, "Item 1 number '1.' must not be a detached enum bullet marker");

  // 2. Find all 3 attachment items
  const item1 = matching.find((m) => m.text.includes("Toimintasuunnitelma"));
  const item2 = matching.find((m) => m.text.includes("Talousarvio"));
  const item3 = matching.find((m) => m.text.includes("Toiminnantarkastus"));

  assert.ok(item1, "Item 1 must be present in rendered SVG");
  assert.ok(item2, "Item 2 must be present in rendered SVG");
  assert.ok(item3, "Item 3 must be present in rendered SVG");

  // 3. Verify horizontal positions: body text column at 43 mm (121.890 pt)
  // All three items must have the EXACT SAME x coordinate
  assert.equal(item1.x, 121.89, "Item 1 must start flush at the 43 mm body column (121.890 pt)");
  assert.equal(item2.x, 121.89, "Item 2 must start flush at the 43 mm body column (121.890 pt)");
  assert.equal(item3.x, 121.89, "Item 3 must start flush at the 43 mm body column (121.890 pt)");

  // 4. Verify vertical positions: lines must be stacked sequentially
  assert.ok(item2.y > item1.y, "Item 2 must be below Item 1");
  assert.ok(item3.y > item2.y, "Item 3 must be below Item 2");

  // 5. Marginlabel "Liitteet" hangs at 20 mm margin (56.693 pt = 121.890 - 65.197 pt)
  const label = matching.find((m) => m.text === "Liitteet");
  assert.ok(label, "Liitteet label must be present");
  assert.equal(label.x, 56.693, "Liitteet label must hang at 20 mm left margin (56.693 pt)");
  assert.equal(label.y, item1.y, "Liitteet label runs in on the same baseline as Item 1");
});

test("Real Typst SVG integration: recipient, distribution, and contact fields align cleanly", async () => {
  await $typst.mapShadow("/sfs-2487-2024.typ", new TextEncoder().encode(sfsTypst));

  const md = `---
doctype: Kirje
title: Tiedote asukkaille
date: 2026-11-17
recipient:
  - 1. Kaupunginosa
  - Aleksanterinkatu 1
  - 00100 Helsinki
distribution:
  - 1. Hallitus
  - 2. Isännöitsijä
---

Tiedotamme tulevasta remontista.
`;

  const typst = markdownToTypst(md);
  const svg = await $typst.svg({ mainContent: typst });
  const dom = new JSDOM(svg);

  // Recipient lines must start at the recipient indent (-column relative to body = 56.693 pt)
  const recipientLine1 = dom.window.document.querySelector(".tsel");
  const matching: Array<{ text: string; x: number; y: number }> = [];
  for (const div of dom.window.document.querySelectorAll(".tsel")) {
    const text = div.textContent?.trim() || "";
    if (
      text.includes("Kaupunginosa") ||
      text.includes("Aleksanterinkatu") ||
      text.includes("00100 Helsinki") ||
      text.includes("Hallitus") ||
      text.includes("Isännöitsijä")
    ) {
      const pos = getElementTotalTransform(div);
      matching.push({ text, x: Math.round(pos.x * 1000) / 1000, y: Math.round(pos.y * 1000) / 1000 });
    }
  }

  const rec1 = matching.find((m) => m.text.includes("Kaupunginosa"))!;
  const rec2 = matching.find((m) => m.text.includes("Aleksanterinkatu"))!;
  const rec3 = matching.find((m) => m.text.includes("00100 Helsinki"))!;

  assert.ok(rec1 && rec2 && rec3);
  // All three recipient lines must align flush horizontally
  assert.equal(rec1.x, rec2.x, "Recipient lines 1 and 2 must have identical x coordinate");
  assert.equal(rec2.x, rec3.x, "Recipient lines 2 and 3 must have identical x coordinate");

  const dist1 = matching.find((m) => m.text.includes("Hallitus"))!;
  const dist2 = matching.find((m) => m.text.includes("Isännöitsijä"))!;
  assert.ok(dist1 && dist2);
  // Both distribution lines must align flush at 43 mm (121.890 pt)
  assert.equal(dist1.x, 121.89, "Distribution line 1 must be at 43 mm body column");
  assert.equal(dist2.x, 121.89, "Distribution line 2 must be at 43 mm body column");
});

test("md-to-typst: forced page break via TeX commands (\\newpage, \\pagebreak, \\clearpage)", () => {
  const md = `---
doctype: Muistio
title: Testiasiakirja
date: 2026-11-17
---

Ensimmäinen kappale.

\\newpage

Toinen kappale.

\\pagebreak

Kolmas kappale.

\\clearpage

Neljäs kappale.

\\newpage{}

Viides kappale.
\\newpage
Kuudes kappale.

Koodiesimerkissä komento säilyy koodina: \`\\newpage\`.
`;

  const typst = markdownToTypst(md);

  // Assert all variants generate #pagebreak()
  const pagebreakCount = (typst.match(/#pagebreak\(\)/g) || []).length;
  assert.equal(pagebreakCount, 5, "Expected 5 pagebreak occurrences");

  // Inline code must not be converted to #pagebreak()
  assert.ok(typst.includes("`\\newpage`"), "Inline code \\newpage must remain verbatim");
  assert.ok(typst.includes("Ensimmäinen kappale"));
  assert.ok(typst.includes("Kuudes kappale"));
});

test("md-to-typst: forced page break via fenced divs (::: pagebreak and ::: newpage)", () => {
  const md = `---
doctype: Muistio
title: Testiasiakirja
date: 2026-11-17
---

Ensimmäinen kappale.

::: pagebreak
:::

Toinen kappale.

::: newpage
:::

Kolmas kappale.

::: {.pagebreak}
:::

Neljäs kappale.

::: {.newpage}
:::

Viides kappale.

::: pagebreak :::

Kuudes kappale.

::: pagebreak
Seitsemäs kappale.
`;

  const typst = markdownToTypst(md);

  // Assert all fenced div variants generate #pagebreak()
  const pagebreakCount = (typst.match(/#pagebreak\(\)/g) || []).length;
  assert.equal(pagebreakCount, 6, "Expected 6 pagebreak occurrences from fenced divs");
  assert.ok(typst.includes("Ensimmäinen kappale"));
  assert.ok(typst.includes("Seitsemäs kappale"));
});

test("Real Typst SVG integration: forced page break splits content across multiple pages", async () => {
  await $typst.mapShadow("/sfs-2487-2024.typ", new TextEncoder().encode(sfsTypst));

  const md = `---
doctype: Muistio
title: Testiasiakirja
date: 2026-11-17
---

Ensimmäisen sivun sisältö.

\\newpage

Toisen sivun sisältö.

::: pagebreak
:::

Kolmannen sivun sisältö.
`;

  const typst = markdownToTypst(md);
  const svg = await $typst.svg({ mainContent: typst });
  const dom = new JSDOM(svg);

  const pages = dom.window.document.querySelectorAll(".typst-page");
  assert.equal(pages.length, 3, "Document with 2 page breaks should render exactly 3 pages");

  assert.ok(pages[0].textContent?.includes("Ensimmäisen sivun sisältö"), "Page 1 contains first section");
  assert.ok(pages[0].textContent?.includes("1 (3)"), "Page 1 header shows '1 (3)'");

  assert.ok(pages[1].textContent?.includes("Toisen sivun sisältö"), "Page 2 contains second section");
  assert.ok(pages[1].textContent?.includes("2 (3)"), "Page 2 header shows '2 (3)'");

  assert.ok(pages[2].textContent?.includes("Kolmannen sivun sisältö"), "Page 3 contains third section");
  assert.ok(pages[2].textContent?.includes("3 (3)"), "Page 3 header shows '3 (3)'");
});

test("md-to-typst: table divider rows convert to table.hline() for intra-table lines (e.g. Yhteenveto)", () => {
  const md = `---
doctype: Raportti
title: Laskutus
date: 2026-11-22
---

| Palvelu                              | Laskutus vuonna 2026   |
|--------------------------------------|-----------------------:|
| Domain suomenpalikkayhteiso.fi       |                21,21 € |
| DNS-palvelu (suomenpalikkayhteiso.fi |                11,30 € |
|--------------------------------------|-----------------------:|
| Yhteenveto                           |                32,51 € |
`;

  const typst = markdownToTypst(md);
  const hlineMatches = typst.match(/table\.hline\(\)/g) || [];
  // Expected: top hline, header hline, divider hline, bottom hline = 4
  assert.equal(hlineMatches.length, 4, "Expected 4 table.hline() calls in table");
  assert.ok(typst.includes("[Domain suomenpalikkayhteiso\\.fi]"));
  assert.ok(typst.includes("[Yhteenveto]"));
  // Assert table.hline() sits between the DNS-palvelu row and the Yhteenveto row
  const dnsIndex = typst.indexOf("DNS-palvelu");
  const hlineIndex = typst.indexOf("table.hline(),\n  [Yhteenveto]");
  assert.ok(dnsIndex > 0 && hlineIndex > dnsIndex, "table.hline() must appear directly before Yhteenveto row");
});

test("Real Typst SVG integration: table with intra-table horizontal line compiles and renders correctly", async () => {
  await $typst.mapShadow("/sfs-2487-2024.typ", new TextEncoder().encode(sfsTypst));

  const md = `---
doctype: Raportti
title: Laskutus
date: 2026-11-22
---

: Palvelumaksut

| Palvelu                              | Laskutus vuonna 2026   |
|:-------------------------------------|-----------------------:|
| Domain suomenpalikkayhteiso.fi       |                21,21 € |
| DNS-palvelu (suomenpalikkayhteiso.fi |                11,30 € |
|:-------------------------------------|-----------------------:|
| **Yhteenveto**                       |                32,51 € |
`;

  const typst = markdownToTypst(md);
  const svg = await $typst.svg({ mainContent: typst });
  const dom = new JSDOM(svg);

  assert.ok(svg.includes("Palvelu"), "SVG contains header text");
  assert.ok(svg.includes("Yhteenveto"), "SVG contains total row label");
  assert.ok(svg.includes("32,51"), "SVG contains calculated total value");
  const paths = dom.window.document.querySelectorAll("path");
  assert.ok(paths.length >= 4, "Expected at least 4 horizontal rule paths in table rendering");
});
