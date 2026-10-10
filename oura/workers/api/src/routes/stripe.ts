import type { Env } from "../env";
import { isResponse, requireSession } from "../lib/authz";
import { frontendOrigin, jsonError } from "../lib/config";
import {
  buildCheckoutFields,
  paymentMethodDocs,
  stripePost,
  verifyStripeSignature,
} from "../lib/stripe";
import { applyStripeEvent, type StripeEvent } from "../lib/stripe-events";
import {
  loadSubscription,
  loadUserEmail,
  stripeConfigured,
} from "../lib/subscription";

const noStore = { "Cache-Control": "no-store" };

/** POST /api/stripe/checkout — authenticated; returns hosted Checkout URL. */
export async function handleStripeCheckout(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonError("method not allowed", 405);
  }
  const auth = await requireSession(request, env);
  if (isResponse(auth)) return auth;
  if (!stripeConfigured(env)) {
    return jsonError("stripe_not_configured", 503, {
      hint: "Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID via wrangler secret put",
      paymentMethods: paymentMethodDocs(),
    });
  }

  const existing = await loadSubscription(env, auth.session.user_id);
  const email = await loadUserEmail(env, auth.session.user_id);
  const origin = frontendOrigin(request, env);
  let locale: string | null = null;
  try {
    const body = (await request.json()) as { locale?: string };
    if (body.locale === "zh" || body.locale === "en") locale = body.locale;
  } catch {
    // empty body is fine
  }

  const { fields, payment } = buildCheckoutFields({
    env,
    userId: auth.session.user_id,
    successUrl: `${origin}/insights?checkout=success`,
    cancelUrl: `${origin}/insights?checkout=cancel`,
    customerId: existing?.stripe_customer_id,
    customerEmail: email,
    locale,
  });

  const result = await stripePost(env, "/checkout/sessions", fields);
  const url = typeof result.json.url === "string" ? result.json.url : null;
  if (!result.ok || !url) {
    return Response.json(
      {
        error: "checkout_failed",
        status: result.status,
        detail: result.json.error ?? result.json,
        payment,
        paymentMethods: paymentMethodDocs(),
      },
      { status: result.status >= 400 ? result.status : 502, headers: noStore },
    );
  }
  return Response.json({ ok: true, url, payment }, { headers: noStore });
}

/** POST /api/stripe/portal — Customer Portal for cancel / payment method. */
export async function handleStripePortal(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonError("method not allowed", 405);
  }
  const auth = await requireSession(request, env);
  if (isResponse(auth)) return auth;
  if (!env.STRIPE_SECRET_KEY) {
    return jsonError("stripe_not_configured", 503);
  }
  const existing = await loadSubscription(env, auth.session.user_id);
  if (!existing?.stripe_customer_id) {
    return jsonError("no_stripe_customer", 400, {
      hint: "Subscribe once via Checkout before opening the portal",
    });
  }
  const result = await stripePost(env, "/billing_portal/sessions", {
    customer: existing.stripe_customer_id,
    return_url: `${frontendOrigin(request, env)}/settings`,
  });
  const url = typeof result.json.url === "string" ? result.json.url : null;
  if (!result.ok || !url) {
    return Response.json(
      { error: "portal_failed", detail: result.json.error ?? result.json },
      { status: result.status >= 400 ? result.status : 502, headers: noStore },
    );
  }
  return Response.json({ ok: true, url }, { headers: noStore });
}

/**
 * POST /api/stripe/webhook
 * Production URL: https://oura.kdp.cool/api/stripe/webhook
 * Must verify Stripe-Signature against the raw body.
 */
export async function handleStripeWebhook(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonError("method not allowed", 405);
  }
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return jsonError("STRIPE_WEBHOOK_SECRET not configured", 503);
  }
  const payload = await request.text();
  const header = request.headers.get("Stripe-Signature");
  const ok = await verifyStripeSignature(payload, header, secret);
  if (!ok) {
    return jsonError("invalid_signature", 400);
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return jsonError("invalid_json", 400);
  }
  await applyStripeEvent(env, event);
  return Response.json({ received: true });
}
