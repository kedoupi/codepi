import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { CliError, EXIT } from "./errors.js";
import { ensurePrivateDirectory } from "./config.js";

interface LockRecord {
  pid: number;
  hostname: string;
  nonce: string;
  created_at: string;
}

export interface LockOptions {
  timeoutMs?: number;
  pollMs?: number;
  malformedStaleMs?: number;
}

export class FileLock {
  readonly path: string;
  readonly nonce: string;
  private released = false;

  constructor(path: string, nonce: string) {
    this.path = path;
    this.nonce = nonce;
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    try {
      const current = await readLock(this.path);
      if (current?.nonce === this.nonce) await fs.unlink(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function acquireLock(
  path: string,
  options: LockOptions = {},
): Promise<FileLock> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollMs = options.pollMs ?? 50;
  const malformedStaleMs = options.malformedStaleMs ?? 10 * 60_000;
  const deadline = Date.now() + timeoutMs;

  await ensurePrivateDirectory(dirname(path));
  for (;;) {
    const acquired = await tryCreateLock(path);
    if (acquired) return acquired;

    if (await isStale(path, malformedStaleMs)) {
      // Only one contender may remove a stale lock. Otherwise two processes
      // can both observe the same dead owner and one can unlink the other's
      // newly acquired live lock.
      const reclaimPath = `${path}.reclaim`;
      if (await isStale(reclaimPath, malformedStaleMs)) {
        await removeStaleLock(reclaimPath, malformedStaleMs);
      }
      const reclaim = await tryCreateLock(reclaimPath);
      if (reclaim) {
        try {
          if (await isStale(path, malformedStaleMs)) {
            await fs.unlink(path).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            });
          }
        } finally {
          await reclaim.release();
        }
        continue;
      }
    }
    if (Date.now() >= deadline) {
      throw new CliError(
        "等待凭证刷新锁超时；另一个 codepi 进程可能仍在刷新，请稍后重试。",
        EXIT.REMOTE,
        { code: "refresh_lock_timeout" },
      );
    }
    await delay(pollMs);
  }
}

async function tryCreateLock(path: string): Promise<FileLock | null> {
  const nonce = randomUUID();
  const record: LockRecord = {
    pid: process.pid,
    hostname: hostname(),
    nonce,
    created_at: new Date().toISOString(),
  };
  try {
    const handle = await fs.open(path, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return new FileLock(path, nonce);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
}

async function isStale(path: string, malformedStaleMs: number): Promise<boolean> {
  const snapshot = await readLockSnapshot(path);
  return snapshot === null || staleSnapshot(snapshot, malformedStaleMs);
}

async function removeStaleLock(path: string, malformedStaleMs: number): Promise<boolean> {
  const before = await readLockSnapshot(path);
  if (before === null || !staleSnapshot(before, malformedStaleMs)) return false;
  const after = await readLockSnapshot(path);
  if (after === null || after.text !== before.text || !staleSnapshot(after, malformedStaleMs)) {
    return false;
  }
  try {
    await fs.unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

interface LockSnapshot {
  text: string;
  mtimeMs: number;
}

async function readLockSnapshot(path: string): Promise<LockSnapshot | null> {
  let text: string;
  let mtimeMs: number;
  try {
    const [content, stat] = await Promise.all([fs.readFile(path, "utf8"), fs.stat(path)]);
    text = content;
    mtimeMs = stat.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return { text, mtimeMs };
}

function staleSnapshot(snapshot: LockSnapshot, malformedStaleMs: number): boolean {
  let record: LockRecord;
  try {
    record = JSON.parse(snapshot.text) as LockRecord;
  } catch {
    return Date.now() - snapshot.mtimeMs > malformedStaleMs;
  }
  if (
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0 ||
    typeof record.hostname !== "string" ||
    typeof record.nonce !== "string" ||
    typeof record.created_at !== "string"
  ) {
    return Date.now() - snapshot.mtimeMs > malformedStaleMs;
  }
  if (record.hostname !== hostname()) {
    // A shared config directory can span hosts. We cannot prove a remote PID
    // is dead, so never steal a well-formed lock owned by another host.
    return false;
  }
  return !isProcessAlive(record.pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLock(path: string): Promise<LockRecord | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as LockRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
