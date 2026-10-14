/**
 * 旧 gzh-preview 接口兼容层：
 * - PUT /api/articles/:id  { slot, title, url?, html?, cover?, digest?, note?, status?, publish_date? }
 * - POST /api/review       { id, action: 过|要改|拒|pass|change|reject, note? } 或 { id, status, note? }
 * 全部翻译成 fagao 新接口，结果另附旧形状 `article`。
 */
import { handleBoxed, handleReview, handleUpsertPost, handleWithdraw } from "./desk";
import { json, shanghaiDate } from "./lib";
import type { AuthedAccount } from "./types";

const ACTION_MAP: Record<string, "过" | "要改" | "拒"> = {
  过: "过",
  pass: "过",
  要改: "要改",
  change: "要改",
  拒: "拒",
  reject: "拒",
};

function jsonRequest(base: Request, body: unknown): Request {
  return new Request(base.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withArticle(res: Response): Promise<Response> {
  const data = (await res.json()) as {
    ok: boolean;
    post?: { slug: string; slot: string | null; title: string; status: string; note: string | null; digest: string | null; review_path: string };
    review_url?: string;
  };
  if (!data.ok || !data.post) return json(data, res.status);
  const p = data.post;
  return json(
    {
      ...data,
      article: {
        id: p.slug,
        slot: p.slot ?? "",
        title: p.title,
        url: data.review_url ?? `https://fagao.kdp.cool${p.review_path}`,
        status: p.status,
        note: p.note ?? "",
        digest: p.digest ?? "",
      },
    },
    res.status,
  );
}

export async function handleLegacyPutArticle(
  request: Request,
  env: Env,
  account: AuthedAccount,
  id: string,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "JSON 无法解析" }, 400);
  }
  const date =
    typeof body.publish_date === "string" && body.publish_date
      ? body.publish_date
      : /^(\d{4}-\d{2}-\d{2})/.exec(id)?.[1] ?? shanghaiDate();
  const status = typeof body.status === "string" ? body.status : "待审";
  const translated = {
    slug: id,
    title: body.title ?? id,
    slot: body.slot,
    publish_date: date,
    preview_path: typeof body.url === "string" ? body.url : undefined,
    html: body.html,
    cover: body.cover,
    digest: body.digest,
    note: body.note,
    is_test: body.is_test,
    submit: status === "待审",
  };
  return withArticle(await handleUpsertPost(jsonRequest(request, translated), env, account));
}

/** body 已解析；有 id 无 slug 时走这里。 */
export async function handleLegacyReview(
  request: Request,
  env: Env,
  account: AuthedAccount,
  body: Record<string, unknown>,
): Promise<Response> {
  const id = String(body.id || "").trim();
  if (!id) return json({ ok: false, error: "缺少 id" }, 400);
  const note = body.note == null ? "" : String(body.note).slice(0, 500);

  if (body.action != null && String(body.action)) {
    const action = ACTION_MAP[String(body.action)];
    if (!action) return json({ ok: false, error: "action 仅支持 过 / 要改 / 拒" }, 400);
    return withArticle(await handleReview(jsonRequest(request, { slug: id, action, note }), env, account));
  }
  switch (String(body.status ?? "")) {
    case "待审":
      return withArticle(await handleWithdraw(env, account, id));
    case "已进箱":
      return withArticle(await handleBoxed(env, account, id));
    case "可推箱":
      return withArticle(await handleReview(jsonRequest(request, { slug: id, action: "过", note }), env, account));
    case "需改":
      return withArticle(
        await handleReview(jsonRequest(request, { slug: id, action: "要改", note: note || "需改" }), env, account),
      );
    default:
      return json({ ok: false, error: "需要 action 或 status（待审 / 需改 / 可推箱 / 已进箱）" }, 400);
  }
}
