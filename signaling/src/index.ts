// Worker entry: route room WebSockets to per-room Durable Objects, and serve
// ICE configuration (STUN, plus Cloudflare TURN when configured by secrets).

import type { Room } from "./room.ts";

export { Room } from "./room.ts";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  // Optional Cloudflare Realtime TURN credentials (set via `wrangler secret`).
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
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

// Allow the GitHub Pages SPA (any origin) to read the JSON; no credentials are
// involved, so a wildcard is fine.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Turn-Status",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/turn-credentials") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: {
            Allow: "GET, OPTIONS",
            ...CORS_HEADERS,
          },
        });
      }
      return turnCredentials(env);
    }

    const room = url.pathname.match(/^\/room\/([A-Za-z0-9]{4,12})$/);
    if (room) {
      const id = env.ROOMS.idFromName(room[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

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

async function turnCredentials(env: Env): Promise<Response> {
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

  return new Response(JSON.stringify({ iceServers }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": turnSuccess ? "public, max-age=3600" : "no-store",
      "X-Turn-Status": turnStatus,
      ...CORS_HEADERS,
    },
  });
}
