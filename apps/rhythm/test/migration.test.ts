// @ts-expect-error Vite provides the SQL raw importer at test runtime.
import migration from "../migrations/0003_work_page.sql?raw";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dailyRows, readDailyMetrics, upsertDailyRows } from "../worker/daily";
import { readSettings } from "../worker/settings";

const replaySql = migration.replace(/^ALTER TABLE[^\n]+;\n/gm, "");
const replayStatements = replaySql.split(/;\s*(?=\n|$)/).map((statement: string) => statement.trim()).filter(Boolean);
const TEST_NOW = Date.parse("2026-11-06T04:00:00.000Z");
function testDate(daysAgo: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(TEST_NOW - daysAgo * 86400_000));
}

const FIRST_DATE = testDate(5);
const SECOND_DATE = testDate(4);
const THIRD_DATE = testDate(3);

async function applyReplay() {
  for (const statement of replayStatements) await env.DB.exec(`${statement.replace(/\s+/g, " ")};`);
}
const initialCategories = {
  "com.openai.codex": "AI 编程", "com.todesktop.230313mzl4w4u92": "AI 编程", "dev.warp.Warp-Stable": "AI 编程",
  "com.bot.pc.doubao": "AI 对话", "com.tencent.WeWorkMac": "工作沟通", "com.tencent.wwmapp": "会议",
  "com.kingsoft.wpsoffice.mac": "文档", "com.apple.Notes": "文档", "com.google.Chrome": "浏览", "com.apple.Safari": "浏览",
  "com.tencent.xinWeChat": "私人", "com.hnc.Discord": "私人", "com.apple.finder": "其他", "com.apple.reminders": "其他",
  "com.apple.iCal": "其他", "com.apple.Preview": "其他",
};

async function insertDailyMetric(date: string) {
  await env.DB.prepare(
    "INSERT INTO daily_metrics (date, status_minutes_json, after_work_room_minutes_json, weekend_room_minutes_json, app_category_minutes_json, hourly_app_category_minutes_json, other_network_minutes_json, gap_reason_minutes_json, day_type, computed_at, version) VALUES (?, '{}', '{}', '{}', '{}', '{}', '{}', '{}', 'workday', ?, 'p8-2026-11-05')",
  ).bind(date, "2026-11-05T00:00:00.000Z").run();
}

