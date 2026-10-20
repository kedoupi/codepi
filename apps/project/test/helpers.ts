import { env } from "cloudflare:test";
import type { HandoffInput } from "../worker/handoffs";
import type { ProjectRow } from "../worker/types";

export const TEST_PROJECT_ID = "kedoupi-codepi";
export const TEST_BASE_SHA = "abbafdfe2d04966d66dad2f4f0084075f040caaf";

export async function resetDb() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM handoffs"),
    env.DB.prepare("DELETE FROM repo_events"),
    env.DB.prepare("DELETE FROM task_notes"),
    env.DB.prepare("DELETE FROM sync_state"),
    env.DB.prepare("DELETE FROM sync_leases"),
    env.DB.prepare("DELETE FROM card_fields"),
    env.DB.prepare("DELETE FROM projects"),
    env.DB.prepare("DELETE FROM kdp_sso_sessions"),
    env.DB.prepare("DELETE FROM kdp_sso_transactions"),
  ]);
}

export async function seedProject(
  overrides: Partial<ProjectRow> = {},
): Promise<ProjectRow> {
  const project: ProjectRow = {
    id: TEST_PROJECT_ID,
    repo: "kedoupi/codepi",
    name: "kdp.cool",
    status: "active",
    default_branch: "main",
    created_at: "2026-10-20T00:00:00Z",
    updated_at: "2026-10-20T00:00:00Z",
    ...overrides,
  };
  await env.DB.prepare(`INSERT INTO projects
    (id,repo,name,status,default_branch,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`)
    .bind(project.id, project.repo, project.name, project.status,
      project.default_branch, project.created_at, project.updated_at).run();
  return project;
}

export function handoffInput(
  overrides: Partial<HandoffInput> & Pick<HandoffInput, "taskId">,
): HandoffInput {
  return {
    projectId: TEST_PROJECT_ID,
    status: "in_progress",
    clientId: "test-client",
    clientName: "Test client",
    via: "mcp",
    summary: "Implemented the assigned slice.",
    next: "Run integration checks.",
    blockers: null,
    files: ["apps/project/worker/app.ts"],
    branch: "codex/test-task",
    baseSha: TEST_BASE_SHA,
    commit: null,
    pr: null,
    requestId: null,
    ...overrides,
  };
}

export function handoffArgs(overrides: Record<string, unknown> = {}) {
  return {
    project: "kedoupi/codepi",
    task_id: "task-a",
    status: "in_progress",
    summary: "Did a unit of work.",
    next: "Continue with tests.",
    branch: "codex/task-a",
    base_sha: TEST_BASE_SHA,
    ...overrides,
  };
}
