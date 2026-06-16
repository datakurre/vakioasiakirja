// Live-preview sharing over WebRTC. The broadcaster opens one RTCPeerConnection
// + RTCDataChannel per viewer and pushes document snapshots over them; viewers
// receive and re-render. A Cloudflare Worker + Durable Object (see signaling/)
// does signaling only — it relays SDP offers/answers and ICE candidates and
// never sees document content (DataChannels are DTLS-encrypted end to end).
//
// Configured by VITE_SIGNALING_URL at build time; when unset the feature is
// inert (see isSharingEnabled) and the public demo build is unaffected.

const SIGNALING_URL = (import.meta.env.VITE_SIGNALING_URL ?? "").replace(/\/$/, "");

// STUN-only default. The Worker's /turn-credentials may add a Cloudflare TURN
// entry for viewers behind restrictive NATs; without it those may fail to peer.
const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Room IDs avoid the easily confused 0/O and 1/I; 7 chars over a 31-symbol
// alphabet is ~35 bits, enough to make guessing a live room impractical.
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function isSharingEnabled(): boolean {
  return SIGNALING_URL !== "";
}

export function randomRoomId(len = 7): string {
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  let id = "";
  for (let i = 0; i < len; i++) id += ROOM_ALPHABET[rnd[i] % ROOM_ALPHABET.length];
  return id;
}

function roomWsUrl(roomId: string, role: "broadcaster" | "viewer"): string {
  const ws = SIGNALING_URL.replace(/^http/, "ws");
  return `${ws}/room/${roomId}?role=${role}`;
}

// Short-lived ICE configuration (STUN + optional Cloudflare TURN). Fetched once
// per session; falls back to STUN-only if the Worker is unreachable.
export async function getIceConfig(): Promise<RTCConfiguration> {
  try {
    const res = await fetch(`${SIGNALING_URL}/turn-credentials`);
    if (res.ok) {
      const data = (await res.json()) as { iceServers?: RTCIceServer[] };
      if (data.iceServers?.length) return { iceServers: data.iceServers };
    }
  } catch {
    /* offline or no TURN configured: STUN only */
  }
  return { iceServers: DEFAULT_ICE };
}

// The full document state sent over a data channel. The logo travels as base64
// alongside the path Typst's image() expects, so a viewer reproduces the editor
// exactly with the existing render() pipeline.
export interface Snapshot {
  markdown: string;
  logo: { name: string; path: string; b64: string } | null;
}

// --- signaling message envelopes (JSON over the WebSocket) ---
type Signal =
  | { type: "viewer_join"; viewerId: string }
  | { type: "viewer_leave"; viewerId: string }
  | { type: "viewers"; count: number }
  | { type: "offer"; viewerId?: string; offer: RTCSessionDescriptionInit }
  | { type: "answer"; viewerId?: string; answer: RTCSessionDescriptionInit }
  | { type: "candidate"; viewerId?: string; candidate: RTCIceCandidateInit }
  | { type: "close" }
  | { type: "closed" };

const DATA_CHANNEL = "state";

// One broadcaster fans the current snapshot out to every connected viewer. It
// holds a peer connection and data channel per viewer (the spec's state model).
export class Broadcaster {
  readonly roomId: string;
  private ws?: WebSocket;
  private readonly pcs = new Map<string, RTCPeerConnection>();
  private readonly dcs = new Map<string, RTCDataChannel>();
  private iceConfig: RTCConfiguration = { iceServers: DEFAULT_ICE };
  private snapshot?: Snapshot;
  private stopped = false;

  constructor(
    private readonly onViewers: (count: number) => void,
    private readonly onError: (message: string) => void,
  ) {
    this.roomId = randomRoomId();
  }

  // The shareable viewer link for this room (a client-side hash route).
  watchUrl(): string {
    return `${location.origin}${location.pathname}#/watch/${this.roomId}`;
  }

  async start(): Promise<void> {
    this.iceConfig = await getIceConfig();
    this.connect();
    // Best-effort tidy close so viewers learn the broadcast ended on tab close.
    window.addEventListener("beforeunload", this.beforeUnload);
  }

  private beforeUnload = () => {
    try {
      this.ws?.send(JSON.stringify({ type: "close" } satisfies Signal));
    } catch {
      /* ignore */
    }
  };

  private connect() {
    const ws = new WebSocket(roomWsUrl(this.roomId, "broadcaster"));
    this.ws = ws;
    ws.addEventListener("message", (e) => this.onSignal(JSON.parse(e.data) as Signal));
    ws.addEventListener("error", () => {
      if (!this.stopped) this.onError("Jakopalveluun ei saatu yhteyttä.");
    });
  }

  // Replace the snapshot and push it to every open channel.
  push(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    const payload = JSON.stringify(snapshot);
    for (const dc of this.dcs.values()) {
      if (dc.readyState === "open") dc.send(payload);
    }
  }

