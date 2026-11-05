import { Hono, type Handler } from "hono";
import { ssoEnabled, ssoReady, ssoErrorResponse, SsoError } from "@kedoupi/shared/auth/client";
import { authenticated, callbackSso, loginSso, logout } from "./auth";
import { applyIngest, assertNoSecrets, authenticateIngest, INGEST_BODY_LIMIT, parseIngest } from "./ingest";
import { AppError, assertKeys, bodyJson, integer, json, localDev, oneOf, text } from "./lib";
import { createProject, isProjectStatus, projectSummaries, resolveProject, rotateToken, updateProject } from "./projects";
import { NEED_KINDS, WORK_STATUSES, type Env, type NeedKind, type ProjectStatus } from "./types";
import { markOwnerDone, pickToday, todayView, unpickToday } from "./today";
import { activityLog, getTask, listTasks, overview, projectCard } from "./work";

type AppEnv = { Bindings: Env };

export const app = new Hono<AppEnv>({
  getPath: request => new URL(request.url).pathname,
});

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return json({ error: error.code, ...(error.details ? { details: error.details } : {}) }, error.status);
  }
  if (error instanceof SsoError) return ssoErrorResponse(error);
  if (error instanceof SyntaxError) return json({ error: "invalid_json" }, 400);
  return json({ error: "internal_error" }, 500);
}

app.onError(errorResponse);
app.notFound(() => new Response("Not found", { status: 404 }));

function getApi(path: string, handler: Handler<AppEnv>) {
  app.get(path, (c, next) => c.req.method === "GET" ? handler(c, next) : next());
}

app.use("*", async (c, next) => {
  if (new URL(c.req.url).protocol !== "https:" && !localDev(c.req.raw, c.env)) {
    return json({ error: "https_required" }, 403);
  }
  await next();
});

getApi("/api/health", async c => {
  const ready = await ssoReady(c.env);
  return json({
    ok: ready,
    build: c.env.BUILD_SHA || "local",
    sso_enabled: ssoEnabled(c.env),
    sso_ready: ready,
  }, ready ? 200 : 503);
});
getApi("/api/auth/login", c => loginSso(c.req.raw, c.env));
getApi("/api/auth/callback", c => callbackSso(c.req.raw, c.env));

// Machine push from a project's own repository. Bearer project token, no
// browser session and no Origin header; registered before the browser guards.
app.post("/api/ingest/:project", async c => {
  const projectId = c.req.param("project") || "";
  await authenticateIngest(c.env, projectId, c.req.header("Authorization"));
  const body = await bodyJson(c.req.raw, INGEST_BODY_LIMIT);
  assertNoSecrets(body);
  const payload = await parseIngest(body);
  return json(await applyIngest(c.env, projectId, payload));
});

app.use("*", async (c, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) &&
    c.req.header("Origin") !== new URL(c.req.url).origin) {
    return json({ error: "origin_not_allowed" }, 403);
  }
  await next();
});

app.post("/api/auth/logout", c => logout(c.req.raw, c.env));

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) {
    if (!await authenticated(c.req.raw, c.env)) {
      return json({ error: "authentication_required", authenticated: false }, 401);
    }
  }
  await next();
});

getApi("/api/me", () => json({ ok: true, authenticated: true }));

getApi("/api/overview", async c => json(await overview(c.env, { limit: 50, dated: true })));
getApi("/api/today", async c => {
  const projectRef = c.req.query("project");
  const project = projectRef === undefined ? undefined : await resolveProject(c.env, projectRef);
  return json(await todayView(c.env, new Date(), project?.id));
});


getApi("/api/tasks", async c => {
  const query = (name: string) => c.req.query(name) || undefined;
  const status = query("status");
  const need = query("need");
  const rows = await listTasks(c.env, {
    project: query("project"),
    status: status === undefined ? undefined : oneOf(status, WORK_STATUSES, "invalid_status"),
    need: need === undefined ? undefined : oneOf(need, [...NEED_KINDS, "any"] as const, "invalid_need") as NeedKind | "any",
    category: query("category"),
    includeDone: query("include_done") === "1",
  });
  return json({
    as_of: new Date().toISOString(),
    tasks: rows.map(row => ({
      project: row.project_id, key: row.key, title: row.title, status: row.status, category: row.category,
      due: row.due, need_kind: row.need_kind, done_at: row.done_at,
    })),
  });
});

