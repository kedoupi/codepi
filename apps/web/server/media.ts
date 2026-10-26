import { readSsoSession, type SsoEnv } from "@kedoupi/shared/auth/client";

export interface MediaEnv { BLOG: D1Database; BLOG_MEDIA: R2Bucket }
export type Media = { id: string; object_key: string; content_type: string; bytes: number; sha256: string; width: number; height: number; alt: string; created_at: string };
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const INLINE_BYTES = 192 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (message = "invalid_image"): never => { throw new Error(message); };
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
export const mediaUrl = (id: string) => `/blog/media/${id}`;
export const getMedia = (env: MediaEnv, id: string) => env.BLOG.prepare("SELECT * FROM blog_media WHERE id=?").bind(id).first<Media>();
export function mediaId(href: string): string | null {
  const match = /^(?:https:\/\/codepi\.app)?\/blog\/media\/([^/?#]+)$/.exec(href);
  return match && UUID.test(match[1]) ? match[1] : null;
}
function altText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || /[\x00-\x1f]/.test(value)) return fail("alt_required");
  return value.trim();
}
function completeContainer(b: Uint8Array, type: string): boolean {
  const view = new DataView(b.buffer,b.byteOffset,b.byteLength);
  if (type === "image/png") {
    let at=8, data=false;
    while (at+12<=b.length) {
      const size=view.getUint32(at), kind=view.getUint32(at+4);
      if (size>b.length-at-12) return false;
      let crc=0xffffffff;
      for (let i=at+4;i<at+8+size;i++) { crc^=b[i]; for (let j=0;j<8;j++) crc=(crc>>>1)^((crc&1) ? 0xedb88320 : 0); }
      if (((crc^0xffffffff)>>>0)!==view.getUint32(at+8+size)) return false;
      if (kind===0x49444154 && size>0) data=true;
      at+=size+12;
      if (kind===0x49454e44) return size===0 && data && at===b.length;
    }
    return false;
  }
  if (type === "image/jpeg") {
    let at=2, scan=false;
    while (at<b.length) {
      if (b[at++]!==255) return false;
      while (at<b.length && b[at]===255) at++;
      if (at>=b.length) return false;
      const marker=b[at++];
      if (marker===0xd9) return scan && at===b.length;
      if (marker===0 || marker===0xd8 || (marker>=0xd0 && marker<=0xd7) || at+2>b.length) return false;
      const size=view.getUint16(at); if (size<2 || at+size>b.length) return false;
      at+=size;
      if (marker===0xda) {
        const start=at;
        while (at<b.length) {
          if (b[at]!==255) { at++; continue; }
          if (at+1>=b.length) return false;
          if (b[at+1]===0 || (b[at+1]>=0xd0 && b[at+1]<=0xd7)) { at+=2; continue; }
          break;
        }
        if (at<=start) return false;
        scan=true;
      }
    }
    return false;
  }
  let at=12, data=false;
  while (at+8<=b.length) {
    const kind=view.getUint32(at), size=view.getUint32(at+4,true);
    if (size>b.length-at-8) return false;
    if ((kind===0x56503820 && size>=10) || (kind===0x5650384c && size>=5)) data=true;
    // Animated WebP is deliberately unsupported until frame validation exists.
    if (kind===0x414e494d || kind===0x414e4d46) return false;
    at+=8+size+(size%2);
  }
  return data && at===b.length;
}
// Validate raster container boundaries and dimensions; no decoder dependency is added.
export function imageInfo(b: Uint8Array): { content_type: string; width: number; height: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0, height = 0, content_type = "";
  if (b.length >= 33 && [137,80,78,71,13,10,26,10].every((n,i) => b[i] === n) && v.getUint32(8) === 13 && v.getUint32(12) === 0x49484452) {
    width = v.getUint32(16); height = v.getUint32(20); content_type = "image/png";
  } else if (b.length >= 12 && b[0] === 255 && b[1] === 216) {
    let at = 2;
    while (at + 4 <= b.length) {
      if (b[at++] !== 255) return fail();
      while (b[at] === 255) at++;
      if (at+3>b.length) return fail();
      const marker = b[at++];
      if (marker === 0xda || marker === 0xd9) break;
      const size = v.getUint16(at);
      if (size < 2 || at + size > b.length) return fail();
      if ([0xc0,0xc1,0xc2].includes(marker) && size >= 8) { height = v.getUint16(at+3); width = v.getUint16(at+5); content_type = "image/jpeg"; break; }
      at += size;
    }
  } else if (b.length >= 30 && v.getUint32(0) === 0x52494646 && v.getUint32(8) === 0x57454250 && v.getUint32(4,true) + 8 === b.length) {
    const kind = v.getUint32(12);
    content_type = "image/webp";
    if (kind === 0x56503858) {
      width = 1 + b[24] + (b[25]<<8) + (b[26]<<16); height = 1 + b[27] + (b[28]<<8) + (b[29]<<16);
    } else if (kind === 0x56503820 && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) {
      width = v.getUint16(26,true) & 0x3fff; height = v.getUint16(28,true) & 0x3fff;
    } else if (kind === 0x5650384c && b[20] === 0x2f) {
      width = 1 + b[21] + ((b[22]&63)<<8); height = 1 + (b[22]>>6) + (b[23]<<2) + ((b[24]&15)<<10);
    }
  }
  if (!width || !height || width > 16000 || height > 16000 || width * height > 40_000_000 || !completeContainer(b,content_type)) return fail();
  return { content_type, width, height };
}
function describe(media: Media) {
  return { id: media.id, url: `https://codepi.app${mediaUrl(media.id)}`, markdown: `![${media.alt.replace(/[\[\]\\]/g, "\\$&")}](${mediaUrl(media.id)})`, alt: media.alt,
    content_type: media.content_type, bytes: media.bytes, width: media.width, height: media.height, visibility: "private_until_published" };
}
async function store(env: MediaEnv, bytes: Uint8Array, alt: string, client: string, clientName?: string, id = crypto.randomUUID(), source = "inline") {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return fail("payload_too_large");
  const info = imageInfo(bytes), sha = await hash(bytes), key = `media/${id}`, created = new Date().toISOString();
  await env.BLOG_MEDIA.put(key, bytes, { httpMetadata: { contentType: info.content_type } });
  await env.BLOG.prepare(`INSERT INTO blog_media(id,object_key,content_type,bytes,sha256,width,height,alt,source,client_id,client_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,key,info.content_type,bytes.length,sha,info.width,info.height,alt,source,client,clientName ?? null,created).run();
  return describe({ id, object_key:key, ...info, bytes:bytes.length, sha256:sha, alt, created_at:created });
}
export async function uploadInline(env: MediaEnv, args: Record<string, unknown>, client: string, name?: string) {
  const alt = altText(args.alt);
  if (typeof args.data_base64 !== "string" || args.data_base64.length > Math.ceil(INLINE_BYTES/3)*4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.data_base64)) return fail();
  const bytes = Uint8Array.from(atob(args.data_base64), c => c.charCodeAt(0));
  if (bytes.length > INLINE_BYTES) return fail("payload_too_large");
  return store(env,bytes,alt,client,name);
}
export async function createUpload(env: MediaEnv, args: Record<string, unknown>, client: string, name?: string) {
  const alt = altText(args.alt);
  if (!Number.isSafeInteger(args.bytes) || Number(args.bytes) < 1 || Number(args.bytes) > MAX_IMAGE_BYTES || !["image/png","image/jpeg","image/webp"].includes(String(args.content_type))) return fail();
  const id = crypto.randomUUID(), token = crypto.randomUUID() + crypto.randomUUID();
  const created = new Date(), expires = new Date(created.getTime()+10*60*1000).toISOString();
  await env.BLOG.prepare("DELETE FROM blog_uploads WHERE expires_at < ?").bind(created.toISOString()).run();
  await env.BLOG.prepare(`INSERT INTO blog_uploads(id,token_hash,alt,content_type,bytes,client_id,client_name,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(id,await hash(new TextEncoder().encode(token)),alt,args.content_type,args.bytes,client,name ?? null,created.toISOString(),expires).run();
  return { upload_url:`https://codepi.app/api/blog/uploads/${id}`, method:"PUT", headers:{ Authorization:`Bearer ${token}`, "Content-Type":args.content_type }, expires_at:expires,
    instructions:"Send the raw file bytes, without multipart encoding. This credential authorizes only this upload and expires in 10 minutes. Do not put it in a URL or article. Response contains image id, URL and Markdown. On a failed upload create a new slot." };
}
async function boundedBytes(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get("Content-Length")) > MAX_IMAGE_BYTES) return fail("payload_too_large");
  const reader = request.body?.getReader(); if (!reader) return fail();
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > MAX_IMAGE_BYTES) return fail("payload_too_large"); chunks.push(value); } }
  finally { await reader.cancel(); }
  const result = new Uint8Array(size); let at=0; for (const chunk of chunks) { result.set(chunk,at); at+=chunk.length; } return result;
}
export async function handleMediaRequest(request: Request, env: MediaEnv & SsoEnv): Promise<Response|null> {
  const url = new URL(request.url), upload = /^\/api\/blog\/uploads\/([^/]+)$/.exec(url.pathname), download = /^\/blog\/media\/([^/]+)$/.exec(url.pathname);
  if (!upload && !download) return null;
  const headers = { "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "X-Robots-Tag":"noindex", "Referrer-Policy":"no-referrer" };
  const error = (message: string, status=400) => Response.json({error:message},{status,headers});
  try {
    if (upload) {
      if (request.method !== "PUT" || !UUID.test(upload[1])) return error("not_found",404);
      if (url.protocol !== "https:" && !["localhost","127.0.0.1"].includes(url.hostname)) return error("https_required",403);
      if (request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) return error("origin_not_allowed",403);
      const token = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9-]{72})$/)?.[1];
      if (!token) return error("unauthorized",401);
      const slot = await env.BLOG.prepare("SELECT * FROM blog_uploads WHERE id=? AND token_hash=? AND expires_at>? AND claimed_at IS NULL")
        .bind(upload[1],await hash(new TextEncoder().encode(token)),new Date().toISOString()).first<{alt:string;content_type:string;bytes:number;client_id:string;client_name:string|null}>();
      if (!slot) return error("unauthorized",401);
      const bytes = await boundedBytes(request), info = imageInfo(bytes);
      if (bytes.length !== slot.bytes || info.content_type !== slot.content_type || request.headers.get("Content-Type")?.split(";")[0] !== slot.content_type) return error("image_mismatch");
      const claimed = await env.BLOG.prepare("UPDATE blog_uploads SET claimed_at=? WHERE id=? AND claimed_at IS NULL AND expires_at>?").bind(new Date().toISOString(),upload[1],new Date().toISOString()).run();
      if (!claimed.meta.changes) return error("upload_consumed",409);
      const media = await store(env,bytes,slot.alt,slot.client_id,slot.client_name ?? undefined,upload[1],"upload");
      return Response.json(media,{status:201,headers});
    }
    if (!["GET","HEAD"].includes(request.method) || !UUID.test(download![1])) return error("not_found",404);
    const id = download![1];
    const published = await env.BLOG.prepare("SELECT 1 AS found FROM blog_posts,json_each(blog_posts.media_ids) AS media WHERE media.value=? LIMIT 1").bind(id).first();
    if (!published) {
      const session = await readSsoSession(request,env);
      if (!session || session.subject !== "kdp-owner" || session.userId !== "desk-owner") return error("not_found",404);
    }
    const media = await getMedia(env,id); if (!media) return error("not_found",404);
    const file = await env.BLOG_MEDIA.get(media.object_key); if (!file) return error("media_unavailable",503);
    return new Response(request.method === "HEAD" ? null : file.body,{headers:{...headers,"Content-Type":media.content_type,"Content-Length":String(media.bytes),"Content-Disposition":"inline"}});
  } catch (e) { const message = e instanceof Error ? e.message : "media_unavailable"; return error(["invalid_image","payload_too_large","alt_required"].includes(message) ? message : "media_unavailable",message === "payload_too_large" ? 413 : message === "invalid_image" ? 400 : 503); }
}
