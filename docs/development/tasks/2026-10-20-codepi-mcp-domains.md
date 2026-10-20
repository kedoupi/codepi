# CodePi MCP 领域扩展

- 状态：各模块已集成，本地组合验收已完成；未提交、推送、合并或部署。
- 目标：统一 MCP 的逐工具授权与概览，Project 项目卡和任务交接、官方 SDK CLI、Me 确认区和分块导入、GU 线上工作区只读查询；补齐运维登记和本地合成验证。
- 依据：2026-10-20 用户确认的实施计划；两份 PDF 是需求来源，以下修正优先于 PDF。
- worktree：`<workspace>/.worktrees/kdp.cool/codex/codepi-mcp-domains`
- 分支：`codex/codepi-mcp-domains`
- 基线：`abbafdfe2d04966d66dad2f4f0084075f040caaf`
- 协调者、公共契约与集成负责人：本聊天 Codex。
- 授权：本地实现与验证。未授权 Git 提交、远程写入、生产资源创建、secret 配对、迁移或部署。
- 根工作区 `.workbuddy-ai/` 为用户保留文件，不读取、不修改、不清理。

## 实施约定

1. 公共基础先完成，再依次集成 Project + CLI、Me、GU；三个领域全部完成才算首期完成。
2. 保持旧 Health grants；refresh 只能保持或缩小；逐工具校验 scope，摘要单独要求读权限。
3. `get_context` 并发摘要，每个来源 2 秒超时；UTF-8 限制为概览 4 KiB、详情页 12 KiB、总概览 8 KiB。
4. Project 交接必填 task_id、状态、分支、base SHA；PR/commit 可选。GitHub 按 Link 翻页，失败不推进完成游标，保留分页断点。未知任务状态显示 unknown。
5. CLI 复用锁定的官方 MCP SDK；凭证原子写入、跨进程刷新锁、锁内重读。OAuth 仅 HTTP loopback IP 可变端口，其余精确匹配。
6. Me 全部 AI 写入和导入先 pending，本人看板编辑直接生效；分块 start/chunk/finish、单次 24 KiB、整批 500 条/512 KiB。使用普通表 LIKE，不建 FTS 虚拟表；原文私有 R2，由 Ops 公钥加密备份，MCP 无下载能力。
7. GU 只读 `gu_workspace_head`，分页固定 revision，返回持仓、现金、流水、规则正文、报告；无自由文本风控引擎。
8. 资源只登记 planned，不虚构 UUID、部署状态或真实客户端验收。

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
Workflow RPC 结果释放。最终复核结论在组合验收后回填。

所有修复仍只属于本地实现；没有真实部署或线上资源变更。

## 验证证据

以下均在主集成 worktree、基线 `abbafdfe2d04966d66dad2f4f0084075f040caaf`
之上的未提交改动运行，使用合成数据：

| 范围 | 实际检查 | 结果 |
| --- | --- | --- |
| Project | `pnpm test`、typecheck、build、test:browser | 46 项通过；桌面及 390px 手机冒烟通过，截图已目检 |
| Me | `pnpm test`、typecheck、build、test:browser | 20 项通过；真实本地 Worker/D1/R2 桌面及手机冒烟通过，截图已目检 |
| CLI | test、typecheck、build | 53 项通过；包括同进程与跨进程刷新、并发 401 采用他人刷新结果、分页、错误脱敏与 init |
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
HEALTH_BROWSER_PORT=48178 node scripts/agent/check.mjs \
  --base abbafdfe2d04966d66dad2f4f0084075f040caaf --run
```

补充检查全部通过：

```bash
node --test scripts/cloudflare/*.test.mjs        # 130 项
node scripts/cloudflare/validate-governance.mjs
node scripts/agent/check-migrations.mjs          # 26 个迁移文件
node scripts/agent/lint.mjs                      # 164 个脚本、24 个 JSON
git diff --check
```

## 提交拆分（建议）

按依赖顺序拆成 10 个审查切片。仓库最终以 squash merge 进入 main，因此中间提交
只用于审查和回溯，不单独发布；只有最后一个提交后的完整树通过了本轮组合检查。

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

PR 标题建议：

`feat(mcp): add scoped Project, Me and GU domains with official CLI`

## 尚未执行的发布与真实验收

1. 用户授权后，提交/审查/合入 main；再按本地发布流程固定干净源码与单一发布者。
2. Auth → Project/Me 首次上传与 secret 配对/readiness → Health API/GU →
   MCP → Ops/公开入口。新 D1、Me 私有桶、域名、GitHub 只读同步 secret 和
   新 Worker Issues 规则仍待真实创建与验收；planned 登记不是已存在。
3. 生产 GitHub 同步、登录、非空 Me 原文备份与隔离恢复、全部分片独立下载校验。
4. Claude 手机端、Codex、codepi CLI 的真实授权、权限隔离、刷新、撤销与接力；
   既有 Claude Health 使用确认不能作为本次新领域通过证据。

没有访问真实健康、投资、项目正文或密钥；没有把生产数据加入 fixture。
