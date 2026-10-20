import test from "node:test";
import assert from "node:assert/strict";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { CredentialStore } from "../dist/config.js";
import { acquireLock } from "../dist/lock.js";
import { makeTempDir, removeTempDir } from "./helpers.mjs";

test("credentials are isolated per server and written with private modes", { skip: process.platform === "win32" }, async () => {
  const dir = await makeTempDir();
  try {
    const one = new CredentialStore("https://one.example", { configDir: dir });
    const two = new CredentialStore("https://two.example", { configDir: dir });
    await one.write({ version: 1, server: one.server, tokens: fakeTokens("one") });
    await two.write({ version: 1, server: two.server, tokens: fakeTokens("two") });
    assert.notEqual(one.filePath, two.filePath);
    assert.equal((await one.read()).tokens.access_token, "one-access");
    assert.equal((await two.read()).tokens.access_token, "two-access");
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(one.serverDir)).mode & 0o777, 0o700);
    assert.equal((await stat(one.filePath)).mode & 0o777, 0o600);
    const names = await readdir(one.serverDir);
    assert.deepEqual(names.filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await removeTempDir(dir);
  }
});

test("does not steal a lock held by a living process", async () => {
  const dir = await makeTempDir();
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  try {
    const store = new CredentialStore("https://lock.example", { configDir: dir });
    await store.ensureDirectories();
    await writeFile(store.lockPath, JSON.stringify({
      pid: sleeper.pid,
      hostname: (await import("node:os")).hostname(),
      nonce: "living",
      created_at: new Date(0).toISOString(),
    }), { mode: 0o600 });
    await assert.rejects(
      acquireLock(store.lockPath, { timeoutMs: 150, pollMs: 20 }),
      /刷新锁超时/,
    );
    assert.equal((await stat(store.lockPath)).isFile(), true);
  } finally {
    sleeper.kill();
    await removeTempDir(dir);
  }
});

test("recovers a same-host lock whose owner is no longer running", async () => {
  const dir = await makeTempDir();
  try {
    const store = new CredentialStore("https://stale.example", { configDir: dir });
    await store.ensureDirectories();
    await writeFile(store.lockPath, JSON.stringify({
      pid: 99999999,
      hostname: (await import("node:os")).hostname(),
      nonce: "dead",
      created_at: new Date(0).toISOString(),
    }), { mode: 0o600 });
    const lease = await acquireLock(store.lockPath, { timeoutMs: 500, pollMs: 20 });
    await lease.release();
    await assert.rejects(stat(store.lockPath), /ENOENT/);
  } finally {
    await removeTempDir(dir);
  }
});

test("recovers stale primary and reclaim locks left by dead owners", async () => {
  const dir = await makeTempDir();
  try {
    const hostname = (await import("node:os")).hostname();
    const store = new CredentialStore("https://stale-reclaim.example", { configDir: dir });
    await store.ensureDirectories();
    const stale = JSON.stringify({
      pid: 99999999,
      hostname,
      nonce: "dead",
      created_at: new Date(0).toISOString(),
    });
    await writeFile(store.lockPath, stale, { mode: 0o600 });
    await writeFile(`${store.lockPath}.reclaim`, stale, { mode: 0o600 });
    const lease = await acquireLock(store.lockPath, { timeoutMs: 500, pollMs: 20 });
    await lease.release();
    await assert.rejects(stat(store.lockPath), /ENOENT/);
    await assert.rejects(stat(`${store.lockPath}.reclaim`), /ENOENT/);
  } finally {
    await removeTempDir(dir);
  }
});

function fakeTokens(prefix) {
  return {
    access_token: `${prefix}-access`,
    refresh_token: `${prefix}-refresh`,
    token_type: "Bearer",
    scope: "context.read",
    expires_at: Date.now() + 3_600_000,
  };
}
