import { Hono, type Handler } from "hono";
import { ssoEnabled, ssoReady, ssoErrorResponse, SsoError } from "@kedoupi/shared/auth/client";
import { authenticated, callbackSso, loginSso, logout } from "./auth";
import { buildCard } from "./card";
import { syncProject, SyncTooFrequent } from "./github";
import { handoffPage, parseHandoffInput, saveHandoff } from "./handoffs";
import {
  AppError,
  assertKeys,
  bodyJson,
  integer,
  json,
  localDev,
  oneOf,
  projectUrl,
  text,
} from "./lib";
import {
  isConfiguredForSync,
  isProjectStatus,
  listProjects,
  resolveProject,
  updateProject,
} from "./projects";
import type { Env, ProjectStatus } from "./types";

type AppEnv = { Bindings: Env };
const HANDOFF_BODY_LIMIT = 128 * 1024;

export const app = new Hono<AppEnv>({
  getPath: request => new URL(request.url).pathname,
});

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return json({ error: error.code }, error.status);
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

getApi("/api/projects", async c => {
  const raw = c.req.query("status");
  if (raw !== undefined && !isProjectStatus(raw)) {
    throw new AppError("invalid_arguments", 400);
  }
  return json(await listProjects(c.env, raw as ProjectStatus | undefined));
});

getApi("/api/projects/:id/handoffs", async c => {
  const project = await resolveProject(c.env, c.req.param("id") || "");
  const limit = integer(c.req.query("limit"), { min: 1, max: 50, fallback: 20 });
  return json(await handoffPage(c.env, project.id, {
    before: c.req.query("before") || null,
    beforeId: c.req.query("before_id") || null,
    limit,
  }));
});

getApi("/api/projects/:id", async c => {
  const project = await resolveProject(c.env, c.req.param("id") || "");
  const handoffs = integer(c.req.query("handoffs"), { min: 1, max: 20, fallback: 20 });
  const taskId = c.req.query("task_id") || undefined;
  return json(await buildCard(c.env, project, { handoffs, taskId }));
});

app.patch("/api/projects/:id/card", async c => {
  const project = await resolveProject(c.env, c.req.param("id") || "");
  const body = await bodyJson(c.req.raw, 32 * 1024);
  assertKeys(body, ["field", "value"]);
  const field = oneOf(body.field, ["goal", "scope", "conventions", "pitfalls"], "invalid_field");
  if (!Object.hasOwn(body, "value")) throw new AppError("invalid_value", 400);
  if (body.value !== null && typeof body.value !== "string") {
    throw new AppError("invalid_value", 400);
  }
  if (body.value === null) {
    await c.env.DB.prepare(`UPDATE card_fields SET edited_value=NULL,
      edited_base_sha=NULL, edited_at=NULL WHERE project_id=? AND field=?`)
      .bind(project.id, field).run();
  } else {
    const value = text(body.value, "invalid_value", { max: 4000 })!;
    const row = await c.env.DB.prepare(
      "SELECT auto_sha FROM card_fields WHERE project_id=? AND field=?",
    ).bind(project.id, field).first<{ auto_sha: string | null }>();
    await c.env.DB.prepare(`INSERT INTO card_fields
      (project_id,field,edited_value,edited_base_sha,edited_at) VALUES (?,?,?,?,?)
      ON CONFLICT(project_id,field) DO UPDATE SET edited_value=excluded.edited_value,
        edited_base_sha=excluded.edited_base_sha, edited_at=excluded.edited_at`)
      .bind(project.id, field, value, row?.auto_sha || null, new Date().toISOString()).run();
  }
  return json({ ok: true });
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
  return json({ ok: true, project: updated });
});

app.post("/api/projects/:id/handoffs", async c => {
  const project = await resolveProject(c.env, c.req.param("id") || "");
  const body = await bodyJson(c.req.raw, HANDOFF_BODY_LIMIT);
  const input = parseHandoffInput(body, {
    projectId: project.id,
    clientId: "web",
    clientName: "项目看板",
    via: "web",
  });
  const result = await saveHandoff(c.env, input);
  return json({
    id: result.handoff.id,
    project: project.id,
    task_id: result.handoff.task_id,
    status: result.handoff.status,
    created_at: result.handoff.at,
    url: projectUrl(c.env, project.id),
    deduplicated: result.deduplicated,
  }, result.deduplicated ? 200 : 201);
});

app.post("/api/projects/:id/sync", async c => {
  const project = await resolveProject(c.env, c.req.param("id") || "");
  if (!isConfiguredForSync(c.env, project.repo)) {
    throw new AppError("project_not_syncable", 409);
  }
  try {
    return json(await syncProject(c.env, project));
  } catch (error) {
    if (!(error instanceof SyncTooFrequent)) throw error;
    return json({
      error: "sync_too_frequent",
      retry_after: error.retryAfter,
    }, 429, {
      "Retry-After": String(error.retryAfter),
    });
  }
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

app.on(["GET", "HEAD"], ["/", "/p/:id"], async c => {
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
