import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { jsonBytes, type MeOperation } from "@kedoupi/shared/mcp/contract";
import { call, count, data, rpc } from "./helpers";
import { reviewMemory, reviewProfileProposal, reviewTimeline, listProfile, upsertProfile } from "../worker/data";
import { MAX_PAGE_BYTES, MAX_SUMMARY_BYTES } from "../worker/lib";

it("keeps every AI memory kind pending until an owner review; short Chinese LIKE works literally", async () => {
  for (const kind of ["preference", "fact", "decision", "lesson", "note"]) {
    const saved = data(await call("memory.save", { text: `喜欢中文写作 ${kind}`, kind, tags: ["写作"] }));
    expect(saved.status).toBe("pending");
  }
  expect(data(await call("memory.search", { query: "写作" })).items).toEqual([]);
  expect(await count("memories", "status='pending'")).toBe(5);
  const row = await env.DB.prepare("SELECT id FROM memories WHERE kind='preference'").first<{ id: string }>();
  await reviewMemory(env, row!.id, "approve");
  const found = data(await call("memory.search", { query: "写作", tags: ["写作"] })).items as { source_client: string }[];
  expect(found).toHaveLength(1);
  expect(found[0].source_client).toBe("synthetic-client");
  expect(data(await call("memory.search", { query: "%" })).items).toEqual([]);
  expect(data(await call("memory.search", { query: "' OR 1=1 --" })).items).toEqual([]);
});

it("matches decoded memory tags by exact value and escaped LIKE for quotes, backslashes and wildcards", async () => {
  const tags = ['a"b', "a\\b", "100%", "a_b", "中文"];
  const saved = data(await call("memory.save", { kind: "note", text: "标签原值", tags }));
  await reviewMemory(env, String(saved.id), "approve");
  const plain = data(await call("memory.save", { kind: "note", text: "普通标签", tags: ["普通"] }));
  await reviewMemory(env, String(plain.id), "approve");

  for (const tag of tags) {
    expect(data(await call("memory.search", { tags: [tag] })).items)
      .toEqual([expect.objectContaining({ id: saved.id, tags })]);
  }
  for (const query of ['a"b', "a\\b", "100%", "a_b", "中文"]) {
    expect(data(await call("memory.search", { query })).items)
      .toEqual([expect.objectContaining({ id: saved.id })]);
  }
  expect(data(await call("memory.search", { query: "%" })).items)
    .toEqual([expect.objectContaining({ id: saved.id })]);
  expect(data(await call("memory.search", { query: "_" })).items)
    .toEqual([expect.objectContaining({ id: saved.id })]);
  expect(data(await call("memory.search", { tags: ["100"] })).items).toEqual([]);
  expect(data(await call("memory.search", { tags: ["a%"] })).items).toEqual([]);
});

it("validates exact args, types, operation, subject and source without accepting a board impersonation", async () => {
  for (const [operation, args] of [
    ["memory.search", { status: "pending" }], ["memory.search", { limit: "2" }],
    ["memory.search", { offset: -1 }], ["memory.search", { tags: [1] }],
    ["memory.save", { kind: "note", text: "synthetic", source_client: "board" }],
    ["profile.get", { cursor: "0" }], ["entry.propose", { type: "profile", key: "role", value: "测试", title: "错字段" }],
    ["entry.propose", { type: "timeline", kind: "work", title: "测试", key: "role" }],
    ["memory.import.start", { import_id: "unexpected" }], ["timeline.search", { from: "2026-02-30" }],
    ["memory.search", { query: null }], ["memory.search", { limit: 51 }],
  ] as [MeOperation, Record<string, unknown>][]) {
    expect(await call(operation, args)).toMatchObject({ ok: false, status: 400 });
  }
  expect(await call("memory.save", { kind: "note", text: "测试" }, "board")).toMatchObject({ ok: false, status: 403 });
  expect(await rpc().execute({ subject: "somebody", operation: "profile.get", args: {} })).toMatchObject({ ok: false, status: 403 });
  expect(await rpc().execute({ subject: "kdp-owner", operation: "memory.save", args: { kind: "note", text: "测试" } }))
    .toMatchObject({ ok: false, status: 400 });
  expect(await count("memories")).toBe(0);
});

