import type {
  Handoff,
  ProjectCard,
  ProjectStatus,
} from "../../../worker/types";

export type { Handoff, ProjectCard, ProjectStatus };

export interface ProjectListItem {
  id: string;
  repo: string;
  name: string;
  status: ProjectStatus;
  last_activity_at: string | null;
  url: string;
  latest_handoff: Handoff | null;
}

export interface ProjectListResponse {
  as_of: string | null;
  projects: ProjectListItem[];
}

export interface HandoffsResponse {
  handoffs: Handoff[];
  next_before: string | null;
  next_before_id: string | null;
}

export interface HandoffDraft {
  task_id: string;
  status: "in_progress" | "blocked" | "ready_for_review" | "done";
  summary: string;
  next: string;
  blockers?: string;
  files?: string[];
  branch: string;
  base_sha: string;
  commit?: string;
  pr?: string;
  request_id: string;
}
