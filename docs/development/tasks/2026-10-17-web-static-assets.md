# 首页 / Desk 部署载体迁移：Pages → Workers Static Assets

- 状态：实施中，尚未合并、发布或切换域名。
- 目标：首页与 Desk 经同一个 `codepi-www` Worker 发布；公开静态页面保持 Astro 输出，`/api/*` 进入 Desk 后端，`/desk` 页面由 Worker 维护规范域名与隐私响应头。
- 用户决策：延续已授权的 PR、合并、发布、API 配置和域名切换；项目自有凭证可配对重建，旧测试登录态可失效。不删除业务数据。
- 起始 SHA：`78ec7766487ca1c5cb6a3c6019935ced9ca480a4`；本地与远程 main 一致，主工作区干净。
- worktree：`<workspace>/.worktrees/kdp.cool/codex/web-static-assets`；分支：`codex/web-static-assets`。
- 协调者、唯一写入者、共享配置负责人、集成者：当前 Codex；审查者只读冻结快照。
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
