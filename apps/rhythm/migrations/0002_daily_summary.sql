CREATE TABLE IF NOT EXISTS daily_status (
  date TEXT PRIMARY KEY,
  segments_json TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  date TEXT PRIMARY KEY,
  status_minutes_json TEXT NOT NULL,
  commute_to_work_minutes INTEGER,
  commute_home_minutes INTEGER,
  wake_minute INTEGER,
  leave_home_minute INTEGER,
  start_work_minute INTEGER,
  leave_computer_minute INTEGER,
  arrive_home_minute INTEGER,
  return_bedroom_minute INTEGER,
  office_active_minutes INTEGER,
  home_minutes INTEGER,
  bedroom_minutes INTEGER,
  living_room_minutes INTEGER,
  home_unknown_minutes INTEGER,
  office_span_minutes INTEGER,
  focus_segment_count INTEGER,
  focus_total_minutes INTEGER,
  focus_longest_minutes INTEGER,
  communication_interruptions INTEGER,
  after_work_work_machine_minutes INTEGER,
  weekend_work_machine_minutes INTEGER,
  app_category_minutes_json TEXT NOT NULL,
  hourly_app_category_minutes_json TEXT NOT NULL,
  top_app_name TEXT,
  top_app_minutes INTEGER,
  other_network_minutes_json TEXT NOT NULL,
  coverage_ratio REAL,
  gap_reason_minutes_json TEXT NOT NULL,
  day_type TEXT NOT NULL CHECK (day_type IN ('workday', 'restday')),
  computed_at TEXT NOT NULL,
  version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings_recompute_queue (
  date TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  queued_at TEXT NOT NULL
);
