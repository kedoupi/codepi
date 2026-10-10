import type { Env } from "../env";
import {
  jsonError,
  resolveSessionSecret,
} from "../lib/config";
import { clampDays } from "../lib/daily";
import { readSessionFromRequest } from "../lib/session";

const KEDOUPI_BOARD_AI_URL = "https://api.xiaotaozi.cc/oura/ai";

/**
 * GET /api/me/ai?days=7|30|90&now= — session-gated.
 * DEV proxies the personal board AI (kedoupi) so the drawer lights up
 * with the same dataset as /api/me/daily. Per-user OAuth AI is not ready.
 */
export async function handleMeAi(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const days = clampDays(Number(url.searchParams.get("days") ?? "7"));
  const now = url.searchParams.get("now") ?? new Date().toISOString();

  const secret = resolveSessionSecret(request, env);
  if (!secret) {
    return jsonError("SESSION_SECRET not configured", 503);
  }

  const session = await readSessionFromRequest(request, env, secret);
  if (!session) {
    return jsonError("unauthorized", 401, {
      hint: "Login with Oura, or GET /api/auth/dev/session on localhost",
    });
  }

  if (session.kind !== "dev") {
    return jsonError("ai_not_ready", 501, {
      hint: "Per-user AI needs OAuth-scoped /api/me/ai. DEV drawer uses the kedoupi board dataset.",
    });
  }

  const upstream = new URL(KEDOUPI_BOARD_AI_URL);
  upstream.searchParams.set("user_id", "kedoupi");
  upstream.searchParams.set("days", String(days));
  upstream.searchParams.set("now", now);

  try {
    const res = await fetch(upstream.toString(), {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonError("ai_upstream_failed", 502, {
      hint: err instanceof Error ? err.message : "board AI unreachable",
    });
  }
}
