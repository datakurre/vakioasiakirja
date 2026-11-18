// Entry point / router.
// - Default route (#/ or empty): boots personal editor (src/editor.ts)
// - #/watch/{roomId}: boots read-only live-preview viewer (src/viewer.ts)
// - #/edit/{roomId}/{token} or #/edit/{roomId}?token={token}: boots collaborative editor (src/collab-editor.ts)

import "./style.css";
import { initEditor } from "./editor.ts";
import { initViewer } from "./viewer.ts";
import { initCollabEditor, renderCollabError } from "./collab-editor.ts";
import { parseRoute, isSameRoute, type Route } from "./router.ts";
import { applyBranding } from "./branding.ts";

export { parseRoute, isSameRoute, type Route };

applyBranding();

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

// Register and manage the service worker so an installed (home-screen) app launches
// instantly, works offline, and automatically upgrades on usual page refresh or deployment.
// Only in production builds — in dev it would cache Vite's module graph and mask edits.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register(
        `${import.meta.env.BASE_URL}sw.js`,
        { scope: import.meta.env.BASE_URL },
      );

      // Force an update check on page refresh/load so the browser immediately checks
      // for a newer service worker rather than waiting for 24-hour timeout.
      void reg.update().catch(() => {});

      // Check for updates when tab becomes visible again
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          void reg.update().catch(() => {});
        }
      });

      // Reload page automatically when the new service worker takes control
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });

      // If a worker is already waiting, activate it immediately
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      // If a new worker is found installing, listen for installation completion
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
    } catch {
      /* offline-install is best-effort; the app still works without it */
    }
  });
}
