import { Marked, Renderer, type Tokens } from "marked";
import type { SourceSummary } from "@kedoupi/shared/mcp/contract";
import { MCP_LIMITS } from "@kedoupi/shared/mcp/contract";
import { getMedia, mediaId, mediaUrl, type MediaEnv, type Media } from "./media";

export interface BlogEnv extends MediaEnv {}
export type Source = { title: string; url: string };
type Content = { slug: string; title: string; summary: string; tag: string | null; body_markdown: string; body_html: string; cover_media_id: string | null; media_ids: string; revision: number; published_at: string | null; updated_at: string; category: string | null; tags: string; series: string | null; sources: string };
export const parseTags = (value: string | null): string[] => { try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : []; } catch { return []; } };
export const parseSources = (value: string | null): Source[] => { try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter(item => object(item) && typeof item.title === "string" && typeof item.url === "string") : []; } catch { return []; } };
// Chinese-dominant articles: roughly 400 characters per minute.
export const readingMinutes = (chars: number) => Math.max(1, Math.round(chars/400));
export type Draft = Content & { status: string; client_id: string; client_name: string | null; last_request_id: string | null; review_note: string | null; submitted_at: string; is_test: number; archived_at: string | null };
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
// CommonMark treats punctuation directly before a closing delimiter as right-flanking,
// so `**标签：**正文` stays literal. Move that final punctuation outside the delimiter.
const flankingPunctuation = /\*\*([^\*\n：，。、；！？:,.!?）)”"'—\\/-]+)([：，。、；！？:,.!?）)”"'—\\/-])\*\*/gu;
type RepairToken = { type?: string; raw?: string; text?: string; tokens?: RepairToken[]; items?: RepairToken[]; rows?: RepairToken[][]; header?: RepairToken[] };
function repairMarkdown(body: string): string {
  const markdown = new Marked({ gfm: true });
  const ranges: Array<[number, number, string]> = [];
  const visit = (tokens: RepairToken[] | undefined, bounds: [number, number]) => {
    let cursor = bounds[0];
    for (const token of tokens ?? []) {
      const raw = typeof token.raw === "string" ? token.raw : token.type === "text" && typeof token.text === "string" ? token.text : "";
      const start = raw ? body.indexOf(raw, cursor) : -1;
      const located = start >= cursor && start + raw.length <= bounds[1];
      const tokenBounds: [number, number] = located ? [start, start + raw.length] : bounds;
      if (Array.isArray(token.tokens)) visit(token.tokens, tokenBounds);
      else if (located && token.type === "text") {
        for (const match of raw.matchAll(flankingPunctuation)) ranges.push([start + match.index, start + match.index + match[0].length, `**${match[1]}**${match[2]}`]);
      }
      for (const item of token.items ?? []) visit(item.tokens, tokenBounds);
      for (const row of token.rows ?? []) visit(row, tokenBounds);
      if (Array.isArray(token.header)) visit(token.header, tokenBounds);
      if (located && typeof token.raw === "string") cursor = tokenBounds[1];
    }
  };
  visit(markdown.lexer(body) as RepairToken[], [0, body.length]);
  const unique = [...new Map(ranges.map(range => [`${range[0]}:${range[1]}`, range])).values()];
  return unique.sort((a, b) => b[0] - a[0]).reduce((text, [start, end, value]) => text.slice(0, start) + value + text.slice(end), body);
}

export async function renderMarkdown(body: string, media: Map<string, Media> = new Map()): Promise<string> {
  const markdown = new Marked({ gfm: true });
  let headings = 0;
  markdown.use({ renderer: {
    html() { return ""; },
    heading({ tokens, depth }) { return `<h${depth} id="h-${++headings}">${this.parser.parseInline(tokens)}</h${depth}>\n`; },
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
  try { return await markdown.parse(repairMarkdown(body)); }
  catch (error) {
    // Marked adds its bug-report suffix to renderer errors. Preserve domain errors.
    const message = error instanceof Error ? error.message.split("\n")[0] : "";
    if (["unsafe_content","unknown_media"].includes(message)) throw invalid(message);
    throw error;
  }
}
async function coverWarnings(env: BlogEnv, cover: string | null): Promise<string[]> {
  const id = cover ? mediaId(mediaUrl(cover)) : null;
  const image = id ? await getMedia(env,id) : null;
  if (!image) return ["缺少头图：每篇文章必须有 2.35:1 的头图（建议 1800×766 或更大）。"];
  const warnings: string[] = [];
  const ratio = image.width/image.height;
  if (ratio < 2.2 || ratio > 2.5) warnings.push(`头图比例建议 2.35:1（如 1800×766），当前为 ${image.width}×${image.height}，列表与分享时可能裁切。`);
  if (image.width < 1800) warnings.push(`头图宽度建议至少 1800 像素，当前为 ${image.width} 像素。`);
  return warnings;
}
async function prepareContent(env: BlogEnv, body: string, cover: unknown) {
  if (typeof cover !== "string" || !cover) throw invalid("cover_required");
  const ids = new Set<string>();
  const id = mediaId(mediaUrl(cover)); if (!id) throw invalid("unknown_media"); ids.add(id);
  const markdown = new Marked();
  markdown.walkTokens(markdown.lexer(body), token => {
    if (token.type === "image") { const id = mediaId(token.href); if (!id) throw invalid("unknown_media"); ids.add(id); }
  });
  if (ids.size > 30) throw invalid("too_many_images");
  const media = new Map<string,Media>();
  for (const id of ids) { const image = await getMedia(env,id); if (!image) throw invalid("unknown_media"); media.set(id,image); }
  return { html:await renderMarkdown(body,media), ids:[...ids], warnings:await coverWarnings(env,cover) };
}
function row<T>(result: D1Result<T>): T | null { return result.results[0] ?? null; }
const validTags = (value: unknown): value is string[] => Array.isArray(value) && value.length >= 1 && value.length <= 5 && value.every(item => text(item,40) && item.trim().length > 0) && new Set(value).size === value.length;
const validSources = (value: unknown): value is Source[] => Array.isArray(value) && value.length <= 10 && value.every(item => object(item) && text(item.title,200) && item.title.trim().length > 0 && typeof item.url === "string" && item.url.length <= 500 && /^https:\/\/[^\s/]+\.[^\s/]+/.test(item.url));
async function assertCategory(db: D1Database, category: unknown): Promise<string> {
  if (!text(category,40) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(category)) throw invalid();
  if (!await db.prepare("SELECT slug FROM blog_categories WHERE slug=?").bind(category).first()) throw invalid("unknown_category");
  return category;
}
export async function listCategories(db: D1Database) {
  return (await db.prepare("SELECT slug,name,(SELECT COUNT(*) FROM blog_posts WHERE blog_posts.category=blog_categories.slug) AS published FROM blog_categories ORDER BY rowid").all<{slug:string;name:string;published:number}>()).results;
}
export async function addCategory(db: D1Database, slug: unknown, name: unknown) {
  if (!text(slug,40) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug) || !text(name,20) || !name.trim()) throw invalid();
  if ((await db.prepare("SELECT COUNT(*) AS n FROM blog_categories").first<number>("n") ?? 0) >= 8) throw invalid("category_limit");
  await db.prepare("INSERT INTO blog_categories (slug,name,created_at) VALUES (?,?,?)").bind(slug,name.trim(),now()).run();
  return {slug,name:name.trim()};
}
export async function removeCategory(db: D1Database, slug: string) {
  const used = await db.prepare("SELECT (SELECT COUNT(*) FROM blog_drafts WHERE category=?) + (SELECT COUNT(*) FROM blog_posts WHERE category=?) AS n").bind(slug,slug).first<number>("n") ?? 0;
  if (used) throw invalid("category_in_use");
  const result = await db.prepare("DELETE FROM blog_categories WHERE slug=?").bind(slug).run();
  if (!result.meta.changes) throw invalid("not_found");
  return {slug,status:"removed"};
}

export async function submitDraft(db: D1Database, input: Record<string, unknown>, env?: BlogEnv) {
  const { slug, title, summary, tag, body_markdown: body, base_revision: baseRevision } = input;
  const requestId = input.request_id === undefined || input.request_id === null ? crypto.randomUUID() : input.request_id;
  const isTest = input.is_test === true;
  const tags = input.tags === undefined && text(tag,40) && tag.trim() ? [tag] : input.tags;
  const sources = input.sources ?? [];
  if (!validateSlug(slug) || !text(title,200) || !title.trim() || !text(summary,500) || !summary.trim() || typeof body !== "string" || !body.trim() || !text(requestId,100) || !requestId || (tag !== undefined && tag !== null && !text(tag,40)) || (baseRevision !== undefined && (!Number.isSafeInteger(baseRevision) || Number(baseRevision)<0)) || (input.is_test !== undefined && typeof input.is_test !== "boolean")) throw invalid();
  if (!validTags(tags) || !validSources(sources) || (input.series !== undefined && input.series !== null && (!text(input.series,40) || !input.series.trim()))) throw invalid();
  const category = await assertCategory(db,input.category);
  if (encoder.encode(body).byteLength > MCP_LIMITS.blogBody) throw invalid("payload_too_large");
  const existing = await getDraft(db,slug);
  if (existing?.last_request_id === requestId) return { slug, revision:existing.revision, status:existing.status, submitted_at:existing.submitted_at,preview_url:`https://codepi.app/blog/preview/${slug}/`,review_url:"https://codepi.app/desk/",warnings:env ? await coverWarnings(env,existing.cover_media_id) : [] };
  // A new article may omit the revision; every update must name the revision it read.
  if (existing ? baseRevision !== existing.revision : baseRevision !== undefined && baseRevision !== 0) throw invalid("revision_conflict");
  // All media is resolved in the domain Worker; every submission requires a cover image.
  const content = env ? await prepareContent(env,body,input.cover_media_id) : { html:await renderMarkdown(body), ids:[], warnings:[] as string[] };
  const timestamp = now(), revision = (existing?.revision ?? 0)+1;
  const clientId = text(input.client_id,200) ? input.client_id : "mcp", clientName = text(input.client_name,200) ? input.client_name : null;
  const [result] = await db.batch([
    db.prepare(`INSERT INTO blog_drafts (slug,title,summary,tag,body_markdown,body_html,status,client_id,client_name,revision,last_request_id,review_note,published_at,submitted_at,updated_at,cover_media_id,media_ids,is_test,archived_at,category,tags,series,sources)
    VALUES (?,?,?,?,?,?,'pending',?,?,?,?,NULL,NULL,?,?,?,?,?,NULL,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,summary=excluded.summary,tag=excluded.tag,body_markdown=excluded.body_markdown,body_html=excluded.body_html,status='pending',client_id=excluded.client_id,client_name=excluded.client_name,revision=excluded.revision,last_request_id=excluded.last_request_id,review_note=NULL,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,cover_media_id=excluded.cover_media_id,media_ids=excluded.media_ids,is_test=excluded.is_test,archived_at=NULL,category=excluded.category,tags=excluded.tags,series=excluded.series,sources=excluded.sources
    WHERE blog_drafts.revision=? AND blog_drafts.status=?`)
    .bind(slug,title,summary,tag ?? null,body,content.html,clientId,clientName,revision,requestId,timestamp,timestamp,input.cover_media_id ?? null,JSON.stringify(content.ids),isTest ? 1 : 0,category,JSON.stringify(tags),input.series ?? null,JSON.stringify(sources),existing?.revision ?? 0,existing?.status ?? "pending"),
    db.prepare(`INSERT INTO blog_revisions (slug,revision,title,summary,body_markdown,submitted_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM blog_drafts WHERE slug=? AND revision=? AND status='pending')
      ON CONFLICT(slug,revision) DO NOTHING`).bind(slug,revision,title,summary,body,timestamp,slug,revision),
  ]);
  if (!result.meta.changes) throw invalid("revision_conflict");
  return { slug,revision,status:"pending",submitted_at:timestamp,preview_url:`https://codepi.app/blog/preview/${slug}/`,review_url:"https://codepi.app/desk/",warnings:content.warnings };
}
export async function reviseDraft(db: D1Database, env: BlogEnv, slug: string, input: Record<string, unknown>, expectedRevision?: number) {
  const draft = await getDraft(db,slug); if (!draft || draft.status !== "pending") throw invalid("not_found");
  if (draft.archived_at) throw invalid("archived");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== draft.revision) throw invalid("revision_conflict");
  const title = input.title ?? draft.title, summary = input.summary ?? draft.summary, body = input.body_markdown ?? draft.body_markdown;
  if (!text(title,200) || !title.trim() || !text(summary,500) || !summary.trim() || typeof body !== "string" || !body.trim()) throw invalid();
  if (encoder.encode(body).byteLength > MCP_LIMITS.blogBody) throw invalid("payload_too_large");
  const content = await prepareContent(env,body,draft.cover_media_id);
  const timestamp = now(), revision = draft.revision+1;
  const [result] = await db.batch([
    db.prepare("UPDATE blog_drafts SET title=?,summary=?,body_markdown=?,body_html=?,media_ids=?,revision=?,submitted_at=?,updated_at=? WHERE slug=? AND status='pending' AND revision=?")
      .bind(title,summary,body,content.html,JSON.stringify(content.ids),revision,timestamp,timestamp,slug,expectedRevision),
    db.prepare(`INSERT INTO blog_revisions (slug,revision,title,summary,body_markdown,submitted_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM blog_drafts WHERE slug=? AND revision=? AND status='pending')
      ON CONFLICT(slug,revision) DO NOTHING`).bind(slug,revision,title,summary,body,timestamp,slug,revision),
  ]);
  if (!result.meta.changes) throw invalid("revision_conflict");
  return {slug,revision,status:"pending",submitted_at:timestamp,warnings:content.warnings};
}
export async function getRevision(db: D1Database, slug: string, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw invalid();
  return db.prepare("SELECT slug,revision,title,summary,body_markdown,submitted_at FROM blog_revisions WHERE slug=? AND revision=?").bind(slug,revision).first();
}
export async function retractDraft(db: D1Database, slug: string) {
  const result = await db.prepare("UPDATE blog_drafts SET status='withdrawn',updated_at=? WHERE slug=? AND status='pending'").bind(now(),slug).run();
  if (!result.meta.changes) throw invalid("not_found");
  return {slug,status:"withdrawn"};
}
export async function listPublished(db: D1Database, offset=0, limit=20, filter: {category?: string; tag?: string; series?: string} = {}) {
  const clauses: string[] = [], values: string[] = [];
  if (filter.category) { clauses.push("category=?"); values.push(filter.category); }
  if (filter.tag) { clauses.push("EXISTS (SELECT 1 FROM json_each(blog_posts.tags) WHERE json_each.value=?)"); values.push(filter.tag); }
  if (filter.series) { clauses.push("series=?"); values.push(filter.series); }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const total = await db.prepare(`SELECT COUNT(*) AS count FROM blog_posts${where}`).bind(...values).first<number>("count") ?? 0;
  const posts = (await db.prepare(`SELECT slug,title,summary,tag,category,tags,series,cover_media_id,revision,published_at,updated_at,length(body_markdown) AS body_chars FROM blog_posts${where} ORDER BY published_at DESC,slug LIMIT ? OFFSET ?`).bind(...values,limit,offset).all<Post>()).results;
  return { posts,total,next_offset:offset+posts.length<total ? offset+posts.length : null };
}
export async function listSubmissions(db: D1Database, offset=0, limit=20, status?: string) {
  if (status && !["pending","rejected","published","withdrawn"].includes(status)) throw invalid();
  const where = status ? " WHERE status=?" : "", values = status ? [status] : [];
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM blog_drafts${where}`).bind(...values).first<number>("n") ?? 0;
  const drafts = (await db.prepare(`SELECT slug,title,summary,tag,status,revision,review_note,submitted_at,updated_at,is_test,archived_at FROM blog_drafts${where} ORDER BY updated_at DESC,slug LIMIT ? OFFSET ?`).bind(...values,limit,offset).all()).results;
  return {drafts,total,next_offset:offset+drafts.length<total ? offset+drafts.length : null};
}
export async function getDraft(db: D1Database, slug: string) { return row(await db.prepare("SELECT * FROM blog_drafts WHERE slug=?").bind(slug).all<Draft>()); }
export async function listDrafts(db: D1Database) { return (await db.prepare("SELECT * FROM blog_drafts WHERE status IN ('pending','rejected') AND is_test=0 AND archived_at IS NULL ORDER BY updated_at DESC").all<Draft>()).results; }
export async function listInactiveDrafts(db: D1Database) { return (await db.prepare("SELECT * FROM blog_drafts WHERE (archived_at IS NOT NULL OR is_test=1) AND status<>'published' ORDER BY updated_at DESC").all<Draft>()).results; }
export async function getPost(db: D1Database, slug: string) { return row(await db.prepare("SELECT * FROM blog_posts WHERE slug=?").bind(slug).all<Post>()); }
export async function publishDraft(db: D1Database, slug: string, origin?: string, expectedRevision?: number) {
  const draft = await getDraft(db,slug); if (!draft || draft.status !== "pending") throw invalid("not_found");
  if (draft.is_test) throw invalid("test_draft");
  if (draft.archived_at) throw invalid("archived");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== draft.revision) throw invalid("revision_conflict");
  const at = now();
  const [postResult] = await db.batch([
    db.prepare(`INSERT INTO blog_posts (slug,title,summary,tag,body_html,body_markdown,cover_media_id,media_ids,revision,published_at,updated_at,category,tags,series,sources)
      SELECT slug,title,summary,tag,body_html,body_markdown,cover_media_id,media_ids,revision,?,?,category,tags,series,sources FROM blog_drafts WHERE slug=? AND status='pending' AND revision=?
      ON CONFLICT(slug) DO UPDATE SET title=excluded.title,summary=excluded.summary,tag=excluded.tag,body_html=excluded.body_html,body_markdown=excluded.body_markdown,cover_media_id=excluded.cover_media_id,media_ids=excluded.media_ids,revision=excluded.revision,updated_at=excluded.updated_at,category=excluded.category,tags=excluded.tags,series=excluded.series,sources=excluded.sources`).bind(at,at,slug,draft.revision),
    db.prepare("UPDATE blog_drafts SET status='published',published_at=?,updated_at=? WHERE slug=? AND status='pending' AND revision=?").bind(at,at,slug,draft.revision),
  ]);
  if (!postResult.meta.changes) throw invalid("revision_conflict");
  await purgeBlogCaches(slug,origin);
  return {slug,status:"published",revision:draft.revision,published_at:at};
}
export async function rejectDraft(db: D1Database, slug: string, note?: string, expectedRevision?: number) {
  if (note !== undefined && !text(note,1000)) throw invalid();
  const draft = await getDraft(db,slug); if (!draft || draft.status !== "pending") throw invalid("not_found");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== draft.revision) throw invalid("revision_conflict");
  const result = await db.prepare("UPDATE blog_drafts SET status='rejected',review_note=?,updated_at=? WHERE slug=? AND status='pending' AND revision=?").bind(note ?? null,now(),slug,draft.revision).run();
  if (!result.meta.changes) throw invalid("revision_conflict");
  return {slug,status:"rejected"};
}
export async function unpublishPost(db: D1Database, slug: string, origin?: string, expectedRevision?: number) {
  const post = await getPost(db,slug); if (!post) throw invalid("not_found");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== post.revision) throw invalid("revision_conflict");
  const results = await db.batch([db.prepare("DELETE FROM blog_posts WHERE slug=? AND revision=?").bind(slug,expectedRevision),db.prepare("UPDATE blog_drafts SET status='pending',updated_at=? WHERE slug=? AND status='published' AND revision=?").bind(now(),slug,expectedRevision)]);
  if (results.some(result => !result.meta.changes)) throw invalid("revision_conflict");
  await purgeBlogCaches(slug,origin); return {slug,status:"unpublished"};
}
export async function archiveDraft(db: D1Database, slug: string, expectedRevision?: number) {
  const draft = await getDraft(db,slug); if (!draft || draft.status === "published" || draft.archived_at) throw invalid("not_found");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== draft.revision) throw invalid("revision_conflict");
  const result = await db.prepare("UPDATE blog_drafts SET archived_at=?,updated_at=? WHERE slug=? AND revision=? AND status<>'published' AND archived_at IS NULL").bind(now(),now(),slug,expectedRevision).run();
  if (!result.meta.changes) throw invalid("revision_conflict");
  return {slug,status:"archived",revision:draft.revision};
}
export async function restoreDraft(db: D1Database, slug: string, expectedRevision?: number) {
  const draft = await getDraft(db,slug); if (!draft || (!draft.archived_at && !draft.is_test)) throw invalid("not_found");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== draft.revision) throw invalid("revision_conflict");
  const result = await db.prepare("UPDATE blog_drafts SET archived_at=NULL,is_test=0,updated_at=? WHERE slug=? AND revision=? AND (archived_at IS NOT NULL OR is_test=1)").bind(now(),slug,expectedRevision).run();
  if (!result.meta.changes) throw invalid("revision_conflict");
  return {slug,status:draft.status,revision:draft.revision};
}
export async function updateDraftMetadata(db: D1Database, slug: string, input: Record<string, unknown>, expectedRevision?: number) {
  const draft = await getDraft(db,slug); if (!draft || draft.status !== "pending") throw invalid("not_found");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== draft.revision) throw invalid("revision_conflict");
  const category = input.category === null ? null : await assertCategory(db,input.category);
  if (!validTags(input.tags) || (input.series !== undefined && input.series !== null && (!text(input.series,40) || !input.series.trim()))) throw invalid();
  const series = input.series === undefined ? draft.series : input.series;
  const result = await db.prepare("UPDATE blog_drafts SET category=?,tags=?,series=?,updated_at=? WHERE slug=? AND status='pending' AND revision=?")
    .bind(category,JSON.stringify(input.tags),series,now(),slug,expectedRevision).run();
  if (!result.meta.changes) throw invalid("revision_conflict");
  return {slug,revision:draft.revision,category,tags:input.tags,series};
}
export async function postNeighbors(db: D1Database, post: Post) {
  // Chronological reading order: previous = older, next = newer.
  const previous = await db.prepare("SELECT slug,title FROM blog_posts WHERE published_at<? OR (published_at=? AND slug>?) ORDER BY published_at DESC,slug ASC LIMIT 1").bind(post.published_at,post.published_at,post.slug).first<{slug:string;title:string}>();
  const next = await db.prepare("SELECT slug,title FROM blog_posts WHERE published_at>? OR (published_at=? AND slug<?) ORDER BY published_at ASC,slug DESC LIMIT 1").bind(post.published_at,post.published_at,post.slug).first<{slug:string;title:string}>();
  return {previous:previous ?? null,next:next ?? null};
}
export async function purgeBlogCaches(slug?: string, origin="https://codepi.app") {
  try { const cache=caches.default; await cache.delete(new Request(`${origin}/blog/`)); if (slug) await cache.delete(new Request(`${origin}/blog/${slug}/`)); } catch { /* best effort */ }
}
export async function blogSummary(db: D1Database): Promise<SourceSummary> {
  const published=await db.prepare("SELECT COUNT(*) AS count FROM blog_posts").first<number>("count") ?? 0;
  const pending=await db.prepare("SELECT COUNT(*) AS count FROM blog_drafts WHERE status='pending' AND is_test=0 AND archived_at IS NULL").first<number>("count") ?? 0;
  return {source:"blog",status:"ok",stale:false,asOf:null,updatedAt:null,metrics:[{label:"已发布",value:String(published)},{label:"待审核",value:String(pending)}],facts:[],notes:[],attention:pending ? [{label:`${pending} 篇博客草稿待审核`,href:"https://codepi.app/desk/"}] : []};
}
