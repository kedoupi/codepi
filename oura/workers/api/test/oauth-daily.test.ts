import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  allowDevLogin,
  DEV_PLACEHOLDER_CLIENT_ID,
  resolveClientId,
} from "../src/lib/config.ts";
import { decryptJson, encryptJson, hmacSign, hmacVerify } from "../src/lib/crypto.ts";
import {
  buildDevDaily,
  clampDays,
  dateWindow,
  isBoardDailyPayload,
  mapOuraToDaily,
  sliceBoardDays,
  type BoardDailyPayload,
} from "../src/lib/daily.ts";
import { buildAuthorizeUrl, DEFAULT_SCOPES, OURA_AUTH_URL } from "../src/lib/oura.ts";
import {
  pickActivity,
  pickReadiness,
  pickSleep,
  publicActivity,
  READINESS_CONTRIBUTOR_KEYS,
  SLEEP_CONTRIBUTOR_KEYS,
} from "../src/lib/pickers.ts";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/oura_daily_kedoupi_30d.json",
);
const kedoupiSample = JSON.parse(readFileSync(fixturePath, "utf8")) as BoardDailyPayload;

function fakeEnv(overrides: Record<string, string | undefined> = {}) {
  return overrides as import("../src/env.ts").Env;
}

function req(host: string): Request {
  return new Request(`http://${host}/api/auth/oura/start`);
}

describe("Oura authorize URL", () => {
  it("matches cloud.ouraring.com/oauth/authorize shape", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: DEV_PLACEHOLDER_CLIENT_ID,
        redirectUri: "http://localhost:5173/api/auth/oura/callback",
        state: "csrf-state-1",
      }),
    );
    assert.equal(url.origin + url.pathname, OURA_AUTH_URL);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), DEV_PLACEHOLDER_CLIENT_ID);
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://localhost:5173/api/auth/oura/callback",
    );
    assert.equal(url.searchParams.get("scope"), DEFAULT_SCOPES);
    assert.equal(url.searchParams.get("state"), "csrf-state-1");
  });
});

describe("DEV vs production client id", () => {
  it("uses placeholder on localhost when secret is missing", () => {
    assert.equal(
      resolveClientId(req("localhost"), fakeEnv()),
      DEV_PLACEHOLDER_CLIENT_ID,
    );
    assert.equal(allowDevLogin(req("localhost"), fakeEnv()), true);
  });

  it("uses real client id when configured", () => {
    assert.equal(
      resolveClientId(req("oura.kdp.cool"), fakeEnv({ OURA_CLIENT_ID: "real_app" })),
      "real_app",
    );
  });

  it("fails closed on production host without client id", () => {
    assert.equal(resolveClientId(req("oura.kdp.cool"), fakeEnv()), null);
    assert.equal(allowDevLogin(req("oura.kdp.cool"), fakeEnv()), false);
  });
});

describe("AES-GCM token envelope", () => {
  it("round-trips refresh_token and never equals plaintext", async () => {
    const secret = "dev-only-token-encryption-key-not-for-prod";
    const payload = { refresh_token: "rt_secret", access_token: "at_secret", expires_at: 1 };
    const blob = await encryptJson(secret, payload);
    assert.ok(!blob.ciphertext.includes("rt_secret"));
    assert.notEqual(blob.iv, blob.ciphertext);
    const out = await decryptJson<typeof payload>(secret, blob);
    assert.deepEqual(out, payload);
  });

  it("HMAC verifies session ids", async () => {
    const sig = await hmacSign("session-secret", "sid-1");
    assert.equal(await hmacVerify("session-secret", "sid-1", sig), true);
    assert.equal(await hmacVerify("session-secret", "sid-2", sig), false);
  });
});

