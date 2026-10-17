# GU 部署载体迁移：Pages → Workers Static Assets

- 状态：进行中。本文刚建立，代码未修改。
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
- 域名与 SSO 兼容窗口：GU Worker 同时服务 `gu.codepi.app`（custom domain，切换时绑定）与 `codepi-gu.workers.dev`（默认启用，用于切换前验收）。代码按请求 origin 生成 redirect_uri 与 cookie（`app.test.ts`/`sso.test.ts` 已对多 host 建模），因此切换窗口内两个域名都可完整登录，无需 Auth 侧新增回调登记。
- esbuild 依赖：`scripts/bundle-worker.mjs` 随 Pages advanced mode 一起删除（Worker 源码由 wrangler 直接编译），`esbuild` 从 `apps/gu/package.json` devDependencies 移除并刷新根 lockfile；GZH 仍保留自己的 esbuild，不受影响。
- 发布链：`gu-deploy-production` 改为 `wrangler deploy`，证据解析复用 `deployment-evidence.mjs worker-version`（Auth 已用）；`check-pages.mjs` 的探针（root 302、匿名私有 API 401 JSON、SSO 跳转）与载体无关，保持可用；`apps/gu/scripts/check-deploy.mjs` 的配置校验需从 Pages 字段（`pages_build_output_dir`）改为 Worker 字段（`main`、`assets`）。

## 切换方案（合并发布后执行，属生产变更，单独记录证据）

1. 合并 PR，main 自动发布产出新 Worker `codepi-gu` 的首个 version；先核 `*.workers.dev` 全路径探针（root 302→login、login 200、资产逐字节、匿名 API 401、SSO 跳转、编码路径/HEAD 语义）。
2. 把 Pages 侧 secrets（`AUTH_CLIENT_SECRET`、`SESSION_SECRET`、`OTP_PEPPER`、`UPLOAD_TOKEN`、`RESEND_API_KEY` 等，以 Pages 项目实际 secret 清单为准，只列名不读值）以同名同值写入新 Worker。
3. 新 Worker 绑定 custom domain `gu.codepi.app`（Workers custom domain 与 Pages custom domain 同 zone 切换，顺序：Worker 绑定成功且探针通过后再移除 Pages 侧绑定）。
4. 回退预案：重新把 `gu.codepi.app` 指回 Pages 项目（Pages 项目与 deployment 保留，不删除），DNS/绑定恢复后探针复核。
5. 全部通过后更新登记表 `last_verified` 与本文。

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

（待补）

## PR 与自动发布

（待补）

## 继续工作

（待补）
