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