it("rejects secret-looking values in all write channels without logging or storing their contents", async () => {
  const log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error"), warn = vi.spyOn(console, "warn");
  const secret = `ghp_${"synthetic".repeat(6)}`;
  for (const [operation, args] of [
    ["memory.save", { kind: "note", text: secret }],
    ["memory.save", { kind: "fact", text: "合成记录", tags: [secret] }],
    ["entry.propose", { type: "profile", key: "role", value: secret }],
    ["entry.propose", { type: "timeline", kind: "work", title: "测试", body: secret }],
  ] as [MeOperation, Record<string, unknown>][]) {
    const reply = await call(operation, args);
    expect(reply).toMatchObject({ ok: false, error: "secret_detected" });
    expect(JSON.stringify(reply)).not.toContain(secret);
  }
  expect(await count("memories")).toBe(0);
  expect(await count("profile_proposals")).toBe(0);
  expect(await count("timeline")).toBe(0);
  expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
});

it("does not trust arbitrary profile tags; only dedicated approved proposals change the profile", async () => {
  const memory = data(await call("memory.save", { kind: "fact", text: "untrusted", tags: ["profile:role"] }));
  await reviewMemory(env, String(memory.id), "approve");
  expect((await listProfile(env, 20)).items).toEqual([]);
  const proposal = data(await call("entry.propose", { type: "profile", key: "role", value: "待确认角色" }));
  expect(data(await call("profile.get")).profile).toEqual([]);
  expect(await reviewProfileProposal(env, String(proposal.id), "edit_approve", "本人确认的角色")).toBe(true);
  expect(data(await call("profile.get")).profile).toEqual([expect.objectContaining({ key: "role", value: "本人确认的角色", updated_by: "board" })]);
  await upsertProfile(env, "role", "本人随后编辑");
  expect(await reviewProfileProposal(env, String(proposal.id), "approve")).toBe(false);
  expect((await listProfile(env, 20)).items[0].value).toBe("本人随后编辑");
  const rejected = data(await call("entry.propose", { type: "profile", key: "role", value: "应该拒绝" }));
  expect(await reviewProfileProposal(env, String(rejected.id), "reject")).toBe(true);
  expect((await listProfile(env, 20)).items[0].value).toBe("本人随后编辑");
});

it("isolates timeline proposals and preserves edits through repeated approval", async () => {
  const proposal = data(await call("entry.propose", { type: "timeline", kind: "startup", title: "合成创业经历",
    started_on: "2020", ended_on: "2022-12", body: "写作产品" }));
  expect(data(await call("timeline.search")).items).toEqual([]);
  expect(await reviewTimeline(env, String(proposal.id), "edit_approve", { kind: "startup", title: "确认后的经历",
    org: "合成组织", startedOn: "2020", endedOn: "2022-12", body: "写作与设计" })).toBe(true);
  expect(data(await call("timeline.search", { query: "写作", from: "2021", to: "2023" })).items)
    .toEqual([expect.objectContaining({ title: "确认后的经历", source_client: "synthetic-client" })]);
  expect(await reviewTimeline(env, String(proposal.id), "reject")).toBe(false);
});

it("bounds UTF-8 pages without losing items and keeps summary <=1.5KiB without pending text", async () => {
  const ids = [];
  for (let n = 0; n < 7; n++) {
    const saved = data(await call("memory.save", { kind: "preference", text: "合成偏好".repeat(490) + n }));
    ids.push(String(saved.id));
    await reviewMemory(env, String(saved.id), "approve");
    await upsertProfile(env, `field_${n}`, "背景".repeat(990));
  }
  await upsertProfile(env, "name", "测试用户".repeat(200));
  await upsertProfile(env, "role", "合成角色".repeat(200));
  await call("memory.save", { kind: "preference", text: "pending should never leak" });
  let offset = 0;
  const seen: string[] = [];
  do {
    const reply = await call("memory.search", { offset, limit: 50 });
    expect(jsonBytes(reply)).toBeLessThanOrEqual(MAX_PAGE_BYTES);
    const page = data(reply);
    seen.push(...(page.items as { id: string }[]).map(item => item.id));
    offset = page.next_offset as number;
  } while (offset !== null);
  expect(new Set(seen)).toEqual(new Set(ids));
  let fields = 0; offset = 0;
  do {
    const reply = await call("profile.get", { offset, limit: 100 });
    expect(jsonBytes(reply)).toBeLessThanOrEqual(MAX_PAGE_BYTES);
    const page = data(reply); fields += (page.profile as unknown[]).length; offset = page.next_offset as number;
  } while (offset !== null);
  expect(fields).toBe(9);
  const summary = await rpc().summary("kdp-owner");
  expect(jsonBytes(summary)).toBeLessThanOrEqual(MAX_SUMMARY_BYTES);
  expect(summary).not.toHaveProperty("privateMetric");
  expect(JSON.stringify(summary)).not.toContain("pending should never leak");
  await expect(rpc().summary("other")).rejects.toThrow("not_owner");
});
