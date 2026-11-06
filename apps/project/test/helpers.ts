import { env } from "cloudflare:test";
import { createProject } from "../worker/projects";
import type { HandoffInput } from "../worker/handoffs";

export const TEST_PROJECT_ID = "codepi";
export const TEST_BASE_SHA = "abbafdfe2d04966d66dad2f4f0084075f040caaf";

export async function resetDb() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM agent_checked"),
    env.DB.prepare("DELETE FROM today_picks"),
    env.DB.prepare("DELETE FROM owner_deleted"),
    env.DB.prepare("DELETE FROM owner_done"),
    env.DB.prepare("DELETE FROM handoffs"),
    env.DB.prepare("DELETE FROM tasks"),
    env.DB.prepare("DELETE FROM branches"),
    env.DB.prepare("DELETE FROM changelog_entries"),
    env.DB.prepare("DELETE FROM snapshots"),
    env.DB.prepare("DELETE FROM ingest_tokens"),
    env.DB.prepare("DELETE FROM projects"),
    env.DB.prepare("DELETE FROM kdp_sso_sessions"),
    env.DB.prepare("DELETE FROM kdp_sso_transactions"),
  ]);
}

/** Creates a project through the real code path and returns its one-time push token. */
export async function seedProject(id = TEST_PROJECT_ID, name = "codepi", repo: string | null = "kedoupi/codepi") {
  const { token } = await createProject(env, { id, name, repo });
  return token;
}

export interface SampleTask {
  key?: string;
  title: string;
  status: string;
  category: string;
  due?: string | null;
  need_kind?: string;
  need?: string;
  what?: string;
  impact?: string;
  advice?: string;
  source?: string;
  related?: string[];
}

/** Synthetic tasks only; no real owner data in tests. */
export function sampleTasks(): SampleTask[] {
  return [
    { title: "续费示例服务器", status: "doing", category: "基础设施", due: "2026-11-11", need_kind: "attend",
      need: "到场（登录后台付款）", what: "示例说明", impact: "示例影响", advice: "示例建议", source: "docs/a.md",
      related: ["docs/b.md"] },
    { title: "选择示例方案", status: "decide", category: "流程", due: "2026-11-05", need_kind: "decide", need: "决定" },
    { title: "修复示例缺陷", status: "bug", category: "网关", need_kind: "none", need: "无" },
    { title: "示例想法", status: "idea", category: "流程", need_kind: "none" },
  ];
}

export function samplePayload(overrides: Record<string, unknown> = {}) {
  return {
    schema: "workbench.v1",
    generated_at: "2026-11-04T06:00:00Z",
    project: {
      name: "codepi",
      rules_path: "AGENTS.md",
      adapter: { isolation: "worktree", commit: "允许", acceptance: ["pnpm check"], merge: "agent-team merge" },
    },
    source: { sha: "abbafdf", branch: "main" },
    tasks: sampleTasks(),
    branches: [{ name: "team/example", ahead: 3, last_commit_at: "2026-11-04T05:00:00Z", has_fragment: true }],
    changelog: [
      { date: "2026-11-04", title: "示例变更 A", summary: "示例摘要" },
      { date: "2026-11-03", title: "示例变更 B" },
    ],
    ...overrides,
  };
}

export function ingestRequest(project: string, token: string | null, body: unknown) {
  return new Request(`https://project.codepi.app/api/ingest/${project}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function handoffArgs(overrides: Record<string, unknown> = {}) {
  return {
    project: TEST_PROJECT_ID,
    task: "task-a",
    status: "in_progress",
    summary: "Did a unit of work.",
    next: "Continue with tests.",
    ...overrides,
  };
}

export function handoffInput(overrides: Partial<HandoffInput> = {}): HandoffInput {
  return {
    projectId: TEST_PROJECT_ID,
    task: "task-a",
    status: "in_progress",
    clientId: "test-client",
    clientName: "Test client",
    via: "mcp",
    summary: "Implemented the assigned slice.",
    next: "Run integration checks.",
    blockers: null,
    files: [],
    branch: null,
    baseSha: null,
    commit: null,
    pr: null,
    requestId: null,
    ...overrides,
  };
}
