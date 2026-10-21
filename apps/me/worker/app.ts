import { Hono, type Handler } from "hono";
import { ssoEnabled, ssoReady, SsoError } from "@kedoupi/shared/auth/client";
import { authenticated, callback, login, logout } from "./auth";
import { AppError, bodyJson, integer, json, normalizeTags, optionalQuery, optionalText, requiredText,
  validateDatePart, validateImportId, validateMemoryKind, validateMemoryStatus, validateProfileKey,
  validateTimelineKind, validateTimelineStatus, isoNow, ulid, MAX_RPC_BYTES } from "./lib";
import { safeError } from "./mcp";
import { archiveActiveMemory, archiveActiveTimeline, editActiveMemory, editActiveTimeline, createTimeline,
  listImports, listMemories, listProfile, listProfileProposals, listTimeline, overview, reviewImportMemories, reviewMemory,
  reviewProfileProposal, reviewTimeline, timelineDetail, upsertProfile, deleteProfile } from "./data";
import { endOf, inputObject, memoryInput, noSecrets, timelineInput, timelineKeys } from "./validation";
import { finishImport, pasteImport } from "./imports";
import type { Env } from "./types";

type AppEnv = { Bindings: Env };
export const app = new Hono<AppEnv>({ getPath: request => new URL(request.url).pathname });
export function errorResponse(error: unknown) {
  const result = error instanceof SsoError ? { error: error.code, status: error.status } : safeError(error);
  return json({ error: result.error }, result.status);
}
app.onError(errorResponse);
function get(path: string, handler: Handler<AppEnv>) {
  app.get(path, (c, next) => c.req.method === "GET" ? handler(c, next) : next());
}
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.protocol !== "https:" && !(["development", "test"].includes(c.env.ENVIRONMENT ?? "")
    && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return json({ error: "https_required" }, 403);
  await next();
});
get("/api/health", async c => {
  const ready = await ssoReady(c.env);
  return json({ ok: ready, source: "me", build: c.env.BUILD_SHA || "local",
    sso_enabled: ssoEnabled(c.env), sso_ready: ready }, ready ? 200 : 503);
});
get("/api/auth/login", c => login(c.req.raw, c.env));
get("/api/auth/callback", c => callback(c.req.raw, c.env));
app.use("*", async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) && c.req.header("Origin") !== new URL(c.req.url).origin) {
    return json({ error: "origin_not_allowed" }, 403);
  }
  await next();
});
app.post("/api/auth/logout", c => logout(c.req.raw, c.env));
app.use("/api/*", async (c, next) => {
  if (!await authenticated(c.req.raw, c.env)) return json({ error: "unauthorized", authenticated: false }, 401);
  await next();
});
get("/api/me", () => json({ authenticated: true }));
get("/api/overview", async c => json(await overview(c.env)));

