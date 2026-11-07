// CORS and allowed-origins validation for signaling and collab worker.

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "https://datakurre.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://localhost:8787",
];

export function getAllowedOrigins(allowedOriginsVar?: string): Set<string> {
  const allowed = new Set<string>();
  if (allowedOriginsVar && allowedOriginsVar.trim().length > 0) {
    for (const item of allowedOriginsVar.split(/[\s,]+/)) {
      const trimmed = item.trim().replace(/\/+$/, "");
      if (trimmed) {
        allowed.add(trimmed);
      }
    }
  } else {
    for (const item of DEFAULT_ALLOWED_ORIGINS) {
      allowed.add(item.replace(/\/+$/, ""));
    }
  }
  return allowed;
}

export function isAllowedOrigin(origin: string | null, allowedOriginsVar?: string): boolean {
  if (origin === null) {
    return true;
  }
  const allowed = getAllowedOrigins(allowedOriginsVar);
  return allowed.has(origin) || allowed.has(origin.replace(/\/+$/, ""));
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "X-Turn-Status",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
