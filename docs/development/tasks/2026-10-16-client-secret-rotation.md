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

## 2026-10-16 合并、发布与轮换结果

- PR #49 squash 合并为 `bac640c`（CI 两 workflow 成功；独立 reviewer Nietzsche 放行，
  无阻塞；采纳其 P3 建议补充 Health 轮换指向 API Worker，提交 `44e9e65`）。
- main 发布链将新 Auth Worker 上线（deployment `d24e61c9`，11:08 UTC）。
- 通过 Cloudflare API 生成两个 43 字符随机 secret（值不落地、不打印）：
  - 中央 Auth 设置 `SSO_CLIENT_SECRET_GU` 与 `SSO_CLIENT_SECRET_DESK` override。
  - `codepi-gu` 与 `codepi-www` 的 production `AUTH_CLIENT_SECRET` 同值配对。
- 因 Pages secret 轮换晚于当次部署，运行中 deployment 仍持旧值；PR #50 记录轮换
  并使 web+gu 落入 affected，main 发布链于 11:19 UTC 用配对 secret 重发：
  - codepi-www deployment `28423e59`（commit `193bb2167`）。
  - codepi-gu deployment `ffafd3a9`（commit `193bb2167`）。
- 上线验证全部通过：
  - `check-pages.mjs web/gu/gzh production`：root、匿名私有 API 401、同环境 SSO 跳转均通过。
  - GU `/` 302、GU `/api/me` 401、Desk `/api/desk/me` 401（均由 503 恢复为正确匿名拒绝）。
  - `apps/oura/scripts/check-api.mjs`：16 项 API/MCP/OAuth probes 通过（`/api/health` build 仍为 local）。
  - Auth `/api/health` 200、`codepi.app` 200、`health.codepi.app` 200。
- 影响：GU 与 Desk 的既有登录态因 secret 轮换失效，需重新登录；其他客户端、
  中心会话、OTP、provider、MCP 凭证不受影响（gzh/health 未轮换，仍正常）。

## 附：Health 线上 build 标记绑定（PR #52）

- 问题：`/api/health` 长期 `build=local`，因 health-api 自 workspace 迁移后未重发，
  `BUILD_SHA` 未注入，无法据其证明线上 source SHA。
- 处理：PR #52 把 `BUILD_SHA` 显式声明为 Worker var（本地 fallback `local`），
  合并为 `9f4672f`，main 发布链重发 health-api（deployment `74dca71c`，11:39 UTC）。
- 验证：`OURA_EXPECT_BUILD=9f4672f04ebb node scripts/check-api.mjs` 16 项通过，
  `/api/health` 现报 `build=9f4672f04ebb`，smoke 的 build 校验真正生效。
