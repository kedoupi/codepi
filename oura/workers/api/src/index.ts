import type { Env } from "./env";
import { allowDevLogin, oauthConfigured } from "./lib/config";
import { ensureSchema } from "./lib/schema";
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

function cors(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Stripe-Signature",
    "Access-Control-Allow-Credentials": "true",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    try {
      if (url.pathname.startsWith("/api/")) {
        await ensureSchema(env);
      }
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
          });
          break;
        default:
          res = Response.json({ error: "not found" }, { status: 404 });
      }

      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors(request))) {
        if (!headers.has(k)) headers.set(k, v);
      }
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "internal error" },
        { status: 500, headers: cors(request) },
      );
    }
  },
} satisfies ExportedHandler<Env>;
