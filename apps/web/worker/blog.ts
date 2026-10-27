import { WorkerEntrypoint } from "cloudflare:workers";
import type { BlogOperation, BlogService, DomainReply, DomainRequest } from "@kedoupi/shared/mcp/contract";
import { BLOG_OPERATIONS } from "@kedoupi/shared/mcp/contract";
import { blogSummary, getDraft, getPost, listPublished, listSubmissions, retractDraft, submitDraft, validateSlug, type BlogEnv } from "../server/blog";
import { createUpload, uploadInline } from "../server/media";
import { BLOG_GUIDE } from "../server/guide";

const OWNER = "kdp-owner";
export interface Env extends BlogEnv {}
export class BlogMcp extends WorkerEntrypoint<Env> implements BlogService {
  async execute(request: DomainRequest<BlogOperation>): Promise<DomainReply> {
    if (request?.subject !== OWNER) return {ok:false,error:"not_owner",status:403};
    if (!BLOG_OPERATIONS.includes(request.operation)) return {ok:false,error:"invalid_arguments",status:400};
    try {
      const args = request.args ?? {};
      if (request.operation === "guide") return {ok:true,data:{guide:BLOG_GUIDE}};
      if (request.operation === "media_upload") return {ok:true,data:await uploadInline(this.env,args,request.client ?? "mcp",request.clientName)};
      if (request.operation === "media_upload_start") return {ok:true,data:await createUpload(this.env,args,request.client ?? "mcp",request.clientName)};
      if (request.operation === "list" || request.operation === "get") {
        const offset = args.offset ?? 0, limit = args.limit ?? (request.operation === "get" ? 4000 : 20);
        if (!Number.isSafeInteger(offset) || Number(offset)<0 || !Number.isSafeInteger(limit) || Number(limit)<1 || Number(limit)>(request.operation === "get" ? 8000 : 100)) throw Error("invalid_arguments");
        if (request.operation === "list") {
          if (args.view !== undefined && !["published","submissions"].includes(String(args.view))) throw Error("invalid_arguments");
          return {ok:true,data:args.view === "submissions" ? await listSubmissions(this.env.BLOG,Number(offset),Number(limit),args.status as string|undefined) : await listPublished(this.env.BLOG,Number(offset),Number(limit))};
        }
        if (!validateSlug(args.slug) || (args.view !== undefined && !["draft","published"].includes(String(args.view)))) throw Error("invalid_arguments");
        const post = args.view === "published" ? await getPost(this.env.BLOG,args.slug) : await getDraft(this.env.BLOG,args.slug);
        if (!post) throw Error("not_found");
        if (args.expected_revision !== undefined && args.expected_revision !== post.revision) throw Error("revision_conflict");
        const {body_html: _,body_markdown:body,...metadata} = post;
        if (body === null || body === undefined) throw Error("markdown_unavailable");
        const points = Array.from(body);
        return {ok:true,data:{...metadata,body_markdown:points.slice(Number(offset),Number(offset)+Number(limit)).join(""),body_total:points.length,next_offset:Number(offset)+Number(limit)<points.length ? Number(offset)+Number(limit) : null,
          public_url:`https://codepi.app/blog/${post.slug}/`,preview_url:`https://codepi.app/blog/preview/${post.slug}/`}};
      }
      if (request.operation === "submit") return {ok:true,data:await submitDraft(this.env.BLOG,{...args,client_id:request.client,client_name:request.clientName},this.env)};
      if (!validateSlug(args.slug)) throw Error("invalid_arguments");
      return {ok:true,data:await retractDraft(this.env.BLOG,args.slug)};
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const errors: Record<string,number> = {not_found:404,markdown_unavailable:409,revision_conflict:409,payload_too_large:413,unsafe_content:400,unknown_media:400,too_many_images:400,invalid_image:400,alt_required:400,cover_required:400,test_draft:400,archived:400,invalid_arguments:400};
      return {ok:false,error:message in errors ? message : "blog_unavailable",status:errors[message] ?? 503};
    }
  }
  async summary(subject: string) {
    if (subject === OWNER) return blogSummary(this.env.BLOG);
    return {source:"blog",status:"unavailable" as const,stale:true,asOf:null,updatedAt:null,metrics:[],facts:[],notes:["未授权"],attention:[]};
  }
}
export class BlogMediaBackup extends WorkerEntrypoint<Env> {
  async listMaterials(after=0, through?: number) {
    if (!Number.isSafeInteger(after) || after<0) throw Error("Invalid material cursor");
    through ??= await this.env.BLOG.prepare("SELECT coalesce(max(rowid),0) AS n FROM blog_media").first<number>("n") ?? 0;
    if (!Number.isSafeInteger(through) || through<after) throw Error("Invalid material snapshot");
    const rows = await this.env.BLOG.prepare("SELECT rowid AS cursor,id,object_key,bytes AS size,sha256 FROM blog_media WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT 100").bind(after,through).all<{cursor:number;id:string;object_key:string;size:number;sha256:string}>();
    return {through,items:rows.results,next:rows.results.length === 100 ? rows.results.at(-1)!.cursor : null};
  }
  async readMaterial(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw Error("Invalid material ID");
    const row = await this.env.BLOG.prepare("SELECT object_key,bytes FROM blog_media WHERE id=?").bind(id).first<{object_key:string;bytes:number}>();
    if (!row || row.object_key !== `media/${id}`) throw Error("Blog media index is invalid");
    const object = await this.env.BLOG_MEDIA.get(row.object_key);
    if (!object || object.size !== row.bytes) throw Error("Blog media original is missing or truncated");
    return object.body;
  }
}
