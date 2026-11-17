import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import MarkdownIt from "markdown-it";
// @ts-ignore markdown-it-deflist typing
import markdownItDeflist from "markdown-it-deflist";
import yaml from "js-yaml";

export interface DocxExportOptions {
  title?: string;
  author?: string;
  date?: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseXml(xml: string): Document {
  if (typeof DOMParser !== "undefined") {
    return new DOMParser().parseFromString(xml, "application/xml");
  }
  const globalParser = (globalThis as any).DOMParser;
  if (globalParser) {
    return new globalParser().parseFromString(xml, "application/xml");
  }
  throw new Error("DOMParser is not available in the current environment.");
}

interface InlineFormat {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  underline?: boolean;
  strike?: boolean;
}

interface InlineRun {
  text: string;
  format: InlineFormat;
}

function renderRunsToXml(runs: InlineRun[]): string {
  return runs
    .map((r) => {
      const prParts: string[] = [];
      if (r.format.bold) prParts.push("<w:b/>");
      if (r.format.italic) prParts.push("<w:i/>");
      if (r.format.strike) prParts.push("<w:strike/>");
      if (r.format.underline) prParts.push('<w:u w:val="single"/>');
      if (r.format.code) {
        prParts.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
        prParts.push('<w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/>');
      }
      const rPr = prParts.length > 0 ? `<w:rPr>${prParts.join("")}</w:rPr>` : "";
      const parts = r.text.split("\n");
      const textXml = parts
        .map((p, idx) => (idx > 0 ? "<w:br/>" : "") + (p ? `<w:t xml:space="preserve">${escapeXml(p)}</w:t>` : ""))
        .join("");
      return `<w:r>${rPr}${textXml}</w:r>`;
    })
    .join("");
}

function parseInlineTokens(tokens: any[]): InlineRun[] {
  const runs: InlineRun[] = [];
  const format: InlineFormat = { bold: false, italic: false, code: false };

  for (const token of tokens) {
    switch (token.type) {
      case "strong_open":
        format.bold = true;
        break;
      case "strong_close":
        format.bold = false;
        break;
      case "em_open":
        format.italic = true;
        break;
      case "em_close":
        format.italic = false;
        break;
      case "code_inline":
        runs.push({
          text: token.content,
          format: { ...format, code: true },
        });
        break;
      case "text":
        if (token.content) {
          runs.push({
            text: token.content,
            format: { ...format },
          });
        }
        break;
      case "softbreak":
        runs.push({
          text: " ",
          format: { ...format },
        });
        break;
      case "hardbreak":
        runs.push({
          text: "\n",
          format: { ...format },
        });
        break;
      default:
        if (token.content) {
          runs.push({
            text: token.content,
            format: { ...format },
          });
        }
        break;
    }
  }

  return runs;
}

/**
 * Extracts frontmatter YAML block and markdown body.
 */
export function extractFrontmatterAndBody(source: string): {
  frontmatterYaml: string;
  meta: Record<string, unknown>;
  body: string;
} {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    return { frontmatterYaml: "", meta: {}, body: source };
  }
  const frontmatterYaml = m[1].trim();
  let meta: Record<string, unknown> = {};
  try {
    meta = (yaml.load(frontmatterYaml) ?? {}) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return { frontmatterYaml, meta, body: m[2] };
}

/**
 * Converts Markdown source (with or without frontmatter) into a docx binary buffer.
 */
export function exportToDocx(markdownSource: string, options?: DocxExportOptions): Uint8Array {
  const { frontmatterYaml, meta, body } = extractFrontmatterAndBody(markdownSource);

  const title = String(options?.title || meta.title || meta.subject || "Asiakirja");
  const author = String(options?.author || meta.author || "");
  const dateIso = options?.date || (typeof meta.date === "string" ? meta.date : new Date().toISOString());

  const md = new MarkdownIt({ html: true }).use(markdownItDeflist);
  const tokens = md.parse(body, {});

  const bodyXmlElements: string[] = [];

  let i = 0;
  let currentListType: "bullet" | "ordered" | null = null;
  let listDepth = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "heading_open") {
      const level = parseInt(token.tag.replace(/^h/, ""), 10) || 1;
      const style = level === 1 ? "Heading1" : level === 2 ? "Heading2" : "Heading3";
      i++;
      let headingRuns: InlineRun[] = [];
      if (i < tokens.length && tokens[i].type === "inline") {
        headingRuns = parseInlineTokens(tokens[i].children || []);
        i++;
      }
      if (i < tokens.length && tokens[i].type === "heading_close") {
        i++;
      }
      bodyXmlElements.push(
        `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${renderRunsToXml(headingRuns)}</w:p>`,
      );
      continue;
    }

