import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  makeTempDir,
  removeTempDir,
  spawnCli,
  startFakeMcpServer,
  writeCredentials,
} from "./helpers.mjs";

const execFileAsync = promisify(execFile);

test("context, project, project list, and handoff work end-to-end against the official MCP server", async () => {
  const dir = await makeTempDir();
  const repoDir = await makeTempDir();
  const fake = await startFakeMcpServer({
    tools: {
      get_context: async () => ({
        content: [{ type: "text", text: "context" }],
        structuredContent: {
          as_of: "2026-10-20T00:00:00Z",
          owner: { brand: "kedoupi (codepi)" },
          sources: [{
            id: "project",
            title: "Project",
            summary: {
              status: "ok",
              facts: ["One project is active."],
              metrics: [],
              notes: [],
              attention: [],
            },
            next_tools: ["project_get"],
          }],
        },
      }),
      projects_list: async () => ({
        content: [{ type: "text", text: "projects" }],
        structuredContent: {
          as_of: "2026-10-20T00:00:00Z",
          projects: [{
            id: "kedoupi-codepi",
            repo: "kedoupi/codepi",
            name: "codepi",
            status: "active",
            url: "https://project.codepi.app/p/kedoupi-codepi",
          }],
          next_offset: null,
          revision: "a".repeat(64),
        },
      }),
      project_get: async (args) => ({
        content: [{ type: "text", text: "card" }],
        structuredContent: {
          as_of: "2026-10-20T00:00:00Z",
          project: {
            id: "kedoupi-codepi",
            repo: args.project,
            name: "codepi",
            status: "active",
            url: "https://project.codepi.app/p/kedoupi-codepi",
          },
          goal: { value: "Maintain the products.", source: "agents_md" },
          progress: null,
        },
      }),
      project_handoff_save: async () => ({
        content: [{ type: "text", text: "saved" }],
        structuredContent: {
          id: "handoff-1",
          project: "kedoupi-codepi",
          created_at: "2026-10-20T01:00:00Z",
          url: "https://project.codepi.app/p/kedoupi-codepi",
        },
      }),
    },
  });
  try {
    await writeCredentials(dir, fake.server);
    await execFileAsync("git", ["init", "-q"], { cwd: repoDir });
    await execFileAsync("git", ["remote", "add", "origin", "git@github.com:kedoupi/codepi.git"], { cwd: repoDir });
    const env = { CODEPI_CONFIG_DIR: dir };

    const context = await spawnCli(["--server", fake.server, "context", "--json"], { env });
    assert.equal(context.code, 0, context.stderr);
    assert.equal(JSON.parse(context.stdout).sources[0].id, "project");

    const project = await spawnCli(["--server", fake.server, "project", "--json"], {
      env,
      cwd: repoDir,
    });
    assert.equal(project.code, 0, project.stderr);
    assert.equal(JSON.parse(project.stdout).project.repo, "kedoupi/codepi");

    const paged = await spawnCli([
      "--server", fake.server,
      "project",
      "--cursor", "cursor-2",
      "--task-id", "task-2",
      "--handoffs", "7",
      "--json",
    ], { env, cwd: repoDir });
    assert.equal(paged.code, 0, paged.stderr);
    const projectGet = fake.calls.filter((call) => call.name === "project_get").at(-1);
    assert.deepEqual(projectGet.arguments, {
      project: "kedoupi/codepi",
      cursor: "cursor-2",
      task_id: "task-2",
      handoffs: 7,
    });

    const list = await spawnCli(["--server", fake.server, "project", "list", "--json"], { env });
    assert.equal(list.code, 0, list.stderr);
    assert.equal(JSON.parse(list.stdout).projects.length, 1);

    const requestId = "018f5b7d-15e3-7b69-a5b6-2a1e9f7c8d01";
    const handoff = await spawnCli([
      "--server", fake.server,
      "handoff",
      "--repo", "kedoupi/codepi",
      "--task", "2026-10-20-codepi-mcp-domains",
      "--status", "in_progress",
      "--summary", "Implemented the CLI.",
      "--next", "Run integration checks.",
      "--blockers", "Coordinator must register the workspace package.",
      "--files", "packages/cli/src/codepi.ts,packages/cli/src/mcp.ts",
      "--file", "packages/cli/test/mcp-sdk.test.mjs",
      "--branch", "codex/mcp-cli",
      "--base", "abbafdfe2d04966d66dad2f4f0084075f040caaf",
      "--commit", "1234abc",
      "--pr", "42",
      "--request-id", requestId,
      "--json",
    ], { env });
    assert.equal(handoff.code, 0, handoff.stderr);
    assert.equal(JSON.parse(handoff.stdout).id, "handoff-1");
    const saved = fake.calls.find((call) => call.name === "project_handoff_save");
    assert.deepEqual(saved.arguments, {
      project: "kedoupi/codepi",
      task_id: "2026-10-20-codepi-mcp-domains",
      status: "in_progress",
      summary: "Implemented the CLI.",
      next: "Run integration checks.",
      files: [
        "packages/cli/test/mcp-sdk.test.mjs",
        "packages/cli/src/codepi.ts",
        "packages/cli/src/mcp.ts",
      ],
      branch: "codex/mcp-cli",
      base_sha: "abbafdfe2d04966d66dad2f4f0084075f040caaf",
      request_id: requestId,
      blockers: "Coordinator must register the workspace package.",
      commit: "1234abc",
      pr: "42",
    });
  } finally {
    await fake.close();
    await removeTempDir(dir);
    await removeTempDir(repoDir);
  }
});

