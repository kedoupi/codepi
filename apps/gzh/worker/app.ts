import { Hono, type Handler } from "hono";
import { handleLogout, handleRequestOtp, handleVerifyOtp, mePayload, requireAccount } from "./auth";
import { ssoEnabled, ssoErrorResponse } from "@kedoupi/shared/auth/client";
import {
  handleBoard,
  handleBoxed,
  handleGetPost,
  handlePatchPost,
  handleReleaseDemo,
  handleReview,
  handleUpsertPost,
  handleWithdraw,
} from "./desk";
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
api.onError((error) => ssoErrorResponse(error));

api.use("*", async (c, next) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method) && !sameOrigin(c.req.raw)) {
    return json({ ok: false, error: "来源无效" }, 403);
  }
  await next();
});

function getApi(path: string, handler: Handler<AppEnv>) {
  api.get(path, (c, next) => c.req.method === "GET" ? handler(c, next) : next());
}

getApi("/health", (c) => json({ ok: true, brand: c.env.ACCOUNT_BRAND || "珂抖屁", sso_enabled: ssoEnabled(c.env) }));
api.post("/auth/request-otp", (c) => handleRequestOtp(c.req.raw, c.env, createMailer(c.env)));
api.post("/auth/verify-otp", (c) => handleVerifyOtp(c.req.raw, c.env));
api.post("/auth/logout", (c) => handleLogout(c.req.raw, c.env));

api.use("*", async (c, next) => {
  const account = await requireAccount(c.env, c.req.raw);
  if (!account) {
    return json({ ok: false, error: "未登录", authenticated: false, authMode: ssoEnabled(c.env) ? "sso" : "otp" }, 401);
  }
  c.set("account", account);
  await next();
});

getApi("/me", (c) => json({
  ok: true, authenticated: true, authMode: ssoEnabled(c.env) ? "sso" : "otp",
  account: mePayload(c.get("account"), c.env),
}));
getApi("/board", (c) => handleBoard(c.req.raw, c.env));
getApi("/posts/:slug", (c) => handleGetPost(c.env, c.req.param("slug") || ""));
api.post("/posts", (c) => handleUpsertPost(c.req.raw, c.env, c.get("account")));
api.patch("/posts/:slug", (c) => handlePatchPost(c.req.raw, c.env, c.get("account"), c.req.param("slug")));
api.post("/review", (c) => handleReview(c.req.raw, c.env, c.get("account")));
api.post("/posts/:slug/boxed", (c) => handleBoxed(c.env, c.get("account"), c.req.param("slug")));
api.post("/posts/:slug/withdraw", (c) => handleWithdraw(c.env, c.get("account"), c.req.param("slug")));
api.post("/posts/:slug/release-demo", (c) => handleReleaseDemo(c.env, c.get("account"), c.req.param("slug")));
