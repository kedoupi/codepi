import type { Env } from "../env";

export const PLACEHOLDER_PRICE_LABEL = "¥39/月";

export type SubscriptionStatus =
  | "none"
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused"
  | "dev_grant";

export type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  price_id: string | null;
};

export type LocalePref = "system" | "zh" | "en";

const ENTITLED = new Set<string>(["active", "trialing", "dev_grant"]);

export function isEntitled(status: string | null | undefined): boolean {
  return ENTITLED.has(status ?? "");
}

export function normalizeLocalePref(value: unknown): LocalePref | null {
  if (value === "system" || value === "zh" || value === "en") return value;
  return null;
}

export async function loadSubscription(
  env: Env,
  userId: string,
): Promise<SubscriptionRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT user_id, stripe_customer_id, stripe_subscription_id, status,
              current_period_end, price_id
       FROM subscriptions WHERE user_id = ?`,
    )
      .bind(userId)
      .first<SubscriptionRow>()) ?? null
  );
}

export async function upsertSubscription(
  env: Env,
  row: SubscriptionRow,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO subscriptions (
        user_id, stripe_customer_id, stripe_subscription_id, status,
        current_period_end, price_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        stripe_customer_id = excluded.stripe_customer_id,
        stripe_subscription_id = excluded.stripe_subscription_id,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        price_id = excluded.price_id,
        updated_at = datetime('now')`,
  )
    .bind(
      row.user_id,
      row.stripe_customer_id,
      row.stripe_subscription_id,
      row.status,
      row.current_period_end,
      row.price_id,
    )
    .run();
}

export async function findUserIdByCustomer(
  env: Env,
  customerId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?`,
  )
    .bind(customerId)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function loadLocalePref(
  env: Env,
  userId: string,
): Promise<LocalePref | null> {
  const row = await env.DB.prepare(
    `SELECT locale FROM user_prefs WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ locale: string | null }>();
  return normalizeLocalePref(row?.locale);
}

export async function saveLocalePref(
  env: Env,
  userId: string,
  locale: LocalePref,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_prefs (user_id, locale, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       locale = excluded.locale,
       updated_at = datetime('now')`,
  )
    .bind(userId, locale)
    .run();
}

export async function loadUserEmail(
  env: Env,
  userId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ email: string | null }>();
  return row?.email ?? null;
}

export async function hasStripeEvent(env: Env, eventId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT id FROM stripe_events WHERE id = ?`)
    .bind(eventId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function markStripeEvent(
  env: Env,
  eventId: string,
  type: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)`,
  )
    .bind(eventId, type)
    .run();
}

export function periodEndIso(unix: unknown): string | null {
  if (typeof unix !== "number" || !Number.isFinite(unix)) return null;
  return new Date(unix * 1000).toISOString();
}

export function stripeConfigured(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}
