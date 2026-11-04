import type { SsoEnv } from "@kedoupi/shared/auth/client";
import type { TaskStatus } from "@kedoupi/shared/mcp/contract";

export interface Env extends SsoEnv {
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  PROJECT_ORIGIN?: string;
  BUILD_SHA?: string;
}

export const PROJECT_STATUSES = ["active", "paused", "archived"] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];
export type HandoffStatus = TaskStatus;

/** Pushed task states; the Chinese labels live in the UI and the pushing repository. */
export const WORK_STATUSES = ["decide", "doing", "bug", "verify", "idea"] as const;
export type WorkStatus = typeof WORK_STATUSES[number];
export const NEED_KINDS = ["none", "decide", "attend", "authorize", "confirm"] as const;
export type NeedKind = typeof NEED_KINDS[number];

export interface Adapter {
  isolation: string | null;
  commit: string | null;
  acceptance: string[];
  merge: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  repo: string | null;
  status: ProjectStatus;
  rules_path: string | null;
  adapter_json: string | null;
  source_sha: string | null;
  source_branch: string | null;
  last_push_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  project_id: string;
  key: string;
  title: string;
  status: WorkStatus;
  category: string;
  due: string | null;
  recorded: string | null;
  what: string | null;
  impact: string | null;
  advice: string | null;
  need: string | null;
  need_kind: NeedKind;
  source: string | null;
  related_json: string | null;
  position: number;
  first_seen: string;
  last_seen: string;
  done_at: string | null;
}

export interface BranchRow {
  project_id: string;
  name: string;
  ahead: number;
  last_commit_at: string | null;
  has_fragment: number;
}

export interface ChangelogRow {
  project_id: string;
  position: number;
  date: string;
  title: string;
  summary: string | null;
}

export interface HandoffRow {
  id: string;
  project_id: string;
  task_key: string;
  status: HandoffStatus;
  client_id: string;
  client_name: string | null;
  via: "mcp" | "web";
  summary: string;
  next: string;
  blockers: string | null;
  files: string | null;
  branch: string | null;
  base_sha: string | null;
  commit_sha: string | null;
  pr: string | null;
  request_id: string | null;
  created_at: string;
}

export interface Handoff {
  id: string;
  task: string;
  status: HandoffStatus;
  client: string;
  summary: string;
  next: string;
  blockers: string | null;
  files: string[];
  branch: string | null;
  base_sha: string | null;
  commit: string | null;
  pr: string | null;
  at: string;
}

/** Compact task row used by lists, the board and MCP summaries. */
export interface TaskBrief {
  project: string;
  key: string;
  title: string;
  status: WorkStatus;
  category: string;
  due: string | null;
  need_kind: NeedKind;
  done_at: string | null;
}

export interface TaskDetail extends TaskBrief {
  what: string | null;
  impact: string | null;
  advice: string | null;
  need: string | null;
  source: string | null;
  related: string[];
  recorded: string | null;
  first_seen: string;
  last_seen: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  repo: string | null;
  status: ProjectStatus;
  last_push_at: string | null;
  open: number;
  need_you: number;
  branches: number;
  url: string;
}
