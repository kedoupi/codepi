import test from "node:test";
import assert from "node:assert/strict";
import {
  expandProjectListPages,
  MAX_PROJECT_LIST_ITEMS,
} from "../dist/project-list.js";
import {
  makeTempDir,
  removeTempDir,
  spawnCli,
  startFakeMcpServer,
  writeCredentials,
} from "./helpers.mjs";

const REVISION = "a".repeat(64);

test("project list preserves status and follows next_offset to completion", async () => {
  const dir = await makeTempDir();
  const asOf = "2026-10-20T05:00:00Z";
  const pages = new Map([
    [0, {
      as_of: asOf,
      projects: [project("one", "task-one", "blocked", "Resolve one.")],
      next_offset: 20,
      revision: REVISION,
    }],
    [20, {
      as_of: asOf,
      projects: [project("two", "task-two", "in_progress", "Continue two.")],
      next_offset: 40,
      revision: REVISION,
    }],
    [40, {
      as_of: asOf,
      projects: [project("three", "task-three", "done", "Complete three.")],
      next_offset: null,
      revision: REVISION,
    }],
  ]);
  const fake = await startFakeMcpServer({
    tools: {
      projects_list: async (args) => {
        const page = pages.get(args.offset ?? 0);
        assert.ok(page, `unexpected offset ${args.offset}`);
        return {
          content: [{ type: "text", text: JSON.stringify(page) }],
          structuredContent: page,
        };
      },
    },
  });
  try {
    await writeCredentials(dir, fake.server);
    const result = await spawnCli([
      "--server", fake.server,
      "project", "list",
      "--status", "active",
      "--json",
    ], { env: { CODEPI_CONFIG_DIR: dir } });

    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.as_of, asOf);
    assert.equal(body.next_offset, null);
    assert.equal(body.revision, REVISION);
    assert.deepEqual(body.projects.map((item) => item.id), ["one", "two", "three"]);
    assert.deepEqual(fake.calls.map((call) => call.arguments), [
      { status: "active" },
      { status: "active", offset: 20, revision: REVISION },
      { status: "active", offset: 40, revision: REVISION },
    ]);
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

test("project list fails closed when next_offset does not advance", async () => {
  const dir = await makeTempDir();
  const fake = await startFakeMcpServer({
    tools: {
      projects_list: async (args) => {
        const page = {
          as_of: "2026-10-20T05:00:00Z",
          projects: [project(`item-${args.offset ?? 0}`, "task", "done", "Done.")],
          next_offset: 20,
          revision: REVISION,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(page) }],
          structuredContent: page,
        };
      },
    },
  });
  try {
    await writeCredentials(dir, fake.server);
    const result = await spawnCli([
      "--server", fake.server,
      "project", "list",
      "--json",
    ], { env: { CODEPI_CONFIG_DIR: dir } });

    assert.equal(result.code, 4);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /分页游标未推进/);
    assert.deepEqual(fake.calls.map((call) => call.arguments), [
      {},
      { offset: 20, revision: REVISION },
    ]);
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

test("project list pagination rejects duplicate projects, invalid offsets and unsafe totals", async () => {
  const first = {
    id: "one",
    repo: "kedoupi/one",
    task_id: "task-one",
    status: "blocked",
    next: "Resolve one.",
  };
  await assert.rejects(
    expandProjectListPages(page({ projects: [first], next_offset: 20 }), async () =>
      page({ projects: [{ ...first }], next_offset: null })),
    /重复项目/,
  );
  await assert.rejects(
    expandProjectListPages(page({ projects: [first], next_offset: 1.5 }), async () =>
      page({ projects: [], next_offset: null })),
    /next_offset 类型无效/,
  );
  const oversized = Array.from(
    { length: MAX_PROJECT_LIST_ITEMS + 1 },
    (_, index) => project(`item-${index}`, "task", "done", "Done."),
  );
  await assert.rejects(
    expandProjectListPages(page({ projects: oversized, next_offset: null }), async () =>
      page({ projects: [], next_offset: null })),
    /安全上限/,
  );
});

test("project list fails closed when a page revision is missing or changes", async () => {
  const first = project("one", "task-one", "blocked", "Resolve one.");

  await assert.rejects(
    expandProjectListPages(page({ projects: [first], next_offset: null, revision: undefined }), async () =>
      page({ projects: [], next_offset: null })),
    /revision/,
  );

  let continuationCalls = 0;
  await assert.rejects(
    expandProjectListPages(page({ projects: [first], next_offset: 20 }), async (offset, revision) => {
      continuationCalls += 1;
      assert.equal(offset, 20);
      assert.equal(revision, REVISION);
      return page({ projects: [project("two", "task-two", "done", "Done.")], next_offset: null, revision: undefined });
    }),
    /revision/,
  );
  assert.equal(continuationCalls, 1);

  await assert.rejects(
    expandProjectListPages(page({ projects: [first], next_offset: 20 }), async (_offset, revision) => {
      assert.equal(revision, REVISION);
      return page({
        projects: [project("two", "task-two", "done", "Done.")],
        next_offset: null,
        revision: "b".repeat(64),
      });
    }),
    /cursor_stale/,
  );
});

test("project list does not print a partial list when the first page has no revision", async () => {
  const dir = await makeTempDir();
  const fake = await startFakeMcpServer({
    tools: {
      projects_list: async () => {
        const page = {
          as_of: "2026-10-20T05:00:00Z",
          projects: [project("one", "task-one", "blocked", "Resolve one.")],
          next_offset: null,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(page) }],
          structuredContent: page,
        };
      },
    },
  });
  try {
    await writeCredentials(dir, fake.server);
    const result = await spawnCli([
      "--server", fake.server,
      "project", "list",
      "--json",
    ], { env: { CODEPI_CONFIG_DIR: dir } });

    assert.equal(result.code, 4);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /revision/);
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

test("project list maps a changed server revision to cursor_stale without partial output", async () => {
  const dir = await makeTempDir();
  const fake = await startFakeMcpServer({
    tools: {
      projects_list: async (args) => {
        if ((args.offset ?? 0) === 0) {
          const page = {
            as_of: "2026-10-20T05:00:00Z",
            projects: [project("one", "task-one", "blocked", "Resolve one.")],
            next_offset: 20,
            revision: REVISION,
          };
          return {
            content: [{ type: "text", text: JSON.stringify(page) }],
            structuredContent: page,
          };
        }
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: "cursor_stale" }) }],
          structuredContent: { error: "cursor_stale" },
        };
      },
    },
  });
  try {
    await writeCredentials(dir, fake.server);
    const result = await spawnCli([
      "--server", fake.server,
      "project", "list",
      "--status", "active",
      "--json",
    ], { env: { CODEPI_CONFIG_DIR: dir } });

    assert.equal(result.code, 4);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /cursor_stale/);
    assert.deepEqual(fake.calls.map((call) => call.arguments), [
      { status: "active" },
      { status: "active", offset: 20, revision: REVISION },
    ]);
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

function project(id, taskId, status, next) {
  return {
    id,
    repo: `kedoupi/${id}`,
    name: id,
    status: "active",
    latest_handoff: { task_id: taskId, status, next },
  };
}

function page(value) {
  return {
    structured: {
      as_of: "2026-10-20T05:00:00Z",
      projects: [],
      next_offset: null,
      revision: REVISION,
      ...value,
    },
    text: null,
  };
}
