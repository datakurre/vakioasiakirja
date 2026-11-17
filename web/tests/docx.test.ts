import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { unzipSync, zipSync, strFromU8 } from "fflate";

// Setup DOMParser for Node test environment
const jsdom = new JSDOM();
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = jsdom.window.DOMParser;

import { exportToDocx, importFromDocx, extractFrontmatterAndBody } from "../src/docx.ts";

test("extractFrontmatterAndBody: splits YAML frontmatter from document body", () => {
  const source = `---
doctype: Muistio
title: Testiasiakirja
date: 17.11.2026
author: Etunimi Sukunimi
---

# Otsikko

Tämä on kappale.`;

  const { frontmatterYaml, meta, body } = extractFrontmatterAndBody(source);
  assert.equal(meta.doctype, "Muistio");
  assert.equal(meta.title, "Testiasiakirja");
  assert.equal(meta.date, "17.11.2026");
  assert.equal(meta.author, "Etunimi Sukunimi");
  assert.ok(frontmatterYaml.includes("doctype: Muistio"));
  assert.ok(body.includes("# Otsikko"));
});

test("exportToDocx: generates valid docx zip with expected XML parts", () => {
  const md = `---
doctype: Muistio
title: Hallituksen kokous
author: Sihteeri Sukunimi
date: 17.11.2026
---

# 1 Kokouksen avaus

Puheenjohtaja avasi kokouksen klo 18.00.

## 2 Läsnäolijat

- Etunimi Sukunimi, puheenjohtaja
- Toinen Sukunimi, sihteeri

1. Ensimmäinen asia
2. Toinen asia

| Nimi | Rooli |
| --- | --- |
| Matti Meikäläinen | Jäsen |
| Maija Meikäläinen | Varajäsen |

\\newpage

Aika ja paikka
: Helsinki 17.11.2026

::: handsignature
Etunimi Sukunimi, puheenjohtaja
:::
`;

  const docxBytes = exportToDocx(md);
  assert.ok(docxBytes.length > 500, "Docx file size should be substantial");

  const unzipped = unzipSync(docxBytes);
  assert.ok(unzipped["[Content_Types].xml"], "Content_Types.xml must exist");
  assert.ok(unzipped["_rels/.rels"], "_rels/.rels must exist");
  assert.ok(unzipped["word/_rels/document.xml.rels"], "document.xml.rels must exist");
  assert.ok(unzipped["word/document.xml"], "word/document.xml must exist");
  assert.ok(unzipped["word/styles.xml"], "word/styles.xml must exist");
  assert.ok(unzipped["word/numbering.xml"], "word/numbering.xml must exist");
  assert.ok(unzipped["docProps/core.xml"], "docProps/core.xml must exist");

  const docXml = strFromU8(unzipped["word/document.xml"]);
  assert.ok(docXml.includes('w:val="Heading1"'), "Document must contain Heading1 style");
  assert.ok(docXml.includes('w:val="Heading2"'), "Document must contain Heading2 style");
  assert.ok(docXml.includes('w:val="ListBullet"'), "Document must contain ListBullet");
  assert.ok(docXml.includes('w:val="ListNumber"'), "Document must contain ListNumber");
  assert.ok(docXml.includes("<w:tbl>"), "Document must contain a table");
  assert.ok(docXml.includes('<w:br w:type="page"/>'), "Document must contain a page break");
  assert.ok(docXml.includes("Aika ja paikka"), "Document must contain definition list term");
  assert.ok(docXml.includes("Etunimi Sukunimi, puheenjohtaja"), "Document must contain signature");

  const coreXml = strFromU8(unzipped["docProps/core.xml"]);
  assert.ok(coreXml.includes("<dc:title>Hallituksen kokous</dc:title>"));
  assert.ok(coreXml.includes("<dc:creator>Sihteeri Sukunimi</dc:creator>"));
  assert.ok(coreXml.includes("doctype: Muistio"), "core.xml preserves original frontmatter");
});

