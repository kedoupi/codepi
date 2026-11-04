export type WorkStatus = "decide" | "doing" | "bug" | "verify" | "idea";
export type NeedKind = "none" | "decide" | "attend" | "authorize" | "confirm";
export type ProjectStatus = "active" | "paused" | "archived";

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

export interface Handoff {
  id: string;
  task: string;
  status: "in_progress" | "blocked" | "ready_for_review" | "done";
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

export interface Branch {
  project: string;
  name: string;
  ahead: number;
  last_commit_at: string | null;
  has_fragment: boolean;
}

export interface Overview {
  as_of: string;
  today: string;
  counts: { open: number; need_you: number; overdue: number; due_7d: number; branches: number; done_7d: number };
  need_you: TaskBrief[];
  due_soon: TaskBrief[];
  dated?: TaskBrief[];
  recently_done: TaskBrief[];
  branches: Branch[];
  projects: ProjectSummary[];
}

export interface ProjectCard {
  project: {
    id: string;
    name: string;
    repo: string | null;
    status: ProjectStatus;
    rules_path: string | null;
    adapter: { isolation: string | null; commit: string | null; acceptance: string[]; merge: string | null } | null;
    source_sha: string | null;
    source_branch: string | null;
    last_push_at: string | null;
    url: string;
  };
  counts: { by_status: Record<WorkStatus, number>; need_you: number; done_7d: number };
  branches: Branch[];
  changelog: { date: string; title: string; summary: string | null }[];
  handoffs: Handoff[];
  token?: { created_at: string; last_used_at: string | null } | null;
}

export interface LogItem {
  kind: "change" | "done";
  project: string;
  date: string;
  title: string;
  summary: string | null;
  at: string | null;
}
