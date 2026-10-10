import type { Env } from "../env";
import { isResponse, requireSession } from "../lib/authz";
import { jsonError } from "../lib/config";
import { normalizeLocalePref, saveLocalePref } from "../lib/subscription";

/** PUT /api/me/prefs — persist language override (system | zh | en). */
export async function handleMePrefs(request: Request, env: Env): Promise<Response> {
  if (request.method !== "PUT" && request.method !== "POST") {
    return jsonError("method not allowed", 405);
  }
  const auth = await requireSession(request, env);
  if (isResponse(auth)) return auth;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_json", 400);
  }
  const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const locale = normalizeLocalePref(rec.locale);
  if (!locale) {
    return jsonError("invalid_locale", 400, { hint: "locale must be system | zh | en" });
  }
  await saveLocalePref(env, auth.session.user_id, locale);
  return Response.json({ ok: true, locale });
}
