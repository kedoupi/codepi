export const RHYTHM_STATUSES = [
  "bedroom", "living_room", "home", "office_active", "office_away",
  "commute", "other_network", "unknown",
] as const;
export type RhythmStatus = typeof RHYTHM_STATUSES[number];
export type DayStatus = RhythmStatus | "not_arrived";
export type Evidence = "seen" | "inferred" | "no_data" | "not_arrived";
export type MomentKind = "wake" | "leave_home" | "start_work" | "leave_computer" | "arrive_home" | "return_bedroom";
export type AppCategory = "开发" | "沟通" | "文档" | "浏览" | "其他";

export type ActivitySample = {
  host?: string | null;
  sampled_at: string;
  idle_sec?: number | null;
  locked?: boolean | null;
  power?: string | null;
  app_name?: string | null;
  bundle_id?: string | null;
  received_at?: string | null;
  key_idle_sec?: number | null;
  pointer_idle_sec?: number | null;
  net?: "home" | "office" | "other" | "" | null;
  ssid?: string | null;
  net_key?: string | null;
};

export type HomeDevice = {
  source_id?: string | null;
  device_id: string;
  name?: string | null;
  vendor?: string | null;
  room?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  current_status?: "online" | "pending-offline" | "no-response" | "offline" | null;
};

export type HomeSnapshot = {
  source_id?: string | null;
  device_id: string;
  observed_at: string;
  received_at?: string | null;
  status: "online" | "pending-offline" | "no-response" | "offline";
  source?: string | null;
  room?: string | null;
  client_event_id?: string | null;
};

export type HomeEvent = {
  source_id?: string | null;
  device_id: string;
  event_at: string;
  kind?: string | null;
  status?: "online" | "pending-offline" | "no-response" | "offline" | null;
  received_at?: string | null;
  client_event_id?: string | null;
};

export type Heartbeat = {
  source_id?: string | null;
  observed_at: string;
  received_at?: string | null;
  scan_ok?: boolean | null;
  device_count?: number | null;
  error_category?: string | null;
  client_event_id?: string | null;
};

export type StateInput = {
  date: string;
  activity: ActivitySample[];
  devices: HomeDevice[];
  snapshots: HomeSnapshot[];
  events: HomeEvent[];
  heartbeats: Heartbeat[];
  subjectDeviceIds: string[];
  appCategories: Record<string, AppCategory>;
  otherNetworkNames?: Record<string, string>;
};

export type StatusSegment = { status: DayStatus; startMinute: number; endMinute: number; evidence: Evidence };
export type KeyMoment = { kind: MomentKind; minute: number; label: string; evidence: Evidence; detail: string };
export type AppBreakdown = { category: AppCategory; minutes: number; share: number; apps: Array<{ name: string; minutes: number }> };

export type DayMetrics = {
  /**
   * 指标可以为 null：缺少判断所需的一路数据时，指标是「未知」而不是 0。
   * 例如未指定手机时房间拆分不可判断，通勤也缺少在家锚点。
   */
  commuteToWorkMinutes: number | null;
  commuteHomeMinutes: number | null;
  officeActiveMinutes: number | null;
  homeMinutes: number | null;
  bedroomMinutes: number | null;
  livingRoomMinutes: number | null;
  homeUnknownMinutes: number | null;
};

export type DayComputation = {
  date: string;
  minuteStatuses: DayStatus[];
  minuteEvidence: Evidence[];
  minuteDetails: string[];
  segments: StatusSegment[];
  moments: KeyMoment[];
  metrics: DayMetrics;
  appBreakdown: AppBreakdown[];
  keyboardMouseMinutes: { keyboard: number | null; pointer: number | null; both: number | null };
  /** 当天自己有没有这一路数据（不含回看窗口与同批其他日期）。 */
  channels: { work: boolean; phone: boolean };
};

export type DayType = "workday" | "restday";
export type GapReason = "home_scan_missing" | "phone_scan_missing" | "work_machine_missing";

export type FocusMetrics = {
  segmentCount: number | null;
  totalMinutes: number | null;
  longestMinutes: number | null;
  communicationInterruptions: number | null;
};

export type CoverageMetrics = {
  ratio: number | null;
  gapReasonMinutes: Record<GapReason, number>;
};

export type DailyMetrics = DayMetrics & {
  statusMinutes: Record<RhythmStatus, number>;
  wakeMinute: number | null;
  leaveHomeMinute: number | null;
  startWorkMinute: number | null;
  leaveComputerMinute: number | null;
  arriveHomeMinute: number | null;
  returnBedroomMinute: number | null;
  officeSpanMinutes: number | null;
  focus: FocusMetrics;
  afterWorkWorkMachineMinutes: number | null;
  weekendWorkMachineMinutes: number | null;
  afterWorkRoomMinutes: Record<string, number>;
  weekendRoomMinutes: Record<string, number>;
  appCategoryMinutes: Record<AppCategory, number>;
  hourlyAppCategoryMinutes: Record<string, Record<AppCategory, number>>;
  topAppName: string | null;
  topAppMinutes: number | null;
  otherNetworkMinutes: Record<string, number>;
  coverage: CoverageMetrics;
  dayType: DayType;
};

export type DailyStatusRow = {
  date: string;
  segments: StatusSegment[];
  computedAt: string;
  version: string;
};

export type DailyMetricsRow = {
  date: string;
  metrics: DailyMetrics;
  computedAt: string;
  version: string;
};

export type SourceFreshness = {
  latestAt: string | null;
  ageMinutes: number | null;
  status: "fresh" | "stale" | "missing" | "time_anomaly";
};

export type SourcesResult = {
  home: { latestHeartbeat: SourceFreshness; method: string };
  work: { latestSample: SourceFreshness; method: string };
  settings: { subjectDeviceCount: number; appCategoryCount: number };
  caveats: string[];
  collection: string[];
};

export type DayResult = DayComputation & {
  freshness: SourcesResult;
  phoneConfigured: boolean;
};
