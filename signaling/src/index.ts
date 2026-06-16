// Worker entry: route room WebSockets to per-room Durable Objects, and serve
// ICE configuration (STUN, plus Cloudflare TURN when configured by secrets).

export { Room } from "./room.ts";

export interface Env {
  ROOMS: DurableObjectNamespace;
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

const STUN: IceServer = { urls: "stun:stun.l.google.com:19302" };

// Allow the GitHub Pages SPA (any origin) to read the JSON; no credentials are
// involved, so a wildcard is fine.
const CORS = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/turn-credentials") {
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

async function turnCredentials(env: Env): Promise<Response> {
  const iceServers: IceServer[] = [STUN];

  if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`,
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
        const data = (await res.json()) as { iceServers?: IceServer };
        if (data.iceServers) iceServers.push(data.iceServers);
      }
    } catch {
      /* unreachable TURN API: fall back to STUN only */
    }
  }

  return new Response(JSON.stringify({ iceServers }), {
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
