// Markdown (pandoc-flavoured front matter + body) -> Typst, for the SFS
// 2487:2024 template. This is a browser port of pandoc/sfs-2487-2024.lua and
// pandoc/sfs-2487-2024.latex: it maps the same body conventions and front
// matter keys onto the Typst `sfs-document` show rule and helpers.

import MarkdownIt from "markdown-it";
import deflist from "markdown-it-deflist";
import yaml from "js-yaml";
import type Token from "markdown-it/lib/token.mjs";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false }).use(
  deflist,
);

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

function frontmatterToArgs(meta: Record<string, unknown>): string {
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
  // features: [agenda, toc, endmatter-newpage, runin] with a `no-` prefix to
  // disable; runin defaults on (only the `no-runin` opt-out is meaningful).
  const features = parseFeatures(meta);
  for (const f of ["agenda", "toc", "endmatter-newpage", "runin"] as const) {
    args.push(`${f}: ${features[f] ? "true" : "false"}`);
  }
  return args.join(",\n  ");
}

function parseFeatures(meta: Record<string, unknown>): Record<string, boolean> {
  const names = ["agenda", "toc", "endmatter-newpage", "runin"];
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
        `sfs-2487-2024: tuntematon ominaisuus (unknown feature) '${token}' — tuetut (supported): agenda, toc, endmatter-newpage`,
      );
    }
    out[name] = !off;
  }
  if (out["endmatter-newpage"] === undefined) {
    out["endmatter-newpage"] = meta.attachments != null || meta.distribution != null || meta.forinformation != null;
  }
  if (out["runin"] === undefined) out["runin"] = true;
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
      default:
        if (t.children) out += inlines(t.children);
    }
  }
  return out;
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
        const body = inlines(tokens[cur.i + 1].children ?? []);
        out += "=".repeat(level) + " " + body + "\n\n";
        cur.i += 3; // heading_open, inline, heading_close
        continue;
      }
      case "paragraph_open": {
        out += inlines(tokens[cur.i + 1].children ?? []) + "\n\n";
        cur.i += 3;
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
  const tokens = md.parse(markdown, {});
  return blocks(tokens, { i: 0 });
}

export function markdownToTypst(source: string): string {
  const meta = parseFrontmatter(source);
  const args = frontmatterToArgs(meta.frontmatter);
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
