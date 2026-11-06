// One Durable Object per room. It is a pure signaling relay: it forwards SDP
// offers/answers and ICE candidates between the single broadcaster and each
// viewer, tracks the viewer count, and closes idle rooms. It never sees
// document content — that flows over the peers' WebRTC data channels.
//
// State lives entirely in the connected sockets (reconstructed from the
// hibernation API on each event), so the object survives hibernation without
// any stored data: the broadcaster is the socket tagged "broadcaster", viewers
// are tagged "viewer", and each viewer's id rides in its socket attachment.

interface Attachment {
  role: "broadcaster" | "viewer";
  viewerId?: string;
}

// Close a room after this much inactivity (no messages or new connections).
const IDLE_MS = 15 * 60 * 1000;

export class Room {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const role =
      new URL(request.url).searchParams.get("role") === "broadcaster"
        ? "broadcaster"
        : "viewer";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server, [role]);

    const att: Attachment =
      role === "broadcaster"
        ? { role: "broadcaster" }
        : { role: "viewer", viewerId: crypto.randomUUID().slice(0, 8) };
    server.serializeAttachment(att);

    if (role === "broadcaster") {
      // Replace any prior broadcaster (reconnect): only one may publish.
      for (const old of this.state.getWebSockets("broadcaster")) {
        if (old !== server) this.tryClose(old, 1000, "replaced");
      }
      // Re-offer to viewers still connected, so a reconnecting broadcaster
      // rebuilds its peers.
      for (const vs of this.state.getWebSockets("viewer")) {
        const va = vs.deserializeAttachment() as Attachment | null;
        if (va?.viewerId) this.send(server, { type: "viewer_join", viewerId: va.viewerId });
      }
      this.send(server, { type: "viewers", count: this.viewerIds().size });
    } else {
      const bc = this.broadcaster();
      if (bc) {
        this.send(bc, { type: "viewer_join", viewerId: att.viewerId! });
        // The just-accepted socket may not be enumerable yet, so count it in
        // explicitly (adding to a Set is idempotent where it already appears).
        const ids = this.viewerIds();
        ids.add(att.viewerId!);
        this.send(bc, { type: "viewers", count: ids.size });
      }
    }

    await this.bumpAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    await this.bumpAlarm();

    if (att.role === "broadcaster") {
      const viewerId = msg.viewerId as string | undefined;
      if (msg.type === "offer" && viewerId) {
        const vs = this.viewerById(viewerId);
        if (vs) this.send(vs, { type: "offer", offer: msg.offer });
      } else if (msg.type === "candidate" && viewerId) {
        const vs = this.viewerById(viewerId);
        if (vs) this.send(vs, { type: "candidate", candidate: msg.candidate });
      } else if (msg.type === "close") {
        // Explicit end of broadcast: tell viewers and drop them.
        for (const vs of this.state.getWebSockets("viewer")) {
          this.send(vs, { type: "closed" });
          this.tryClose(vs, 1000, "broadcaster closed");
        }
      }
    } else {
      // Viewer → broadcaster: tag with our viewerId so the broadcaster can
      // address the right peer connection.
      const bc = this.broadcaster();
      if (!bc) return;
      if (msg.type === "answer") {
        this.send(bc, { type: "answer", viewerId: att.viewerId, answer: msg.answer });
      } else if (msg.type === "candidate") {
        this.send(bc, { type: "candidate", viewerId: att.viewerId, candidate: msg.candidate });
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.role === "viewer") {
      const bc = this.broadcaster();
      if (bc) {
        this.send(bc, { type: "viewer_leave", viewerId: att.viewerId });
        // Exclude the closing socket by id (it may still be enumerable, and is
        // not reliably identity-equal to the handler's `ws`).
        const ids = this.viewerIds();
        if (att.viewerId) ids.delete(att.viewerId);
        this.send(bc, { type: "viewers", count: ids.size });
      }
    }
    // A broadcaster signaling drop is intentionally NOT broadcast as "closed":
    // established data channels survive it (DTLS is peer-to-peer) and the
    // broadcaster may reconnect to the same room. The room idles out otherwise.
  }

  async webSocketError(): Promise<void> {
    /* webSocketClose handles cleanup */
  }

  async alarm(): Promise<void> {
    for (const ws of this.state.getWebSockets()) {
      this.tryClose(ws, 1001, "idle timeout");
    }
  }

  // --- helpers ---
  private broadcaster(): WebSocket | undefined {
    return this.state.getWebSockets("broadcaster")[0];
  }

  private viewerById(id: string): WebSocket | undefined {
    return this.state
      .getWebSockets("viewer")
      .find((w) => (w.deserializeAttachment() as Attachment | null)?.viewerId === id);
  }

  // The set of connected viewer ids (read from socket attachments). Reference-
  // and timing-independent, so it is reliable from connect/close handlers and
  // survives hibernation.
  private viewerIds(): Set<string> {
    const ids = new Set<string>();
    for (const w of this.state.getWebSockets("viewer")) {
      const id = (w.deserializeAttachment() as Attachment | null)?.viewerId;
      if (id) ids.add(id);
    }
    return ids;
  }

  private send(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket gone */
    }
  }

  private tryClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closing */
    }
  }

  private async bumpAlarm(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + IDLE_MS);
  }
}
