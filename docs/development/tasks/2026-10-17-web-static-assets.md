# 首页 / Desk 部署载体迁移：Pages → Workers Static Assets

- 状态：已切换。`codepi.app` 与 `www.codepi.app` 均由 `codepi-www` Worker 服务，发布、双域名切换与切换后核验全部通过。
- 目标：首页与 Desk 经同一个 `codepi-www` Worker 发布；公开静态页面保持 Astro 输出，`/api/*` 进入 Desk 后端，`/desk` 页面由 Worker 维护规范域名与隐私响应头。
- 用户决策：延续已授权的 PR、合并、发布、API 配置和域名切换；项目自有凭证可配对重建，旧测试登录态可失效。不删除业务数据。
- 起始 SHA：`78ec7766487ca1c5cb6a3c6019935ced9ca480a4`；本地与远程 main 一致，主工作区干净。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/web-static-assets`；分支：`codex/web-static-assets`。
- 证据续作：`/Users/codepi/.worktrees/kdp.cool/codex/web-runtime-evidence`，分支 `codex/web-runtime-evidence`，基线 `a6b1859d946d300814857349a23e50c2ab3f248a`，同一 Codex 仅更新文档。
- 协调者、唯一写入者、共享配置负责人、集成者：当前 Codex；独立审查者 Averroes（`01a14a65-a268-7551-9810-5bf13f957a52`）只读冻结快照。
- 写入范围：`apps/web/`、部署 workflow、Agent 检查映射、Cloudflare 治理脚本及测试、README、架构及资源记录。
- 依赖：现行 Auth 与三个摘要提供方；认证协议、业务 API、D1 schema 和前端 UI 不变。

## 实施与验收

1. 使用 `worker/index.ts` 包装现有 Desk handler；`assets.run_worker_first = ["/api/*", "/desk", "/desk/*"]`，其余请求走静态资产，未知地址保持 404。
2. 保留 Static Assets 支持的 `_headers`、路径型 `_redirects` 与 404 页面；域名型跳转移入 Worker；移除 Pages Functions 和 `_routes.json`，排除旧 `_worker.js`/`_routes.json` 构建残留。
3. production 使用 `codepi-www` Worker；staging 改为 `codepi-www-staging` named environment，保留未启用。旧 Pages staging 域名另行记账。
4. 发布记录 Worker version，并通过 API 校验四个 secret 名和新 Worker origin；先探测新版本，再探测正式域名。
5. 本地验证涵盖真实 Static Assets 路由、静态安全头、Desk no-store、资源不存在时的 404、API 不被同名静态文件覆盖、SSO 和合成数据浏览器回归。
6. 独立审查后 PR 合并，main workflow 发布。四组凭证在 API 内存中生成并配对写入：Desk `AUTH_CLIENT_SECRET` ↔ Auth `SSO_CLIENT_SECRET_DESK`，三份摘要 token ↔ 各源 Worker 的 `DESK_SUMMARY_TOKEN`。值不输出、不落地。
7. 按治理顺序逐一切换 `www.codepi.app` 与 `codepi.app`：核实新版本与配置 → 移除准确旧 CNAME → 绑定 Worker custom domain → 探针通过 → 移除旧 Pages 正式绑定。

## 基线控制面

- 首页 Pages canonical deployment：`a3f9dc6a-415b-498a-bb35-851268533898`，源码 `da06d1d067176653b693cdf72211826698684abb`，干净构建。
- apex 与 www 均指向 `codepi-www.pages.dev`；旧 CNAME ID 分别为 `76a472a9535fd1614027070722a7972e`、`6bf54ebaada2cce19f8db24672ba148e`。
- 现行 production 绑定 `AUTH=codepi-auth`、D1 `adfb0f6e-b776-471b-9f25-71982b53cbc4`；保留 preview 绑定 staging Auth/D1。

## 验收边界

不发送真实 OTP、不改稿件或投资数据、不触发 Oura 同步。生产完整登录/退出、登录后 Desk 三来源摘要仍需真实账号验收；匿名探针、本地合成流程和配置配对写入不能代替它们。旧 Pages 项目与 staging 资源保留至最终退役阶段。

## 路由差异与验证

- Workers Static Assets 不支持旧 `_redirects` 的域名级规则。本地实测确认直接沿用会使 www Desk 不再跳到 apex，因此将 `/desk`、`/desk/*` 纳入 Worker-first，统一规范域名和 no-store/noindex/no-referrer 响应头。路径型跳转继续由资产服务执行，404 保留既有页面。
- 第一版本测试 harness 未提供本地 Auth，Wrangler 启动失败；改用已安装的 Miniflare/workerd 及明确的合成 Auth binding，并启用资产路由器的 user-worker binding。没有放宽 401 或静态头断言。生产配置由 Wrangler dry-run 独立核验。
- 冻结提交 `e6403c9162f65a0669f0229fc4a5dc365d9f4726` 上的 23 项 affected checks 全通过，包含所有应用、共享登录及 Health 正常/SSO 浏览器回归。
- 真实 Static Assets 回归验证公开页逐字节一致、Desk 缓存/索引限制、同名静态 API 文件不能覆盖后端、旧服务端产物不公开、www canonical、路径跳转和 404 页面。
- production/staging Wrangler dry-run 均通过，服务端包 21.44 KiB；无依赖、业务 schema 或 UI 改动。
- Desk 合成 OTP 浏览器验收通过：桌面、320/390px 手机宽度、三来源摘要、周范围、部分失败/空状态、退出与隐私数据清除。截图目录 `/var/folders/tf/by849xr51djfhx_x0fw2rqth0000gn/T/kdp-desk-browser-W2GPLr`，已查看桌面和手机截图。
- Averroes 审查全部 23 文件，没有发现真实缺陷或阻塞；独立运行 67 项 Cloudflare/发布回归、22 项 Agent 回归、治理守门和 diff 格式检查，均通过。

## 云端初始化与凭证配对

- API inventory 核实 `codepi-www` Worker 不存在后，创建仅返回 503/no-store 的空 Worker 作为 secret 承载对象；不绑定 D1、生产域名或资产。应用代码只由 main workflow 发布。
- 启用新 Worker 的 `codepi-www.kedoupi.workers.dev` 探针入口，`previews_enabled=false`。
- 在 API 执行内存中分别生成四组随机值，完成八次成功写入：Desk/Auth 的 SSO secret，以及 Desk/Health API、Desk/GU、Desk/GZH 三组摘要 secret。未返回、记录或落地值，未更改第三方凭证。
- SSO client secret 同时用于加密 Desk 本地 central session reference；旧值不可恢复，因此清理 Desk D1 中 1 条 SSO 会话及 3 条登录事务，复查为 0。未改中央会话、其他应用登录态或业务表。
- 旧 Pages deployment 仍持旧配置；轮换至正式切换之间，旧 Desk 登录/摘要可能暂不可用。旧 Pages 不属于无需重配凭证即可回退的版本。

## PR 与自动发布

- PR #74，head `e6403c9`，PR CI run `39043727867` 成功。
- squash 合并为 `a6b1859d946d300814857349a23e50c2ab3f248a`；本地 main 已 fast-forward 到同一 SHA。
- main 自动发布 run `39044015990` 于 2026-10-17T15:16:45Z 完成，conclusion `success`。`www-deploy-production` 经 Wrangler 发布 Worker version `e69b7406-a76e-476d-9d0a-3442d007dd9c`，deployment `07dedb44-cfa8-465d-ba17-ebe654e2b3e3` 承载 100% 流量，evidence artifact `12105570342`。

## 域名切换与切换后核验

- `www.codepi.app`：删除旧 Pages CNAME `6bf54ebaada2cce19f8db24672ba148e`，绑定 Worker custom domain `ec616ae6999662e58d84b11571c01d0d3d524014`（service `codepi-www`，enabled，`previews_enabled=false`）。
- `codepi.app`：删除旧 Pages CNAME `76a472a9535fd1614027070722a7972e`，绑定 Worker custom domain `d2bf92983ccffa940bc854e96ac5b787b1d6a0d9`（同配置）。MX/TXT 邮件记录未受影响。
- 切换后 apex 与 www 均返回 200，HTML 与本地 dist 逐字节一致；`/desk` 在 www 上 302 规范到 `https://codepi.app/desk/`。初次探针在 apex 切换瞬间命中边缘缓存返回了旧合并头，重试后稳定为 `Referrer-Policy: no-referrer`，与本地 Miniflare/workerd 行为一致；未放宽断言。
- 生产 smoke 全过：7 个页面与 4 个 `_astro` 资源字节一致，`/_worker.js`、`/_routes.json`、`/_headers`、`/.assetsignore` 与不存在的路径均 404，自定义 404 匹配，`/privacy-policy/` 301 到 `/privacy/`，www canonical、跨域写拒绝、生产 callback 接受、staging callback 拒绝均符合，未发送 OTP。脚本 `/tmp/codepi-web-static-assets-smoke.mjs`。
- 三产品连带核验：`gu.codepi.app`、`gzh.codepi.app` 匿名 302 跳登录，`auth.codepi.app/authorize` 400（缺参数，服务正常），`codepi.app/api/desk/me` 匿名 401。
- Pages 项目 `codepi-www` 的 `codepi.app`、`www.codepi.app` 自定义域名绑定已移除（Pages 项目、`codepi-www.pages.dev`、`staging.codepi.app` 保留）。
