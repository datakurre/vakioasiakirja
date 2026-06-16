// Markdown (pandoc-flavoured front matter + body) -> Typst, for the SFS
// 2487:2024 template. This is a browser port of pandoc/sfs-2487-2024.lua and
// pandoc/sfs-2487-2024.latex: it maps the same body conventions and front
// matter keys onto the Typst `sfs-document` show rule and helpers.

import MarkdownIt from "markdown-it";
import deflist from "markdown-it-deflist";
import footnote from "markdown-it-footnote";
import yaml from "js-yaml";
import type Token from "markdown-it/lib/token.mjs";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false })
  .use(deflist)
  .use(footnote);

// The footnote plugin stores each note's content in the parse env, keyed by id;
// the active env is set in body() so inlines() can resolve a footnote_ref to its
// content at the reference site (cls/pandoc render footnotes as real \footnote).
let footnoteEnv: { footnotes?: { list?: Record<number, { tokens?: Token[] }> } } = {};

// A table caption written pandoc-style on its own line (": Otsikko" or
// "Table: Otsikko") just before a table; consumed by the next table.
let pendingCaption: string | null = null;

// Front matter keys that carry one or more lines (YAML scalar or list); the
// template joins list items with line breaks.
const LIST_FIELDS = ["recipient", "extrametadata", "attachments", "distribution", "forinformation"];

export class ConversionError extends Error {}

