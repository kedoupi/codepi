# codepi.app 四产品切换 + 收尾清理

- 状态：基本完成，等待用户最后两步
- 基线：`52e5ef2e414918365a1d8f70fee9c1f783847314`（main HEAD = 任务 worktree HEAD）
- worktree：`<workspace>/Coding/kdp.cool`（已同步 main），任务 worktree `~/.codex/worktrees/5748/kdp.cool` 已归档删除
- 分支：本地仅 `main` + `chore/local-product-deploy-script`（PR #6 OPEN）
- 协调者、实施者、集成者：本会话 Codex；无并行写入者
- 范围：首页、GU、GZH、Health；auth 和 shared 为支撑层；`*.kdp.cool` 不再承担应用流量
- 用户已授权：四产品收尾、Cloudflare Pages 工具站下线、custom domain 清理、本地分支清理、任务 worktree 归档

## 已完成

### Git 清理

- 主 worktree `~/Coding/kdp.cool` 从 `d82ba18` 同步到 `52e5ef2`（`git reset --hard origin/main`），未跟踪文件保留：
  - `docs/superpowers/plans/2026-10-15-oura-next-iterations.md`
  - `oura/apps/web/public/icon-upload.png`
- 任务 worktree `~/.codex/worktrees/5748/kdp.cool` 已 `git worktree remove --force` 删除
- 本地分支 `codepi-cutover-fixes`、`codex/four-product-retirement` 已删除
- 16 个 PR 已 MERGED 的远程分支已 `git push origin --delete` 删除：
  - `codex/health-access-theme` (#39)
  - `codex/oura-required-scopes` (#42)
  - `codex/oura-adaptive-backfill` (#26)
  - `codex/oura-daily-sync` (#27)
  - `codex/oura-overview-sleep` (#25)
  - `codex/oura-paid-write-budget` (#31)
  - `codex/oura-scheduler-observability` (#30)
  - `codex/oura-stability-baseline` (#8)
  - `codex/oura-storage-quota-errors` (#29)
  - `codex/oura-sync-write-budget` (#28)
  - `codex/oura-ci-deploy-fix` (#9)
  - `codex/multi-agent-workflow` (#37)
  - `codex/oura-background-sync` (#36)
  - `codex/four-product-retirement` (#44)
  - `fix/health-consent-coverage` (#43)
  - `fix/oura-report-calendar-browser-ci` (#33)
- 保留远程分支（不删）：
  - `main`、`origin` HEAD
  - `chore/local-product-deploy-script`（PR #6 OPEN）
  - `codex/gzh-editor-spec-sync`（核心内容已合并到 #37，但分支 tip 多了几个工具特定文件，未提 PR）
  - `fagao/a-editors-lock-readme` ~ `fagao/e-read-receipt-legacy`（PR #20-24 OPEN，依赖 fagao 旧历史）
  - `docs/phase1-delivery-record`、`phase1/privacy-url-state`（3 周前的历史分支）

### Cloudflare Pages custom domains 清理（5 个）

- `kdp-portal`：移除 `kdp.cool`、`www.kdp.cool`
- `kdp-gu`：移除 `gu.kdp.cool`
- `oura-kdp`：移除 `oura.kdp.cool`、`health.kdp.cool`

### Cloudflare Pages 项目删除（2 个成功，4 个阻塞）

- 成功：
  - `fagao`（先删除 `fagao.kdp.cool` custom domain）
  - `kdp-tools`（之前 dry-run 测试中删过几个 deployments，让总数降到限制以下，再禁用 GitHub 自动部署 + 删除 `calc.kdp.cool`）
- 阻塞（deployments 太多，Cloudflare API 限制，需要 Dashboard 手动删除）：
  - `kdp-convert`
  - `kdp-text`
  - `kdp-dev`
  - `kdp-ai`
  错误码 `8000076`：「Your project has too many deployments to be deleted」
  Cloudflare 文档要求 Dashboard 操作：https://cfl.re/3CXesln

### Cloudflare Workers

- `kdp-auth` Worker 通过 `wrangler deploy` 重新部署，重新注册 `auth.codepi.app` custom domain route
- `oura-kdp-api` Worker 之前已部署
- `wechat-proxy` Worker 之前已部署

## 验证证据

| URL | 状态 |
|---|---|
| `https://codepi.app` | 200 |
| `https://www.codepi.app` | 200 |
| `https://gu.codepi.app` | 302 |
| `https://gzh.codepi.app` | 403 → 等用户手动加 CNAME（Pages 项目已识别域名，仍 pending） |
| `https://health.codepi.app` | 200 |
| `https://health.codepi.app/api/me` | 200 |
| `https://health.codepi.app/api/auth/oura/start` | 401 |
| `https://auth.codepi.app/api/health` | 200 |
| `https://kdp.cool` 及所有 `*.kdp.cool` 子域 | 522 / 403 / 000（Pages 已不接管，DNS 未删） |

DNS 验证：dig 查询所有 `codepi.app` 子域都解析到 Cloudflare 内部 IP 198.18.2.7x。

## 仍需用户处理

1. **Cloudflare Dashboard**：手动删除 4 个 Pages 项目
   - `kdp-convert`（部署太多，API 不能删）
   - `kdp-text`
   - `kdp-dev`
   - `kdp-ai`
2. **Cloudflare DNS**：手动添加 `gzh.codepi.app` CNAME → `gzh-8g3.pages.dev`
   - 当前 Cloudflare API token 没有 DNS 写权限（所有 `POST /zones/{id}/dns_records` 都返回 `Authentication error`）
   - 添加 CNAME 后，`gzh.codepi.app` 自定义域将自动从 pending → active
3. **Oura 开发者后台**：把回调改为 `https://health.codepi.app/api/auth/oura/callback`
   - 当前 oura API worker `OURA_REDIRECT_URI` 已是新地址
   - Oura 后台登录后用浏览器技能修改

## 不再合并的分支

PR 已 MERGED 的 16 个分支都已删除。`fagao/*` 5 个 PR OPEN 的分支不删除，等用户决定。`codex/gzh-editor-spec-sync` 核心内容已并入 #37，未提 PR 但分支仍在。

## 不再合并的产品

工具站项目（`kdp-convert`、`kdp-text`、`kdp-dev`、`kdp-ai`）走下线流程；`fagao` 项目已被 `gzh` 取代；`*.kdp.cool` 不再承担新应用流量，仅保留邮件路由（MX/TXT）。

---

## 2026-10-15 收尾（第二轮，全部完成）

用户确认「需要」后执行以下动作，全部经 API/CLI 完成，未使用浏览器手动操作（Cloudflare API token 实际具备 `#dns_records:edit` 权限，上一轮「无 DNS 写权限」的判断有误）。

### gzh.codepi.app DNS 修复

根因：CNAME `gzh.codepi.app` 仍指向已删除的 `fagao.pages.dev`，Pages custom domain 因此报 `CNAME record not set`。

- `PUT /zones/{codepi.app}/dns_records/5f59f0dff6f7defb6cb04c3950dd57db` → content 改为 `gzh-8g3.pages.dev`，proxied 保持 true
- `PATCH /accounts/{account}/pages/projects/gzh/domains/gzh.codepi.app` 触发重校验
- 结果：`status: active`，`https://gzh.codepi.app/` 返回 200，跳 `/login?next=%2F`，登录入口指向 `gzh.codepi.app/api/auth/login`

### Oura 开发者后台回调

- 后台入口已迁移：`cloud.ouraring.com` 主站已 retire，真实入口为 `https://developer.ouraring.com/applications`
- 应用 `kdp`（client_id `c4cb0a03-eab4-4917-9d50-95c0b49a660e`，Development）Redirect URI：`https://oura.kdp.cool/api/auth/oura/callback` → `https://health.codepi.app/api/auth/oura/callback`
- 勾选 API Agreement 后保存，返回 "Updated Successfully!"，Example Authorization Url 同步刷新
- 端到端验证：
  - 新 redirect_uri → `cloud.ouraring.com/oauth/authorize` 返回 302，跳 `moi.ouraring.com/oauth/v2/ext/oauth-authorize`
  - 旧 redirect_uri（`oura.kdp.cool`）→ HTTP 400，服务端已不再接受
- Worker 侧 `oura-kdp-api` bindings 早已对齐：`OURA_REDIRECT_URI` / `FRONTEND_ORIGIN(S)` 指向 `health.codepi.app`，`AUTH_ORIGIN` 指向 `auth.codepi.app`

### PR 与分支收尾

关闭（不合并）：

| PR | 标题 | 关闭理由 |
| --- | --- | --- |
| #20 | fagao A：EDITORS 名单登录即编辑 | fagao 产品不保留，gzh 已取代 |
| #21 | fagao B：交稿 token + 正文/封面直传 | 同上 |
| #22 | fagao C：稿件版本（在审不可覆盖） | 同上 |
| #23 | fagao D：弃用状态 + 测试稿标记 | 同上 |
| #24 | fagao E：读完回执 + 旧接口兼容 | 同上（依赖 `gzh-preview.kdp.cool` 与 Pages 项目 fagao，均已下线） |
| #6 | chore: local deploy script | 脚本硬编码 fagao / oura / gzh-preview 三个已下线产品 |

删除远程分支（9 条）：

- `fagao/a-editors-lock-readme`、`fagao/b-submit-token-upload`、`fagao/c-versions`、`fagao/d-discard-test-flag`、`fagao/e-read-receipt-legacy`
- `chore/local-product-deploy-script`、`codex/gzh-editor-spec-sync`
- `docs/phase1-delivery-record`（纯文档，235 行 phase 1 交付记录）
- `phase1/privacy-url-state`（含 `ai/src/pages/skill-builder/index.astro` + `shared/lib/*` 的 skill builder URL state 改动，未合并即删除）

删除本地分支：`chore/local-product-deploy-script`

**遗留风险**：`phase1/privacy-url-state` 上有一个未合并的 skill builder URL state 修复（含 79 行回归测试），如后续 `ai` 工具站需要该修复，需从 PR #24 之前的 reflog 或 GitHub 缓存重新捞取。

最终状态：本地仅 `main`，远程仅 `origin/main` + `origin/HEAD`，单一 worktree `~/Coding/kdp.cool` @ `52e5ef2`，与 origin 同步。

### 本地 stale 目录

`fagao/`（412M）与 `gzh-preview/`（201M）经确认仅含 `dist/`、`.wrangler/`、`node_modules/`，git 追踪文件数为 0，未移动到 `/tmp/kdp-trash-{fagao,gzh-preview}-20261015`（可恢复）。仓库从 2.2G 降至 1.6G。

### kdp.cool zone 死记录清理

上轮下线只删了 Pages custom domain，DNS 记录仍在，导致旧域名仍指向已删除项目。本轮删除全部 12 条指向 `*.pages.dev` 的 CNAME：

`ai.`、`calc.`、`convert.`、`dev.`、`fagao.`、`gu.`、`gzh-preview.`、`health.`、`text.`、`oura.`、主域 `kdp.cool`、`www.kdp.cool`

保留不动（邮件路由 + 非 Pages 服务）：3 条 MX（route1-3.mx.cloudflare.net）、SPF TXT、`cf2024-1._domainkey` DKIM、`resend._domainkey` DKIM、google-site-verification TXT，以及全部 `cfargotunnel.com` / `rsend.forge.rmta.net` / `send.forge.rmta.net` / `proxy*` A 记录。

验证：`kdp.cool`、`gu.kdp.cool` → Empty reply（000，不再有网页响应）；`dig MX kdp.cool` 三条 route 仍在。

### 最终线上验证

| URL | 状态 |
| --- | --- |
| `https://codepi.app/` | 200 |
| `https://www.codepi.app/` | 200 |
| `https://gu.codepi.app/` | 200 |
| `https://gzh.codepi.app/` | 200 |
| `https://health.codepi.app/` | 200 |
| `https://auth.codepi.app/api/health` | 200 |
| `https://health.codepi.app/api/me` | 200 |
| `https://health.codepi.app/.well-known/oauth-authorization-server/mcp` | 200 |
| `https://codepi.app/tools/` | 404（已下线） |
| `https://codepi.app/mortgage-calculator` | 404（已下线） |

---

## 2026-10-15 全产品迁移 CR 修复（main@b07b7ae）

依据 `/tmp/codepi-migration-review-2026-10-15.md` 按序修复并上线。旧 fagao 分支（PR #20-24）未合并。

### 已修复并上线

1. 统一登录验证码提示：区分日额度与短冷却，日额度改为 Asia/Shanghai 日界，UI 显示「今日验证码额度已用完，北京时间 0 点恢复」。`auth/src/index.ts`、`auth/src/ui.ts`。已部署 kdp-auth（Version 271f989f），浏览器实测提示正确。
2. Health MCP 发现：补注册 codepi.app zone 的 4 条 Worker routes（health.codepi.app /api/*、/mcp、/oauth*、/.well-known*）。`/.well-known/oauth-*` 现返回正确 JSON；`pnpm check:api` 全 PASS。
3. Health 前端发布目录：`deploy:web` 与 CI Publish step 改在 `apps/web` 执行，Wrangler 能发现 functions/ 代理；已重新部署，API 代理确认在线。
4. 首页工作台 Functions：`web` 新增 `build:pages`（编译 functions 进 dist/_worker.js），wrangler 加入 web devDependencies 使 CF 构建自足；`kdp-portal` root_dir 修正为 `web`、build 命令 `npm run build:pages`。Git 构建（main@b07b7ae）成功，`/api/desk/me`→401 JSON、`/api/auth/login`→302 SSO、www→apex 跳转均正常。
5. GU/GZH 摘要凭证：为 kdp-gu、gzh 配置 `DESK_SUMMARY_TOKEN`，kdp-portal 配置对应 `GU_SUMMARY_TOKEN`/`WECHAT_SUMMARY_TOKEN`（新生成、互不复用）；重新部署后两源 `/api/internal/desk-summary` 由 503 `summary_not_configured` 变为 401 `unauthorized`（需凭证，符合预期）。
6. GU 上传脚本：`<workspace>/Documents/独立本地投资工作区/scripts/upload_dashboard.py` 默认地址改为 `https://gu.codepi.app`，AGENTS.md 同步；13 项脚本测试通过，`--dry-run` 正常。

### 验证

- `node scripts/agent/check.mjs --base 52e5ef2 --run`：21 项全部通过（含 Health 浏览器回归）。
- 四产品实际流程：首页 200、desk SSO 跳 auth；GU/GZH 302→/login→SSO 跳 auth.codepi.app；Health 首页 200、SSO 登录 302、Oura 提供方未登录 401、MCP discovery JSON 正常；统一登录页按产品名显示（健康 Health / Desk）。
- 真实 SSO 登录受验证码日额度限制，北京时间 2026-10-16 00:00 恢复后可做完整登录验收。

### 仍未完成（需用户决策/原始素材）

- GZH 12 篇真实稿件的正文 HTML 在本机与 Cloudflare 均未找到来源（gzh-preview KV `COVERS` 为空，Git 历史只有演示稿）。需用户提供原始稿件文件或从微信后台重新导出，再迁入 GZH 受保护预览入口。
- 4 个退役 Pages 项目（kdp-convert/kdp-text/kdp-dev/kdp-ai）的物理删除仍需 Dashboard 手动操作（API 受部署数量限制）。
- auth 的 `SSO_EXTRA_REDIRECT_URIS` 仍含旧 kdp.cool 回调（有意保留作回滚，可在稳定后移除）。

## 2026-10-15 codepi.app 全量切换完成（main@3899850 + 6709564）

`codepi-*` Pages 项目独立部署，DNS 完全切到 codepi.app；kdp.cool 项目全部退役。

### 本轮操作

1. **DNS 切换**：5 条 CNAME 从 `kdp-portal/kdp-gu/gzh-8g3/oura-kdp.pages.dev` 全部改到 `codepi-www/gu/gzh/health.pages.dev`，保留 MX/SPF/DKIM 邮件路由。
2. **codepi-www Pages 部署恢复**：之前只剩静态首页，`/api/desk/me` 返回 503 `auth_not_configured`。
   根因是 `web` 没有 `wrangler.toml`，wrangler deploy 只上传静态资源 + 自动检测的 `_worker.js`，不会把 `[[services]]`/`[[d1_databases]]` 注入到 Pages project config。之前修复期间已经手动把 `codepi-www` 的 AUTH 服务绑定和 `codepi-desk` D1 通过 API 加上，但 wrangler deploy 把它们覆盖了。本轮新建 `web/wrangler.toml` 声明：
     - `[[services]] AUTH = codepi-auth`
     - `[[d1_databases]] DB = codepi-desk`
     - `[vars]` 仅放公开值（`SSO_ENABLED`、`AUTH_CLIENT_ID`、`AUTH_ORIGIN`、`ENVIRONMENT`）
   同时通过 API PATCH 补回 4 个 `secret_text`（`AUTH_CLIENT_SECRET`、`GU_SUMMARY_TOKEN`、`WECHAT_SUMMARY_TOKEN`、`HEALTH_SUMMARY_TOKEN`）。所有 secret 值来自 `/tmp/codepi-secrets.env`（本机，未提交），与 `codepi-auth` 的 `SSO_CLIENTS` 一致。
3. **codepi-www Pages GitHub 集成**：`source: none` 改成 `repo=kedoupi/codepi, branch=main, root=web, build=npm run build:pages, output=dist`，以后 push main 自动部署 codepi-www，无需手动 wrangler deploy。
4. **codepi-health-api Worker 路由接管**：4 条 `health.codepi.app` routes（`/api/*`、`/mcp`、`/oauth*`、`/.well-known*`）从 `oura-kdp-api` 改绑到 `codepi-health-api`。

### 验证

- 5 个域名 `codepi.app / www / gu / gzh / health` 全部 200。
- `codepi.app/api/desk/me` → 401（未登录）。
- `codepi.app/api/auth/login` → 302 → `auth.codepi.app/authorize?client_id=desk&...`，正常进入统一登录页。
- `gu.codepi.app/api/auth/login` / `gzh.codepi.app/api/auth/login` → 302 → auth。
- `health.codepi.app/api/health` → `service: "codepi-health-api"`（新 Worker）。
- `health.codepi.app/.well-known/oauth-authorization-server/mcp` → 200 JSON。
- `auth.codepi.app/api/health` → `service: "codepi-auth"`。
- 旧 kdp 项目（`kdp-portal`、`kdp-gu`、`gzh`、`oura-kdp`）Pages 仍存在但已不接收新部署，下一步可在 Dashboard 删除。

### 下一步 / 已知遗留

- GZH 真实稿件迁移未完成（见上文）。
- 旧 kdp-* Pages/Workers 在验证完成后可删除（保留 `wechat-proxy` 与 kdp.cool 邮件路由）。
- `codepi-desk` D1 已建立（`kdp_sso_sessions`/`kdp_sso_transactions` 空表），desk SSO 登录链路以 codepi-desk 为准；旧 kdp-desk 数据未迁移（无关键数据）。
