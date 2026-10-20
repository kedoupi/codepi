import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeProjects,
  isConfiguredForSync,
  listProjects,
  resolveProject,
} from "../worker/projects";
import type { Env } from "../worker/types";
import { resetDb, seedProject } from "./helpers";

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
      PROJECT_REPOS: "kedoupi/kdp.cool",
    } as Env;
    const listed = await listProjects(configured);
    expect(listed.projects.map(item => item.id)).toEqual(
      expect.arrayContaining(["kedoupi-kdp-cool", "other-repo"]),
    );
    expect((await activeProjects(configured)).map(project => project.id))
      .toEqual(["kedoupi-kdp-cool"]);
    expect(isConfiguredForSync(configured, "kedoupi/kdp.cool")).toBe(true);
    expect(isConfiguredForSync(configured, "kedoupi/other-repo")).toBe(false);
    expect(await activeProjects({ ...env, PROJECT_REPOS: "" } as Env)).toEqual([]);
    expect((await resolveProject(configured, "KEDOUPI-KDP-COOL")).repo)
      .toBe("kedoupi/kdp.cool");
  });
});
