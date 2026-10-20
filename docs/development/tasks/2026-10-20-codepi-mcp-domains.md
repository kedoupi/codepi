# CodePi MCP 领域扩展

- 状态：PR #121 已合并为 `f951f0fd97c784c6c3b5b480ac2ec2a793139828`；2026-10-20 从实时 main `58bd615c317d` 发布十个 Worker，SSO、匿名拒绝、版本漂移、完整备份和 v3 隔离恢复均通过。Project 只读 `GITHUB_TOKEN` 已配置，五个来源的真实 Cron 同步通过；Me 尚无正式非空导入原文。
- 目标：统一 MCP 的逐工具授权与概览，Project 项目卡和任务交接、官方 SDK CLI、Me 确认区和分块导入、GU 线上工作区只读查询；补齐运维登记和本地合成验证。
- 依据：2026-10-20 用户确认的实施计划；两份 PDF 是需求来源，以下修正优先于 PDF。
- worktree：实现时为 `<workspace>/.worktrees/kdp.cool/codex/codepi-mcp-domains`；最终发布复核使用 `<workspace>/.worktrees/kdp.cool/release-58bd615`
- 分支：`codex/codepi-mcp-domains`
- 基线：实现始于 `abbafdfe2d04966d66dad2f4f0084075f040caaf`，先 rebase 到 `2820de261b4134fff538679e6f886ac62f4d9161`，再合并 `origin/main` 的 `c83cc8ce1f4a2ba8ce9924a358691ce658a41ff6` 与 `f4c0c91dd33b4283605d8ec8b1997dc38e8071eb`。
- 协调者、公共契约与集成负责人：本聊天 Codex。
- 授权：本地实现与验证；2026-10-20 用户依次授权按审查切片提交、推送、创建 PR、审查后合并、生产资源创建与 secret 配对、迁移、部署、生产备份与隔离恢复验收，以及 Project 只读 GitHub token 配置和真实同步验收。不得把本机广权限 `gh` token 转存为长期 secret；除设计中的 GitHub 投影同步外，未修改生产业务数据。
- 根工作区 `.workbuddy-ai/` 为用户保留文件，不读取、不修改、不清理。

## 实施约定

1. 公共基础先完成，再依次集成 Project + CLI、Me、GU；三个领域全部完成才算首期完成。
2. 保持旧 Health grants；refresh 只能保持或缩小；逐工具校验 scope，摘要单独要求读权限。
3. `get_context` 并发摘要，每个来源 2 秒超时；UTF-8 限制为概览 4 KiB、详情页 12 KiB、总概览 8 KiB。
4. Project 交接必填 task_id、状态、分支、base SHA；PR/commit 可选。GitHub 按 Link 翻页，失败不推进完成游标，保留分页断点。未知任务状态显示 unknown。
5. CLI 复用锁定的官方 MCP SDK；凭证原子写入、跨进程刷新锁、锁内重读。OAuth 仅 HTTP loopback IP 可变端口，其余精确匹配。
6. Me 全部 AI 写入和导入先 pending，本人看板编辑直接生效；分块 start/chunk/finish、单次 24 KiB、整批 500 条/512 KiB。使用普通表 LIKE，不建 FTS 虚拟表；原文私有 R2，由 Ops 公钥加密备份，MCP 无下载能力。
7. GU 只读 `gu_workspace_head`，分页固定 revision，返回持仓、现金、流水、规则正文、报告；无自由文本风控引擎。
8. 实现期资源只登记 planned，不虚构 UUID、部署状态或真实客户端验收；发布后已按控制面事实回填实际版本、D1 UUID、域名、备份和剩余阻塞。

## 写入分工

此表由协调者维护。子任务使用独立 detached worktree，全部从同一基线开始，最终由协调者复制审查后的明确文件整合，不提交或 cherry-pick。

