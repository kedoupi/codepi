import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseGitHubRemote, detectRepo, currentBranch } from "../dist/repo.js";
import { makeTempDir, removeTempDir } from "./helpers.mjs";

const execFileAsync = promisify(execFile);

test("parses supported GitHub origin formats", () => {
  assert.equal(parseGitHubRemote("git@github.com:kedoupi/codepi.git"), "kedoupi/codepi");
  assert.equal(parseGitHubRemote("https://github.com/kedoupi/codepi.git"), "kedoupi/codepi");
  assert.equal(parseGitHubRemote("ssh://git@github.com/kedoupi/codepi"), "kedoupi/codepi");
  assert.equal(parseGitHubRemote("git@github.com:owner/repo.git\n"), "owner/repo");
});

test("rejects missing and non-GitHub remotes", () => {
  assert.equal(parseGitHubRemote(""), null);
  assert.equal(parseGitHubRemote("https://gitlab.com/owner/repo.git"), null);
  assert.equal(parseGitHubRemote("https://github.com/owner"), null);
  assert.equal(parseGitHubRemote("not a remote"), null);
});

test("detects repository through git remote get-url origin", async () => {
  const dir = await makeTempDir();
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: dir });
    await mkdir(join(dir, ".git"), { recursive: true });
    await execFileAsync("git", ["remote", "add", "origin", "git@github.com:owner/repo.git"], { cwd: dir });
    assert.equal(await detectRepo(dir), "owner/repo");
  } finally {
    await removeTempDir(dir);
  }
});

test("reads the current branch and refuses to call detached HEAD a branch", async () => {
  const dir = await makeTempDir();
  try {
    await execFileAsync("git", ["init", "-q", "-b", "codex/branch-test"], { cwd: dir });
    assert.equal(await currentBranch(dir), "codex/branch-test");
    await execFileAsync("git", ["add", "-A"], { cwd: dir });
    await execFileAsync("git", [
      "-c", "user.name=CodePi Test",
      "-c", "user.email=test@example.invalid",
      "commit", "-q", "--allow-empty", "-m", "fixture",
    ], { cwd: dir });
    await execFileAsync("git", ["checkout", "-q", "--detach"], { cwd: dir });
    assert.equal(await currentBranch(dir), null);
  } finally {
    await removeTempDir(dir);
  }
});
