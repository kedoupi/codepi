import { beginLogin, finishLogin, logoutSso, readSsoSession, ssoEnabled, ssoErrorResponse, type SsoEnv } from "../../shared/auth/client";
import { deskJson, deskSources, emptySummary, type DeskRange, type DeskSource, type DeskSummary } from "../../shared/desk/contract";

export interface DeskEnv extends SsoEnv {
  HEALTH_SUMMARY_TOKEN?: string;
  GU_SUMMARY_TOKEN?: string;
  WECHAT_SUMMARY_TOKEN?: string;
}
type Upstream = (request: Request) => Promise<Response>;
const origins: Record<DeskSource, string> = {
  health: "https://health.codepi.app", gu: "https://gu.codepi.app", wechat: "https://gzh.codepi.app",
};
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 600;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Reject malformed upstream data and copy only the fields the workbench needs. */
function decodeSummary(value: unknown, source: DeskSource): DeskSummary {
  if (!record(value) || value.source !== source || !["ok", "empty"].includes(String(value.status))
    || typeof value.stale !== "boolean"
    || ![value.asOf, value.updatedAt].every(v => v === null || (text(v) && Number.isFinite(Date.parse(v))))
    || !Array.isArray(value.metrics) || value.metrics.length > 6
    || !value.metrics.every(v => record(v) && text(v.label) && text(v.value))
    || !Array.isArray(value.facts) || value.facts.length > 12 || !value.facts.every(text)
    || !Array.isArray(value.notes) || value.notes.length > 12 || !value.notes.every(text)
    || !Array.isArray(value.attention) || value.attention.length > 6
    || !value.attention.every(v => {
      if (!record(v) || !text(v.label) || !text(v.href)) return false;
      try { const url = new URL(v.href); return url.origin === origins[source] && !url.username && !url.password; }
      catch { return false; }
    })) throw Error("invalid_summary");
  const result: DeskSummary = {
    source, status: value.status as "ok" | "empty", asOf: value.asOf as string | null,
    updatedAt: value.updatedAt as string | null, stale: value.stale,
    metrics: value.metrics.map(v => ({ label: v.label, value: v.value })),
    facts: value.facts, notes: value.notes,
    attention: value.attention.map(v => ({ label: v.label, href: v.href })),
  };
  if (source === "gu" && record(value.privateMetric) && text(value.privateMetric.label) && text(value.privateMetric.value)) {
    result.privateMetric = { label: value.privateMetric.label, value: value.privateMetric.value };
  }
  return result;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw Error("missing_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw Error("summary_too_large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function loadSource(source: DeskSource, range: DeskRange, env: DeskEnv, upstream: Upstream): Promise<DeskSummary> {
  const token = { health: env.HEALTH_SUMMARY_TOKEN, gu: env.GU_SUMMARY_TOKEN, wechat: env.WECHAT_SUMMARY_TOKEN }[source];
  const unavailable = (note: string): DeskSummary => ({ ...emptySummary(source, note), status: "unavailable" });
  if (!token || token.length < 32) return unavailable("摘要连接尚未配置，仍可进入原应用。");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = new Request(`${origins[source]}/api/internal/desk-summary?range=${range}`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "manual", signal: controller.signal,
    });
    const load = async () => {
      const response = await upstream(request);
      if (!response.ok) { await response.body?.cancel(); throw Error("source_unavailable"); }
      return decodeSummary(await boundedJson(response), source);
    };
    return await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error("timeout")); }, 8000);
      }),
    ]);
  } catch {
    return unavailable("暂时无法读取摘要，请重试或进入原应用查看。");
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function route(request: Request, env: DeskEnv, upstream: Upstream): Promise<Response> {
  const url = new URL(request.url);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return deskJson({ error: "https_required" }, 403);
  }
  if (url.hostname === "www.codepi.app") {
    if (request.method !== "GET") return deskJson({ error: "canonical_origin_required" }, 403);
    url.hostname = "codepi.app";
    url.protocol = "https:";
    url.port = "";
    return new Response(null, { status: 302, headers: { Location: url.href } });
  }
  if (!ssoEnabled(env) || env.AUTH_CLIENT_ID !== "desk") return deskJson({ error: "desk_not_configured" }, 503);
  const path = url.pathname;
  if (request.method === "POST" && request.headers.get("Origin") !== url.origin) return deskJson({ error: "origin_not_allowed" }, 403);
  if (path === "/api/auth/login" && request.method === "GET") {
    const login = new URL(request.url);
    login.search = "?return=%2Fdesk%2F";
    return beginLogin(new Request(login, request), env);
  }
  if (path === "/api/auth/callback" && request.method === "GET") {
    return finishLogin(request, env, { userId: "desk-owner", ttlSeconds: 7 * 86400 });
  }
  if (path === "/api/auth/logout" && request.method === "POST") return logoutSso(request, env);
  const session = await readSsoSession(request, env);
  if (!session || session.subject !== "kdp-owner" || session.userId !== "desk-owner") {
    return deskJson({ error: "unauthorized" }, 401);
  }
  if (path === "/api/desk/me" && request.method === "GET") return deskJson({ authenticated: true });
  let range: DeskRange = "current";
  let sources: DeskSource[] = [...deskSources];
  if (path === "/api/desk/summary" && request.method === "POST") {
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") return deskJson({ error: "invalid_content_type" }, 415);
    let value: unknown;
    try { value = await boundedJson(new Response(request.body)); }
    catch { return deskJson({ error: "invalid_request" }, 400); }
    if (!record(value) || !["current", "week"].includes(String(value.range))
      || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 3
      || new Set(value.sources).size !== value.sources.length
      || !value.sources.every(v => deskSources.includes(v))) return deskJson({ error: "invalid_request" }, 400);
    range = value.range as DeskRange;
    sources = value.sources as DeskSource[];
  } else if (!(path === "/api/desk/overview" && request.method === "GET")) {
    return deskJson({ error: "not_found" }, 404);
  }
  const results = await Promise.all(sources.map(source => loadSource(source, range, env, upstream)));
  // A logout in another application while sources load must revoke this response too.
  const stillActive = await readSsoSession(request, env);
  if (!stillActive || stillActive.id !== session.id) return deskJson({ error: "unauthorized" }, 401);
  return deskJson({
    generatedAt: new Date().toISOString(), timezone: "Asia/Shanghai", range,
    partial: results.some(result => result.status === "unavailable"), sources: results,
  });
}

export async function handleDeskRequest(request: Request, env: DeskEnv, upstream: Upstream = request => fetch(request)): Promise<Response> {
  let response: Response;
  try { response = await route(request, env, upstream); }
  catch (error) { response = ssoErrorResponse(error); }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
}