describe("0003 work page migration", () => {
  it("inserts defaults and queues every existing daily date; replay is stable", async () => {
    await insertDailyMetric(FIRST_DATE);
    await insertDailyMetric(SECOND_DATE);
    await applyReplay();
    const settings = await env.DB.prepare("SELECT app_categories FROM settings WHERE id='default'").first<{ app_categories: string }>();
    const queue = await env.DB.prepare("SELECT date, reason FROM settings_recompute_queue ORDER BY date").all<{ date: string; reason: string }>();
    expect(JSON.parse(settings!.app_categories)).toEqual(initialCategories);
    expect(queue.results).toEqual([
      { date: FIRST_DATE, reason: "0003 work page" },
      { date: SECOND_DATE, reason: "0003 work page" },
    ]);
    const beforeSettings = await env.DB.prepare("SELECT * FROM settings").all();
    const beforeQueue = await env.DB.prepare("SELECT * FROM settings_recompute_queue").all();
    await applyReplay();
    expect(await env.DB.prepare("SELECT * FROM settings").all()).toEqual(beforeSettings);
    expect(await env.DB.prepare("SELECT * FROM settings_recompute_queue").all()).toEqual(beforeQueue);
  });

  it("fills an empty app category map but preserves a nonempty map", async () => {
    await env.DB.prepare("INSERT INTO settings (id, subject_device_ids, app_categories, other_network_names, anomaly_thresholds, updated_at) VALUES ('default', '[]', '{}', '{}', '{}', 'now')").run();
    await applyReplay();
    const filled = await env.DB.prepare("SELECT app_categories FROM settings WHERE id='default'").first<{ app_categories: string }>();
    expect(JSON.parse(filled!.app_categories)).toEqual(initialCategories);
    const beforeSettings = await env.DB.prepare("SELECT * FROM settings").all();
    const beforeQueue = await env.DB.prepare("SELECT * FROM settings_recompute_queue").all();
    await applyReplay();
    expect((await env.DB.prepare("SELECT * FROM settings").all()).results).toEqual(beforeSettings.results);
    expect((await env.DB.prepare("SELECT * FROM settings_recompute_queue").all()).results).toEqual(beforeQueue.results);

    await env.DB.prepare("DELETE FROM settings").run();
    await env.DB.prepare("INSERT INTO settings (id, subject_device_ids, app_categories, other_network_names, anomaly_thresholds, updated_at) VALUES ('default', '[]', ?, '{}', '{}', 'now')").bind(JSON.stringify({ custom: "私人" })).run();
    await applyReplay();
    expect(await env.DB.prepare("SELECT app_categories FROM settings WHERE id='default'").first()).toEqual({ app_categories: JSON.stringify({ custom: "私人" }) });
  });
  it("maps old settings and stored category rows on read", async () => {
    await env.DB.prepare("INSERT INTO settings (id, subject_device_ids, app_categories, updated_at) VALUES ('default', '[]', ?, 'now')").bind(JSON.stringify({ editor: "开发", chat: "沟通" })).run();
    const settings = await readSettings(env);
    expect(settings.appCategories).toEqual({ editor: "AI 编程", chat: "工作沟通" });
    await insertDailyMetric(THIRD_DATE);
    await env.DB.prepare("UPDATE daily_metrics SET app_category_minutes_json=? WHERE date=?").bind(JSON.stringify({ 开发: 4, 沟通: 3 }), THIRD_DATE).run();
    const row = await readDailyMetrics(env, THIRD_DATE);
    expect(row?.metrics.appCategoryMinutes).toMatchObject({ "AI 编程": 4, "工作沟通": 3 });
  });
  it("会议 App JSON 写入后可读回，旧平面格式仍归入 active", async () => {
    await env.DB.prepare("INSERT INTO daily_metrics (date, status_minutes_json, after_work_room_minutes_json, weekend_room_minutes_json, app_category_minutes_json, hourly_app_category_minutes_json, app_minutes_json, other_network_minutes_json, gap_reason_minutes_json, day_type, computed_at, version) VALUES (?, '{}', '{}', '{}', '{}', '{}', ?, '{}', '{}', 'workday', ?, 'p10-2026-11-06')")
      .bind(THIRD_DATE, JSON.stringify({ 示例编辑器: { minutes: 4, category: "AI 编程" } }), "2026-11-05T00:00:00.000Z").run();
    const legacy = await readDailyMetrics(env, THIRD_DATE);
    expect(legacy?.metrics.appMinutes?.["示例编辑器"]).toMatchObject({ minutes: 4, category: "AI 编程" });
    expect(legacy?.metrics.meetingAppMinutes).toEqual({});

    const rows = dailyRows({
      date: THIRD_DATE, devices: [], snapshots: [], events: [], heartbeats: [], subjectDeviceIds: [],
      appCategories: { "示例会议": "会议" },
      activity: [{ sampled_at: `${THIRD_DATE}T09:00:00+08:00`, net: "office", power: "电池", locked: false, key_idle_sec: 10, pointer_idle_sec: 10, app_name: "示例会议" }],
    }, undefined, `${THIRD_DATE}T20:30:00+08:00`);
    await upsertDailyRows(env, rows);
    const stored = await readDailyMetrics(env, THIRD_DATE);
    expect(stored?.metrics.appMinutes).toEqual({});
    expect(stored?.metrics.meetingAppMinutes?.["示例会议"]).toMatchObject({ minutes: 1, category: "会议" });
  });
});