| 执行者 | worktree（`~/.worktrees/kdp.cool/` 下） | 允许写入 | 契约负责人 | 依赖 |
| --- | --- | --- | --- | --- |
| 协调 Codex | `codex/codepi-mcp-domains` | shared、MCP、Auth、agent scripts、CI、根文档 | 协调 Codex | 已确认方案 |
| Project 子任务 | `codex/mcp-project-domain` | `apps/project/**` | 协调 Codex | shared contract |
| Me 子任务 | `codex/mcp-me-domain` | `apps/me/**` | 协调 Codex | shared contract |
| GU 子任务 | `codex/mcp-gu-domain` | `apps/gu/**`、`apps/health/workers/api/**` | 协调 Codex | shared contract |
| CLI 子任务 | `codex/mcp-cli` | `packages/cli/**` | 协调 Codex | MCP 协议与工具参数 |
| 运维子任务 | `codex/mcp-operations` | `services/ops/**`、`scripts/cloudflare/**` | 协调 Codex | 新应用 planned 资源 |

## 独立审查分工

审查者只读主集成 worktree；对应实现目录在审查期间停止写入，修复后重新确认结论。
协调者继续处理 Health 集成、测试和文档，不把早先审查当作最终快照的证明。

| 审查者 | 只读范围 |
| --- | --- |
| Confucius | MCP、Auth、CLI 与共享授权契约 |
| Planck | Me、GU 与 MCP/备份调用方 |
| Lovelace | Project、GitHub 同步、交接与看板接口 |
| Laplace | Ops、Cloudflare 发布/备份/恢复、资源与巡检 |

审查后修复：Confucius 接管已停止写入的 `codex/mcp-cli`，仅写
`packages/cli/**`，修复同进程刷新竞争、错误文本输出、遗留锁恢复、并行任务显示与
init 授权说明；协调者只复制确认的文件并重跑集成。Bernoulli 继续在
`codex/mcp-gu-domain` 修复 Health 输出分页，限 `apps/health/workers/api/**`。
上述两处修改未完成整合前，不将早先的通过结果认作最终验收。
Lovelace 回到 `codex/mcp-me-domain`，仅写 `apps/me/**`，修复导入请求串批次、
本人归档与特殊字符标签检索。Planck 回到 `codex/mcp-project-domain`，仅写
`apps/project/**`，修复列表预算、原子同步限频与合并 PR 日期。列表分页 schema
由协调者修改 MCP，CLI 列表续页由 Confucius 完成；无并行文件写入。

最终修复阶段：各独立 worktree 已停止写入，协调者整合 CLI 与 Project 后，
Lovelace 仅在主集成 worktree 的 `apps/health/workers/api/**` 修复分页时钟与
实时同步状态；Laplace 仅在主集成 worktree 的 `services/ops/**`、
`scripts/cloudflare/d1-restore.mjs` 及其测试修复跨平台附件容量、恢复目标排除和
Workflow RPC 结果释放。协调者负责其他路径及文档，无共享文件并行写入。

最终复核新增修复：Planck 在主集成 worktree 仅写 `apps/project/**`，为列表增加
revision 校验并限制同步不越过租约；Confucius 在同一 worktree 仅写
`packages/cli/**`，修复跨进程 401 后重复刷新、OAuth 回调错误输出并接入列表
revision。协调者修改 MCP schema/联调测试与文档。列表契约为首屏返回
64 位 SHA-256 `revision`，续页同时传原筛选条件、offset 与该 revision；
列表变化返回 `cursor_stale`，CLI 不输出不完整结果。

## 已实现

- MCP：八项 scope、逐工具鉴权、读写权限分离、按读权限聚合的 `get_context`、
  超时降级与 UTF-8 内容预算。保留已有 Health grants，刷新不能扩大权限。
- Project：独立应用、SSO、项目卡、按 task 交接、request_id 幂等、
  GitHub Link 分页/断点、原子同步租约、真实 merged_at、列表和大卡片分页。
- CLI：官方 SDK、PKCE/DCR、原子凭证、跨进程锁及同进程刷新合并、
  完整列表/卡片装配、并行任务输出、错误脱敏与需明确授权的 init 交接说明。
