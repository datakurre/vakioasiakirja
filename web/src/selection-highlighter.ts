import { extractTextLines, getBBoxInParent, type TextLineInfo } from "./highlight.ts";
import type { SelectionPayload } from "./share.ts";

export interface SelectionHighlighterOptions {
  padX?: number;
  padY?: number;
  rx?: number;
  ry?: number;
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

  constructor(options?: SelectionHighlighterOptions) {
    this.padX = options?.padX ?? 2;
    this.padY = options?.padY ?? 1;
    this.rx = options?.rx ?? 2;
    this.ry = options?.ry ?? 2;
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
   */
  getVisibleLines(root: Element): TextLineInfo[] {
    const cards = Array.from(root.querySelectorAll<SVGSVGElement>("svg.page"));
    if (cards.length > 0) {
      const result: TextLineInfo[] = [];
      cards.forEach((card, i) => {
        const typstPages = card.querySelectorAll<SVGGElement>("g.typst-page");
        const target = typstPages[i] ?? card;
        result.push(...extractTextLines(target));
      });
      return result;
    }
    return extractTextLines(root);
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

    // Pre-calculate line text normalization
    const lineData = lines.map((line, idx) => {
      const raw = (line.element.textContent || "").trim();
      const norm = normalize(raw) || normalizeRaw(raw);
      const words = norm ? norm.split(" ").filter(Boolean) : [];
      return { line, idx, raw, norm, words };
    });

    const normPrefix = payload.prefix ? (normalize(payload.prefix) || normalizeRaw(payload.prefix)) : "";
    const prefixWords = normPrefix ? normPrefix.split(" ").filter(Boolean).slice(-4) : [];

    const normSuffix = payload.suffix ? (normalize(payload.suffix) || normalizeRaw(payload.suffix)) : "";
    const suffixWords = normSuffix ? normSuffix.split(" ").filter(Boolean).slice(0, 4) : [];

    let bestScore = -1;
    let bestRange: [number, number] | null = null;

    const N = lineData.length;
    for (let i = 0; i < N; i++) {
      const candNormParts: string[] = [];
      const candWords: string[] = [];

      for (let j = i; j < N; j++) {
        const d = lineData[j];
        if (d.norm) {
          candNormParts.push(d.norm);
          candWords.push(...d.words);
        }

        const candNorm = candNormParts.join(" ");
        if (!candNorm && j > i) continue;

        // Bounded search: stop expanding once candidate exceeds selection length by more than 2x
        if (candNorm.length > normSel.length * 2 + 60 && j > i) {
          break;
        }

        let textScore = 0;
        if (candNorm === normSel) {
          textScore = 100;
        } else if (i === j && candNorm.includes(normSel)) {
          // Substring of a single SVG line
          const ratio = normSel.length / Math.max(1, candNorm.length);
          textScore = 70 + 25 * ratio;
        } else if (normSel.includes(candNorm) && candNorm.length > 0) {
          // Candidate is contained in the selection
          const ratio = candNorm.length / Math.max(1, normSel.length);
          textScore = 60 + 35 * ratio;
        } else {
          // Word sequence and overlap scoring
          let matchedCount = 0;
          let lastFoundIdx = -1;
          let inOrderCount = 0;
          for (const w of selWords) {
            const found = candWords.indexOf(w, lastFoundIdx + 1);
            if (found !== -1) {
              matchedCount++;
              inOrderCount++;
              lastFoundIdx = found;
            } else if (candWords.includes(w)) {
              matchedCount++;
            }
          }
          if (matchedCount > 0) {
            const precision = matchedCount / Math.max(1, candWords.length);
            const recall = matchedCount / Math.max(1, selWords.length);
            const orderRatio = inOrderCount / Math.max(1, selWords.length);
            const f1 = (precision + recall > 0) ? (2 * precision * recall) / (precision + recall) : 0;
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
          const candRelPos = N > 1 ? ((i + j) / 2) / (N - 1) : 0;
          const dist = Math.abs(candRelPos - payload.relPos);
          const posScore = Math.max(0, 1 - dist) * 25;
          totalScore += posScore;
        }

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestRange = [i, j];
        }

        // Early exit if ideal match without ambiguous context
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

    if (!bestRange || bestScore < 20) return [];

    let [start, end] = bestRange;

    // If candidate starts with a list item and preceding line is the bullet glyph, include it
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