    if (token.type === "bullet_list_open") {
      currentListType = "bullet";
      listDepth++;
      i++;
      continue;
    }

    if (token.type === "bullet_list_close") {
      listDepth = Math.max(0, listDepth - 1);
      if (listDepth === 0) currentListType = null;
      i++;
      continue;
    }

    if (token.type === "ordered_list_open") {
      currentListType = "ordered";
      listDepth++;
      i++;
      continue;
    }

    if (token.type === "ordered_list_close") {
      listDepth = Math.max(0, listDepth - 1);
      if (listDepth === 0) currentListType = null;
      i++;
      continue;
    }

    if (token.type === "list_item_open") {
      i++;
      // Inside list item, there is typically paragraph_open, inline, paragraph_close
      while (i < tokens.length && tokens[i].type !== "list_item_close") {
        if (tokens[i].type === "paragraph_open") {
          i++;
          if (i < tokens.length && tokens[i].type === "inline") {
            const runs = parseInlineTokens(tokens[i].children || []);
            const numId = currentListType === "ordered" ? 2 : 1;
            const style = currentListType === "ordered" ? "ListNumber" : "ListBullet";
            const ilvl = Math.max(0, listDepth - 1);
            bodyXmlElements.push(
              `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${renderRunsToXml(runs)}</w:p>`,
            );
            i++;
          }
          if (i < tokens.length && tokens[i].type === "paragraph_close") {
            i++;
          }
        } else {
          i++;
        }
      }
      if (i < tokens.length && tokens[i].type === "list_item_close") {
        i++;
      }
      continue;
    }

    if (token.type === "dl_open") {
      i++;
      while (i < tokens.length && tokens[i].type !== "dl_close") {
        let dtText = "";
        let ddRuns: InlineRun[] = [];

        if (tokens[i].type === "dt_open") {
          i++;
          if (i < tokens.length && tokens[i].type === "inline") {
            dtText = tokens[i].content || "";
            i++;
          }
          if (i < tokens.length && tokens[i].type === "dt_close") {
            i++;
          }
        }

        if (i < tokens.length && tokens[i].type === "dd_open") {
          i++;
          while (i < tokens.length && tokens[i].type !== "dd_close") {
            if (tokens[i].type === "paragraph_open") {
              i++;
              if (i < tokens.length && tokens[i].type === "inline") {
                ddRuns = parseInlineTokens(tokens[i].children || []);
                i++;
              }
              if (i < tokens.length && tokens[i].type === "paragraph_close") {
                i++;
              }
            } else if (tokens[i].type === "inline") {
              ddRuns = parseInlineTokens(tokens[i].children || []);
              i++;
            } else {
              i++;
            }
          }
          if (i < tokens.length && tokens[i].type === "dd_close") {
            i++;
          }
        }

        const dtRun = `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(dtText)}: </w:t></w:r>`;
        bodyXmlElements.push(`<w:p>${dtRun}${renderRunsToXml(ddRuns)}</w:p>`);
      }
      if (i < tokens.length && tokens[i].type === "dl_close") {
        i++;
      }
      continue;
    }

    if (token.type === "table_open") {
      i++;
      const tableRowsXml: string[] = [];
      let isHeader = false;

      while (i < tokens.length && tokens[i].type !== "table_close") {
        if (tokens[i].type === "thead_open") {
          isHeader = true;
          i++;
          continue;
        }
        if (tokens[i].type === "thead_close") {
          isHeader = false;
          i++;
          continue;
        }
        if (tokens[i].type === "tbody_open" || tokens[i].type === "tbody_close") {
          i++;
          continue;
        }

        if (tokens[i].type === "tr_open") {
          i++;
          const cellsXml: string[] = [];

          while (i < tokens.length && tokens[i].type !== "tr_close") {
            const cellToken = tokens[i];
            if (cellToken.type === "th_open" || cellToken.type === "td_open") {
              i++;
              let cellRuns: InlineRun[] = [];
              if (i < tokens.length && tokens[i].type === "inline") {
                cellRuns = parseInlineTokens(tokens[i].children || []);
                i++;
              }
              if (i < tokens.length && (tokens[i].type === "th_close" || tokens[i].type === "td_close")) {
                i++;
              }
              cellsXml.push(
                `<w:tc><w:tcPr><w:tcMar><w:top w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tcMar></w:tcPr><w:p>${renderRunsToXml(cellRuns)}</w:p></w:tc>`,
              );
            } else {
              i++;
            }
          }

          if (i < tokens.length && tokens[i].type === "tr_close") {
            i++;
          }

          const trPr = isHeader ? "<w:trPr><w:tblHeader/></w:trPr>" : "";
          tableRowsXml.push(`<w:tr>${trPr}${cellsXml.join("")}</w:tr>`);
          continue;
        }

        i++;
      }

      if (i < tokens.length && tokens[i].type === "table_close") {
        i++;
      }

      bodyXmlElements.push(
        `<w:tbl>` +
          `<w:tblPr>` +
          `<w:tblW w:w="0" w:type="auto"/>` +
          `<w:tblBorders>` +
          `<w:top w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>` +
          `<w:left w:val="none"/>` +
          `<w:bottom w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>` +
          `<w:right w:val="none"/>` +
          `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="E5E5E5"/>` +
          `<w:insideV w:val="none"/>` +
          `</w:tblBorders>` +
          `</w:tblPr>` +
          tableRowsXml.join("") +
          `</w:tbl>`,
      );
      continue;
    }

