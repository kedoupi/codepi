import type { CardTaskStatus } from "../../../worker/types";

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function time(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "尚未同步";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "时间未记录";
  const delta = now - parsed;
  if (delta >= 0 && delta < 24 * 3600_000) {
    if (delta < 3600_000) {
      const minutes = Math.max(1, Math.floor(delta / 60_000));
      return `${minutes} 分钟前`;
    }
    return `${Math.floor(delta / 3600_000)} 小时前`;
  }
  return dateTime.format(new Date(parsed));
}

export function absoluteTime(value: string | null | undefined): string {
  if (!value) return "尚未同步";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? dateTime.format(new Date(parsed)) : "时间未记录";
}

export function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "未记录";
}

export const statusLabels: Record<CardTaskStatus, string> = {
  in_progress: "进行中",
  blocked: "受阻",
  ready_for_review: "待审查",
  done: "已完成",
  unknown: "状态未知",
};

export const projectStatusLabels = {
  active: "进行中",
  paused: "暂停",
  archived: "归档",
} as const;

export const sourceLabels = {
  commits: "提交",
  pulls: "Pull requests",
  issues: "Issues",
  agents_md: "AGENTS.md",
  tasks: "任务记录",
} as const;

export function syncError(value: string | null): string {
  if (!value) return "";
  if (value === "rate_limited") return "GitHub 限流，稍后自动重试";
  if (value === "github_forbidden") return "GitHub 凭证无权限或已过期";
  if (value === "github_unavailable") return "GitHub 暂时无法连接";
  if (value === "github_write_failed") return "同步结果写入失败";
  return "同步失败";
}

export function safeExternal(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function repoHref(repo: string): string {
  const parts = repo.split("/");
  return parts.length === 2
    ? `https://github.com/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`
    : "https://github.com";
}

export function commitHref(repo: string, sha: string): string {
  return `${repoHref(repo)}/commit/${encodeURIComponent(sha)}`;
}

export function pullHref(repo: string, pr: string): string | null {
  if (/^https:\/\//.test(pr)) return safeExternal(pr);
  if (/^\d+$/.test(pr)) return `${repoHref(repo)}/pull/${pr}`;
  return null;
}

export function blobHref(repo: string, branch: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${repoHref(repo)}/blob/${encodeURIComponent(branch)}/${encoded}`;
}