getApi("/api/tasks/:project/:key", async c =>
  json(await getTask(c.env, c.req.param("project") || "", c.req.param("key") || "", 20)));

getApi("/api/projects", async c => {
  const raw = c.req.query("status");
  if (raw !== undefined && !isProjectStatus(raw)) throw new AppError("invalid_arguments", 400);
  return json({ as_of: new Date().toISOString(), projects: await projectSummaries(c.env, raw as ProjectStatus | undefined) });
});

getApi("/api/projects/:id", async c => {
  const project = await resolveProject(c.env, c.req.param("id") || "");
  return json(await projectCard(c.env, project, { changelog: 30, handoffs: 20, token: true }));
});

getApi("/api/log", async c => {
  const days = integer(c.req.query("days"), { min: 1, max: 90, fallback: 30 });
  return json(await activityLog(c.env, { days, project: c.req.query("project") || undefined }));
});

app.post("/api/today/pick", async c => {
  const body = await bodyJson(c.req.raw, 8 * 1024);
  assertKeys(body, ["project", "key"]);
  return json(await pickToday(c.env, body.project, body.key, "owner"));
});

app.post("/api/today/unpick", async c => {
  const body = await bodyJson(c.req.raw, 8 * 1024);
  assertKeys(body, ["project", "key"]);
  return json(await unpickToday(c.env, body.project, body.key));
});

app.post("/api/today/done", async c => {
  const body = await bodyJson(c.req.raw, 8 * 1024);
  assertKeys(body, ["project", "key"]);
  return json(await markOwnerDone(c.env, body.project, body.key));
});

app.post("/api/projects", async c => {
  const body = await bodyJson(c.req.raw, 8 * 1024);
  assertKeys(body, ["id", "name", "repo"]);
  return json(await createProject(c.env, { id: body.id, name: body.name, repo: body.repo }), 201);
});

app.post("/api/projects/:id/token", async c => {
  const project = await resolveProject(c.env, c.req.param("id") || "");
  return json(await rotateToken(c.env, project));
});

app.patch("/api/projects/:id", async c => {
  const project = await resolveProject(c.env, c.req.param("id") || "");
  const body = await bodyJson(c.req.raw, 8 * 1024);
  assertKeys(body, ["status", "name"]);
  const hasStatus = Object.hasOwn(body, "status");
  const hasName = Object.hasOwn(body, "name");
  if (hasStatus === hasName) throw new AppError("invalid_arguments", 400);
  if (hasStatus && !isProjectStatus(body.status)) throw new AppError("invalid_status", 400);
  const updated = await updateProject(c.env, project, {
    ...(hasStatus ? { status: body.status as ProjectStatus } : {}),
    ...(hasName ? { name: text(body.name, "invalid_name", { max: 120 })! } : {}),
  });
  return json({ ok: true, project: { id: updated.id, name: updated.name, status: updated.status } });
});

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return json({ error: "not_found" }, 404);
  await next();
});

app.get("/robots.txt", () => new Response("User-agent: *\nDisallow: /\n"));

function indexAsset(request: Request, env: Env) {
  if (!env.ASSETS) return new Response("Assets unavailable", { status: 503 });
  const origin = new URL(request.url).origin;
  return env.ASSETS.fetch(new Request(`${origin}/`, { method: request.method }));
}

app.on(["GET", "HEAD"], ["/login"], c => indexAsset(c.req.raw, c.env));

app.on(["GET", "HEAD"], ["/", "/board", "/log", "/p/:id"], async c => {
  if (!await authenticated(c.req.raw, c.env)) {
    const target = new URL("/login", c.req.url);
    target.searchParams.set("return", `${c.req.path}${new URL(c.req.url).search}`);
    return Response.redirect(target.href, 302);
  }
  return indexAsset(c.req.raw, c.env);
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
    return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound();
  }
  return c.notFound();
});