- Me：独立应用、SSO、全部 AI 写入 pending、本人确认/编辑/归档、
  profile/timeline、中文检索、分块幂等导入、私有 R2 原文与备份能力。
- GU：只读线上 workspace head，固定 revision 读取持仓、现金、流水、规则与报告。
- Health：统计输入保持完整，输出使用 `health_data_json_v1` 分页；首页时钟固定
  默认日期和 freshness，续页不重复 refresh，真实数据变化仍拒绝旧 cursor。
- Ops：八库、GU/Me 两类原件、v3 完成清单、GitHub 分片复制、旧副本读取、
  隔离恢复与生产身份排除；Workflow 步骤结果复制后释放 RPC 对象。
- 配套：共享 Auth client 注册、真实 SSO readiness、发布与巡检登记、
  受影响检查/CI、根规则/skills、架构与首次发布和恢复手册。

## 审查修复

独立审查提出并已修复：Project 列表超预算、同步并发限频、PR 合并日期；
CLI 并发 401 刷新（含另一调用尚未完成“采用他人刷新结果”时仍可能多发一次
token 请求的竞态）、错误文本泄露、遗留锁回收、并行任务遗漏与列表续页；
Me 并发导入串批、本人归档及特殊字符标签检索；Health refresh 与时钟续页失效；
SSO 配对假阳性、首发配对顺序、跨平台附件容量、恢复目标生产身份排除、
Workflow RPC 结果释放。最终复核发现并发首次登录可能让两个进程分别注册
DCR client；现已把 client 读取或注册纳入凭证锁，并在授权码兑换后、写入 token
前再次核对持久化 `client_id` 与 issuer，凭证被其他进程改写时以
`credentials_changed` 失败关闭，不覆盖对方的 refresh family。新增双进程回归
用例，要求只发生一次 DCR、两个授权都成功且最终 refresh token 可刷新。

Health SSO 浏览器用例另外等待自动同步和首页请求结束、移动视口清除后的两帧
重排，再执行会话撤销与账号修复。合并最新 main 后，浏览器点击辅助函数还会在
布局变化后重新计算目标坐标，必要时显式滚动并输出命中元素诊断；SSO 用例在
聚焦触发的会话刷新重建设置页后，会重新展开 `.connection-repair`。这些调整只
消除测试时序竞态，没有发现产品行为缺陷。组合验收后未再发现新的产品行为
缺陷；Project 的新独立审查因模型容量未完成，仍作为审查覆盖缺口保留。

所有修复仍只属于本地实现；没有真实部署或线上资源变更。

## 验证证据

以下均在主集成 worktree 运行，使用合成数据；主体检查覆盖本轮审查修复，
最终组合检查覆盖未提交的 `origin/main` `f4c0c91` 合并树。由于合并尚未
提交，检查脚本以当时的合并基 `c83cc8c` 为 review base，共识别 256 个变更
文件，已包含 Vite 8 / Svelte 插件 7 升级：

| 范围 | 实际检查 | 结果 |
| --- | --- | --- |
| Project | `pnpm test`、typecheck、build、test:browser | 46 项通过；桌面及 390px 手机冒烟通过，截图已目检 |
| Me | `pnpm test`、typecheck、build、test:browser | 20 项通过；真实本地 Worker/D1/R2 桌面及手机冒烟通过，截图已目检 |
| CLI | test、typecheck、build | 54 项通过；包括并发首次登录共享 DCR client、同进程与跨进程刷新、并发 401 采用他人刷新结果、分页、错误脱敏与 init |
| Auth/readiness | shared client、pairing、monitor 定向测试；Auth domain-clients | 27 + 3 项通过；实际 Auth 内部接口接受正确配对、拒绝错误凭证 |
| Health API | test、typecheck、test:integration、build | 59 + 119 项通过；跨午夜、599→601 秒 freshness、真实变更、实时同步时间均覆盖 |
| MCP | `pnpm test`、typecheck、build、test:browser | 36 项通过；scope、OAuth、domain grant、Health 分页及浏览器冒烟通过 |
| MCP/CLI/Health 联调 | `node --test test/cli.test.mjs test/health-pagination.test.mjs` | 4 项通过；新增 CLI 真实 Project 列表三页装配另行复验通过 |
| Ops | test、build、test:runtime | 25 项通过；真实 Workflows/R2、GU/Me 原件能力、恢复链路通过，runtime 无 RPC disposal 警告 |
| 文档 | 仓库 Markdown 的相对链接存在性核对 | 98 个文件、322 个目标全部有效（排除 `.workbuddy-ai/`） |

