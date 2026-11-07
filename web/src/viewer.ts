// Read-only viewer for a shared live preview (route #/watch/{roomId}). It hides
// the editor chrome, connects to the room as a viewer (src/share.ts), and feeds
// each received snapshot through the same typst.ts preview core (src/preview.ts)
// the editor uses. Viewers never send document data — they only render.

import { createPreview, type Logo } from "./preview.ts";
import { createToaster, base64ToBytes } from "./ui.ts";
import { Viewer, type Snapshot, type SelectionPayload } from "./share.ts";
import { SelectionHighlighter } from "./selection-highlighter.ts";

export function initViewer(roomId: string) {
  document.body.classList.add("viewer");
  document.body.classList.remove("show-editor");
  document.body.classList.add("show-preview");

  const statusEl = document.getElementById("status")!;
  const bannerEl = document.getElementById("viewer-banner")!;
  const toastsEl = document.getElementById("toasts")!;
  const pagesEl = document.getElementById("pages")!;

  const toast = createToaster(toastsEl);
  const setStatus = (text: string, error = false) => {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", error);
  };
  const fail = (message: string) => {
    setStatus("virhe", true);
    toast(message);
  };

  const banner = (text: string) => {
    bannerEl.hidden = false;
    bannerEl.textContent = text;
  };

  const selectionHighlighter = new SelectionHighlighter();
  let currentSelection: SelectionPayload | null = null;

  const preview = createPreview(
    {
      previewEl: document.getElementById("preview")!,
      pagesEl,
      controlsEl: document.getElementById("preview-controls")!,
      zoomInEl: document.getElementById("zoom-in") as HTMLButtonElement,
      zoomOutEl: document.getElementById("zoom-out") as HTMLButtonElement,
      fitWidthEl: document.getElementById("fit-width") as HTMLButtonElement,
      fitHeightEl: document.getElementById("fit-height") as HTMLButtonElement,
      twoUpEl: document.getElementById("two-up") as HTMLButtonElement,
      zoomLevelEl: document.getElementById("zoom-level")!,
    },
    { setStatus, fail },
  );

  let hasReceivedFirstSnapshot = false;
  const applySnapshot = async (s: Snapshot) => {
    const logo: Logo | undefined = s.logo
      ? { path: s.logo.path, bytes: base64ToBytes(s.logo.b64) }
      : undefined;
    const isLiveEdit = hasReceivedFirstSnapshot;
    hasReceivedFirstSnapshot = true;
    await preview.render(s.markdown, logo, { liveEdit: isLiveEdit });
    if (currentSelection?.active) {
      selectionHighlighter.update(pagesEl, currentSelection);
    }
  };

  banner("Yhdistetään jaettuun esikatseluun…");
  const viewer = new Viewer(
    roomId,
    applySnapshot,
    (state) => {
      switch (state) {
        case "connecting":
          banner("Yhdistetään jaettuun esikatseluun…");
          break;
        case "live":
          banner("Katselet jaettua esikatselua");
          break;
        case "reconnecting":
          banner("Yhteys katkesi – yhdistetään uudelleen…");
          break;
        case "ended":
          banner("Lähetys päättyi.");
          break;
      }
    },
    fail,
    (payload) => {
      currentSelection = payload;
      selectionHighlighter.update(pagesEl, payload);
    },
  );
  void viewer.start();
}