function assertLiveDayShape(day: BoardDailyPayload["days"][number], label: string) {
  assert.equal(typeof day.date, "string", `${label} date`);
  assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
  if (day.sleep) {
    assert.equal(typeof day.sleep.score, "number", `${label} sleep.score`);
    assert.deepEqual(
      Object.keys(day.sleep.contributors).sort(),
      [...SLEEP_CONTRIBUTOR_KEYS].sort(),
      `${label} sleep.contributors`,
    );
  }
  if (day.readiness) {
    assert.equal(typeof day.readiness.score, "number", `${label} readiness.score`);
    assert.equal(typeof day.readiness.temperature_deviation, "number");
    assert.equal(typeof day.readiness.temperature_trend_deviation, "number");
    assert.deepEqual(
      Object.keys(day.readiness.contributors).sort(),
      [...READINESS_CONTRIBUTOR_KEYS].sort(),
      `${label} readiness.contributors`,
    );
  }
  if (day.activity) {
    assert.equal(typeof day.activity.score, "number", `${label} activity.score`);
    assert.equal(typeof day.activity.steps, "number", `${label} activity.steps`);
    assert.equal(typeof day.activity.active_calories, "number");
    assert.equal(day.activity.hasOwnProperty("equivalent_walking_distance"), false);
  }
}

describe("kedoupi live sample is the contract", () => {
  it("parses as the personal board payload", () => {
    assert.equal(isBoardDailyPayload(kedoupiSample), true);
    assert.equal(kedoupiSample.ok, true);
    assert.equal(kedoupiSample.user_id, "kedoupi");
    assert.equal(kedoupiSample.from, "2026-08-17");
    assert.equal(kedoupiSample.to, "2026-09-15");
    assert.equal(kedoupiSample.count, 30);
    assert.equal(kedoupiSample.days.length, 30);
  });

  it("every day has nested sleep/readiness and live contributor keys", () => {
    for (const day of kedoupiSample.days) {
      assertLiveDayShape(day, day.date);
      assert.ok(day.sleep, `${day.date} sleep`);
      assert.ok(day.readiness, `${day.date} readiness`);
    }
    const missingActivity = kedoupiSample.days.filter((d) => d.activity == null);
    assert.deepEqual(
      missingActivity.map((d) => d.date),
      ["2026-09-07", "2026-09-08"],
    );
  });

  it("keeps real kedoupi numbers (not a generated wave)", () => {
    const first = kedoupiSample.days[0]!;
    assert.equal(first.date, "2026-08-17");
    assert.equal(first.sleep?.score, 76);
    assert.equal(first.sleep?.contributors.deep_sleep, 95);
    assert.equal(first.readiness?.contributors.recovery_index, 62);
    assert.equal(first.activity?.steps, 6861);
    assert.equal(first.activity?.active_calories, 486);
    const last = kedoupiSample.days[29]!;
    assert.equal(last.date, "2026-09-15");
    assert.equal(last.activity?.steps, 10273);
    assert.equal(last.readiness?.temperature_deviation, 0.07);
  });
});

