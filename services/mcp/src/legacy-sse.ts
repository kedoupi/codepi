/**
 * Deprecated MCP HTTP+SSE transport (protocol 2024-11-05) for clients that
 * cannot speak Streamable HTTP yet.
 *
 * One Durable Object instance owns exactly one SSE stream: `GET /sse` creates a
 * fresh unique id, the stream announces `/messages?sessionId=<id>`, and each
 * `POST /messages` is executed by the stateless `mcp()` handler and its JSON
 * reply is pushed onto the stream. The session id is only a routing handle:
 * every POST re-authenticates and must present the same subject, client and
 * scope recorded when the stream opened.
 *
 * Nothing is persisted. A session ends when the client disconnects, the fixed
 * TTL elapses or the grant expires; afterwards its id answers 404 and the
 * client reconnects with a new `GET /sse`, which yields a new session. There is
 * no event replay or resumption.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";
import type { TokenRow } from "./oauth-store.ts";
import { normalizeScope } from "./oauth-store.ts";
import { authenticate, mcp } from "./protocol.ts";
import { HttpError, json } from "./http.ts";

export const LEGACY_SSE_TTL_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 25 * 1000;
// Unread bytes a stream may buffer. A client that stops reading (or vanished
// without the runtime cancelling the body) is dropped instead of growing memory.
export const LEGACY_SSE_MAX_UNREAD = 256 * 1024;
const SESSION_ID = /^[0-9a-f]{64}$/;

type Binding = Pick<TokenRow, "user_id" | "client_id" | "scope">;

/** True when `granted` carries every scope in `required`. */
const covers = (granted: string, required: string) =>
  required.split(" ").filter(Boolean).every(scope => granted.split(" ").includes(scope));

function unauthorized(env: Env) {
  const response = json({ error: "invalid_token" }, 401);
  response.headers.set("WWW-Authenticate",
    `Bearer resource_metadata="${env.MCP_ORIGIN}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`);
  return response;
}

/** Same owner/scope gate as `mcp()`, applied before a stream or message is accepted. */
async function grantFor(request: Request, env: Env): Promise<TokenRow | Response> {
  const grant = await authenticate(request, env);
  if (!grant || grant.user_id !== "kdp-owner") return unauthorized(env);
  if (!normalizeScope(grant.scope)) return json({ error: "insufficient_scope" }, 403);
  return grant;
}

/**
 * Outer routing for `GET /sse` and `POST /messages?sessionId=`. Origin checks,
 * CORS and OPTIONS stay with the caller.
 */
export async function legacySse(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/sse") {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    // Reject before allocating a Durable Object for an anonymous caller.
    const grant = await grantFor(request, env);
    if (grant instanceof Response) return grant;
    return env.LEGACY_SSE.get(env.LEGACY_SSE.newUniqueId()).fetch(request);
  }
  if (url.pathname === "/messages") {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const sessionId = url.searchParams.get("sessionId") ?? "";
    if (!SESSION_ID.test(sessionId)) return json({ error: "session_not_found" }, 404);
    let id: DurableObjectId;
    try { id = env.LEGACY_SSE.idFromString(sessionId); }
    catch { return json({ error: "session_not_found" }, 404); }
    return env.LEGACY_SSE.get(id).fetch(request);
  }
  return json({ error: "not_found" }, 404);
}

