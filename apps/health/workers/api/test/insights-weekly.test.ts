import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

import { SYNTHETIC_BOARD_SAMPLE as syntheticSample } from "../src/data/synthetic-board.ts";


describe("weekly insight templates", () => {
  const end = "2026-10-15";
  const row = (date: string, score = 80) => ({
    date, sleep: { score }, readiness: { score }, activity: { score, steps: 8000 },
  });

  it("does not compare a single day with an absent preceding period", () => {
    const report = buildWeeklyReport([row(end)], end);
    assert.deepEqual(report.sampleCounts.thisWeek, { sleep: 1, readiness: 1, activity: 1, steps: 1 });
    assert.deepEqual(report.sampleCounts.lastWeek, { sleep: 0, readiness: 0, activity: 0, steps: 0 });
    assert.ok(report.summaries.every(line => line.includes("样本不足")));
    assert.doesNotMatch(report.tips.join(" "), /接近|持平|高于|低于|保持作息/);
    assert.deepEqual(report.lastPeriod, { from: "2026-10-02", to: "2026-10-08" });
  });

  it("requires three valid days on each side for each metric independently", () => {
    const data = [
      ...["03", "05", "08"].map(day => row(`2026-10-${day}`, 75)),
      ...["09", "12", "15"].map(day => row(`2026-10-${day}`, 80)),
    ];
    data[4].sleep.score = NaN;
    const report = buildWeeklyReport(data, end);
    assert.match(report.summaries[0], /有效样本 2\/7 天，此前 3\/7 天.*样本不足/);
    assert.match(report.summaries[1], /升高 5 分/);
    assert.doesNotMatch(report.tips.join(" "), /三项官方分数.*接近|睡眠均分高于/);
    data[4].sleep.score = 80;
    assert.match(buildWeeklyReport(data, end).tips[0], /睡眠均分高于/);
    data.splice(0, 1);
    assert.ok(buildWeeklyReport(data, end).summaries.every(line => line.includes("样本不足")));
  });

  it("does not call scores close when only activity changed or readiness rose", () => {
    const data = [...Array(14)].map((_, i) => row(`2026-10-${String(i + 2).padStart(2, "0")}`));
    for (const day of data.slice(-7)) day.activity.score = 95;
    assert.doesNotMatch(buildWeeklyReport(data, end).tips.join(" "), /三项官方分数.*接近/);
    for (const day of data.slice(-7)) { day.activity.score = 80; day.readiness.score = 95; }
    assert.doesNotMatch(buildWeeklyReport(data, end).tips.join(" "), /三项官方分数.*接近/);
    for (const day of data.slice(-7)) day.readiness.score = 80;
    assert.match(buildWeeklyReport(data, end).tips[0], /三项官方分数.*接近/);
  });

  it("filters calendar windows, excludes future records, and counts unique valid days", () => {
    const data = [
      row("2000-01-30"), row("2026-09-16"), row("2026-10-01", 20), row("2026-10-08"),
      row("2026-10-09", 60), row(end), row(end), row("2026-10-16", 10),
      { date: "2026-10-12", sleep: null, activity: null },
    ];
    const report = buildCompareReport(data, "range", end);
    assert.deepEqual({ from: report.left.from, to: report.left.to }, { from: "2026-10-09", to: end });
    assert.equal(report.left.days, 2);
    assert.equal(report.left.sleep, 70);
    assert.equal(report.right.from, "2026-09-16");
    assert.equal(report.right.days, 5);
    assert.equal(report.right.samples.sleep, 5);
    assert.equal(buildCompareReport([row("2026-10-01"), row(end)], "range", end).left.days, 1);
  });

  it("does not shift stale data into the current period or count missing metrics as zero", () => {
    const report = buildWeeklyReport([row("2026-09-01")], end);
    assert.equal(report.avgs.thisWeek.sleep, null);
    assert.equal(report.sampleCounts.thisWeek.sleep, 0);
    assert.deepEqual(report.thisPeriod, { from: "2026-10-09", to: end });
    const comparison = buildCompareReport([
      { date: end, sleep: { score: 0 }, readiness: { score: Infinity }, activity: { score: 101, steps: 0 } },
      { date: "2026-10-14", sleep: { score: -1 }, activity: { steps: -1 } },
      { date: "2026-10-13", sleep: null, activity: null },
    ], "week", end);
    assert.equal(comparison.left.sleep, 0);
    assert.equal(comparison.left.steps, 0);
    assert.equal(comparison.left.readiness, null);
    assert.equal(comparison.left.activity, null);
    assert.equal(comparison.left.days, 1);
    assert.deepEqual(comparison.left.samples, { sleep: 1, readiness: 0, activity: 0, steps: 1 });
  });

  it("empty and cross-year periods retain exact calendar bounds", () => {
    const report = buildWeeklyReport([], "2027-01-03");
    assert.deepEqual(report.thisPeriod, { from: "2026-12-28", to: "2027-01-03" });
    assert.deepEqual(report.lastPeriod, { from: "2026-12-21", to: "2026-12-27" });
    assert.equal(report.avgs.thisWeek.steps, null);
    assert.match(report.tips[0], /没有足够/);
  });

  it("emits 3 Chinese summaries + up to 3 tips from synthetic days", () => {
    const report = buildWeeklyReport(syntheticSample.days, "2000-01-30");
    assert.equal(report.summaries.length, 3);
    assert.equal(report.teaser.length, TEASER_LINE_COUNT);
    assert.ok(report.tips.length >= 1 && report.tips.length <= 3);
    assert.equal(report.disclaimer, "非医疗建议");
    assert.equal(report.thisPeriod.from, "2000-01-24");
    assert.equal(report.thisPeriod.to, "2000-01-30");
    assert.equal(report.lastPeriod.from, "2000-01-17");
    assert.equal(report.lastPeriod.to, "2000-01-23");
    for (const line of report.summaries) {
      assert.match(line, /睡眠|准备度|活动/);
    }
  });

  it("keeps the teaser and hides tips from accounts without owner access", () => {
    const report = buildWeeklyReport(syntheticSample.days, "2000-01-30");
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
    const week = buildCompareReport(syntheticSample.days, "week", "2000-01-30");
    assert.equal(week.left.label, "近 7 天");
    assert.equal(week.right.label, "此前 7 天");
    assert.equal(week.left.days, 7);
    assert.ok(typeof week.left.sleep === "number");
    const range = buildCompareReport(syntheticSample.days, "range", "2000-01-30");
    assert.equal(range.left.label, "近 7 天");
    assert.equal(range.right.label, "近 30 天");
    assert.equal(range.right.days, 30);
    const locked = compareForAccess(week, false);
    assert.equal(locked.locked, true);
    assert.equal(locked.left, null);
    assert.equal(compareForAccess(week, true).left?.sleep, week.left.sleep);
  });

  it("rolling weeks do not invent extra days", () => {
    const { thisWeek, lastWeek } = splitRollingWeeks(syntheticSample.days.slice(0, 10), syntheticSample.days[9].date);
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
