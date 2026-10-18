import { HEALTH_COLLECTIONS } from "./health-records.ts";

type Metric = {
  field: string;
  unit: string;
  daily: "sum" | "mean" | "weighted_sleep_mean";
  additive: boolean;
};
const metric = (field: string, unit: string, daily: Metric["daily"] = "mean", additive = false): Metric =>
  ({ field, unit, daily, additive });

/** Allowlisted provider fields, not arbitrary JSON paths or model supplied SQL. */
export const HEALTH_METRICS: Record<string, Metric[]> = {
  daily_metrics: [
    metric("sleep_score", "score_0_100"), metric("readiness_score", "score_0_100"),
    metric("activity_score", "score_0_100"), metric("steps", "steps", "mean", true),
  ],
  sleep: [
    metric("total_sleep_duration", "seconds", "sum", true),
    metric("deep_sleep_duration", "seconds", "sum", true),
    metric("rem_sleep_duration", "seconds", "sum", true),
    metric("light_sleep_duration", "seconds", "sum", true),
    metric("average_hrv", "ms", "weighted_sleep_mean"),
    metric("average_heart_rate", "bpm", "weighted_sleep_mean"),
    metric("average_breath", "breaths/min", "weighted_sleep_mean"),
  ],
  daily_sleep: [metric("score", "score_0_100")],
  daily_readiness: [metric("score", "score_0_100"), metric("temperature_deviation", "celsius_deviation")],
  daily_activity: [
    metric("score", "score_0_100"), metric("steps", "steps", "mean", true),
    metric("active_calories", "kcal", "mean", true), metric("total_calories", "kcal", "mean", true),
    metric("sedentary_time", "seconds", "mean", true),
    metric("high_activity_time", "seconds", "mean", true),
    metric("medium_activity_time", "seconds", "mean", true),
    metric("low_activity_time", "seconds", "mean", true),
  ],
  heartrate: [metric("bpm", "bpm")],
  daily_spo2: [metric("spo2_percentage.average", "percent")],
  daily_stress: [metric("stress_high", "seconds", "mean", true), metric("recovery_high", "seconds", "mean", true)],
  daily_cardiovascular_age: [metric("vascular_age", "years")],
  vO2_max: [metric("vo2_max", "ml/kg/min")],
  workout: [metric("calories", "kcal", "sum", true), metric("distance", "meters", "sum", true)],
};

const fields: Record<string, string[]> = {
  daily_metrics: ["day", "sleep_score", "readiness_score", "activity_score", "steps"],
  sleep: ["id", "day", "type", "bedtime_start", "bedtime_end", "time_in_bed", "efficiency", "latency", "awake_time",
    "heart_rate", "hrv", "sleep_phase_5_min"],
  daily_sleep: ["id", "day", "score", "contributors", "timestamp"],
  daily_readiness: ["id", "day", "score", "contributors", "temperature_trend_deviation", "timestamp"],
  daily_activity: ["id", "day", "contributors", "equivalent_walking_distance", "class_5_min", "met", "timestamp"],
  heartrate: ["bpm", "timestamp", "source"],
  daily_spo2: ["id", "day", "spo2_percentage", "breathing_disturbance_index"],
  daily_stress: ["id", "day", "day_summary"],
  daily_resilience: ["id", "day", "level", "contributors"],
  daily_cardiovascular_age: ["id", "day"],
  vO2_max: ["id", "day", "timestamp"],
  workout: ["id", "day", "activity", "intensity", "label", "start_datetime", "end_datetime", "source"],
  enhanced_tag: ["id", "start_day", "end_day", "start_time", "end_time", "comment", "tag_type_code", "custom_name"],
  session: ["id", "day", "type", "start_datetime", "end_datetime", "heart_rate", "heart_rate_variability"],
  sleep_time: ["id", "day", "optimal_bedtime", "recommendation", "status"],
  rest_mode_period: ["id", "start_day", "end_day", "episodes"],
  ring_configuration: ["id", "color", "design", "firmware_version", "hardware_type", "set_up_at", "size"],
  ring_battery_level: ["id", "timestamp", "battery_level", "ring_id"],
  personal_info: ["id", "age", "weight", "height", "biological_sex", "email"],
};

export const HEALTH_DATA_COLLECTIONS = [
  ...HEALTH_COLLECTIONS, { name: "daily_metrics", label: "看板评分缓存 / Dashboard scores", mode: "date" as const },
];

export function healthCatalog() {
  return HEALTH_DATA_COLLECTIONS.map(collection => ({
    ...collection,
    date_basis: collection.mode === "time" ? "UTC timestamp date"
      : ["profile", "snapshot"].includes(collection.mode) ? "current snapshot, not historical"
      : "provider assigned local day",
    max_query_days: collection.mode === "time" ? 7 : 31,
    fields: [...new Set([...(fields[collection.name] ?? []), ...(HEALTH_METRICS[collection.name] ?? []).map(m => m.field)])],
    metrics: (HEALTH_METRICS[collection.name] ?? []).map(m => ({
      ...m,
      operations: ["count", "mean", "min", "max", ...(m.additive ? ["sum"] : [])],
      aggregation_basis: "one derived value per provider day; mean weights days equally",
      daily_rule: m.daily === "weighted_sleep_mean"
        ? "weight valid measurements by positive total_sleep_duration; exclude rows missing the weight"
        : m.daily === "sum" ? "sum valid records assigned to the same day" : "mean valid records assigned to the same day",
    })),
    storage: collection.name === "daily_metrics" ? "dashboard daily cache, scores and steps only" : "detailed provider records",
    raw_fields: "Additional provider fields may be returned. Only listed metrics have supported arithmetic and units.",
  }));
}
