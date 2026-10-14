import type { Env } from "../env";
import { requireSession, isResponse } from "../lib/authz";
import { ApiError } from "../lib/errors.ts";
import { healthStatus, healthWindow, readHealthRecords, syncHealthWindow } from "../lib/health-records.ts";

export async function handleHealthRecords(request: Request, env: Env): Promise<Response> {
  const auth = await requireSession(request, env);
  if (isResponse(auth)) return auth;
  if (auth.session.kind !== "oauth" || !env.PERSONAL_OWNER_ID || auth.session.user_id !== env.PERSONAL_OWNER_ID) {
    throw new ApiError("not_owner", 403);
  }
  const url = new URL(request.url);
  if (url.pathname.endsWith("/status")) {
    if (request.method !== "GET") throw new ApiError("method_not_allowed", 405);
    return Response.json({ collections: await healthStatus(env, auth.session.user_id) });
  }
  if (!["GET", "POST"].includes(request.method)) throw new ApiError("method_not_allowed", 405);
  const w = healthWindow(url.searchParams.get("collection"), url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new ApiError("invalid_offset", 400);
  if (request.method === "POST") await syncHealthWindow(request, env, auth.session.user_id, w, true);
  return Response.json(await readHealthRecords(env, auth.session.user_id, w,
    offset, url.searchParams.get("include_series") === "true"));
}
