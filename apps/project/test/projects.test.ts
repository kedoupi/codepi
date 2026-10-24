import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeProjects,
  isConfiguredForSync,
  latestHandoffs,
  listProjects,
  resolveProject,
} from "../worker/projects";
import { saveHandoff } from "../worker/handoffs";
import type { Env } from "../worker/types";
import { handoffInput, resetDb, seedProject } from "./helpers";

describe("project configuration boundaries", () => {
  beforeEach(async () => {
    await resetDb();
    await seedProject();
    await seedProject({
      id: "other-repo",
      repo: "kedoupi/other-repo",
      name: "other-repo",
    });
  });

  it("keeps removed projects visible but stops treating them as sync targets", async () => {
    const configured = {
      ...env,
      PROJECT_REPOS: "kedoupi/codepi",
    } as Env;
    const listed = await listProjects(configured);
    expect(listed.projects.map(item => item.id)).toEqual(
      expect.arrayContaining(["kedoupi-codepi", "other-repo"]),
    );
    expect((await activeProjects(configured)).map(project => project.id))
      .toEqual(["kedoupi-codepi"]);
    expect(isConfiguredForSync(configured, "kedoupi/codepi")).toBe(true);
    expect(isConfiguredForSync(configured, "kedoupi/other-repo")).toBe(false);
    expect(await activeProjects({ ...env, PROJECT_REPOS: "" } as Env)).toEqual([]);
    expect((await resolveProject(configured, "KEDOUPI-CODEPI")).repo)
      .toBe("kedoupi/codepi");
  });

  it("returns one latest handoff per project instead of project history", async () => {
    for (let index = 0; index < 120; index += 1) {
      const handoff = await saveHandoff(env, handoffInput({
        taskId: "task-a",
        summary: `codepi-${index}`,
        requestId: `codepi-${index}`,
      }));
      await env.DB.prepare("UPDATE handoffs SET created_at=? WHERE id=?")
        .bind(`2026-10-20T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00`, handoff.handoff.id)
        .run();
    }
    const other = await saveHandoff(env, handoffInput({
      projectId: "other-repo",
      taskId: "task-b",
      summary: "other-latest",
    }));

    const latest = await latestHandoffs(env, ["kedoupi-codepi", "other-repo"]);
    expect(latest.size).toBe(2);
    expect(latest.get("kedoupi-codepi")?.summary).toBe("codepi-119");
    expect(latest.get("other-repo")?.id).toBe(other.handoff.id);
  });
});
