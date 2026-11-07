# broadcast-signaling

A tiny Cloudflare Worker + Durable Object that does **WebRTC signaling** for the
web editor's live-preview sharing (`web/src/share.ts`). It relays SDP
offers/answers and ICE candidates between a broadcaster and its viewers, reports
the viewer count, and mints short-lived TURN credentials. **Document content
never reaches this Worker** — it flows peer-to-peer over DTLS-encrypted WebRTC
data channels.

It is sized for Cloudflare's **Workers Free** plan: the Durable Object class is
SQLite-backed (the only storage backend available on Free), and the WebSocket
Hibernation API keeps billed duration low. The Free plan has daily allowances
(for example 100,000 Durable Object requests and 100,000 rows written per day,
reset at 00:00 UTC); once one is exceeded, further operations of that type fail
until the reset.

The Worker does not store any document or room data:
- Relaying signaling messages (SDP offers/answers and ICE trickling) happens
  purely in-memory with **zero disk writes**, eliminating storage quota exhaustion.
- While an active broadcaster is connected, no idle alarm is scheduled, so
  active broadcast sessions are never interrupted by alarms.
- An orphan idle alarm (15 minutes) is only scheduled when viewers are waiting
  without a broadcaster (e.g. an orphan viewer connects before the broadcaster,
  or the broadcaster drops unexpectedly while viewers remain).
- When a broadcaster connects or explicitly sends `{ type: "close" }`, any
  pending alarm is deleted (`deleteAlarm()`).
- When an alarm fires, it verifies no broadcaster is connected before closing
  orphan sockets (`1001 idle timeout`).

## Endpoints

- `wss://<worker-host>/room/{roomId}?role=broadcaster|viewer` — signaling socket.
  - **Room ID pattern**: 4 to 12 alphanumeric characters (`[A-Za-z0-9]{4,12}`),
    case-insensitive (normalized to uppercase for the Durable Object name).
  - **Single active broadcaster**: Only one active broadcaster is permitted per
    room. If an active broadcaster is already connected (`readyState === WebSocket.OPEN`),
    incoming connections requesting `?role=broadcaster` are rejected with
    `HTTP 409 Conflict` ("Broadcaster already connected") to prevent room hijacking.
  - **Message validation**: Enforces a 64 KB message size limit, verifies valid
    JSON object payloads, and strictly validates `offer`, `answer`, `candidate`,
    and `viewerId` parameters before relaying.
  - **Origin verification & CSWSH protection**: WebSocket upgrade requests verify
    the `Origin` header against the allowlist. If an unauthorized origin is provided,
    the handshake is rejected with `HTTP 403 Forbidden` ("Forbidden origin") to
    prevent Cross-Site WebSocket Hijacking.
- `GET https://<worker-host>/turn-credentials` — JSON with an `iceServers` array.
  - Responses include `Cache-Control: public, max-age=3600` on success, or
    `Cache-Control: no-store` when TURN credentials cannot be generated.
  - Includes diagnostic header `X-Turn-Status` (`success`, `missing-secrets`,
    `missing-key-id`, `missing-api-token`, `cf-error-<status>`, `cf-fetch-error`).
  - Includes CORS response headers (`Access-Control-Allow-Origin: <origin>`,
    `Vary: Origin`) reflecting the requesting origin if it is in the allowlist.
    Requests from unauthorized browser origins return `HTTP 403 Forbidden` ("Forbidden origin").
  - Non-`GET` and non-`OPTIONS` methods return `HTTP 405 Method Not Allowed`
    with `Allow: GET, OPTIONS`.
  - Cloudflare and Google STUN are always included; Cloudflare Realtime TURN
    servers are added when `TURN_KEY_ID` and `TURN_API_TOKEN` secrets are configured.
- `OPTIONS *` — Preflight requests verify the `Origin` header against the allowlist.
  - Unauthorized origins return `HTTP 403 Forbidden` ("Forbidden origin").
  - Allowed origins return `HTTP 204 No Content` with headers
    (`Access-Control-Allow-Origin: <origin>`, `Vary: Origin`,
    `Access-Control-Allow-Methods: GET, OPTIONS`,
    `Access-Control-Allow-Headers: Content-Type`,
    `Access-Control-Expose-Headers: X-Turn-Status`,
    `Access-Control-Max-Age: 86400`).

## Origin allowlist and CORS

Browser requests (carrying an `Origin` header) are validated against an allowlist to prevent Cross-Site WebSocket Hijacking (CSWSH) and protect CORS endpoints. Non-browser clients without an `Origin` header (such as CLI `curl`) are allowed to proceed without CORS headers.

### Default allowed origins