    if (token.type === "fence" || token.type === "code_block") {
      const codeLines = (token.content || "").replace(/\r?\n$/, "").split("\n");
      for (const line of codeLines) {
        bodyXmlElements.push(
          `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/></w:rPr><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
        );
      }
      i++;
      continue;
    }

    if (token.type === "paragraph_open") {
      i++;
      let runs: InlineRun[] = [];
      let rawText = "";
      if (i < tokens.length && tokens[i].type === "inline") {
        rawText = tokens[i].content || "";
        runs = parseInlineTokens(tokens[i].children || []);
        i++;
      }
      if (i < tokens.length && tokens[i].type === "paragraph_close") {
        i++;
      }

      const trimmed = rawText.trim();

      // Check for forced page breaks (\newpage, \pagebreak, \clearpage, ::: pagebreak)
      if (
        trimmed === "\\newpage" ||
        trimmed === "\\pagebreak" ||
        trimmed === "\\clearpage" ||
        trimmed === "::: pagebreak" ||
        trimmed === "::: newpage" ||
        trimmed === ":::pagebreak:::" ||
        trimmed === ":::newpage:::"
      ) {
        bodyXmlElements.push("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
        continue;
      }

      // Check for handsignature fenced divs (::: handsignature ... :::)
      if (trimmed.startsWith("::: handsignature") || trimmed.startsWith(":::handsignature")) {
        const sigLines = trimmed
          .replace(/^:::+\s*handsignature\s*/i, "")
          .replace(/\s*:::+$/, "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const sigLine of sigLines) {
          bodyXmlElements.push(
            `<w:p><w:pPr><w:pStyle w:val="Handsignature"/><w:spacing w:before="240" w:after="80"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(sigLine)}</w:t></w:r></w:p>`,
          );
        }
        continue;
      }

      // Check for marginlabel fenced divs
      if (trimmed.startsWith("::: marginlabel") || trimmed.startsWith(":::marginlabel")) {
        const mlText = trimmed
          .replace(/^:::+\s*marginlabel\s*/i, "")
          .replace(/\s*:::+$/, "")
          .trim();
        bodyXmlElements.push(
          `<w:p><w:pPr><w:pStyle w:val="Marginlabel"/><w:spacing w:before="120" w:after="80"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(mlText)}</w:t></w:r></w:p>`,
        );
        continue;
      }

      bodyXmlElements.push(`<w:p>${renderRunsToXml(runs)}</w:p>`);
      continue;
    }

    i++;
  }

  // Word requires at least one paragraph
  if (bodyXmlElements.length === 0) {
    bodyXmlElements.push("<w:p/>");
  }

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n` +
    `<w:body>\n` +
    bodyXmlElements.join("\n") +
    `\n<w:sectPr>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>` +
    `</w:sectPr>\n` +
    `</w:body>\n` +
    `</w:document>`;

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    `  <Default Extension="xml" ContentType="application/xml"/>\n` +
    `  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n` +
    `  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>\n` +
    `  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>\n` +
    `  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n` +
    `  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\n` +
    `</Types>`;

  const relsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n` +
    `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n` +
    `  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>\n` +
    `</Relationships>`;

  const documentRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n` +
    `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>\n` +
    `</Relationships>`;

  const numberingXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n` +
    `  <w:abstractNum w:abstractNumId="1">\n` +
    `    <w:multiLevelType w:val="hybridMultilevel"/>\n` +
    `    <w:lvl w:ilvl="0">\n` +
    `      <w:start w:val="1"/>\n` +
    `      <w:numFmt w:val="bullet"/>\n` +
    `      <w:lvlText w:val="•"/>\n` +
    `      <w:lvlJc w:val="left"/>\n` +
    `      <w:pPr>\n` +
    `        <w:ind w:left="720" w:hanging="360"/>\n` +
    `      </w:pPr>\n` +
    `      <w:rPr>\n` +
    `        <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:hint="default"/>\n` +
    `      </w:rPr>\n` +
    `    </w:lvl>\n` +
    `  </w:abstractNum>\n` +
    `  <w:abstractNum w:abstractNumId="2">\n` +
    `    <w:multiLevelType w:val="hybridMultilevel"/>\n` +
    `    <w:lvl w:ilvl="0">\n` +
    `      <w:start w:val="1"/>\n` +
    `      <w:numFmt w:val="decimal"/>\n` +
    `      <w:lvlText w:val="%1."/>\n` +
    `      <w:lvlJc w:val="left"/>\n` +
    `      <w:pPr>\n` +
    `        <w:ind w:left="720" w:hanging="360"/>\n` +
    `      </w:pPr>\n` +
    `    </w:lvl>\n` +
    `  </w:abstractNum>\n` +
    `  <w:num w:numId="1">\n` +
    `    <w:abstractNumId w:val="1"/>\n` +
    `  </w:num>\n` +
    `  <w:num w:numId="2">\n` +
    `    <w:abstractNumId w:val="2"/>\n` +
    `  </w:num>\n` +
    `</w:numbering>`;

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n` +
    `  <w:docDefaults>\n` +
    `    <w:rPrDefault>\n` +
    `      <w:rPr>\n` +
    `        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>\n` +
    `        <w:sz w:val="22"/>\n` +
    `        <w:lang w:val="fi-FI"/>\n` +
    `      </w:rPr>\n` +
    `    </w:rPrDefault>\n` +
    `    <w:pPrDefault>\n` +
    `      <w:pPr>\n` +
    `        <w:spacing w:after="160" w:line="240" w:lineRule="auto"/>\n` +
    `      </w:pPr>\n` +
    `    </w:pPrDefault>\n` +
    `  </w:docDefaults>\n` +
    `  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">\n` +
    `    <w:name w:val="Normal"/>\n` +
    `    <w:qFormat/>\n` +
    `  </w:style>\n` +
    `  <w:style w:type="paragraph" w:styleId="Heading1">\n` +
    `    <w:name w:val="heading 1"/>\n` +
    `    <w:basedOn w:val="Normal"/>\n` +
    `    <w:next w:val="Normal"/>\n` +
    `    <w:qFormat/>\n` +
    `    <w:pPr>\n` +
    `      <w:spacing w:before="360" w:after="120"/>\n` +
    `    </w:pPr>\n` +
    `    <w:rPr>\n` +
    `      <w:b/>\n` +
    `      <w:sz w:val="32"/>\n` +
    `      <w:color w:val="111111"/>\n` +
    `    </w:rPr>\n` +
    `  </w:style>\n` +
    `  <w:style w:type="paragraph" w:styleId="Heading2">\n` +
    `    <w:name w:val="heading 2"/>\n` +
    `    <w:basedOn w:val="Normal"/>\n` +
    `    <w:next w:val="Normal"/>\n` +
    `    <w:qFormat/>\n` +
    `    <w:pPr>\n` +
    `      <w:spacing w:before="240" w:after="80"/>\n` +
    `    </w:pPr>\n` +
    `    <w:rPr>\n` +
    `      <w:b/>\n` +
    `      <w:sz w:val="26"/>\n` +
    `      <w:color w:val="222222"/>\n` +
    `    </w:rPr>\n` +
    `  </w:style>\n` +
    `  <w:style w:type="paragraph" w:styleId="Heading3">\n` +
    `    <w:name w:val="heading 3"/>\n` +
    `    <w:basedOn w:val="Normal"/>\n` +
    `    <w:next w:val="Normal"/>\n` +
    `    <w:qFormat/>\n` +
    `    <w:pPr>\n` +
    `      <w:spacing w:before="160" w:after="60"/>\n` +
    `    </w:pPr>\n` +
    `    <w:rPr>\n` +
    `      <w:b/>\n` +
    `      <w:sz w:val="22"/>\n` +
    `      <w:color w:val="333333"/>\n` +
    `    </w:rPr>\n` +
    `  </w:style>\n` +
    `  <w:style w:type="paragraph" w:styleId="ListBullet">\n` +
    `    <w:name w:val="List Bullet"/>\n` +
    `    <w:basedOn w:val="Normal"/>\n` +
    `    <w:qFormat/>\n` +
    `    <w:pPr>\n` +
    `      <w:numPr>\n` +
    `        <w:ilvl w:val="0"/>\n` +
    `        <w:numId w:val="1"/>\n` +
    `      </w:numPr>\n` +
    `      <w:spacing w:after="60"/>\n` +
    `    </w:pPr>\n` +
    `  </w:style>\n` +
    `  <w:style w:type="paragraph" w:styleId="ListNumber">\n` +
    `    <w:name w:val="List Number"/>\n` +
    `    <w:basedOn w:val="Normal"/>\n` +
    `    <w:qFormat/>\n` +
    `    <w:pPr>\n` +
    `      <w:numPr>\n` +
    `        <w:ilvl w:val="0"/>\n` +
    `        <w:numId w:val="2"/>\n` +
    `      </w:numPr>\n` +
    `      <w:spacing w:after="60"/>\n` +
    `    </w:pPr>\n` +
    `  </w:style>\n` +
    `  <w:style w:type="paragraph" w:styleId="Handsignature">\n` +
    `    <w:name w:val="Handsignature"/>\n` +
    `    <w:basedOn w:val="Normal"/>\n` +
    `    <w:pPr>\n` +
    `      <w:spacing w:before="240" w:after="80"/>\n` +
    `    </w:pPr>\n` +
    `    <w:rPr>\n` +
    `      <w:i/>\n` +
    `    </w:rPr>\n` +
    `  </w:style>\n` +
    `  <w:style w:type="paragraph" w:styleId="Marginlabel">\n` +
    `    <w:name w:val="Marginlabel"/>\n` +
    `    <w:basedOn w:val="Normal"/>\n` +
    `    <w:pPr>\n` +
    `      <w:spacing w:before="120" w:after="80"/>\n` +
    `    </w:pPr>\n` +
    `    <w:rPr>\n` +
    `      <w:b/>\n` +
    `    </w:rPr>\n` +
    `  </w:style>\n` +
    `</w:styles>`;

  const coreXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <dc:title>${escapeXml(title)}</dc:title>\n` +
    `  <dc:creator>${escapeXml(author)}</dc:creator>\n` +
    `  <dc:description>${escapeXml(frontmatterYaml)}</dc:description>\n` +
    `  <dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(dateIso)}</dcterms:created>\n` +
    `  <dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(dateIso)}</dcterms:modified>\n` +
    `</cp:coreProperties>`;

  const appXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">\n` +
    `  <Application>SFS 2487:2024 Web Editor</Application>\n` +
    `</Properties>`;

  const zip = zipSync({
    "[Content_Types].xml": strToU8(contentTypesXml),
    "_rels/.rels": strToU8(relsXml),
    "word/_rels/document.xml.rels": strToU8(documentRelsXml),
    "word/document.xml": strToU8(documentXml),
    "word/numbering.xml": strToU8(numberingXml),
    "word/styles.xml": strToU8(stylesXml),
    "docProps/core.xml": strToU8(coreXml),
    "docProps/app.xml": strToU8(appXml),
  });

  return zip;
}