  private async onSignal(msg: Signal) {
    switch (msg.type) {
      case "viewer_join":
        await this.addViewer(msg.viewerId);
        break;
      case "answer":
        if (msg.viewerId) await this.pcs.get(msg.viewerId)?.setRemoteDescription(msg.answer);
        break;
      case "candidate":
        if (msg.viewerId && msg.candidate) {
          try {
            await this.pcs.get(msg.viewerId)?.addIceCandidate(msg.candidate);
          } catch {
            /* candidate may arrive after teardown */
          }
        }
        break;
      case "viewer_leave":
        this.dropViewer(msg.viewerId);
        break;
      case "viewers":
        this.onViewers(msg.count);
        break;
    }
  }

  private async addViewer(viewerId: string) {
    this.dropViewer(viewerId); // defensive: never keep two peers for one id
    const pc = new RTCPeerConnection(this.iceConfig);
    this.pcs.set(viewerId, pc);

    const dc = pc.createDataChannel(DATA_CHANNEL, { ordered: true });
    this.dcs.set(viewerId, dc);
    dc.addEventListener("open", () => {
      if (this.snapshot) dc.send(JSON.stringify(this.snapshot));
    });

    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) this.send({ type: "candidate", viewerId, candidate: e.candidate.toJSON() });
    });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") this.dropViewer(viewerId);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "offer", viewerId, offer });
  }

  private dropViewer(viewerId: string) {
    this.dcs.get(viewerId)?.close();
    this.dcs.delete(viewerId);
    const pc = this.pcs.get(viewerId);
    if (pc) {
      pc.close();
      this.pcs.delete(viewerId);
    }
  }

  private send(msg: Signal) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("beforeunload", this.beforeUnload);
    this.send({ type: "close" });
    for (const id of [...this.pcs.keys()]) this.dropViewer(id);
    this.ws?.close();
    this.ws = undefined;
  }
}

// A viewer receives snapshots over a single data channel and renders them. The
// WebRTC session survives a signaling-socket blip (DTLS is peer-to-peer); the
// viewer only re-handshakes when the data channel itself drops.
export class Viewer {
  private ws?: WebSocket;
  private pc?: RTCPeerConnection;
  private iceConfig: RTCConfiguration = { iceServers: DEFAULT_ICE };
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private stopped = false;
  private backoff = 0;

  constructor(
    private readonly roomId: string,
    private readonly onSnapshot: (s: Snapshot) => void,
    private readonly onStatus: (state: "connecting" | "live" | "reconnecting" | "ended") => void,
  ) {}

  async start(): Promise<void> {
    this.iceConfig = await getIceConfig();
    this.connect();
  }

  private connect() {
    this.onStatus(this.backoff === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(roomWsUrl(this.roomId, "viewer"));
    this.ws = ws;
    ws.addEventListener("message", (e) => this.onSignal(JSON.parse(e.data) as Signal));
    ws.addEventListener("close", () => this.onWsClose());
  }

  private onWsClose() {
    if (this.stopped) return;
    // The peer connection (and snapshots) may well still be alive; only the
    // signaling socket dropped. Reconnect it quietly with exponential backoff so
    // future renegotiation (or a fresh broadcaster) can reach us again.
    const delay = Math.min(16000, 2000 * 2 ** this.backoff);
    this.backoff++;
    window.setTimeout(() => {
      if (!this.stopped) this.connect();
    }, delay);
  }

  private async onSignal(msg: Signal) {
    switch (msg.type) {
      case "offer":
        this.backoff = 0;
        await this.accept(msg.offer);
        break;
      case "candidate":
        if (msg.candidate) await this.addCandidate(msg.candidate);
        break;
      case "closed":
        this.onStatus("ended");
        this.teardown();
        break;
    }
  }

  private async accept(offer: RTCSessionDescriptionInit) {
    // A fresh offer supersedes any existing session (e.g. after the broadcaster
    // reconnected); tear the old peer down first.
    this.pc?.close();
    this.pendingCandidates = [];
    const pc = new RTCPeerConnection(this.iceConfig);
    this.pc = pc;

    pc.addEventListener("datachannel", (e) => {
      const dc = e.channel;
      dc.addEventListener("message", (ev) => {
        try {
          this.onSnapshot(JSON.parse(ev.data) as Snapshot);
          this.onStatus("live");
        } catch {
          /* ignore malformed frame */
        }
      });
      dc.addEventListener("close", () => {
        if (!this.stopped) this.onStatus("reconnecting");
      });
    });
    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) this.send({ type: "candidate", candidate: e.candidate.toJSON() });
    });

    await pc.setRemoteDescription(offer);
    for (const c of this.pendingCandidates) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* ignore */
      }
    }
    this.pendingCandidates = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({ type: "answer", answer });
  }

  private async addCandidate(candidate: RTCIceCandidateInit) {
    if (!this.pc?.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      /* ignore late candidate */
    }
  }

  private send(msg: Signal) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private teardown() {
    this.stopped = true;
    this.pc?.close();
    this.pc = undefined;
    this.ws?.close();
    this.ws = undefined;
  }

  stop(): void {
    this.teardown();
  }
}
