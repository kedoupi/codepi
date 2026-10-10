import type { Env } from "../env";
import { jsonError, resolveSessionSecret } from "./config";
import { readSessionFromRequest, type SessionRow } from "./session";

export async function requireSession(
  request: Request,
  env: Env,
): Promise<{ session: SessionRow } | Response> {
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
  return { session };
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
