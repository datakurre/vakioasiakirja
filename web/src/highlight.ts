// Live-edit fading neon yellow highlighter (Architecture D).
//
// Identifies changed or newly added lines between rendered Typst SVGs via
// sequence diffing of immutable content hashes (data-tid), and injects
// authentic marker-effect highlight rects with CSS fade-out animation.

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLineInfo {
  tid: string;
  element: SVGGElement;
  parent: SVGGElement;
  bbox: BBox;
}

export interface HighlightTrackerOptions {
  fadeDurationMs?: number;
  padX?: number;
  padY?: number;
  rx?: number;
  ry?: number;
}

/**
 * Parses scale factors from an SVG transform string (e.g. `scale(0.011,-0.011)` or `scale(16,-16)`).
 */
export function parseScale(transform: string | null): { sx: number; sy: number } {
  if (!transform) return { sx: 1, sy: 1 };
  const m = transform.match(/scale\(\s*([-\d.eE]+)(?:[,\s]+([-\d.eE]+))?\s*\)/);
  if (!m) return { sx: 1, sy: 1 };
  const sx = parseFloat(m[1]);
  const sy = m[2] !== undefined ? parseFloat(m[2]) : sx;
  return { sx, sy };
}

/**
 * Computes the bounding box of a Typst text line in its parent translation group's coordinate system.
 * Uses the inner `<foreignObject>` geometry combined with cumulative `<g>` scale transforms.
 */
