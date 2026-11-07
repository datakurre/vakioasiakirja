// Live-preview sharing over WebRTC. The broadcaster opens one RTCPeerConnection
// + RTCDataChannel per viewer and pushes document snapshots over them; viewers
// receive and re-render. A Cloudflare Worker + Durable Object (see signaling/)
// does signaling only — it relays SDP offers/answers and ICE candidates and
// never sees document content (DataChannels are DTLS-encrypted end to end).
//
// Configured by VITE_SIGNALING_URL at build time; when unset the feature is
// inert (see isSharingEnabled) and the public demo build is unaffected.

import { getCollabUrl } from "./config.ts";

const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
const SIGNALING_URL = (env?.VITE_SIGNALING_URL ?? "").replace(/\/$/, "");

// STUN-only default. The Worker's /turn-credentials may add a Cloudflare TURN
// entry for viewers behind restrictive NATs; without it those may fail to peer.
const DEFAULT_ICE: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

// Room IDs avoid the easily confused 0/O and 1/I; 7 chars over a 31-symbol
// alphabet is ~35 bits, enough to make guessing a live room impractical.
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function isSharingEnabled(): boolean {
  return SIGNALING_URL !== "" || getCollabUrl() !== "";
}

export function randomRoomId(len = 7): string {
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  let id = "";
  for (let i = 0; i < len; i++) id += ROOM_ALPHABET[rnd[i] % ROOM_ALPHABET.length];
  return id;
}

export function randomCollabRoomId(len = 8): string {
  let id = "";
  do {
    const rnd = new Uint32Array(len);
    crypto.getRandomValues(rnd);
    id = "";
    for (let i = 0; i < len; i++) id += ROOM_ALPHABET[rnd[i] % ROOM_ALPHABET.length];
  } while (id.toUpperCase() === "CREATE");
  return id;
}

export function generateCollabToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function roomWsUrl(roomId: string, role: "broadcaster" | "viewer"): string {
  const ws = SIGNALING_URL.replace(/^http/, "ws");
  return `${ws}/room/${roomId}?role=${role}`;
}

// Short-lived ICE configuration (STUN + optional Cloudflare TURN). Fetched once
// per session; falls back to STUN-only if the Worker is unreachable.
export async function getIceConfig(): Promise<RTCConfiguration> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  let iceServers = DEFAULT_ICE;
  try {
    const res = await fetch(`${SIGNALING_URL}/turn-credentials`, { signal: controller.signal });
    if (res.ok) {
      const data = (await res.json()) as { iceServers?: RTCIceServer[] };
      if (data.iceServers?.length) iceServers = data.iceServers;
    }
  } catch {
    /* offline or no TURN configured: STUN only */
  } finally {
    window.clearTimeout(timeout);
  }
  return {
    iceServers,
    bundlePolicy: "max-bundle",
  };
}

// The full document state sent over a data channel. The logo travels as base64
// alongside the path Typst's image() expects, so a viewer reproduces the editor
// exactly with the existing render() pipeline.
export interface Snapshot {
  markdown: string;
  logo: { name: string; path: string; b64: string } | null;
}

export interface SelectionPayload {
  active: boolean;
  mode?: "visual" | "linewise" | "blockwise";
  text: string;
  prefix?: string;
  suffix?: string;
  fromLine?: number;
  toLine?: number;
  relPos?: number;
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

type ChannelMessage =
  | { type: "snapshot"; data: Snapshot }
  | { type: "chunk"; id: number; index: number; total: number; data: string }
  | { type: "selection"; data: SelectionPayload | null };

// One broadcaster fans the current snapshot out to every connected viewer. It
// holds a peer connection and data channel per viewer (the spec's state model).
export class Broadcaster {
  readonly roomId: string;
  private ws?: WebSocket;
  private readonly pcs = new Map<string, RTCPeerConnection>();
  private readonly dcs = new Map<string, RTCDataChannel>();
  private readonly pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private iceConfig: RTCConfiguration = { iceServers: DEFAULT_ICE };
  private snapshot?: Snapshot;
  private currentSelection: SelectionPayload | null = null;
  private stopped = false;
  private opened = false;
  private rejectConnect?: (error: Error) => void;
  private nextChunkId = 1;

  private readonly onViewers: (count: number) => void;
  private readonly onError: (message: string) => void;
  private readonly onWarning?: (message: string) => void;

  constructor(
    onViewers: (count: number) => void,
    onError: (message: string) => void,
    onWarning?: (message: string) => void,
  ) {
    this.roomId = randomRoomId();
    this.onViewers = onViewers;
    this.onError = onError;
    this.onWarning = onWarning;
  }

  // The shareable viewer link for this room (a client-side hash route).
  watchUrl(): string {
    return `${location.origin}${location.pathname}#/watch/${this.roomId}`;
  }

