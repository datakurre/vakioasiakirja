import type { EditorView } from "@codemirror/view";
import { SelectionHighlighter } from "./selection-highlighter.ts";
import type { SelectionPayload } from "./share.ts";

export const AUTOSCROLL_STORAGE_KEY = "sfs2487.autoscroll";
export const AUTOSCROLL_DEADBAND = 60; // px margin from top and bottom
export const AUTOSCROLL_MIN_DELTA = 10; // px threshold to avoid micro-oscillation
export const AUTOSCROLL_EDIT_DEBOUNCE_MS = 350; // ms cooldown for active typing
export const AUTOSCROLL_LEAD_RATIO = 0.5; // fraction of viewport height to scroll ahead when revealing content

export type AutoscrollSource = "selection" | "edit" | "render";

export interface AutoscrollTracker {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  toggle(): boolean;
  sync(source?: AutoscrollSource): void;
  scheduleSync(source?: AutoscrollSource): void;
  destroy(): void;
}

export interface AutoscrollTrackerOptions {
  buttonEl?: HTMLButtonElement | null;
  previewEl: HTMLElement;
  getEditorView: () => EditorView | undefined;
  storageKey?: string;
  selectionHighlighter?: SelectionHighlighter;
  debounceMs?: number;
  deadband?: number;
  minDelta?: number;
  leadRatio?: number;
}

