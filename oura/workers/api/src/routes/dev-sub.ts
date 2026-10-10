import type { Env } from "../env";
import { isResponse, requireSession } from "../lib/authz";
import { allowDevLogin, jsonError } from "../lib/config";
import { loadSubscription, upsertSubscription } from "../lib/subscription";

/**
 * POST /api/dev/subscription { entitled: boolean }
 * Preview-only: toggle a local grant so paywall can be click-tested without Stripe.
 * Production oura.kdp.cool must keep ALLOW_DEV_LOGIN unset.
 */
export async function handleDevSubscription(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") return jsonError("method not allowed", 405);
  if (!allowDevLogin(request, env)) {
    return jsonError("not_found", 404);
  }
  const auth = await requireSession(request, env);
  if (isResponse(auth)) return auth;
  let entitled = true;
  try {
    const body = (await request.json()) as { entitled?: boolean };
    if (typeof body.entitled === "boolean") entitled = body.entitled;
  } catch {
    // default grant
  }
  const existing = await loadSubscription(env, auth.session.user_id);
  await upsertSubscription(env, {
    user_id: auth.session.user_id,
    stripe_customer_id: existing?.stripe_customer_id ?? null,
    stripe_subscription_id: existing?.stripe_subscription_id ?? null,
    status: entitled ? "dev_grant" : "none",
    current_period_end: existing?.current_period_end ?? null,
    price_id: existing?.price_id ?? null,
  });
  return Response.json({ ok: true, subscribed: entitled, status: entitled ? "dev_grant" : "none" });
}
