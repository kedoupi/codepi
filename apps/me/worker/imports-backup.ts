import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./types";
import { isUlid, sha256Hex } from "./lib";

type BackupRow = { cursor: number; id: string; object_key: string; size: number; sha256: string };

/** Same Ops capability contract as GuMaterialsBackup; never mounted on HTTP. */
export class MeImportsBackup extends WorkerEntrypoint<Env> {
  async listMaterials(after = 0, through?: number) {
    if (!this.env.IMPORTS) throw new Error("Me imports storage is not configured");
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid material cursor");
    through ??= await this.env.DB.prepare("SELECT coalesce(max(rowid),0) AS n FROM imports").first<number>("n") ?? 0;
    if (!Number.isSafeInteger(through) || through < after) throw new Error("Invalid material snapshot");
    const rows = await this.env.DB.prepare(`SELECT rowid AS cursor,id,r2_key AS object_key,bytes AS size,sha256
      FROM imports WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT 100`)
      .bind(after, through).all<BackupRow>();
    return { through, items: rows.results, next: rows.results.length === 100 ? rows.results.at(-1)!.cursor : null };
  }

  async readMaterial(id: string) {
    if (!this.env.IMPORTS) throw new Error("Me imports storage is not configured");
    if (!isUlid(id)) throw new Error("Invalid material ID");
    const row = await this.env.DB.prepare("SELECT r2_key,bytes,sha256 FROM imports WHERE id=?")
      .bind(id).first<{ r2_key: string; bytes: number; sha256: string }>();
    if (!row || row.r2_key !== `imports/${id}`) throw new Error("Me import index is invalid");
    const object = await this.env.IMPORTS.get(row.r2_key);
    if (!object || object.size !== row.bytes) throw new Error("Me import original is missing or truncated");
    const bytes = await object.arrayBuffer();
    if (await sha256Hex(bytes) !== row.sha256) throw new Error("Me import original hash mismatch");
    return new Response(bytes).body!;
  }
}