Me 浏览器测试在 health 增加 readiness 字段后曾因旧的精确响应断言失败；
已将断言更新为完整新契约并重跑通过，没有放宽判断。
Project 浏览器使用合成 HTTP 响应；它证明 UI 交互，不替代真实 SSO/GitHub。
Me 浏览器与 Ops runtime 覆盖不同层：前者运行真实 Me HTTP/D1/R2，后者直接
re-export 真实 `MeImportsBackup` 验证原件 provider contract。

最终组合检查已执行并通过（`Passed 43 selected local checks`）：

```bash
HEALTH_BROWSER_PORT=48185 node scripts/agent/check.mjs \
  --base c83cc8ce1f4a2ba8ce9924a358691ce658a41ff6 --run
```

该轮检查包含并发首次登录、latest main 的品牌资源改动、浏览器点击重排与
SSO repair details 重挂载修复，以及 Vite 8 下的 GU、GZH、Health 构建，43 项
全部通过。两次合并 `origin/main` 时 `pnpm-lock.yaml` 均发生冲突，已采用 main
版本并基于全部 workspace 重新生成；`pnpm install --frozen-lockfile` 通过。

补充检查全部通过：

```bash
node --test scripts/cloudflare/*.test.mjs        # 130 项
node scripts/cloudflare/validate-governance.mjs
node scripts/agent/check-migrations.mjs          # 26 个迁移文件
node scripts/agent/lint.mjs                      # 164 个脚本、24 个 JSON
git diff --check
```

## 提交拆分（建议）

按依赖顺序拆成 10 个功能切片，并增加 1 个测试夹具兼容修正；分支已合并最新
main，另保留 Health 浏览器测试稳定性提交。仓库最终以 squash merge 进入 main，
因此中间提交只用于审查和回溯，不单独发布；只有最后一个提交后的完整树通过了
本轮组合检查。PR：
https://github.com/kedoupi/codepi/pull/121

| # | 提交信息 | 主要路径 |
| --- | --- | --- |
| 1 | `feat(shared): add MCP domain contracts, SSO clients and workspace foundation` | `pnpm-workspace.yaml`、`pnpm-lock.yaml`、三个新包的 `package.json`、`packages/shared/{mcp,auth}`、`services/auth/**` |
| 2 | `feat(project): add project cards, handoffs and GitHub sync` | `apps/project/**` |
| 3 | `feat(me): add confirmed personal memory and chunked imports` | `apps/me/**` |
| 4 | `feat(cli): add the CodePi MCP SDK CLI` | `packages/cli/**` |
| 5 | `feat(health,gu): expose paged Health and read-only GU to MCP` | `apps/health/workers/api/**`、`apps/gu/**`、`apps/web/test/runtime.mjs` |
| 6 | `feat(mcp): add the scoped domain gateway` | `services/mcp/**` |
| 7 | `feat(ops): back up eight databases and private originals` | `services/ops/**`、`scripts/cloudflare/{backup-core,d1-backup,d1-restore,originals-restore}*` |
| 8 | `chore(deploy): register new services in CI, governance and monitoring` | `.github/workflows/deploy-platform.yml`、`scripts/agent/**`、其余 `scripts/cloudflare/**` |
| 9 | `feat(web): surface Project and Me in the private desk` | `packages/shared/products.ts`、`apps/web/src/pages/desk/index.astro` |
| 10 | `docs: record MCP domain architecture and acceptance` | `docs/**`、`.agents/skills/**`、根 `AGENTS.md`、根 `README.md` |
| 11 | `fix(web): reuse upstream GU workspace fixture` | `apps/web/test/runtime.mjs`；移除与 main `4ee5a5b` 重复的建表逻辑 |

