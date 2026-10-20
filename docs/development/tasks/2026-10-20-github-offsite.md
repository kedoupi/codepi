# GitHub 跨平台备份验收

- 状态：手动副本与新实例的自动跨平台复制均已验收；六库、112 份 GU 原件及 manifest 共 119 个 GitHub 附件下载、校验和内存解密通过，云端巡检 26/26。
- 日期与执行人：2026-10-20，当前 Codex，本机 API 操作。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/gu-online`；操作时为 detached HEAD。
- 起始及远程操作源码：`938acb1ee8b645a9f97836ddbd974d48fb3c18b0`，干净且等于实时远程 main。
- 协调者、执行者、审查者与集成者：当前 Codex，单一写入者；仅更新相关工程文档，无并行写入。
- 授权：沿用本会话的 API 操作、提交、PR 审查和合并授权。所有者明确允许核对新增提交后基于最新 main 继续；不转存本机 OAuth 凭证到 Worker，不扩大凭证权限。
- 前置记录：[GU 迁移与恢复](2026-10-19-gu-online.md)、[定时运维剩余项](2026-10-19-cloudflare-operations.md#当前剩余项)。

## 首次手动阶段基线与凭证核对

原工作区停在 `b6cec89564a8`，首次预检发现远程 main 已前进，因此在上传前停止。
所有者确认后核对新增的 PR #111、#112：只有 Health 历史同步告警修复和发布证据，
没有备份格式、六库清单或 GitHub 复制逻辑变更。随后将干净任务工作区更新至
`938acb1ee8b6`，持有 Git common directory 中的生产发布锁执行复制与回执写入。

本机 `gh` OAuth 授权现已可用，确认对私有 `kedoupi/kdp.cool` 有写权限。
本次仅在进程内读取并用于 GitHub API；没有保存、输出、扩权或写入 Cloudflare。
Ops secret 名称仍只有 `CLOUDFLARE_API_TOKEN`，没有 `GITHUB_TOKEN`。
连接器和本机登录不自动提供符合现行权限边界的 Worker 长期运行凭证。

## 实际副本与验收

使用已完成的定时备份，不重新导出或修改生产数据：

| 项目 | 证据 |
| --- | --- |
| 备份 instance | `backup-20261019T180026000Z` |
| 备份开始 / R2 完整完成 | `2026-10-19T18:00:30.011Z` / `2026-10-19T18:08:04.800Z` |
| R2 前缀 | `backups/backup-20261019T180026000Z/` |
| GitHub 仓库 | `kedoupi/kdp.cool`，已核验为 private |
| Release | ID `417885437`；tag `ops-backup-backup-20261019T180026000Z`；prerelease，非 draft |
| 覆盖 | 六份 D1 密文、112 份 GU 原件密文、一个 v2 manifest，共 119 个附件 |
| 密文总大小 | `2307490` 字节，不含 manifest |
| manifest SHA-256 | `f4c548209abe5c9511e299d1832b72bb5842132c2843a7460f0ea2d91a13762d` |
| 上传 / 下载验收完成 | `2026-10-20T00:38:50.151Z` / `2026-10-20T00:39:33.856Z` |

复制复用 `services/ops/src/offsite.mjs`，逐件核对 R2 密文大小和 SHA-256，
经 API 上传后核对 GitHub 返回的 digest，最后上传 manifest。未覆盖已有不匹配附件。
Release 不需要 Actions runner，也没有把资料放进 Git 历史。

随后通过私有 Release asset API 独立下载 manifest 和全部 118 份密文：

- 六库：下载大小、SHA-256、恢复私钥、GCM 认证与库身份 6/6 通过。
- GU 原件：密文校验、GCM、原件身份、解密大小和内容 SHA-256 112/112 通过。
- 未登录的 Release API 返回 404；未开放公开仓库、R2 或下载 URL。
- 解密只在内存中进行；没有新增 SQL/原件明文文件，也没有重新导入或切换生产库。
  此次不替代此前 GU 隔离导入与鉴权下载演练，也不扩大为其他五库导入验收。

新增固定本机密文副本：
`/Users/codepi/.local/share/kdp.cool/backups/backup-20261019T180026000Z/`，
目录 `0700`、文件 `0600`，保留原 manifest 和 `materials/` 结构。
原资料、既有正式备份和恢复私钥均保留。

## 首次手动阶段回执与巡检边界

独立手动回执已写入并读回核对：
`reports/manual-offsite/backup-20261019T180026000Z.json`。
没有改写自动 Workflow 的 `latest.json`、R2 成功回执或跨平台成功回执。

实际自动备份报告仍为 `r2=complete`、`offsite=failed`、
`reason=github_token_missing`。云端实例 `monitor-20261020T003026000Z`
于 `2026-10-20T00:32:09.033Z` 完成，17/19 通过；剩余两项是缺少 GitHub
运行凭证的版本核对和缺少自动跨平台成功回执。这不否认本次独立验收通过的手动副本。

另用本机凭证在进程内执行 `checkGithubReleaseDrift`，八个 Worker 的 GitHub API
逐提交版本核对 8/8 通过；main 快照为 `938acb1ee8b6`。
这是同一逻辑的本机执行，不是云端 Cron 已恢复。
手动复制时 Ops 为 version `6818aef1-8144-4e10-bb49-3faa1c46ef8c`、
`BUILD_SHA=05d9d61ce574`；该阶段没有发布 Worker、修改 Cron 或轮换任何 secret。
这些失败状态保留为当时的证据，后续自动验收见下文。

Git 外元数据与本次执行脚本位于
`/Users/codepi/.local/state/kdp.cool/operations/2026-10-20-github-offsite/`：
`upload.json`、`verification.json`、`runtime-version-check.json`、`final.json`。
脚本只用于本次操作，引用本机工作区，不作为新的便携运维 CLI。
其中不保存 token、私钥、SQL 或资料正文。

## 手动阶段文档验证与审查

本轮仓库差异只含七份工程 Markdown，没有修改应用、备份实现、依赖或部署配置。
执行 `node scripts/agent/check.mjs --base 938acb1ee8b645a9f97836ddbd974d48fb3c18b0 --run`，
四项检查通过：CF 脚本 104/104、治理检查、Agent 检查脚本 26/26、
126 个脚本及 18 个 JSON 的 lint。77 处本地 Markdown 链接可定位，
`git diff --check` 通过；新增固定副本的目录 `0700`、119 个文件 `0600` 已实查。
按项目审查规范对照 Git 外回执和当前实现复核，没有发现需修复的文档问题。
未因纯文档改动重跑应用构建或 UI，未将此验证扩大为自动运行或异机私钥保管验收。

## 自动复制与云端巡检验收（2026-10-20）

所有者配置凭证并明确要求检查、继续自动备份和云端巡检。当前 Codex 复用同一
worktree，从干净且等于实时远程 main 的
`3982013f7bd831e36c2aadaff024744c3b0b6f8f` 持锁执行；后续文档分支为
`codex/github-automatic-acceptance`，唯一写入者、审查者与集成者仍为当前 Codex。
没有修改业务代码、恢复格式、Cron 或生产数据，也没有重新构建上传业务源码。

### 凭证与生效版本

首次控制面核对发现 `GITHUB_TOKEN` 已生效，但类型为 `plain_text`，因此不在
`wrangler secret list` 中。直接 secret PUT 返回 HTTP 400，未完成类型转换；
随后用官方 settings PATCH 在内存中一次替换为 `secret_text`，继承其余 binding，
没有输出、落盘或转存本机 `gh` 凭证。所有者随后也确认已改为密钥；
再次查询的生效版本与下表一致。

| 项目 | 实际结果 |
| --- | --- |
| 配置前 version | `05b744c8-3c6d-41d8-b0b7-5777ff218692`，来源 dashboard |
| 配置后 version | `22c8ca10-1462-4076-8412-0bd8d05613ba`，唯一活跃版本 |
| `BUILD_SHA` | `05d9d61ce574`，源码未变；凭证配置产生新 Worker version |
| secret 名称 | `CLOUDFLARE_API_TOKEN`、`GITHUB_TOKEN`；后者为 `secret_text` |
| Ops 控制面 | GU named RPC、BACKUPS、OPERATIONS、两个 Cron、持久日志、查询串脱敏及 Issues 均通过 |
| 私有访问 | workers.dev、preview 关闭；Ops 无 custom domain；备份桶 r2.dev 关闭、custom domains 为空 |

类型转换前后核对其余 bindings 与版本设置。运行权限以新 Workflow 的实际 GitHub
写入和历史读取结果为证；本轮未通过 API 查询 PAT 的授权仓库范围或到期时间。

### 新实例自动备份与独立下载

| 项目 | 证据 |
| --- | --- |
| backup instance | `acceptance-github-backup-20261020T010216314Z` |
| 开始 / Workflow 完成 | `2026-10-20T01:02:37.439Z` / `2026-10-20T01:08:22.814Z` |
| Workflow | `complete`，123/123 步骤成功，无失败步骤 |
| R2 前缀 | `backups/acceptance-github-backup-20261020T010216314Z` |
| 自动备份报告 | `ok=true`、`r2=complete`，`offsite` 为成功的 Release 回执 |
| GitHub Release | ID `417899953`，tag `ops-backup-acceptance-github-backup-20261020T010216314Z`；私有仓库、prerelease、非 draft |
| 附件 | 六份 D1 密文、112 份原件密文、一个 v2 manifest，共 119 个 |
| 密文总大小 | `2309509` 字节，不含 manifest |
| manifest SHA-256 | `3a6ef88ee5d048683b1869f624307403191772caf4950246c3aa9409c8d616ce` |
| 自动跨平台回执 | `reports/backup/offsite-success.json`，instance 与 Release 均匹配 |
| 独立下载验收完成 | `2026-10-20T01:09:16.721Z` |

生产 Workflow 使用云端凭证完成六库导出、GU 原件加密、R2 校验和 GitHub 自动复制，
最后自行写入当次报告及成功回执。本机 `gh` 只在进程内用于独立下载验收：
119 个附件数量及摘要匹配，六库 6/6、原件 112/112 的 GCM、身份、私钥解密通过，
原件明文大小与内容 SHA-256 全部一致；匿名 Release API 为 404。
解密仅在内存中，没有新增明文文件、生产导入或绑定切换。

没有手动改写自动报告，也没有修改此前失败实例或独立手动回执。
首次手动副本和固定本机密文继续保留。本次没有重复执行 GU 隔离导入，
也不替代其他五库导入或恢复私钥异机保管验收。

### 云端巡检

新实例 `acceptance-github-monitor-20261020T010216314Z` 于
`2026-10-20T01:09:33.052Z` 完成，Workflow 为 `complete`，私有报告为 `ok=true`，
**26/26** 通过且无 skipped：

- Auth、四产品匿名拒绝和同环境登录、MCP readiness/发现/连接入口、旧泄漏入口关闭、
  Health 30 小时同步新鲜度通过。
- 八个 Worker 使用云端 `GITHUB_TOKEN` 逐提交核对 main 快照 `3982013f7bd8`，
  全部通过；各服务源码范围没有待发布改动，不要求八个 `BUILD_SHA` 文本相同。
- R2 与 GitHub 的六库及 GU 原件完整备份均满足 30 小时新鲜度。

此前 17/19 的 GitHub 凭证失败汇总为一项；凭证可用后展开为八个 Worker 检查，
因此总数为 26。未减少检查或放宽阈值。巡检报告由 Workflow 写入
`reports/monitor/<instance>.json` 及 `latest.json`。
本轮手动触发生产 Workflow 验收自动链路，没有等待下一次 Cron 定时触发。
原计划仍为每 30 分钟巡检、UTC 18:00（北京时间次日 02:00）备份。

生产验收于 `2026-10-20T01:09:42.130Z` 结束，发布锁已释放。
非敏感元数据与执行脚本留在原 Git 外操作目录：`automatic.json`、
`automatic-control.json`、`accept-automatic.mjs`；第一次 secret PUT 的失败元数据另存
`automatic-secret-put-attempt.json`。其中不保存 token、私钥、SQL 或资料正文。
文档检查与 Git 集成另行记录，不把生产验收通过自动等同于文档已合并。

## 本轮文档验证与审查

仓库差异限七份工程 Markdown。以 `3982013f7bd831e36c2aadaff024744c3b0b6f8f`
为基线执行受影响检查，4/4 通过：Cloudflare 脚本 104/104、治理检查、
Agent 回归 26/26、126 个脚本及 18 个 JSON 的 lint。
78 处本地 Markdown 链接目标可定位，验收实例、版本、时间、Release 和 manifest
摘要与 Git 外回执逐项匹配，凭证模式检查与 `git diff --check` 通过。
未因纯文档修改重跑应用构建或 UI，也不重新发布业务 Worker。

按项目审查规范复核整个差异及相关实现，未发现需修复的文档问题；
这是协调者审查，没有新增独立审批。非敏感检查和后续 Git 集成证据分别保存为
原操作目录中的 `automatic-doc-checks.json` 与 `automatic-integration.json`。

## 继续工作

1. [后续验收](2026-10-20-recovery-acceptance.md)已确认平台事件邮件实际收件及自然
   monitor Cron 26/26；[Workers Issues 后续验收](2026-10-20-workers-issues.md)又补齐自动
   触发、发送与实际收件。恢复私钥异机保管继续保留 TODO，等待所有者后续处理。
2. 其余五库的 47 表/138,106 行隔离导入、全量核对、MCP 快照授权清理演练与临时资源
   清理已通过，详见上述后续验收；GU 真实隔离恢复沿用已完成记录。
3. 专用 GitHub 凭证到期或撤销后按原安全流程更新，再用新 backup/monitor 实例验收；
   不转存本机广权限 OAuth，也不修改旧失败报告转绿。
