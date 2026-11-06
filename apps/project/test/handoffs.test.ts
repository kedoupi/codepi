import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { parseHandoffInput, saveHandoff, taskHandoffs, latestPerTask } from "../worker/handoffs";
import { findSecret } from "../worker/scan";
import { handoffInput, resetDb, seedProject, TEST_PROJECT_ID } from "./helpers";

describe("handoffs", () => {
  beforeEach(async () => {
    await resetDb();
    await seedProject();
  });

  it("accepts optional branch and SHA and rejects malformed ones", () => {
    const opts = { projectId: TEST_PROJECT_ID, clientId: "c", via: "mcp" as const };
    const base = { task: "t", status: "done", summary: "s", next: "n" };
    expect(parseHandoffInput(base, opts)).toMatchObject({ branch: null, baseSha: null });
    expect(() => parseHandoffInput({ ...base, base_sha: "XYZ" }, opts)).toThrow("invalid_base_sha");
    expect(() => parseHandoffInput({ ...base, status: "maybe" }, opts)).toThrow("invalid_status");
    expect(() => parseHandoffInput({ ...base, task_id: "old" }, opts)).toThrow("invalid_arguments");
  });

  it("keeps the latest handoff per task", async () => {
    await saveHandoff(env, handoffInput({ task: "a", summary: "first" }));
    await saveHandoff(env, handoffInput({ task: "b", summary: "other" }));
    await saveHandoff(env, handoffInput({ task: "a", summary: "second", status: "done" }));
    const latest = await latestPerTask(env, TEST_PROJECT_ID, 10);
    expect(latest.map(h => [h.task, h.summary])).toEqual([["a", "second"], ["b", "other"]]);
    expect(await taskHandoffs(env, TEST_PROJECT_ID, "a", 10)).toHaveLength(2);
  });
});

describe("secret scan", () => {
  it("flags credential shapes and reports the path only", () => {
    const hits = [
      "trojan://pw@host:443", "ss://YWVzLTI1Ni1nY206cGFzcw@host:8388", "ghp_" + "a".repeat(36),
      "github_pat_" + "b".repeat(30), "sk-" + "c".repeat(40), "AKIA" + "D".repeat(16),
      "xoxb-1234567890-abcdef", "-----BEGIN OPENSSH PRIVATE KEY-----",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcdefghijk", "https://sub.example/x?token=abcdef123456",
      "password: hunter2hunter2",
    ];
    for (const value of hits) expect(findSecret({ a: [value] }), value).toBe("/a/0");
  });

  it("does not flag ordinary task text", () => {
    const fine = [
      "推送令牌放钥匙串，不进仓库", "GITHUB_TOKEN 2027-01-18 到期前轮换", "订阅地址不写进文档",
      "https://project.codepi.app/?task=codepi%2Ftask", "按 token 形态扫描", "vless 协议说明", "docs/vps.md",
      "token: 到期前在后台轮换并更新钥匙串", "password: 改存到 1Password 并更新说明",
    ];
    for (const value of fine) expect(findSecret(value), value).toBeNull();
  });
});
