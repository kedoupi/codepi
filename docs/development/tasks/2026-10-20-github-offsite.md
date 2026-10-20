# GitHub 跨平台备份验收

- 状态：一份完整生产备份已复制到私有 GitHub Release，并从 GitHub 下载、校验和内存解密通过；自动复制与云端 GitHub 版本核对仍等待专用运行凭证。
- 日期与执行人：2026-10-20，当前 Codex，本机 API 操作。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/gu-online`；操作时为 detached HEAD。
- 起始及远程操作源码：`938acb1ee8b645a9f97836ddbd974d48fb3c18b0`，干净且等于实时远程 main。
- 协调者、执行者、审查者与集成者：当前 Codex，单一写入者；仅更新相关工程文档，无并行写入。
- 授权：沿用本会话的 API 操作、提交、PR 审查和合并授权。所有者明确允许核对新增提交后基于最新 main 继续；不转存本机 OAuth 凭证到 Worker，不扩大凭证权限。
- 前置记录：[GU 迁移与恢复](2026-10-19-gu-online.md)、[定时运维剩余项](2026-10-19-cloudflare-operations.md#当前剩余项)。

## 基线与凭证核对

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

## 回执与巡检边界

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
Ops 仍为 version `6818aef1-8144-4e10-bb49-3faa1c46ef8c`、
`BUILD_SHA=05d9d61ce574`；本轮没有发布 Worker、修改 Cron 或轮换任何 secret。

Git 外元数据与本次执行脚本位于
`/Users/codepi/.local/state/kdp.cool/operations/2026-10-20-github-offsite/`：
`upload.json`、`verification.json`、`runtime-version-check.json`、`final.json`。
脚本只用于本次操作，引用本机工作区，不作为新的便携运维 CLI。
其中不保存 token、私钥、SQL 或资料正文。

## 文档验证与审查

本轮仓库差异只含七份工程 Markdown，没有修改应用、备份实现、依赖或部署配置。
执行 `node scripts/agent/check.mjs --base 938acb1ee8b645a9f97836ddbd974d48fb3c18b0 --run`，
四项检查通过：CF 脚本 104/104、治理检查、Agent 检查脚本 26/26、
126 个脚本及 18 个 JSON 的 lint。77 处本地 Markdown 链接可定位，
`git diff --check` 通过；新增固定副本的目录 `0700`、119 个文件 `0600` 已实查。
按项目审查规范对照 Git 外回执和当前实现复核，没有发现需修复的文档问题。
未因纯文档改动重跑应用构建或 UI，未将此验证扩大为自动运行或异机私钥保管验收。

## 继续工作

1. 所有者创建 fine-grained PAT，仅选择 `kedoupi/kdp.cool`，
   Repository permissions 只授予 **Contents: Read and write**，其他保留默认。
   按[凭证配置流程](../cloudflare-operations.md#首次初始化与凭证)安全写入
   `codepi-ops` 的 `GITHUB_TOKEN` secret；不把凭证发到聊天、Git 或命令参数。
   现有 API/连接器未提供创建此专用凭证的能力，本机广权限 OAuth 不作替代。
2. 配置后从当时最新、干净且已合并的 main 持锁创建新的 backup 实例，
   验收新的六库/原件 manifest、GitHub 附件及自动跨平台成功回执，再运行 monitor。
   本次手动副本不替代该次新鲜度与运行凭证验收，不通过修改旧报告转绿。
3. 告警实际送达、恢复私钥异机保管、其他五库导入演练继续保留独立待办。

文档的本地检查、审查与 Git 集成状态随本次交付记录；生产数据验收与文档是否合入分别判断。
