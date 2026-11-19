// Incremental page-card reconciliation for the typst.ts SVG preview.
//
// typst.ts returns one SVG with every page stacked in a single coordinate
// space. The preview shows each page as its own cropped <svg class="page">
// "card", wrapped in a <div class="page-wrap"> (the wrapper hosts the
// compositor-friendly modification pulse, see style.css).
//
// Rebuilding every card on every keystroke-driven render is the dominant cost
// of a live edit: N deep clones of the whole document SVG, a style recalc and
// layout of every glyph node, and a full repaint. Instead, each page is keyed
// by a cheap signature (typst.ts' content hash `data-tid` on `g.typst-page`,
// plus its geometry) and only pages whose signature changed get a new card;
// unchanged cards stay mounted untouched (no re-parse of their subtree, no
// style/layout/paint invalidation, running animations keep running).

export interface PageCardEntry {
  sig: string;
  wrap: HTMLElement;
  card: SVGSVGElement;
  w: number;
  h: number;
}

export interface ReconcileResult {
  entries: PageCardEntry[];
  // Indices of entries whose card was (re)built in this pass.
  rebuilt: number[];
}

export const SHARED_STYLE_ATTR = "data-typst-shared-style";

/**
 * Moves typst.ts' embedded `<style>` blocks out of the SVG into a single shared
 * `<style>` in the document head. The rules are document-global anyway (an SVG
 * <style> applies to the whole document); cloning them into every page card
 * multiplied the stylesheet count and every card swap added/removed sheets,
 * which forces a style recalc of the entire document.
 */
export function hoistSvgStyles(baseSvg: Element, doc: Document): void {
  const styles = Array.from(baseSvg.children).filter((c) => c.tagName.toLowerCase() === "style");
  if (styles.length === 0) return;
  const css = styles.map((s) => s.textContent ?? "").join("\n");
  for (const s of styles) s.remove();
  if (!css.trim()) return;
  const parent = doc.head ?? doc.documentElement;
  let shared = parent.querySelector(`style[${SHARED_STYLE_ATTR}]`);
  if (!shared) {
    shared = doc.createElement("style");
    shared.setAttribute(SHARED_STYLE_ATTR, "");
    parent.appendChild(shared);
  }
  if (shared.textContent !== css) shared.textContent = css;
}

/** Page offset, natural size and signature of one `g.typst-page`. */
export function pageGeometry(page: Element): { y: number; w: number; h: number } {
  const t = (page.getAttribute("transform") ?? "").match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)/);
  return {
    y: t ? parseFloat(t[2]) : 0,
    w: parseFloat(page.getAttribute("data-page-width") ?? "0"),
    h: parseFloat(page.getAttribute("data-page-height") ?? "0"),
  };
}

/**
 * A cheap identity for a page's rendered content. typst.ts stamps every page
 * group with a content hash (`data-tid`); combined with the page transform and
 * size it identifies the page without serializing thousands of glyph nodes.
 * Falls back to the serialized markup when no hash is present.
 */
export function pageSignature(page: Element): string {
  const tid = page.getAttribute("data-tid");
  const geo = `${page.getAttribute("transform") ?? ""}|${page.getAttribute("data-page-width") ?? ""}x${page.getAttribute("data-page-height") ?? ""}`;
  return tid ? `${tid}|${geo}` : `${geo}|${page.innerHTML}`;
}

/**
 * Builds one page card: a shallow copy of the document SVG root, copies of the
 * shared (non-page) children such as glyph `<defs>`, and the page group itself
 * (moved, not cloned — the parsed document SVG is discarded afterwards).
 */
export function buildPageCard(
  baseSvg: SVGSVGElement,
  shared: readonly Element[],
  page: Element,
  doc: Document,
): { wrap: HTMLElement; card: SVGSVGElement; w: number; h: number } {
  const { y, w, h } = pageGeometry(page);
  const card = baseSvg.cloneNode(false) as SVGSVGElement;
  for (const child of shared) card.appendChild(child.cloneNode(true));
  card.appendChild(page);
  card.setAttribute("viewBox", `0 ${y} ${w} ${h}`);
  card.setAttribute("preserveAspectRatio", "xMidYMid meet");
  card.style.overflow = "hidden";
  card.removeAttribute("data-width");
  card.removeAttribute("data-height");
  card.classList.add("page", "preview-page");
  const wrap = doc.createElement("div");
  wrap.className = "page-wrap";
  wrap.appendChild(card);
  return { wrap, card, w, h };
}

/**
 * Reconciles the page cards in `container` against a freshly parsed document
 * SVG. Pages whose signature matches the previous entry at the same index are
 * kept mounted as-is; the rest are rebuilt and swapped in place.
 *
 * `modified[i]` marks pages that should pulse (only applied to rebuilt cards).
 */
export function reconcilePageCards(
  container: Element,
  baseSvg: SVGSVGElement,
  pages: readonly Element[],
  prev: readonly PageCardEntry[],
  modified: readonly boolean[] = [],
): ReconcileResult {
  const doc = container.ownerDocument;
  const pageSet = new Set<Element>(pages);
  const shared = Array.from(baseSvg.children).filter((c) => !pageSet.has(c));

  const entries: PageCardEntry[] = [];
  const rebuilt: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const sig = pageSignature(page);
    const old = prev[i];
    if (old && old.sig === sig && old.wrap.parentNode === container) {
      entries.push(old);
      continue;
    }
    const built = buildPageCard(baseSvg, shared, page, doc);
    if (modified[i]) {
      built.wrap.classList.add("page-pulse", "page-modified");
      built.card.classList.add("page-pulse", "page-modified");
    }
    entries.push({ sig, ...built });
    rebuilt.push(i);
  }

  // Apply to the live DOM with minimal mutations: reused wrappers stay at their
  // index and are never moved (moving would restyle them and restart their
  // animations); stale children are replaced in place; extras are dropped.
  const keep = new Set<Element>(entries.map((e) => e.wrap));
  for (let i = 0; i < entries.length; i++) {
    const want = entries[i].wrap;
    const at = container.children[i] ?? null;
    if (at === want) continue;
    if (at && !keep.has(at)) at.replaceWith(want);
    else container.insertBefore(want, at);
  }
  while (container.children.length > entries.length) {
    container.lastElementChild!.remove();
  }

  return { entries, rebuilt };
}
