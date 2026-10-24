import type { Env } from "./types";
import type { Material } from "./workspace-types";
import { json, ValidationError } from "./lib";

const MAX_FILE = 8 * 1024 * 1024;
const unavailable = () => json({ error: "资料存储尚未配置，账户和规则仍可使用" }, 503);
type StoredMaterial = Material & { object_key: string };
const materialColumns = "id,object_key,name,content_type,size,sha256,created_at";

async function reuseMaterial(env: Env, stored: StoredMaterial, bytes: Uint8Array) {
  if (!await env.MATERIALS!.head(stored.object_key)) {
    await env.MATERIALS!.put(stored.object_key, bytes, { httpMetadata: { contentType: stored.content_type } });
  }
  const { object_key: _, ...material } = stored;
  return json({ material, duplicate: true });
}

export async function listMaterials(env: Env, offset = 0) {
  const rows = await env.DB.prepare("SELECT id,name,content_type,size,sha256,created_at FROM gu_materials ORDER BY created_at DESC,id LIMIT 501 OFFSET ?")
    .bind(offset).all<Material>();
  const materials = rows.results.slice(0, 500);
  return json({ enabled: !!env.MATERIALS, materials, limit: 500, next_offset: rows.results.length > 500 ? offset + 500 : null });
}

async function boundedBody(request: Request) {
  if (Number(request.headers.get("Content-Length")) > MAX_FILE + 65536) throw new ValidationError("文件不能超过 8 MB");
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError("请选择文件");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_FILE + 65536) { await reader.cancel(); throw new ValidationError("文件不能超过 8 MB"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

export async function uploadMaterial(request: Request, env: Env) {
  if (!env.MATERIALS) return unavailable();
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.startsWith("multipart/form-data;")) throw new ValidationError("需要文件上传表单");
  let form: FormData;
  try {
    const bytes = await boundedBody(request);
    form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("文件表单无效");
  }
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1 || file.size < 1 || file.size > MAX_FILE)
    throw new ValidationError("请选择一个不超过 8 MB 的非空文件");
  const name = file.name.replace(/[/\\\x00-\x1f\x7f]/g, "_").slice(0, 180);
  const extension = name.split(".").at(-1)?.toLowerCase() || "";
  const types: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", txt: "text/plain", md: "text/plain", csv: "text/csv", json: "application/json" };
  const type = types[extension];
  if (!type) throw new ValidationError("支持 PDF、PNG、JPG、TXT、Markdown、CSV 和 JSON");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const prefix = new TextDecoder().decode(bytes.slice(0, 5));
  if ((extension === "pdf" && prefix !== "%PDF-") ||
      (extension === "png" && ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) ||
      (["jpg", "jpeg"].includes(extension) && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)))
    throw new ValidationError("文件内容与扩展名不一致");
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  const existing = await env.DB.prepare(`SELECT ${materialColumns} FROM gu_materials WHERE sha256=?`)
    .bind(sha).first<StoredMaterial>();
  if (existing) return reuseMaterial(env, existing, bytes);
  const id = crypto.randomUUID(), key = `materials/${id}`, now = new Date().toISOString();
  await env.MATERIALS.put(key, bytes, { httpMetadata: { contentType: type } });
  let inserted: boolean;
  try {
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO gu_materials(id,object_key,name,content_type,size,sha256,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(id, key, name, type, file.size, sha, now).run();
    inserted = result.meta.changes > 0;
  } catch {
    // D1 may have committed before its acknowledgement failed. Keep the original for retry/reconciliation.
    return json({ error: "资料保存失败，账户数据未修改，请重试" }, 503);
  }
  if (!inserted) {
    const duplicate = await env.DB.prepare(`SELECT ${materialColumns} FROM gu_materials WHERE sha256=?`)
      .bind(sha).first<StoredMaterial>();
    if (!duplicate) return json({ error: "资料保存状态待核对，请重试" }, 503);
    const response = await reuseMaterial(env, duplicate, bytes);
    if (duplicate.object_key !== key) await env.MATERIALS.delete(key).catch(() => undefined);
    return response;
  }
  return json({ material: { id, name, content_type: type, size: file.size, sha256: sha, created_at: now } }, 201);
}

export async function downloadMaterial(env: Env, id: string) {
  if (!env.MATERIALS) return unavailable();
  const row = await env.DB.prepare("SELECT * FROM gu_materials WHERE id=?").bind(id)
    .first<Material & { object_key: string }>();
  if (!row) return json({ error: "资料不存在" }, 404);
  const file = await env.MATERIALS.get(row.object_key);
  if (!file) return json({ error: "原件暂时无法读取，请稍后重试" }, 503);
  return new Response(file.body, { headers: {
    "Content-Type": row.content_type, "Content-Length": String(row.size), "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="document.${row.name.split(".").at(-1)}"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
  } });
}
