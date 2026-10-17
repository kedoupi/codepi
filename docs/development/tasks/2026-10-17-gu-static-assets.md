# GU 部署载体迁移：Pages → Workers Static Assets

- 状态：已实现并通过本地验证与独立审查修复，待合并发布。
- 目标与验收：把 GU 从 Pages 项目 `codepi-gu`（`vite build` + esbuild 产出 `dist/_worker.js` 的 Pages advanced mode）迁移为 Workers Static Assets 架构的 Worker：`main` 指向 `worker/index.ts`，`dist/` 作为静态资产目录，`assets.run_worker_first = true` 保证所有请求先经 Hono 鉴权链（资产不绕过会话门）。路由表、405/404/403/401/302 语义、安全响应头、SSO/PKCE 行为、`npm test`、`npm run typecheck`、`npm run build` 不改语义继续通过；发布链（workflow、证据、smoke、治理文档）同步从 `wrangler pages deploy` 切到 `wrangler deploy`。
- 不在范围内：业务路由与数据口径、SSO 协议、D1 schema、前端 UI、staging 去留决策（staging 资源保留，迁移后 staging runtime 的承载形式单独记录）、域名切换与 secret 写入的执行（本次 PR 只改代码与发布链；生产切换在合并发布后按本文「切换方案」执行）。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/gu-static-assets`
- 分支：`codex/gu-static-assets`
- 起始 SHA / 审查基线：`a2b18e6ef264a4033f46643f49f07bdf27fa034b`，开工时本地工作区干净。
- 协调者 / 实施者 / 集成者：本任务 Codex；审查者为独立 Codex subagent（只读冻结工作区）。
- 唯一分配记录：本文，由本任务 Codex 维护。
- 允许写入：`apps/gu/`、`.github/workflows/deploy-platform.yml`、`scripts/cloudflare/`、`docs/development/cloudflare-governance.md`、`docs/development/cloudflare-resource-registry.md`、本文。
- 相关先例：[Auth Hono 迁移记录](./2026-10-17-auth-hono.md)（Worker `wrangler deploy` + `deployment-evidence.mjs worker-version` 证据链）、[GU Hono 迁移记录](./2026-10-17-gu-hono-router.md)。

## 设计约束（开工前从代码与 Cloudflare 文档核实）

- 现状架构：`apps/gu/package.json` 的 `build` = `vite build`（web/ → dist/）+ `scripts/bundle-worker.mjs`（esbuild 把 `worker/index.ts` 打包为 `dist/_worker.js`，并复制 `dist/index.html` → `dist/login/index.html`）。`wrangler.toml` 用 `pages_build_output_dir = "./dist"`，发布走 `wrangler pages deploy dist`。
- Worker 已是 Hono（`worker/app.ts` 路由链 + `worker/index.ts` 入口），资产经 `env.ASSETS.fetch()` 显式回源：`/` 与 `/login` 由鉴权中间件保护后转发，`/assets/*` 与 `/favicon.svg` 白名单直发，其余路径 404。因此「资产不能绕过 Worker」在代码层已成立；迁移后由 `run_worker_first = true` 在平台层保证同一性质。
- Cloudflare 文档结论（2026-10-17 查证）：Workers Static Assets 默认资产优先于 Worker；兼容性日期 ≥2025-04-01 且配置 `not_found_handling` 时导航请求会跳过 Worker。GU 是全站鉴权应用，必须 `assets.run_worker_first = true`，且不配置 `not_found_handling`（SPA fallback 语义由 Hono 路由自己承担，保持与现状一致）。
- 迁移要点：`main = "worker/index.ts"` + `[assets] directory = "./dist" binding = "ASSETS" run_worker_first = true`；`dist/_worker.js` 不再生成（esbuild bundle 步骤删除）；wrangler 直接以 Worker 模块格式运行 `worker/index.ts`（TS 由 wrangler 编译）。`ASSETS` binding 名与代码中 `env.ASSETS` 一致，handler 内 503 兜底保留。
- 命名决策：新 Worker 命名为 `codepi-gu`，与现有 Pages 项目同名。Pages 与 Workers 是不同资源命名空间，官方迁移指南明确允许同名；登记表将 `pages-gu` 改为 `worker-gu`，`resource_type` 由 `pages` 改为 `worker`。
- staging 承载：Pages 的 `[env.preview]` 是 Pages preview runtime；Workers named environment 用 `[env.staging]`（与 Health API、Auth 的 `codepi-*-staging` 命名一致），staging 域名后续单独接。staging 去留的最终决策不变（见 workspace-and-deployment.md），本任务只保证配置可表达、不接发布入口。治理守门 `validate-governance.mjs` 为 GU 增加 `kind: 'worker-assets'` 分支：`envKey` 从 `preview` 变 `staging`，staging 名称 `codepi-gu-staging`（登记在案），不要求 routes/crons，并要求 `[assets] run_worker_first = true`。
- 域名与 SSO 兼容窗口：GU Worker 同时服务 `gu.codepi.app`（custom domain，切换时绑定）与 `codepi-gu.<account-subdomain>.workers.dev`（默认启用）。代码按请求 origin 生成 redirect_uri 与 cookie（`app.test.ts`/`sso.test.ts` 已对多 host 建模），**但 Auth 对 callback 做精确匹配**（`services/auth/src/app.ts`）：切换前对 `*.workers.dev` 只能做匿名探针（root 302、login 200、资产、匿名 API 401、SSO `/api/auth/login` 302 跳转生成——跳转目标 URL 本身由 GU 生成，不触发 Auth callback 校验）；workers.dev 域名的完整登录闭环需要在 Auth `SSO_EXTRA_REDIRECT_URIS` 临时登记 workers.dev callback，本任务不登记，workers.dev 不做完整登录验收。
- esbuild 依赖：`scripts/bundle-worker.mjs` 随 Pages advanced mode 一起删除（Worker 源码由 wrangler 直接编译），`esbuild` 从 `apps/gu/package.json` devDependencies 移除并刷新根 lockfile；GZH 仍保留自己的 esbuild，不受影响。
- 发布链：`gu-deploy-production` 改为 `wrangler deploy`，证据解析复用 `deployment-evidence.mjs worker-version`（Auth 已用）；`check-pages.mjs` 的探针（root 302、匿名私有 API 401 JSON、SSO 跳转）与载体无关，保持可用；`apps/gu/scripts/check-deploy.mjs` 的配置校验需从 Pages 字段（`pages_build_output_dir`）改为 Worker 字段（`main`、`assets`）。

## 切换方案（合并发布后执行，属生产变更，单独记录证据）

**前置事实（2026-10-17 核实）**：Pages 与 Workers 运行时 secret 互不可见。已用临时探针 secret 实证：`wrangler pages secret bulk` 写入的 secret 只出现在 `pages secret list`，Workers API 侧 `secret list --name codepi-gu` 报 Worker 不存在（探针 secret 已删除）。Pages secrets API 不回显值，CI 的 API token 无法把 Pages secret 的值复制到 Worker。因此 secrets 的首次写入必须来自 CI 之外的授权渠道。

1. **阶段 A：合并 PR，main 自动发布产出新 Worker `codepi-gu` 的首个 version**。CI 执行 `wrangler deploy` 后在 bootstrap gate 停下（`GU_SECRETS_BOOTSTRAPPED` 未配置时明确报错）：此时只有新 Worker 代码上线，`gu.codepi.app` 仍由旧 Pages 服务，线上无影响。
2. **secrets 一次性人工写入（cloud 侧 break-glass，授权动作）**：把 Pages 侧 secrets（`AUTH_CLIENT_SECRET`、`SESSION_SECRET`、`OTP_PEPPER`、`UPLOAD_TOKEN`、`DESK_SUMMARY_TOKEN`、`INVESTMENT_CALENDAR_ID`；`RESEND_API_KEY` 当前 Pages 侧未配置，以 `pages secret list` 实际清单为准，只列名不读值）以同名同值写入新 Worker。执行人需在本地持有这些值（密码管理器/轮换记录），用 `wrangler secret bulk`（空目录运行，避免 Pages 项目检测）写入，并在登记表写入执行人、SHA、原因；本任务 Codex 不持有也不读取这些值。
3. **阶段 B：同 SHA 重跑发布链**。在 GitHub Environment `production` 配置两项：`GU_SECRETS_BOOTSTRAPPED=1`（environment variable）与 `WORKERS_DEV_SUBDOMAIN`（账户 workers.dev 子域，非机密）。在失败的发布 run 上 re-run failed jobs：bootstrap gate 通过 Workers secrets API 只读校验 `AUTH_CLIENT_SECRET`/`SESSION_SECRET` 名称存在 → pre-cutover smoke 直接探测 `codepi-gu.<subdomain>.workers.dev`（root 302、匿名私有 API 401 JSON、SSO 302 跳转生成；此时 `AUTH_CLIENT_SECRET` 已就位，探测真实通过）→ 旧 `check-pages.mjs gu production`（仍探测旧 Pages，作回归监控）→ 证据记录 `--provider worker --identifier <version>`，与本次部署 version 关联。
4. workers.dev 补充验收：`check-deploy.mjs --url https://codepi-gu.<subdomain>.workers.dev --dist dist` 的资产逐字节比对（登录闭环不做，Auth 未登记 workers.dev callback）。
5. 域名切换（顺序严格）：先删除 zone 内 `gu.codepi.app → codepi-gu.pages.dev` 的 CNAME（Workers custom domain 绑定要求 hostname 无冲突记录）→ 为新 Worker 绑定 custom domain `gu.codepi.app` → 探针通过后移除 Pages 项目的 custom domain 绑定。Pages 项目与全部 deployment 保留，不删除。
6. 回退预案：Pages custom domain 重新绑定 + 恢复 CNAME 到 `codepi-gu.pages.dev`（Pages 项目与 deployment 未动，即刻恢复），探针复核。
7. 全部通过后更新登记表 `last_verified`、README DNS 表与本文。

## 验证证据

- `cd apps/gu && npm test`：15 个测试文件 207/207 通过（Worker 契约 + jsdom 前端，未经修改全部通过）。
- `cd apps/gu && npm run test:scripts`：82/82 通过；`check-deploy-regression.mjs` fixture 改为 Worker 形态，新增 7 个负面用例（缺 `main`、`run_worker_first=false`、缺 assets binding、assets 目录错误、staging 缺 name、`pages_build_output_dir` 残留、`env.preview` 残留）。
- `cd apps/gu && npm run typecheck`：tsc ×2 + svelte-check 0 错误 0 警告。
- `cd apps/gu && npm run build`：产出 `dist/index.html` + `dist/assets/*` + `favicon.svg`，不再产出 `dist/_worker.js` 与 `dist/login/` 副本（Static Assets 的 `auto-trailing-slash` html_handling 由 `/login` → `/login/index.html` 的资产映射承担；注意 `/login` 在 GU 路由中由 Worker 显式回源 `/`，不依赖该映射，见下）。
- `cd apps/gu && npm run check:deploy -- --mode config`：通过（校验项改为 `main`/`[assets]`/`env.staging`/Worker 命名）。
- `node scripts/cloudflare/validate-governance.mjs`：通过。守门为 GU 新增 `worker-assets` 类型：staging 改认 `[env.staging]` + `codepi-gu-staging`，强制 `[assets] directory="./dist" binding="ASSETS" run_worker_first=true` 且禁止 `not_found_handling`；登记表 `pages-gu` → `worker-gu`、新增 `worker-gu-staging`、`d1-gu(-staging)` consumers 与 config_source 同步。
- `node --test scripts/cloudflare/validate-governance.test.mjs`：25/25 通过；fixture topology 中 GU 改为 Worker 形态，新增 3 个守门负例（缺 `run_worker_first=true`、缺 `[assets]` 段、staging 仍用 `env.preview`）。
- `wrangler dev` 双模式探测（本地 loopback，`wrangler dev` 会加载 `[assets]` 与 Worker）：
  - 鉴权语义模式（`.dev.vars` `ENVIRONMENT=development`、`SSO_ENABLED=0`，走旧 OTP 会话门）：`/` 未登录 302→login、`/login` 200 HTML、资产 JS/SVG 200、`/api/health` 200、`/api/me` 401 JSON、`/api/nonexistent` 401、`/nonexistent` 与 `/login/` 404、POST 无 Origin 403、`/robots.txt` 200。编码路径经本地静态层归一化，与 Worker 无关。
  - 生产配置形态（`SSO_ENABLED=1` 但缺 `AUTH_CLIENT_SECRET`）：`/`、`/api/me`、`/api/auth/login` 均为 503 `auth_not_configured`（证明请求确实进了 Worker 鉴权链），而 `/assets/*.js`、`/favicon.svg`、`/login`、`/robots.txt` 仍 200（证明 `run_worker_first=true` 下 Worker 内 `ASSETS.fetch` 回源正常，资产没有被平台层短路截获）。这两组共同证明：静态资产不可能绕过 Worker 代码被匿名命中。
- 契约对照：Worker 代码（`worker/app.ts`、`worker/index.ts`）零改动；207 项 vitest 契约（含 routing 中间件顺序、编码路径、HEAD 语义）在原样代码上全过，载体差异只存在于 wrangler 配置与发布链。基线 Pages bundle 与新 Worker 的运行时差异点仅有：入口编译器（esbuild → wrangler 内置）、`/login` 静态副本取消（改由 Worker 回源 `/`，行为不变）、`wrangler dev` 取代 `wrangler pages dev`。
- 全仓 `node scripts/agent/check.mjs --base a2b18e6ef264a4033f46643f49f07bdf27fa034b --run`：23 项全部通过，覆盖 Auth、首页/Desk、GU、GZH、Health、shared auth client、治理与工作流检查，含 Health 浏览器回归。

## 独立审查与修复

- 审查者 Euclid（独立 Codex subagent，只读），绑定 `953cc0e83b603c8efc79aad35982cbe9bd7070e7`。**初审结论：不可合并**，两项 P1 与四项 P2/P3 全部成立并已修复：
  - P1（部署证据错配）：smoke 固定探测 `gu.codepi.app`，切换前该域名仍指旧 Pages，新 Worker 故障也能拿到 `--smoke pass`。修复：deploy 后新增 pre-cutover smoke，`check-pages.mjs` 支持 `--origin` 直接探测 `codepi-gu.<subdomain>.workers.dev`，失败阻断证据记录。
  - P1（切换顺序）：原方案把认证验收排在 secret 配置之前，`SSO_ENABLED=1` 缺 `AUTH_CLIENT_SECRET` 时全是 503，顺序不可通过。修复：切换方案改为 deploy → secrets 一次性写入 → workers.dev 验收 → 域名切换。
  - P2（secrets 复制不可行）：初版 CI step 用不存在的 `wrangler pages secret put --worker` 复制 secrets；实证 Pages/Workers secret 命名空间互不可见且 API 不回显值，已在切换方案中改为授权渠道一次性写入并删除该 step。
  - P2（workers.dev 登录承诺过度）：Auth 对 callback 精确匹配，workers.dev 未登记则不能承诺完整登录；文档改为只做匿名探针验收。
  - P2（staging assets 覆盖漏洞）：`[env.staging.assets]` 可覆盖 `run_worker_first` 且守门漏判。修复：守门与 `check-deploy.mjs` 均禁止任何环境级 assets 声明，新增负例测试。
  - P2（TOML 轻量解析漏报/误报）：重复 `[assets]` 表被拼接、`run_worker_first = ["/api/*"]` 数组形式漏判。修复：守门改为校验唯一表 + 唯一布尔 `true` 赋值，新增 4 个负例。
  - P2（域名切换遗漏 CNAME 冲突）：切换步骤补「先删 CNAME → 绑 Worker custom domain → 通过后移除 Pages 绑定」的明确顺序与回退动作。
  - P3（文档收尾）：状态行过期、`apps/gu/README.md` 的 `../docs` 相对链接错误（应为 `../../docs`），均已修正。
- 审查者复核（待补）
- 复审（同一审查者，绑定 `d7493b111e38687b9f995bb9f223fedbe6b420c7`）**结论：不可合并**，剩余 2×P1 + 2×P2 已修复：
  - P1（`WORKERS_DEV_SUBDOMAIN` 未注入）：发布链新增显式 bootstrap gate step；`WORKERS_DEV_SUBDOMAIN` 与 `GU_SECRETS_BOOTSTRAPPED` 均要求在 GitHub Environment `production` 显式配置，workflow 注释与任务文档写明。
  - P1（首次部署仍先跑鉴权 smoke）：发布链改为显式两阶段——阶段 A deploy 后 bootstrap gate 停止（旧 Pages 不受影响）；人工写入 secrets 并配置 `GU_SECRETS_BOOTSTRAPPED=1` 后 re-run failed jobs，gate 只读校验 secret 名称存在才放行 pre-cutover smoke。证据记录始终在完成验收的同一 run 内。
  - P2（治理规范未同步 CNAME 顺序）：`cloudflare-governance.md` 域名切换条款已写明删旧 CNAME → 绑 Worker custom domain → 移除 Pages 绑定的顺序与回退。
  - P2（环境 assets 覆盖的 TOML 变体逃逸）：守门新增表头规范化（去空格、去 quoted key 引号），`[ env.staging.assets ]`、`[env.staging."assets"]` 等合法变体统一归一后拒绝；新增对应负例（守门测试 30 项全过）。
- 第三轮审查（同一审查者，绑定 `6964752008773a776a3908c30972c502d582366c`）**结论：不可合并**，1×P1 + 3×P2 已在 `a0279fb` 修复：
  - P1（Environment 变量未映射 shell）：gate 与 pre-cutover smoke 两个 step 显式 `env:` 映射 `${{ vars.GU_SECRETS_BOOTSTRAPPED }}` 与 `${{ vars.WORKERS_DEV_SUBDOMAIN }}`；PyYAML 解析全 workflow 验证，gate 脚本提取后按未武装/武装/缺 secret 三种场景实际 bash 执行通过。
  - P2（grep 匹配 JSON）：gate 改 node 解析，校验 `success===true`、数组形态与 `secret_text` 类型；5 种本地场景验证（紧凑/格式化 JSON 接受，success:false/缺 secret/type 不符拒绝）。
  - P2（顺序测试不锁定）：改精确 step 名 + 严格递增断言，新增 vars→env 接线、JSON.parse、`--origin` 断言。
  - P2（TOML quoted key 残余变体）：表头规范化支持单引号 literal 与双引号 `\uXXXX` 转义解码，新增 2 个负例（守门测试 31 项全过）。
- 终审（同一审查者，绑定 `a0279fbcb50c499d061fa4fb93edeae4c3cce8f2`）**结论：可以合并**；残余非阻塞建议（gate 管道启用 `pipefail` 传播 curl 失败）已在 `28d43df` 修复。

## PR 与自动发布

（待补）

## 继续工作

（待补）