describe("daily nested shape", () => {
  it("maps Oura Cloud docs through pick* onto the live nested shape", () => {
    const { dates } = dateWindow(7, new Date("2026-09-15T12:00:00Z"));
    const first = dates[0]!;
    const body = mapOuraToDaily({
      dates,
      sleep: [
        {
          id: "slp_1",
          day: first,
          score: 88,
          contributors: {
            deep_sleep: 91,
            efficiency: 92,
            latency: 70,
            rem_sleep: 80,
            restfulness: 85,
            timing: 90,
            total_sleep: 77,
          },
        },
      ],
      readiness: [
        {
          id: "rdy_1",
          day: first,
          score: 77,
          temperature_deviation: 0.02,
          temperature_trend_deviation: 0.1,
          contributors: {
            activity_balance: 79,
            body_temperature: 100,
            hrv_balance: 89,
            previous_day_activity: 91,
            previous_night: 77,
            recovery_index: 62,
            resting_heart_rate: 88,
            sleep_balance: 61,
          },
        },
      ],
      activity: [
        {
          id: "act_1",
          day: first,
          score: 66,
          steps: 5492,
          active_calories: 323,
          equivalent_walking_distance: 4100,
        },
      ],
    });
    assert.equal(body.ok, true);
    assert.equal(body.source, "oura");
    assert.equal(body.count, 7);
    assert.equal(body.from, dates[0]);
    assert.equal(body.to, dates[6]);
    assert.equal(body.days.length, 7);
    const row = body.days[0]!;
    assert.equal(row.date, first);
    assert.equal(row.sleep?.score, 88);
    assert.equal(row.sleep?.contributors.deep_sleep, 91);
    assert.equal(row.readiness?.score, 77);
    assert.equal(row.readiness?.temperature_deviation, 0.02);
    assert.equal(row.readiness?.contributors.recovery_index, 62);
    assert.equal(row.activity?.score, 66);
    assert.equal(row.activity?.steps, 5492);
    assert.equal(row.activity?.active_calories, 323);
    assert.equal("id" in (row.sleep ?? {}), false);
    assert.equal("equivalent_walking_distance" in (row.activity ?? {}), false);
    assert.equal(body.days[1]?.sleep, null);
    assert.equal(body.days[1]?.activity, null);
  });

  it("pick* keep the production field set including activity extras", () => {
    const sleep = pickSleep({
      id: "s",
      day: "2026-09-15",
      score: 79,
      contributors: { deep_sleep: 96, efficiency: 98 },
    });
    const readiness = pickReadiness({
      id: "r",
      day: "2026-09-15",
      score: 76,
      temperature_deviation: 0.07,
      contributors: { hrv_balance: 94 },
    });
    const activity = pickActivity({
      id: "a",
      day: "2026-09-15",
      score: 96,
      steps: 10273,
      active_calories: 703,
      equivalent_walking_distance: 8000,
      high_activity_time: 12,
    });
    assert.equal(sleep?.id, "s");
    assert.equal(sleep?.contributors.deep_sleep, 96);
    assert.equal(sleep?.contributors.timing, null);
    assert.equal(readiness?.temperature_deviation, 0.07);
    assert.equal(readiness?.contributors.hrv_balance, 94);
    assert.equal(activity?.steps, 10273);
    assert.equal(activity?.equivalent_walking_distance, 8000);
    assert.deepEqual(publicActivity(activity!), {
      score: 96,
      steps: 10273,
      active_calories: 703,
    });
    assert.equal(pickSleep(null), null);
    assert.equal(pickReadiness(undefined), null);
    assert.equal(pickActivity(null), null);
  });

  it("DEV daily is the kedoupi sample, not invented scores", () => {
    const body = buildDevDaily(30);
    assert.equal(body.ok, true);
    assert.equal(body.source, "dev");
    assert.equal(body.dev, true);
    assert.equal(body.user_id, "kedoupi");
    assert.equal(body.count, 30);
    assert.equal(body.from, kedoupiSample.from);
    assert.equal(body.to, kedoupiSample.to);
    assert.match(body.label ?? "", /kedoupi/);
    assert.deepEqual(body.days, kedoupiSample.days);
    assertLiveDayShape(body.days[0]!, "dev[0]");
    assert.equal(body.days[0]?.activity?.steps, 6861);
    assert.equal(body.days[29]?.sleep?.contributors.deep_sleep, 96);
  });

  it("supports days=7|30|90 without fabricating extra rows", () => {
    const week = buildDevDaily(7);
    assert.equal(week.count, 7);
    assert.deepEqual(week.days, sliceBoardDays(kedoupiSample.days, 7));
    assert.equal(week.from, "2026-09-09");
    assert.equal(week.to, "2026-09-15");
    assert.equal(week.days[0]?.readiness?.contributors.hrv_balance, 94);
    assert.equal(week.days[6]?.activity?.steps, 10273);

    const month = buildDevDaily(30);
    assert.equal(month.count, 30);

    const quarter = buildDevDaily(90);
    assert.equal(quarter.count, 30);
    assert.equal(quarter.days.length, 30);
    assert.match(quarter.label ?? "", /仅有 30 天真实样本/);
  });

  it("clamps days to 7|30|90", () => {
    assert.equal(clampDays(7), 7);
    assert.equal(clampDays(90), 90);
    assert.equal(clampDays(12), 30);
    assert.equal(buildDevDaily(12).count, 30);
  });
});
