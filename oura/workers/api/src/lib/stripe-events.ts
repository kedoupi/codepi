import type { Env } from "../env";
import { asRecord, asString } from "./stripe.ts";
import {
  findUserIdByCustomer,
  hasStripeEvent,
  markStripeEvent,
  periodEndIso,
  upsertSubscription,
  type SubscriptionRow,
} from "./subscription.ts";

export type StripeEvent = {
  id: string;
  type: string;
  data?: { object?: unknown };
};

function customerId(obj: Record<string, unknown>): string | null {
  const c = obj.customer;
  if (typeof c === "string") return c;
  const rec = asRecord(c);
  return rec ? asString(rec.id) : null;
}

function subscriptionId(obj: Record<string, unknown>): string | null {
  const s = obj.subscription;
  if (typeof s === "string") return s;
  const rec = asRecord(s);
  return rec ? asString(rec.id) : null;
}

function priceIdFromSub(obj: Record<string, unknown>): string | null {
  const items = asRecord(obj.items);
  const data = items && Array.isArray(items.data) ? items.data : [];
  const first = asRecord(data[0]);
  const price = first ? asRecord(first.price) : null;
  return price ? asString(price.id) : null;
}

async function resolveUserId(
  env: Env,
  obj: Record<string, unknown>,
  fallbackCustomer: string | null,
): Promise<string | null> {
  const meta = asRecord(obj.metadata);
  const fromMeta = meta ? asString(meta.user_id) : null;
  if (fromMeta) return fromMeta;
  const fromRef = asString(obj.client_reference_id);
  if (fromRef) return fromRef;
  if (fallbackCustomer) return findUserIdByCustomer(env, fallbackCustomer);
  return null;
}

export async function applyStripeEvent(env: Env, event: StripeEvent): Promise<boolean> {
  if (!event.id || !event.type) return false;
  if (await hasStripeEvent(env, event.id)) return true;

  const obj = asRecord(event.data?.object);
  if (!obj) {
    await markStripeEvent(env, event.id, event.type);
    return true;
  }

  if (event.type === "checkout.session.completed") {
    const customer = customerId(obj);
    const userId = await resolveUserId(env, obj, customer);
    if (userId) {
      const row: SubscriptionRow = {
        user_id: userId,
        stripe_customer_id: customer,
        stripe_subscription_id: subscriptionId(obj),
        status: asString(obj.payment_status) === "unpaid" ? "incomplete" : "active",
        current_period_end: null,
        price_id: env.STRIPE_PRICE_ID ?? null,
      };
      await upsertSubscription(env, row);
    }
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const customer = customerId(obj);
    const userId = await resolveUserId(env, obj, customer);
    if (userId) {
      const status =
        event.type === "customer.subscription.deleted"
          ? "canceled"
          : (asString(obj.status) ?? "none");
      await upsertSubscription(env, {
        user_id: userId,
        stripe_customer_id: customer,
        stripe_subscription_id: asString(obj.id),
        status,
        current_period_end: periodEndIso(obj.current_period_end),
        price_id: priceIdFromSub(obj) ?? env.STRIPE_PRICE_ID ?? null,
      });
    }
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const customer = customerId(obj);
    const userId = await resolveUserId(env, obj, customer);
    if (userId) {
      const parent = asRecord(obj.parent);
      const subDetails = parent ? asRecord(parent.subscription_details) : null;
      const subFromParent = subDetails ? asString(subDetails.subscription) : null;
      await upsertSubscription(env, {
        user_id: userId,
        stripe_customer_id: customer,
        stripe_subscription_id: subscriptionId(obj) ?? subFromParent,
        status: event.type === "invoice.paid" ? "active" : "past_due",
        current_period_end: periodEndIso(obj.period_end),
        price_id: env.STRIPE_PRICE_ID ?? null,
      });
    }
  }

  await markStripeEvent(env, event.id, event.type);
  return true;
}
