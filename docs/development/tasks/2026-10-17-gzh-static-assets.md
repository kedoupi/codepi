# GZH 部署载体迁移：Pages → Workers Static Assets

- 状态：PR #72 已合并，凭证已配对重建，正式域名已切换；main 发布 run 第二次执行成功，匿名检查与线上资产比对通过。独立复核确认路径问题已修复，无阻塞。完整生产登录与稿件流程尚未验收。
- 目标：延续 GU 已落地的部署模型，使 GZH 通过 `wrangler deploy` 发布 Worker 和静态资产，保留稿件、预览、SSO、Desk 摘要的边界。
- 用户决策：按最终架构重建旧测试状态；自有凭证可以生成新值并配对更新消费者，不要求找回旧值。此前 PR、API、合并和发布授权继续适用。
- 起始 SHA：`b5c3a01351138274edf5230a5c07ac64760c1f7f`，主工作区与任务工作区干净。
- worktree：`<workspace>/.worktrees/kdp.cool/codex/gzh-static-assets`；分支：`codex/gzh-static-assets`。发布证据续作位于 `<workspace>/.worktrees/kdp.cool/codex/gzh-runtime-evidence`，分支 `codex/gzh-runtime-evidence`，基线 `da06d1d067176653b693cdf72211826698684abb`，由同一 Codex 写入文档。
- 协调者、唯一写入者、共享配置负责人、集成者：当前 Codex。独立审查者 Gauss（`01a149e1-bfba-7d23-89f6-ca5b838f74fc`）只读冻结快照，结论见下方。
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
- 本地合成 OTP 浏览器回归：桌面/手机看板、正文预览、阅读门槛解锁、退出全通过；证据 `/tmp/codepi-gzh-static-assets-browser`。没有发送真实邮件。修复后桌面/手机全流程再次通过，证据 `/tmp/codepi-gzh-static-assets-browser-v2`。

## 一次性云资源初始化

- 通过 Cloudflare API 先确认 `codepi-gzh` Worker 不存在，再创建仅返回 503/no-store 的空 Worker，作为 secret 的承载对象。这与 Wrangler `secret put` 对新服务创建 draft Worker 的方式一致。
- 初始化不携带 D1、ASSETS、route 或正式 custom domain。应用代码仍只通过 main workflow 发布；没有把空 Worker 当作已部署产品。
- Auth/首页凭证、GZH SSO 事务和正式域名在此步骤尚未修改。

## 修复后的验证与凭证重建

- `node scripts/agent/check.mjs --base b5c3a01351138274edf5230a5c07ac64760c1f7f --run` 第二轮 23 项全部通过（含全部应用与共享登录、Health 正常/SSO 浏览器）；GZH 12 个测试文件、102 项测试通过。
- 真实本地 Wrangler 追加核验 7 种异常路径：全部 404/no-store；3 条规范私有路径仍要求登录；带编码 `next` query 的登录页正常。修复前后的 UI 构建与资产哈希一致。
- Gauss 复核 `3545597` 和冻结的 21 文件哈希，确认原 P1 已关闭，没有有效路径或 SSO query 回归，无合并阻塞。
- 一次性 API 生成两组随机凭证并完成 4 次成功配对写入：GZH `AUTH_CLIENT_SECRET` ↔ Auth `SSO_CLIENT_SECRET_GZH`；GZH `DESK_SUMMARY_TOKEN` ↔ 首页 production `WECHAT_SUMMARY_TOKEN`。首页采用最小 PATCH，前后 env key 集合一致；没有输出或落地值。
- 首次 API 调用在额外站外 fetch 探针阶段返回 `INVALID_ARGUMENT`，但 secret 名称已存在；随后在不调用外部 fetch 的独立请求中重新生成并完整配对，四处均返回 200。此记录只证明成功配对写入，不声称真实认证请求已验收。
- GZH D1 `acedb64c-d374-4e40-b61e-7df7f0766694` 中 SSO session 原为 0、transaction 为 1；轮换后清除旧 SSO 状态，复查均为 0。稿件业务表、中央会话和其他应用会话没有修改。
- 切换前生产旧 Pages 的三种 alias 只读探针均为 200/public cache；响应正文均取消读取。切换后新 Worker 和正式域名均为 404/no-store。

## PR 与发布

- PR #72 的固定提交 `3545597387cc2e9380e1d755a9f96e1c91a9f7a1`，PR CI run `39034360836` 成功。
- squash 合并为 `da06d1d067176653b693cdf72211826698684abb`，触发 main 自动发布 run `39034618586`。
- 首次发布的 GZH Worker version 为 `8f37a10e-6ed4-4033-983a-ea11b3e42459`，deployment 为 `c9d3d16e-c051-4da0-a34c-d0d890dee213`，100% 流量；CI checkout SHA、Wrangler 输出与 Cloudflare deployments API 一致。
- 首次 run 的全部构建、Auth/GU/首页发布通过。GZH 的 deploy、运行配置校验、新 Worker smoke 通过，正式域名 smoke 以 `200 !== 404` 拒绝旧 Pages 的预览 alias；Health 发布按依赖被跳过，没有降低门禁。
- 切换后通过 GitHub API 重跑 failed jobs；run `39034618586` 的 attempt 2 于 `2026-10-17T13:07:18Z` 以 `success` 完成，Health API 与前端后续发布均完成。
- GZH 重跑的最终 version 为 `8c6d3232-edf2-4252-b044-b2c20815ecb3`，deployment 为 `183bdf40-bb00-448d-8ecb-bb08839dc987`，100% 流量；CI 日志与控制面一致。证据 artifact `12101404389` 关联同一 source SHA、version 与 `smoke=pass`。

