import { Hono } from "hono";
import { handleLogout, handleRequestOtp, handleVerifyOtp, mePayload, requireAccount } from "./auth";
import {
  handleBoard,
  handleBoxed,
  handleDiscard,
  handleRead,
  handleGetPost,
  handlePatchPost,
  handleReleaseDemo,
  handleReview,
  handleUpsertPost,
  handleWithdraw,
} from "./desk";
import { handleLegacyPutArticle, handleLegacyReview } from "./legacy";
import { serveContent, serveCover } from "./content";
import { timingSafeEqual } from "./crypto";
import { json, sameOrigin } from "./lib";
import { createMailer } from "./mail";
import type { AuthedAccount } from "./types";

type AppEnv = {
  Bindings: Env;
  Variables: {
    account: AuthedAccount;
  };
};

export const api = new Hono<AppEnv>();

export const SUBMIT_BOT_ID = "acc_submit_bot";

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1]! : null;
}

/** 交稿 token 只能碰编辑类接口；审核、登录态接口一律不开放。 */
function tokenRouteAllowed(method: string, path: string): boolean {
  if (method === "GET") return path === "/board" || path === "/me" || /^\/posts\/[^/]+(\/(content\/(cover\.png)?)?)?$/.test(path);
  if (method === "POST") return path === "/posts" || path === "/review" || /^\/posts\/[^/]+\/(boxed|withdraw|discard)$/.test(path);
  if (method === "PATCH") return /^\/posts\/[^/]+$/.test(path);
  if (method === "PUT") return /^\/articles\/[^/]+$/.test(path);
  return false;
}

api.use("*", async (c, next) => {
  // Bearer 不随浏览器自动携带，没有 CSRF 面；同源检查只管 Cookie 会话。
  if (bearerToken(c.req.raw)) {
    await next();
    return;
  }
  if (["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method) && !sameOrigin(c.req.raw)) {
    return json({ ok: false, error: "来源无效" }, 403);
  }
  await next();
});

api.get("/health", (c) => json({ ok: true, brand: c.env.ACCOUNT_BRAND || "珂抖屁" }));

api.post("/auth/request-otp", (c) => handleRequestOtp(c.req.raw, c.env, createMailer(c.env)));
api.post("/auth/verify-otp", (c) => handleVerifyOtp(c.req.raw, c.env));
api.post("/auth/logout", (c) => handleLogout(c.req.raw, c.env));

api.use("*", async (c, next) => {
  const token = bearerToken(c.req.raw);
  if (token) {
    const expected = c.env.SUBMIT_TOKEN;
    if (!expected || expected.length < 24 || !timingSafeEqual(token, expected)) {
      return json({ ok: false, error: "token 无效" }, 401);
    }
    if (!tokenRouteAllowed(c.req.method, c.req.path)) {
      return json({ ok: false, error: "token 不能调用这个接口" }, 403);
    }
    const bot = await c.env.DB.prepare(
      `SELECT id, email, display_name, role, active FROM accounts WHERE id = ? AND active = 1`,
    )
      .bind(SUBMIT_BOT_ID)
      .first<AuthedAccount>();
    if (!bot) return json({ ok: false, error: "交稿账号未初始化" }, 503);
    c.set("account", bot);
    await next();
    return;
  }
  const account = await requireAccount(c.env, c.req.raw);
  if (!account) {
    return json({ ok: false, error: "未登录" }, 401);
  }
  c.set("account", account);
  await next();
});

api.get("/me", (c) => json({ ok: true, account: mePayload(c.get("account"), c.env) }));
api.get("/board", (c) => handleBoard(c.req.raw, c.env));
api.get("/posts/:slug/content/", (c) => serveContent(c.env, c.req.param("slug")));
api.get("/posts/:slug/content/cover.png", (c) => serveCover(c.env, c.req.param("slug")));
api.get("/posts/:slug", (c) => handleGetPost(c.env, c.req.param("slug")));
api.post("/posts", (c) => handleUpsertPost(c.req.raw, c.env, c.get("account")));
api.patch("/posts/:slug", (c) => handlePatchPost(c.req.raw, c.env, c.get("account"), c.req.param("slug")));
api.post("/review", async (c) => {
  // 旧 gzh-preview 形状（有 id、没有 slug）走兼容层
  const raw = c.req.raw;
  let body: Record<string, unknown> | null = null;
  try {
    body = (await raw.clone().json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (body && typeof body === "object" && body.id != null && body.slug == null) {
    return handleLegacyReview(raw, c.env, c.get("account"), body);
  }
  return handleReview(raw, c.env, c.get("account"));
});
api.put("/articles/:id", (c) => handleLegacyPutArticle(c.req.raw, c.env, c.get("account"), c.req.param("id")));
api.post("/posts/:slug/read", (c) => handleRead(c.env, c.get("account"), c.req.param("slug")));
api.post("/posts/:slug/boxed", (c) => handleBoxed(c.env, c.get("account"), c.req.param("slug")));
api.post("/posts/:slug/discard", (c) => handleDiscard(c.req.raw, c.env, c.get("account"), c.req.param("slug")));
api.post("/posts/:slug/withdraw", (c) => handleWithdraw(c.env, c.get("account"), c.req.param("slug")));
api.post("/posts/:slug/release-demo", (c) => handleReleaseDemo(c.env, c.get("account"), c.req.param("slug")));
