// Entry point / router.
// - Default route (#/ or empty): boots personal editor (src/editor.ts)
// - #/watch/{roomId}: boots read-only live-preview viewer (src/viewer.ts)
// - #/edit/{roomId}/{token} or #/edit/{roomId}?token={token}: boots collaborative editor (src/collab-editor.ts)

import "./style.css";
import { initEditor } from "./editor.ts";
import { initViewer } from "./viewer.ts";
import { initCollabEditor, renderCollabError } from "./collab-editor.ts";
import { parseRoute, isSameRoute, type Route } from "./router.ts";

export { parseRoute, isSameRoute, type Route };

let currentRoute: Route | null = null;

function handleRoute() {
  const route = parseRoute(location.hash);
  if (currentRoute !== null && !isSameRoute(currentRoute, route)) {
    window.location.reload();
    return;
  }
  currentRoute = route;
  switch (route.type) {
    case "viewer":
      initViewer(route.roomId);
      break;
    case "collab":
      initCollabEditor(route.roomId, route.token);
      break;
    case "collab-error":
      renderCollabError(route.message);
      break;
    case "personal":
    default:
      initEditor();
      break;
  }
}

handleRoute();

window.addEventListener("hashchange", () => {
  const nextRoute = parseRoute(location.hash);
  if (!isSameRoute(currentRoute, nextRoute)) {
    window.location.reload();
  }
});

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
