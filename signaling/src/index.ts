// Worker entry: route room WebSockets to per-room Durable Objects, and serve
// ICE configuration (STUN, plus Cloudflare TURN when configured by secrets).

import type { Room } from "./room.ts";
import type { CollabRoom } from "./collab-room.ts";
import {
  DEFAULT_ALLOWED_ORIGINS,
  getAllowedOrigins as getOrigins,
  isAllowedOrigin as checkOrigin,
  corsHeaders,
} from "./cors.ts";

export { Room } from "./room.ts";
export { CollabRoom } from "./collab-room.ts";
export { DEFAULT_ALLOWED_ORIGINS, corsHeaders };

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  COLLAB_ROOMS: DurableObjectNamespace<CollabRoom>;
  COLLAB_ENABLED?: string;
  // Optional Cloudflare Realtime TURN credentials (set via `wrangler secret`).
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  // Optional comma- or whitespace-separated list of additional allowed origins.
  ALLOWED_ORIGINS?: string;
}

// Minimal ICE-server shape (the DOM RTCIceServer type is unavailable in the
// Workers runtime); the browser consumes it as an RTCIceServer.
interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const DEFAULT_STUN_SERVERS: IceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

export function getAllowedOrigins(env: Env): Set<string> {
  return getOrigins(env.ALLOWED_ORIGINS);
}

