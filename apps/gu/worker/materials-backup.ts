import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./types";

const PAGE_SIZE = 100;
type BackupRow = { cursor: number; id: string; object_key: string; size: number; sha256: string };

// This named entrypoint is reachable only through an explicit service binding.
// The default HTTP handler never dispatches requests to these methods.
export class GuMaterialsBackup extends WorkerEntrypoint<Env> {
  async listMaterials(after = 0, through?: number) {
    if (!this.env.MATERIALS) throw new Error("GU materials storage is not configured");
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid material cursor");
    through ??= await this.env.DB.prepare("SELECT coalesce(max(rowid),0) AS n FROM gu_materials").first<number>("n") ?? 0;
    if (!Number.isSafeInteger(through) || through < after) throw new Error("Invalid material snapshot");
    const rows = await this.env.DB.prepare(
      "SELECT rowid AS cursor,id,object_key,size,sha256 FROM gu_materials WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?",
    ).bind(after, through, PAGE_SIZE).all<BackupRow>();
    return { through, items: rows.results, next: rows.results.length === PAGE_SIZE ? rows.results.at(-1)!.cursor : null };
  }

  async readMaterial(id: string) {
    if (!this.env.MATERIALS) throw new Error("GU materials storage is not configured");
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid material ID");
    const row = await this.env.DB.prepare("SELECT object_key,size FROM gu_materials WHERE id=?")
      .bind(id).first<{ object_key: string; size: number }>();
    if (!row || row.object_key !== `materials/${id}`) throw new Error("GU material index is invalid");
    const object = await this.env.MATERIALS.get(row.object_key);
    if (!object || object.size !== row.size) throw new Error("GU material original is missing or truncated");
    return object.body;
  }
}
