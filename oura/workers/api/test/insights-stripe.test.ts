import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildCheckoutFields,
  encodeStripeForm,
  resolvePaymentMethodConfig,
  stripeHmacHex,
  verifyStripeSignature,
} from "../src/lib/stripe.ts";
import { applyStripeEvent } from "../src/lib/stripe-events.ts";
import { isEntitled, periodEndIso } from "../src/lib/subscription.ts";
import {
  buildCompareReport,
  buildWeeklyReport,
  paywallCompare,
  paywallWeekly,
  splitRollingWeeks,
  TEASER_LINE_COUNT,
} from "../src/lib/weekly-report.ts";
import type { BoardDailyPayload } from "../src/lib/daily.ts";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/oura_daily_kedoupi_30d.json",
);
const kedoupiSample = JSON.parse(readFileSync(fixturePath, "utf8")) as BoardDailyPayload;

function fakeEnv(overrides: Record<string, string | undefined> = {}) {
  return overrides as import("../src/env.ts").Env;
}

describe("weekly insight templates", () => {
  it("emits 3 Chinese summaries + up to 3 tips from kedoupi days", () => {
    const report = buildWeeklyReport(kedoupiSample.days);
    assert.equal(report.summaries.length, 3);
    assert.equal(report.teaser.length, TEASER_LINE_COUNT);
    assert.ok(report.tips.length >= 1 && report.tips.length <= 3);
    assert.equal(report.disclaimer, "非医疗建议");
    assert.equal(report.thisPeriod.from, "2026-09-09");
    assert.equal(report.thisPeriod.to, "2026-09-15");
    assert.equal(report.lastPeriod.from, "2026-09-02");
    assert.equal(report.lastPeriod.to, "2026-09-08");
    for (const line of report.summaries) {
      assert.match(line, /睡眠|准备度|活动/);
    }
  });

  it("paywall keeps teaser and hides tips until subscribed", () => {
    const report = buildWeeklyReport(kedoupiSample.days);
    const locked = paywallWeekly(report, false);
    assert.equal(locked.locked, true);
    assert.equal(locked.summaries.length, 3);
    assert.deepEqual(locked.tips, []);
    assert.equal(locked.avgs, null);
    const open = paywallWeekly(report, true);
    assert.equal(open.locked, false);
    assert.ok(open.tips.length >= 1);
    assert.ok(open.avgs);
  });

  it("compare week vs range uses official scores only", () => {
    const week = buildCompareReport(kedoupiSample.days, "week");
    assert.equal(week.left.label, "本周");
    assert.equal(week.right.label, "上周");
    assert.equal(week.left.days, 7);
    assert.ok(typeof week.left.sleep === "number");
    const range = buildCompareReport(kedoupiSample.days, "range");
    assert.equal(range.left.label, "近 7 天");
    assert.equal(range.right.label, "近 30 天");
    assert.equal(range.right.days, 30);
    const locked = paywallCompare(week, false);
    assert.equal(locked.locked, true);
    assert.equal(locked.left, null);
    assert.equal(paywallCompare(week, true).left?.sleep, week.left.sleep);
  });

  it("rolling weeks do not invent extra days", () => {
    const { thisWeek, lastWeek } = splitRollingWeeks(kedoupiSample.days.slice(0, 10));
    assert.equal(thisWeek.length, 7);
    assert.equal(lastWeek.length, 3);
  });
});

describe("subscription entitlement", () => {
  it("treats active / trialing / dev_grant as paid", () => {
    assert.equal(isEntitled("active"), true);
    assert.equal(isEntitled("trialing"), true);
    assert.equal(isEntitled("dev_grant"), true);
    assert.equal(isEntitled("canceled"), false);
    assert.equal(isEntitled("past_due"), false);
    assert.equal(isEntitled("none"), false);
    assert.equal(isEntitled(null), false);
  });

  it("formats Stripe period end", () => {
    assert.equal(periodEndIso(1_704_067_200), "2024-01-01T00:00:00.000Z");
    assert.equal(periodEndIso("nope"), null);
  });
});