interface ParsedParagraph {
  text: string;
  isPageBreak: boolean;
  isHeading: number;
  isList: "bullet" | "ordered" | null;
  isHandsignature: boolean;
  isMarginlabel: boolean;
}

function parseNumberingXml(numberingXml: string): Map<string, "bullet" | "ordered"> {
  const map = new Map<string, "bullet" | "ordered">();
  try {
    const doc = parseXml(numberingXml);
    const abstractNums = doc.getElementsByTagNameNS("*", "abstractNum");
    const abstractNumTypes = new Map<string, "bullet" | "ordered">();
    for (let i = 0; i < abstractNums.length; i++) {
      const a = abstractNums[i];
      const aId = a.getAttribute("w:abstractNumId") || a.getAttribute("abstractNumId") || "";
      const numFmt = a.getElementsByTagNameNS("*", "numFmt")[0];
      const val = (numFmt?.getAttribute("w:val") || numFmt?.getAttribute("val") || "").toLowerCase();
      if (val === "bullet") {
        abstractNumTypes.set(aId, "bullet");
      } else {
        abstractNumTypes.set(aId, "ordered");
      }
    }
    const nums = doc.getElementsByTagNameNS("*", "num");
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      const numId = n.getAttribute("w:numId") || n.getAttribute("numId") || "";
      const aRef = n.getElementsByTagNameNS("*", "abstractNumId")[0];
      const aId = aRef?.getAttribute("w:val") || aRef?.getAttribute("val") || "";
      const type = abstractNumTypes.get(aId) || "bullet";
      map.set(numId, type);
    }
  } catch {
    // Ignore XML parsing errors
  }
  return map;
}

