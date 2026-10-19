import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import worker, { GuMaterialsBackup } from "../worker/index";

const origin = "https://gu.test";
const backup = () => new GuMaterialsBackup(createExecutionContext(), env);
const rows = Array.from({ length: 101 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  body: `Synthetic original ${i}`,
}));
async function insert(i: number) {
  const { id, body } = rows[i], bytes = new TextEncoder().encode(body);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    value => value.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO gu_materials(id,object_key,name,content_type,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id, `materials/${id}`, "synthetic-private-name.txt", "text/plain", bytes.length, sha, "2026-10-19T00:00:00Z").run();
  await env.MATERIALS!.put(`materials/${id}`, bytes);
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM gu_materials; DELETE FROM sessions;");
  const stored = await env.MATERIALS!.list();
  if (stored.objects.length) await env.MATERIALS!.delete(stored.objects.map(object => object.key));
});

it("paginates a frozen index without exposing private filenames or adding later uploads", async () => {
  for (let i = 0; i < 100; i++) await insert(i);
  const rpc = backup(), first = await rpc.listMaterials();
  expect(first.items).toHaveLength(100);
  expect(first.through).toBe(100);
  expect(first.next).toBe(100);
  expect(JSON.stringify(first)).not.toContain("synthetic-private-name");
  await insert(100);
  expect((await rpc.listMaterials(first.next!, first.through)).items).toHaveLength(0);
  expect((await rpc.listMaterials(100)).items).toHaveLength(1);
  expect(await new Response(await rpc.readMaterial(rows[0].id)).text()).toBe(rows[0].body);
  await expect(rpc.listMaterials(-1)).rejects.toThrow("cursor");
  await expect(rpc.listMaterials(2, 1)).rejects.toThrow("snapshot");
});

it("rejects missing, truncated and arbitrary-key originals", async () => {
  const rpc = backup();
  await expect(rpc.readMaterial("../private")).rejects.toThrow("Invalid material ID");
  await expect(rpc.readMaterial(rows[0].id)).rejects.toThrow("index");
  await insert(0);
  await env.MATERIALS!.delete(`materials/${rows[0].id}`);
  await expect(rpc.readMaterial(rows[0].id)).rejects.toThrow("missing or truncated");
  await env.MATERIALS!.put(`materials/${rows[0].id}`, "truncated");
  await expect(rpc.readMaterial(rows[0].id)).rejects.toThrow("missing or truncated");
  await env.DB.prepare("UPDATE gu_materials SET object_key=? WHERE id=?").bind("private/other", rows[0].id).run();
  await expect(rpc.readMaterial(rows[0].id)).rejects.toThrow("index");
});

it("does not expose the RPC or R2 keys over public HTTP", async () => {
  for (const path of ["/api/internal/materials-backup", "/api/internal/backup/materials", `/materials/${rows[0].id}`]) {
    expect([401, 404]).toContain((await worker.fetch(new Request(origin + path), env)).status);
  }
});
