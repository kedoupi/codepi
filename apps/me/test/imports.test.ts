import { env, createExecutionContext } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { call, count, data } from "./helpers";
import { finishImport, pasteImport } from "../worker/imports";
import { MeImportsBackup } from "../worker/index";
import { reviewImportMemories } from "../worker/data";
import { canonicalJson, encoder, MAX_IMPORT_BYTES, sha256Hex } from "../worker/lib";

const actor = { client: "synthetic-client", name: "Synthetic AI" };
async function start(request_id = "test-start") { return String(data(await call("memory.import.start", { request_id })).import_id); }
const chunk = (id: string, index = 0, items = [{ text: "合成导入记忆" }]) =>
  call("memory.import.chunk", { import_id: id, index, items });
const finish = (id: string) => call("memory.import.finish", { import_id: id });
async function totals(id: string) {
  return await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM import_chunks WHERE import_id=?) AS chunk_count,
    COALESCE((SELECT SUM(item_count) FROM import_chunks WHERE import_id=?),0) AS item_count,
    25 + COALESCE((SELECT SUM(bytes) FROM import_chunks WHERE import_id=?),0)
      + CASE WHEN (SELECT COUNT(*) FROM import_chunks WHERE import_id=?)>0
        THEN (SELECT COUNT(*) FROM import_chunks WHERE import_id=?)-1 ELSE 0 END AS bytes`)
    .bind(id, id, id, id, id).first<{ chunk_count: number; item_count: number; bytes: number }>();
}

it("retries start/chunk/finish, stores canonical immutable originals and never partially exposes memories", async () => {
  const id = await start();
  expect(await start()).toBe(id);
  const raw = [{ text: "  中文写作偏好  ", tags: ["合成"], kind: "preference" }, { text: "第二条" }];
  const digest = await sha256Hex(canonicalJson(raw));
  const replies = await Promise.all([1, 2, 3].map(() => call("memory.import.chunk", { import_id: id, index: 0, items: raw, digest })));
  expect(replies.every(reply => reply.ok)).toBe(true);
  expect(await count("import_chunks")).toBe(1);
  expect(await count("memories")).toBe(0);
  await expect(reviewImportMemories(env, id, "approve")).rejects.toThrow("import_not_finished");
  expect(data(await call("memory.search")).items).toEqual([]);
  expect(await chunk(id, 0, [{ text: "changed retry" }])).toMatchObject({ error: "chunk_conflict" });
  expect(await call("memory.import.chunk", { import_id: id, index: 1, items: [{ text: "safe" }], digest: "0".repeat(64) }))
    .toMatchObject({ error: "digest_mismatch" });
  expect(await chunk(id, 2)).toMatchObject({ error: "chunk_out_of_order" });
  const finishes = await Promise.all([finish(id), finish(id), finish(id)]);
  expect(finishes.every(reply => reply.ok)).toBe(true);
  expect(await count("imports")).toBe(1); expect(await count("memories")).toBe(2);
  expect(await count("memories", "status='pending'")).toBe(2);
  expect(await count("memories", "status='active'")).toBe(0);
  const backup = new MeImportsBackup(createExecutionContext(), env), list = await backup.listMaterials();
  expect(list.items[0]).toMatchObject({ id, object_key: `imports/${id}` });
  const original = await new Response(await backup.readMaterial(id)).text();
  expect(original).toBe(canonicalJson({ chunks: [{ index: 0, items: raw }], version: 1 }));
  expect(list.items[0].size).toBe(encoder.encode(original).length);
  expect(list.items[0].sha256).toBe(await sha256Hex(original));
  expect(await call("memory.import.start", {})).toMatchObject({ error: "already_imported" });
  expect(await reviewImportMemories(env, id, "approve")).toBe(2);
  expect(await reviewImportMemories(env, id, "reject")).toBe(0);
  expect(data(await call("memory.search", { query: "写作" })).items).toHaveLength(1);
});

it("enforces actor isolation and successful-finish-only lock when R2 fails", async () => {
  const id = await start();
  expect(await finish(id)).toMatchObject({ error: "empty_import" });
  expect(await call("memory.import.finish", { import_id: id }, "other")).toMatchObject({ error: "import_not_found" });
  await chunk(id);
  const broken = { ...env, IMPORTS: { ...env.IMPORTS, put: async () => { throw new Error("synthetic R2 outage"); } } as unknown as R2Bucket };
  await expect(finishImport(broken, actor, { import_id: id })).rejects.toThrow();
  expect(await count("imports")).toBe(0); expect(await count("memories")).toBe(0);
  expect(await call("memory.import.start", { request_id: "new-request" }))
    .toMatchObject({ error: "import_in_progress", status: 409 });
  expect(await finish(id)).toMatchObject({ ok: true });
  expect(await count("memories")).toBe(1);
});

it("isolates concurrent request ids instead of handing both the same active batch", async () => {
  const results = await Promise.all([
    call("memory.import.start", { request_id: "concurrent-long" }),
    call("memory.import.start", { request_id: "concurrent-short" }),
  ]);
  expect(results.filter(reply => reply.ok)).toHaveLength(1);
  const loser = results.find(reply => !reply.ok);
  expect(loser).toMatchObject({ error: "import_in_progress", status: 409 });
  expect(loser).not.toHaveProperty("data.import_id");
  const sessions = await env.DB.prepare("SELECT id,request_id,status FROM import_sessions").all<{
    id: string; request_id: string; status: string;
  }>();
  expect(sessions.results).toHaveLength(1);
  expect(sessions.results[0].status).toBe("open");
  expect(["concurrent-long", "concurrent-short"]).toContain(sessions.results[0].request_id);
});

it("never lets a concurrent 12-item request finish another request's 24-item batch", async () => {
  const first = Array.from({ length: 12 }, (_, n) => ({ text: `共享首块 ${n}` }));
  const extra = Array.from({ length: 12 }, (_, n) => ({ text: `较长批次 ${n}` }));
  const id = await start("long-24");
  const [short, firstChunk] = await Promise.all([
    call("memory.import.start", { request_id: "short-12" }),
    chunk(id, 0, first),
  ]);
  expect(short).toMatchObject({ error: "import_in_progress", status: 409 });
  expect(short).not.toHaveProperty("data.import_id");
  expect(firstChunk).toMatchObject({ ok: true });
  expect(await chunk(id, 1, extra)).toMatchObject({ ok: true });
  const finished = await finish(id);
  expect(finished.ok).toBe(true);
  expect(data(finished)).toMatchObject({ item_count: 24, status: "finished" });
  const row = await env.DB.prepare("SELECT item_count,bytes FROM imports WHERE id=?").bind(id)
    .first<{ item_count: number; bytes: number }>();
  expect(row!.item_count).toBe(24);
  const original = await env.IMPORTS.get(`imports/${id}`);
  expect(original).not.toBeNull();
  expect(encoder.encode(await original!.text()).length).toBe(row!.bytes);
  expect(await count("import_sessions")).toBe(1);
  expect(await count("imports")).toBe(1);
  expect(await count("memories", "status='pending'")).toBe(24);
  expect(await count("memories", "status='active'")).toBe(0);
});

it("rolls back an entire final import when a D1 write fails and retries without duplication", async () => {
  const id = await start();
  await chunk(id, 0, [{ text: "first" }, { text: "fail second" }]);
  await env.DB.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON memories WHEN NEW.text='fail second' BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
  try {
    expect(await finish(id)).toMatchObject({ ok: false });
    expect(await count("imports")).toBe(0); expect(await count("memories")).toBe(0);
  } finally { await env.DB.exec("DROP TRIGGER synthetic_failure;"); }
  expect(await finish(id)).toMatchObject({ ok: true });
  expect(await finish(id)).toMatchObject({ ok: true });
  expect(await count("memories")).toBe(2);
});

it("enforces the 500-item bound atomically under competing chunks", async () => {
  const id = await start();
  expect(await chunk(id, 0, Array.from({ length: 499 }, (_, n) => ({ text: `合成 ${n}` })))).toMatchObject({ ok: true });
  const result = await Promise.all([chunk(id, 1, [{ text: "last A" }]), chunk(id, 1, [{ text: "last B" }]), chunk(id, 2, [{ text: "overflow" }])]);
  expect(result.filter(reply => reply.ok)).toHaveLength(1);
  expect((await totals(id))!.item_count).toBe(500);
  expect(await chunk(id, 2)).toMatchObject({ error: "import_limit_exceeded" });
  expect(await finish(id)).toMatchObject({ ok: true });
  expect(await count("memories")).toBe(500);
}, 30_000);

it("measures UTF-8 request and whole-original bytes, rejecting overflow before storage", async () => {
  const id = await start(), large = "中".repeat(2000);
  expect(await chunk(id, 0, Array.from({ length: 5 }, () => ({ text: large })))).toMatchObject({ error: "import_chunk_too_large" });
  expect(await count("import_chunks")).toBe(0);
  let index = 0, stopped = false;
  for (; index < 40; index++) {
    const reply = await chunk(id, index, Array.from({ length: 3 }, () => ({ text: large })));
    if (!reply.ok) { expect(reply.error).toBe("import_limit_exceeded"); stopped = true; break; }
  }
  expect(stopped).toBe(true);
  const bytes = (await totals(id))!.bytes;
  expect(bytes).toBeLessThanOrEqual(MAX_IMPORT_BYTES);
  expect(bytes).toBeGreaterThan(MAX_IMPORT_BYTES - 20_000);
  expect(await finish(id)).toMatchObject({ ok: true });
  const row = await env.DB.prepare("SELECT bytes FROM imports WHERE id=?").bind(id).first<{ bytes: number }>();
  expect(row!.bytes).toBe(bytes);
}, 30_000);

it("rejects secret-containing chunks atomically with no original and supports a corrected retry", async () => {
  const log = vi.spyOn(console, "error");
  const id = await start();
  expect(await chunk(id, 0, [{ text: "safe" }, { text: `sk-${"SYNTHETIC".repeat(5)}` }])).toMatchObject({ error: "secret_detected" });
  expect(await count("import_chunks")).toBe(0);
  expect((await env.IMPORTS.list()).objects).toHaveLength(0);
  expect(await chunk(id, 0)).toMatchObject({ ok: true });
  expect(log).not.toHaveBeenCalled();
});

it("counts the separator byte atomically at the exact 512 KiB boundary", async () => {
  const id = await start(), large = "中".repeat(2000);
  let index = 0;
  while ((await totals(id))!.bytes < MAX_IMPORT_BYTES - 24 * 1024) {
    expect(await chunk(id, index++, Array.from({ length: 3 }, () => ({ text: large })))).toMatchObject({ ok: true });
  }
  const before = (await totals(id))!;
  const target = MAX_IMPORT_BYTES - before.bytes;
  const items = Array.from({ length: 12 }, () => ({ text: "x" }));
  let missing = target - encoder.encode(canonicalJson({ index, items })).length;
  for (const item of items) {
    const extra = Math.min(missing, 1999);
    item.text += "x".repeat(extra);
    missing -= extra;
  }
  expect(missing).toBe(0);
  expect(await chunk(id, index, items)).toMatchObject({ error: "import_limit_exceeded" });
  expect(await totals(id)).toEqual(before);
  const editable = items.find(item => item.text.length > 1)!;
  editable.text = editable.text.slice(1);
  expect(await chunk(id, index, items)).toMatchObject({ ok: true });
  expect((await totals(id))!.bytes).toBe(MAX_IMPORT_BYTES);
  expect(await finish(id)).toMatchObject({ ok: true });
  expect((await env.DB.prepare("SELECT bytes FROM imports WHERE id=?").bind(id).first<{ bytes: number }>())!.bytes)
    .toBe(MAX_IMPORT_BYTES);
}, 30_000);

it("supports paste retries and multiple owner imports while keeping them pending", async () => {
  const first = await pasteImport(env, { text: "合成 A\n合成 B", split: "line", request_id: "board-one" });
  expect((await pasteImport(env, { text: "合成 A\n合成 B", split: "line", request_id: "board-one" })).import_id).toBe(first.import_id);
  const next = await pasteImport(env, { text: "段落一\n补充\n\n段落二", split: "paragraph", request_id: "board-two" });
  expect(next.import_id).not.toBe(first.import_id);
  expect(await count("imports")).toBe(2);
  expect(await count("memories", "status='active'")).toBe(0);
  expect(await reviewImportMemories(env, first.import_id, "approve")).toBe(2);
  expect(await count("memories", `import_id='${next.import_id}' AND status='pending'`)).toBe(2);
});

it("detects same-length R2 corruption and freezes the backup index high water mark", async () => {
  const first = await pasteImport(env, { text: "first", split: "line", request_id: "board-one" });
  const rpc = new MeImportsBackup(createExecutionContext(), env), page = await rpc.listMaterials();
  await pasteImport(env, { text: "second", split: "line", request_id: "board-two" });
  expect((await rpc.listMaterials(0, page.through)).items).toHaveLength(1);
  const row = page.items[0];
  await env.IMPORTS.put(row.object_key, "x".repeat(row.size));
  await expect(rpc.readMaterial(first.import_id)).rejects.toThrow("hash mismatch");
  await expect(rpc.readMaterial("../other")).rejects.toThrow("Invalid");
  await expect(rpc.listMaterials(-1)).rejects.toThrow("cursor");
  await expect(rpc.listMaterials(2, 1)).rejects.toThrow("snapshot");
});