describe("Stripe payment methods + Checkout fields", () => {
  it("defaults to automatic_payment_methods (card + Dashboard-eligible)", () => {
    const cfg = resolvePaymentMethodConfig(fakeEnv());
    assert.equal(cfg.mode, "automatic");
    assert.deepEqual(cfg.types, ["card"]);
  });

  it("env-gates Alipay / WeChat Pay onto payment_method_types", () => {
    const cfg = resolvePaymentMethodConfig(
      fakeEnv({ STRIPE_ENABLE_ALIPAY: "1", STRIPE_ENABLE_WECHAT_PAY: "1" }),
    );
    assert.equal(cfg.mode, "explicit");
    assert.deepEqual(cfg.types, ["card", "alipay", "wechat_pay"]);
  });

  it("honors STRIPE_PAYMENT_METHOD_TYPES list", () => {
    const cfg = resolvePaymentMethodConfig(
      fakeEnv({ STRIPE_PAYMENT_METHOD_TYPES: "card,alipay" }),
    );
    assert.deepEqual(cfg.types, ["card", "alipay"]);
  });

  it("builds subscription Checkout fields without leaking secrets", () => {
    const { fields, payment } = buildCheckoutFields({
      env: fakeEnv({ STRIPE_PRICE_ID: "price_test_39" }),
      userId: "user-1",
      successUrl: "http://localhost:5173/insights?checkout=success",
      cancelUrl: "http://localhost:5173/insights?checkout=cancel",
      customerEmail: "dev@localhost",
    });
    assert.equal(fields.mode, "subscription");
    assert.equal(fields["line_items[0][price]"], "price_test_39");
    assert.equal(fields["automatic_payment_methods[enabled]"], "true");
    assert.equal(fields["metadata[user_id]"], "user-1");
    assert.equal(payment.mode, "automatic");
    const encoded = encodeStripeForm(fields);
    assert.ok(!encoded.includes("sk_"));
    assert.match(encoded, /line_items/);
  });

  it("sets wechat_pay client=web when that wallet is listed", () => {
    const { fields } = buildCheckoutFields({
      env: fakeEnv({
        STRIPE_PRICE_ID: "price_test_39",
        STRIPE_ENABLE_WECHAT_PAY: "1",
      }),
      userId: "u",
      successUrl: "https://example.com/ok",
      cancelUrl: "https://example.com/no",
    });
    assert.equal(fields["payment_method_types[0]"], "card");
    assert.equal(fields["payment_method_types[1]"], "wechat_pay");
    assert.equal(fields["payment_method_options[wechat_pay][client]"], "web");
  });
});

describe("Stripe webhook signature (mocked, no Stripe SDK)", () => {
  it("accepts a valid v1 HMAC and rejects tampering", async () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    const t = Math.floor(Date.now() / 1000);
    const sig = await stripeHmacHex(secret, `${t}.${payload}`);
    assert.equal(
      await verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, t),
      true,
    );
    assert.equal(
      await verifyStripeSignature(payload + "x", `t=${t},v1=${sig}`, secret, t),
      false,
    );
    assert.equal(
      await verifyStripeSignature(payload, `t=${t},v1=deadbeef`, secret, t),
      false,
    );
    assert.equal(
      await verifyStripeSignature(payload, `t=${t - 400},v1=${sig}`, secret, t),
      false,
    );
  });
});

function memoryD1() {
  const subs = new Map<string, Record<string, unknown>>();
  const events = new Set<string>();
  const byCustomer = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM stripe_events")) {
                return events.has(String(args[0])) ? { id: args[0] } : null;
              }
              if (sql.includes("FROM subscriptions WHERE stripe_customer_id")) {
                const uid = byCustomer.get(String(args[0]));
                return uid ? { user_id: uid } : null;
              }
              return null;
            },
            async run() {
              if (sql.includes("INSERT OR IGNORE INTO stripe_events")) {
                events.add(String(args[0]));
              }
              if (sql.includes("INSERT INTO subscriptions")) {
                const userId = String(args[0]);
                const customer = args[1] == null ? null : String(args[1]);
                subs.set(userId, {
                  user_id: userId,
                  stripe_customer_id: customer,
                  stripe_subscription_id: args[2],
                  status: args[3],
                  current_period_end: args[4],
                  price_id: args[5],
                });
                if (customer) byCustomer.set(customer, userId);
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, subs, events };
}

describe("Stripe webhook persist (mocked D1)", () => {
  it("marks checkout.session.completed as active for client_reference_id", async () => {
    const { db, subs, events } = memoryD1();
    const env = { DB: db, STRIPE_PRICE_ID: "price_test_39" } as import("../src/env.ts").Env;
    await applyStripeEvent(env, {
      id: "evt_cs_1",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "user-42",
          customer: "cus_1",
          subscription: "sub_1",
          payment_status: "paid",
        },
      },
    });
    assert.equal(subs.get("user-42")?.status, "active");
    assert.equal(subs.get("user-42")?.stripe_customer_id, "cus_1");
    assert.equal(events.has("evt_cs_1"), true);

    await applyStripeEvent(env, {
      id: "evt_cs_1",
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "user-42", customer: "cus_x" } },
    });
    assert.equal(subs.get("user-42")?.stripe_customer_id, "cus_1");
  });

  it("cancels on customer.subscription.deleted", async () => {
    const { db, subs } = memoryD1();
    const env = { DB: db } as import("../src/env.ts").Env;
    await applyStripeEvent(env, {
      id: "evt_del",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_9",
          customer: "cus_9",
          metadata: { user_id: "user-9" },
          status: "canceled",
        },
      },
    });
    assert.equal(subs.get("user-9")?.status, "canceled");
  });
});
