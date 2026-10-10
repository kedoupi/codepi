import type { Env } from "../env";

const STRIPE_API = "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_SEC = 300;

export type PaymentMethodConfig =
  | { mode: "automatic"; types: string[] }
  | { mode: "explicit"; types: string[] };

const WALLET_NOTE =
  "Alipay / WeChat Pay need Dashboard enablement and usually do not work on Checkout mode=subscription.";

export function envFlagOn(value: string | undefined): boolean {
  const v = (value ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Card is always offered. Wallets are env-gated and may be rejected by Stripe. */
export function resolvePaymentMethodConfig(env: Env): PaymentMethodConfig {
  const listed = (env.STRIPE_PAYMENT_METHOD_TYPES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const types = listed.length ? [...listed] : ["card"];
  if (envFlagOn(env.STRIPE_ENABLE_ALIPAY) && !types.includes("alipay")) {
    types.push("alipay");
  }
  if (envFlagOn(env.STRIPE_ENABLE_WECHAT_PAY) && !types.includes("wechat_pay")) {
    types.push("wechat_pay");
  }
  const walletsForced =
    envFlagOn(env.STRIPE_ENABLE_ALIPAY) || envFlagOn(env.STRIPE_ENABLE_WECHAT_PAY);
  if (!listed.length && !walletsForced) {
    return { mode: "automatic", types: ["card"] };
  }
  return { mode: "explicit", types };
}

export function paymentMethodDocs(): {
  defaultMode: string;
  gatedByEnv: string[];
  note: string;
} {
  return {
    defaultMode: "automatic_payment_methods[enabled]=true (Dashboard-eligible methods, typically card)",
    gatedByEnv: [
      "STRIPE_PAYMENT_METHOD_TYPES — comma list, switches to payment_method_types[]",
      "STRIPE_ENABLE_ALIPAY=1 — append alipay (Dashboard + often unsupported on subscription Checkout)",
      "STRIPE_ENABLE_WECHAT_PAY=1 — append wechat_pay (same caveats; also sets client=web)",
    ],
    note: WALLET_NOTE,
  };
}

export async function stripeHmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseStripeSignature(header: string | null): {
  timestamp: string;
  signatures: string[];
} | null {
  if (!header) return null;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, ...rest] = part.trim().split("=");
    const v = rest.join("=");
    if (k === "t") timestamp = v;
    if (k === "v1" && v) signatures.push(v);
  }
  if (!timestamp || !signatures.length) return null;
  return { timestamp, signatures };
}

export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = SIGNATURE_TOLERANCE_SEC,
): Promise<boolean> {
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;
  const ts = Number(parsed.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = await stripeHmacHex(secret, `${parsed.timestamp}.${payload}`);
  return parsed.signatures.some((sig) => timingSafeEqualHex(sig, expected));
}

export function encodeStripeForm(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export function buildCheckoutFields(args: {
  env: Env;
  userId: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
  customerEmail?: string | null;
  locale?: string | null;
}): { fields: Record<string, string>; payment: PaymentMethodConfig } {
  const payment = resolvePaymentMethodConfig(args.env);
  const fields: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": args.env.STRIPE_PRICE_ID ?? "",
    "line_items[0][quantity]": "1",
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    client_reference_id: args.userId,
    "metadata[user_id]": args.userId,
    "subscription_data[metadata][user_id]": args.userId,
  };
  if (args.customerId) {
    fields.customer = args.customerId;
  } else if (args.customerEmail) {
    fields.customer_email = args.customerEmail;
  }
  if (args.locale === "zh") fields.locale = "zh";
  if (args.locale === "en") fields.locale = "en";

  if (payment.mode === "automatic") {
    fields["automatic_payment_methods[enabled]"] = "true";
  } else {
    payment.types.forEach((type, i) => {
      fields[`payment_method_types[${i}]`] = type;
    });
    if (payment.types.includes("wechat_pay")) {
      fields["payment_method_options[wechat_pay][client]"] = "web";
    }
  }
  return { fields, payment };
}

export type StripeJson = Record<string, unknown>;

export async function stripePost(
  env: Env,
  path: string,
  fields: Record<string, string>,
): Promise<{ ok: boolean; status: number; json: StripeJson }> {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    return { ok: false, status: 503, json: { error: "STRIPE_SECRET_KEY missing" } };
  }
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeStripeForm(fields),
  });
  const json = (await res.json().catch(() => ({}))) as StripeJson;
  return { ok: res.ok, status: res.status, json };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