/**
 * Parses a paragraph DOM element into markdown text.
 */
function parseParagraphElement(
  p: Element,
  numberingMap?: Map<string, "bullet" | "ordered">,
): ParsedParagraph {
  // Check for page break
  const brElements = p.getElementsByTagNameNS("*", "br");
  for (let b = 0; b < brElements.length; b++) {
    const brType = brElements[b].getAttribute("w:type") || brElements[b].getAttribute("type");
    if (brType === "page") {
      return {
        text: "\\newpage",
        isPageBreak: true,
        isHeading: 0,
        isList: null,
        isHandsignature: false,
        isMarginlabel: false,
      };
    }
  }

  // Check style for heading or list
  let isHeading = 0;
  let isList: "bullet" | "ordered" | null = null;

  const pStyleEl = p.getElementsByTagNameNS("*", "pStyle")[0];
  const styleVal = (pStyleEl?.getAttribute("w:val") || pStyleEl?.getAttribute("val") || "").toLowerCase();

  const isHandsignature = styleVal === "handsignature";
  const isMarginlabel = styleVal === "marginlabel";

  if (styleVal.includes("heading 1") || styleVal === "heading1" || styleVal === "otsikko 1" || styleVal === "otsikko1") {
    isHeading = 1;
  } else if (styleVal.includes("heading 2") || styleVal === "heading2" || styleVal === "otsikko 2" || styleVal === "otsikko2") {
    isHeading = 2;
  } else if (styleVal.includes("heading 3") || styleVal === "heading3" || styleVal === "otsikko 3" || styleVal === "otsikko3") {
    isHeading = 3;
  } else if (styleVal.includes("heading") || styleVal.includes("otsikko")) {
    isHeading = 3;
  }

  const numPrEl = p.getElementsByTagNameNS("*", "numPr")[0];
  if (numPrEl) {
    const numIdEl = numPrEl.getElementsByTagNameNS("*", "numId")[0];
    const numIdVal = numIdEl?.getAttribute("w:val") || numIdEl?.getAttribute("val") || "";
    if (numberingMap?.has(numIdVal)) {
      isList = numberingMap.get(numIdVal)!;
    } else if (numIdVal === "2") {
      isList = "ordered";
    } else {
      isList = "bullet";
    }
  } else if (styleVal.includes("bullet") || styleVal.includes("luettelo")) {
    isList = "bullet";
  } else if (styleVal.includes("number") || styleVal.includes("numero")) {
    isList = "ordered";
  }

  // Parse runs
  let runsMd = "";
  const childNodes = Array.from(p.childNodes);

  for (const node of childNodes) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const localName = el.localName || el.nodeName.split(":").pop();

    if (localName === "r") {
      const rPr = el.getElementsByTagNameNS("*", "rPr")[0];
      const isBold = rPr ? rPr.getElementsByTagNameNS("*", "b").length > 0 : false;
      const isItalic = rPr ? rPr.getElementsByTagNameNS("*", "i").length > 0 : false;
      const isStrike = rPr ? rPr.getElementsByTagNameNS("*", "strike").length > 0 : false;
      const rFonts = rPr?.getElementsByTagNameNS("*", "rFonts")[0];
      const fontName = (rFonts?.getAttribute("w:ascii") || rFonts?.getAttribute("ascii") || "").toLowerCase();
      const isCode = fontName.includes("consolas") || fontName.includes("courier") || fontName.includes("mono");

      let runText = "";
      const rChildren = Array.from(el.childNodes);
      for (const rChild of rChildren) {
        if (rChild.nodeType !== 1) continue;
        const rEl = rChild as Element;
        const rName = rEl.localName || rEl.nodeName.split(":").pop();
        if (rName === "t") {
          runText += rEl.textContent || "";
        } else if (rName === "br") {
          const brType = rEl.getAttribute("w:type") || rEl.getAttribute("type");
          if (brType !== "page") {
            runText += "\\\n";
          }
        }
      }

      if (!runText) continue;

      let formatted = runText;

      if (isCode) {
        formatted = `\`${formatted}\``;
      } else {
        if (isBold && isItalic) {
          formatted = formatInline(formatted, "***");
        } else if (isBold) {
          formatted = formatInline(formatted, "**");
        } else if (isItalic && !isHandsignature) {
          formatted = formatInline(formatted, "*");
        }
        if (isStrike) {
          formatted = formatInline(formatted, "~~");
        }
      }

      runsMd += formatted;
    } else if (localName === "hyperlink") {
      // Inline runs within hyperlink
      let linkText = "";
      const rEls = el.getElementsByTagNameNS("*", "r");
      for (let r = 0; r < rEls.length; r++) {
        const tEls = rEls[r].getElementsByTagNameNS("*", "t");
        for (let t = 0; t < tEls.length; t++) {
          linkText += tEls[t].textContent || "";
        }
      }
      runsMd += linkText;
    }
  }

  return {
    text: runsMd.trim(),
    isPageBreak: false,
    isHeading,
    isList,
    isHandsignature,
    isMarginlabel,
  };
}