  async start(initialSnapshot?: Snapshot): Promise<void> {
    if (initialSnapshot) this.snapshot = initialSnapshot;
    this.iceConfig = await getIceConfig();
    if (this.stopped) return;
    await this.connect();
    if (this.stopped) return;
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

  private connect(): Promise<void> {
    const ws = new WebSocket(roomWsUrl(this.roomId, "broadcaster"));
    this.ws = ws;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.rejectConnect = undefined;
        if (error) reject(error);
        else resolve();
      };
      const fail = () => {
        if (this.stopped || this.ws !== ws) return;
        if (!this.opened) {
          finish(new Error("Jakopalveluun ei saatu yhteyttä."));
          ws.close();
          return;
        }
        // WebSocket error is commonly followed by close. stop() makes this
        // terminal transition idempotent so the UI is notified only once.
        this.stop();
        this.onError("Yhteys jakopalveluun katkesi. Jako lopetettiin.");
      };
      const timeout = window.setTimeout(() => {
        if (!this.opened) {
          finish(new Error("Jakopalveluun ei saatu yhteyttä."));
          ws.close();
        }
      }, 15000);

      this.rejectConnect = (error) => finish(error);
      ws.addEventListener("open", () => {
        if (this.stopped || this.ws !== ws) {
          finish(new Error("Jako peruttiin."));
          ws.close();
          return;
        }
        this.opened = true;
        finish();
      });
      ws.addEventListener("message", (e) => this.onSignal(JSON.parse(e.data) as Signal));
      ws.addEventListener("error", fail);
      ws.addEventListener("close", fail);
    });
  }

  // Replace the snapshot and push it to every open channel.
  push(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    for (const dc of this.dcs.values()) {
      this.sendSnapshot(dc, snapshot);
    }
  }

  // Push editor selection state to every open data channel.
  pushSelection(selection: SelectionPayload | null): void {
    this.currentSelection = selection;
    const msg: ChannelMessage = { type: "selection", data: selection };
    const raw = JSON.stringify(msg);
    for (const dc of this.dcs.values()) {
      if (dc.readyState === "open") {
        try {
          dc.send(raw);
        } catch {
          /* ignore send error */
        }
      }
    }
  }

  private sendSnapshot(dc: RTCDataChannel, snapshot: Snapshot) {
    if (dc.readyState !== "open") return;
    const raw = JSON.stringify(snapshot);
    const CHUNK_SIZE = 48 * 1024;
    if (raw.length <= CHUNK_SIZE) {
      try {
        dc.send(JSON.stringify({ type: "snapshot", data: snapshot } satisfies ChannelMessage));
      } catch {
        /* ignore send error */
      }
      return;
    }
    const id = this.nextChunkId++;
    const total = Math.ceil(raw.length / CHUNK_SIZE);
    for (let index = 0; index < total; index++) {
      if (dc.readyState !== "open") break;
      const data = raw.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
      try {
        dc.send(JSON.stringify({ type: "chunk", id, index, total, data } satisfies ChannelMessage));
      } catch {
        break;
      }
    }
  }

  private async onSignal(msg: Signal) {
    switch (msg.type) {
      case "viewer_join":
        await this.addViewer(msg.viewerId);
        break;
      case "answer":
        if (msg.viewerId) {
          const pc = this.pcs.get(msg.viewerId);
          if (pc) {
            await pc.setRemoteDescription(msg.answer);
            const queued = this.pendingCandidates.get(msg.viewerId) ?? [];
            this.pendingCandidates.delete(msg.viewerId);
            for (const c of queued) {
              try {
                await pc.addIceCandidate(c);
              } catch {
                /* ignore */
              }
            }
          }
        }
        break;
      case "candidate":
        if (msg.viewerId && msg.candidate) {
          const pc = this.pcs.get(msg.viewerId);
          if (!pc || !pc.remoteDescription) {
            const queued = this.pendingCandidates.get(msg.viewerId) ?? [];
            queued.push(msg.candidate);
            this.pendingCandidates.set(msg.viewerId, queued);
          } else {
            try {
              await pc.addIceCandidate(msg.candidate);
            } catch {
              /* ignore late candidate */
            }
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
      if (this.snapshot) this.sendSnapshot(dc, this.snapshot);
      if (this.currentSelection?.active) {
        try {
          dc.send(JSON.stringify({ type: "selection", data: this.currentSelection } satisfies ChannelMessage));
        } catch {
          /* ignore */
        }
      }
    });

    const pendingOutgoing: RTCIceCandidateInit[] = [];
    let offerSent = false;

    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) {
        const candidate = e.candidate.toJSON();
        if (!offerSent) {
          pendingOutgoing.push(candidate);
        } else {
          this.send({ type: "candidate", viewerId, candidate });
        }
      }
    });
    let failed = false;
    const handleFailure = () => {
      if (failed) return;
      failed = true;
      const msg = "WebRTC-yhteys katsojaan epäonnistui (ICE failed). Tarkista jakopalvelun TURN-asetukset.";
      if (this.onWarning) {
        this.onWarning(msg);
      } else {
        this.onError(msg);
      }
      this.dropViewer(viewerId);
    };

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") handleFailure();
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc.iceConnectionState === "failed") handleFailure();
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.pcs.get(viewerId) !== pc) return;
    this.send({ type: "offer", viewerId, offer });
    offerSent = true;
    for (const candidate of pendingOutgoing) {
      this.send({ type: "candidate", viewerId, candidate });
    }
  }

  private dropViewer(viewerId: string) {
    this.pendingCandidates.delete(viewerId);
    this.dcs.get(viewerId)?.close();
    this.dcs.delete(viewerId);
    const pc = this.pcs.get(viewerId);
    if (pc) {
      pc.close();
      this.pcs.delete(viewerId);
    }
  }

  private send(msg: Signal) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        /* the socket may close between the readyState check and send */
      }
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    window.removeEventListener("beforeunload", this.beforeUnload);
    this.rejectConnect?.(new Error("Jako peruttiin."));
    this.rejectConnect = undefined;
    this.send({ type: "close" });
    for (const id of [...this.pcs.keys()]) this.dropViewer(id);
    this.pendingCandidates.clear();
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
  private readonly incomingChunks = new Map<number, { total: number; received: number; chunks: string[] }>();
  private stopped = false;
  private backoff = 0;

  private readonly roomId: string;
  private readonly onSnapshot: (s: Snapshot) => void;
  private readonly onStatus: (state: "connecting" | "live" | "reconnecting" | "ended") => void;
  private readonly onError?: (message: string) => void;
  private onSelection?: (payload: SelectionPayload | null) => void;

  constructor(
    roomId: string,
    onSnapshot: (s: Snapshot) => void,
    onStatus: (state: "connecting" | "live" | "reconnecting" | "ended") => void,
    onError?: (message: string) => void,
    onSelection?: (payload: SelectionPayload | null) => void,
  ) {
    this.roomId = roomId;
    this.onSnapshot = onSnapshot;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onSelection = onSelection;
  }

  setOnSelection(cb: (payload: SelectionPayload | null) => void): void {
    this.onSelection = cb;
  }

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
    this.incomingChunks.clear();
    const pc = new RTCPeerConnection(this.iceConfig);
    this.pc = pc;

    pc.addEventListener("datachannel", (e) => {
      const dc = e.channel;
      dc.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ChannelMessage | Snapshot;
          if ("type" in msg) {
            if (msg.type === "snapshot") {
              const snap = typeof msg.data === "string" ? (JSON.parse(msg.data) as Snapshot) : msg.data;
              this.onSnapshot(snap);
              this.onStatus("live");
            } else if (msg.type === "chunk") {
              this.handleChunk(msg);
            } else if (msg.type === "selection") {
              this.onSelection?.(msg.data);
            }
          } else if ("markdown" in msg) {
            this.onSnapshot(msg as unknown as Snapshot);
            this.onStatus("live");
          }
        } catch {
          /* ignore malformed frame */
        }
      });
      dc.addEventListener("close", () => {
        if (!this.stopped) this.onStatus("reconnecting");
      });
    });

    const pendingOutgoing: RTCIceCandidateInit[] = [];
    let answerSent = false;

    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) {
        const candidate = e.candidate.toJSON();
        if (!answerSent) {
          pendingOutgoing.push(candidate);
        } else {
          this.send({ type: "candidate", candidate });
        }
      }
    });

    let failed = false;
    const handleFailure = () => {
      if (failed) return;
      failed = true;
      this.onError?.("WebRTC-yhteys jakajaan epäonnistui (ICE failed). Tarkista jakopalvelun TURN-asetukset.");
    };

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") handleFailure();
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      if (pc.iceConnectionState === "failed") handleFailure();
    });

    await pc.setRemoteDescription(offer);
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* ignore */
      }
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (this.pc !== pc) return;
    this.send({ type: "answer", answer });
    answerSent = true;
    for (const candidate of pendingOutgoing) {
      this.send({ type: "candidate", candidate });
    }
  }

  private handleChunk(msg: { id: number; index: number; total: number; data: string }) {
    let entry = this.incomingChunks.get(msg.id);
    if (!entry) {
      entry = { total: msg.total, received: 0, chunks: new Array<string>(msg.total) };
      this.incomingChunks.set(msg.id, entry);
      if (this.incomingChunks.size > 10) {
        const oldestKey = this.incomingChunks.keys().next().value;
        if (oldestKey !== undefined) this.incomingChunks.delete(oldestKey);
      }
    }
    if (!entry.chunks[msg.index]) {
      entry.chunks[msg.index] = msg.data;
      entry.received++;
    }
    if (entry.received === entry.total) {
      this.incomingChunks.delete(msg.id);
      const full = entry.chunks.join("");
      try {
        const snapshot = JSON.parse(full) as Snapshot;
        this.onSnapshot(snapshot);
        this.onStatus("live");
      } catch {
        /* ignore invalid json */
      }
    }
  }

  private async addCandidate(candidate: RTCIceCandidateInit) {
    if (!this.pc || !this.pc.remoteDescription) {
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
    this.pendingCandidates = [];
    this.incomingChunks.clear();
    this.pc?.close();
    this.pc = undefined;
    this.ws?.close();
    this.ws = undefined;
  }

  stop(): void {
    this.teardown();
  }
}
