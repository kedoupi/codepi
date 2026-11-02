import type { Env } from "./env.ts";
import { HttpError, escapeHtml, form, sameOrigin } from "./http.ts";
import { page, hidden } from "./pages.ts";
import { randomToken, sha256Base64Url, SUPPORTED_SCOPES, type TokenRow } from "./oauth-store.ts";

export async function personalToken(env: Env, token: string): Promise<TokenRow | null> {
  const row = await env.DB.prepare(`SELECT user_id, token_id AS client_id, name AS client_name, scope, expires_at
    FROM mcp_personal_tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`)
    .bind(await sha256Base64Url(token), Date.now()).first<TokenRow>();
  // A token issued before a scope existed still reaches the tools that scope
  // unlocked: like a refreshed OAuth grant, a personal token carries the
  // current full scope set, so Blog stays usable on old tokens.
  return row ? { ...row, scope: SUPPORTED_SCOPES.join(" ") } : null;
}

export async function tokenManagement(request: Request, env: Env, userId: string, csrf: string) {
  let issued: string | null = null;
  if (request.method === "POST") {
    sameOrigin(request);
    const fields = await form(request);
    if (fields.get("csrf_token") !== csrf) throw new HttpError("invalid_csrf", 403);
    if (fields.get("action") === "revoke") {
      await env.DB.prepare("UPDATE mcp_personal_tokens SET revoked_at=? WHERE token_id=? AND user_id=?")
        .bind(Date.now(), fields.get("token_id"), userId).run();
      return new Response(null, { status: 303, headers: { Location: "/connections/tokens" } });
    }
    if (fields.get("action") !== "create") throw new HttpError("invalid_request");
    const name = fields.get("name")?.trim() ?? "", days = Number(fields.get("days"));
    if (!name || name.length > 80 || ![7, 30, 90].includes(days)) throw new HttpError("invalid_request");
    // One owner, one deployment: every connection carries the full scope set,
    // exactly like the OAuth grant. Narrowing means revoking the token.
    const scope = SUPPORTED_SCOPES.join(" ");
    issued = `kdp_pat_${randomToken(32)}`;
    const inserted = await env.DB.prepare(`INSERT INTO mcp_personal_tokens(token_id,token_hash,user_id,name,scope,expires_at)
      SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM mcp_personal_tokens
        WHERE user_id=? AND revoked_at IS NULL AND expires_at>?) < 20`)
      .bind(`pat_${randomToken(16)}`, await sha256Base64Url(issued), userId, name, scope,
        Date.now() + days * 86400000, userId, Date.now()).run();
    if (!inserted.meta.changes) { issued = null; throw new HttpError("token_limit_reached", 409); }
  }
  const rows = await env.DB.prepare(`SELECT token_id,name,scope,expires_at FROM mcp_personal_tokens
    WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC`)
    .bind(userId, Date.now()).all<{ token_id: string; name: string; scope: string; expires_at: number }>();
  return page("个人访问令牌", `<p>用于只能填写 Bearer token 的客户端。令牌只能看到一次，请保存到客户端的凭证设置中。</p>
${issued ? `<section role="status"><h2>令牌已创建</h2><p>离开后无法再次查看。</p><textarea readonly aria-label="新令牌">${escapeHtml(issued)}</textarea></section>` : ""}
<form method="POST">${hidden({ csrf_token: csrf, action: "create" })}
<label>名称 <input name="name" required maxlength="80" autocomplete="off"></label>
<label>有效期 <select name="days"><option value="7">7 天</option><option value="30" selected>30 天</option><option value="90">90 天</option></select></label>
<fieldset><legend>允许的权限</legend><ul>${SUPPORTED_SCOPES.map(s => `<li><code>${s}</code></li>`).join("")}</ul>
<p>令牌包含当前全部已支持权限，与登录授权一致；需要收缩权限时撤销该令牌。</p></fieldset>
<button type="submit">创建令牌</button></form>
<h2>有效令牌</h2>${rows.results.map(r => `<article><h3>${escapeHtml(r.name)}</h3><p>${escapeHtml(r.scope)}</p><p>有效至 ${escapeHtml(new Date(r.expires_at).toISOString())}</p>
<form method="POST">${hidden({ csrf_token: csrf, action: "revoke", token_id: r.token_id })}<button>撤销令牌</button></form></article>`).join("") || "<p>没有有效令牌。</p>"}
<p><a href="/connections">返回连接管理</a></p>`);
}
