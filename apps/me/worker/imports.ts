import type { Env } from "./types";
import { AppError, canonicalJson, encoder, integer, isoNow, MAX_IMPORT_BYTES, MAX_IMPORT_ITEMS,
  MAX_RPC_BYTES, sha256Hex, ulid, validateDigest, validateImportId, validateRequestId } from "./lib";
import { inputObject, memoryInput } from "./validation";
import type { MemoryKind } from "./models";

export type Actor = { client: string; name: string | null };
type Session = {
  id: string; source_client: string; source_name: string | null; status: "open" | "finishing" | "finished" | "failed";
  next_index: number; chunk_count: number; item_count: number; bytes: number; created_at: string;
};
type Chunk = { chunk_index: number; digest: string; payload: string; bytes: number; item_count: number };
type Finished = { id: string };

/**
 * Totals are derived from immutable chunks. The canonical envelope is
 * {"chunks":[...],"version":1}, so its overhead is 25 bytes plus one comma
 * between adjacent chunks.
 */
export const IMPORT_SESSION_TOTALS = `
  COALESCE((SELECT MAX(c.chunk_index)+1 FROM import_chunks c WHERE c.import_id=s.id),0) AS next_index,
  (SELECT COUNT(*) FROM import_chunks c WHERE c.import_id=s.id) AS chunk_count,
  COALESCE((SELECT SUM(c.item_count) FROM import_chunks c WHERE c.import_id=s.id),0) AS item_count,
  25 + COALESCE((SELECT SUM(c.bytes) FROM import_chunks c WHERE c.import_id=s.id),0)
    + CASE WHEN (SELECT COUNT(*) FROM import_chunks c WHERE c.import_id=s.id)>0
      THEN (SELECT COUNT(*) FROM import_chunks c WHERE c.import_id=s.id)-1 ELSE 0 END AS bytes`;

async function session(env: Env, id: string, actor: Actor): Promise<Session> {
  const row = await env.DB.prepare(`SELECT s.id,s.source_client,s.source_name,s.status,s.created_at,${IMPORT_SESSION_TOTALS}
    FROM import_sessions s WHERE s.id=? AND s.source_client=?`)
    .bind(id, actor.client).first<Session>();
  if (!row) throw new AppError("import_not_found", 404);
  return row;
}

function status(row: Session) {
  return { import_id: row.id, status: row.status, next_index: row.next_index, item_count: row.item_count, bytes: row.bytes };
}
async function failFinishingImport(env: Env, id: string, error: AppError): Promise<never> {
  await env.DB.prepare("UPDATE import_sessions SET status='failed',updated_at=? WHERE id=? AND status='finishing'")
    .bind(isoNow(), id).run();
  throw error;
}

async function sessionForRequest(env: Env, actor: Actor, requestId: string | null) {
  if (!requestId) return null;
  return env.DB.prepare(`SELECT s.id,s.source_client,s.source_name,s.status,s.created_at,${IMPORT_SESSION_TOTALS}
    FROM import_sessions s WHERE s.source_client=? AND s.request_id=? LIMIT 1`)
    .bind(actor.client, requestId).first<Session>();
}

async function activeSession(env: Env, actor: Actor) {
  return env.DB.prepare(`SELECT s.id,s.source_client,s.source_name,s.status,s.created_at,${IMPORT_SESSION_TOTALS}
    FROM import_sessions s WHERE s.source_client=? AND s.status IN ('open','finishing')
    ORDER BY s.created_at DESC LIMIT 1`)
    .bind(actor.client).first<Session>();
}

