import { WorkerEntrypoint } from "cloudflare:workers";
import { ME_OPERATIONS, jsonBytes, type DomainRequest, type DomainReply, type MeOperation,
  type MeService, type SourceSummary } from "@kedoupi/shared/mcp/contract";
import { AppError, ValidationError, OWNER_SUBJECT, integer, optionalQuery, optionalText, normalizeTags,
  validateMemoryKind, validateTimelineKind, validateDatePart, validateProfileKey, validateSourceClient,
  requiredText, isoNow, MAX_PAGE_BYTES, MAX_SUMMARY_BYTES, MAX_RPC_BYTES, object } from "./lib";
import { createPendingMemory, createProfileProposal, createTimeline, listMemories, listProfile,
  listTimeline, overview } from "./data";
import { appendChunk, finishImport, startImport } from "./imports";
import { endOf, inputObject, memoryInput, noSecrets, timelineInput, timelineKeys } from "./validation";
import type { Env } from "./types";

export function safeError(error: unknown): { error: string; status: number } {
  if (error instanceof AppError || error instanceof ValidationError) return { error: error.code, status: error.status };
  if (error instanceof SyntaxError) return { error: "invalid_json", status: 400 };
  return { error: "storage_unavailable", status: 503 };
}

function page(args: Record<string, unknown>, max = 100) {
  return { offset: integer(args.offset, "offset", 0, Number.MAX_SAFE_INTEGER, 0),
    limit: integer(args.limit, "limit", 1, max, 20) };
}

function strictOptional(args: Record<string, unknown>) {
  // JSON schema optional properties may be absent, but never null or coerced.
  for (const value of Object.values(args)) {
    if (value === null || value === undefined) throw new ValidationError("参数类型无效");
  }
  if ("kind" in args && !args.kind) throw new ValidationError("类型无效");
}

export async function executeMe(env: Env, input: DomainRequest<MeOperation>): Promise<DomainReply> {
  if (input?.subject !== OWNER_SUBJECT) return { ok: false, error: "not_owner", status: 403 };
  try {
    inputObject(input, ["subject", "client", "clientName", "operation", "args"]);
    if (!ME_OPERATIONS.includes(input.operation) || !object(input.args)) throw new ValidationError("操作无效");
    if (jsonBytes(input.args) > MAX_RPC_BYTES) throw new AppError(input.operation === "memory.import.chunk"
      ? "import_chunk_too_large" : "request_too_large", 413);
    strictOptional(input.args);
    const args = input.args, as_of = isoNow();
    let data: Record<string, unknown>;
    switch (input.operation) {
      case "memory.search": {
        inputObject(args, ["query", "kind", "tags", "offset", "limit"]);
        const { offset, limit } = page(args, 50);
        data = await listMemories(env, { status: "active", query: optionalQuery(args.query) ?? undefined,
          kind: validateMemoryKind(args.kind) ?? undefined, tags: normalizeTags(args.tags) }, limit, offset);
        break;
      }
      case "profile.get": {
        inputObject(args, ["offset", "limit"]);
        const { offset, limit } = page(args);
        const result = await listProfile(env, limit, offset);
        data = { profile: result.items, next_offset: result.next_offset };
        break;
      }
      case "timeline.search": {
        inputObject(args, ["query", "kind", "from", "to", "offset", "limit"]);
        const { offset, limit } = page(args);
        const from = validateDatePart(args.from, "from"), to = validateDatePart(args.to, "to");
        if (from && to && from > endOf(to)) throw new ValidationError("日期范围无效");
        data = await listTimeline(env, { status: "active", query: optionalQuery(args.query) ?? undefined,
          kind: validateTimelineKind(args.kind) ?? undefined, from: from ?? undefined, to: to ? endOf(to) : undefined }, limit, offset);
        break;
      }
      default: {
        const client = validateSourceClient(input.client);
        if (client === "board") throw new AppError("reserved_client", 403);
        const name = optionalText(input.clientName, "客户端名称", 200);
        noSecrets(name);
        const actor = { client, name };
        if (input.operation === "memory.save") {
          const saved = await createPendingMemory(env, { ...memoryInput(args), sourceClient: client, sourceName: name });
          data = { id: saved.id, status: saved.status, review_url: "https://me.codepi.app/" };
        } else if (input.operation === "memory.import.start") data = await startImport(env, actor, args);
        else if (input.operation === "memory.import.chunk") data = await appendChunk(env, actor, args);
        else if (input.operation === "memory.import.finish") data = await finishImport(env, actor, args);
        else {
          if (args.type === "profile") {
            inputObject(args, ["type", "key", "value"]);
            const key = validateProfileKey(args.key), value = requiredText(args.value, "背景内容", 2000);
            noSecrets(key, value);
            data = { id: await createProfileProposal(env, key, value, client, name), type: "profile", status: "pending" };
          } else if (args.type === "timeline") {
            inputObject(args, ["type", ...timelineKeys]);
            const { type: _type, ...fields } = args;
            data = { id: await createTimeline(env, timelineInput(fields), "pending", client, name),
              type: "timeline", status: "pending" };
          } else throw new ValidationError("提议类型无效");
        }
      }
    }
    const reply: DomainReply = { ok: true, data: { source: "me", as_of, ...data } };
    if (jsonBytes(reply) > MAX_PAGE_BYTES) throw new AppError("response_too_large", 503);
    return reply;
  } catch (error) {
    return { ok: false, ...safeError(error) };
  }
}

export async function meSummary(env: Env, subject: string): Promise<SourceSummary> {
  if (subject !== OWNER_SUBJECT) throw new AppError("not_owner", 403);
  const counts = await overview(env);
  const profile = await env.DB.prepare("SELECT key,value,updated_at FROM profile WHERE key IN ('name','role','bio','summary') ORDER BY key")
    .all<{ key: string; value: string; updated_at: string }>();
  const preferences = await env.DB.prepare("SELECT text,updated_at FROM memories WHERE kind='preference' AND status='active' ORDER BY updated_at DESC,id DESC LIMIT 5")
    .all<{ text: string; updated_at: string }>();
  const pending = counts.pending_memories + counts.pending_profile + counts.pending_timeline;
  const clip = (value: string, max: number) => Array.from(value).slice(0, max).join("");
  const dates = [...profile.results, ...preferences.results].map(row => row.updated_at).sort();
  const summary: SourceSummary = {
    source: "me", status: dates.length || counts.active_memories || pending ? "ok" : "empty",
    asOf: isoNow(), updatedAt: dates.at(-1) ?? null, stale: false,
    metrics: [{ label: "待确认", value: String(pending) }],
    facts: [
      ...profile.results.filter(row => row.key === "name" || row.key === "role").map(row => `${row.key}: ${clip(row.value, 24)}`),
      ...profile.results.filter(row => row.key === "bio" || row.key === "summary").slice(0, 1).map(row => `简介: ${clip(row.value, 40)}`),
      ...preferences.results.map(row => `偏好: ${clip(row.text, 30)}`),
    ],
    notes: ["仅已确认内容可供 AI 读取。"],
    attention: pending ? [{ label: "查看待确认内容", href: "https://me.codepi.app/" }] : [],
  };
  while (jsonBytes(summary) > MAX_SUMMARY_BYTES && summary.facts.length) summary.facts.pop();
  return summary;
}

export class MeMcp extends WorkerEntrypoint<Env> implements MeService {
  execute(input: DomainRequest<MeOperation>) { return executeMe(this.env, input); }
  summary(subject: string) { return meSummary(this.env, subject); }
}
