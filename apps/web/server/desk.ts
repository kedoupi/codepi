import { beginLogin, finishLogin, logoutSso, readSsoSession, ssoEnabled, ssoErrorResponse, type SsoEnv } from "@kedoupi/shared/auth/client";
import { getDraft, listDrafts, listInactiveDrafts, listPublished, publishDraft, rejectDraft, unpublishPost, archiveDraft, restoreDraft, listCategories, addCategory, removeCategory, updateDraftMetadata, reviseDraft, getRevision, type BlogEnv } from "./blog";
import { deskJson, deskSources, emptySummary, type DeskRange, type DeskSource, type DeskSummary } from "@kedoupi/shared/desk/contract";

export interface DeskEnv extends SsoEnv, BlogEnv {
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

async function boundedJson(response: Response, max = 32768): Promise<unknown> {
  if (!response.body) throw Error("missing_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw Error("summary_too_large");
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
  if (path === "/api/blog/categories" && request.method === "GET") return deskJson({ categories: await listCategories(env.BLOG) });
  if (path === "/api/blog/categories" && request.method === "POST") {
    let payload: unknown = {};
    try { payload = await boundedJson(new Response(request.body)); } catch { return deskJson({ error: "invalid_request" }, 400); }
    if (!record(payload)) return deskJson({ error: "invalid_request" }, 400);
    try { return deskJson(await addCategory(env.BLOG, payload.slug, payload.name)); }
    catch (error) { const message = error instanceof Error ? error.message : "internal_error"; return deskJson({ error: message }, 400); }
  }
  const categoryDelete = path.match(/^\/api\/blog\/categories\/([^/]+)\/delete$/);
  if (categoryDelete && request.method === "POST") {
    try { return deskJson(await removeCategory(env.BLOG, decodeURIComponent(categoryDelete[1]))); }
    catch (error) { const message = error instanceof Error ? error.message : "internal_error"; return deskJson({ error: message }, message === "not_found" ? 404 : 400); }
  }
  const metadataMatch = path.match(/^\/api\/blog\/drafts\/([^/]+)\/metadata$/);
  if (metadataMatch && request.method === "POST") {
    let payload: unknown = {};
    try { payload = await boundedJson(new Response(request.body)); } catch { return deskJson({ error: "invalid_request" }, 400); }
    if (!record(payload) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1 || !Array.isArray(payload.tags) || !(payload.category === null || typeof payload.category === "string")) return deskJson({ error: "invalid_request" }, 400);
    try { return deskJson(await updateDraftMetadata(env.BLOG, decodeURIComponent(metadataMatch[1]), payload, payload.revision as number)); }
    catch (error) { const message = error instanceof Error ? error.message : "internal_error"; return deskJson({ error: message }, message === "not_found" ? 404 : message === "revision_conflict" ? 409 : 400); }
  }
  if (path === "/api/blog/drafts" && request.method === "GET") {
    if (url.searchParams.get("view") === "archived") return deskJson({ drafts: await listInactiveDrafts(env.BLOG) });
    return deskJson({ drafts: await listDrafts(env.BLOG) });
  }
  const draftMatch = path.match(/^\/api\/blog\/drafts\/([^/]+)$/);
  if (draftMatch && request.method === "GET") {
    const draft = await getDraft(env.BLOG, decodeURIComponent(draftMatch[1]));
    return draft ? deskJson({ draft }) : deskJson({ error: "not_found" }, 404);
  }
  const reviseMatch = path.match(/^\/api\/blog\/drafts\/([^/]+)\/revise$/);
  if (reviseMatch && request.method === "POST") {
    let payload: unknown = {};
    try { payload = await boundedJson(new Response(request.body), 128 * 1024); } catch { return deskJson({ error: "invalid_request" }, 400); }
    if (!record(payload) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1) return deskJson({ error: "invalid_request" }, 400);
    try { return deskJson(await reviseDraft(env.BLOG, env, decodeURIComponent(reviseMatch[1]), payload, payload.revision as number)); }
    catch (error) { const message = error instanceof Error ? error.message : "internal_error"; return deskJson({ error: message }, message === "not_found" ? 404 : message === "revision_conflict" ? 409 : 400); }
  }
  const diffMatch = path.match(/^\/api\/blog\/drafts\/([^/]+)\/diff$/);
  if (diffMatch && request.method === "GET") {
    const draft = await getDraft(env.BLOG, decodeURIComponent(diffMatch[1]));
    if (!draft) return deskJson({ error: "not_found" }, 404);
    const previous = draft.revision > 1 ? await getRevision(env.BLOG, draft.slug, draft.revision - 1) : null;
    return deskJson({ current: { revision: draft.revision, title: draft.title, summary: draft.summary, body_markdown: draft.body_markdown }, previous });
  }
  const publishMatch = path.match(/^\/api\/blog\/drafts\/([^/]+)\/publish$/);
  if (publishMatch && request.method === "POST") {
    let payload: unknown = {};
    try { if (request.body) payload = await boundedJson(new Response(request.body)); } catch { return deskJson({ error: "invalid_request" }, 400); }
    if (!record(payload) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1) return deskJson({ error: "invalid_request" }, 400);
    try { return deskJson(await publishDraft(env.BLOG, decodeURIComponent(publishMatch[1]), url.origin, payload.revision as number)); }
    catch (error) { const message = error instanceof Error ? error.message : "internal_error"; return deskJson({ error: message }, message === "not_found" ? 404 : message === "revision_conflict" ? 409 : 400); }
  }
  const rejectMatch = path.match(/^\/api\/blog\/drafts\/([^/]+)\/reject$/);
  if (rejectMatch && request.method === "POST") {
    let payload: unknown = {};
    try { payload = await boundedJson(new Response(request.body)); } catch { return deskJson({ error: "invalid_request" }, 400); }
    if (!record(payload) || (payload.note !== undefined && typeof payload.note !== "string") || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1) return deskJson({ error: "invalid_request" }, 400);
    try { return deskJson(await rejectDraft(env.BLOG, decodeURIComponent(rejectMatch[1]), payload.note as string | undefined, payload.revision as number)); }
    catch (error) { const message = error instanceof Error ? error.message : "internal_error"; return deskJson({ error: message }, message === "not_found" ? 404 : message === "revision_conflict" ? 409 : 400); }
  }
  const unpublishMatch = path.match(/^\/api\/blog\/posts\/([^/]+)\/unpublish$/);
  if (unpublishMatch && request.method === "POST") {
    let payload: unknown = {};
    try { if (request.body) payload = await boundedJson(new Response(request.body)); } catch { return deskJson({ error: "invalid_request" }, 400); }
    if (!record(payload) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1) return deskJson({ error: "invalid_request" }, 400);
    try { return deskJson(await unpublishPost(env.BLOG, decodeURIComponent(unpublishMatch[1]), url.origin, payload.revision as number)); }
    catch (error) { const message = error instanceof Error ? error.message : "internal_error"; return deskJson({ error: message }, message === "not_found" ? 404 : message === "revision_conflict" ? 409 : 400); }
  }
  const archiveMatch = path.match(/^\/api\/blog\/drafts\/([^/]+)\/(archive|restore)$/);
  if (archiveMatch && request.method === "POST") {
    let payload: unknown = {};
    try { if (request.body) payload = await boundedJson(new Response(request.body)); } catch { return deskJson({ error: "invalid_request" }, 400); }
    if (!record(payload) || !Number.isSafeInteger(payload.revision) || Number(payload.revision) < 1) return deskJson({ error: "invalid_request" }, 400);
    const slug = decodeURIComponent(archiveMatch[1]);
    try { return deskJson(await (archiveMatch[2] === "archive" ? archiveDraft(env.BLOG, slug, payload.revision as number) : restoreDraft(env.BLOG, slug, payload.revision as number))); }
    catch (error) { const message = error instanceof Error ? error.message : "internal_error"; return deskJson({ error: message }, message === "not_found" ? 404 : message === "revision_conflict" ? 409 : 400); }
  }
  if (path === "/api/blog/posts" && request.method === "GET") return deskJson(await listPublished(env.BLOG, 0, 100));
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
