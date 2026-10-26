import type { DeskSummary } from "../desk/contract";

/** Internal capabilities. Business data stays in the owning application's Worker. */
export type SourceSummary = Omit<DeskSummary, "source" | "privateMetric"> & { source: string };
export type DomainRequest<Op extends string> = {
  subject: string;
  client?: string;
  clientName?: string;
  operation: Op;
  args: Record<string, unknown>;
};
export type DomainReply =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: number };
export interface DomainService<Op extends string> {
  execute(request: DomainRequest<Op>): Promise<DomainReply>;
  summary(subject: string): Promise<SourceSummary>;
}
export const HEALTH_OPERATIONS = ["catalog", "query_records", "aggregate", "sync_status"] as const;
export type HealthOperation = typeof HEALTH_OPERATIONS[number];
export type HealthRequest = DomainRequest<HealthOperation>;
export type HealthReply = DomainReply;
export type HealthService = DomainService<HealthOperation>;

export const PROJECT_OPERATIONS = ["list", "get", "handoff_save"] as const;
export type ProjectOperation = typeof PROJECT_OPERATIONS[number];
export type ProjectService = DomainService<ProjectOperation>;
export const TASK_STATUSES = ["in_progress", "blocked", "ready_for_review", "done"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const ME_OPERATIONS = [
  "memory.search", "memory.save", "memory.import.start", "memory.import.chunk", "memory.import.finish",
  "profile.get", "timeline.search", "entry.propose",
] as const;
export type MeOperation = typeof ME_OPERATIONS[number];
export type MeService = DomainService<MeOperation>;

export const GU_OPERATIONS = ["portfolio", "cash", "trades", "rules", "reports"] as const;
export type GuOperation = typeof GU_OPERATIONS[number];
export type GuService = DomainService<GuOperation>;

export const BLOG_OPERATIONS = ["list", "get", "submit", "retract", "media_upload", "media_upload_start"] as const;
export type BlogOperation = typeof BLOG_OPERATIONS[number];
export type BlogService = DomainService<BlogOperation>;

export const MCP_LIMITS = { overview: 4 * 1024, detail: 12 * 1024, context: 8 * 1024, importChunk: 24 * 1024, blogBody: 96 * 1024 } as const;
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
