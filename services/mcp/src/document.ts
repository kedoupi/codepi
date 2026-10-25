import { HttpError } from "./http.ts";

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

/** Page envelopes repeat clocks (`as_of`, `generated_at`). Snapshot matching uses the data. */
function snapshotOf(result: Record<string, unknown>) {
  const { as_of: _asOf, generated_at: _generatedAt, pagination: _pagination, ...data } = result;
  return data;
}

/** Assemble the existing RPC fragments in one bounded request; never persist the result. */
export async function readDocument(
  invoke: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const name = args.tool as string, original = { ...(args.arguments as Record<string, unknown> ?? {}) };
  if (!["health_get_catalog", "health_query_records", "health_aggregate", "health_get_sync_status", "project_get"].includes(name)) {
    throw new HttpError("tool_not_available", 403);
  }
  if (Object.hasOwn(original, "cursor")) throw new HttpError("invalid_arguments");
  let result = await invoke(name, original);
  const first = result.pagination as Record<string, unknown> | undefined;
  if (first && typeof first.chunk === "string") {
    const maxBytes = 512 * 1024, total = first.total_bytes;
    if (!Number.isSafeInteger(total) || Number(total) < 0 || Number(total) > maxBytes) throw new HttpError("document_too_large", 413);
    const chunks: string[] = [], seen = new Set<string>();
    let bytes = 0;
    for (let page = 0; page < 128; page++) {
      const part = result.pagination as Record<string, unknown>;
      if (typeof part?.chunk !== "string" || part.total_bytes !== total || part.format !== first.format) throw new HttpError("invalid_page", 502);
      bytes += new TextEncoder().encode(part.chunk).byteLength;
      if (bytes > maxBytes) throw new HttpError("document_too_large", 413);
      chunks.push(part.chunk);
      if (part.complete === true) {
        if (bytes !== total) throw new HttpError("invalid_page", 502);
        try { result = JSON.parse(chunks.join("")); } catch { throw new HttpError("invalid_page", 502); }
        break;
      }
      if (typeof part.next_cursor !== "string" || seen.has(part.next_cursor)) throw new HttpError("invalid_page", 502);
      seen.add(part.next_cursor);
      result = await invoke(name, { ...original, cursor: part.next_cursor });
      if (page === 127) throw new HttpError("document_too_large", 413);
    }
  }
  const snapshot = await digest(snapshotOf(result));
  if (args.expected_digest !== undefined && args.expected_digest !== snapshot) throw new HttpError("cursor_stale", 409);
  const coverage = Object.hasOwn(result, "coverage") ? result.coverage : undefined;
  const pointer = args.path as string ?? "";
  let value: unknown = result;
  if (pointer) {
    if (!pointer.startsWith("/")) throw new HttpError("invalid_path");
    for (const encoded of pointer.slice(1).split("/")) {
      const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new HttpError("path_not_found", 404);
      value = (value as Record<string, unknown>)[key];
    }
  }
  const offset = args.offset as number ?? 0, limit = args.limit as number ?? 20;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    for (const item of value.slice(offset, offset + limit)) {
      if (new TextEncoder().encode(JSON.stringify(items.concat([item]))).byteLength > 10 * 1024) break;
      items.push(item);
    }
    const page = { digest: snapshot, path: pointer, kind: "array", total: value.length, ...(coverage === undefined ? {} : { coverage }) };
    if (!items.length && offset < value.length) return { ...page, oversized_item: offset,
      message: "Select an item's field using path, for example /records/0/comment." };
    return { ...page, items, next_offset: offset + items.length < value.length ? offset + items.length : null };
  }
  if (typeof value === "string") {
    const points = Array.from(value), text = points.slice(offset, offset + Math.min(limit, 2000)).join("");
    return { digest: snapshot, path: pointer, kind: "text", text, total: points.length,
      next_offset: offset + Array.from(text).length < points.length ? offset + Array.from(text).length : null };
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength <= 10 * 1024) return { digest: snapshot, path: pointer, kind: "value", value };
  return { digest: snapshot, path: pointer, kind: "object", fields: Object.keys(value as object).map(key => ({
    path: `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
    kind: Array.isArray((value as Record<string, unknown>)[key]) ? "array" : typeof (value as Record<string, unknown>)[key],
  })), message: "Select a field by path; array and text fields accept offset/limit. No JSON fragment assembly is needed." };
}