export function getBBoxInParent(textNode: SVGGElement): BBox | null {
  const fo = textNode.querySelector("foreignObject");
  if (!fo) return null;

  const rawX = parseFloat(fo.getAttribute("x") || "0");
  const rawY = parseFloat(fo.getAttribute("y") || "0");
  const rawW = parseFloat(fo.getAttribute("width") || "0");
  const rawH = parseFloat(fo.getAttribute("height") || "0");
  if (rawW <= 0 || rawH <= 0) return null;

  let netSx = 1;
  let netSy = 1;

  let curr: Element | null = fo.parentElement;
  while (curr && curr !== textNode.parentElement) {
    const t = curr.getAttribute("transform");
    if (t) {
      const { sx, sy } = parseScale(t);
      netSx *= sx;
      netSy *= sy;
    }
    if (curr === textNode) break;
    curr = curr.parentElement;
  }

  const x1 = rawX * netSx;
  const y1 = rawY * netSy;
  const x2 = (rawX + rawW) * netSx;
  const y2 = (rawY + rawH) * netSy;

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * Aligns lines in `curr` against `prev` using prefix/suffix trimming and LCS DP.
 * Returns a Map from curr index -> matched prev index.
 */
export function alignLines(prev: readonly string[], curr: readonly string[]): Map<number, number> {
  const n = prev.length;
  const m = curr.length;
  const currToPrev = new Map<number, number>();

  if (n === 0 || m === 0) return currToPrev;

  // 1. Trim common prefix
  let prefix = 0;
  while (prefix < n && prefix < m && prev[prefix] === curr[prefix]) {
    currToPrev.set(prefix, prefix);
    prefix++;
  }

  // 2. Trim common suffix
  let suffix = 0;
  while (
    suffix < n - prefix &&
    suffix < m - prefix &&
    prev[n - 1 - suffix] === curr[m - 1 - suffix]
  ) {
    currToPrev.set(m - 1 - suffix, n - 1 - suffix);
    suffix++;
  }

  const prevMidStart = prefix;
  const prevMidEnd = n - suffix;
  const currMidStart = prefix;
  const currMidEnd = m - suffix;

  const midN = prevMidEnd - prevMidStart;
  const midM = currMidEnd - currMidStart;

  if (midN === 0 || midM === 0) return currToPrev;

  // DP matrix on the middle slice
  const dp: number[][] = Array.from({ length: midN + 1 }, () =>
    new Array(midM + 1).fill(0)
  );

  for (let i = 1; i <= midN; i++) {
    const prevItem = prev[prevMidStart + i - 1];
    for (let j = 1; j <= midM; j++) {
      if (prevItem === curr[currMidStart + j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find matched indices in currMid
  let i = midN;
  let j = midM;
  while (i > 0 && j > 0) {
    if (prev[prevMidStart + i - 1] === curr[currMidStart + j - 1]) {
      currToPrev.set(currMidStart + j - 1, prevMidStart + i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return currToPrev;
}

/**
 * Computes the set of indices in `curr` that are newly added or modified
 * (i.e. not part of the longest common subsequence with `prev`).
 * Uses prefix/suffix trimming for speed, followed by LCS DP.
 */
export function diffLines(prev: readonly string[], curr: readonly string[]): Set<number> {
  const alignment = alignLines(prev, curr);
  const addedIndices = new Set<number>();
  for (let j = 0; j < curr.length; j++) {
    if (!alignment.has(j)) {
      addedIndices.add(j);
    }
  }
  return addedIndices;
}

/**
 * Extracts line information from `<g class="typst-text">` nodes inside an SVG element.
 */
export function extractTextLines(root: Element | DocumentFragment): TextLineInfo[] {
  const textNodes = Array.from(root.querySelectorAll<SVGGElement>("g.typst-text"));
  const lines: TextLineInfo[] = [];

  for (const element of textNodes) {
    const tid = element.getAttribute("data-tid") || "";
    const parent = element.parentElement as SVGGElement | null;
    if (!tid || !parent) continue;

    const bbox = getBBoxInParent(element);
    if (!bbox) continue;

    lines.push({ tid, element, parent, bbox });
  }

  return lines;
}

export class HighlightTracker {
  private prevTids: string[] = [];
  private prevTimestamps: (number | undefined)[] = [];
  readonly fadeDurationMs: number;
  readonly padX: number;
  readonly padY: number;
  readonly rx: number;
  readonly ry: number;

  constructor(options?: HighlightTrackerOptions) {
    this.fadeDurationMs = options?.fadeDurationMs ?? 3000;
    this.padX = options?.padX ?? 2;
    this.padY = options?.padY ?? 1;
    this.rx = options?.rx ?? 2;
    this.ry = options?.ry ?? 2;
  }

  reset(): void {
    this.prevTids = [];
    this.prevTimestamps = [];
  }

  getActiveHighlights(): ReadonlyMap<string, number> {
    const active = new Map<string, number>();
    for (let i = 0; i < this.prevTids.length; i++) {
      const ts = this.prevTimestamps[i];
      if (ts !== undefined) {
        active.set(this.prevTids[i], ts);
      }
    }
    return active;
  }

  getPrevTids(): readonly string[] {
    return this.prevTids;
  }

  /**
   * Processes the rendered SVG DOM:
   * - Finds all text lines and their tids.
   * - If not liveEdit (e.g. initial load), stores baseline tids and does not highlight.
   * - If liveEdit, aligns against previous tids to find additions/modifications.
   * - Injects `<rect class="neon-highlight">` in parent `<g>` before each active text line.
   * - Preserves negative animation-delay for recent active highlights across re-renders.
   */
  process(root: Element | DocumentFragment, isLiveEdit = false, now = Date.now()): void {
    // Remove any previous highlight rects
    root.querySelectorAll(".neon-highlight").forEach((el) => el.remove());

    const lines = extractTextLines(root);
    const currTids = lines.map((l) => l.tid);

    if (!isLiveEdit) {
      this.prevTids = currTids;
      this.prevTimestamps = new Array(currTids.length).fill(undefined);
      return;
    }

    const alignment = alignLines(this.prevTids, currTids);
    const currTimestamps: (number | undefined)[] = new Array(currTids.length).fill(undefined);

    for (let j = 0; j < currTids.length; j++) {
      const prevIdx = alignment.get(j);
      if (prevIdx !== undefined) {
        const prevTs = this.prevTimestamps[prevIdx];
        if (prevTs !== undefined && now - prevTs < this.fadeDurationMs) {
          currTimestamps[j] = prevTs;
        }
      } else {
        currTimestamps[j] = now;
      }
    }

    this.prevTids = currTids;
    this.prevTimestamps = currTimestamps;

    // Inject highlight rects for currently active highlights
    const doc = root.ownerDocument ?? (root instanceof Document ? root : document);

    for (let i = 0; i < lines.length; i++) {
      const timestamp = currTimestamps[i];
      if (timestamp === undefined) continue;

      const elapsed = Math.max(0, now - timestamp);
      if (elapsed >= this.fadeDurationMs) continue;

      const line = lines[i];
      const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("class", "neon-highlight");
      rect.setAttribute("x", (line.bbox.x - this.padX).toFixed(2));
      rect.setAttribute("y", (line.bbox.y - this.padY).toFixed(2));
      rect.setAttribute("width", (line.bbox.width + this.padX * 2).toFixed(2));
      rect.setAttribute("height", (line.bbox.height + this.padY * 2).toFixed(2));
      rect.setAttribute("rx", String(this.rx));
      rect.setAttribute("ry", String(this.ry));

      if (elapsed > 0) {
        rect.style.animationDelay = `-${Math.round(elapsed)}ms`;
      }

      line.parent.insertBefore(rect, line.element);
    }
  }
}
