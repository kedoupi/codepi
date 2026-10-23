import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseGitHubRemote(remote: string): string | null {
  const value = remote.trim();
  if (!value) return null;

  const scp = /^(?:[^@\s]+@)?github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/i.exec(value);
  if (scp) return validRepo(scp[1] ?? "", scp[2] ?? "");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== "github.com") return null;
  if (!["https:", "ssh:", "git:"].includes(url.protocol)) return null;
  if (url.password || url.search || url.hash) return null;
  if (url.username && url.protocol !== "ssh:") return null;
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2) return null;
  return validRepo(parts[0] ?? "", parts[1] ?? "");
}

function validRepo(owner: string, repo: string): string | null {
  const cleanRepo = repo.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9-]+$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(cleanRepo)) return null;
  return `${owner}/${cleanRepo}`;
}

export async function detectRepo(cwd = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
    });
    return parseGitHubRemote(stdout);
  } catch {
    return null;
  }
}

export async function currentBranch(cwd = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
    });
    const branch = stdout.trim();
    return branch || null;
  } catch {
    return null;
  }
}

export async function defaultBaseSha(cwd = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["merge-base", "HEAD", "origin/main"], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
    });
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export async function gitRoot(cwd = process.cwd()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