export async function startImport(env: Env, actor: Actor, input: unknown) {
  const args = inputObject(input, ["request_id"]);
  const requestId = validateRequestId(args.request_id);
  // A request id is the retry identity for one import attempt. Never hand a
  // different attempt the client's active batch.
  const previous = await sessionForRequest(env, actor, requestId);
  if (previous) return status(previous);
  // A finished import is the only durable one-import-per-client lock.
  const done = actor.client !== "board" && await env.DB.prepare("SELECT id FROM imports WHERE source_client=?")
    .bind(actor.client).first<{ id: string }>();
  if (done) throw new AppError("already_imported", 409);
  const id = ulid(), now = isoNow();
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO import_sessions
    (id,source_client,source_name,request_id,status,created_at,updated_at)
    SELECT ?,?,?,?,'open',?,?
    WHERE ?='board' OR NOT EXISTS (SELECT 1 FROM imports WHERE source_client=?)`)
    .bind(id, actor.client, actor.name, requestId, now, now, actor.client, actor.client).run();
  if (Number(inserted.meta.changes ?? 0) !== 1) {
    const raced = await sessionForRequest(env, actor, requestId);
    if (raced) return status(raced);
    const locked = actor.client !== "board" && await env.DB.prepare("SELECT id FROM imports WHERE source_client=?")
      .bind(actor.client).first<{ id: string }>();
    if (locked) throw new AppError("already_imported", 409);
    if (await activeSession(env, actor)) throw new AppError("import_in_progress", 409);
    throw new AppError("storage_unavailable", 503);
  }
  return status(await session(env, id, actor));
}

export async function appendChunk(env: Env, actor: Actor, input: unknown) {
  const args = inputObject(input, ["import_id", "index", "items", "digest"]);
  // Include the tool's action discriminator in the UTF-8 request budget.
  if (encoder.encode(JSON.stringify({ action: "chunk", ...args })).length > MAX_RPC_BYTES) {
    throw new AppError("import_chunk_too_large", 413);
  }
  const id = validateImportId(args.import_id);
  const index = integer(args.index, "index", 0, 499);
  const providedDigest = validateDigest(args.digest);
  if (!Array.isArray(args.items) || !args.items.length || args.items.length > MAX_IMPORT_ITEMS) {
    throw new AppError("invalid_items", 400);
  }
  const itemCount = args.items.length;
  // Validate the entire chunk before storage; rejected secrets never enter D1 or R2.
  args.items.forEach(item => memoryInput(item, true));
  const digest = await sha256Hex(canonicalJson(args.items));
  if (providedDigest && providedDigest !== digest) throw new AppError("digest_mismatch", 409);
  const payload = canonicalJson({ index, items: args.items });
  const bytes = encoder.encode(payload).length;
  const previous = () => env.DB.prepare("SELECT digest FROM import_chunks WHERE import_id=? AND chunk_index=?")
    .bind(id, index).first<{ digest: string }>();
  const retry = async () => {
    const row = await previous();
    if (row && row.digest !== digest) throw new AppError("chunk_conflict", 409);
    return row;
  };
  const diagnose = async (): Promise<never> => {
    const latest = await session(env, id, actor);
    if (latest.status !== "open") throw new AppError("import_not_open", 409);
    if (latest.next_index !== index) throw new AppError("chunk_out_of_order", 409);
    if (latest.item_count + itemCount > MAX_IMPORT_ITEMS
      || latest.bytes + bytes + (latest.chunk_count ? 1 : 0) > MAX_IMPORT_BYTES) {
      throw new AppError("import_limit_exceeded", 413);
    }
    throw new AppError("storage_unavailable", 503);
  };
  await session(env, id, actor);
  if (!await retry()) {
    try {
      // Index and both aggregate bounds are evaluated by this one SQLite write.
      const result = await env.DB.prepare(`INSERT INTO import_chunks
        (import_id,chunk_index,payload,digest,r2_key,bytes,item_count,created_at)
        SELECT ?,?,?,?,?,?,?,?
        FROM import_sessions s
        WHERE s.id=? AND s.source_client=? AND s.status='open'
          AND ?=(SELECT COALESCE(MAX(c.chunk_index)+1,0) FROM import_chunks c WHERE c.import_id=s.id)
          AND ?+(SELECT COALESCE(SUM(c.item_count),0) FROM import_chunks c WHERE c.import_id=s.id)<=500
          AND 25+(SELECT COALESCE(SUM(c.bytes),0) FROM import_chunks c WHERE c.import_id=s.id)
            +CASE WHEN (SELECT COUNT(*) FROM import_chunks c WHERE c.import_id=s.id)>0
              THEN (SELECT COUNT(*) FROM import_chunks c WHERE c.import_id=s.id) ELSE 0 END
            +?<=524288`)
        .bind(id, index, payload, digest, `imports/${id}`, bytes, itemCount, isoNow(),
          id, actor.client, index, itemCount, bytes).run();
      if (Number(result.meta.changes ?? 0) !== 1) await diagnose();
    } catch {
      if (!await retry()) await diagnose();
    }
  }
  return { ...status(await session(env, id, actor)), index, digest };
}

export async function finishImport(env: Env, actor: Actor, input: unknown) {
  const args = inputObject(input, ["import_id"]);
  const id = validateImportId(args.import_id);
  let current = await session(env, id, actor);
  if (current.status === "finished") return status(current);
  if (!current.item_count) throw new AppError("empty_import", 409);
  if (current.status === "failed") throw new AppError("import_failed", 409);
  await env.DB.prepare("UPDATE import_sessions SET status='finishing',updated_at=? WHERE id=? AND status='open'")
    .bind(isoNow(), id).run();
  current = await session(env, id, actor);
  if (current.status === "finished") return status(current);
  const chunks = await env.DB.prepare(`SELECT chunk_index,digest,payload,bytes,item_count
    FROM import_chunks WHERE import_id=? ORDER BY chunk_index`).bind(id).all<Chunk>();
  const raw = `{"chunks":[${chunks.results.map(row => row.payload).join(",")}],"version":1}`;
  const bytes = encoder.encode(raw);
  if (bytes.length !== current.bytes || bytes.length > MAX_IMPORT_BYTES || chunks.results.length !== current.chunk_count) {
    return failFinishingImport(env, id, new AppError("import_integrity_error", 503));
  }
  const sha256 = await sha256Hex(bytes);
  const key = `imports/${id}`;
  // Conditional create makes retries immutable, including concurrent finish calls.
  await env.IMPORTS.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" }, sha256,
    httpMetadata: { contentType: "application/json" },
  });
  const original = await env.IMPORTS.get(key);
  if (!original || original.size !== bytes.length || await sha256Hex(await original.arrayBuffer()) !== sha256) {
    return failFinishingImport(env, id, new AppError("import_original_mismatch", 503));
  }
  const now = isoNow();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT OR IGNORE INTO imports
      (id,source_client,source_name,r2_key,bytes,sha256,item_count,chunk_count,created_at)
      SELECT id,source_client,source_name,?,?,?,?,?,?
      FROM import_sessions WHERE id=? AND status='finishing'`)
      .bind(key, bytes.length, sha256, current.item_count, current.chunk_count, now, id),
  ];
  // Each row uses at most 11 parameters; D1 batch wraps all statements in one transaction.
  let itemIndex = 0;
  for (const chunk of chunks.results) {
    if (await sha256Hex(canonicalJson(JSON.parse(chunk.payload).items)) !== chunk.digest) {
      return failFinishingImport(env, id, new AppError("import_integrity_error", 503));
    }
    const parsed = JSON.parse(chunk.payload) as { items: { text: string; kind?: MemoryKind; tags?: string[] }[] };
    for (const rawItem of parsed.items) {
      const item = memoryInput(rawItem, true);
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO memories
        (id,status,kind,text,tags,source_client,source_name,import_id,import_item_index,created_at,updated_at)
        SELECT ?,'pending',?,?,?,source_client,source_name,id,?,?,?
        FROM import_sessions WHERE id=? AND status='finishing'
          AND EXISTS (SELECT 1 FROM imports WHERE id=?)`)
        .bind(ulid(), item.kind, item.text, JSON.stringify(item.tags), itemIndex++, now, now, id, id));
    }
  }
  if (itemIndex !== current.item_count) {
    return failFinishingImport(env, id, new AppError("import_integrity_error", 503));
  }
  statements.push(env.DB.prepare(`UPDATE import_sessions SET status='finished',finished_at=?,updated_at=?
    WHERE id=? AND status='finishing' AND EXISTS (SELECT 1 FROM imports WHERE id=?)`)
    .bind(now, now, id, id));
  await env.DB.batch(statements);
  const finished = await env.DB.prepare("SELECT id FROM imports WHERE id=?").bind(id).first<Finished>();
  if (!finished) throw new AppError("already_imported", 409);
  return status(await session(env, id, actor));
}

/** Paste uses the same bounded, retryable pipeline as MCP, always pending. */
export async function pasteImport(env: Env, input: unknown) {
  const args = inputObject(input, ["text", "split", "request_id"]);
  if (typeof args.text !== "string" || !args.text.trim()) throw new AppError("empty_import", 400);
  if (args.split !== "line" && args.split !== "paragraph") throw new AppError("invalid_split", 400);
  const items = args.text.split(args.split === "line" ? /\r?\n/ : /\r?\n\s*\r?\n/)
    .map(text => ({ text: text.trim() })).filter(item => item.text);
  if (!items.length || items.length > MAX_IMPORT_ITEMS || encoder.encode(args.text).length > MAX_IMPORT_BYTES) {
    throw new AppError("import_limit_exceeded", 413);
  }
  items.forEach(item => memoryInput(item, true));
  const actor = { client: "board", name: "本人粘贴导入" };
  const started = await startImport(env, actor, { request_id: args.request_id });
  if (started.status === "finished") return started;
  let chunk: typeof items = [], index = 0;
  const flush = async () => {
    await appendChunk(env, actor, { import_id: started.import_id, index: index++, items: chunk });
    chunk = [];
  };
  for (const item of items) {
    if (encoder.encode(JSON.stringify({ action: "chunk", import_id: started.import_id, index, items: [...chunk, item] })).length > MAX_RPC_BYTES) {
      await flush();
    }
    chunk.push(item);
  }
  if (chunk.length) await flush();
  return finishImport(env, actor, { import_id: started.import_id });
}
