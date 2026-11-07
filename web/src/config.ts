// Backend URL configuration for signaling and collaborative editing.

/**
 * Returns the base URL of the collaborative editing service (with trailing slashes trimmed).
 * Falls back to VITE_SIGNALING_URL if VITE_COLLAB_URL is not set.
 */
export function getCollabUrl(): string {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  const url = env?.VITE_COLLAB_URL || env?.VITE_SIGNALING_URL || "";
  return url.replace(/\/+$/, "");
}

/**
 * Returns the base WebSocket URL for collaborative editing.
 * e.g. "ws://localhost:8787/collab" or "wss://collab.example.com/collab"
 */
export function getCollabWsUrl(): string {
  const base =
    getCollabUrl() ||
    (typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost:8787");
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/collab`;
}

