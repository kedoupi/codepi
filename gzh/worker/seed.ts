import { nowIso, shanghaiDate } from "./lib";
import type { Slot, Status } from "./types";

export interface DemoSpec {
  slot: Slot;
  status: Status;
  title: string;
  digest: string;
  note: string | null;
}

export const DEMO_SPECS: readonly DemoSpec[] = [
  {
    slot: "早",
    status: "待审",
    title: "早档：开箱一件小事",
    digest: "演示稿。点进预览看接近成稿的 H5，再过 / 要改 / 拒；占档时可撤回或撤掉。",
    note: null,
  },
  {
    slot: "中",
    status: "需改",
    title: "中档：午饭话题",
    digest: "演示需改。可「撤回待审」或改完再交；占档时可撤掉换真稿。",
    note: "标题再收一点",
  },
  {
    slot: "晚",
    status: "可推箱",
    title: "晚档：今日收束",
    digest: "演示可推箱。未过审没有这一步；占晚档时可撤回待审再过，或撤掉换真稿。",
    note: null,
  },
] as const;

const SLOT_CODE: Record<Slot, string> = {
  早: "zao",
  中: "zhong",
  晚: "wan",
};

export function demoSlug(date: string, slot: Slot): string {
  const mmdd = date.slice(5, 7) + date.slice(8, 10);
  return `kdp-${mmdd}-${SLOT_CODE[slot]}`;
}

export function isDemoSlug(id: string): boolean {
  return /^kdp-\d{4}-(zao|zhong|wan)$/.test(id);
}

const DEMO_TITLES = new Set<string>([
  ...DEMO_SPECS.map((spec) => spec.title),
  "晚档：可推箱示例",
]);

export function isDemoTitle(title: string): boolean {
  return DEMO_TITLES.has(title.trim());
}

function previewPathname(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).pathname;
    } catch {
      return trimmed.split(/[?#]/)[0] || "/";
    }
  }
  return trimmed.split(/[?#]/)[0] || "/";
}

export function isDemoPreviewPath(path: string | null | undefined): boolean {
  if (!path?.trim()) return false;
  const pathname = previewPathname(path)
    .replace(/\/index\.html$/i, "")
    .replace(/\/+$/, "");
  return /^\/previews\/(?:zao|zhong|wan|kdp-\d{4}-(?:zao|zhong|wan))$/i.test(pathname);
}

function isLocalPreviewHost(host: string): boolean {
  const name = host.toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "gzh.codepi.app";
}

/** 真稿预览：gzh-preview、站外 https/http，或非 /previews/ 演示路径。 */
export function isRealPreviewPath(path: string | null | undefined): boolean {
  if (!path?.trim()) return false;
  const raw = path.trim();
  if (/gzh-preview/i.test(raw)) return true;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (!isLocalPreviewHost(url.hostname)) return true;
      return !isDemoPreviewPath(url.pathname);
    } catch {
      return true;
    }
  }

  return !isDemoPreviewPath(raw);
}

export function shouldClearDemo(input: {
  isDemo: boolean;
  title?: string | null;
  previewPath?: string | null;
  markOfficial?: boolean;
  nextSlug?: string | null;
}): boolean {
  if (!input.isDemo) return false;
  if (input.markOfficial) return true;
  if (input.nextSlug && !isDemoSlug(input.nextSlug)) return true;
  if (isRealPreviewPath(input.previewPath)) return true;
  if (input.title && !isDemoTitle(input.title)) return true;
  return false;
}

function skipKey(date: string): string {
  return `skip_auto_demo:${date}`;
}

export function demoPreviewPath(slot: Slot): string {
  return `/previews/${SLOT_CODE[slot]}/`;
}

export function slotCode(slot: Slot): string {
  return SLOT_CODE[slot];
}

export async function ensureTodayDemo(
  env: Env,
  date: string,
  now = new Date(),
): Promise<boolean> {
  if (date !== shanghaiDate(now)) return false;

  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM posts WHERE publish_date = ?`,
  )
    .bind(date)
    .first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) {
    const seen = await env.DB.prepare(`SELECT value FROM desk_meta WHERE key = ?`)
      .bind(skipKey(date))
      .first<{ value: string }>();
    if (!seen) await markSkipAutoDemo(env, date, now);
    return false;
  }

  const skipped = await env.DB.prepare(`SELECT value FROM desk_meta WHERE key = ?`)
    .bind(skipKey(date))
    .first<{ value: string }>();
  if (skipped) return false;

  const account = await env.DB.prepare(
    `SELECT id FROM accounts WHERE id = 'acc_owner_kdp' OR email = 'codepi@example.invalid' LIMIT 1`,
  ).first<{ id: string }>();
  if (!account) return false;

  const stamp = nowIso(now);
  const statements = DEMO_SPECS.map((spec) =>
    env.DB.prepare(
      `INSERT INTO posts (id, account_id, title, slot, publish_date, status, preview_path, note, digest, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      demoSlug(date, spec.slot),
      account.id,
      spec.title,
      spec.slot,
      date,
      spec.status,
      demoPreviewPath(spec.slot),
      spec.note,
      spec.digest,
      stamp,
      stamp,
    ),
  );

  statements.push(
    env.DB.prepare(`INSERT OR REPLACE INTO desk_meta (key, value, updated_at) VALUES (?, ?, ?)`).bind(
      skipKey(date),
      "seeded",
      stamp,
    ),
  );

  await env.DB.batch(statements);
  return true;
}

export async function markSkipAutoDemo(env: Env, date: string, now = new Date()): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO desk_meta (key, value, updated_at) VALUES (?, ?, ?)`).bind(
    skipKey(date),
    "released",
    nowIso(now),
  ).run();
}
