export const RHYTHM_STATUSES = [
  "bedroom", "living_room", "home", "office_active", "office_away", "office_meeting",
  "commute", "outside", "other_network", "unknown",
] as const;
export type RhythmStatus = typeof RHYTHM_STATUSES[number];
export type DayStatus = RhythmStatus | "not_arrived";
export type Evidence = "seen" | "inferred" | "no_data" | "not_arrived";
export type MomentKind = "wake" | "leave_home" | "start_work" | "leave_computer" | "arrive_home" | "return_bedroom";
export const APP_CATEGORIES = ["AI 编程", "AI 对话", "工作沟通", "会议", "文档", "浏览", "私人", "其他"] as const;
export type AppCategory = typeof APP_CATEGORIES[number];

export function normalizeAppCategory(value: unknown): AppCategory | null {
  if (typeof value !== "string") return null;
  if ((APP_CATEGORIES as readonly string[]).includes(value)) return value as AppCategory;
  if (value === "开发") return "AI 编程";
  if (value === "沟通") return "工作沟通";
  return null;
}

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
export type WorkBlockKind = "active" | "away" | "meeting" | "other";
export type WorkBlockApp = { name: string; minutes: number };
export type WorkBlock = {
  kind: WorkBlockKind;
  status: DayStatus;
  label: string;
  startMinute: number;
  endMinute: number;
  startLabel: string;
  endLabel: string;
  minutes: number;
  activeMinutes: number;
  gapMinutes: number;
  inferred: boolean;
  appsKind: "app" | "none";
  primaryApp: (WorkBlockApp & { share: number }) | null;
  topApps: WorkBlockApp[];
  apps: WorkBlockApp[];
};

export type DayMetrics = {
  /**
   * 指标可以为 null：缺少判断所需的一路数据时，指标是「未知」而不是 0。
   * 例如未指定手机时房间拆分不可判断，通勤也缺少在家锚点。
   */
  commuteToWorkMinutes: number | null;
  commuteHomeMinutes: number | null;
  officeActiveMinutes: number | null;
  officeMeetingMinutes?: number | null;
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
  workBlocks: WorkBlock[];
  metrics: DayMetrics;
  appBreakdown: AppBreakdown[];
  meetingAppBreakdown?: AppBreakdown[];
  keyboardMouseMinutes: { keyboard: number | null; pointer: number | null; both: number | null };
  /** 当天自己有没有这一路数据（不含回看窗口与同批其他日期）。 */
  channels: { work: boolean; phone: boolean };
};

export type DayType = "workday" | "restday";
export type GapReason = "home_scan_missing" | "phone_scan_missing" | "work_machine_missing";

export type FocusSegment = {
  startMinute: number;
  endMinute: number;
  minutes: number;
  primaryCategory: AppCategory;
  interruptedAt: number[];
};

export type FocusMetrics = {
  segmentCount: number | null;
  totalMinutes: number | null;
  longestMinutes: number | null;
  communicationInterruptions: number | null;
  segments: FocusSegment[] | null;
};

export type CoverageMetrics = {
  ratio: number | null;
  gapReasonMinutes: Record<GapReason, number>;
};

export type DailyMetrics = DayMetrics & {
  statusMinutes: Record<string, number>;
  wakeMinute: number | null;
  leaveHomeMinute: number | null;
  startWorkMinute: number | null;
  leaveComputerMinute: number | null;
  arriveHomeMinute: number | null;
  returnBedroomMinute: number | null;
  officeSpanMinutes: number | null;
  meetingAppCategoryMinutes?: Record<AppCategory, number>;
  meetingAppMinutes?: Record<string, { minutes: number; category: AppCategory }> | null;
  focus: FocusMetrics;
  afterWorkWorkMachineMinutes: number | null;
  weekendWorkMachineMinutes: number | null;
  afterWorkRoomMinutes: Record<string, number>;
  weekendRoomMinutes: Record<string, number>;
  appCategoryMinutes: Record<AppCategory, number>;
  hourlyAppCategoryMinutes: Record<string, Record<AppCategory, number>>;
  appMinutes: Record<string, { minutes: number; category: AppCategory }> | null;
  hourlyActiveMinutes: Record<string, number> | null;
  hourlySwitchCounts: Record<string, number> | null;
  focusSegments: FocusSegment[] | null;
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
