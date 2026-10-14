import { isSlug } from "./lib";

export const MAX_HTML_CHARS = 1_000_000;
export const MAX_COVER_CHARS = 700_000;

/** 直传正文落在这个同域路径；`/cover.png` 跟在后面，前端 coverSrc 不用改。 */
export function contentPath(slug: string): string {
  return `/api/posts/${slug}/content/`;
}

export function reviewPath(slug: string): string {
  return `/p/${slug}/`;
}

export function isContentPath(path: string | null | undefined): boolean {
  return !!path && /^\/api\/posts\/[a-z0-9][a-z0-9-]{0,63}\/content\/$/.test(path);
}

export type CoverCheck = { ok: true; value: string | null } | { ok: false; error: string };

export function checkCover(raw: unknown): CoverCheck {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "cover 必须是 https 地址或 data:image" };
  const v = raw.trim();
  if (v.length > MAX_COVER_CHARS) return { ok: false, error: "封面太大（上限约 500KB）" };
  if (/^https:\/\/[^\s]+$/i.test(v)) return { ok: true, value: v };
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) return { ok: true, value: v };
  return { ok: false, error: "cover 必须是 https 地址或 data:image/(png|jpeg|webp|gif);base64" };
}

const CONTENT_CSP =
  "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:; media-src https:";

export async function serveContent(env: Env, slug: string): Promise<Response> {
  if (!isSlug(slug)) return new Response("not found", { status: 404 });
  const row = await env.DB.prepare(`SELECT html FROM posts WHERE id = ?`).bind(slug).first<{ html: string | null }>();
  if (!row?.html) return new Response("not found", { status: 404 });
  return new Response(row.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy": CONTENT_CSP,
      "x-content-type-options": "nosniff",
    },
  });
}

export async function serveCover(env: Env, slug: string): Promise<Response> {
  if (!isSlug(slug)) return new Response("not found", { status: 404 });
  const row = await env.DB.prepare(`SELECT cover FROM posts WHERE id = ?`).bind(slug).first<{ cover: string | null }>();
  const cover = row?.cover;
  if (!cover) return new Response("not found", { status: 404 });
  if (cover.startsWith("https://")) return Response.redirect(cover, 302);
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(cover);
  if (!m) return new Response("not found", { status: 404 });
  const bytes = Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: { "content-type": m[1]!, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" },
  });
}