function paging(url: URL) {
  return { limit: integer(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined, "limit", 1, 100, 20),
    offset: integer(url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined, "offset", 0, Number.MAX_SAFE_INTEGER, 0) };
}
get("/api/memories", async c => {
  const url = new URL(c.req.url), { offset, limit } = paging(url);
  return json(await listMemories(c.env, {
    status: validateMemoryStatus(url.searchParams.get("status")) ?? "active",
    query: optionalQuery(url.searchParams.get("query")) ?? undefined,
    kind: validateMemoryKind(url.searchParams.get("kind")) ?? undefined,
    tags: normalizeTags(url.searchParams.getAll("tag")),
    source: optionalText(url.searchParams.get("source"), "来源", 200) ?? undefined, reviewableOnly: true,
  }, limit, offset));
});
app.post("/api/memories", async c => {
  const input = memoryInput(await bodyJson(c.req.raw, MAX_RPC_BYTES)), id = ulid(), now = isoNow();
  await c.env.DB.prepare(`INSERT INTO memories
    (id,status,kind,text,tags,source_client,source_name,created_at,updated_at,reviewed_at)
    VALUES (?,'active',?,?,?,'board','本人',?,?,?)`)
    .bind(id, input.kind, input.text, JSON.stringify(input.tags), now, now, now).run();
  return json({ id, status: "active" }, 201);
});
app.post("/api/memories/:id/review", async c => {
  const args = inputObject(await bodyJson(c.req.raw, MAX_RPC_BYTES), ["action", "text", "kind", "tags"]);
  const action = reviewAction(args.action);
  const { action: _action, ...fields } = args;
  if (action !== "edit_approve") inputObject(fields, []);
  const result = await reviewMemory(c.env, validateImportId(c.req.param("id")), action,
    action === "edit_approve" ? memoryInput(fields) : undefined);
  if (!result) throw new AppError("not_pending_or_import_unfinished", 409);
  return json(result);
});
app.put("/api/memories/:id", async c => {
  const result = await editActiveMemory(c.env, validateImportId(c.req.param("id")), memoryInput(await bodyJson(c.req.raw, MAX_RPC_BYTES)));
  if (!result) throw new AppError("not_active", 409);
  return json(result);
});
app.post("/api/memories/:id/archive", async c => {
  inputObject(await bodyJson(c.req.raw, 1024), []);
  const result = await archiveActiveMemory(c.env, validateImportId(c.req.param("id")));
  if (!result) throw new AppError("not_active", 409);
  return json(result);
});
get("/api/profile", async c => {
  const { offset, limit } = paging(new URL(c.req.url));
  return json(await listProfile(c.env, limit, offset));
});
app.put("/api/profile/:key", async c => {
  const args = inputObject(await bodyJson(c.req.raw, MAX_RPC_BYTES), ["value"]);
  const key = validateProfileKey(c.req.param("key")), value = requiredText(args.value, "背景内容", 2000);
  noSecrets(key, value);
  return json(await upsertProfile(c.env, key, value));
});
app.delete("/api/profile/:key", async c => json({ deleted: await deleteProfile(c.env, validateProfileKey(c.req.param("key"))) }));
get("/api/profile/proposals", async c => {
  const { limit, offset } = paging(new URL(c.req.url));
  return json(await listProfileProposals(c.env, "pending", limit, offset));
});
app.post("/api/profile/proposals/:id/review", async c => {
  const args = inputObject(await bodyJson(c.req.raw, MAX_RPC_BYTES), ["action", "value"]);
  const action = reviewAction(args.action);
  const value = action === "edit_approve" ? requiredText(args.value, "背景内容", 2000) : undefined;
  if (action !== "edit_approve") inputObject(args, ["action"]);
  if (value) noSecrets(value);
  if (!await reviewProfileProposal(c.env, validateImportId(c.req.param("id")), action, value)) throw new AppError("not_pending", 409);
  return json({ ok: true });
});
get("/api/timeline", async c => {
  const url = new URL(c.req.url), { offset, limit } = paging(url);
  const from = validateDatePart(url.searchParams.get("from"), "开始日期"), to = validateDatePart(url.searchParams.get("to"), "结束日期");
  if (from && to && from > endOf(to)) throw new AppError("invalid_date_range", 400);
  return json(await listTimeline(c.env, { status: validateTimelineStatus(url.searchParams.get("status")) ?? "active",
    kind: validateTimelineKind(url.searchParams.get("kind")) ?? undefined, query: optionalQuery(url.searchParams.get("query")) ?? undefined,
    from: from ?? undefined, to: to ? endOf(to) : undefined }, limit, offset));
});
get("/api/timeline/:id", async c => {
  const result = await timelineDetail(c.env, validateImportId(c.req.param("id")));
  if (!result) throw new AppError("not_found", 404);
  return json(result);
});
app.post("/api/timeline", async c => json({ id: await createTimeline(c.env,
  timelineInput(await bodyJson(c.req.raw, 32 * 1024)), "active", "board", "本人") }, 201));