export class LegacySse extends DurableObject<Env> {
  private binding: Binding | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  /** Bytes written but not yet pulled by the client, and whether they were already pending at the last heartbeat. */
  private unread = 0;
  private stalled = false;
  private opened = false;
  private ttl: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private readonly encoder = new TextEncoder();

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") return this.open(request);
    if (request.method === "POST") return this.message(request);
    return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  }

  private async open(request: Request): Promise<Response> {
    // One stream per object for its whole life: a second GET never replaces the
    // first, and a closed session is not reopened.
    if (this.opened) return json({ error: "session_in_use" }, 409);
    const grant = await grantFor(request, this.env);
    if (grant instanceof Response) return grant;
    if (this.opened) return json({ error: "session_in_use" }, 409);
    this.opened = true;
    this.binding = { user_id: grant.user_id, client_id: grant.client_id, scope: grant.scope };
    const sessionId = this.ctx.id.toString();
    const lifetime = Math.max(0, Math.min(LEGACY_SSE_TTL_MS, grant.expires_at - Date.now()));
    // Disconnect detection: `closed` settles when the runtime cancels the body;
    // where cancellation does not reach the object, unread backpressure (send/beat) ends it.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.writer = writer;
    writer.closed.then(() => this.destroy(false), () => this.destroy(false));
    request.signal?.addEventListener("abort", () => this.destroy(false));
    this.send(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
    this.ttl = setTimeout(() => this.destroy(), lifetime);
    this.beat();
    return new Response(readable, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    } });
  }

  private async message(request: Request): Promise<Response> {
    if (!this.writer || !this.binding) return json({ error: "session_not_found" }, 404);
    const grant = await grantFor(request, this.env);
    if (grant instanceof Response) return grant;
    const bound = this.binding;
    if (!this.writer || !bound) return json({ error: "session_not_found" }, 404);
    // A session id alone never authorizes: the caller must be the same grant.
    // A refreshed grant may be wider than the one the stream opened with — the
    // refresh path upgrades a legacy partial grant to the full scope set — so
    // the session survives as long as the caller still holds every bound scope.
    if (grant.user_id !== bound.user_id || grant.client_id !== bound.client_id || !covers(grant.scope, bound.scope)) {
      return json({ error: "session_grant_mismatch" }, 403);
    }
    // mcp() re-authenticates from the same header, bounds the body and checks Content-Type.
    const forwarded = new Request(`${this.env.MCP_ORIGIN}/mcp`, {
      method: "POST", headers: request.headers, body: request.body,
    });
    let reply: Response;
    try { reply = await mcp(forwarded, this.env); }
    catch (error) {
      // Errors thrown inside a Durable Object lose their class at the stub
      // boundary, so map known ones (e.g. request_too_large) here.
      if (error instanceof HttpError) return json({ error: error.code }, error.status);
      throw error;
    }
    if (reply.status !== 200 || !reply.headers.get("Content-Type")?.includes("application/json")) {
      return reply;
    }
    const payload: unknown = await reply.json();
    if (!this.writer) return json({ error: "session_not_found" }, 404);
    for (const item of Array.isArray(payload) ? payload : [payload]) {
      this.send(`event: message\ndata: ${JSON.stringify(item)}\n\n`);
    }
    if (!this.writer) return json({ error: "session_not_found" }, 404);
    return new Response("Accepted", { status: 202, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  private beat() {
    this.heartbeat = setTimeout(() => {
      if (!this.writer) return;
      // Data still unread a full heartbeat later means nobody is reading.
      if (this.stalled && this.unread > 0) return this.destroy(false);
      this.stalled = this.unread > 0;
      this.send(": keepalive\n\n");
      this.beat();
    }, HEARTBEAT_MS);
  }

  private send(chunk: string) {
    const writer = this.writer;
    if (!writer) return;
    const bytes = this.encoder.encode(chunk);
    if (this.unread + bytes.length > LEGACY_SSE_MAX_UNREAD) return this.destroy(false);
    this.unread += bytes.length;
    writer.write(bytes).then(() => {
      this.unread -= bytes.length;
      if (!this.unread) this.stalled = false;
    }, () => this.destroy(false));
  }

  /** Ends the session and drops all in-memory state; `opened` stays set so it cannot be reused. */
  private destroy(close = true) {
    if (this.ttl) clearTimeout(this.ttl);
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.ttl = this.heartbeat = null;
    const writer = this.writer;
    this.writer = null;
    this.binding = null;
    this.unread = 0;
    if (!writer) return;
    // close() waits for queued data; abort() discards it for a client that is gone.
    (close ? writer.close() : writer.abort()).catch(() => { /* already closed by the runtime */ });
  }
}
