import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { capabilities } from "../src/lib/capabilities.ts";
import type { BoardDailyPayload } from "../src/lib/daily.ts";
import {
  buildCompareReport,
  buildWeeklyReport,
  compareForAccess,
  splitRollingWeeks,
  TEASER_LINE_COUNT,
  weeklyForAccess,
} from "../src/lib/weekly-report.ts";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/oura_daily_kedoupi_30d.json",
);
const kedoupiSample = JSON.parse(readFileSync(fixturePath, "utf8")) as BoardDailyPayload;

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

  it("keeps the teaser and hides tips from accounts without owner access", () => {
    const report = buildWeeklyReport(kedoupiSample.days);
    const locked = weeklyForAccess(report, false);
    assert.equal(locked.locked, true);
    assert.equal(locked.summaries.length, 3);
    assert.deepEqual(locked.tips, []);
    assert.equal(locked.avgs, null);
    const open = weeklyForAccess(report, true);
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
    const locked = compareForAccess(week, false);
    assert.equal(locked.locked, true);
    assert.equal(locked.left, null);
    assert.equal(compareForAccess(week, true).left?.sleep, week.left.sleep);
  });

  it("rolling weeks do not invent extra days", () => {
    const { thisWeek, lastWeek } = splitRollingWeeks(kedoupiSample.days.slice(0, 10));
    assert.equal(thisWeek.length, 7);
    assert.equal(lastWeek.length, 3);
  });
});

describe("capabilities gate full reports on the personal owner", () => {
  const env = (overrides: Record<string, string | undefined> = {}) =>
    overrides as import("../src/env.ts").Env;

  it("grants full reports only when the session matches PERSONAL_OWNER_ID", () => {
    const owned = env({ PERSONAL_OWNER_ID: "owner-1" });
    assert.deepEqual(capabilities(owned, "owner-1"), {
      personal: true, weeklyFull: true, compare: true, analysis: true, ai: false,
    });
    const stranger = capabilities(owned, "someone-else");
    assert.equal(stranger.personal, false);
    assert.equal(stranger.weeklyFull, false);
    assert.equal(stranger.compare, false);
    assert.equal(stranger.analysis, true);
    assert.equal(capabilities(env(), "owner-1").weeklyFull, false);
    assert.equal(capabilities(owned, null).weeklyFull, false);
  });

  it("no longer exposes a billing capability", () => {
    assert.equal(
      Object.hasOwn(capabilities(env({ PERSONAL_OWNER_ID: "owner-1" }), "someone-else"), "billing"),
      false,
    );
  });
});
