import { WorkerEntrypoint } from "cloudflare:workers";
import {
  MCP_LIMITS,
  type DomainReply,
  type DomainRequest,
  type ProjectOperation,
  type ProjectService,
  type SourceSummary,
} from "@kedoupi/shared/mcp/contract";
import { parseHandoffInput, saveHandoff } from "./handoffs";
import { AppError, assertKeys, DATA_NOTICE, integer, oneOf, projectUrl, text } from "./lib";
import { resolveProject } from "./projects";
import { buildSummary } from "./summary";
import { NEED_KINDS, WORK_STATUSES, type Env, type NeedKind } from "./types";
import { fit, getTask, overview, projectCard, taskPage, type TaskFilter } from "./work";

const BUDGET = MCP_LIMITS.detail;

function failure(error: unknown): DomainReply {
  if (error instanceof AppError) return { ok: false, error: error.code, status: error.status };
  return { ok: false, error: "internal_error", status: 500 };
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined || value === null ? undefined : parse(value);
}

/** Named RPC capability only. No public HTTP route dispatches these operations. */
export class ProjectMcp extends WorkerEntrypoint<Env> implements ProjectService {
  async execute(input: DomainRequest<ProjectOperation>): Promise<DomainReply> {
    return executeProject(this.env, input);
  }

  async summary(subject: string): Promise<SourceSummary> {
    try {
      return await buildSummary(this.env, subject);
    } catch {
      return { source: "project", status: "unavailable", asOf: null, updatedAt: null, stale: true,
        metrics: [], facts: [], notes: ["项目摘要暂时不可用。"], attention: [] };
    }
  }
}

export async function executeProject(env: Env, input: DomainRequest<ProjectOperation>): Promise<DomainReply> {
  if (input?.subject !== "kdp-owner") return { ok: false, error: "not_owner", status: 403 };
  if (!input.args || typeof input.args !== "object" || Array.isArray(input.args)) {
    return { ok: false, error: "invalid_arguments", status: 400 };
  }
  const args = input.args;
  try {
    if (input.operation === "overview") {
      assertKeys(args, []);
      const data = fit(await overview(env, { limit: 15 }), ["recently_done", "branches", "due_soon", "need_you"], BUDGET);
      return { ok: true, data: { ...data, notice: DATA_NOTICE } };
    }
    if (input.operation === "task_list") {
      assertKeys(args, ["project", "status", "need", "category", "due_within_days", "include_done",
        "offset", "limit", "revision"]);
      const filter: TaskFilter = {
        project: optional(args.project, value => text(value, "invalid_project", { max: 200 })!),
        status: optional(args.status, value => oneOf(value, WORK_STATUSES, "invalid_status")),
        need: optional(args.need, value => oneOf(value, [...NEED_KINDS, "any"] as const, "invalid_need")) as
          NeedKind | "any" | undefined,
        category: optional(args.category, value => text(value, "invalid_category", { max: 60 })!),
        dueWithinDays: optional(args.due_within_days, value => integer(value, { min: -3650, max: 3650 })),
        includeDone: optional(args.include_done, value => {
          if (typeof value !== "boolean") throw new AppError("invalid_arguments", 400);
          return value;
        }),
      };
      const offset = integer(args.offset, { min: 0, max: 100000, fallback: 0 });
      const limit = integer(args.limit, { min: 1, max: 100, fallback: 50 });
      const revision = optional(args.revision, value => {
        const clean = text(value, "invalid_arguments", { max: 64 })!;
        if (!/^[0-9a-f]{64}$/.test(clean)) throw new AppError("invalid_arguments", 400);
        return clean;
      });
      return { ok: true, data: { ...await taskPage(env, filter, offset, limit, revision), notice: DATA_NOTICE } };
    }
    if (input.operation === "task_get") {
      assertKeys(args, ["project", "key"]);
      const project = text(args.project, "project_required", { max: 200 })!;
      const key = text(args.key, "invalid_key", { max: 64 })!;
      const data = await getTask(env, project, key);
      return { ok: true, data: { ...fit(data, ["handoffs"], BUDGET), notice: DATA_NOTICE } };
    }
    if (input.operation === "project_get") {
      assertKeys(args, ["project"]);
      const project = await resolveProject(env, text(args.project, "project_required", { max: 200 })!);
      const card = await projectCard(env, project, { changelog: 20, handoffs: 10, token: false });
      return { ok: true, data: { ...fit(card, ["changelog", "handoffs", "branches"], BUDGET), notice: DATA_NOTICE } };
    }
    if (input.operation === "handoff_save") {
      const project = await resolveProject(env, text(args.project, "project_required", { max: 200 })!);
      const parsed = parseHandoffInput(args, {
        projectId: project.id,
        clientId: input.client || "",
        clientName: input.clientName,
        via: "mcp",
      });
      const result = await saveHandoff(env, parsed);
      return {
        ok: true,
        data: {
          id: result.handoff.id,
          project: project.id,
          task: result.handoff.task,
          status: result.handoff.status,
          created_at: result.handoff.at,
          url: projectUrl(env, project.id),
          deduplicated: result.deduplicated,
        },
      };
    }
    return { ok: false, error: "invalid_arguments", status: 400 };
  } catch (error) {
    return failure(error);
  }
}
