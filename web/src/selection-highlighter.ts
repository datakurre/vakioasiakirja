import { extractTextLines, getBBoxInParent, type TextLineInfo } from "./highlight.ts";
import type { SelectionPayload } from "./share.ts";

export interface SelectionHighlighterOptions {
  padX?: number;
  padY?: number;
  rx?: number;
  ry?: number;
}

interface NormalizedLineData {
  line: TextLineInfo;
  idx: number;
  raw: string;
  norm: string;
  words: string[];
}

/**
 * Normalizes text for robust markdown-to-SVG matching:
 * - Strips common markdown formatting characters (#, *, _, ~, `, >, [, ], (, ))
 * - Strips list bullets at start of lines
 * - Collapses consecutive whitespace to a single space
 * - Lowercases for case-insensitive matching
 */
export function normalize(str: string): string {
  return str
    .replace(/[#*_~`>[\]()•]/g, " ")
    .replace(/^[-+*]\s+/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Fallback normalization that preserves punctuation while collapsing whitespace.
 */
export function normalizeRaw(str: string): string {
  return str.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * High-performance SVG text selection highlighter for viewers.
 * Matches host Vim visual mode selections to rendered SVG text lines and
 * injects persistent, rounded light-green highlight rectangles.
 */
export class SelectionHighlighter {
  readonly padX: number;
  readonly padY: number;
  readonly rx: number;
  readonly ry: number;

  private cachedRoot: Element | null = null;
  private cachedFirstChild: Element | null = null;
  private cachedLines: TextLineInfo[] | null = null;
  private cachedLineData: NormalizedLineData[] | null = null;

  constructor(options?: SelectionHighlighterOptions) {
    this.padX = options?.padX ?? 2;
    this.padY = options?.padY ?? 1;
    this.rx = options?.rx ?? 2;
    this.ry = options?.ry ?? 2;
  }

  /**
   * Invalidates cached visible lines and normalized line data.
   */
  invalidateCache(): void {
    this.cachedRoot = null;
    this.cachedFirstChild = null;
    this.cachedLines = null;
    this.cachedLineData = null;
  }

  /**
   * Removes all selection highlight rectangles from the given container.
   */
  clear(root: Element): void {
    const highlights = root.querySelectorAll(".selection-highlight");
    for (const el of highlights) {
      el.remove();
    }
  }

  /**
   * Retrieves visible text lines across all pages or from a single SVG root.
   * Caches results and pre-normalized line data until invalidateCache() or root changes.
   */
  getVisibleLines(root: Element): TextLineInfo[] {
    if (
      this.cachedRoot === root &&
      this.cachedFirstChild === root.firstElementChild &&
      this.cachedLines !== null &&
      (this.cachedLines.length === 0 || (this.cachedLines[0].element as any).isConnected !== false)
    ) {
      return this.cachedLines;
    }

    const cards = Array.from(root.querySelectorAll<SVGSVGElement>("svg.page"));
    let result: TextLineInfo[];
    if (cards.length > 0) {
      result = [];
      cards.forEach((card, i) => {
        const typstPages = card.querySelectorAll<SVGGElement>("g.typst-page");
        const target = typstPages.length === 1 ? typstPages[0] : (typstPages[i] ?? card);
        result.push(...extractTextLines(target));
      });
    } else {
      result = extractTextLines(root);
    }

    // Filter out Typst Table of Contents leader dots (. and …) which distort line distribution and cause false matches
    result = result.filter((line) => {
      const t = (line.element.textContent || "").trim();
      return t !== "." && t !== "…" && !/^[.\s]+$/.test(t);
    });

    this.cachedRoot = root;
    this.cachedFirstChild = root.firstElementChild;
    this.cachedLines = result;
    this.cachedLineData = result.map((line, idx) => {
      const raw = (line.element.textContent || "").trim();
      const norm = normalize(raw) || normalizeRaw(raw);
      const words = norm ? norm.split(" ").filter(Boolean) : [];
      return { line, idx, raw, norm, words };
    });

    return result;
  }

  /**
   * Matches the selected text against SVG text lines using normalized matching,
   * prefix/suffix context, and relative document position (relPos) to resolve ambiguity.
   */
  matchLines(lines: TextLineInfo[], payload: SelectionPayload): TextLineInfo[] {
    if (lines.length === 0 || !payload.text) return [];

    const normSel = normalize(payload.text) || normalizeRaw(payload.text);
    if (!normSel) return [];

    const selWords = normSel.split(" ").filter(Boolean);
    if (selWords.length === 0) return [];

    const lineData: NormalizedLineData[] =
      lines === this.cachedLines && this.cachedLineData
        ? this.cachedLineData
        : lines.map((line, idx) => {
            const raw = (line.element.textContent || "").trim();
            const norm = normalize(raw) || normalizeRaw(raw);
            const words = norm ? norm.split(" ").filter(Boolean) : [];
            return { line, idx, raw, norm, words };
          });

    const N = lineData.length;
    if (N === 0) return [];

    const normPrefix = payload.prefix ? normalize(payload.prefix) || normalizeRaw(payload.prefix) : "";
    const prefixWords = normPrefix ? normPrefix.split(" ").filter(Boolean).slice(-4) : [];

    const normSuffix = payload.suffix ? normalize(payload.suffix) || normalizeRaw(payload.suffix) : "";
    const suffixWords = normSuffix ? normSuffix.split(" ").filter(Boolean).slice(0, 4) : [];

    const isMultiLine =
      payload.text.includes("\n") ||
      (payload.fromLine !== undefined && payload.toLine !== undefined && payload.toLine > payload.fromLine);
    const isLargeSelection = selWords.length >= 8 || (isMultiLine && selWords.length >= 4);

    // 1. Fast O(N) Anchor Matching for large or multi-line selections
    if (isLargeSelection) {
      const startK = Math.min(4, Math.max(1, Math.floor(selWords.length / 2)));
      const startAnchorWords = selWords.slice(0, startK);
      const startAnchorStr = startAnchorWords.join(" ");

      const endK = Math.min(4, Math.max(1, Math.floor(selWords.length / 2)));
      const endAnchorWords = selWords.slice(-endK);
      const endAnchorStr = endAnchorWords.join(" ");

      let bestStartIdx = -1;
      let bestStartScore = -1;

      for (let i = 0; i < N; i++) {
        const d = lineData[i];
        if (!d.norm) continue;

        let score = 0;
        if (d.norm.includes(startAnchorStr)) {
          score = 100;
        } else {
          let matches = 0;
          for (const w of startAnchorWords) {
            if (d.words.includes(w)) matches++;
          }
          if (matches > 0) {
            score = (matches / startAnchorWords.length) * 80;
          }
        }

        if (score < 20) continue;

        let total = score;
        if (prefixWords.length > 0 && i > 0) {
          const prev = lineData.slice(Math.max(0, i - 4), i).map((x) => x.norm).join(" ");
          let matchedP = 0;
          for (const pw of prefixWords) {
            if (prev.includes(pw)) matchedP++;
          }
          total += (matchedP / prefixWords.length) * 20;
        }
        if (payload.relPos !== undefined) {
          const rel = N > 1 ? i / (N - 1) : 0;
          total += Math.max(0, 1 - Math.abs(rel - payload.relPos)) * 25;
        }

        if (total > bestStartScore) {
          bestStartScore = total;
          bestStartIdx = i;
        }
      }

      if (bestStartIdx !== -1) {
        let bestEndIdx = -1;
        let bestEndScore = -1;
        const lineSpanEstimate =
          payload.fromLine !== undefined && payload.toLine !== undefined
            ? (payload.toLine - payload.fromLine + 5) * 3
            : 0;
        const maxEndIdx = Math.min(
          N - 1,
          bestStartIdx + Math.max(25, selWords.length * 2, lineSpanEstimate),
        );

        for (let j = bestStartIdx; j <= maxEndIdx; j++) {
          const d = lineData[j];
          if (!d.norm) continue;

          let score = 0;
          if (d.norm.includes(endAnchorStr)) {
            score = 100;
          } else {
            let matches = 0;
            for (const w of endAnchorWords) {
              if (d.words.includes(w)) matches++;
            }
            if (matches > 0) {
              score = (matches / endAnchorWords.length) * 80;
            }
          }

          if (score < 20) continue;

          let total = score;
          if (suffixWords.length > 0 && j < N - 1) {
            const next = lineData.slice(j + 1, Math.min(N, j + 5)).map((x) => x.norm).join(" ");
            let matchedS = 0;
            for (const sw of suffixWords) {
              if (next.includes(sw)) matchedS++;
            }
            total += (matchedS / suffixWords.length) * 20;
          }
          if (payload.relPos !== undefined) {
            const rel = N > 1 ? j / (N - 1) : 0;
            total += Math.max(0, 1 - Math.abs(rel - payload.relPos)) * 25;
          }

          if (total > bestEndScore) {
            bestEndScore = total;
            bestEndIdx = j;
          }
        }

        if (bestEndIdx !== -1 && bestStartScore >= 30 && bestEndScore >= 30) {
          let start = bestStartIdx;
          const end = bestEndIdx;
          if (start > 0) {
            const prev = lineData[start - 1];
            if ((prev.raw === "•" || prev.raw === "-") && /^[-*•]/.test(payload.text.trim())) {
              start = start - 1;
            }
          }
          return lines.slice(start, end + 1);
        }
      }
    }

    // 2. Bounded Window & relPos Search for short selections or fallback
    const maxWindow = Math.max(3, Math.min(10, Math.ceil(selWords.length / 2) + 2));

    const runBoundedSearch = (
      searchStart: number,
      searchEnd: number,
    ): { score: number; range: [number, number] | null } => {
      let localScore = -1;
      let localRange: [number, number] | null = null;

      for (let i = searchStart; i <= searchEnd; i++) {
        const candNormParts: string[] = [];
        const candWords: string[] = [];
        const maxJ = Math.min(N - 1, i + maxWindow);

        for (let j = i; j <= maxJ; j++) {
          const d = lineData[j];
          if (d.norm) {
            candNormParts.push(d.norm);
            candWords.push(...d.words);
          }

          const candNorm = candNormParts.join(" ");
          if (!candNorm && j > i) continue;

          if (candNorm.length > normSel.length * 2 + 60 && j > i) {
            break;
          }

          let textScore = 0;
          if (candNorm === normSel || candNorm.replace(/^\d+(?:\.\d+)*\s+/, "") === normSel) {
            textScore = 100;
          } else if (i === j && candNorm.includes(normSel)) {
            const ratio = normSel.length / Math.max(1, candNorm.length);
            textScore = 70 + 25 * ratio;
          } else if (normSel.includes(candNorm) && candNorm.length >= 3 && /[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]/.test(candNorm)) {
            const ratio = candNorm.length / Math.max(1, normSel.length);
            textScore = 40 + 55 * ratio;
          } else {
            // Linear Set & two-pointer matching (O(W_cand + W_sel))
            const candWordSet = new Set(candWords);
            let matchedCount = 0;
            for (const w of selWords) {
              if (candWordSet.has(w)) matchedCount++;
            }

            if (matchedCount > 0) {
              let inOrderCount = 0;
              let cIdx = 0;
              for (let sIdx = 0; sIdx < selWords.length && cIdx < candWords.length; sIdx++) {
                const target = selWords[sIdx];
                while (cIdx < candWords.length && candWords[cIdx] !== target) {
                  cIdx++;
                }
                if (cIdx < candWords.length) {
                  inOrderCount++;
                  cIdx++;
                }
              }

              const precision = matchedCount / Math.max(1, candWords.length);
              const recall = matchedCount / Math.max(1, selWords.length);
              const orderRatio = inOrderCount / Math.max(1, selWords.length);
              const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
              textScore = f1 * 70 + orderRatio * 15;
            }
          }

          if (textScore < 20) continue;

          let totalScore = textScore;

          // Prefix context bonus
          if (prefixWords.length > 0) {
            const prevSlice = lineData.slice(Math.max(0, i - 4), i).map((x) => x.norm).join(" ");
            let matchedPrefix = 0;
            for (const pw of prefixWords) {
              if (prevSlice.includes(pw)) matchedPrefix++;
            }
            if (i === j && candNorm.includes(normSel)) {
              const before = candNorm.slice(0, candNorm.indexOf(normSel));
              for (const pw of prefixWords) {
                if (before.includes(pw)) matchedPrefix++;
              }
            }
            totalScore += (matchedPrefix / prefixWords.length) * 20;
          }

          // Suffix context bonus
          if (suffixWords.length > 0) {
            const nextSlice = lineData.slice(j + 1, Math.min(N, j + 5)).map((x) => x.norm).join(" ");
            let matchedSuffix = 0;
            for (const sw of suffixWords) {
              if (nextSlice.includes(sw)) matchedSuffix++;
            }
            if (i === j && candNorm.includes(normSel)) {
              const after = candNorm.slice(candNorm.indexOf(normSel) + normSel.length);
              for (const sw of suffixWords) {
                if (after.includes(sw)) matchedSuffix++;
              }
            }
            totalScore += (matchedSuffix / suffixWords.length) * 20;
          }

          // Relative document position (relPos) proximity bonus
          if (payload.relPos !== undefined) {
            const candRelPos = N > 1 ? (i + j) / 2 / (N - 1) : 0;
            const dist = Math.abs(candRelPos - payload.relPos);
            const posScore = Math.max(0, 1 - dist) * 25;
            totalScore += posScore;
          }

          if (totalScore > localScore) {
            localScore = totalScore;
            localRange = [i, j];
          }

          if (
            textScore === 100 &&
            !prefixWords.length &&
            !suffixWords.length &&
            payload.relPos === undefined
          ) {
            break;
          }
        }
      }
      return { score: localScore, range: localRange };
    };

    let bestScore = -1;
    let bestRange: [number, number] | null = null;

    if (payload.relPos !== undefined && N > 50) {
      const center = Math.round(payload.relPos * (N - 1));
      const iMin = Math.max(0, center - 30);
      const iMax = Math.min(N - 1, center + 30);
      const res = runBoundedSearch(iMin, iMax);
      bestScore = res.score;
      bestRange = res.range;
      if (!bestRange || bestScore < 20) {
        const fallback = runBoundedSearch(0, N - 1);
        bestScore = fallback.score;
        bestRange = fallback.range;
      }
    } else {
      const res = runBoundedSearch(0, N - 1);
      bestScore = res.score;
      bestRange = res.range;
    }

    if (!bestRange || bestScore < 20) return [];

    let [start, end] = bestRange;
    if (start > 0) {
      const prev = lineData[start - 1];
      if ((prev.raw === "•" || prev.raw === "-") && /^[-*•]/.test(payload.text.trim())) {
        start = start - 1;
      }
    }

    return lines.slice(start, end + 1);
  }

  /**
   * Updates selection highlights on the given root container based on the selection payload(s).
   */
  update(root: Element, payload: SelectionPayload | SelectionPayload[] | null): void {
    if (!payload) {
      this.clear(root);
      return;
    }

    const payloads = (Array.isArray(payload) ? payload : [payload]).filter(
      (p) => Boolean(p && p.active && p.text && p.text.trim()),
    );

    if (payloads.length === 0) {
      this.clear(root);
      return;
    }

    this.clear(root);

    const lines = this.getVisibleLines(root);
    if (lines.length === 0) return;

    const doc = root.ownerDocument ?? (root instanceof Document ? root : document);

    for (const p of payloads) {
      const matched = this.matchLines(lines, p);
      if (matched.length === 0) continue;

      for (const line of matched) {
        // Re-verify bounding box in parent coordinates if needed
        const bbox = line.bbox ?? getBBoxInParent(line.element);
        if (!bbox) continue;

        const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("class", "selection-highlight");
        rect.setAttribute("x", (bbox.x - this.padX).toFixed(2));
        rect.setAttribute("y", (bbox.y - this.padY).toFixed(2));
        rect.setAttribute("width", (bbox.width + this.padX * 2).toFixed(2));
        rect.setAttribute("height", (bbox.height + this.padY * 2).toFixed(2));
        rect.setAttribute("rx", String(this.rx));
        rect.setAttribute("ry", String(this.ry));

        line.parent.insertBefore(rect, line.element);
      }
    }
  }
}
