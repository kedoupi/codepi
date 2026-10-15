import { assertResponseSession, expireSession, sessionFetch, SessionExpiredError } from "./session";

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
  status: "draft" | "待审" | "需改" | "可推箱" | "已进箱";
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
  assertResponseSession(res);
  const data = (await res.json()) as T & { error?: string; authenticated?: boolean };
  assertResponseSession(res);
  if (!res.ok) {
    throw new Error(data.error || `请求失败 ${res.status}`);
  }
  if (data.authenticated === false) {
    expireSession();
    throw new SessionExpiredError();
  }
  return data;
}

export async function requestOtp(email: string) {
  return parse<{ ok: boolean; message: string; dev_otp?: string }>(
    await sessionFetch("/api/auth/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
}

export async function verifyOtp(email: string, code: string) {
  return parse<{ ok: boolean; account: Account }>(
    await sessionFetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    }),
  );
}

export async function logout() {
  await parse<{ ok: boolean }>(await sessionFetch("/api/auth/logout", { method: "POST" }));
  expireSession();
}

export async function me() {
  try {
    const data = await parse<{ ok: boolean; account: Account }>(await sessionFetch("/api/me"));
    return data.account;
  } catch (error) {
    if (error instanceof SessionExpiredError) return null;
    throw error;
  }
}

export async function ssoEnabled() {
  return (await parse<{ sso_enabled: boolean }>(await sessionFetch("/api/health"))).sso_enabled === true;
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
  return parse<BoardData>(await sessionFetch(`/api/board?date=${encodeURIComponent(date)}`));
}

export async function getPost(slug: string) {
  return parse<{ ok: boolean; post: BoardPost; brand: string }>(
    await sessionFetch(`/api/posts/${encodeURIComponent(slug)}`),
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
    await sessionFetch("/api/posts", {
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
    await sessionFetch(`/api/posts/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function review(slug: string, action: "过" | "要改" | "拒", note = "") {
  return parse<{ ok: boolean; post: BoardPost }>(
    await sessionFetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, action, note }),
    }),
  );
}

export async function markBoxed(slug: string) {
  return parse<{ ok: boolean; post: BoardPost }>(
    await sessionFetch(`/api/posts/${encodeURIComponent(slug)}/boxed`, { method: "POST" }),
  );
}

export async function withdrawPost(slug: string) {
  return parse<{ ok: boolean; post: BoardPost }>(
    await sessionFetch(`/api/posts/${encodeURIComponent(slug)}/withdraw`, { method: "POST" }),
  );
}

export async function releaseDemo(slug: string) {
  return parse<{ ok: boolean; released: string }>(
    await sessionFetch(`/api/posts/${encodeURIComponent(slug)}/release-demo`, { method: "POST" }),
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
