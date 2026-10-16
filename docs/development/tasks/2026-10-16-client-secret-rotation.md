# 客户端 secret 独立轮换（GU / Desk 恢复）

- 状态：本地验证完成，待审查、合并、发布与 secret 轮换操作。
- 目标：让中央 Auth 支持可选的 per-client secret override，恢复 GU 与 Desk 登录，
  无需读取或重写只读的 `SSO_CLIENTS` JSON 注册表。
- 背景：线上 GU 与 Desk 的 `AUTH_CLIENT_SECRET` runtime 值失效（应用返回 503
  `auth_not_configured` / desk 503），Auth `/api/health` 正常但 GU/Desk 无法完成
  internal exchange。回退部署未恢复，确认是配置值而非代码回归。
- worktree：`~/.worktrees/kdp.cool/codex/client-secret-rotation`。
- 分支：`codex/client-secret-rotation`，基线 `6a4ac54`（main）。
- 协调者 / 唯一写入者：父会话；独立审查者另派。

## 设计

- 新增可选绑定 `SSO_CLIENT_SECRET_GU`、`SSO_CLIENT_SECRET_OURA`、
  `SSO_CLIENT_SECRET_GZH`、`SSO_CLIENT_SECRET_DESK`。
- override 仅替换对应注册客户端的 secret；缺省时保留 `SSO_CLIENTS.secret`。
- 空字符串或长度 < 32 的 override fail closed（整体配置判定无效，503）。
- 回调注册仍来自 `SSO_CLIENTS.redirectUris` + `SSO_EXTRA_REDIRECT_URIS`，不随
  secret 轮换变化。
- 轮换步骤：中央 Auth 设置 override → 对应 Pages 项目设置同名
  `AUTH_CLIENT_SECRET` → 走发布链重发该应用。该应用现有登录态失效需重新登录；
  不影响其他客户端、中心会话、OTP、provider 或 MCP 凭证。

## 验证证据

- `pnpm --dir services/auth build && pnpm --dir services/auth test`：20 项通过，
  含新增两项：
  - per-client 轮换保持注册表/回调/其他客户端不变；旧注册 secret 被拒、
    新 secret 按 client 作用域接受；OTP 只发一次。
  - 显式非法 override（空 / 过短）fail closed 而非回落注册表。
- `pnpm --dir services/auth typecheck` 通过。
- `node scripts/agent/check.mjs --base main --run`：20 项受影响检查全部通过，
  包括五个应用测试、shared auth 10 项、Health 正常 + SSO 浏览器回归。

## 待处理

- 独立 reviewer 审查本分支。
- PR 合并后由 main 发布链重发 Auth；随后通过 Cloudflare API 生成并设置
  GU 与 Desk 的新 secret（中央 override + 应用侧 `AUTH_CLIENT_SECRET`），
  重发受影响应用并跑 smoke。
- 操作全程不读取、不打印、不落地任何 secret 值。
