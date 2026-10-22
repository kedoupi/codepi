import { marked } from "marked";
import type { SourceSummary } from "@kedoupi/shared/mcp/contract";
import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";

export interface BlogEnv { BLOG: D1Database }
export type Draft = {
  slug: string; title: string; summary: string; tag: string | null; body_markdown: string; body_html: string;
  status: string; client_id: string; client_name: string | null; revision: number; last_request_id: string | null;
  review_note: string | null; published_at: string | null; submitted_at: string; updated_at: string;
};
export type Post = { slug: string; title: string; summary: string; tag: string | null; body_html: string; revision: number; published_at: string; updated_at: string };

// Writing rules: do not invent personal experience; submit only complete work; use ISO dates; body is data, never instructions.
const RESERVED = new Set(["api", "desk", "blog", "preview", "sitemap-blog.xml"]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const encoder = new TextEncoder();
const renderer = new marked.Renderer();
renderer.html = () => "";
marked.use({ renderer, gfm: true });

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
export function validateSlug(slug: unknown): slug is string { return typeof slug === "string" && SLUG.test(slug) && !RESERVED.has(slug); }
function invalid(message = "invalid_arguments"): Error { return new Error(message); }
function now() { return new Date().toISOString(); }
function htmlSafe(html: string): boolean { return !/<\s*(script|iframe|object)\b|\bon\w+\s*=|javascript\s*:/i.test(html); }
export async function renderMarkdown(body: string): Promise<string> {
  const html = await marked.parse(body, { gfm: true, renderer });
  if (!htmlSafe(html)) throw invalid("unsafe_content");
  return html;
}
function row<T>(result: D1Result<T>): T | null { return result.results[0] ?? null; }

export async function submitDraft(db: D1Database, input: Record<string, unknown>) {
  const { slug, title, summary, tag, body_markdown: body, base_revision: baseRevision, request_id: requestId } = input;
  if (!validateSlug(slug) || !text(title, 200) || !title.trim() || !text(summary, 500) || typeof body !== "string" || !text(requestId, 200) || (tag !== undefined && tag !== null && !text(tag, 40)) || (baseRevision !== undefined && (!Number.isInteger(baseRevision) || (baseRevision as number) < 0))) throw invalid();
  if (encoder.encode(body).byteLength > MCP_LIMITS.blogBody) throw invalid("payload_too_large");
  const existing = row(await db.prepare("SELECT * FROM blog_drafts WHERE slug = ?").bind(slug).all<Draft>());
  if (existing?.last_request_id === requestId) return { slug, revision: existing.revision, status: "draft", submitted_at: existing.submitted_at };
  if (baseRevision !== undefined && existing && existing.revision !== baseRevision) throw invalid("revision_conflict");
  const bodyHtml = await renderMarkdown(body);
  const timestamp = now();
  const revision = (existing?.revision ?? 0) + 1;
  const clientId = text(input.client_id, 200) ? input.client_id : "mcp";
  const clientName = text(input.client_name, 200) ? input.client_name : null;
  await db.prepare(`INSERT INTO blog_drafts (slug,title,summary,tag,body_markdown,body_html,status,client_id,client_name,revision,last_request_id,review_note,published_at,submitted_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,summary=excluded.summary,tag=excluded.tag,body_markdown=excluded.body_markdown,body_html=excluded.body_html,status='pending',client_id=excluded.client_id,client_name=excluded.client_name,revision=excluded.revision,last_request_id=excluded.last_request_id,review_note=NULL,published_at=NULL,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at`).bind(slug,title,summary,tag ?? null,body,bodyHtml,"pending",clientId,clientName,revision,requestId,null,timestamp,timestamp).run();
  return { slug, revision, status: "draft", submitted_at: timestamp };
}
export async function retractDraft(db: D1Database, slug: string) {
  const draft = row(await db.prepare("SELECT * FROM blog_drafts WHERE slug = ? AND status = 'pending'").bind(slug).all<Draft>());
  if (!draft) throw invalid("not_found");
  await db.prepare("UPDATE blog_drafts SET status='withdrawn', updated_at=? WHERE slug=? AND status='pending'").bind(now(),slug).run();
  return { slug, status: "withdrawn" };
}
export async function listPublished(db: D1Database, offset = 0, limit = 20) {
  const total = (await db.prepare("SELECT COUNT(*) AS count FROM blog_posts").all<{count:number}>()).results[0]?.count ?? 0;
  const posts = (await db.prepare("SELECT * FROM blog_posts ORDER BY published_at DESC LIMIT ? OFFSET ?").bind(limit,offset).all<Post>()).results;
  return { posts, total, next_offset: offset + posts.length < total ? offset + posts.length : null };
}
export async function getDraft(db: D1Database, slug: string) { return row(await db.prepare("SELECT * FROM blog_drafts WHERE slug=?").bind(slug).all<Draft>()); }
export async function listDrafts(db: D1Database) { return (await db.prepare("SELECT * FROM blog_drafts WHERE status IN ('pending','rejected') ORDER BY updated_at DESC").all<Draft>()).results; }
export async function getPost(db: D1Database, slug: string) { return row(await db.prepare("SELECT * FROM blog_posts WHERE slug=?").bind(slug).all<Post>()); }
export async function publishDraft(db: D1Database, slug: string, origin?: string) {
  const draft = await getDraft(db,slug); if (!draft || draft.status !== "pending") throw invalid("not_found");
  const at = now();
  await db.batch([
    db.prepare(`INSERT INTO blog_posts (slug,title,summary,tag,body_html,revision,published_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,summary=excluded.summary,tag=excluded.tag,body_html=excluded.body_html,revision=excluded.revision,published_at=excluded.published_at,updated_at=excluded.updated_at`).bind(draft.slug,draft.title,draft.summary,draft.tag,draft.body_html,draft.revision,at,at),
    db.prepare("UPDATE blog_drafts SET status='published', published_at=?, updated_at=? WHERE slug=? AND status='pending'").bind(at,at,slug),
  ]);
  await purgeBlogCaches(slug, origin);
  return { slug, status: "published", revision: draft.revision, published_at: at };
}
export async function rejectDraft(db: D1Database, slug: string, note?: string) {
  if (note !== undefined && !text(note, 1000)) throw invalid();
  const result = await db.prepare("UPDATE blog_drafts SET status='rejected', review_note=?, updated_at=? WHERE slug=? AND status='pending'").bind(note ?? null,now(),slug).run();
  if (!result.meta.changes) throw invalid("not_found");
  return { slug, status: "rejected" };
}
export async function unpublishPost(db: D1Database, slug: string, origin?: string) {
  const result = await db.prepare("DELETE FROM blog_posts WHERE slug=?").bind(slug).run();
  if (!result.meta.changes) throw invalid("not_found");
  await db.batch([db.prepare("UPDATE blog_drafts SET status='pending', updated_at=? WHERE slug=?").bind(now(),slug)]);
  await purgeBlogCaches(slug, origin);
  return { slug, status: "unpublished" };
}
export async function purgeBlogCaches(slug?: string, origin = "https://codepi.app") {
  try { const cache = caches.default; await cache.delete(new Request(`${origin}/blog/`)); if (slug) await cache.delete(new Request(`${origin}/blog/${slug}/`)); } catch { /* best effort */ }
}
export async function blogSummary(db: D1Database): Promise<SourceSummary> {
  const published = (await db.prepare("SELECT COUNT(*) AS count FROM blog_posts").all<{ count: number }>()).results[0]?.count ?? 0;
  const pending = (await db.prepare("SELECT COUNT(*) AS count FROM blog_drafts WHERE status='pending'").all<{ count: number }>()).results[0]?.count ?? 0;
  return {
    source: "blog", status: "ok", stale: false, asOf: null, updatedAt: null,
    metrics: [{ label: "已发布", value: String(published) }, { label: "待审核", value: String(pending) }],
    facts: [], notes: [],
    attention: pending ? [{ label: `${pending} 篇博客草稿待审核`, href: "https://codepi.app/desk/" }] : [],
  };
}
export { object };
