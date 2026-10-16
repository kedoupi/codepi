import { authorizeSummary, deskJson, emptySummary, type DeskSummary } from "@kedoupi/shared/desk/contract";

export async function handleDeskSummary(request: Request, env: Env): Promise<Response> {
  const denied = await authorizeSummary(request, env.DESK_SUMMARY_TOKEN);
  if (denied) return denied;
  const owner = await env.DB.prepare("SELECT id FROM accounts WHERE id='acc_owner_kdp' AND role='owner' AND active=1").first();
  if (!owner) return deskJson({ error: "owner_unavailable" }, 503);
  // The owner can see the account's entire editorial board, including collaborator drafts.
  const counts = await env.DB.prepare("SELECT status,COUNT(*) AS count,MAX(updated_at) AS updated_at FROM posts WHERE is_demo=0 GROUP BY status")
    .all<{ status: string; count: number; updated_at: string }>();
  if (!counts.results.length) return deskJson(emptySummary("wechat", "还没有真实稿件，演示稿件不纳入摘要。"));
  const posts = await env.DB.prepare("SELECT id,title,status FROM posts WHERE is_demo=0 AND status IN ('待审','需改','可推箱') ORDER BY updated_at DESC,id LIMIT 4")
    .all<{ id: string; title: string; status: string }>();
  const count = (status: string) => counts.results.find(row => row.status === status)?.count ?? 0;
  const result: DeskSummary = {
    source: "wechat", status: "ok", asOf: new Date().toISOString(), updatedAt: new Date().toISOString(), stale: false,
    metrics: ["待审", "需改", "可推箱"].map(label => ({ label, value: String(count(label)) })),
    facts: [`当前有 ${count("待审")} 篇待审、${count("需改")} 篇需改、${count("可推箱")} 篇可推箱。`, `草稿 ${count("draft")} 篇，已进箱 ${count("已进箱")} 篇。`],
    notes: ["这是当前稿件状态，不是最近 7 天的发布统计。", "已进箱不等于已发布，实际发布仍在微信后台完成。"],
    attention: posts.results.map(post => ({
      label: `${post.status}：${post.title.slice(0, 100)}`, href: `https://gzh.codepi.app/p/${encodeURIComponent(post.id)}`,
    })),
  };
  return deskJson(result);
}
