ALTER TABLE daily_metrics ADD COLUMN app_minutes_json TEXT;
ALTER TABLE daily_metrics ADD COLUMN hourly_active_minutes_json TEXT;
ALTER TABLE daily_metrics ADD COLUMN hourly_switch_counts_json TEXT;
ALTER TABLE daily_metrics ADD COLUMN focus_segments_json TEXT;

INSERT INTO settings (id, subject_device_ids, app_categories, other_network_names, anomaly_thresholds, updated_at)
VALUES (
  'default', '[]',
  '{"com.openai.codex":"AI 编程","com.todesktop.230313mzl4w4u92":"AI 编程","dev.warp.Warp-Stable":"AI 编程","com.bot.pc.doubao":"AI 对话","com.tencent.WeWorkMac":"工作沟通","com.tencent.wwmapp":"会议","com.kingsoft.wpsoffice.mac":"文档","com.apple.Notes":"文档","com.google.Chrome":"浏览","com.apple.Safari":"浏览","com.tencent.xinWeChat":"私人","com.hnc.Discord":"私人","com.apple.finder":"其他","com.apple.reminders":"其他","com.apple.iCal":"其他","com.apple.Preview":"其他"}',
  '{}', '{"earlyLateMinutes":40,"commutePercent":50}', CURRENT_TIMESTAMP
)
ON CONFLICT(id) DO UPDATE SET app_categories=excluded.app_categories
WHERE settings.app_categories='{}';

INSERT INTO settings_recompute_queue (date, reason, queued_at)
SELECT date, '0003 work page', CURRENT_TIMESTAMP FROM daily_metrics WHERE true
ON CONFLICT(date) DO NOTHING;