test("importFromDocx: imports docx back into Markdown body and restores frontmatter", () => {
  const originalMd = `---
doctype: Muistio
title: Yhdistyksen vuosikokous
date: 17.11.2026
author: Etunimi Sukunimi
features:
  - no-endmatter-newpage
---

# 1 Kokouksen laillisuus ja päätösvaltaisuus

Kokous todettiin **laillisesti koollekutsutuksi** ja *päätösvaltaiseksi*.

## 2 Asialista

- Kohta A
- Kohta B

1. Päätös ensimmäinen
2. Päätös toinen

| Asia | Tila |
| --- | --- |
| Talous | Hyväksytty |
| Toiminta | Käsitelty |

\\newpage

# 3 Seuraava kokous

Sovittiin seuraavasta tapaamisesta.`;

  const docxBytes = exportToDocx(originalMd);
  const importedMd = importFromDocx(docxBytes);

  assert.ok(importedMd.includes("doctype: Muistio"), "Restores doctype in frontmatter");
  assert.ok(importedMd.includes("title: Yhdistyksen vuosikokous"), "Restores title");
  assert.ok(importedMd.includes("# 1 Kokouksen laillisuus ja päätösvaltaisuus"), "Restores Heading 1");
  assert.ok(importedMd.includes("## 2 Asialista"), "Restores Heading 2");
  assert.ok(importedMd.includes("**laillisesti koollekutsutuksi**"), "Preserves bold formatting");
  assert.ok(importedMd.includes("*päätösvaltaiseksi*"), "Preserves italic formatting");
  assert.ok(importedMd.includes("- Kohta A"), "Preserves bullet list");
  assert.ok(importedMd.includes("- Kohta B"), "Preserves bullet list");
  assert.ok(importedMd.includes("1. Päätös ensimmäinen"), "Preserves ordered list");
  assert.ok(importedMd.includes("2. Päätös toinen"), "Preserves ordered list");
  assert.ok(importedMd.includes("| Asia | Tila |"), "Preserves table header");
  assert.ok(importedMd.includes("| Talous | Hyväksytty |"), "Preserves table data");
  assert.ok(importedMd.includes("\\newpage"), "Preserves forced page break");
  assert.ok(importedMd.includes("# 3 Seuraava kokous"), "Preserves heading after page break");
});

test("importFromDocx: synthesizes clean SFS 2487 frontmatter for external docx files", () => {
  const md = `# Ulkoinen asiakirja

Tämä on O365 Wordissa luotu teksti.`;

  const docxBytes = exportToDocx(md, {
    title: "O365 Muistio",
    author: "Matti Meikäläinen",
    date: "17.11.2026",
  });

  const unzipped = unzipSync(docxBytes);
  const coreXml = strFromU8(unzipped["docProps/core.xml"]).replace(
    /<dc:description>[\s\S]*?<\/dc:description>/,
    "<dc:description></dc:description>",
  );

  unzipped["docProps/core.xml"] = new TextEncoder().encode(coreXml);
  const modifiedZip = zipSync(unzipped);

  const imported = importFromDocx(modifiedZip);
  assert.ok(imported.startsWith("---\n"), "Must start with frontmatter delimiter");
  assert.ok(imported.includes("doctype: Muistio"), "Synthesizes standard SFS 2487 doctype");
  assert.ok(imported.includes("title: O365 Muistio"), "Uses title from docx core metadata");
  assert.ok(imported.includes("author: Matti Meikäläinen"), "Uses author from docx core metadata");
  assert.ok(imported.includes("# Ulkoinen asiakirja"), "Includes body heading");
});

test("importFromDocx: throws clear error for invalid zip or missing document.xml", () => {
  const invalidBytes = new Uint8Array([1, 2, 3, 4, 5]);
  assert.throws(
    () => {
      importFromDocx(invalidBytes);
    },
    /Ei kelvollinen Word/i,
  );
});

test("exportToDocx & importFromDocx: handles definition lists and inline code round-trip", () => {
  const md = `---
doctype: Muistio
title: Määritykset
---

Kokouspaikka
: Etäyhteys Teams

Järjestelmä
: \`typst-ts-renderer\` versio 0.7.0
`;

  const docx = exportToDocx(md);
  const imported = importFromDocx(docx);
  assert.ok(imported.includes("Kokouspaikka"), "Contains definition term");
  assert.ok(imported.includes("Etäyhteys Teams"), "Contains definition text");
  assert.ok(imported.includes("`typst-ts-renderer`"), "Contains inline code");
});

test("exportToDocx: handles empty body without crashing", () => {
  const md = `---
doctype: Muistio
title: Tyhjä
---
`;
  const docx = exportToDocx(md);
  assert.ok(docx.length > 0);
  const imported = importFromDocx(docx);
  assert.ok(imported.includes("doctype: Muistio"));
});
