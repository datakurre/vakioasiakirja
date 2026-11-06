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
until the reset. The Worker does not store any document or room data: its only
storage call is `setAlarm()`, made on each connection and each message, used for
the idle-room timeout. Each `setAlarm()` counts as one row written.

## Endpoints

- `wss://<worker-host>/room/{roomId}?role=broadcaster|viewer` — signaling socket.
- `GET https://<worker-host>/turn-credentials` — JSON with an `iceServers` array.
  Google STUN is always included; Cloudflare Realtime TURN servers are added
  when `TURN_KEY_ID` and `TURN_API_TOKEN` secrets are configured.

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

Create a TURN key with Cloudflare's [Create a TURN key API](https://developers.cloudflare.com/api/resources/calls/subresources/turn/methods/create/).
The Calls dashboard link currently opens Serverless SFU setup rather than TURN
key creation, so use the API directly. Set `ACCOUNT_ID` to the account ID (not
the zone ID), and use an active Cloudflare API token with **Account → Calls →
Write** permission for that same account. This is not the TURN key token used
later to generate credentials.

If the request returns `Authentication error`, first check that the account API
token is active:

```bash
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

The response should report `"status":"active"`. If it does, check the token's
Calls Write permission and that it applies to the account identified by
`ACCOUNT_ID`. Do not share the token value.

```bash
: "${ACCOUNT_ID:?Set ACCOUNT_ID to your Cloudflare account ID}"
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN to your Cloudflare API token}"
curl --request POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/calls/turn_keys" \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --data '{"name":"broadcast-signaling"}'
```

From the response, use `result.uid` as `TURN_KEY_ID` and `result.secret` as
`TURN_API_TOKEN`. Keep both values server-side; treat `secret` as a sensitive
credential.

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
```

Each `wrangler secret put` also creates and deploys a new Worker version, so no
separate `wrangler deploy` is needed afterwards.

The Worker uses Cloudflare's current
[credential endpoint](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
to request short-lived ICE server credentials. If either secret is missing or
the request fails, the endpoint logs a warning and returns Google STUN only;
viewers behind restrictive NATs may then fail to connect.
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
