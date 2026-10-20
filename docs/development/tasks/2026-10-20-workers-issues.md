# Workers Issues 自动告警送达验收

- 状态：首次自动触发、通知发送与收件箱实际送达通过；八个生产 Worker 各有首次/复发规则，共 16 条；临时资源清理与生产配置复查通过。恢复私钥异机保管按所有者要求保留 TODO。
- 日期与执行人：2026-10-20，当前 Codex，单一协调者、写入者、审查者和集成者，无并行写入。
- 基线：`597cd8e6d0951bc353981f63932e788543fd506f`；工作区：`<workspace>/.worktrees/kdp.cool/codex/workers-issues-acceptance`，分支 `codex/workers-issues-acceptance`。
- 授权：本轮用户明确授权通过既有 API 完成 Workers Issues 端到端验收；沿用本会话审查通过后的 PR 合并与任务临时资源精确清理授权。
- 写入范围：现行运维/恢复文档、资源登记与相关任务证据。生产只新增 Issues 自动规则，业务 Worker 源码、版本、绑定和数据没有变更。
- 接续：[五库恢复验收](2026-10-20-recovery-acceptance.md)、[Cloudflare 运维](2026-10-19-cloudflare-operations.md)、[跨平台备份](2026-10-20-github-offsite.md)。

## 根因与正式配置

操作前，原邮件策略 `68eee86535f549a384704c8e69887244` 为 enabled，配置一个邮件目的地；
八个生产 Worker 的 Issues 检测也已开启，但账户 `automations=[]`。
已有 41 个 Issues 均无通知 activity，通知历史未见 Workers Issues 邮件。
因此缺少的是自动触发条件，不能再用“检测和策略已启用”推断自动通知就绪。

使用原策略和原目的地，分别为 Auth、Web、GU、GZH、Health API、Health 前端、MCP、Ops
创建并重新读取核对两类 service 规则：`afterOccurrences=1` 与
`afterInactivitySeconds=3600`。共 16 条规则均 enabled、service scope，具体 UUID 维护在
[登记表](../cloudflare-resource-registry.md#2026-10-20-issues-自动规则与临时验收资源)。
没有建立账户级广播或修改 `unknown` Worker 的告警范围。

首次阈值在跨过阈值时通知一次；静默后复发要求已有一次 occurrence，且至少一小时没有
新 occurrence。它们不表示持续故障的每小时提醒，也不保证补发规则创建前已越过阈值的
历史问题。本轮没有批量处置那 41 个历史 Issues。

## 隔离故障与完整证据链

临时 Worker 为 `codepi-ops-pr-115`，承接 PR #115 的后续验收；
version `d4f05804-cbd4-4ffe-99f6-719fac912750`，无 D1/R2/service binding、secret
或生产消费者。源码内置 20 分钟到期检查和 isolate 内重复触发保护；实测发出一次异常。
上传前通过 `node --check`，源码 SHA-256 为 `245c29aca2c98b76eb9dca3bc01fbff894a9c67d2ae5b61c6d4debe91bcc85cd`。

临时规则 `65a1aa42-6d76-4203-8484-195b8a6bf75d` 为 service scope、阈值 1，
使用同一正式邮件策略。通过 workers.dev 发出一次 POST，得到预期 HTTP 500，随后立即
关闭 workers.dev 与 preview。调用记录中的 CF-Ray 为 `a4d4a651b883fbf8-LAX`。

| 步骤 | 身份与结果 | 时间（北京时间，UTC+08:00） |
| --- | --- | --- |
| 合成 occurrence | `16f55814-2f6a-40a2-8568-a52d9e3f80be`；exception、count=1；occurrence 详情内核对到精确测试 marker | `2026-10-20T10:39:01.425+08:00` |
| 自动触发 | run `3f91d893-afcf-4d7d-9b0e-c90f14ab2473`，`initiatedBy=automatic`、`status=succeeded`、threshold=1、无执行错误 | `2026-10-20T10:39:22.206+08:00` |
| 原策略邮件发送 | history `428b711f-f13a-4e59-bb81-db26c547cf93`，type=`workers_observability_real_time_issue`，mechanism=email | `2026-10-20T10:39:27.413+08:00` |
| 真实收件 | Gmail message `1a1572db2edaf361`，INBOX；DKIM/SPF/DMARC 均 pass | `2026-10-20T10:39:35.000+08:00` |

发送历史正文仅在内存中核对 service 与 issue ID；Gmail 使用只读 metadata 表示，
检索和 snippet 同时匹配临时 Worker 与 issue 标题。回执只保留 ID、时间和核对结论，
没有保存邮件正文、地址、完整 headers 或退订凭证。
Issue 标题会归一到 `probe.mjs` 的栈位置，故同时以唯一临时 service、发生时间、
occurrence 内的精确 marker、automatic run、发送历史与收件元数据建立关联。
成功空历史返回 `result=null` 时按无记录处理，不将其当作发送成功。

该次实测验证首次自动触发通路。16 条正式规则均已控制面复读核对；
静默后复发本轮没有等待一小时再制造异常，状态为配置核对，不写成实测送达通过。

## 清理与验证

在同一个 production release lock 生命周期内执行所有云端写入。
先按 UUID 删除临时自动规则，将合成 Issue 标为 resolved，再删除临时 Worker，
随后再次列举确认两者不存在，余下正好是 16 条正式自动规则。
清理完成于 `2026-10-20T10:42:52.844+08:00`。

八个生产 Worker 的操作前后活跃 version（均 100%）与绑定身份、observability、Cron、
workers.dev/preview 配置摘要一致；所有原 Worker（含仓库外两个服务）的源码 ETag 和
modified_on 也逐项一致。正式备份、业务数据、密钥和生产访问配置保留。
本轮仅管理通知自动规则与临时合成资源，无业务服务发布或数据迁移。

非敏感证据位于：
`<workspace>/.local/state/kdp.cool/operations/2026-10-20-workers-issues/`，包含 `acceptance.json`、执行脚本、
合成 probe 与锁的归属记录。冻结 lockfile 安装和 4 项受影响检查通过：
Cloudflare 脚本 106/106、治理守门、Agent 回归 26/26，以及 126 个脚本/18 个 JSON 的 lint。
完整相对链接在 PR 集成前另行核对；
Git 集成结果写入同目录回执，以对应 PR 状态为准，不用云端验收代替 Git 检查。

## TODO

- 恢复私钥异机保管：按所有者要求暂缓；后续另存密码管理器或离线介质，并确认其他
  设备能够取回。本轮没有读取、复制、上传或轮换恢复私钥，不将本机成功解密作为异机保管证明。
