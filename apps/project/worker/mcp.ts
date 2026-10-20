import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  DomainReply,
  DomainRequest,
  ProjectOperation,
  ProjectService,
  SourceSummary,
} from "@kedoupi/shared/mcp/contract";
import { buildCard, projectGetPage } from "./card";
import { parseHandoffInput, saveHandoff } from "./handoffs";
import { AppError, assertKeys, integer, projectUrl, text } from "./lib";
import {
  isProjectStatus,
  listProjectSummaries,
  projectListPage,
  resolveProject,
} from "./projects";
import { buildSummary } from "./summary";
import type { Env } from "./types";

function failure(error: unknown): DomainReply {
  if (error instanceof AppError) {
    return { ok: false, error: error.code, status: error.status };
  }
  return { ok: false, error: "internal_error", status: 500 };
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
      return {
        source: "project",
        status: "unavailable",
        asOf: null,
        updatedAt: null,
        stale: true,
        metrics: [],
        facts: [],
        notes: ["项目摘要暂时不可用。"],
        attention: [],
      };
    }
  }
}

export async function executeProject(
  env: Env,
  input: DomainRequest<ProjectOperation>,
): Promise<DomainReply> {
  if (input?.subject !== "kdp-owner") {
    return { ok: false, error: "not_owner", status: 403 };
  }
  if (!input.args || typeof input.args !== "object" || Array.isArray(input.args)) {
    return { ok: false, error: "invalid_arguments", status: 400 };
  }
  try {
    if (input.operation === "list") {
      assertKeys(input.args, ["status", "offset", "limit", "revision"]);
      const rawStatus = input.args.status;
      if (rawStatus !== undefined && !isProjectStatus(rawStatus)) {
        throw new AppError("invalid_arguments", 400);
      }
      const status = rawStatus as "active" | "paused" | "archived" | undefined;
      const offset = integer(input.args.offset, {
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        fallback: 0,
      });
      const limit = integer(input.args.limit, { min: 1, max: 50, fallback: 20 });
      const revision = input.args.revision === undefined || input.args.revision === null
        ? undefined
        : text(input.args.revision, "invalid_arguments", { max: 64, optional: true })!;
      if (revision !== undefined && !/^[0-9a-f]{64}$/.test(revision)) {
        throw new AppError("invalid_arguments", 400);
      }
      const summaries = await listProjectSummaries(env, status);
      if (offset > 0 && revision === undefined) {
        throw new AppError("cursor_stale", 409);
      }
      if (revision !== undefined && revision !== summaries.revision) {
        throw new AppError("cursor_stale", 409);
      }
      const page = projectListPage(
        summaries,
        offset,
        limit,
      );
      return { ok: true, data: page as unknown as Record<string, unknown> };
    }
    if (input.operation === "get") {
      assertKeys(input.args, ["project", "handoffs", "cursor", "task_id"]);
      const ref = text(input.args.project, "project_required", { max: 200 })!;
      const project = await resolveProject(env, ref);
      const handoffs = integer(input.args.handoffs, { min: 1, max: 20, fallback: 5 });
      const cursor = input.args.cursor === undefined || input.args.cursor === null
        ? null
        : text(input.args.cursor, "invalid_cursor", { max: 2048, optional: true });
      const taskId = input.args.task_id === undefined || input.args.task_id === null
        ? undefined
        : text(input.args.task_id, "invalid_task_id", { max: 200 })!;
      const card = await buildCard(env, project, { handoffs, taskId });
      return { ok: true, data: await projectGetPage(card, cursor) };
    }
    if (input.operation === "handoff_save") {
      const projectRef = text(input.args.project, "project_required", { max: 200 })!;
      const project = await resolveProject(env, projectRef);
      const parsed = parseHandoffInput(input.args, {
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
          task_id: result.handoff.task_id,
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
