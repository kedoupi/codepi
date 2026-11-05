// @ts-expect-error Vite provides the SQL raw importer at test runtime.
import migration from "../migrations/0003_work_page.sql?raw";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { readDailyMetrics } from "../worker/daily";
import { readSettings } from "../worker/settings";

const replaySql = migration.replace(/^ALTER TABLE[^\n]+;\n/gm, "");
const replayStatements = replaySql.split(/;\s*(?=\n|$)/).map((statement: string) => statement.trim()).filter(Boolean);

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
    await insertDailyMetric("2026-11-01");
    await insertDailyMetric("2026-11-02");
    await applyReplay();
    const settings = await env.DB.prepare("SELECT app_categories FROM settings WHERE id='default'").first<{ app_categories: string }>();
    const queue = await env.DB.prepare("SELECT date, reason FROM settings_recompute_queue ORDER BY date").all<{ date: string; reason: string }>();
    expect(JSON.parse(settings!.app_categories)).toEqual(initialCategories);
    expect(queue.results).toEqual([
      { date: "2026-11-01", reason: "0003 work page" },
      { date: "2026-11-02", reason: "0003 work page" },
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
    await insertDailyMetric("2026-11-03");
    await env.DB.prepare("UPDATE daily_metrics SET app_category_minutes_json=? WHERE date=?").bind(JSON.stringify({ 开发: 4, 沟通: 3 }), "2026-11-03").run();
    const row = await readDailyMetrics(env, "2026-11-03");
    expect(row?.metrics.appCategoryMinutes).toMatchObject({ "AI 编程": 4, "工作沟通": 3 });
  });
});
