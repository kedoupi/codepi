import { WorkerEntrypoint } from "cloudflare:workers";
import type { BlogOperation, BlogService, DomainReply, DomainRequest } from "@kedoupi/shared/mcp/contract";
import { BLOG_OPERATIONS } from "@kedoupi/shared/mcp/contract";
import { blogSummary, listPublished, retractDraft, submitDraft, type BlogEnv } from "../server/blog";

const OWNER = "kdp-owner";
export interface Env extends BlogEnv {}

export class BlogMcp extends WorkerEntrypoint<Env> implements BlogService {
  async execute(request: DomainRequest<BlogOperation>): Promise<DomainReply> {
    if (request?.subject !== OWNER) return { ok: false, error: "not_owner", status: 403 };
    if (!BLOG_OPERATIONS.includes(request.operation)) return { ok: false, error: "invalid_arguments", status: 400 };
    try {
      if (request.operation === "list") {
        const args = request.args ?? {};
        const offset = args.offset === undefined ? 0 : args.offset;
        const limit = args.limit === undefined ? 20 : args.limit;
        if (!Number.isInteger(offset) || !Number.isInteger(limit) || (offset as number) < 0 || (limit as number) < 1 || (limit as number) > 100) return { ok: false, error: "invalid_arguments", status: 400 };
        return { ok: true, data: await listPublished(this.env.BLOG, offset as number, limit as number) };
      }
      if (request.operation === "submit") {
        const result = await submitDraft(this.env.BLOG, { ...request.args, client_id: request.client, client_name: request.clientName });
        return { ok: true, data: result };
      }
      if (typeof request.args?.slug !== "string") return { ok: false, error: "invalid_arguments", status: 400 };
      return { ok: true, data: await retractDraft(this.env.BLOG, request.args.slug) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "not_found") return { ok: false, error: "not_found", status: 404 };
      if (message === "revision_conflict") return { ok: false, error: "revision_conflict", status: 409 };
      if (message === "payload_too_large") return { ok: false, error: "payload_too_large", status: 413 };
      if (message === "unsafe_content") return { ok: false, error: "invalid_arguments", status: 400 };
      return { ok: false, error: "invalid_arguments", status: 400 };
    }
  }
  async summary(subject: string) {
    if (subject === OWNER) return blogSummary(this.env.BLOG);
    return { source: "blog", status: "unavailable" as const, stale: true, asOf: null, updatedAt: null, metrics: [], facts: [], notes: ["未授权"], attention: [] };
  }
}