function formatInline(str: string, wrapper: string): string {
  const m = str.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return str;
  return `${m[1]}${wrapper}${m[2]}${wrapper}${m[3]}`;
}

/**
 * Parses a table DOM element into markdown GFM table.
 */
function parseTableElement(tbl: Element): string {
  const rows = tbl.getElementsByTagNameNS("*", "tr");
  if (rows.length === 0) return "";

  const tableData: string[][] = [];
  let maxCols = 0;

  for (let r = 0; r < rows.length; r++) {
    const rowEl = rows[r];
    const cells = rowEl.getElementsByTagNameNS("*", "tc");
    const rowData: string[] = [];
    for (let c = 0; c < cells.length; c++) {
      const cellEl = cells[c];
      const pEls = cellEl.getElementsByTagNameNS("*", "p");
      const pTexts: string[] = [];
      for (let p = 0; p < pEls.length; p++) {
        const parsed = parseParagraphElement(pEls[p]);
        if (parsed.text) pTexts.push(parsed.text);
      }
      const cellText = pTexts.join(" ").replace(/\|/g, "\\|").trim();
      rowData.push(cellText);
    }
    maxCols = Math.max(maxCols, rowData.length);
    tableData.push(rowData);
  }

  if (tableData.length === 0 || maxCols === 0) return "";

  // Normalize column count
  for (const row of tableData) {
    while (row.length < maxCols) {
      row.push("");
    }
  }

  const lines: string[] = [];
  // Header row
  lines.push(`| ${tableData[0].join(" | ")} |`);
  lines.push(`| ${Array(maxCols).fill("---").join(" | ")} |`);

  // Data rows
  for (let i = 1; i < tableData.length; i++) {
    lines.push(`| ${tableData[i].join(" | ")} |`);
  }

  return lines.join("\n");
}

