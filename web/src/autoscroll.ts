import type { EditorView } from "@codemirror/view";
import { SelectionHighlighter } from "./selection-highlighter.ts";
import type { SelectionPayload } from "./share.ts";

export const AUTOSCROLL_STORAGE_KEY = "sfs2487.autoscroll";

export interface AutoscrollTracker {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  toggle(): boolean;
  sync(): void;
  destroy(): void;
}

export interface AutoscrollTrackerOptions {
  buttonEl?: HTMLButtonElement | null;
  previewEl: HTMLElement;
  getEditorView: () => EditorView | undefined;
  storageKey?: string;
  selectionHighlighter?: SelectionHighlighter;
}

export function createAutoscrollTracker(options: AutoscrollTrackerOptions): AutoscrollTracker {
  const {
    buttonEl,
    previewEl,
    getEditorView,
    storageKey = AUTOSCROLL_STORAGE_KEY,
  } = options;

  const highlighter = options.selectionHighlighter ?? new SelectionHighlighter();

  let enabled = true;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) {
      enabled = stored === "1" || stored === "true";
    }
  } catch {
    // Keep default enabled = true
  }

  function updateButton() {
    if (!buttonEl) return;
    buttonEl.setAttribute("aria-pressed", String(enabled));
    buttonEl.title = enabled
      ? "Automaattinen vieritys (päällä)"
      : "Automaattinen vieritys (pois)";
  }

  function setEnabled(val: boolean) {
    enabled = val;
    try {
      localStorage.setItem(storageKey, enabled ? "1" : "0");
    } catch {
      // Quota or disabled: ignore
    }
    updateButton();
    if (enabled) {
      sync();
    }
  }

  function toggle(): boolean {
    setEnabled(!enabled);
    return enabled;
  }

  function sync(): void {
    if (!enabled) return;
    const editor = getEditorView();
    if (!editor) return;

    try {
      const state = editor.state;
      const head = state.selection.main.head;
      const currentLine = state.doc.lineAt(head).number;
      const totalLines = Math.max(1, state.doc.lines);

      const maxScroll = previewEl.scrollHeight - previewEl.clientHeight;
      if (maxScroll <= 0) return;

      const prefersReducedMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const scrollBehavior = prefersReducedMotion ? "auto" : "smooth";

      // 1. Inspect the cursor position: get the current line text, or if empty,
      // scan backward to the nearest non-empty line (heading, list item, paragraph).
      let targetLineNumber = currentLine;
      let lineText = state.doc.line(targetLineNumber).text.trim();
      if (!lineText) {
        for (let l = targetLineNumber - 1; l >= 1; l--) {
          const candidate = state.doc.line(l).text.trim();
          if (candidate) {
            lineText = candidate;
            targetLineNumber = l;
            break;
          }
        }
      }
      if (!lineText) {
        for (let l = targetLineNumber + 1; l <= totalLines; l++) {
          const candidate = state.doc.line(l).text.trim();
          if (candidate) {
            lineText = candidate;
            targetLineNumber = l;
            break;
          }
        }
      }

      let elementMatched = false;

      // 2. Search for the corresponding rendered text element in preview pages
      if (
        lineText &&
        typeof previewEl.querySelectorAll === "function" &&
        typeof previewEl.getBoundingClientRect === "function"
      ) {
        try {
          const visibleLines = highlighter.getVisibleLines(previewEl);
          if (visibleLines.length > 0) {
            const relPos = state.doc.length > 0 ? head / state.doc.length : 0;
            const from = state.doc.line(targetLineNumber).from;
            const to = state.doc.line(targetLineNumber).to;
            const prefix = state.sliceDoc(Math.max(0, from - 80), from);
            const suffix = state.sliceDoc(to, Math.min(state.doc.length, to + 80));

            const payload: SelectionPayload = {
              active: true,
              text: lineText,
              prefix,
              suffix,
              fromLine: targetLineNumber,
              toLine: targetLineNumber,
              relPos,
            };

            const matched = highlighter.matchLines(visibleLines, payload);
            if (matched.length > 0) {
              const targetElement = matched[0].element;
              if (typeof targetElement.getBoundingClientRect === "function") {
                const elRect = targetElement.getBoundingClientRect();
                const previewRect = previewEl.getBoundingClientRect();

                // Ensure element geometry is valid
                if (elRect.height > 0 || elRect.width > 0 || elRect.top > 0) {
                  elementMatched = true;

                  // 3. Avoid jitter if already comfortably visible in the viewport
                  const isComfortablyVisible =
                    elRect.top >= previewRect.top + 40 &&
                    elRect.bottom <= previewRect.bottom - 40;

                  if (!isComfortablyVisible) {
                    const exactOffset = elRect.top - previewRect.top + previewEl.scrollTop;
                    // Align rendered element near upper third of viewport
                    const viewportHeight = previewEl.clientHeight;
                    const desiredScrollTop = exactOffset - viewportHeight * 0.33;
                    const targetScrollTop = Math.max(0, Math.min(maxScroll, Math.round(desiredScrollTop)));

                    if (Math.abs(previewEl.scrollTop - targetScrollTop) >= 3) {
                      previewEl.scrollTo({
                        top: targetScrollTop,
                        behavior: scrollBehavior,
                      });
                    }
                  }
                }
              }
            }
          }
        } catch {
          elementMatched = false;
        }
      }

      // 4. Fallback: If no rendered element matches (e.g. raw frontmatter or empty document),
      // fall back to proportional scroll.
      if (!elementMatched) {
        const ratio = totalLines > 1 ? (currentLine - 1) / (totalLines - 1) : 0;
        const targetScrollTop = Math.round(ratio * maxScroll);
        if (Math.abs(previewEl.scrollTop - targetScrollTop) >= 2) {
          previewEl.scrollTo({
            top: targetScrollTop,
            behavior: scrollBehavior,
          });
        }
      }
    } catch {
      // Safe fallback if editor is not mounted or in a headless test environment
    }
  }

  const onClick = () => {
    toggle();
  };

  buttonEl?.addEventListener("click", onClick);
  updateButton();

  return {
    isEnabled: () => enabled,
    setEnabled,
    toggle,
    sync,
    destroy: () => {
      buttonEl?.removeEventListener("click", onClick);
    },
  };
}
