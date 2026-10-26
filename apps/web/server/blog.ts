import { Marked, Renderer, type Tokens } from "marked";
import type { SourceSummary } from "@kedoupi/shared/mcp/contract";
import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import { getMedia, mediaId, mediaUrl, type MediaEnv, type Media } from "./media";

export interface BlogEnv extends MediaEnv {}
type Content = { slug: string; title: string; summary: string; tag: string | null; body_markdown: string; body_html: string; cover_media_id: string | null; media_ids: string; revision: number; published_at: string | null; updated_at: string };
export type Draft = Content & { status: string; client_id: string; client_name: string | null; last_request_id: string | null; review_note: string | null; submitted_at: string };
export type Post = Content & { published_at: string };
const RESERVED = new Set(["api", "desk", "blog", "preview", "media", "sitemap-blog.xml"]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const encoder = new TextEncoder();
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
export function validateSlug(slug: unknown): slug is string { return typeof slug === "string" && SLUG.test(slug) && !RESERVED.has(slug); }
function invalid(message = "invalid_arguments"): Error { return new Error(message); }
function now() { return new Date().toISOString(); }
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!));

export async function renderMarkdown(body: string, media: Map<string, Media> = new Map()): Promise<string> {
  const markdown = new Marked({ gfm: true });
  markdown.use({ renderer: {
    html() { return ""; },
    link({ href, title, tokens }) {
      if (!/^(?:https?:\/\/|mailto:|\/[^/]|#)/i.test(href) || /[\x00-\x20\\]/.test(href)) throw invalid("unsafe_content");
      return `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ""} rel="noopener noreferrer">${this.parser.parseInline(tokens)}</a>`;
    },
    image({ href, title, text: alt }) {
      const id = mediaId(href), image = id ? media.get(id) : null;
      if (!image) throw invalid("unknown_media");
      return `<img src="${mediaUrl(image.id)}" alt="${escape(alt || image.alt)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"${title ? ` title="${escape(title)}"` : ""}>`;
    },
    paragraph({ tokens }) {
      if (tokens.length === 1 && tokens[0].type === "image") {
        const image = tokens[0] as Tokens.Image;
        return `<figure>${this.image(image)}${image.title ? `<figcaption>${escape(image.title)}</figcaption>` : ""}</figure>\n`;
      }
      return `<p>${this.parser.parseInline(tokens)}</p>\n`;
    },
    table(token) { return `<div class="blog-table-scroll" tabindex="0" role="region" aria-label="表格">${Renderer.prototype.table.call(this, token)}</div>`; },
  } });
  try { return await markdown.parse(body); }
  catch (error) {
    // Marked adds its bug-report suffix to renderer errors. Preserve domain errors.
    const message = error instanceof Error ? error.message.split("\n")[0] : "";
    if (["unsafe_content","unknown_media"].includes(message)) throw invalid(message);
    throw error;
  }
}
async function prepareContent(env: BlogEnv, body: string, cover: unknown) {
  if (cover !== undefined && cover !== null && typeof cover !== "string") throw invalid();
  const ids = new Set<string>();
  if (typeof cover === "string") { const id = mediaId(mediaUrl(cover)); if (!id) throw invalid("unknown_media"); ids.add(id); }
  const markdown = new Marked();
  markdown.walkTokens(markdown.lexer(body), token => {
    if (token.type === "image") { const id = mediaId(token.href); if (!id) throw invalid("unknown_media"); ids.add(id); }
  });
  if (ids.size > 30) throw invalid("too_many_images");
  const media = new Map<string,Media>();
  for (const id of ids) { const image = await getMedia(env,id); if (!image) throw invalid("unknown_media"); media.set(id,image); }
  return { html:await renderMarkdown(body,media), ids:[...ids] };
}
function row<T>(result: D1Result<T>): T | null { return result.results[0] ?? null; }

export async function submitDraft(db: D1Database, input: Record<string, unknown>, env?: BlogEnv) {
  const { slug, title, summary, tag, body_markdown: body, base_revision: baseRevision } = input;
  const requestId = input.request_id === undefined || input.request_id === null ? crypto.randomUUID() : input.request_id;
  if (!validateSlug(slug) || !text(title,200) || !title.trim() || !text(summary,500) || !summary.trim() || typeof body !== "string" || !body.trim() || !text(requestId,100) || !requestId || (tag !== undefined && tag !== null && !text(tag,40)) || (baseRevision !== undefined && (!Number.isSafeInteger(baseRevision) || Number(baseRevision)<0))) throw invalid();
  if (encoder.encode(body).byteLength > MCP_LIMITS.blogBody) throw invalid("payload_too_large");
  const existing = await getDraft(db,slug);
  if (existing?.last_request_id === requestId) return { slug, revision:existing.revision, status:existing.status, submitted_at:existing.submitted_at,preview_url:`https://codepi.app/blog/preview/${slug}/`,review_url:"https://codepi.app/desk/" };
  if (baseRevision !== undefined && (existing?.revision ?? 0) !== baseRevision) throw invalid("revision_conflict");
  // Existing callers without images remain supported; all media is resolved in the domain Worker.
  const content = env ? await prepareContent(env,body,input.cover_media_id) : { html:await renderMarkdown(body), ids:[] };
  const timestamp = now(), revision = (existing?.revision ?? 0)+1;
  const clientId = text(input.client_id,200) ? input.client_id : "mcp", clientName = text(input.client_name,200) ? input.client_name : null;
  const result = await db.prepare(`INSERT INTO blog_drafts (slug,title,summary,tag,body_markdown,body_html,status,client_id,client_name,revision,last_request_id,review_note,published_at,submitted_at,updated_at,cover_media_id,media_ids)
    VALUES (?,?,?,?,?,?,'pending',?,?,?,?,NULL,NULL,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,summary=excluded.summary,tag=excluded.tag,body_markdown=excluded.body_markdown,body_html=excluded.body_html,status='pending',client_id=excluded.client_id,client_name=excluded.client_name,revision=excluded.revision,last_request_id=excluded.last_request_id,review_note=NULL,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,cover_media_id=excluded.cover_media_id,media_ids=excluded.media_ids
    WHERE blog_drafts.revision=? AND blog_drafts.status=?`)
    .bind(slug,title,summary,tag ?? null,body,content.html,clientId,clientName,revision,requestId,timestamp,timestamp,input.cover_media_id ?? null,JSON.stringify(content.ids),existing?.revision ?? 0,existing?.status ?? "pending").run();
  if (!result.meta.changes) throw invalid("revision_conflict");
  return { slug,revision,status:"pending",submitted_at:timestamp,preview_url:`https://codepi.app/blog/preview/${slug}/`,review_url:"https://codepi.app/desk/" };
}
export async function retractDraft(db: D1Database, slug: string) {
  const result = await db.prepare("UPDATE blog_drafts SET status='withdrawn',updated_at=? WHERE slug=? AND status='pending'").bind(now(),slug).run();
  if (!result.meta.changes) throw invalid("not_found");
  return {slug,status:"withdrawn"};
}
export async function listPublished(db: D1Database, offset=0, limit=20) {
  const total = await db.prepare("SELECT COUNT(*) AS count FROM blog_posts").first<number>("count") ?? 0;
  const posts = (await db.prepare("SELECT slug,title,summary,tag,cover_media_id,revision,published_at,updated_at FROM blog_posts ORDER BY published_at DESC,slug LIMIT ? OFFSET ?").bind(limit,offset).all<Post>()).results;
  return { posts,total,next_offset:offset+posts.length<total ? offset+posts.length : null };
}
export async function listSubmissions(db: D1Database, offset=0, limit=20, status?: string) {
  if (status && !["pending","rejected","published","withdrawn"].includes(status)) throw invalid();
  const where = status ? " WHERE status=?" : "", values = status ? [status] : [];
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM blog_drafts${where}`).bind(...values).first<number>("n") ?? 0;
  const drafts = (await db.prepare(`SELECT slug,title,summary,tag,status,revision,review_note,submitted_at,updated_at FROM blog_drafts${where} ORDER BY updated_at DESC,slug LIMIT ? OFFSET ?`).bind(...values,limit,offset).all()).results;
  return {drafts,total,next_offset:offset+drafts.length<total ? offset+drafts.length : null};
}
export async function getDraft(db: D1Database, slug: string) { return row(await db.prepare("SELECT * FROM blog_drafts WHERE slug=?").bind(slug).all<Draft>()); }
export async function listDrafts(db: D1Database) { return (await db.prepare("SELECT * FROM blog_drafts WHERE status IN ('pending','rejected') ORDER BY updated_at DESC").all<Draft>()).results; }
export async function getPost(db: D1Database, slug: string) { return row(await db.prepare("SELECT * FROM blog_posts WHERE slug=?").bind(slug).all<Post>()); }
export async function publishDraft(db: D1Database, slug: string, origin?: string, expectedRevision?: number) {
  const draft = await getDraft(db,slug); if (!draft || draft.status !== "pending") throw invalid("not_found");
  if (expectedRevision !== undefined && expectedRevision !== draft.revision) throw invalid("revision_conflict");
  const at = now();
  const [postResult] = await db.batch([
    db.prepare(`INSERT INTO blog_posts (slug,title,summary,tag,body_html,body_markdown,cover_media_id,media_ids,revision,published_at,updated_at)
      SELECT slug,title,summary,tag,body_html,body_markdown,cover_media_id,media_ids,revision,?,? FROM blog_drafts WHERE slug=? AND status='pending' AND revision=?
      ON CONFLICT(slug) DO UPDATE SET title=excluded.title,summary=excluded.summary,tag=excluded.tag,body_html=excluded.body_html,body_markdown=excluded.body_markdown,cover_media_id=excluded.cover_media_id,media_ids=excluded.media_ids,revision=excluded.revision,updated_at=excluded.updated_at`).bind(at,at,slug,draft.revision),
    db.prepare("UPDATE blog_drafts SET status='published',published_at=?,updated_at=? WHERE slug=? AND status='pending' AND revision=?").bind(at,at,slug,draft.revision),
  ]);
  if (!postResult.meta.changes) throw invalid("revision_conflict");
  await purgeBlogCaches(slug,origin);
  return {slug,status:"published",revision:draft.revision,published_at:at};
}
export async function rejectDraft(db: D1Database, slug: string, note?: string, expectedRevision?: number) {
  if (note !== undefined && !text(note,1000)) throw invalid();
  const draft = await getDraft(db,slug); if (!draft || draft.status !== "pending") throw invalid("not_found");
  if (expectedRevision !== undefined && expectedRevision !== draft.revision) throw invalid("revision_conflict");
  const result = await db.prepare("UPDATE blog_drafts SET status='rejected',review_note=?,updated_at=? WHERE slug=? AND status='pending' AND revision=?").bind(note ?? null,now(),slug,draft.revision).run();
  if (!result.meta.changes) throw invalid("revision_conflict");
  return {slug,status:"rejected"};
}
export async function unpublishPost(db: D1Database, slug: string, origin?: string) {
  const [result] = await db.batch([db.prepare("DELETE FROM blog_posts WHERE slug=?").bind(slug),db.prepare("UPDATE blog_drafts SET status='pending',updated_at=? WHERE slug=? AND status='published'").bind(now(),slug)]);
  if (!result.meta.changes) throw invalid("not_found");
  await purgeBlogCaches(slug,origin); return {slug,status:"unpublished"};
}
export async function purgeBlogCaches(slug?: string, origin="https://codepi.app") {
  try { const cache=caches.default; await cache.delete(new Request(`${origin}/blog/`)); if (slug) await cache.delete(new Request(`${origin}/blog/${slug}/`)); } catch { /* best effort */ }
}
export async function blogSummary(db: D1Database): Promise<SourceSummary> {
  const published=await db.prepare("SELECT COUNT(*) AS count FROM blog_posts").first<number>("count") ?? 0;
  const pending=await db.prepare("SELECT COUNT(*) AS count FROM blog_drafts WHERE status='pending'").first<number>("count") ?? 0;
  return {source:"blog",status:"ok",stale:false,asOf:null,updatedAt:null,metrics:[{label:"已发布",value:String(published)},{label:"待审核",value:String(pending)}],facts:[],notes:[],attention:pending ? [{label:`${pending} 篇博客草稿待审核`,href:"https://codepi.app/desk/"}] : []};
}
