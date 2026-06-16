// Entry point / router. The default route boots the full editor; the
// #/watch/{roomId} route boots the read-only live-preview viewer. The two share
// the typst.ts preview core (src/preview.ts) but otherwise load independently.

import "./style.css";
import { initEditor } from "./editor.ts";
import { initViewer } from "./viewer.ts";

// #/watch/{roomId} — roomId is 6–8 chars from the share.ts alphabet.
const watch = location.hash.match(/^#\/watch\/([A-Z0-9]{4,12})/i);
if (watch) {
  initViewer(watch[1].toUpperCase());
} else {
  initEditor();
}

// Register the service worker so an installed (home-screen) app launches
// instantly and works offline. Only in production builds — in dev it would cache
// Vite's module graph and mask edits.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        /* offline-install is best-effort; the app still works without it */
      });
  });
}
