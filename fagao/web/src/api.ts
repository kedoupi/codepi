export interface Account {
  email: string;
  role: "owner" | "editor" | "reviewer";
  display_name?: string;
  brand: string;
}

export interface BoardPost {
  slug: string;
  title: string;
  slot: "早" | "中" | "晚" | null;
  publish_date: string;
  status: "draft" | "待审" | "需改" | "可推箱" | "已进箱" | "弃用";
  preview_path: string | null;
  note: string | null;
  digest: string | null;
  last_review: { action: string; note: string | null; created_at: string } | null;
  is_demo: boolean;
  can_withdraw: boolean;
}

export interface SlotRow {
  slot: "早" | "中" | "晚";
  post: BoardPost | null;
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `请求失败 ${res.status}`);
  }
  return data;
}

export async function requestOtp(email: string) {
  return parse<{ ok: boolean; message: string; dev_otp?: string }>(
    await fetch("/api/auth/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
}

export async function verifyOtp(email: string, code: string) {
  return parse<{ ok: boolean; account: Account }>(
    await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    }),
  );
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function me() {
  const res = await fetch("/api/me");
  if (res.status === 401) return null;
  const data = await parse<{ ok: boolean; account: Account }>(res);
  return data.account;
}

export interface BoardData {
  ok: boolean;
  date: string;
  today: string;
  brand: string;
  slots: SlotRow[];
  queue: BoardPost[];
}

export async function board(date: string) {
  return parse<BoardData>(await fetch(`/api/board?date=${encodeURIComponent(date)}`));
}

export async function getPost(slug: string) {
  return parse<{ ok: boolean; post: BoardPost; brand: string }>(
    await fetch(`/api/posts/${encodeURIComponent(slug)}`),
  );
}

export async function upsertPost(body: {
  slug: string;
  from_slug?: string;
  new_slug?: string;
  title: string;
  slot: "早" | "中" | "晚";
  publish_date: string;
  preview_path: string;
  note?: string;
  digest?: string;
  submit: boolean;
  mark_official?: boolean;
}) {
  return parse<{ ok: boolean; post: BoardPost }>(
    await fetch("/api/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function patchPost(
  slug: string,
  body: {
    title?: string;
    preview_path?: string;
    note?: string;
    digest?: string;
    new_slug?: string;
    mark_official?: boolean;
  },
) {
  return parse<{ ok: boolean; post: BoardPost }>(
    await fetch(`/api/posts/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function review(slug: string, action: "过" | "要改" | "拒", note = "") {
  return parse<{ ok: boolean; post: BoardPost }>(
    await fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, action, note }),
    }),
  );
}

export async function markBoxed(slug: string) {
  return parse<{ ok: boolean; post: BoardPost }>(
    await fetch(`/api/posts/${encodeURIComponent(slug)}/boxed`, { method: "POST" }),
  );
}

export async function withdrawPost(slug: string) {
  return parse<{ ok: boolean; post: BoardPost }>(
    await fetch(`/api/posts/${encodeURIComponent(slug)}/withdraw`, { method: "POST" }),
  );
}

export async function discardPost(slug: string, note = "") {
  return parse<{ ok: boolean; post: BoardPost }>(
    await fetch(`/api/posts/${encodeURIComponent(slug)}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note }),
    }),
  );
}

export async function releaseDemo(slug: string) {
  return parse<{ ok: boolean; released: string }>(
    await fetch(`/api/posts/${encodeURIComponent(slug)}/release-demo`, { method: "POST" }),
  );
}

export function todayShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
