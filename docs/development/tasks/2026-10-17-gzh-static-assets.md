# GZH 部署载体迁移：Pages → Workers Static Assets

- 状态：本地迁移已验证，独立审查发现并修复存量预览路径绕过，复核中；生产域名仍由 Pages 服务。GZH Worker 已预创建用于凭证初始化，尚未发布应用。
- 目标：延续 GU 已落地的部署模型，使 GZH 通过 `wrangler deploy` 发布 Worker 和静态资产，保留稿件、预览、SSO、Desk 摘要的边界。
- 用户决策：按最终架构重建旧测试状态；自有凭证可以生成新值并配对更新消费者，不要求找回旧值。此前 PR、API、合并和发布授权继续适用。
- 起始 SHA：`b5c3a01351138274edf5230a5c07ac64760c1f7f`，主工作区与任务工作区干净。
- worktree：`<workspace>/.worktrees/kdp.cool/codex/gzh-static-assets`；分支：`codex/gzh-static-assets`。
- 协调者、唯一写入者、共享配置负责人、集成者：当前 Codex。独立审查者只读冻结快照，审查者 Gauss（`01a149e1-bfba-7d23-89f6-ca5b838f74fc`）只读冻结快照，结论见下方。
- 写入范围：`apps/gzh/`、部署 workflow、Cloudflare 治理脚本及测试、相关架构与资源记录、README。
- 依赖：现行 Auth 的 `SSO_CLIENT_SECRET_GZH` override；首页 Pages 的 `WECHAT_SUMMARY_TOKEN` 消费 GZH 摘要。认证协议和 D1 schema 不变。

## 实施与验收

1. `main` 指向 `worker/index.ts`，`assets.directory=./dist`、`binding=ASSETS`、`run_worker_first=true`。所有请求先进 Worker，私有预览正文不能绕过会话门。
2. 构建只输出客户端文件，保留独立预览会话脚本；移除 Pages `_worker.js` 打包和多余登录页副本。Wrangler 负责服务端打包。
3. production 使用 `codepi-gzh` Worker；保留的 staging 配置迁至 `codepi-gzh-staging` named environment，不接发布入口。旧 staging Pages 域名暂留，不能宣称新 staging 已启用。
4. 发布复用 GU 的运行配置名称检查、新 Worker origin 查询、切换前探针与 Worker version 证据，不增加人工开关或旧 OTP secret 要求。
5. 本地执行治理回归、应用测试/类型检查/构建、Worker dry run、实际静态资产与鉴权检查，以及受影响检查。桌面/移动预览与阅读门槛用本地合成数据验证。
6. 完成独立审查后按正常 PR 合并与 main 自动发布。内部 SSO/摘要凭证在 API 执行内存中生成，并配对更新 Auth/GZH/首页；值不输出、不落地。仅失效无法继续使用的 GZH SSO 会话/事务，不改稿件和其他应用会话。
7. 新 Worker 探针通过后按治理顺序切换 `gzh.codepi.app`：删除准确旧 CNAME → 创建 Worker custom domain → 验证 → 移除 Pages 正式域名绑定。旧 Pages 项目和 staging 资源保留待最终退役。

## 核验基线与前序收尾

- Git 拉取正常；本机 `gh auth status` 仍报告凭证失效，GitHub 管理操作使用已连接 API。
- PR #71 已 squash 合并为起始 SHA；控制面确认 GZH Pages canonical deployment 为该 SHA，GU 当前 Worker version 为 `49c7400a-7dd0-46e8-adba-388b1e42d14a`，正式域名仍绑定 `codepi-gu`。
- 已通过 GitHub 通用只读 API 核实 #71 main push 发布 run `39032869422`，结论 `success`；另一个 SSO 验证 run `39032869415` 同样成功。指定 SHA 的 PR-run 查询为空不表示 push 未执行。
- GU 三个旧任务工作区均无未提交/未跟踪文件；累计补丁分别与 `33207cd`、`953f4ad`、`b5c3a01` 完全等价。忽略项仅依赖、构建和本地 Wrangler 产物；三个 worktree、对应本地和远程分支已删除。旧本地 Wrangler 产物留在 `/tmp/codepi-gu-static-assets-local-state-20261017.tgz` 与 `/tmp/codepi-gu-runtime-bootstrap-local-state-20261017.tgz`，不属于项目交付。

## 真实流程边界

本轮不发送真实 OTP 或对外发布稿件。实际 OTP 投递、生产完整登录/退出、登录后的 Desk 摘要与稿件流程分别记账；匿名探针、secret 名称存在和本地合成登录不能代替这些验收。

## 审查发现与修复

- 初次冻结的 19 文件快照经独立审查，发现基线已有的路径解析差异：`/%70reviews/...`、`/previews%2f...`、`//previews/...` 可绕过原始 pathname 会话门，随后由 ASSETS 规范化并返回私有正文；没有会话脚本且可公开缓存。
- 在 Worker 入口统一拒绝包含路径编码、反斜杠或重复斜杠的非规范路径，返回 404 / no-store。现有路由和资产名均使用普通路径段；编码的 query（如登录 next）仍有效。
- 新增 Worker 回归覆盖 7 种路径变体与编码 query；生产 smoke 覆盖 3 种实际绕过路径，不能仅凭规范 URL 的 302 宣称安全。
- 旧 Pages 有同一漏洞，因此首次发布可能在正式域名 smoke 失败。必须先确认新 Worker 版本、运行配置与包含这些路径的探针通过，再切换域名，之后重跑失败的发布 job；不放宽断言或把旧域名结果当作新 Worker 验收。

## 本地证据

- 修复前迁移快照的 23 项 affected checks 全通过；production/staging Wrangler dry-run 均通过，服务端包 119 KiB。
- 本地真实 Worker + ASSETS：4 条规范私有路径匿名 302/no-store，4 条未知/旧产物路径 404，登录 HTML 与构建 index 一致，3 个客户端资产逐字节一致。index SHA-256 为 `773a81c9fdde882de0bcb99498ce2629afe4b243d2fa10b321b80fe1f3576f5e`。
- 本地合成 OTP 浏览器回归：桌面/手机看板、正文预览、阅读门槛解锁、退出全通过；证据 `/tmp/codepi-gzh-static-assets-browser`。没有发送真实邮件。修复后的追加验证另行记录。

## 一次性云资源初始化

- 通过 Cloudflare API 先确认 `codepi-gzh` Worker 不存在，再创建仅返回 503/no-store 的空 Worker，作为 secret 的承载对象。这与 Wrangler `secret put` 对新服务创建 draft Worker 的方式一致。
- 初始化不携带 D1、ASSETS、route 或正式 custom domain。应用代码仍只通过 main workflow 发布；没有把空 Worker 当作已部署产品。
- Auth/首页凭证、GZH SSO 事务和正式域名在此步骤尚未修改。