PR 标题建议：

`feat(mcp): add scoped Project, Me and GU domains with official CLI`

## 发布与真实验收

### Worker 与数据资源

发布源码为干净、detached 的 `58bd615c317d10a91643b780811c082482760f33`，
与实时 `origin/main` 一致；十个 Worker 均为单一活跃版本、100% 流量，
线上 `BUILD_SHA=58bd615c317d`。实际活动版本如下：

| 服务 | Worker version | 本轮验收 |
| --- | --- | --- |
| Auth | `b8838962-fdf5-4a94-ab39-ed827ff3a2b0` | Project/Me 客户端、secret 配对与 readiness 通过 |
| Web | `b139385f-1a82-4bcd-8cf2-42ffb3701fb7` | 匿名私有接口拒绝、SSO 跳转通过 |
| GU | `7e2212c0-7c96-43fb-b0c9-e725fec6110f` | 匿名拒绝、SSO 与只读 MCP 契约通过 |
| GZH | `e0ec9bc8-fb98-494f-8ea6-5a0a79c9c678` | 匿名拒绝与 SSO 跳转通过 |
| Health API | `513a14c9-a8b8-4603-b363-ca450c78138c` | 18 项线上 API 契约通过 |
| MCP | `c6b62b1e-bab3-415f-83e4-4da2beeb3643` | 发现、连接入口、匿名拒绝与凭证配对通过 |
| Health 前端 | `8217fc5d-b3d5-4bf4-8255-1345a2732bd9` | 品牌、页面与 SSO 检查通过 |
| Ops | `36c81c0b-5c29-4ede-b805-289a1f6ea753` | 8 库/原件 v3 备份、GitHub 分片复制与巡检通过 |
| Project | `bb43c090-0370-43c3-b5f6-c3242df79da5` | SSO、匿名 401 与 readiness 通过；只读 GitHub token 生效，五来源真实 Cron 同步通过 |
| Me | `42a25c9c-a14a-4b65-b855-49265bc8baef` | SSO、匿名 401、空原件覆盖通过 |

新增生产 D1：`codepi-project` 为
`03612540-2ac6-4dd2-9bf6-ed431dda17c9`（2 个 migration），
`codepi-me` 为 `7236c118-1f92-4b07-8283-e731c2771953`（1 个 migration）。
`codepi-me-imports` 已创建为私有 R2，无 custom domain，r2.dev 关闭。
Project/Me 的 `AUTH_CLIENT_SECRET` 与 Auth 侧
`SSO_CLIENT_SECRET_PROJECT` / `SSO_CLIENT_SECRET_ME` 已配对；两个产品均要求真实 SSO
ready。Project 运行 secret 为 `AUTH_CLIENT_SECRET` 与只读 `GITHUB_TOKEN`，后者仅用于
仓库 Contents、Metadata、Pull requests 和 Issues 读取，不复用 Ops 的 Contents 读写 token。

### Project GitHub 同步

2026-10-20T10:13:50Z，`GITHUB_TOKEN` 由所有者按推荐权限配置为 `secret_text`。
Secret 变更生成新 version `bb43c090-0370-43c3-b5f6-c3242df79da5` 并承接 100% 流量；
核验仍保留 `BUILD_SHA=58bd615c317d`、`AUTH_CLIENT_SECRET`、D1/Auth/Assets 绑定和
`fetch`/`scheduled` handlers。无需重新构建或发布业务源码。

下一次生产 Cron 于 `2026-10-20T10:15:38Z` 完成真实同步：commits、pull requests、
issues、AGENTS.md 与任务文档五个来源的 `last_ok_at` 均更新且 `last_error=null`，
无待续 checkpoint。Project D1 产生 286 条仓库事件（186 commits、100 PR、0 issues）、
30 条任务文档索引（16 done、1 blocked、13 unknown）和 4 条卡字段；当前活跃同步租约 0。
这证明只读 token 足以完成五类读取，但不证明 token 页面中的权限配置；后者依据所有者
确认的最小只读设置记录，不能由 Worker secret 反向审计。