test("handoff enforces project handoff field limits before network access", async () => {
  const dir = await makeTempDir();
  try {
    const common = [
      "handoff",
      "--task", "task-1",
      "--status", "done",
      "--summary", "Done.",
      "--next", "Complete.",
      "--repo", "kedoupi/codepi",
      "--branch", "codex/test",
      "--base", "abbafdfe2d04966d66dad2f4f0084075f040caaf",
    ];
    const env = { CODEPI_CONFIG_DIR: dir };

    const shortBase = await spawnCli([...common.slice(0, -1), "abbafdfe"], { env });
    assert.equal(shortBase.code, 1);
    assert.match(shortBase.stderr, /40/);

    const longPr = await spawnCli([...common, "--pr", "x".repeat(501)], { env });
    assert.equal(longPr.code, 1);
    assert.match(longPr.stderr, /500/);

    const longRequestId = await spawnCli([
      ...common,
      "--request-id", "x".repeat(101),
    ], { env });
    assert.equal(longRequestId.code, 1);
    assert.match(longRequestId.stderr, /100/);
  } finally {
    await removeTempDir(dir);
  }
});

test("handoff requires status/next and reads summary from stdin", async () => {
  const dir = await makeTempDir();
  const repoDir = await makeTempDir();
  const fake = await startFakeMcpServer({
    tools: {
      project_handoff_save: async () => ({
        content: [{ type: "text", text: "saved" }],
        structuredContent: { id: "stdin-handoff" },
      }),
    },
  });
  try {
    const missing = await spawnCli(["handoff", "--task", "t", "--status", "done", "--summary", "x"], {
      env: { CODEPI_CONFIG_DIR: dir },
    });
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /--next/);
    await writeCredentials(dir, fake.server);
    await execFileAsync("git", ["init", "-q"], { cwd: repoDir });
    const handoff = await spawnCli([
      "--server", fake.server,
      "handoff",
      "--task", "stdin-task",
      "--status", "done",
      "--summary", "-",
      "--next", "Complete",
      "--branch", "codex/test",
      "--base", "abbafdfe2d04966d66dad2f4f0084075f040caaf",
      "--repo", "kedoupi/codepi",
      "--json",
    ], {
      env: { CODEPI_CONFIG_DIR: dir },
      cwd: repoDir,
      input: "Summary supplied over stdin.\n",
    });
    assert.equal(handoff.code, 0, handoff.stderr);
    const args = fake.calls[0].arguments;
    assert.equal(args.summary, "Summary supplied over stdin.");
    assert.match(args.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  } finally {
    await fake.close();
    await removeTempDir(dir);
    await removeTempDir(repoDir);
  }
});

test("handoff derives branch, repository and merge-base from the working tree", async () => {
  const dir = await makeTempDir();
  const repoDir = await makeTempDir();
  const fake = await startFakeMcpServer({
    tools: {
      project_handoff_save: async () => ({
        content: [{ type: "text", text: "saved" }],
        structuredContent: { id: "derived-handoff" },
      }),
    },
  });
  try {
    await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", [
      "-c", "user.name=CodePi Test",
      "-c", "user.email=test@example.invalid",
      "commit", "-q", "--allow-empty", "-m", "base",
    ], { cwd: repoDir });
    const { stdout: baseOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    const base = baseOutput.trim();
    await execFileAsync("git", ["update-ref", "refs/remotes/origin/main", base], { cwd: repoDir });
    await execFileAsync("git", ["checkout", "-q", "-b", "codex/cli-test"], { cwd: repoDir });
    await execFileAsync("git", [
      "-c", "user.name=CodePi Test",
      "-c", "user.email=test@example.invalid",
      "commit", "-q", "--allow-empty", "-m", "change",
    ], { cwd: repoDir });
    await execFileAsync("git", [
      "remote", "add", "origin", "git@github.com:kedoupi/codepi.git",
    ], { cwd: repoDir });

    await writeCredentials(dir, fake.server);
    const result = await spawnCli([
      "--server", fake.server,
      "handoff",
      "--task", "derived-task",
      "--status", "ready_for_review",
      "--summary", "Derived Git fields.",
      "--next", "Review the result.",
      "--json",
    ], {
      env: { CODEPI_CONFIG_DIR: dir },
      cwd: repoDir,
    });
    assert.equal(result.code, 0, result.stderr);
    const args = fake.calls[0].arguments;
    assert.equal(args.project, "kedoupi/codepi");
    assert.equal(args.branch, "codex/cli-test");
    assert.equal(args.base_sha, base);
  } finally {
    await fake.close();
    await removeTempDir(dir);
    await removeTempDir(repoDir);
  }
});

test("init requires --yes and connect only prints a snippet", async () => {
  const repoDir = await makeTempDir();
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: repoDir });
    const dry = await spawnCli(["init"], { cwd: repoDir });
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /codepi init --yes/);
    await assert.rejects(readFile(join(repoDir, "AGENTS.md"), "utf8"), /ENOENT/);
    const written = await spawnCli(["init", "--yes"], { cwd: repoDir });
    assert.equal(written.code, 0, written.stderr);
    assert.match(await readFile(join(repoDir, "AGENTS.md"), "utf8"), /<!-- codepi:start -->/);
    const again = await spawnCli(["init", "--yes", "--json"], { cwd: repoDir });
    assert.equal(JSON.parse(again.stdout).status, "already_initialized");
    const preview = await spawnCli(["init"], { cwd: repoDir });
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /不会自动修改或覆盖/);
    assert.match(preview.stdout, /仅在 CodePi MCP\/CLI 可用且用户已授权远程写入时/);

    const connect = await spawnCli(["connect", "codex", "--server", "https://mcp.example"]);
    assert.equal(connect.code, 0, connect.stderr);
    assert.match(connect.stdout, /\[mcp_servers\.codepi\]/);
    assert.match(connect.stdout, /https:\/\/mcp\.example\/mcp/);
  } finally {
    await removeTempDir(repoDir);
  }
});
