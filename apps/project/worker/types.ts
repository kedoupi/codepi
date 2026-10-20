import type { SsoEnv } from "@kedoupi/shared/auth/client";
import type { TaskStatus } from "@kedoupi/shared/mcp/contract";

export interface Env extends SsoEnv {
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  PROJECT_ORIGIN?: string;
  PROJECT_REPOS?: string;
  GITHUB_TOKEN?: string;
  BUILD_SHA?: string;
}

export type ProjectStatus = "active" | "paused" | "archived";
export type HandoffStatus = TaskStatus;
export type CardTaskStatus = TaskStatus | "unknown";
export type SyncSource = "commits" | "pulls" | "issues" | "agents_md" | "tasks";

export interface ProjectRow {
  id: string;
  repo: string;
  name: string;
  status: ProjectStatus;
  default_branch: string;
  created_at: string;
  updated_at: string;
}

export interface CardFieldRow {
  project_id: string;
  field: "goal" | "scope" | "conventions" | "pitfalls";
  auto_value: string | null;
  auto_sha: string | null;
  edited_value: string | null;
  edited_base_sha: string | null;
  edited_at: string | null;
}

export interface HandoffRow {
  id: string;
  project_id: string;
  task_id: string;
  status: HandoffStatus;
  client_id: string;
  client_name: string | null;
  via: "mcp" | "web";
  summary: string;
  next: string;
  blockers: string | null;
  files: string | null;
  branch: string;
  base_sha: string;
  commit_sha: string | null;
  pr: string | null;
  request_id: string | null;
  created_at: string;
}

export interface RepoEventRow {
  project_id: string;
  kind: "commit" | "pr" | "issue";
  ref: string;
  title: string;
  state: string | null;
  author: string | null;
  url: string;
  happened_at: string;
  merged_at: string | null;
}

export interface TaskNoteRow {
  project_id: string;
  path: string;
  title: string;
  status_line: string | null;
  status: CardTaskStatus;
  sha: string;
  updated_at: string;
}

export interface SyncStateRow {
  project_id: string;
  source: SyncSource;
  cursor: string | null;
  checkpoint: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
}

export interface Handoff {
  id: string;
  task_id: string;
  status: HandoffStatus;
  client: string;
  summary: string;
  next: string;
  blockers: string | null;
  files: string[];
  branch: string;
  base_sha: string;
  commit: string | null;
  pr: string | null;
  at: string;
}

export interface Field {
  value: string | null;
  auto_value: string | null;
  source: "edited" | "agents_md" | "none";
  agents_md_changed: boolean;
}

export interface Event {
  ref: string;
  title: string;
  state: string | null;
  author: string | null;
  at: string;
  url: string;
}

export interface ProjectCard {
  as_of: string;
  project: {
    id: string;
    repo: string;
    name: string;
    status: ProjectStatus;
    default_branch: string;
    url: string;
  };
  goal: Field;
  scope: Field;
  conventions: Field;
  pitfalls: Field;
  progress: Handoff | null;
  task_progress: { task_id: string; status: HandoffStatus; latest: Handoff }[];
  recent_handoffs: Handoff[];
  recent_commits: {
    sha: string;
    title: string;
    author: string | null;
    at: string;
    url: string;
  }[];
  open_prs: Event[];
  recently_merged: Event[];
  open_issues: Event[];
  active_tasks: {
    path: string;
    title: string;
    status_line: string | null;
    status: CardTaskStatus;
  }[];
  sync: Record<SyncSource, { last_ok_at: string | null; error: string | null }>;
  notice: string;
}
