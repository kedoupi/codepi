import type { Env } from "./env";
import { allowDevLogin, oauthConfigured } from "./lib/config";
import { ApiError } from "./lib/errors.ts";
import { API_CONTRACT, RELEASE } from "./lib/version.ts";
import {
  handleDevSession,
  handleLogout,
  handleOuraCallback,
  handleOuraStart,
} from "./routes/auth";
import { handleMeAi } from "./routes/ai";
import { handleMeDaily } from "./routes/daily";
import { handleDevSubscription } from "./routes/dev-sub";
import { handleCompareInsights, handleWeeklyInsights } from "./routes/insights";
import { handleMe } from "./routes/me";
import { handleMePrefs } from "./routes/prefs";
import {
  handleStripeCheckout,
  handleStripePortal,
  handleStripeWebhook,
} from "./routes/stripe";

function cors(req: Request, env: Env): HeadersInit {
  const origin = req.headers.get("Origin");
  const allowed = origin === new URL(req.url).origin || origin === env.FRONTEND_ORIGIN;
  if (!origin || !allowed) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Stripe-Signature",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin && origin !== env.FRONTEND_ORIGIN) {
      return Response.json({ error: "origin_not_allowed", requestId }, { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request, env) });
    }

    try {
      let res: Response;
      switch (url.pathname) {
        case "/api/auth/oura/start":
          res = await handleOuraStart(request, env);
          break;
        case "/api/auth/oura/callback":
          res = await handleOuraCallback(request, env);
          break;
        case "/api/auth/dev/session":
          res = await handleDevSession(request, env);
          break;
        case "/api/auth/logout":
          res = await handleLogout(request, env);
          break;
        case "/api/me":
          res = await handleMe(request, env);
          break;
        case "/api/me/prefs":
          res = await handleMePrefs(request, env);
          break;
        case "/api/me/daily":
        case "/api/me/sync":
          res = await handleMeDaily(request, env);
          break;
        case "/api/me/ai":
          res = await handleMeAi(request, env);
          break;
        case "/api/me/insights/weekly":
          res = await handleWeeklyInsights(request, env);
          break;
        case "/api/me/insights/compare":
          res = await handleCompareInsights(request, env);
          break;
        case "/api/stripe/checkout":
          res = await handleStripeCheckout(request, env);
          break;
        case "/api/stripe/portal":
          res = await handleStripePortal(request, env);
          break;
        case "/api/stripe/webhook":
          res = await handleStripeWebhook(request, env);
          break;
        case "/api/dev/subscription":
          res = await handleDevSubscription(request, env);
          break;
        case "/api/health":
          res = Response.json({
            ok: true,
            service: "oura-kdp-api",
            allowDevLogin: allowDevLogin(request, env),
            oauthConfigured: oauthConfigured(env),
            apiContract: API_CONTRACT,
            release: RELEASE,
            build: env.BUILD_SHA ?? "local",
          });
          break;
        default:
          res = Response.json({ error: "not found" }, { status: 404 });
      }

      const headers = new Headers(res.headers);
      headers.set("Cache-Control", "no-store");
      headers.set("X-Request-ID", requestId);
      for (const [k, v] of Object.entries(cors(request, env))) {
        if (!headers.has(k)) headers.set(k, v);
      }
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      return Response.json(
        { error: err instanceof ApiError ? err.code : "internal_error", requestId },
        { status: err instanceof ApiError ? err.status : 500, headers: { ...cors(request, env), "Cache-Control": "no-store", "X-Request-ID": requestId } },
      );
    }
  },
} satisfies ExportedHandler<Env>;
