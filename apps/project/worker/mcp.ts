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
import { AppError, assertKeys, DATA_NOTICE, integer, jsonBytes, oneOf, projectUrl, shorten, text } from "./lib";
import { resolveProject } from "./projects";
import { buildSummary } from "./summary";
import { NEED_KINDS, WORK_STATUSES, type Env, type NeedKind } from "./types";
import { fit, getTask, overview, projectCard, taskPage, type TaskFilter } from "./work";
import { fitToday, pickAgentToday, todayRef, todayView } from "./today";

const BUDGET = MCP_LIMITS.detail;

function failure(error: unknown): DomainReply {
  if (error instanceof AppError) return { ok: false, error: error.code, status: error.status };
  return { ok: false, error: "internal_error", status: 500 };
}

const TEXT_FIELDS = ["what", "impact", "advice", "need"] as const;

/**
 * A task at every field limit can exceed the detail budget on its own. Drop
 * handoffs first, then shorten the longest text field (and related paths)
 * step by step; name each shortened part in `truncated`. Full text stays on
 * the web page.
 */
export function fitTask(data: Awaited<ReturnType<typeof getTask>>) {
  const result = fit({ ...data, task: { ...data.task, related: [...data.task.related] } }, ["handoffs"], BUDGET - 256);
  const truncated = new Set(result.truncated ?? []);
  const task = result.task;
  // Count code points, the same unit shorten() cuts by, so every step shrinks the field and the loop ends.
  const points = (value: string | null) => (value ? Array.from(value).length : 0);
  while (jsonBytes(result) > BUDGET - 256) {
    const longest = TEXT_FIELDS
      .filter(field => points(task[field]) > 80)
      .sort((a, b) => points(task[b]) - points(task[a]))[0];
    if (longest) {
      task[longest] = shorten(task[longest]!, Math.floor(points(task[longest]) * 0.7));
      truncated.add(`task.${longest}`);
    } else if (task.related.length) {
      task.related.pop();
      truncated.add("task.related");
    } else {
      break;
    }
  }
  return truncated.size ? { ...result, truncated: [...truncated] } : result;
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
      const data = fit(await overview(env, { limit: 15 }),
        ["recently_done", "branches", "due_soon", "projects", "need_you"], BUDGET);
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
      return { ok: true, data: { ...fitTask(await getTask(env, project, key)), notice: DATA_NOTICE } };
    }
    if (input.operation === "project_get") {
      assertKeys(args, ["project"]);
      const project = await resolveProject(env, text(args.project, "project_required", { max: 200 })!);
      const card = await projectCard(env, project, { changelog: 20, handoffs: 10, token: false });
      return { ok: true, data: { ...fit(card, ["changelog", "handoffs", "branches"], BUDGET), notice: DATA_NOTICE } };
    }
    if (input.operation === "today_get") {
      assertKeys(args, ["project"]);
      const projectRef = optional(args.project, value => text(value, "project_required", { max: 200 })!);
      const project = projectRef === undefined ? undefined : await resolveProject(env, projectRef);
      const data = await todayView(env, new Date(), project?.id);
      return { ok: true, data: fitToday({ ...data, notice: DATA_NOTICE }, BUDGET - 256) };
    }
    if (input.operation === "today_pick") {
      assertKeys(args, ["items"]);
      if (!Array.isArray(args.items) || args.items.length > 20) throw new AppError("invalid_arguments", 400);
      const refs = args.items.map(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("invalid_arguments", 400);
        const target = value as Record<string, unknown>;
        assertKeys(target, ["project", "key"]);
        return todayRef(target.project, target.key);
      });
      return { ok: true, data: await pickAgentToday(env, refs) };
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