export function createAutoscrollTracker(options: AutoscrollTrackerOptions): AutoscrollTracker {
  const {
    buttonEl,
    previewEl,
    getEditorView,
    storageKey = AUTOSCROLL_STORAGE_KEY,
    debounceMs = AUTOSCROLL_EDIT_DEBOUNCE_MS,
    deadband: configuredDeadband = AUTOSCROLL_DEADBAND,
    minDelta = AUTOSCROLL_MIN_DELTA,
    leadRatio = AUTOSCROLL_LEAD_RATIO,
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

  let isEditing = false;
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let syncRafId: number | null = null;

  function updateButton() {
    if (!buttonEl) return;
    buttonEl.setAttribute("aria-pressed", String(enabled));
    buttonEl.title = enabled
      ? "Automaattinen vieritys (päällä)"
      : "Automaattinen vieritys (pois)";
  }

  function clearTimers() {
    if (syncRafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(syncRafId);
      syncRafId = null;
    }
    if (editTimer !== null) {
      clearTimeout(editTimer);
      editTimer = null;
    }
    isEditing = false;
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
      sync("render");
    } else {
      clearTimers();
    }
  }

  function toggle(): boolean {
    setEnabled(!enabled);
    return enabled;
  }

  function sync(source: AutoscrollSource = "selection"): void {
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

      const scrollBehavior: ScrollBehavior = "auto";

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

      let windowedFrom = state.doc.line(targetLineNumber).from;
      let windowedTo = state.doc.line(targetLineNumber).to;

      // For long paragraphs, window around cursor head to avoid searching massive strings
      if (lineText.length > 200) {
        const lineObj = state.doc.line(targetLineNumber);
        const offset = Math.max(0, Math.min(lineObj.length, head - lineObj.from));
        const start = Math.max(0, offset - 60);
        const end = Math.min(lineObj.length, offset + 60);
        lineText = lineObj.text.slice(start, end).trim();
        windowedFrom = lineObj.from + start;
        windowedTo = lineObj.from + end;
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
            const prefix = state.sliceDoc(Math.max(0, windowedFrom - 80), windowedFrom);
            const suffix = state.sliceDoc(windowedTo, Math.min(state.doc.length, windowedTo + 80));

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

                  // 3. Hysteresis, Deadband & Minimal Displacement with Lead Margin
                  // Safe zone margins prevent unnecessary scrolling while cursor is within viewport.
                  const effectiveDeadband = Math.min(
                    configuredDeadband,
                    Math.max(0, Math.floor(previewEl.clientHeight / 4))
                  );
                  const safeTop = previewRect.top + effectiveDeadband;
                  const safeBottom = previewRect.bottom - effectiveDeadband;
                  const fitsInSafeZone = elRect.height <= (safeBottom - safeTop);
                  const leadDistance = Math.round(previewEl.clientHeight * leadRatio);

                  let targetScrollTop: number | null = null;

                  if (fitsInSafeZone) {
                    const isComfortablyVisible =
                      elRect.top >= safeTop &&
                      elRect.bottom <= safeBottom;

                    if (!isComfortablyVisible) {
                      if (elRect.bottom > safeBottom) {
                        const overflow = elRect.bottom - safeBottom;
                        if (overflow >= minDelta) {
                          // Below bottom safe zone: scroll down to bring element into safe area plus lead distance
                          // so the edited region is revealed around mid-page rather than trapped at the bottom quarter.
                          const delta = overflow + leadDistance;
                          targetScrollTop = Math.max(0, Math.min(maxScroll, Math.round(previewEl.scrollTop + delta)));
                        }
                      } else if (elRect.top < safeTop) {
                        const overflow = safeTop - elRect.top;
                        if (overflow >= minDelta) {
                          // Above top safe zone: scroll up to bring element into upper safe area plus lead distance
                          const delta = -(overflow + leadDistance);
                          targetScrollTop = Math.max(0, Math.min(maxScroll, Math.round(previewEl.scrollTop + delta)));
                        }
                      }
                    }
                  } else {
                    // Element taller than safe area: align top of element with safeTop
                    const isComfortablyVisible =
                      elRect.top >= safeTop &&
                      elRect.top <= safeBottom;

                    if (!isComfortablyVisible) {
                      const delta = elRect.top - safeTop;
                      targetScrollTop = Math.max(0, Math.min(maxScroll, Math.round(previewEl.scrollTop + delta)));
                    }
                  }

                  if (
                    targetScrollTop !== null &&
                    Math.abs(previewEl.scrollTop - targetScrollTop) >= minDelta
                  ) {
                    try {
                      previewEl.scrollTo({
                        top: targetScrollTop,
                        behavior: scrollBehavior,
                      });
                    } catch {
                      previewEl.scrollTop = targetScrollTop;
                    }
                    if (Math.abs(previewEl.scrollTop - targetScrollTop) >= minDelta) {
                      previewEl.scrollTop = targetScrollTop;
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
      // fall back to proportional scroll, BUT SUPPRESS during active editing when element matching
      // temporarily fails due to unrendered typed text.
      const isCurrentlyEditing = isEditing || source === "edit";
      if (!elementMatched && !isCurrentlyEditing) {
        const ratio = totalLines > 1 ? (currentLine - 1) / (totalLines - 1) : 0;
        const targetScrollTop = Math.round(ratio * maxScroll);
        if (Math.abs(previewEl.scrollTop - targetScrollTop) >= minDelta) {
          try {
            previewEl.scrollTo({
              top: targetScrollTop,
              behavior: scrollBehavior,
            });
          } catch {
            previewEl.scrollTop = targetScrollTop;
          }
          if (Math.abs(previewEl.scrollTop - targetScrollTop) >= minDelta) {
            previewEl.scrollTop = targetScrollTop;
          }
        }
      }
    } catch {
      // Safe fallback if editor is not mounted or in a headless test environment
    }
  }

  function scheduleSync(source: AutoscrollSource = "selection"): void {
    if (!enabled) return;

    if (source === "edit") {
      isEditing = true;
      if (syncRafId !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(syncRafId);
        syncRafId = null;
      }
      if (editTimer !== null) {
        clearTimeout(editTimer);
      }
      editTimer = setTimeout(() => {
        editTimer = null;
        isEditing = false;
        sync("edit");
      }, debounceMs);
      return;
    }

    if (source === "render") {
      if (editTimer !== null) {
        clearTimeout(editTimer);
        editTimer = null;
      }
      isEditing = false;
      if (typeof requestAnimationFrame === "undefined") {
        sync("render");
        return;
      }
      if (syncRafId !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(syncRafId);
      }
      let executed = false;
      const doSync = () => {
        if (executed) return;
        executed = true;
        syncRafId = null;
        sync("render");
      };
      syncRafId = requestAnimationFrame(doSync);
      // Fallback for background tabs or headless environments where rAF is throttled/paused
      setTimeout(doSync, 50);
      return;
    }

    // source === "selection" (cursor navigation without edits)
    if (editTimer !== null) {
      clearTimeout(editTimer);
      editTimer = null;
    }
    isEditing = false;

    if (typeof requestAnimationFrame === "undefined") {
      sync("selection");
      return;
    }
    if (syncRafId !== null) return;
    let executed = false;
    const doSync = () => {
      if (executed) return;
      executed = true;
      syncRafId = null;
      sync("selection");
    };
    syncRafId = requestAnimationFrame(doSync);
    // Fallback for background tabs or headless environments where rAF is throttled/paused
    setTimeout(doSync, 50);
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
    scheduleSync,
    destroy: () => {
      clearTimers();
      buttonEl?.removeEventListener("click", onClick);
    },
  };
}
