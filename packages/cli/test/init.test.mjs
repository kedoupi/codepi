import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initAgentsFile, INIT_BLOCK, INIT_START } from "../dist/init.js";
import { makeTempDir, removeTempDir } from "./helpers.mjs";

const execFileAsync = promisify(execFile);

test("init does not write without --yes", async () => {
  const dir = await makeTempDir();
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: dir });
    const result = await initAgentsFile({ cwd: dir, root: dir, yes: false });
    assert.equal(result.status, "would_write");
    await assert.rejects(readFile(join(dir, "AGENTS.md"), "utf8"), /ENOENT/);
  } finally {
    await removeTempDir(dir);
  }
});

test("init appends once and is idempotent", async () => {
  const dir = await makeTempDir();
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: dir });
    await writeFile(join(dir, "AGENTS.md"), "# Existing\n", "utf8");
    const first = await initAgentsFile({ cwd: dir, root: dir, yes: true });
    assert.equal(first.status, "written");
    const written = await readFile(join(dir, "AGENTS.md"), "utf8");
    assert.match(written, /不可用时继续本地工作/);
    assert.match(written, /仅在 CodePi MCP\/CLI 可用且用户已授权远程写入时/);
    const second = await initAgentsFile({ cwd: dir, root: dir, yes: true });
    assert.equal(second.status, "already_initialized");
    const content = await readFile(join(dir, "AGENTS.md"), "utf8");
    assert.equal(content, written);
    assert.equal(content.split(INIT_START).length, 2);
    assert.match(content, /# Existing/);
  } finally {
    await removeTempDir(dir);
  }
});

test("existing marker is never silently upgraded", async () => {
  const dir = await makeTempDir();
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: dir });
    const original = "# Existing\n\n<!-- codepi:start -->\nold managed text\n<!-- codepi:end -->\n";
    await writeFile(join(dir, "AGENTS.md"), original, "utf8");
    const result = await initAgentsFile({ cwd: dir, root: dir, yes: true });
    assert.equal(result.status, "already_initialized");
    assert.equal(result.content, INIT_BLOCK);
    assert.equal(await readFile(join(dir, "AGENTS.md"), "utf8"), original);
  } finally {
    await removeTempDir(dir);
  }
});
