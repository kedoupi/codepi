import type { Env } from "../env";
import {
  allowDevLogin,
  jsonError,
  oauthConfigured,
  resolveSessionSecret,
} from "../lib/config";
import { readSessionFromRequest } from "../lib/session";
import {
  isEntitled,
  loadLocalePref,
  loadSubscription,
  PLACEHOLDER_PRICE_LABEL,
  stripeConfigured,
} from "../lib/subscription";

/** GET /api/me — session status for the login gate + billing/locale extras. */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const secret = resolveSessionSecret(request, env);
  if (!secret) {
    return jsonError("SESSION_SECRET not configured", 503);
  }

  const session = await readSessionFromRequest(request, env, secret);
  const sub = session ? await loadSubscription(env, session.user_id) : null;
  const localePref = session ? await loadLocalePref(env, session.user_id) : null;

  return Response.json({
    authenticated: Boolean(session),
    source: session?.kind ?? null,
    userId: session?.user_id ?? null,
    allowDevLogin: allowDevLogin(request, env),
    oauthConfigured: oauthConfigured(env),
    subscribed: isEntitled(sub?.status),
    subscriptionStatus: sub?.status ?? null,
    localePref,
    stripeConfigured: stripeConfigured(env),
    priceLabel: PLACEHOLDER_PRICE_LABEL,
  });
}
