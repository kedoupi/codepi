# 五库恢复与告警送达验收

- 状态：Auth、Desk、GZH、Health、MCP 的真实隔离导入、全量内容核对及临时资源清理通过；平台事件邮件已确认收件。Workers Issues 自动触发与收件已由[后续验收](2026-10-20-workers-issues.md)补齐；恢复私钥异机保管保留 TODO。
- 日期与执行人：2026-10-20，当前 Codex，单一协调者、写入者、审查者和集成者，无并行写入。
- 基线：`809a87ea2b547dbc3ccbde4fe9925cc0b7a39e7b`，操作前与实时远程 main 一致。
- 运维工作区：`<workspace>/.worktrees/kdp.cool/codex/gu-online`；工具修复工作区：`<workspace>/.worktrees/kdp.cool/codex/recovery-acceptance`。
- 授权：沿用本会话的 API 运维、隔离恢复、精确临时资源清理，以及审查通过后的 PR 合并授权。
- 接续：[GitHub 跨平台副本](2026-10-20-github-offsite.md)、[GU 非空恢复](2026-10-19-gu-online.md#2026-10-20-投资资料迁移与非空恢复)。

## 备份来源与恢复结果

直接从私有 GitHub Release `417899953` 下载 manifest 和五份数据库密文。
备份实例为 `acceptance-github-backup-20261020T010216314Z`，
manifest SHA-256 为
`3a6ef88ee5d048683b1869f624307403191772caf4950246c3aa9409c8d616ce`，
与前次独立验收一致。逐份核对附件摘要、大小、GCM、库名、生产 UUID、导出时间和
恢复公钥指纹后，以内存 SQLite 载入原始 SQL，作为对应恢复库的比较基准。

| 原库 | 隔离恢复库 / UUID | 表数 | 行数 |
| --- | --- | --- | --- |
| `codepi-auth` | `codepi-auth-pr-114` / `6e3678a8-6611-4905-8b31-80fb7d468c58` | 6 | 44 |
| `codepi-desk` | `codepi-desk-pr-114` / `4e7252d0-c01a-4806-b5b9-4d46e7409f86` | 3 | 5 |
| `codepi-gzh` | `codepi-gzh-pr-114` / `9036a929-31b0-410c-8a6c-ea9f3444c818` | 9 | 11 |
| `codepi-health` | `codepi-health-pr-114` / `2ad4bae0-6c86-42b4-9a44-c1457082383d` | 22 | 138,010 |
| `codepi-mcp` | `codepi-mcp-pr-114` / `97681747-73ec-4a2d-8aeb-edd99b8ee7dc` | 7 | 36 |

五库合计 47 张表、138,106 行，含各库 migration 记录，不计 SQLite/Cloudflare 内部表。
逐项比较表、索引、视图和触发器定义，按确定顺序分页读取全部记录，以字段类型和值
计算行摘要并比较完整多重集；不是抽样或仅比较行数。五库 schema、内容与类型均匹配，
`PRAGMA quick_check` 均为 `ok`，外键检查均为 0 条异常。
Health 包含的 137,401 条 `health_records` 全部参与核对。

至此六个生产库各有真实隔离导入证据；GU 沿用前次 11 表/132 行及 112 份原件的
鉴权下载验收。这些证据对应各自备份时间，不表示六库是一个跨库事务快照，
也不替代跨账户服务重建、生产绑定切换或恢复私钥异机保管。

## 恢复工具性能修复

Health SQL 为 49,297,601 字节，包含 138,011 条 `INSERT`。
原工具每处理一条语句都把剩余整段 SQL 传入 SQLite，导致累计输入随语句数平方增长。
合成回归中，285,940 字节的导出累计传入解析器 143,424,835 字节，预算断言失败。
原 Health 预处理尚未启动 Wrangler 上传时被停止；该进程无导入子进程，
它创建的空 SQL 临时目录已按精确路径删除，已验证的前三库继续保留。

修复位于 `scripts/cloudflare/d1-restore-sql.mjs`：从短前缀开始，必要时倍增，
仅在 SQLite 提前识别出完整语句边界，或已提供全部剩余 SQL 时接受结果。
避免在一个恰好有效但尚未结束的 SQL 前缀处截断多行 `INSERT`。
SQL 允许列表、大正文分块、原始值和字段类型的校验继续适用。
同一份真实 Health SQL 的本机预处理实测为 1,254 ms，输出与原 SQL 逐字节一致。

隔离验收使用固定哈希审查后的本地 CLI 修复，文件摘要记录于 Git 外回执；
修复与本记录一并通过 PR 交付。它只被本机 restore CLI 和 Ops 本地恢复测试引用，
`affectedWorkers` 不选择生产 Worker，不要求业务服务重发。

首次修复版 Wrangler 导入遇到网络请求失败，退出码为 1，临时 SQL 由工具清理。
只读确认隔离 Health 库仍为空、API 正常后，同源 SQL 重试导入成功。
全量核对最初按最大单行大小限制整表分页，后调整为按每批实际字节数分页，
复用已导入的 Health 库；全部字段值和类型仍逐条比较，没有缩小覆盖。

## MCP 授权状态清理演练

在完整内容核对通过后，仅对隔离 MCP 执行恢复手册中的清理：

| 表 | 清理前 | 清理后 |
| --- | --- | --- |
| `mcp_tokens` | 26 | 0 |
| `oauth_auth_codes` | 2 | 0 |
| `oauth_consent_requests` | 2 | 0 |
| `kdp_sso_sessions` | 2 | 0 |
| `kdp_sso_transactions` | 1 | 0 |

`oauth_clients` 的两个注册逐项保持一致。此步骤验证了正式事故恢复时避免复活快照后
已撤销、已轮换或已消费授权的做法；本轮未切换生产绑定或清理生产授权。

## 告警与自然 Cron

控制面确认平台事件与 Workers Issues 两条通知策略启用，均配置账户邮箱。
通知历史查到 7 条平台事件邮件发送记录，未查到 Workers Issues 发送记录。
Gmail 只读检索并核对一封实际收件：平台事件策略
`11766abf994c4e61adf7d19e7b956697` 对应历史记录
`8e0fea95-56c5-4ebe-ab72-29affb4657e6`，邮件在收件箱，
`2026-10-19T23:47:31Z` 收到，DKIM/SPF/DMARC 均通过。
仅保存消息 ID、时间与收件结论，没有保存邮件正文、地址或退订凭证。

Workers Issues 邮箱检索无匹配收件，故本轮只确认平台事件渠道实际送达，
Workers Issues 的问题产生、发送与收件仍是独立 TODO。
没有通过主动制造业务故障或改写巡检报告来宣称该项完成。

自然触发的 `monitor-20261020T013026000Z` 为 `complete`，
报告于 `2026-10-20T01:30:51.495Z` 完成，26/26 通过；
`trigger_source=binding`，与 Ops scheduled 入口及实例命名一致。
它补齐了此前仅手动触发 monitor 的验证范围。凭证修正后的下一次每日备份 Cron
仍以实际实例和回执为准，不把本次隔离恢复写成新一次定时备份。

## 清理、验证与交付

演练于 `2026-10-20T02:17:15.955Z` 完成。清理前核对全部 Worker 的 D1/R2/service
绑定与活跃版本未变，五个临时库均无消费者。按精确名称和 UUID 删除五库后，
再次列举确认账户 D1 回到原六个生产库。临时下载目录、Wrangler 日志和临时 SQL
已清理；正式 GitHub manifest 再次核对一致，原 R2/本机固定密文、原投资资料、
恢复私钥与生产资源保留，生产发布锁已释放。

`pnpm install --frozen-lockfile` 通过；相对基线的 7 项受影响检查通过：
Cloudflare 脚本 106/106、治理检查、Agent 回归 26/26、lint、Ops 单测 19/19、
Ops dry-run 构建及原生 Workflows/GU RPC/R2 隔离恢复测试。
恢复专项为 10/10，包含解析输入预算及多行 INSERT 边界回归。
原生运行时输出了一条 RPC result disposal 警告，完整恢复与鉴权下载测试仍通过；
本轮未改 RPC 生命周期。Git 集成与最终检查结论保存在同目录的交付回执，
不把本地测试或隔离演练自动等同于 GitHub CI 成功或生产发布。

非敏感证据目录：
`<workspace>/.local/state/kdp.cool/operations/2026-10-20-recovery-acceptance/`，
包括 `recovery.json`、`notifications.json`、`health-preparation.json`、
失败与中断元数据、固定源码检查日志和执行脚本；没有 SQL、原件、邮件正文或凭证。

剩余事项：

1. Workers Issues 已由[后续验收](2026-10-20-workers-issues.md)补齐自动触发规则、实际发送与收件，临时资源已清理；上文保留本轮较早时的观察。
2. 所有者将恢复私钥另存至密码管理器或离线介质，并独立确认异机可取回。
   当前机器上 `0600` 的私钥及本轮成功解密不能证明此项已完成。
