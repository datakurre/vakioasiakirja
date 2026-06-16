# broadcast-signaling

A tiny Cloudflare Worker + Durable Object that does **WebRTC signaling** for the
web editor's live-preview sharing (`web/src/share.ts`). It relays SDP
offers/answers and ICE candidates between a broadcaster and its viewers, reports
the viewer count, and mints short-lived TURN credentials. **Document content
never reaches this Worker** — it flows peer-to-peer over DTLS-encrypted WebRTC
data channels.

It runs within Cloudflare's **free** plan: a SQLite-backed Durable Object class
(no storage is actually used) and the WebSocket Hibernation API to minimise
billed duration.

## Endpoints

- `wss://<worker-host>/room/{roomId}?role=broadcaster|viewer` — signaling socket.
- `GET https://<worker-host>/turn-credentials` — `{ "iceServers": [...] }`
  (STUN, plus a Cloudflare TURN entry when secrets are configured).

## Deploy

```bash
cd signaling
npm install
npx wrangler login        # once
npx wrangler deploy
```

This prints the Worker host, e.g.
`https://broadcast-signaling.<subdomain>.workers.dev`.

### Optional: Cloudflare TURN (for viewers behind restrictive NATs)

Create a TURN key in the Cloudflare dashboard (Realtime → TURN), then:

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
```

Without these the Worker returns STUN only, and some strict-NAT viewers may fail
to connect.

## Wire the editor to it

Build the web editor with the Worker URL so the **Jaa** (Share) button appears:

```bash
cd ../web
VITE_SIGNALING_URL=https://broadcast-signaling.<subdomain>.workers.dev npm run build
```

For local development run `npx wrangler dev` here (defaults to
`http://localhost:8787`) and start the editor with
`VITE_SIGNALING_URL=http://localhost:8787 npm run dev`.

## Local typecheck

```bash
npm install && npm run typecheck
```
