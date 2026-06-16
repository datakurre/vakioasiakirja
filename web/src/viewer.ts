// Read-only viewer for a shared live preview (route #/watch/{roomId}). It hides
// the editor chrome, connects to the room as a viewer (src/share.ts), and feeds
// each received snapshot through the same typst.ts preview core (src/preview.ts)
// the editor uses. Viewers never send document data — they only render.

import { createPreview, type Logo } from "./preview.ts";
import { createToaster, base64ToBytes } from "./ui.ts";
import { Viewer, type Snapshot } from "./share.ts";

export function initViewer(roomId: string) {
  document.body.classList.add("viewer");
  document.body.classList.remove("show-editor");
  document.body.classList.add("show-preview");

  const statusEl = document.getElementById("status")!;
  const bannerEl = document.getElementById("viewer-banner")!;
  const toastsEl = document.getElementById("toasts")!;

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

  const preview = createPreview(
    {
      previewEl: document.getElementById("preview")!,
      pagesEl: document.getElementById("pages")!,
      zoomInEl: document.getElementById("zoom-in") as HTMLButtonElement,
      zoomOutEl: document.getElementById("zoom-out") as HTMLButtonElement,
      fitWidthEl: document.getElementById("fit-width") as HTMLButtonElement,
      fitHeightEl: document.getElementById("fit-height") as HTMLButtonElement,
      twoUpEl: document.getElementById("two-up") as HTMLButtonElement,
      zoomLevelEl: document.getElementById("zoom-level")!,
    },
    { setStatus, fail },
  );

  const applySnapshot = (s: Snapshot) => {
    const logo: Logo | undefined = s.logo
      ? { path: s.logo.path, bytes: base64ToBytes(s.logo.b64) }
      : undefined;
    void preview.render(s.markdown, logo);
  };

  banner("Yhdistetään jaettuun esikatseluun…");
  const viewer = new Viewer(roomId, applySnapshot, (state) => {
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
  });
  void viewer.start();
}