### 备份、巡检与隔离恢复

生产备份 Workflow
`cf_93cea89d2248417b1d15530d606a6f32cb921ac8f6cbbf8c24486786218d5572`
已 complete。v3 manifest 覆盖 8 个 D1 与 GU/Me 两类原件：
GU 112 件、Me 0 件；主 Release `418207867` 保存 manifest 与索引，分片 Release
`418205153` 保存 120 个密文 payload。manifest SHA-256 为
`2b9796b37bca1084ba269d0d84b78c56cffc398672e5982afcfb168da793fe10`，
offsite index SHA-256 为
`dec335c0584f683850b6154d2b6c89c0ff67434529fc7d74f7ccdf037496e6cb`。
120 个分片已独立下载并在内存中完成大小、SHA-256、GCM、身份和内容校验；
匿名 Release API 返回 404。

云端 monitor
`cf_8a2afa9777e330cb8d0147c661fdc25ecd9fa865d95e4081bcb0879eaf84d256`
为 complete，34/34 通过，覆盖十个 Worker 的 `BUILD_SHA` 与 main 一致、
Project/Me SSO/匿名拒绝，以及 8 库和两类原件的 R2/离站备份新鲜度。
Project/Me 另已各建立两条 Workers Issues service 规则：
Project 首次 `5339dd89-9a21-4343-aa0c-1be76370bb68`、复发
`ba04e2c2-556b-48e8-b5f4-9ab37583301a`；Me 首次
`b70f43dc-79e6-4b5b-bdb1-f385220bd976`、复发
`8267f2a3-1483-4de3-be7f-3b05665df84a`。账户正式规则总数为 20。

v3 隔离恢复从同一 GitHub 副本重新下载，创建 8 个全新空 D1；每库逐表比对了
schema、字段值、SQLite 类型和完整性，共 98 张表、138,986 行全部一致：
Auth 6/38、Desk 3/9、GU 11/137、GZH 9/13、Health 22/138,738、MCP 7/46、
Project 10/3、Me 10/2（表/行）。MCP 临时库清除了历史 token、授权码、同意请求和
SSO 会话状态，保留 2 个客户端注册。GU 112 份原件逐件恢复并核对字节摘要，
索引 112、额外原件 0；Me 空集合恢复为 0 件。八个临时 D1、全部密文/明文临时目录
及日志已按精确 UUID 删除并复核不存在，生产绑定和活跃版本未变化。

发布后回填登记状态时发现 `d1-backup.test.mjs` 仍只断言旧六库；已改为以
`DATABASE_NAMES` 和登记表全部 managed production D1 为准。七项受影响检查通过：
Cloudflare 130/130、agent check 27/27、lint、Ops test 25/25、build 和 runtime。
该修正只涉及测试与文档，没有重发业务 Worker。

### 剩余阻塞

1. Me 尚无正式导入原文，因此本轮只证明“空集合也完整覆盖”，没有非空 Me 原件恢复证据。
2. Claude 手机端、Codex 与 codepi CLI 对新 Project/Me/GU scope 的真实授权、刷新、
   撤销和接力仍需逐客户端验收；既有 Claude Health 使用确认不能替代。
3. 恢复私钥已在 iCloud 且所有者可见，但尚未在另一设备实际取回并完成解密，
   异机恢复演练继续保留 TODO。
4. Project token 按推荐的 90 天有效期预计在 2027-01-18 到期；到期轮换和同步新鲜度
   告警仍需在生产巡检中补强。

验证证据在 Git 外：
`<workspace>/.local/state/kdp.cool/operations/2026-10-20-codepi-mcp-domains/`。

没有把恢复明文、token 或其他 secret 写入仓库或日志。恢复验收未修改生产业务数据；
后续 Project Cron 已按设计写入 GitHub 投影和任务文档索引。