The Worker permits these origins out of the box:
- `https://datakurre.github.io` (production GitHub Pages site)
- `http://localhost:5173` (local Vite dev server)
- `http://localhost:4173` (local Vite preview server)
- `http://127.0.0.1:5173` (local Vite dev server on loopback IP)
- `http://localhost:8787` (local Wrangler dev server)

### Configuring additional origins (`ALLOWED_ORIGINS`)

To support custom domains, staging previews, or alternate ports, configure the optional `ALLOWED_ORIGINS` environment variable as a comma- or whitespace-separated string of origins.

**In `wrangler.toml`**:
```toml
[vars]
ALLOWED_ORIGINS = "https://example.com, https://preview.example.com"
```

**Or as a secret via `wrangler secret`**:
```bash
npx wrangler secret put ALLOWED_ORIGINS
```

## Deploy

```bash
cd signaling
npm install
npx wrangler login        # once; add --device on headless machines
npx wrangler deploy
```

For CI deployments, authenticate with `CLOUDFLARE_API_TOKEN` as described in
[Cloudflare's CI/CD guide](https://developers.cloudflare.com/workers/ci-cd/).

This prints the Worker host, e.g.
`https://broadcast-signaling.<subdomain>.workers.dev`.

### Optional: Cloudflare TURN (for viewers behind restrictive NATs)

Cloudflare Realtime TURN provides relay servers for peers behind restrictive NATs
where direct STUN hole punching fails (e.g. symmetric NATs or restrictive firewalls).

#### 1. Distinguish the credentials

It is easy to mix up the different IDs and tokens:
- **`ACCOUNT_ID`**: Your Cloudflare Account ID (found on the Cloudflare dashboard
  home page sidebar under "Account ID"). **Do not use a Zone ID** (which is tied
  to a domain).
- **`CLOUDFLARE_API_TOKEN`**: A User API token created in Cloudflare Dashboard
  (*My Profile → API Tokens → Create Custom Token*) with **Account → Calls → Write**
  permission. This token is used **only once** to create the TURN key. It is **not**
  the secret stored in Wrangler.
- **`result.uid` (`TURN_KEY_ID`)**: The TURN Key ID returned in the JSON response
  when creating the TURN key.
- **`result.key` (`TURN_API_TOKEN`)**: The TURN Key API token returned in the
  JSON response. **This is what Wrangler needs**, NOT `CLOUDFLARE_API_TOKEN` and
  NOT `result.secret`.

#### 2. Create the TURN key

Verify your user API token first:

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

The response should report `"status":"active"`. Then create the TURN key:

```bash
: "${ACCOUNT_ID:?Set ACCOUNT_ID to your Cloudflare account ID}"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN to your Cloudflare API token}"
curl --request POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/calls/turn_keys" \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data '{"name":"broadcast-signaling"}'
```

The response will look like:
```json
{
  "result": {
    "uid": "f10e4...",
    "key": "2b9a7...",
    "name": "broadcast-signaling"
  },
  "success": true
}
```

#### 3. Test the TURN key directly

Confirm that the new key generates ICE servers:

```bash
TURN_KEY_ID="<paste result.uid>"
TURN_API_TOKEN="<paste result.key>"
curl --request POST \
  "https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers" \
  --header "Authorization: Bearer $TURN_API_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"ttl": 86400}'
```

You should receive a JSON response containing `iceServers` with `turn:` URLs and temporary `username`/`credential` values.

#### 4. Configure Worker secrets

Store `result.uid` and `result.key` in Wrangler:

```bash
npx wrangler secret put TURN_KEY_ID     # paste result.uid
npx wrangler secret put TURN_API_TOKEN  # paste result.key
```

Each `wrangler secret put` immediately deploys a new Worker version with the secret bound.

#### 5. Verify the deployed Worker

Check your deployed Worker endpoint:

```bash
curl -i https://<worker-host>/turn-credentials
```

Inspect the `X-Turn-Status` header:
- `X-Turn-Status: success` — TURN is working! The response contains both STUN and Cloudflare TURN servers.
- `X-Turn-Status: missing-secrets` (or `missing-key-id` / `missing-api-token`) — secrets have not been configured on this Worker environment.
- `X-Turn-Status: cf-error-401` — `TURN_API_TOKEN` is invalid. Ensure you used `result.key`, not `CLOUDFLARE_API_TOKEN`.
- `X-Turn-Status: cf-error-404` — `TURN_KEY_ID` was not found. Ensure you used `result.uid`.

Cloudflare Realtime TURN does not require using Realtime SFU. The self-serve
TURN service has a 1,000 GB free tier, then costs $0.05 per real-time GB sent
from Cloudflare to the TURN client. Traffic between TURN and Realtime SFU or
Stream is not charged. See Cloudflare's [TURN pricing FAQ](https://developers.cloudflare.com/realtime/turn/faq/)
for current billing details; this is separate from Workers and Durable Objects
allowances.

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
