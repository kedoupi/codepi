import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { DONE_RETENTION_DAYS, SNAPSHOT_KEEP } from "../worker/ingest";
import { ingestRequest, resetDb, samplePayload, sampleTasks, seedProject } from "./helpers";

const push = (project: string, token: string | null, body: unknown) =>
  worker.fetch(ingestRequest(project, token, body), env);

async function openTasks() {
  return (await env.DB.prepare("SELECT title, status, done_at FROM tasks WHERE project_id='codepi' ORDER BY position")
    .all<{ title: string; status: string; done_at: string | null }>()).results;
}

describe("ingest", () => {
  let token: string;
  beforeEach(async () => {
    await resetDb();
    token = await seedProject();
  });

  it("rejects missing, wrong and other projects' tokens with one indistinguishable error", async () => {
    const other = await seedProject("mybrain", "MyBrain", null);
    for (const [project, value] of [["codepi", null], ["codepi", "cpw_wrongwrongwrongwrongwrong"], ["codepi", other],
      ["missing", token]] as const) {
      const res = await push(project, value, samplePayload());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_token" });
    }
    expect(await openTasks()).toHaveLength(0);
  });

  it("does not need a browser Origin header or session", async () => {
    const res = await push("codepi", token, samplePayload());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ project: "codepi", deduplicated: false, tasks: 4, newly_done: 0 });
  });

  it("rejects credential-shaped text, reporting only the field path", async () => {
    const tasks = sampleTasks();
    tasks[1].advice = "把 vless://example-user@example.invalid:443 加进配置";
    const res = await push("codepi", token, samplePayload({ tasks }));
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: "secret_detected", details: { field: "/tasks/1/advice" } });
    expect(body).not.toContain("example-user");
    expect(await openTasks()).toHaveLength(0);
  });

  it("validates the schema strictly", async () => {
    const cases: [unknown, string][] = [
      [samplePayload({ schema: "workbench.v0" }), "unsupported_schema"],
      [samplePayload({ extra: true }), "invalid_arguments"],
      [samplePayload({ tasks: [{ ...sampleTasks()[0], status: "执行" }] }), "invalid_task_status"],
      [samplePayload({ tasks: [{ ...sampleTasks()[0], due: "2026-13-40" }] }), "invalid_task_due"],
      [samplePayload({ tasks: [{ ...sampleTasks()[0], due: "2026-02-31" }] }), "invalid_task_due"],
      [samplePayload({ changelog: [{ date: "2026-04-31", title: "不存在的日子" }] }), "invalid_changelog"],
      [samplePayload({ tasks: undefined }), "invalid_tasks"],
      [samplePayload({ tasks: [sampleTasks()[0], sampleTasks()[0]] }), "duplicate_task"],
      [samplePayload({ tasks: [{ ...sampleTasks()[0], need_kind: "maybe" }] }), "invalid_need_kind"],
      [samplePayload({ branches: [{ name: "a", ahead: -1 }] }), "invalid_branch"],
      [samplePayload({ changelog: [{ title: "no date" }] }), "invalid_changelog"],
      [samplePayload({ tasks: Array.from({ length: 501 }, (_, i) => ({ title: `t${i}`, status: "idea", category: "c" })) }),
        "invalid_tasks"],
    ];
    for (const [body, error] of cases) {
      const res = await push("codepi", token, body);
      expect(res.status, error).toBe(422);
      expect((await res.json() as { error: string }).error).toBe(error);
    }
  });

  it("rejects bodies over 256 KiB before parsing", async () => {
    const res = await push("codepi", token, `{"schema":"workbench.v1","pad":"${"x".repeat(260 * 1024)}"}`);
    expect(res.status).toBe(413);
  });

  it("records tasks, then marks tasks missing from a later push as done and revives them", async () => {
    await push("codepi", token, samplePayload());
    const first = await env.DB.prepare("SELECT first_seen FROM tasks WHERE title='续费示例服务器'").first<{ first_seen: string }>();
    const fewer = samplePayload({ tasks: sampleTasks().slice(1) });
    const res = await push("codepi", token, fewer);
    expect(await res.json()).toMatchObject({ deduplicated: false, newly_done: 1, tasks: 3 });
    const rows = await openTasks();
    expect(rows.find(row => row.title === "续费示例服务器")?.done_at).toBeTruthy();
    expect(rows.filter(row => !row.done_at)).toHaveLength(3);

    await push("codepi", token, samplePayload());
    const revived = await env.DB.prepare("SELECT first_seen, done_at FROM tasks WHERE title='续费示例服务器'")
      .first<{ first_seen: string; done_at: string | null }>();
    expect(revived?.done_at).toBeNull();
    expect(revived?.first_seen).toBe(first?.first_seen);
  });

  it("deduplicates identical content and keeps updating the last push time", async () => {
    await push("codepi", token, samplePayload());
    // generated_at is transport metadata and does not change the content hash.
    const again = await push("codepi", token, samplePayload({ generated_at: "2026-11-04T07:00:00Z" }));
    expect(await again.json()).toMatchObject({ deduplicated: true });
    const snapshots = await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshots").first<{ n: number }>();
    expect(snapshots?.n).toBe(1);
    const project = await env.DB.prepare("SELECT last_push_at, adapter_json, rules_path FROM projects WHERE id='codepi'")
      .first<{ last_push_at: string; adapter_json: string; rules_path: string }>();
    expect(project?.last_push_at).toBeTruthy();
    expect(JSON.parse(project!.adapter_json)).toMatchObject({ isolation: "worktree", acceptance: ["pnpm check"] });
    expect(project?.rules_path).toBe("AGENTS.md");
  });

  it("replaces branches and changelog on each push", async () => {
    await push("codepi", token, samplePayload());
    await push("codepi", token, samplePayload({ branches: [], changelog: [{ date: "2026-11-05", title: "只剩这一条" }] }));
    const branches = await env.DB.prepare("SELECT COUNT(*) AS n FROM branches").first<{ n: number }>();
    const log = await env.DB.prepare("SELECT title FROM changelog_entries").all<{ title: string }>();
    expect(branches?.n).toBe(0);
    expect(log.results.map(row => row.title)).toEqual(["只剩这一条"]);
  });

  it("keeps a bounded snapshot history and prunes long-done tasks", async () => {
    for (let i = 0; i < SNAPSHOT_KEEP + 3; i++) {
      await push("codepi", token, samplePayload({ changelog: [{ date: "2026-11-04", title: `变更 ${i}` }] }));
    }
    const snapshots = await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshots").first<{ n: number }>();
    expect(snapshots?.n).toBe(SNAPSHOT_KEEP);
    const old = new Date(Date.now() - (DONE_RETENTION_DAYS + 1) * 86400_000).toISOString();
    await env.DB.prepare("UPDATE tasks SET done_at=? WHERE title='示例想法'").bind(old).run();
    await push("codepi", token, samplePayload({ tasks: sampleTasks().slice(0, 3) }));
    const gone = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE title='示例想法'").first<{ n: number }>();
    expect(gone?.n).toBe(0);
  });

  it("prunes long-done tasks on an unchanged push too", async () => {
    await push("codepi", token, samplePayload({ tasks: sampleTasks().slice(0, 3) }));
    await push("codepi", token, samplePayload({ tasks: sampleTasks().slice(0, 2) }));
    const old = new Date(Date.now() - (DONE_RETENTION_DAYS + 1) * 86400_000).toISOString();
    await env.DB.prepare("UPDATE tasks SET done_at=? WHERE title='修复示例缺陷'").bind(old).run();
    const same = await push("codepi", token, samplePayload({ tasks: sampleTasks().slice(0, 2) }));
    expect(await same.json()).toMatchObject({ deduplicated: true });
    const gone = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE title='修复示例缺陷'").first<{ n: number }>();
    expect(gone?.n).toBe(0);
  });

  it("an explicit empty task list marks everything done, a missing one is rejected", async () => {
    await push("codepi", token, samplePayload());
    const empty = await push("codepi", token, samplePayload({ tasks: [] }));
    expect(await empty.json()).toMatchObject({ newly_done: 4, tasks: 0 });
  });

  it("keeps the name set on the web page when a push carries another name", async () => {
    await env.DB.prepare("UPDATE projects SET name='网页上的名字' WHERE id='codepi'").run();
    await push("codepi", token, samplePayload());
    const row = await env.DB.prepare("SELECT name FROM projects WHERE id='codepi'").first<{ name: string }>();
    expect(row?.name).toBe("网页上的名字");
  });

  it("uses a stable key from category and title when none is supplied", async () => {
    await push("codepi", token, samplePayload());
    const keyed = sampleTasks().map(task => ({ ...task }));
    keyed[0].advice = "建议改了，键不变";
    await push("codepi", token, samplePayload({ tasks: keyed }));
    const rows = await env.DB.prepare("SELECT key, advice FROM tasks WHERE title='续费示例服务器'").all<{ key: string; advice: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].advice).toBe("建议改了，键不变");
    expect(rows.results[0].key).toMatch(/^[0-9a-f]{32}$/);
  });
});
