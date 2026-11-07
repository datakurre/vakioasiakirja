// SPA hash router definitions and parsing.

export type Route =
  | { type: "personal" }
  | { type: "viewer"; roomId: string }
  | { type: "collab"; roomId: string; token: string }
  | { type: "collab-error"; message: string };

/**
 * Parses location.hash into a typed Route.
 *
 * Supported formats:
 * - Default: "" or "#" or "#/" -> personal editor
 * - Live preview viewer: "#/watch/:roomId"
 * - Collaborative editor: "#/edit/:roomId/:token" or "#/edit/:roomId?token=:token"
 * - Malformed collaborative URLs: "#/edit/..." with missing token or invalid room -> collab-error
 */
export function parseRoute(hash: string): Route {
  if (!hash || hash === "#" || hash === "#/") {
    return { type: "personal" };
  }

  // #/watch/{roomId} — roomId is 4–16 chars alphanumeric
  const watchMatch = hash.match(/^#\/watch\/([A-Za-z0-9]{4,16})\/?$/i);
  if (watchMatch) {
    return { type: "viewer", roomId: watchMatch[1].toUpperCase() };
  }

  if (hash === "#/edit" || hash === "#/edit/") {
    return {
      type: "collab-error",
      message: "Yhteismuokkauslinkistä puuttuu huonetunniste ja valtuutusavain.",
    };
  }

  if (hash.startsWith("#/edit/")) {
    const afterEdit = hash.slice("#/edit/".length);
    const qIndex = afterEdit.indexOf("?");
    const path = qIndex >= 0 ? afterEdit.slice(0, qIndex) : afterEdit;
    const query = qIndex >= 0 ? afterEdit.slice(qIndex + 1) : "";

    const segments = path
      .split("/")
      .map((s) => decodeURIComponent(s))
      .filter((s) => s.length > 0);
    const params = new URLSearchParams(query);

    const roomId = segments[0] || "";
    // Token can come from query param ?token=... or second path segment /:roomId/:token
    const token = params.get("token") || (segments.length > 1 ? segments[1] : "");

    // Validate roomId: alphanumeric, underscore, hyphen
    if (!roomId || !/^[A-Za-z0-9_-]{3,32}$/.test(roomId)) {
      return {
        type: "collab-error",
        message: "Virheellinen huonetunniste yhteismuokkauslinkissä.",
      };
    }

    // Validate token: non-empty
    if (!token || token.trim().length === 0) {
      return {
        type: "collab-error",
        message: "Yhteismuokkauslinkistä puuttuu valtuutusavain (token).",
      };
    }

    return {
      type: "collab",
      roomId,
      token: token.trim(),
    };
  }

  if (hash.startsWith("#/edit")) {
    return {
      type: "collab-error",
      message: "Virheellinen yhteismuokkauslinkki.",
    };
  }

  return { type: "personal" };
}

export function isSameRoute(a: Route | null | undefined, b: Route | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === "viewer" && b.type === "viewer") return a.roomId === b.roomId;
  if (a.type === "collab" && b.type === "collab") return a.roomId === b.roomId && a.token === b.token;
  if (a.type === "collab-error" && b.type === "collab-error") return a.message === b.message;
  return true;
}