## 正式域名切换

- 切换前核实新 Worker 的 `ASSETS`、production `AUTH=codepi-auth`、D1 `acedb64c-d374-4e40-b61e-7df7f0766694`、SSO vars 及两个必需 secret 名；再次执行新 Worker origin smoke，通过。
- 通过 API 精确核对并删除旧 CNAME `5f59f0dff6f7defb6cb04c3950dd57db`（`gzh.codepi.app → codepi-gzh.pages.dev`）。
- 绑定 Worker custom domain `22b49af86b814e7ece3bc5d8e747c7b80830fe0f` 到 `codepi-gzh`；Cloudflare 自动建立 proxied `AAAA 100::`，DNS record 为 `4c9d8b5217da0d820e25ea3ffec8d334`。
- 绑定后的初次正式域名探针仍读到旧 Pages 响应；控制面已确认 Worker 域名与 DNS 一致，zone 内没有 GZH 的冲突 Worker route。等待路由生效后，同一 smoke 在不改断言、不清缓存的情况下通过。
- 正式域名 smoke 通过后才删除旧 Pages 的 `gzh.codepi.app` 绑定（ID `f61b65be-1291-4e44-a0c1-97869a177b2a`），删除后再次验证通过。
- 旧 Pages 项目与 deployment 保留，仅有 `codepi-gzh.pages.dev` 与 `gzh-staging.codepi.app`；不作为无需配置修复的登录回退方案。旧 provider/staging 入口不属于新 Worker 路径修复的覆盖范围，最终退役另行处理。

## 切换后核验与剩余边界

- 正式 `/login` 和三个公开客户端资产与本地已审查构建逐字节一致；登录 HTML SHA-256 仍为 `773a81c9fdde882de0bcb99498ce2629afe4b243d2fa10b321b80fe1f3576f5e`。
- 首页/Desk、GU、GZH 匿名 API 与 SSO 跳转 smoke 通过；Auth health 为 200 JSON。继续请求中央 `/authorize` 验证 GZH 生产 callback 得到登录表单，替换为 staging callback 被 400 拒绝；未发送真实 OTP。
- Health 16 项接口检查全部通过，线上 build 为 `da06d1d06717`，私有 API、MCP challenge 和 OAuth discovery 未回退为 HTML。
- 本轮未进行登录后的 code exchange、Desk 摘要、稿件编辑/保存或真实邮件验收，也未删除业务数据、旧 Pages 项目或 staging 资源。

| 计算资源 | 最后核实的 provider 标识 | 版本关联 |
| --- | --- | --- |
| GZH Worker | deployment `183bdf40-bb00-448d-8ecb-bb08839dc987`；version `8c6d3232-edf2-4252-b044-b2c20815ecb3` | run attempt 2 日志和控制面一致 |
| Auth Worker | deployment `ddf9a3dc-a3e1-4566-ab2a-654618b89460`；version `3a26627f-9844-40d3-9aa7-2e7dc4e35097` | 本轮发布成功，控制面当前版本 |
| GU Worker | deployment `2483767a-ea00-4775-9c75-56016ce564ff`；version `8334cd71-9dd0-48d9-90ce-52ec63fd32fe` | 本轮发布成功，控制面当前版本 |
| 首页 Pages | `a3f9dc6a-415b-498a-bb35-851268533898` | canonical commit = `da06d1d`，`commit_dirty=false` |
| Health API | deployment `9319ffba-eb0a-4021-843b-115982233390`；version `07f96cc2-8c65-4104-829e-e29af023dcf8` | 线上 build = `da06d1d06717` |
| Health Pages | `3eacdb08-5094-4bfe-bd77-2cac351ab723` | canonical commit = `da06d1d`，`commit_dirty=false` |

## 文档续作与清理

- 续作仅同步 README、架构模型、资源登记和本记录四个文档，不改应用代码、依赖或发布 workflow。
- `node scripts/agent/check.mjs --base da06d1d067176653b693cdf72211826698684abb --run` 的三项检查通过：64 项 CF 回归、治理守门、22 项 Agent 检查回归；`git diff --check` 通过。
- `codex/gzh-static-assets` 从 `b5c3a01` 起的累计补丁，与 main 的 squash 提交 `da06d1d` 完全等价，stable patch ID 均为 `abdf99a14265130e3bf90a3fd0e7eea0070734fe`。
- 旧实施工作区无未提交或未跟踪文件，忽略项仅依赖、构建及本地合成测试产物；已移除该 worktree 及对应本地、远程分支。云端 D1 与业务数据不属于本地工作区清理范围。
- 文档续作工作区在本 PR 合并并核对 main 后回收；最终状态以 Git/PR 记录为准。下一产品迁移为首页/Desk，随后 Health。