app.put("/api/timeline/:id", async c => {
  if (!await editActiveTimeline(c.env, validateImportId(c.req.param("id")), timelineInput(await bodyJson(c.req.raw, 32 * 1024)))) {
    throw new AppError("not_active", 409);
  }
  return json({ ok: true });
});
app.post("/api/timeline/:id/archive", async c => {
  inputObject(await bodyJson(c.req.raw, 1024), []);
  if (!await archiveActiveTimeline(c.env, validateImportId(c.req.param("id")))) {
    throw new AppError("not_active", 409);
  }
  return json({ ok: true });
});
app.post("/api/timeline/:id/review", async c => {
  const args = inputObject(await bodyJson(c.req.raw, 32 * 1024), ["action", ...timelineKeys]);
  const action = reviewAction(args.action), { action: _action, ...fields } = args;
  if (action !== "edit_approve") inputObject(fields, []);
  if (!await reviewTimeline(c.env, validateImportId(c.req.param("id")), action,
    action === "edit_approve" ? timelineInput(fields) : undefined)) throw new AppError("not_pending", 409);
  return json({ ok: true });
});
get("/api/imports", async c => {
  const { offset, limit } = paging(new URL(c.req.url));
  return json(await listImports(c.env, limit, offset));
});
app.post("/api/imports/paste", async c => json(await pasteImport(c.env, await bodyJson(c.req.raw, 620 * 1024))));
app.post("/api/imports/:id/finish", async c => {
  inputObject(await bodyJson(c.req.raw, 1024), []);
  // Owner may retry a failed finish, preserving the import's original client.
  const id = validateImportId(c.req.param("id"));
  const row = await c.env.DB.prepare("SELECT source_client,source_name FROM import_sessions WHERE id=?")
    .bind(id).first<{ source_client: string; source_name: string | null }>();
  if (!row) throw new AppError("not_found", 404);
  return json(await finishImport(c.env, { client: row.source_client, name: row.source_name }, { import_id: id }));
});
app.post("/api/imports/:id/review", async c => {
  const args = inputObject(await bodyJson(c.req.raw, 1024), ["action"]);
  if (args.action !== "approve" && args.action !== "reject") throw new AppError("invalid_action", 400);
  return json({ changed: await reviewImportMemories(c.env, validateImportId(c.req.param("id")), args.action) });
});

function reviewAction(value: unknown): "approve" | "edit_approve" | "reject" {
  if (value !== "approve" && value !== "edit_approve" && value !== "reject") throw new AppError("invalid_action", 400);
  return value;
}
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return json({ error: "not_found" }, 404);
  if (!["GET", "HEAD"].includes(c.req.method)) return new Response("Method not allowed", { status: 405 });
  await next();
});
app.get("/robots.txt", () => new Response("User-agent: *\nDisallow: /\n"));
app.on(["GET", "HEAD"], ["/", "/profile", "/timeline", "/imports", "/login"], async c => {
  const origin = new URL(c.req.url).origin;
  if (c.req.path !== "/login" && !await authenticated(c.req.raw, c.env)) {
    return Response.redirect(`${origin}/login?return=${encodeURIComponent(c.req.path)}`, 302);
  }
  return c.env.ASSETS?.fetch(new Request(`${origin}/`, { method: c.req.method }))
    ?? new Response("Assets unavailable", { status: 503 });
});
const PUBLIC_BRAND_ASSETS = new Set([
  "/favicon.ico",
  "/favicon-16.png",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/brand/codepi-symbol.png",
  "/brand/codepi-symbol.webp",
]);

app.get("*", c => {
  if (/^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|svg|png|webp|woff2)$/.test(c.req.path) ||
    PUBLIC_BRAND_ASSETS.has(c.req.path)) {
    return c.env.ASSETS?.fetch(c.req.raw) ?? c.notFound();
  }
  return c.notFound();
});