// Escape a run of literal text so Typst markup characters render verbatim.
function esc(text: string): string {
  return text.replace(/[\\#$*_`<>@~\[\]]/g, (c) => "\\" + c);
}

// A Typst string literal (for function arguments).
function str(text: string): string {
  return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// Render a content block ([...]) holding already-escaped Typst markup.
function content(typst: string): string {
  return "[" + typst + "]";
}

// Options that come from the editor shell rather than the document source.
export interface ConvertOptions {
  // VFS path of an uploaded logo image (mapped into typst.ts via mapShadow).
  // The frontmatter `logo:` key is a filesystem path the browser cannot read,
  // so the logo is driven by the upload control instead.
  logoPath?: string;
}

function frontmatterToArgs(meta: Record<string, unknown>, opts: ConvertOptions): string {
  for (const field of ["doctype", "title"]) {
    if (meta[field] == null) {
      throw new ConversionError(
        `sfs-2487-2024: pakollinen metatieto '${field}' puuttuu (required frontmatter field is missing)`,
      );
    }
  }
  const args: string[] = [];
  const scalar = (k: string) => {
    if (meta[k] != null) args.push(`${k}: ${str(String(meta[k]))}`);
  };
  for (const k of ["doctype", "title", "date", "author", "subject", "docid", "confidentiality"]) {
    scalar(k);
  }
  // The logo is an uploaded image in the shadow filesystem, not a frontmatter
  // path (the browser cannot read the path the `logo:` key would hold).
  if (opts.logoPath != null) args.push(`logo: image(${str(opts.logoPath)})`);
  // Multi-line fields: join YAML list (or scalar) with Typst line breaks.
  for (const k of LIST_FIELDS) {
    const v = meta[k];
    if (v == null) continue;
    const lines = Array.isArray(v) ? v.map(String) : [String(v)];
    args.push(`${k}: ${content(lines.map(esc).join(" \\ "))}`);
  }
  // contact: { name, lines: [...] }
  if (meta.contact != null) {
    const c = meta.contact as Record<string, unknown>;
    const lines = Array.isArray(c.lines) ? c.lines.map(String) : c.lines ? [String(c.lines)] : [];
    args.push(`contact: (name: ${str(String(c.name ?? ""))}, lines: ${content(lines.map(esc).join(" \\ "))})`);
  }
  if (meta.keywords != null) {
    const kw = Array.isArray(meta.keywords) ? meta.keywords.map(String) : [String(meta.keywords)];
    args.push(`keywords: (${kw.map(str).join(", ")})`);
  }
  // Class options.
  if (meta.font != null) args.push(`font: ${str(String(meta.font))}`);
  if (meta.fontsize != null) args.push(`fontsize: ${String(meta.fontsize).replace(/pt$/, "")}pt`);
  // features: [agenda, toc, endmatter-newpage, runin, gap] with a `no-` prefix
  // to disable; runin and gap default on (only the `no-runin` / `no-gap`
  // opt-outs are meaningful — no-gap switches to the compact run-on style).
  const features = parseFeatures(meta);
  for (const f of ["agenda", "toc", "endmatter-newpage", "runin", "gap"] as const) {
    args.push(`${f}: ${features[f] ? "true" : "false"}`);
  }
  return args.join(",\n  ");
}

function parseFeatures(meta: Record<string, unknown>): Record<string, boolean> {
  const names = ["agenda", "toc", "endmatter-newpage", "runin", "gap"];
  for (const n of names) {
    if (meta[n] != null) {
      throw new ConversionError(
        `sfs-2487-2024: metatieto '${n}:' on korvattu features-luettelolla (top-level key replaced by the features list): features: [${n}] tai (or) features: [no-${n}]`,
      );
    }
  }
  const out: Record<string, boolean> = {};
  let list: string[] = [];
  if (meta.features != null) list = Array.isArray(meta.features) ? meta.features.map(String) : [String(meta.features)];
  for (const token of list) {
    const off = token.startsWith("no-");
    const name = off ? token.slice(3) : token;
    if (!names.includes(name)) {
      throw new ConversionError(
        `sfs-2487-2024: tuntematon ominaisuus (unknown feature) '${token}' — tuetut (supported): agenda, toc, endmatter-newpage, runin, gap`,
      );
    }
    out[name] = !off;
  }
  if (out["endmatter-newpage"] === undefined) {
    out["endmatter-newpage"] = meta.attachments != null || meta.distribution != null || meta.forinformation != null;
  }
  if (out["runin"] === undefined) out["runin"] = true;
  if (out["gap"] === undefined) out["gap"] = true;
  return out;
}

// ---- body conversion (markdown-it token stream -> Typst) ----

// Convert inline tokens (markdown-it "inline" children) to Typst markup.
function inlines(tokens: Token[]): string {
  let out = "";
  for (const t of tokens) {
    switch (t.type) {
      case "text":
        out += esc(t.content);
        break;
      case "softbreak":
        out += " ";
        break;
      case "hardbreak":
        out += " \\\n";
        break;
      case "strong_open":
      case "strong_close":
        out += "*";
        break;
      case "em_open":
      case "em_close":
        out += "_";
        break;
      case "code_inline":
        out += "`" + t.content + "`";
        break;
      case "link_open": {
        const href = t.attrGet("href") ?? "";
        // Email autolinks render as the address; the .esignatures handler
        // reads the raw mailto: target separately.
        out += `#link(${str(href)})[`;
        break;
      }
      case "link_close":
        out += "]";
        break;
      case "image": {
        const src = t.attrGet("src") ?? "";
        out += `#image(${str(src)})`;
        break;
      }
      case "footnote_ref": {
        const id = (t.meta as { id?: number } | undefined)?.id;
        const note = id != null ? footnoteEnv.footnotes?.list?.[id] : undefined;
        out += `#footnote[${note ? renderNote(note.tokens ?? []) : ""}]`;
        break;
      }
      default:
        if (t.children) out += inlines(t.children);
    }
  }
  return out;
}

// Render a footnote's stored content: a reference note ([^id]: …) carries block
// tokens, an inline note (^[…]) a single "inline" token.
function renderNote(tokens: Token[]): string {
  const blockLevel = tokens.some((t) => t.type.endsWith("_open") && t.block);
  return (blockLevel ? blocks(tokens, { i: 0 }) : inlines(tokens)).trim();
}

interface Cursor {
  i: number;
}

function blocks(tokens: Token[], cur: Cursor, stop?: string): string {
  let out = "";
  while (cur.i < tokens.length) {
    const t = tokens[cur.i];
    if (stop && t.type === stop) break;
    switch (t.type) {
      case "heading_open": {
        const level = Number(t.tag.slice(1));
        if (level > 3) {
          throw new ConversionError(
            "sfs-2487-2024: SFS 2487:2024 suosittaa enintään kolmea otsikkotasoa (at most three heading levels)",
          );
        }
        const inline = tokens[cur.i + 1];
        let body = inlines(inline.children ?? []);
        // Pandoc heading attributes ({-}, {.unnumbered}, {#id}) suppress the
        // section number, like \section* in the class; strip the block and
        // emit an unnumbered heading.
        const attr = (inline.content ?? "").match(/\s*\{([^}]*)\}\s*$/);
        const tokensOf = attr ? attr[1].split(/\s+/).filter(Boolean) : [];
        const isAttrBlock = tokensOf.length > 0 && tokensOf.every((a) => /^[.#-]|=/.test(a));
        if (isAttrBlock) {
          body = body.replace(/\s*\{[^}]*\}\s*$/, "");
          const unnumbered = tokensOf.includes("-") || tokensOf.includes(".unnumbered");
          out += unnumbered
            ? `#heading(level: ${level}, numbering: none)[${body}]\n\n`
            : "=".repeat(level) + " " + body + "\n\n";
        } else {
          out += "=".repeat(level) + " " + body + "\n\n";
        }
        cur.i += 3; // heading_open, inline, heading_close
        continue;
      }
      case "paragraph_open": {
        const children = tokens[cur.i + 1].children ?? [];
        // A paragraph holding only an image becomes a captioned figure
        // (pandoc implicit_figures, 6.5.2), the alt text its caption.
        const imgs = children.filter((c) => c.type !== "softbreak");
        if (imgs.length === 1 && imgs[0].type === "image") {
          const img = imgs[0];
          const src = img.attrGet("src") ?? "";
          const caption = inlines(img.children ?? []) || esc(img.content ?? "");
          out += `#figure(image(${str(src)}), caption: [${caption}], kind: image)\n\n`;
          cur.i += 3;
          continue;
        }
        // A pandoc table caption line (": Otsikko" / "Table: Otsikko") is held
        // back for the table that follows; if none follows it is plain text.
        const text = inlines(children);
        const cap = text.match(/^(?:Table:|:)\s+([\s\S]+)$/);
        if (cap && nextBlockIsTable(tokens, cur.i + 3)) {
          pendingCaption = cap[1].trim();
          cur.i += 3;
          continue;
        }
        out += text + "\n\n";
        cur.i += 3;
        continue;
      }
      case "table_open": {
        out += table(tokens, cur);
        continue;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        out += list(tokens, cur, t.type === "bullet_list_open" ? "bullet_list_close" : "ordered_list_close");
        continue;
      }
      case "dl_open": {
        out += definitionList(tokens, cur);
        continue;
      }
      case "blockquote_open": {
        cur.i++;
        out += blocks(tokens, cur, "blockquote_close");
        cur.i++;
        continue;
      }
      default:
        cur.i++;
    }
  }
  return out;
}

function list(tokens: Token[], cur: Cursor, close: string): string {
  const ordered = close === "ordered_list_close";
  const items: string[] = [];
  cur.i++; // list_open
  while (cur.i < tokens.length && tokens[cur.i].type !== close) {
    if (tokens[cur.i].type === "list_item_open") {
      cur.i++;
      items.push(blocks(tokens, cur, "list_item_close").trim());
      cur.i++; // list_item_close
    } else cur.i++;
  }
  cur.i++; // list_close
  const marker = ordered ? "+ " : "- ";
  return items.map((it) => marker + it.replace(/\n/g, "\n  ")).join("\n") + "\n\n";
}

// True if the next meaningful block token (from index j) opens a table.
function nextBlockIsTable(tokens: Token[], j: number): boolean {
  while (j < tokens.length) {
    const ty = tokens[j].type;
    if (ty === "table_open") return true;
    if (ty.endsWith("_open") || ty === "hr" || ty === "fence" || ty === "code_block") return false;
    j++;
  }
  return false;
}

// Pipe table -> a left-aligned #table with booktabs-style horizontal rules,
// wrapped in #figure when a caption is pending so it is numbered "Taulukko N"
// with the caption above (cls captionof[table], 6.5.1). Column alignment comes
// from the delimiter row (markdown-it sets text-align on the header cells).
function table(tokens: Token[], cur: Cursor): string {
  const aligns: string[] = [];
  const header: string[] = [];
  const rows: string[][] = [];
  let inHeader = false;
  let row: string[] | null = null;
  cur.i++; // table_open
  while (cur.i < tokens.length && tokens[cur.i].type !== "table_close") {
    const t = tokens[cur.i];
    switch (t.type) {
      case "thead_open":
        inHeader = true;
        break;
      case "thead_close":
        inHeader = false;
        break;
      case "tr_open":
        row = [];
        break;
      case "tr_close":
        if (row) {
          if (inHeader) header.push(...row);
          else rows.push(row);
        }
        row = null;
        break;
      case "th_open":
      case "td_open": {
        const style = t.attrGet("style") ?? "";
        if (inHeader) aligns.push(style.includes("right") ? "right" : style.includes("center") ? "center" : "left");
        const cell = inlines(tokens[cur.i + 1].children ?? []).trim();
        row?.push(`[${cell}]`);
        cur.i += 2; // td_open, inline (td_close consumed by loop ++)
        break;
      }
    }
    cur.i++;
  }
  cur.i++; // table_close

  const cols = aligns.length || (rows[0]?.length ?? 1);
  const alignTuple = `(${aligns.join(", ")})`;
  let tbl = `table(\n  columns: ${cols},\n  align: ${alignTuple},\n  stroke: none,\n`;
  tbl += "  table.hline(),\n";
  if (header.length) tbl += `  table.header(${header.join(", ")}),\n  table.hline(),\n`;
  for (const r of rows) tbl += "  " + r.join(", ") + ",\n";
  tbl += "  table.hline(),\n)";

  const caption = pendingCaption;
  pendingCaption = null;
  if (caption) return `#figure(\n  ${tbl},\n  caption: [${caption}],\n  kind: table,\n)\n\n`;
  return "#" + tbl + "\n\n";
}

// Definition list -> #marginlabel(term)[definition] (cls: term at the 20 mm
// margin, content at the 43 mm body column, run into the term's line when the
// term fits the heading column). The term and its definition(s) are passed as
// one call so the template can run them onto a single line.
function definitionList(tokens: Token[], cur: Cursor): string {
  let out = "";
  cur.i++; // dl_open
  while (cur.i < tokens.length && tokens[cur.i].type !== "dl_close") {
    if (tokens[cur.i].type === "dt_open") {
      const term = inlines(tokens[cur.i + 1].children ?? []);
      cur.i += 3; // dt_open, inline, dt_close
      let def = "";
      while (cur.i < tokens.length && tokens[cur.i].type === "dd_open") {
        cur.i++; // dd_open
        def += blocks(tokens, cur, "dd_close");
        cur.i++; // dd_close
      }
      out += `#marginlabel([${term}])[${def.trim()}]\n\n`;
    } else cur.i++;
  }
  cur.i++; // dl_close
  return out;
}

// ---- pandoc fenced divs (::: name ... :::) ----
// markdown-it does not parse these, so pull them out of the source first and
// convert each to the matching Typst helper, mirroring the Lua filter.

interface Segment {
  kind: "markdown" | "div";
  text: string;
  name?: string;
  label?: string;
}

function segmentDivs(body: string): Segment[] {
  const lines = body.split("\n");
  const segs: Segment[] = [];
  let buf: string[] = [];
  let i = 0;
  const flush = () => {
    if (buf.length) segs.push({ kind: "markdown", text: buf.join("\n") });
    buf = [];
  };
  while (i < lines.length) {
    const open = lines[i].match(/^:::+\s*(.*)$/);
    if (open) {
      flush();
      const header = open[1].trim();
      const inner: string[] = [];
      i++;
      while (i < lines.length && !/^:::+\s*$/.test(lines[i])) inner.push(lines[i++]);
      i++; // closing fence
      const attr = header.match(/^\{\.([\w-]+)(?:\s+label="([^"]*)")?\s*\}$/);
      const name = attr ? attr[1] : header.split(/\s+/)[0].replace(/^\./, "");
      segs.push({ kind: "div", name, label: attr?.[2], text: inner.join("\n") });
    } else {
      buf.push(lines[i++]);
    }
  }
  flush();
  return segs;
}

function esignaturesDiv(inner: string): string {
  const tokens = md.parse(inner, {});
  // Each "inline" token directly inside a list item is one signee, "Name <email>".
  const signees: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "list_item_open") depth++;
    else if (t.type === "list_item_close") depth--;
    else if (t.type === "inline" && depth > 0) {
      let email: string | undefined;
      const nameTokens: Token[] = [];
      let inLink = false;
      for (const c of t.children ?? []) {
        if (c.type === "link_open" && (c.attrGet("href") ?? "").startsWith("mailto:")) {
          email = (c.attrGet("href") ?? "").replace(/^mailto:/, "");
          inLink = true;
        } else if (c.type === "link_close") {
          inLink = false;
        } else if (!inLink && email === undefined) {
          nameTokens.push(c);
        }
      }
      if (email === undefined) {
        throw new ConversionError(
          "sfs-2487-2024: esignatures-allekirjoittajalta puuttuu sähköpostiosoite <user@example.com> (signee is missing an email autolink)",
        );
      }
      const name = inlines(nameTokens).replace(/[\s,]+$/, "");
      signees.push(`(${str(name)}, ${str(email)})`);
    }
  }
  if (!signees.length) {
    throw new ConversionError(
      "sfs-2487-2024: esignatures-lohkossa pitää olla luettelo allekirjoittajista (needs a bullet list of signees)",
    );
  }
  return `#esignatures(\n  "Tämä asiakirja on sähköisesti allekirjoitettu.",\n  ${signees.join(",\n  ")},\n)\n\n`;
}

function handsignatureDiv(inner: string): string {
  // Each non-blank source line becomes one printed signature line.
  const out = inner
    .split("\n")
    .map((l) => l.replace(/\\\s*$/, "").trim())
    .filter((l) => l.length)
    .map((l) => `#handsignature[${esc(l)}]`)
    .join("\n");
  return out + "\n\n";
}

function marginlabelDiv(seg: Segment): string {
  if (!seg.label) {
    throw new ConversionError(
      'sfs-2487-2024: marginlabel-lohkosta puuttuu label="…" (div is missing the label attribute)',
    );
  }
  return `#marginlabel([${esc(seg.label)}])[${body(seg.text).trim()}]\n\n`;
}

function body(markdown: string): string {
  const env = {};
  const tokens = md.parse(markdown, env);
  const prev = footnoteEnv;
  footnoteEnv = env;
  try {
    return blocks(tokens, { i: 0 });
  } finally {
    footnoteEnv = prev;
  }
}

export function markdownToTypst(source: string, opts: ConvertOptions = {}): string {
  const meta = parseFrontmatter(source);
  const args = frontmatterToArgs(meta.frontmatter, opts);
  const segs = segmentDivs(meta.body);
  let out = "";
  for (const seg of segs) {
    if (seg.kind === "markdown") out += body(seg.text);
    else if (seg.name === "esignatures") out += esignaturesDiv(seg.text);
    else if (seg.name === "handsignature") out += handsignatureDiv(seg.text);
    else if (seg.name === "marginlabel") out += marginlabelDiv(seg);
    else out += body(seg.text); // unknown div: pass content through
  }
  return `#import "/sfs-2487-2024.typ": *\n#show: sfs-document.with(\n  ${args},\n)\n\n${out}`;
}

function parseFrontmatter(source: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) {
    throw new ConversionError(
      "sfs-2487-2024: YAML-metatiedot puuttuvat (document is missing the --- front matter block)",
    );
  }
  const frontmatter = (yaml.load(m[1]) ?? {}) as Record<string, unknown>;
  return { frontmatter, body: m[2] };
}