export function isAllowedOrigin(origin: string | null, env: Env): boolean {
  return checkOrigin(origin, env.ALLOWED_ORIGINS);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin, env)) {
        return new Response("Forbidden origin", { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/turn-credentials") {
      if (!isAllowedOrigin(origin, env)) {
        return new Response("Forbidden origin", { status: 403 });
      }
      if (request.method !== "GET") {
        const headers: Record<string, string> = {
          Allow: "GET, OPTIONS",
          Vary: "Origin",
        };
        if (origin) {
          headers["Access-Control-Allow-Origin"] = origin;
        }
        return new Response("Method not allowed", {
          status: 405,
          headers,
        });
      }
      return turnCredentials(env, origin);
    }

    // Collab room creation: POST /collab/create
    if (url.pathname === "/collab/create") {
      if (!isAllowedOrigin(origin, env)) {
        return new Response("Forbidden origin", { status: 403 });
      }
      if (env.COLLAB_ENABLED === "false") {
        return jsonErrorResponse(
          "Collaboration service is currently disabled (COLLAB_ENABLED=false)",
          503,
          origin,
        );
      }
      if (request.method !== "POST") {
        const headers: Record<string, string> = {
          Allow: "POST, OPTIONS",
          Vary: "Origin",
        };
        if (origin) {
          headers["Access-Control-Allow-Origin"] = origin;
        }
        return new Response("Method not allowed", { status: 405, headers });
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return jsonErrorResponse("Invalid JSON body", 400, origin);
      }

      if (!isRecord(payload)) {
        return jsonErrorResponse("Body must be an object", 400, origin);
      }

      const { roomId, token, initialMarkdown } = payload;
      if (
        typeof roomId !== "string" ||
        !/^[A-Za-z0-9]{4,16}$/.test(roomId) ||
        roomId.toUpperCase() === "CREATE"
      ) {
        return jsonErrorResponse(
          "roomId must be alphanumeric (4-16 characters)",
          400,
          origin,
        );
      }
      if (typeof token !== "string" || token.length < 16) {
        return jsonErrorResponse(
          "token must be a string with at least 16 characters",
          400,
          origin,
        );
      }
      if (initialMarkdown !== undefined && typeof initialMarkdown !== "string") {
        return jsonErrorResponse("initialMarkdown must be a string", 400, origin);
      }
      const initialText = typeof initialMarkdown === "string" ? initialMarkdown : "";
      if (new TextEncoder().encode(initialText).byteLength > 512 * 1024) {
        return jsonErrorResponse("initialMarkdown exceeds 512 KB limit", 400, origin);
      }

      const id = env.COLLAB_ROOMS.idFromName(roomId.toUpperCase());
      const doRequest = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({
          roomId,
          token,
          initialMarkdown: initialText,
        }),
      });
      const response = await env.COLLAB_ROOMS.get(id).fetch(doRequest);
      return ensureCors(response, origin);
    }

    // Collab WebSocket upgrade: GET /collab/:roomId
    const collabMatch = url.pathname.match(/^\/collab\/([A-Za-z0-9]{4,16})$/);
    if (collabMatch) {
      if (!isAllowedOrigin(origin, env)) {
        return new Response("Forbidden origin", { status: 403 });
      }
      if (env.COLLAB_ENABLED === "false") {
        return jsonErrorResponse(
          "Collaboration service is currently disabled (COLLAB_ENABLED=false)",
          503,
          origin,
        );
      }
      const id = env.COLLAB_ROOMS.idFromName(collabMatch[1].toUpperCase());
      return env.COLLAB_ROOMS.get(id).fetch(request);
    }

    const room = url.pathname.match(/^\/room\/([A-Za-z0-9]{4,12})$/);
    if (room) {
      if (!isAllowedOrigin(origin, env)) {
        return new Response("Forbidden origin", { status: 403 });
      }
      const id = env.ROOMS.idFromName(room[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function jsonErrorResponse(
  error: string,
  status: number,
  origin: string | null,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return new Response(JSON.stringify({ error }), { status, headers });
}

function ensureCors(response: Response, origin: string | null): Response {
  if (origin && !response.headers.has("Access-Control-Allow-Origin")) {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}

function isBlockedPort(url: string): boolean {
  // Browsers block port 53 for security reasons (DNS port), which causes WebRTC allocation timeouts.
  return /:53(?:\?|$)/.test(url);
}

function filterBlockedPorts(server: IceServer): IceServer | null {
  if (Array.isArray(server.urls)) {
    const urls = server.urls.filter((u) => !isBlockedPort(u));
    if (urls.length === 0) return null;
    return { ...server, urls };
  } else if (typeof server.urls === "string") {
    if (isBlockedPort(server.urls)) return null;
    return server;
  }
  return server;
}

async function turnCredentials(
  env: Env,
  origin: string | null,
): Promise<Response> {
  const iceServers: IceServer[] = [...DEFAULT_STUN_SERVERS];
  let turnSuccess = false;
  let turnStatus = "missing-secrets";

  if (!env.TURN_KEY_ID && !env.TURN_API_TOKEN) {
    turnStatus = "missing-secrets";
  } else if (!env.TURN_KEY_ID) {
    turnStatus = "missing-key-id";
  } else if (!env.TURN_API_TOKEN) {
    turnStatus = "missing-api-token";
  } else {
    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.TURN_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ttl: 86400 }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as { iceServers?: IceServer[] };
        if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          const filtered: IceServer[] = [];
          for (const s of data.iceServers) {
            const cleaned = filterBlockedPorts(s);
            if (cleaned) filtered.push(cleaned);
          }
          if (filtered.length > 0) {
            iceServers.push(...filtered);
            turnSuccess = true;
            turnStatus = "success";
          } else {
            turnStatus = "cf-all-ports-filtered";
            console.warn("Cloudflare TURN response: all returned servers had blocked ports");
          }
        } else {
          turnStatus = "cf-empty-credentials";
          console.warn("Cloudflare TURN response did not contain an iceServers array or was empty", data);
        }
      } else {
        turnStatus = `cf-error-${res.status}`;
        const errorText = await res.text().catch(() => "");
        console.error(
          `Cloudflare TURN credential request failed (${res.status} ${res.statusText}):`,
          errorText,
        );
      }
    } catch (error) {
      turnStatus = "cf-fetch-error";
      console.error("Cloudflare TURN credential request threw an error:", error);
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": turnSuccess ? "public, max-age=3600" : "no-store",
    "X-Turn-Status": turnStatus,
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return new Response(JSON.stringify({ iceServers }), {
    headers,
  });
}