/**
 * Converts a docx file (Uint8Array or ArrayBuffer) into a full Markdown document string.
 */
export function importFromDocx(docxBytes: Uint8Array | ArrayBuffer): string {
  const u8 = docxBytes instanceof Uint8Array ? docxBytes : new Uint8Array(docxBytes);
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(u8);
  } catch (err) {
    throw new Error(
      `Ei kelvollinen Word (.docx) -tiedosto: virheellinen tiedostomuoto (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const documentXmlBytes = unzipped["word/document.xml"];
  if (!documentXmlBytes) {
    throw new Error("Ei kelvollinen Word (.docx) -tiedosto: word/document.xml puuttuu.");
  }

  const documentXml = strFromU8(documentXmlBytes);
  const doc = parseXml(documentXml);

  // Extract metadata from docProps/core.xml if present
  let titleFromCore = "";
  let authorFromCore = "";
  let dateFromCore = "";
  let frontmatterFromCore = "";

  const coreXmlBytes = unzipped["docProps/core.xml"];
  if (coreXmlBytes) {
    try {
      const coreXml = strFromU8(coreXmlBytes);
      const coreDoc = parseXml(coreXml);
      titleFromCore = coreDoc.getElementsByTagNameNS("*", "title")[0]?.textContent || "";
      authorFromCore = coreDoc.getElementsByTagNameNS("*", "creator")[0]?.textContent || "";
      frontmatterFromCore = coreDoc.getElementsByTagNameNS("*", "description")[0]?.textContent || "";
      const createdStr = coreDoc.getElementsByTagNameNS("*", "created")[0]?.textContent || "";
      if (createdStr) {
        const d = new Date(createdStr);
        if (!isNaN(d.getTime())) {
          const dd = String(d.getDate()).padStart(2, "0");
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const yyyy = d.getFullYear();
          dateFromCore = `${dd}.${mm}.${yyyy}`;
        }
      }
    } catch {
      // Ignore metadata parsing error
    }
  }

  const numberingXmlBytes = unzipped["word/numbering.xml"];
  const numberingMap = numberingXmlBytes
    ? parseNumberingXml(strFromU8(numberingXmlBytes))
    : new Map<string, "bullet" | "ordered">();

  const bodyEl = doc.getElementsByTagNameNS("*", "body")[0];
  if (!bodyEl) {
    throw new Error("Ei kelvollinen Word (.docx) -tiedosto: body-elementti puuttuu.");
  }

  const bodyLines: string[] = [];
  const children = Array.from(bodyEl.childNodes);

  let orderedCounter = 1;
  let handsignatureBuffer: string[] = [];

  const flushHandsignatures = () => {
    if (handsignatureBuffer.length > 0) {
      bodyLines.push(`::: handsignature\n${handsignatureBuffer.join("\n")}\n:::\n`);
      handsignatureBuffer = [];
    }
  };

  for (const node of children) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const localName = el.localName || el.nodeName.split(":").pop();

    if (localName === "p") {
      const parsed = parseParagraphElement(el, numberingMap);

      if (parsed.isHandsignature) {
        handsignatureBuffer.push(parsed.text);
        continue;
      } else {
        flushHandsignatures();
      }

      if (parsed.isMarginlabel) {
        bodyLines.push(`::: marginlabel\n${parsed.text}\n:::\n`);
        continue;
      }

      if (parsed.isPageBreak) {
        bodyLines.push("\\newpage\n");
        orderedCounter = 1;
        continue;
      }

      if (!parsed.text) {
        // Empty paragraph: acts as vertical space
        orderedCounter = 1;
        continue;
      }

      if (parsed.isHeading > 0) {
        const prefix = "#".repeat(parsed.isHeading);
        bodyLines.push(`${prefix} ${parsed.text}\n`);
        orderedCounter = 1;
        continue;
      }

      if (parsed.isList === "bullet") {
        bodyLines.push(`- ${parsed.text}`);
        orderedCounter = 1;
        continue;
      }

      if (parsed.isList === "ordered") {
        bodyLines.push(`${orderedCounter}. ${parsed.text}`);
        orderedCounter++;
        continue;
      }

      // Check if paragraph is formatted as definition list (starts with bold term and colon)
      const defMatch = parsed.text.match(/^\*\*([^*:]+):\*\*\s*([\s\S]*)$/);
      if (defMatch) {
        const term = defMatch[1].trim();
        const rawDef = defMatch[2].trim();
        const defLines = rawDef
          .split(/\\?\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        const formattedDef = defLines.join("\\\n    ");
        bodyLines.push(`${term}\n:   ${formattedDef}\n`);
        orderedCounter = 1;
        continue;
      }

      bodyLines.push(`${parsed.text}\n`);
      orderedCounter = 1;
    } else if (localName === "tbl") {
      flushHandsignatures();
      const tblMd = parseTableElement(el);
      if (tblMd) {
        bodyLines.push(`${tblMd}\n`);
      }
      orderedCounter = 1;
    }
  }

  flushHandsignatures();

  const bodyContent = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // If core.xml contained the original preserved YAML frontmatter, restore it losslessly!
  if (frontmatterFromCore && frontmatterFromCore.includes("doctype:")) {
    return `---\n${frontmatterFromCore}\n---\n\n${bodyContent}\n`;
  }

  // Otherwise, construct clean, standard SFS 2487 frontmatter
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
  const effectiveTitle = titleFromCore || "Asiakirja";
  const effectiveAuthor = authorFromCore || "Etunimi Sukunimi";
  const effectiveDate = dateFromCore || todayStr;

  const synthesizedFrontmatter =
    `---\n` +
    `doctype: Muistio\n` +
    `title: ${effectiveTitle}\n` +
    `date: ${effectiveDate}\n` +
    `author: ${effectiveAuthor}\n` +
    `features: [no-endmatter-newpage]\n` +
    `---`;

  return `${synthesizedFrontmatter}\n\n${bodyContent}\n`;
}

/**
 * Client-side helper to trigger download of a generated docx file in the browser.
 */
export function downloadDocxFile(docxBytes: Uint8Array, fileName: string): void {
  const blob = new Blob([docxBytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".docx") ? fileName : `${fileName}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
