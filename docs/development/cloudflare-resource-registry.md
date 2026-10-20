# Cloudflare 资源登记表

2026-10-20 CodePi MCP 领域扩展已从实时 main `58bd615c317d` 发布。十个生产 Worker
均为单一活跃版本、100% 流量且 `BUILD_SHA=58bd615c317d`；Project/Me 的 D1、SSO、
私有 R2、Issues 规则和 Ops v3 覆盖已创建并回填。生产备份实例
`cf_93cea89d2248417b1d15530d606a6f32cb921ac8f6cbbf8c24486786218d5572`
覆盖八库和 GU/Me 两类原件，GitHub 分片副本与 120 个 payload 独立下载校验通过；
8 个隔离 D1 的真实恢复共核对 98 张表、138,986 行，GU 112 份原件逐件通过，
临时资源和明文已清理。云端巡检 34/34。详见
[领域扩展任务](tasks/2026-10-20-codepi-mcp-domains.md)。

2026-10-20 MCP 全量 scope 授权已通过 PR #133 合并为
`3ad248e1c9887e9a652ec85415de0c00a7dc8721`，并从干净、等于实时远程 main 的
detached 源码持锁发布。MCP 活动 version 由
`c6b62b1e-bab3-415f-83e4-4da2beeb3643` 更新为
`29c7f8ed-6b40-41ef-95cd-fa4b5b56d931`，保持 `BUILD_SHA=3ad248e1c988`、
单一 100% 流量和既有 D1/Auth/domain RPC 绑定。线上 readiness、Auth 凭证配对、
两种 discovery、匿名拒绝和连接管理登录跳转通过；本地 36 项测试、typecheck、build、
桌面/390px 浏览器验收及 PR CI 全部通过。既有两个活动连接已是全量 scope，
本次未轮换 secret 或写入业务数据。详见
[MCP 领域任务](tasks/2026-10-20-codepi-mcp-domains.md#全量-scope-授权发布)。

2026-10-20 Project GitHub 同步后续验收：`GITHUB_TOKEN` 已按所有者确认的只读
fine-grained 权限配置为 `secret_text`。Secret 变更生成新 Worker version
`bb43c090-0370-43c3-b5f6-c3242df79da5`，保持 `BUILD_SHA=58bd615c317d`、两个 Secret、
D1/Auth/Assets 绑定和 `fetch`/`scheduled` handlers。下一次生产 Cron 于
`2026-10-20T10:15:38Z` 将 commits、pull requests、issues、AGENTS.md 和任务文档五个
来源全部同步成功，无 checkpoint/error；写入 286 条仓库事件和 30 条任务文档索引，
`card_fields` 4 条、活跃同步租约 0。

2026-10-20 Workers Issues 自动告警已完成端到端验收：补齐此前缺失的自动触发规则，
十个生产 Worker 各有首次阈值 1 与静默 3600 秒后复发两条规则，共 20 条，
均按 service 限定并引用原邮件策略。隔离合成异常的 automatic run、通知历史和 Gmail
收件已关联，临时 Worker/规则已清理；生产版本、绑定、Cron 与入口配置核对一致。
恢复私钥异机保管继续保留 TODO。详见[告警验收](tasks/2026-10-20-workers-issues.md)；
以下记录保留各轮当时状态。

2026-10-20 五库恢复与告警后续验收：直接使用私有 Release `417899953` 的自动备份，
Auth/Desk/GZH/Health/MCP 共 47 表、138,106 行导入独立临时 D1，全部 schema、字段值、
类型、完整性及外键检查通过。MCP 隔离库清除快照授权和会话状态，两个客户端注册保持一致。
五个临时库已按精确 UUID 删除，账户 D1 再次列举为原六个生产库；临时下载、日志与 SQL
已清理，正式备份、原资料、恢复私钥及生产绑定/活跃版本保留。
平台事件邮件已由通知历史与 Gmail 收件箱交叉确认，Workers Issues 实际送达仍待验收。
自然 `monitor-20261020T013026000Z` 为 complete、26/26；恢复私钥异机保管仍待所有者确认。
本轮只修复本机恢复 CLI，不发布业务 Worker。详细范围、失败重试与清理证据见
[五库恢复与告警验收](tasks/2026-10-20-recovery-acceptance.md)；以下记录保留当时状态。

2026-10-20 GitHub 自动跨平台复制与云端巡检已验收：所有者配置的 `GITHUB_TOKEN`
已确认为加密 Secret，凭证类型修正使 Ops 生效 version 更新为
`22c8ca10-1462-4076-8412-0bd8d05613ba`，`BUILD_SHA=05d9d61ce574` 未变。
从干净且等于实时远程 main `3982013f7bd8` 的源码持锁创建新 backup 实例
`acceptance-github-backup-20261020T010216314Z`，六库、112 份原件和 manifest
自动复制到私有 Release `417899953`，Workflow 为 `complete`，自动成功回执匹配。
119 个附件独立下载、摘要、GCM、身份和内存解密通过；匿名 Release API 为 404。
新 monitor 实例 `acceptance-github-monitor-20261020T010216314Z` 云端 26/26，
包含八个 Worker 的源码范围核对和两处完整备份新鲜度。Ops 私有入口、两个 Cron、
GU named RPC、日志及备份桶私有访问重新核验通过；没有重新构建业务源码或修改生产数据。
本轮手动触发生产 Workflow，没有等待下一次 Cron；旧失败与手动回执均保留。
详见[跨平台验收](tasks/2026-10-20-github-offsite.md)；以下记录保留当时状态。

2026-10-20 GitHub 手动跨平台副本已验收：定时备份
`backup-20261019T180026000Z` 的六库、112 份原件及 manifest 共 119 个附件已复制至
私有 `kedoupi/codepi` Release `417885437`。从 GitHub 独立下载、摘要、
GCM、身份与原件内容校验全部通过，匿名 Release API 为 404。
独立回执为 `reports/manual-offsite/backup-20261019T180026000Z.json`，已读回核对；
未改写自动 Workflow 报告。本机 `gh` 仅用于进程内授权，没有转存到 Worker。
Ops 仍只有 `CLOUDFLARE_API_TOKEN` secret，自动复制与云端版本核对仍缺运行凭证，
云端巡检 17/19；同一 GitHub API 版本逻辑在本机 8/8 通过。未发布 Worker，
GU/生产数据、既有备份及恢复私钥均保留。详细证据与所有者操作见
[跨平台验收](tasks/2026-10-20-github-offsite.md)。
以下记录保留各次操作当时的状态。

2026-10-20 Health 历史同步告警修复已发布：PR #111 合并为
`fcb838be044c8a941e0f149fa60b42cc21236453`，当前 Codex 从干净且等于实时远程
main 的源码持锁发布 Health API 和 MCP。新 version 分别为
`c0ef45e9-a3fc-4d7b-9231-2b7057a94c52`、
`13442128-8f7c-4ae5-9705-9fcaba2001b1`，均承接 100% 流量，
`BUILD_SHA=fcb838be044c`。API 18 项检查、MCP 5 项探针和生产巡检 24/24 通过；
控制面核验绑定、Cron、持久日志、脱敏和 Issues。真实账号状态回查确认 16 类旧告警归零，
只读 D1 聚合确认 48 条历史失败仍保留；未触发同步、修改健康记录或轮换凭证。
Health 前端和其他服务保留原活跃版本。详细证据见
[Health 修复与发布记录](tasks/2026-10-20-health-sync-alerts.md)。

2026-10-20 GU 非空资料迁移与恢复验收完成：生产工作区为 revision 1，资料索引 112 件；
实例 `acceptance-gu-nonempty-20261019-1907d1ed` 完成六库及全部资料的 R2 密文和完整回执。
现有私钥解密通过，真实 GU 隔离 D1 的 11 表/132 行及全部 112 份资料的隔离鉴权下载
核对一致。GU/Ops 的活跃 version 与 `BUILD_SHA=05d9d61ce574` 未变，
生产资料桶、备份桶与新恢复桶均无公开访问。跨平台复制仍为
`offsite=failed / github_token_missing`，不将 R2 完整成功视为跨平台保障。
大正文恢复工具修复和本次证据已由 PR #109 合入 main；两轮临时 D1/R2、迁移和恢复
临时目录及对应日志已按授权清理，正式密文、恢复私钥、原投资目录与生产数据均保留。
六个生产 D1、生产 GU 索引/R2、正式 R2 备份和 GU/Ops version 已再次核对。
详细证据见[集成与清理结果](tasks/2026-10-19-gu-online.md#集成与清理结果)；
下方临时资源表保留名称与删除证据，不再代表可用的恢复环境。
以下首次发布记录保留为历史状态。

2026-10-19 GU 线上工作台与原件备份已发布：PR #107 合并为
`05d9d61ce574377a59acfb674f383f2fc24ad4b4`，当前 Codex 从同树、干净且等于
实时远程 main 的源码持锁，完成 GU migration、私有 `codepi-gu-uploads` 及
GU → Ops 发布。两个 Worker 均为唯一活跃版本、`BUILD_SHA=05d9d61ce574`；
Ops 的 `GU → codepi-gu#GuMaterialsBackup`、私有入口、Cron 与持久日志已核验。
真实实例 `acceptance-gu-05d9d61ce574` 于 `2026-10-19T15:08:11.074Z` 完成六库
R2 密文和 v2 清单，六库大小/SHA-256/GCM/身份及内存解密 6/6 通过。
GU 恢复到全新隔离 D1 后，11 表/21 行及全部内容核对一致；
生产资料为 0 件，非空真实原件恢复仍未验收，隔离远程 D1/R2 合成鉴权下载通过。
本地生产巡检 24/24；云端巡检 17/19，GitHub 版本核对与跨平台复制仍因缺少
`GITHUB_TOKEN` 失败，备份 Workflow 为 errored，不能称运维全部完成。
临时恢复资源保留并登记在资源表之后，不接生产 binding，也不建立长期环境。
详细版本、恢复与剩余项见 [GU 任务记录](tasks/2026-10-19-gu-online.md#实际发布与验收)。
以下大库修复等记录保留为历史证据。

2026-10-19 大库备份修复发布：PR #104 合并为
`da3324db27bf3562cf5515237f1f5b6dfe197488`，与已验证分支
`69a9254349c729ed2104772c5f1cdba0fc86ee30` 的 tree 一致。当前 Codex 从干净且
等于实时远程 main 的源码持锁发布 Ops，新 version
`7ec36e4e-0682-4e42-8e4a-fc87c030fd37` 承接 100% 流量，
`BUILD_SHA=da3324db27bf`，前一版本为 `c4b6f267-967e-425f-9596-43d3b8a5d137`。
真实实例 `acceptance-backup-da3324d` 于 `2026-10-19T07:50:13.808Z` 完成全部六库
R2 密文、manifest 和完成回执；六份密文的 SHA-256、GCM、库身份及既有私钥内存解密
全部通过，明文未落地。原来的 16 MiB 代码保护限制已被有背压的流式分片上传替代，
没有修改恢复格式、私钥或业务数据。本地生产巡检 24/24 通过，含八个 Worker 的版本核对。
Ops 隔离、Cron、R2 14 天生命周期、最小权限 token、持久日志与 Issues 再次核验通过。
跨平台复制仍因缺少 `GITHUB_TOKEN` 失败；实例于 `2026-10-19T07:51:45.060Z`
errored，R2 完整副本保留。云端巡检已确认 R2 备份新鲜度通过，剩余失败为 GitHub
版本核对和跨平台副本，未标记为全部恢复。详细证据见
[运维任务](tasks/2026-10-19-cloudflare-operations.md)。以下首发记录保留为历史快照。

2026-10-19 定时运维迁移发布（北京时间）：PR #103 合并为
`67f13bb85e7e287074190481487cdd64ed162451`，合并树与已验证分支
`94429e0508581fb643a5f6f8b48e1662290983ac` 一致。当前 Codex 在本机持有发布锁，
从干净且与实时远程 main 一致的源码发布八个 Worker，全部活跃版本
`BUILD_SHA=67f13bb85e7e`；本地 release drift 8/8 通过。新增 Ops 私有 Worker、
Workflow、R2 桶、两个 Cron 与专用 token 已由控制面核验；无公网域名、
workers.dev 或 preview URL。备份验收明确失败：`acceptance-backup-67f13bb`
完成 auth/desk/gu/gzh 四个加密导出，`codepi-health` 原始导出三次超过
代码设置的 16 MiB 原始导出保护上限后实例 errored，未写 R2 完整成功清单，六库备份尚未恢复；
monitor 未触发，`GITHUB_TOKEN` 仍未配置，跨平台备份保持失败。证据见
[运维任务](tasks/2026-10-19-cloudflare-operations.md)。

2026-10-19 后续只读诊断：GitHub Actions 的账户免费分钟已用完（2,000 / 2,000），
额外预算为 $0，账户页显示 `Usage blocked`；备份 run `39192113905` attempt 2
仍未分配 runner。定时巡检与六库异机备份尚未恢复，未修改预算。
Health 当天同步并非仍在授权阻塞：`2026-10-19T03:15:48.851Z` 为 68 / 92 完成，
`03:21:09.729Z` 推进到 71 / 92，0 失败且当前错误为空；18 类详细集合有当天成功窗口。
整轮成功时间仍是 `2026-10-15T15:16:55.898Z`，30 小时告警保留，整轮完成待验收。
证据与访问边界见 [运维任务](tasks/2026-10-19-mcp-operations.md)。
本段未涉及 Worker 发布或生产数据写入；以下为此前核验快照。

2026-10-19 MCP 运维补齐已合并发布：PR #101 合并为
`0ce7d35636d53291b1b7ebbc7f84d7d7d6a0741b`。当前 Codex 在本机持锁，从干净且与
实时远程 main 一致的源码为 Auth、Web、GU、GZH、Health 前端补发实际构建版本，
均带 `BUILD_SHA=0ce7d35636d5`；Health API/MCP 保留运行代码未变的首发版本。
七个 Worker 的活跃版本、绑定、Cron、持久日志、脱敏和 Issues 通过控制面核验；
七项代码漂移和 MCP 五项探针全部通过。完整巡检 22/23，唯一失败仍为 Health
最后完整自动同步约 84 小时前，未降低门槛。

六库备份清单已包含 `codepi-mcp`，本机六份密文、manifest、完整性和现有私钥内存解密
已验收，未产生 SQL 明文文件。GitHub backup run `39192113905` 与 monitor run
`39192113912` 均无 runner/steps，前者 artifacts 为空；定时运行及新异机备份仍未恢复。
未轮换 secret；真实 AI 客户端流程未验收。逐服务前后 version、快照位置和剩余项见
[运维任务](tasks/2026-10-19-mcp-operations.md)；以下首发记录保持历史事实。

2026-10-19 统一 MCP 首发完成（北京时间；UTC 完成时间 `2026-10-18T16:36:41.754Z`）：
PR #99 已合并为 `767fb0b3d63a43aed8f2ca0a78a7b7a9271cabe4`，当前 Codex 在本机持有发布锁，
从与实时远程 main 一致的干净源码依次发布 Auth、Web、GU、GZH、Health API、MCP、
Health 前端。七个 Worker 均已核对实际 version、100% 流量、绑定、Cron 和日志配置；
逐服务 previous/new version 见 [MCP 发布记录](tasks/2026-10-18-unified-mcp.md)。

`mcp.codepi.app/mcp` 已启用，MCP version `dabf3c40-2360-40ec-b603-50c1d317ec13`，
独立 D1 为 `73c6ef4e-e2a0-41c2-9bce-ab41c7391caa`，已应用 `0001_mcp.sql`。
仅新配对 MCP 的 SSO 凭证，既有客户端和 Oura 凭证未轮换。Health API build 为
`767fb0b3d63a`；18 项 API 检查、前端资产核验、新 MCP 发现/凭证配对/匿名拒绝通过。
首次域名探针发生 TLS 连接中断，后续在同一版本复测通过，之后才发布 Health 前端。

真实 AI 客户端授权和查询尚未验收。通用生产巡检 10/11 通过；Health 同步新鲜度仍失败：
发布前的任务已于 `2026-10-18T09:04:37.417Z` 以 `partial/upstream_unavailable` 结束，
最后完整成功时间为 `2026-10-15T15:16:55.898Z`。此次发布没有修复或掩盖该上游问题。
GitHub 附加 CI 的 jobs 没有步骤执行记录且无可下载日志，不记为 CI 通过；本地 31 项检查通过。
补充 SSO 检查期间出现一次约 11 秒后的 HTTP 500；随后新旧 D1 查询正常，MCP 登录
连续三次 302、完整登录跳转与旧路径检查再次通过。未修改代码重试或确认该次 500 根因，
不把这段间歇性故障写成已通过代码修复。

2026-10-18 统一 MCP 源码切换（历史记录，当时未部署）：`services/mcp/` 新增统一入口，旧 Health MCP、
OAuth 服务与连接管理代码直接删除。目标行为为 Health 旧连接器 URL 返回 404 JSON，
客户端改连 `mcp.codepi.app/mcp` 并重新授权；Health 只通过 named RPC 向 MCP 提供数据。
本轮未访问或修改控制面、远程表或凭证；下方旧 MCP 可达性记录仍是历史证据，
不能据此声称新入口或旧路径退役已在线验收。截至 2026-10-18，MCP Worker/D1
仍为 `planned`；该状态已由 2026-10-20 发布记录取代。

2026-10-18T08:33:58Z 原账号连接修复发布：PR #97 合并为
`85c060bda5e96755a07bae4164e1aecfe75e95b2`，本 Codex 会话持有本机发布锁，
从与实时远程 main 一致的干净源码先执行 migration 0012，再发布 Health API
和前端。API version `3a78e935-726f-408a-9da3-0bbe210b8587`，build
`85c060bda5e9`；前端 version `a4bca3a2-872f-4e90-922f-980dd1edea75`。
前一版本分别为 `fa60c2fb-1f1c-4206-8000-6032542c7c3c` 和
`0aa41bdc-9c2e-4f85-bdb3-0e37734ee492`。16 项正式域名 API 检查与前端
资产检查通过。08:34:22Z 控制面确认双版本各承接 100% 流量、绑定、Cron、持久
日志、脱敏和 Issues。设置页已提供显式修复入口；真实授权与同步恢复仍待所有者
操作，当前仍为 `blocked/reconnect_required`。发布未手动改绑或轮换密钥。
完整步骤和待验收项见[平台可靠性任务](tasks/2026-10-18-platform-reliability.md)。

2026-10-18T07:10:34Z 同账号 Oura 标识诊断发布：PR #96 已合并为
`b4ad03bf168ec6ccf43d75307d2ed584eac50657`，从与远程 main 一致的干净源码，
持有本机发布锁执行 Health API 发布。无待迁移文件；新 Worker version 为
`fa60c2fb-1f1c-4206-8000-6032542c7c3c`，100% 流量，build `b4ad03bf168e`，
前一版本为 `4ae86a3b-e7b7-4ec6-8091-7c24f1e922f1`。16 项正式域名检查通过，
控制面核实版本、build、Cron、持久日志、查询串脱敏和 Issues。新版本尚无 Oura
回调，待所有者重新连接以取得无私人标识的比较结果。账号绑定未修改，同步未恢复。

2026-10-18T05:54:50Z Oura 回调诊断补丁本地发布：PR #95 已合并为
`aabc810d042fbe071f6284fafe0379555fe39d1e`。本 Codex 会话从干净且与远程 main
一致的源码、持有本机发布锁执行 Health API 发布，无待迁移文件。新 Worker version
`4ae86a3b-e7b7-4ec6-8091-7c24f1e922f1` 承接 100% 流量，build
`aabc810d042f`；前一版本为 `f3eb6ecb-72f3-4415-862d-350fc11eb819`。
16 项正式域名契约检查通过，控制面复核 build、Cron、持久日志、查询串脱敏和 Issues。
本次增加回调结果日志；尚未收到新版本的 Oura 回调，授权失败根因和真实同步恢复仍待验收。
其他服务未发布。详细证据见本次平台可靠性任务记录。

2026-10-18T05:24:34Z 正常本地发布验收：所有者决定将“PR 合并 main 后本机发布”
作为正常流程，PR #93 已合并为 `4d931faf7a5399c028dc6875d24a3f91a2e084c6`。
本 Codex 会话持有本机发布锁，从与远程 main 一致的干净源码执行现有 Health API
发布脚本；无待迁移文件。Worker version 为 `f3eb6ecb-72f3-4415-862d-350fc11eb819`，
100% 流量，build `4d931faf7a53`，前一版本为 `b22b62ff-4cb5-4cb9-b598-79dac7cb07f6`。
16 项正式域名 API 契约检查通过，控制面确认 Cron、持久日志、脱敏和 Issues。
同步仍为 `blocked/reconnect_required`，等待 Oura 重连；10 项巡检通过，Health
新鲜度检查仍失败。其他应用运行代码与配置未变，保留现行版本。
Actions 发布和旧部署重试入口已从 main 移除，CI 只验证；本次不再需要补 Actions 发布。
定时巡检、备份仍独立保留，runner 故障尚未恢复。操作步骤见
[本地发布操作](local-release.md)，完整证据见 [任务记录](tasks/2026-10-18-platform-reliability.md)。
以下应急发布记录保留为历史，不代表当前仍待合并：

2026-10-18T05:14:49Z Health API 应急本地发布：所有者明确要求在本机执行发布，
执行人为本 Codex 会话，原因是 GitHub Actions jobs 在 runner 启动前失败。
从干净且已推送的 PR #93 source `fbc13c902edb0c47e389e3a140e944f233750cfa`
运行与 workflow 相同的 `pnpm deploy:api`，无需新增迁移；生产 Worker version
`b22b62ff-4cb5-4cb9-b598-79dac7cb07f6` 承接 100% 流量，build 为 `fbc13c902edb`。
前一版本为 `db789c62-4402-42a3-88e8-fe4ce14439cd`。16 项线上 API 契约检查通过；
Cron、持久日志、查询串脱敏和 Issues 已核对。真实 cron 后同步状态为
`blocked/reconnect_required`，仍需所有者重新连接 Oura；数据同步尚未恢复。
PR 尚未合并，main 仍为 `58f7848`；Actions 恢复后须补 PR 检查、正常合并及 main
workflow 发布证据。本地巡检仅 Health 新鲜度失败，其余 10 项通过；本次执行未恢复
定时巡检和备份。详情见 [任务记录](tasks/2026-10-18-platform-reliability.md)。

2026-10-18 平台可靠性落地：旧 CloudBase 匿名泄漏路由 `api.xiaotaozi.cc/oura/daily`
已通过 CloudBase `ModifyHTTPServiceRoute` 置 `Enable=false` 并核实匿名请求返回 403，
其余路由不受影响。新增两条 Cloudflare 通知策略（`incident_alert`、
`workers_observability_real_time_issue`，均走账户邮箱机制）并登记于下表。
全部 6 个生产 Worker 已通过控制面 API 开启持久化调用日志并脱敏查询串，已查到
Health cron 的实际执行日志；相同配置写入 Wrangler 并由治理守门强制。
新增 `.github/workflows/production-monitor.yml`（30 分钟只读巡检）与
`.github/workflows/d1-backup.yml`（每日导出 5 个生产 D1，经 gzip/AES-256-GCM 与
RSA 公钥封装后保存为 GitHub Actions artifact，14 天到期删除）。
两者复用 production Environment 已有凭证；首次备份 run `39090056809` 已成功，
artifact 中五个库均通过完整性与私钥内存解密验证。巡检 run `39090056823`
如实报出 Health 同步不新鲜，故障恢复仍待验收。
Health API compatibility_date 已由 2025-01-01 升至 2026-10-15，
PR #81 发布后经控制面核实。备份/恢复约定及私钥保管见
[cloudflare-backup-restore.md](./cloudflare-backup-restore.md)，本轮格式的恢复演练和
验证边界见 [任务记录](tasks/2026-10-18-platform-reliability.md)。GU 迁移文件双 0002
与 git 历史中的真实数据按既定决策保留，迁移追加守门 `check-migrations.mjs`
仅容许原来的两个文件，不容许增加第三个同编号文件。
新格式恢复演练已通过：临时 D1 `codepi-health-pr-81`
（`7685ecb8-fa28-4a4a-81bb-743b1c1e97d4`，synthetic，期限 2026-10-18）
恢复 2 条合成记录并校验；非空目标再次导入被拒绝。演练后已删除该库，账户 D1
列表复查仅剩原来的五个生产库。PR #81 / #91 已合并并发布；
恢复私钥异机或离线保管仍待所有者完成。

2026-10-18 staging 全面退役与前端代理清理：仓库内全部 `[env.staging]` 配置已移除
（www/gu/gzh/auth/health-api/health-pages），治理守门改为 fail-closed 拒绝任何 staging
段、staging 主机或 `-staging` 资源名。云端同步删除：`codepi-auth-staging` 与
`codepi-health-api-staging` Workers、5 个 `-staging` D1 与 `codepi-health-preview`、
`auth-staging.codepi.app` workers domain，以及 zone 内残留的 8 条指向
`codepi-health-api(-staging)` 的 routes（zone routes 清零）。`codepi-health` 前端 Worker
绑定收敛为 ASSETS + WORKER（`codepi-health-api`），DB/AUTH/vars 全部移除；生产核验
`/api/health` 200 与 SPA root 200 不受影响；PR #80 合并后生产 build 为 `3a024e95216e`。环境模型收敛为
local + production 两档。staging D1 仅含 synthetic fixture，无真实数据损失。

2026-10-17 首页/Desk 切换完成：`codepi.app` 与 `www.codepi.app` 已由 `codepi-www`
Worker（Static Assets）服务，旧 Pages 正式域名绑定已移除。版本、凭证和域名切换证据见
[首页迁移记录](tasks/2026-10-17-web-static-assets.md)。

2026-10-17 GZH 切换核验：PR #72 合并为 `da06d1d`，main 发布 run `39034618586`
第二次执行成功，GZH Worker version 为 `8c6d3232-edf2-4252-b044-b2c20815ecb3`。
`gzh.codepi.app` 已切换为 Worker custom domain，旧 Pages 正式绑定已移除。
新 Worker 与正式域名的预览鉴权检查、线上资产逐字节比对、中央 Auth callback 检查通过；
完整生产登录、Desk 摘要与稿件流程未验收。staging named environment 未启用，
旧 Pages 项目及其 staging 绑定保留。版本、凭证重建、切换和保留入口的覆盖边界见

2026-10-18 Health 切换核验：PR #77 合并为 `ff6f767`，main 发布使 `codepi-health`
前端 SPA Worker 上线（`/api/health` 报告 `build=ff6f76748489`）。`health.codepi.app`
已切换为 Worker custom domain（`be31f1f926405444ba50479af2d3dfd4cc555568`），
旧 Pages 正式域名绑定已移除，`codepi-health-api` 不再持有公网 routes，API/MCP/OAuth
经前端 Worker 的 WORKER service binding 转发。预切换与正式域名探针通过：root 与 SPA
深链 200 HTML、`/api/me` 200 匿名 JSON、`/mcp` GET 405 JSON、`/.well-known/*` 与
`/well-known/*` 重写 200 JSON。完整生产登录与真实 Oura 同步未验收；staging 域名
`health-staging.codepi.app` 仍绑定旧 Pages，staging named environment 未启用。
[GZH 迁移记录](tasks/2026-10-17-gzh-static-assets.md)。

2026-10-18 旧 Pages 体系退役：四个旧 Pages 项目（`codepi-www`、`codepi-gu`、
`codepi-gzh`、`codepi-health`）连同各自 staging 自定义域名绑定与 zone 内
`staging`/`gu-staging`/`gzh-staging`/`health-staging` 四条 CNAME 已全部删除。
`auth-staging.codepi.app`（AAAA `100::`，`codepi-auth-staging` Worker custom domain）保留。
生产域名核验不受影响：`codepi.app`/`www.codepi.app` 200、`gu.codepi.app`/`gzh.codepi.app`
302、`health.codepi.app` 200、`auth.codepi.app` 根路径 404。staging 域名此后由仓库内
Workers named environment（`codepi-*-staging`）在需要时重新发布绑定；删除前这些 staging
域名指向的旧 Pages 均未启用。

账户：`Kedoupi`（`69f1de4c8f3c7411593613711207e7b3`）。本表是版本化登记记录；
实时状态以当次 Cloudflare 控制面核实为准。治理规则见 [cloudflare-governance.md](./cloudflare-governance.md)。

2026-10-17 GU 配置重建：执行者为当前 Codex，代码基线 `33207cd`。用户明确允许按最终
方案重建旧测试状态，因此通过 API 新生成并配对 GU SSO 与 Desk 摘要凭证，替代恢复旧值
的人工流程；仅失效 GU 的 6 条 SSO 会话与 2 条登录事务，业务数据未改。新 Worker
匿名探针与 2 个资产逐字节比对通过；PR #70 合并为 `953f4ad`，main run `39031855993`
的 GU/Auth/首页发布完成。`gu.codepi.app` 已改为 Worker custom domain，旧 Pages 正式绑定
已移除，staging 绑定和项目保留。范围、版本、验证和未接入的上传/日历见
[GU 运行配置重建](tasks/2026-10-17-gu-runtime-bootstrap.md)。这不是完整登录验收记录。

2026-10-17 Auth Hono 迁移核验：PR #67 合并为 `ad8352202ed406357afd0f3c140a1c84b6e67cf9`，
main 发布 run `39021027068` 的 13 个 job 全部成功。四个 Pages canonical deployment 均为该
干净 SHA；Auth 当前 version 与 CI 发布日志一致，Health API 线上 build 为 `ad8352202ed4`。
三产品 Pages smoke、Auth 5 项无邮件副作用探针与 Health 16 项接口检查通过。六个生产计算
资源的 provider 标识和真实流程未覆盖项见 [Auth Hono 发布记录](tasks/2026-10-17-auth-hono.md)。
本轮未重新审计数据库、staging、DNS 或 unknown 资源；下文 2026-10-16 记录保留为历史证据。

2026-10-17 GU 部署载体迁移登记：GU 从 Pages 项目迁移为 Workers Static Assets 架构的
Worker `codepi-gu`（`pages-gu` → `worker-gu`），staging 承载从 Pages preview 环境迁移为
named environment Worker `codepi-gu-staging`（`worker-gu-staging`，保留未启用、不接发布入口）。
本注记登记的是仓库配置侧的载体决策与治理形态；Worker 的 provider 标识、custom domain
切换结果与线上核验证据见 [GU Static Assets 迁移记录](tasks/2026-10-17-gu-static-assets.md) 及
[配置重建续作](tasks/2026-10-17-gu-runtime-bootstrap.md)。正式域名已切换，旧 Pages 单独登记保留。

2026-10-17 GU Hono 迁移核验：PR #59 合并为 `ffe762e`，main 发布 run `38991512923`
成功；四个 Pages canonical deployment 均为该干净 SHA，Auth / Health API 当前版本已核对。
GU 线上资源逐字节匹配与 10 项路由边界探测、三产品 Pages smoke、Auth health 和 Health
16 项接口检查通过。具体版本及真实账号 E2E 未覆盖范围见
[GU Hono 发布记录](tasks/2026-10-17-gu-hono-router.md)。本轮未重新审计数据库、staging 或 unknown 资源。

2026-10-17 后续核验：`158484c` 的 main 发布 run `38966431148` 成功；四个生产 Pages
均为该干净 SHA，Auth/Health API 的 deployment/version 已核对，匿名 smoke 与 Health
16 项接口检查通过。具体版本与未验收边界见
[shared 严格白名单发布记录](tasks/2026-10-17-shared-strict-exports.md)。
本次只更新六个生产计算资源的核验日期，不表示重新审计了数据库、staging 或 unknown 资源。

2026-10-16 后续核验：workspace 与单主干规则已合并，但 run `38883652043` 的构建失败、
部署跳过；GU 和 Desk 私有接口存在 503。诊断、GU 回退及恢复原版本的操作记录见
[Workspace 发布链修复](tasks/2026-10-16-workspace-release-repair.md)。下文较早的 smoke
结果保留为历史证据，不覆盖后续失败。

字段固定为：`logical_id`、`environment`、`resource_type`、`physical_name`、`owner`、`purpose`、
`data_classification`、`consumers`、`hostname_or_route`、`config_source`、`status`、`last_verified`。
临时资源另填 `expires_on` 与 `cleanup_evidence`。本表只存非敏感元数据：禁止写入 API token、
secret 值、个人数据或 OAuth refresh token。

`status` 取值：
- `managed`：仓库运行配置直接引用、受本治理约束的资源。
- `legacy-preview`：早期 preview 资源，确认无消费者后按退役规则处理。
- `legacy-pending-retirement`：旧体系资源，退役条件见治理文档第 6 节。
- `unknown`：不在当前仓库配置中、归属未确认。禁止重命名、迁移或删除。

## 资源表

<!-- registry-table:begin -->
| logical_id | environment | resource_type | physical_name | owner | purpose | data_classification | consumers | hostname_or_route | config_source | status | last_verified |
|---|---|---|---|---|---|---|---|---|---|---|---|
| zone-codepi-app | production | zone | codepi.app | kedoupi | 主站与产品域名 zone | public-dns | 全部产品 | codepi.app | Cloudflare 控制面 | managed | 2026-10-16 |
| zone-kdp-cool | production | zone | kdp.cool | kedoupi | 历史域名 zone | public-dns | 未审计 | kdp.cool | Cloudflare 控制面 | managed | 2026-10-16 |
| worker-project | production | worker | codepi-project | kedoupi | Project 项目卡与任务交接 | private-user-data | 终端用户、worker-mcp ProjectMcp | project.codepi.app | apps/project/wrangler.toml | managed | 2026-10-20 version bb43c090-0370-43c3-b5f6-c3242df79da5；BUILD_SHA 58bd615c317d；100% 流量，SSO/匿名 401 通过；AUTH_CLIENT_SECRET 与只读 GITHUB_TOKEN 均为 secret_text；Cron 五来源同步成功，286 事件、30 任务索引 |
| d1-project | production | d1 | codepi-project (03612540-2ac6-4dd2-9bf6-ed431dda17c9) | kedoupi | Project 数据与 SSO 会话 | private-user-data | worker-project DB、Ops 加密导出 | - | apps/project/migrations | managed | 2026-10-20 2 个 migration；v3 隔离恢复 10 表/3 行全量内容与类型一致 |
| worker-me | production | worker | codepi-me | kedoupi | Me 确认区、资料与经历 | private-user-data | 终端用户、worker-mcp MeMcp、worker-ops MeImportsBackup | me.codepi.app | apps/me/wrangler.toml | managed | 2026-10-20 version 42a25c9c-a14a-4b65-b855-49265bc8baef；BUILD_SHA 58bd615c317d；100% 流量，SSO/匿名 401 通过 |
| d1-me | production | d1 | codepi-me (7236c118-1f92-4b07-8283-e731c2771953) | kedoupi | Me 数据、导入索引与 SSO 会话 | private-user-data | worker-me DB、Ops 加密导出 | - | apps/me/migrations | managed | 2026-10-20 1 个 migration；v3 隔离恢复 10 表/2 行全量内容与类型一致 |
| r2-me-imports | production | r2 | codepi-me-imports | kedoupi | Me 私有导入原文 | private-user-data | worker-me IMPORTS；Ops 仅通过 MeImportsBackup RPC | 无公开入口 | apps/me/wrangler.toml | managed | 2026-10-20 已创建并验收：无 custom domain、r2.dev 关闭；空集合 0 件被 v3 manifest 明确覆盖 |
| worker-www | production | worker | codepi-www | kedoupi | 首页与 Desk 摘要（100% 流量） | private-user-data(desk) | 终端用户 | codepi.app, www.codepi.app | apps/web/wrangler.toml | managed | 2026-10-20 version 777c86cb-3615-451d-bc11-70f868b8fd55；BUILD_SHA 5685084a1200；100% 流量；匿名私有接口拒绝、SSO 与严格生产巡检通过 |
| pages-www-legacy | production | pages | codepi-www | kedoupi | 旧首页 Pages（项目已删除） | private-user-data(desk) | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 项目与 staging 域名已删除 |
| worker-gu | production | worker | codepi-gu | kedoupi | 投资线上工作台 GU | private-user-data | 终端用户、worker-www、worker-ops named RPC | gu.codepi.app (custom domain), codepi-gu.kedoupi.workers.dev | apps/gu/wrangler.toml、Cloudflare custom domain API | managed | 2026-10-20 version 7e2212c0-7c96-43fb-b0c9-e725fec6110f；BUILD_SHA 58bd615c317d；100% 流量，匿名拒绝、SSO 与只读 MCP 契约通过 |
| pages-gu-legacy | production | pages | codepi-gu | kedoupi | GU 旧 Pages 项目（项目已删除） | private-user-data | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 项目与 staging 域名已删除 |
| worker-gzh | production | worker | codepi-gzh | kedoupi | 发稿台 GZH | private-user-data | 终端用户、worker-www | gzh.codepi.app (custom domain), codepi-gzh.kedoupi.workers.dev | apps/gzh/wrangler.toml、Cloudflare custom domain API | managed | 2026-10-20 version e0ec9bc8-fb98-494f-8ea6-5a0a79c9c678；BUILD_SHA 58bd615c317d；匿名拒绝与 SSO 通过 |
| pages-gzh-legacy | production | pages | codepi-gzh | kedoupi | GZH 旧 Pages（项目已删除） | private-user-data | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 项目与 staging 域名已删除 |
| worker-health | production | worker | codepi-health | kedoupi | Health 前端 SPA | private-health-data | 终端用户 | health.codepi.app (custom domain), codepi-health.kedoupi.workers.dev | apps/health/apps/web/wrangler.toml、Cloudflare custom domain API | managed | 2026-10-20 version 8217fc5d-b3d5-4bf4-8255-1345a2732bd9；BUILD_SHA 58bd615c317d；品牌、页面与 SSO 检查通过 |
| pages-health-legacy | production | pages | codepi-health | kedoupi | 旧 Health Pages（项目已删除） | private-health-data | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 项目与 staging 域名已删除 |
| worker-auth | production | worker | codepi-auth | kedoupi | 中央 SSO/OTP 认证 | auth-session-data | worker-www、worker-gu、worker-gzh、worker-health-api、worker-mcp、worker-project、worker-me | auth.codepi.app (custom domain), cron 17 3 * * * | services/auth/wrangler.jsonc | managed | 2026-10-20 active version b8838962-fdf5-4a94-ab39-ed827ff3a2b0；BUILD_SHA 58bd615c317d；Project/Me 客户端、secret 配对与 readiness 通过 |
| worker-health-api | production | worker | codepi-health-api | kedoupi | Health API；统一 MCP named RPC | private-health-data | worker-health（service binding）、worker-mcp（HealthMcp RPC） | 无公网 routes，经 service binding 访问 | apps/health/workers/api/wrangler.toml | managed | 2026-10-20 version 513a14c9-a8b8-4603-b363-ca450c78138c；BUILD_SHA 58bd615c317d；18 项线上 API 契约通过 |
| d1-auth | production | d1 | codepi-auth (ecc90eed-e9ff-459d-99aa-4e7f4c6d6ef1) | kedoupi | 认证会话与用户 | auth-session-data | worker-auth | - | services/auth/wrangler.jsonc | managed | 2026-10-20 v3 隔离恢复 6 表/38 行全量内容与类型一致 |
| d1-desk | production | d1 | codepi-desk (adfb0f6e-b776-471b-9f25-71982b53cbc4) | kedoupi | Desk 摘要数据 | private-user-data | worker-www | - | apps/web/wrangler.toml | managed | 2026-10-20 v3 隔离恢复 3 表/9 行全量内容与类型一致 |
| d1-gu | production | d1 | codepi-gu (4d3b6713-85dd-4f61-ac55-9925db72394b) | kedoupi | GU 投资数据 | private-user-data | worker-gu | - | apps/gu/wrangler.toml | managed | 2026-10-20 v3 隔离恢复 11 表/137 行全量内容与类型一致；112 份原件逐件摘要通过，线上 revision 1 |
| d1-gzh | production | d1 | codepi-gzh (acedb64c-d374-4e40-b61e-7df7f0766694) | kedoupi | GZH 稿件数据 | private-user-data | worker-gzh | - | apps/gzh/wrangler.toml | managed | 2026-10-20 v3 隔离恢复 9 表/13 行全量内容与类型一致 |
| d1-health | production | d1 | codepi-health (2e35deaa-8066-49c1-b19a-afcd8706d58c) | kedoupi | Health 数据 | private-health-data | worker-health-api | - | apps/health/workers/api/wrangler.toml | managed | 2026-10-20 v3 隔离恢复 22 表/138,738 行全量内容与类型一致 |
| d1-auth-staging | staging | d1 | codepi-auth-staging (fc9c02d7-96e3-48ea-a568-a2362fa198ea) | kedoupi | staging 认证数据（仅 synthetic fixture） | synthetic | worker-auth-staging | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| d1-desk-staging | staging | d1 | codepi-desk-staging (cbbe0037-4132-4ec2-bf6b-2c1ff4363977) | kedoupi | staging Desk 数据（仅 synthetic fixture） | synthetic | worker-www-staging | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| d1-gu-staging | staging | d1 | codepi-gu-staging (86d7d48c-ef12-4cd6-932c-38c0a53bcded) | kedoupi | staging GU 数据（仅 synthetic fixture） | synthetic | worker-gu-staging | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| worker-gzh-staging | staging | worker | codepi-gzh-staging | kedoupi | staging GZH（配置保留未启用，不接发布入口） | synthetic | staging 访问者 | gzh-staging.codepi.app（待绑定） | retired | 2026-10-18 已删除 | 2026-10-17 |
| d1-gzh-staging | staging | d1 | codepi-gzh-staging (1a57d7d8-6d16-4f16-b9f6-b78f78b714ab) | kedoupi | staging GZH 数据（0001–0004 migration 与既有 demo seed） | synthetic | worker-gzh-staging（配置保留未启用） | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| d1-health-staging | staging | d1 | codepi-health-staging (36430305-83df-4af6-961f-64abedca02fe) | kedoupi | staging Health 数据（仅 synthetic fixture） | synthetic | worker-health-api-staging | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| worker-auth-staging | staging | worker | codepi-auth-staging | kedoupi | staging SSO/OTP 认证 | synthetic | staging Pages、worker-health-api-staging | auth-staging.codepi.app (custom domain), cron 17 3 * * * | retired | 2026-10-18 已删除 | 2026-10-16 |
| worker-www-staging | staging | worker | codepi-www-staging | kedoupi | staging 首页/Desk（配置保留未启用） | synthetic | staging 访问者 | staging.codepi.app（待绑定） | retired | 2026-10-18 已删除 | 2026-10-17 配置登记，未发布 |
| worker-gu-staging | staging | worker | codepi-gu-staging | kedoupi | staging GU（保留未启用，不接发布入口） | synthetic | staging 访问者 | gu-staging.codepi.app（待绑定） | retired | 2026-10-18 已删除 | 2026-10-17 |
| worker-health-staging | staging | worker | codepi-health-staging | kedoupi | staging Health 前端 SPA（配置保留未启用） | synthetic | staging 访问者 | health-staging.codepi.app (custom domain, 待绑定) | retired | 2026-10-18 已删除 | 2026-10-18 配置登记，未发布 |
| worker-health-api-staging | staging | worker | codepi-health-api-staging | kedoupi | staging Health API | synthetic | worker-health-staging（service binding） | 无公网 routes，经 worker-health-staging service binding 转发 | retired | 2026-10-18 已删除 | 2026-10-16 |
| pages-www-staging-host | staging | pages-domain | staging.codepi.app → staging.codepi-www.pages.dev | kedoupi | staging 首页/Desk 域名（已随旧 Pages 项目删除） | synthetic | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 域名绑定与 DNS 已删除 |
| pages-gu-staging-host | staging | pages-domain | gu-staging.codepi.app → staging.codepi-gu.pages.dev | kedoupi | staging GU 域名（已随旧 Pages 项目删除） | synthetic | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 域名绑定与 DNS 已删除 |
| pages-gzh-staging-host | staging | pages-domain | gzh-staging.codepi.app → staging.codepi-gzh.pages.dev | kedoupi | staging GZH 域名（已随旧 Pages 项目删除） | synthetic | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 域名绑定与 DNS 已删除 |
| pages-health-staging-host | staging | pages-domain | health-staging.codepi.app → staging.codepi-health.pages.dev | kedoupi | staging Health 域名（已随旧 Pages 项目删除） | synthetic | 无 | - | 历史 Pages 配置 | retired | 2026-10-18 域名绑定与 DNS 已删除 |
| d1-health-preview | staging | d1 | codepi-health-preview (4a4ce46a-ff7e-4eda-b9f0-e0691b45e30b) | kedoupi | 早期 Health preview 库 | legacy | 无 | - | retired | 2026-10-18 已删除 | 2026-10-16 |
| worker-wechat-proxy | production | worker | wechat-proxy | kedoupi | 微信代理（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-16 |
| kv-covers | production | kv | COVERS (4cbe9ae8f79e41bda85fa5bc391a77a4) | kedoupi | 未知（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-16 |
| r2-sub2api-backups | production | r2 | sub2api-backups | kedoupi | 备份（不在本仓库） | unknown | 未审计 | - | 不在本仓库 | unknown | 2026-10-16 |
| tunnel-kdpmini | production | tunnel | kdpmini (1e1bfb4f-2b1b-4ede-8ce6-ef38d2487fbb) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| tunnel-voyracloud | production | tunnel | voyracloud (193a7c34-81b4-4c50-87fd-0700faf07033) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| tunnel-duoji-mini | production | tunnel | duoji_mini (5e9e0d79-e706-4619-b547-97b09aca5ce7) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| tunnel-grok-bot | production | tunnel | grok-bot (2a6e4216-a1c4-41de-ad9c-74aed1883563) | kedoupi | 未审计 Tunnel | unknown | 未审计 | - | Cloudflare 控制面 | unknown | 2026-10-16 |
| alert-platform-incident | production | notification-policy | kdp platform incident (11766abf994c4e61adf7d19e7b956697) | kedoupi | Cloudflare 事件告警（走账户邮箱） | n/a | 全部产品 | - | Cloudflare 控制面 API | managed | 2026-10-20 策略启用、历史发送与 Gmail 收件已核对 |
| alert-workers-observability | production | notification-policy | kdp workers observability issues (68eee86535f549a384704c8e69887244) | kedoupi | Workers 实时问题告警（走账户邮箱） | n/a | 全部生产 Worker | - | Cloudflare 控制面 API | managed | 2026-10-20 20 条 service 自动规则已复读核对，包含 Project/Me；隔离故障自动发送及 Gmail 收件通过 |
| backup-d1-artifact | production | actions-artifact | kedoupi/codepi: d1-backup-<run-id>-<attempt> | kedoupi | 6 个生产 D1 的公钥封装加密日备，清单已启用、runner 待恢复（14 天到期删除） | encrypted-dump | 恢复 runbook | - | .github/workflows/d1-backup.yml | managed | 2026-10-19 六库本机密文、manifest、sha256、GCM AAD 与私钥内存解密通过；run 39192113905 无 runner/steps/artifact，六库异机 artifact 待验收；2026-10-18 原五库 artifact 12122019076 的下载/解密证据保留，私钥异机托管仍未验证 |
| dns-proxy001 | production | dns | proxy001.kdp.cool A 47.254.89.111 | kedoupi | 外部代理（不在本仓库） | unknown | 未审计 | proxy001.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-15 |
| dns-proxy | production | dns | proxy.kdp.cool A 216.132.133.253 | kedoupi | 外部代理（不在本仓库） | unknown | 未审计 | proxy.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-15 |
| dns-rsend | production | dns | rsend/send.kdp.cool CNAME *.forge.rmta.net | kedoupi | 邮件发送域 | unknown | 邮件投递 | rsend.kdp.cool, send.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-15 |
| dns-xui001 | production | dns | xui001.kdp.cool CNAME 67833ac4-b573-4b6f-b7c8-9ae51edd5181.cfargotunnel.com | kedoupi | 未登记 Tunnel 的 CNAME | unknown | 未审计 | xui001.kdp.cool | Cloudflare 控制面 | unknown | 2026-10-16 |
| worker-mcp | production | worker | codepi-mcp | kedoupi | services/mcp | auth-session-data | AUTH, HEALTH RPC, PROJECT RPC, ME RPC, GU RPC | mcp.codepi.app | services/mcp/wrangler.toml、local-release | managed | 2026-10-20 version 29c7f8ed-6b40-41ef-95cd-fa4b5b56d931；BUILD_SHA 3ad248e1c988；readiness、发现、匿名拒绝和连接管理入口通过；全量 scope 授权已发布 |
| d1-mcp | production | d1 | codepi-mcp (73c6ef4e-e2a0-41c2-9bce-ab41c7391caa) | kedoupi | services/mcp 授权状态（可重新授权恢复） | auth-session-data | worker-mcp DB、Ops 加密导出 | - | release-time exact-name resolution / migrations | managed | 2026-10-20 v3 隔离恢复 7 表/46 行全量内容与类型一致；历史 token/授权码/会话清理演练通过，2 个客户端注册保留 |
| worker-ops | production | worker | codepi-ops | kedoupi | services/ops 私有定时运维 | private-user-data | Cron、OPERATIONS、BACKUPS、GU/Me named RPC | 无公网入口 | services/ops/wrangler.toml | managed | 2026-10-20 version 36c81c0b-5c29-4ede-b805-289a1f6ea753；BUILD_SHA 58bd615c317d；8 库/两类原件备份与 34/34 云端巡检通过 |
| workflow-ops | production | workflow | codepi-ops | kedoupi | 可重试巡检与八库/两类原件加密备份 | private-user-data | worker-ops OPERATIONS | 每 30 分钟巡检、UTC 18:00 备份 | services/ops/wrangler.toml | managed | 2026-10-20 cf_93cea89d2248417b1d15530d606a6f32cb921ac8f6cbbf8c24486786218d5572 complete；八库与 GU/Me 原件 R2/GitHub 完整；monitor cf_8a2afa9777e330cb8d0147c661fdc25ecd9fa865d95e4081bcb0879eaf84d256 34/34 |
| r2-ops-backups | production | r2 | codepi-ops-backups | kedoupi | 八库/两类原件密文与运维报告 | private-user-data | worker-ops BACKUPS | 无公开域名 | services/ops/wrangler.toml | managed | 2026-10-20 私有访问再次核验；v3 manifest 覆盖 8 库、GU 112 件与 Me 空集合；120 个 GitHub payload 独立解密通过，14 天生命周期证据沿用 2026-10-19 |
| r2-gu-uploads | production | r2 | codepi-gu-uploads | kedoupi | 投资原件与研究附件 | private-user-data | worker-gu MATERIALS、经 GU RPC 的 Ops | 无公开域名 | apps/gu/wrangler.toml | managed | 2026-10-20 r2.dev 关闭、custom domains 为空；生产 revision 1、资料索引 112 件，生产与隔离恢复的全部鉴权下载摘要一致 |
<!-- registry-table:end -->

## 2026-10-19 临时恢复演练资源

以下是 PR #107 的隔离副本，不接生产 binding，不是新的长期环境。
真实 GU D1 恢复校验后，额外写入了合成会话和一份合成资料探针，仅用于鉴权下载验收；
资源曾含私人数据，2026-10-20 已按所有者授权清理，不纳入每日生产六库清单。
删除前复核无线上消费者，正式备份及恢复验证证据保留。

| 类型 | 名称 / ID | 数据与访问 | 状态 / 证据 |
| --- | --- | --- | --- |
| D1 | `codepi-gu-pr-107` / `c46d093c-dc25-4bf9-98e2-127016927b4f` | 曾为真实 GU 备份隔离副本及合成验收记录；无公开应用绑定 | 2026-10-20 已删除，控制面再次列举确认不存在；11 表/21 行恢复证据保留 |
| R2 | `codepi-gu-uploads-pr-107` | 真实恢复原件 0 件，另有一份合成探针；曾为私有桶 | 2026-10-20 清除 1 个探针后删除，控制面再次列举确认不存在；下载验收证据保留 |

## 2026-10-20 非空资料恢复演练资源

下列资源只用于本次真实备份的隔离恢复，不接生产 binding，不纳入每日六库清单，
未部署公开 Worker。名称中的 `pr-108` 仅是临时资源标识，本次没有创建 PR #108。
本机验收服务已停止；资源曾包含私人投资资料，2026-10-20 已按所有者授权清理。
正式密文已保留在 R2 和本机固定备份目录，私人解密副本和临时运行配置已删除。

| 类型 | 名称 / ID | 数据与访问 | last_verified | expires_on | cleanup_evidence |
| --- | --- | --- | --- | --- | --- |
| D1 | `codepi-gu-pr-108` / `cc32b12c-f445-4152-9c8f-6e521b1d7fd4` | 曾为真实 GU 隔离副本；11 表/132 行及鉴权验收通过，无生产绑定 | 2026-10-20 删除后再次列举确认不存在 | 2026-10-20 已清理 | 已按精确 UUID 删除，正式备份保留 |
| R2 | `codepi-gu-uploads-pr-108` | 曾含 112 份真实资料，原 key 和摘要一致；私有且未添加合成资料 | 2026-10-20 删除后再次列举确认不存在 | 2026-10-20 已清理 | 逐件清除 112 个对象后删桶，正式备份保留 |

## 2026-10-20 Issues 自动规则与临时验收资源

原策略 `68eee86535f549a384704c8e69887244` 的邮件目的地保持原配置。
每个生产 Worker 分别配置 `afterOccurrences=1` 与 `afterInactivitySeconds=3600`，
均为 enabled、service scope；没有账户级广播，也未覆盖 `unknown` Worker。
首次阈值链路已实际收件，复发条件本轮只核对控制面，未等待一小时再制造异常。
完整通知与邮箱证据见[验收记录](tasks/2026-10-20-workers-issues.md)。
2026-10-20 MCP 领域发布后，Project/Me 已按相同策略补为正式规则，总数由 16 增至 20。

| service / 消费者 | 首次阈值规则 UUID | 静默后复发规则 UUID | owner / status | last_verified |
| --- | --- | --- | --- | --- |
| `codepi-auth` | `2969a9ec-fb99-4456-995a-a0c2150d5984` | `91516a93-5e0e-4acc-822f-de2a5983984e` | kedoupi / managed | 2026-10-20 已启用并复读核对 |
| `codepi-www` | `c3f093da-a479-4f91-bca1-de32d382515a` | `7388b9dc-c1e4-45e5-81a8-eebc439d5d68` | kedoupi / managed | 2026-10-20 已启用并复读核对 |
| `codepi-gu` | `60288a2a-ded7-4e6e-9e60-7446e9fb2720` | `60052daa-b4a9-4a35-a77d-695e5c58b918` | kedoupi / managed | 2026-10-20 已启用并复读核对 |
| `codepi-gzh` | `09c1c7e8-b2e3-4c1d-bc85-6079900d08f9` | `368efdb5-5a65-4f3f-a5a0-b2fb229550df` | kedoupi / managed | 2026-10-20 已启用并复读核对 |
| `codepi-health-api` | `93f45f14-8f88-4210-91ab-fd4dfb1a4c96` | `25e7f944-77d0-4de7-ba82-036280510963` | kedoupi / managed | 2026-10-20 已启用并复读核对 |
| `codepi-health` | `ef976cce-bcb4-464b-a075-007e4616574d` | `bb45c545-ddc3-444a-94b2-502b0f96b89a` | kedoupi / managed | 2026-10-20 已启用并复读核对 |
| `codepi-mcp` | `55413001-a9ce-4181-9c8f-59236cd7bbe1` | `7a80f214-1d79-4a87-aad8-43f484fdb4c5` | kedoupi / managed | 2026-10-20 已启用并复读核对 |
| `codepi-ops` | `9f3fc604-d607-42d3-834d-f5d771e76020` | `ba22abae-d6f9-493c-a9dc-42f442a07a18` | kedoupi / managed | 2026-10-20 已启用并复读核对 |
| `codepi-project` | `5339dd89-9a21-4343-aa0c-1be76370bb68` | `ba04e2c2-556b-48e8-b5f4-9ab37583301a` | kedoupi / managed | 2026-10-20 已启用并复读核对 |
| `codepi-me` | `b70f43dc-79e6-4b5b-bdb1-f385220bd976` | `8267f2a3-1483-4de3-be7f-3b05665df84a` | kedoupi / managed | 2026-10-20 已启用并复读核对 |

| 类型 | 名称 / ID | 数据与消费者 | last_verified / expires_on | cleanup_evidence |
| --- | --- | --- | --- | --- |
| Worker | `codepi-ops-pr-115` / version `d4f05804-cbd4-4ffe-99f6-719fac912750` | synthetic；无 binding/secret/生产消费者，单次故障后关闭 workers.dev/preview | 2026-10-20 已删除 | `2026-10-20T02:42:52.844Z` 删除后再次列举不存在；正式 Worker 配置与版本一致 |
| issue-automation | `codepi-workers-issues:codepi-ops-pr-115:first` / `65a1aa42-6d76-4203-8484-195b8a6bf75d` | synthetic；只匹配上述临时 Worker | 2026-10-20 已删除 | 精确 UUID 删除后复读规则清单，当时余下 16 条正式规则；后续 Project/Me 补至 20 条；合成 Issue 先标为 resolved |

## 2026-10-20 v3 八库恢复临时资源

从生产备份实例
`cf_93cea89d2248417b1d15530d606a6f32cb921ac8f6cbbf8c24486786218d5572`
创建 8 个全新隔离 D1，无 Worker binding 或生产消费者。每库都与解密后的同次备份
逐表比对 schema、字段值和类型，并执行 `quick_check` 与外键检查；GU/Me 原件另按
D1 索引逐件恢复校验。全部临时库于 `2026-10-20T09:40:41Z` 至
`2026-10-20T09:40:49Z` 按精确 UUID 删除，账户 D1 清单恢复为原八个生产库；
密文、独立恢复明文和日志目录一并删除。正式 v3 备份与恢复私钥保留。

| 类型 | 临时 D1 名称 / UUID | 恢复结果 | cleanup_evidence |
| --- | --- | --- | --- |
| D1 | `codepi-auth-v3-recovery` / `3568a2a0-2f5f-4b77-aaa0-6a118ba2705a` | 6 表/38 行一致 | 删除后全量列举不存在 |
| D1 | `codepi-desk-v3-recovery` / `cbc92800-9277-4a7c-a7f7-90bbd89585a9` | 3 表/9 行一致 | 删除后全量列举不存在 |
| D1 | `codepi-gu-v3-recovery` / `f7578c31-de57-4a6a-8ea1-d0b2375cf128` | 11 表/137 行一致；112 份原件通过 | 删除后全量列举不存在 |
| D1 | `codepi-gzh-v3-recovery` / `fc2cb9f3-fdf5-49fd-9489-5d4ee47b7899` | 9 表/13 行一致 | 删除后全量列举不存在 |
| D1 | `codepi-health-v3-recovery` / `99a9b330-4f90-4e8d-b944-a0b53788f989` | 22 表/138,738 行一致 | 删除后全量列举不存在 |
| D1 | `codepi-mcp-v3-recovery` / `2f4d3508-3835-4a61-b67c-809833577b5e` | 7 表/46 行一致；授权状态清理演练通过 | 删除后全量列举不存在 |
| D1 | `codepi-project-v3-recovery` / `7224f2d0-cb1c-4998-a724-8c1c53717e4d` | 10 表/3 行一致 | 删除后全量列举不存在 |
| D1 | `codepi-me-v3-recovery` / `519a90e7-1cff-4fd0-8b94-4824b9557b87` | 10 表/2 行一致；空原件集合通过 | 删除后全量列举不存在 |

## 2026-10-20 五库临时恢复资源

PR #114 后续验收使用独立 D1，无生产消费者；五库全量核对及 MCP 授权清理演练通过后，
已按精确 UUID 删除，并再次列举确认不存在。详见[验收记录](tasks/2026-10-20-recovery-acceptance.md)。

| 类型 | 名称 / ID | 数据与访问 | last_verified | expires_on | cleanup_evidence |
| --- | --- | --- | --- | --- | --- |
| D1 | `codepi-auth-pr-114` / `6e3678a8-6611-4905-8b31-80fb7d468c58` | auth-session-data；6 表/44 行，未绑定 Worker | 2026-10-20 删除后确认不存在 | 2026-10-20 已清理 | 全量内容、完整性与外键核对通过后精确删除 |
| D1 | `codepi-desk-pr-114` / `4e7252d0-c01a-4806-b5b9-4d46e7409f86` | private-user-data；3 表/5 行，未绑定 Worker | 2026-10-20 删除后确认不存在 | 2026-10-20 已清理 | 全量内容、完整性与外键核对通过后精确删除 |
| D1 | `codepi-gzh-pr-114` / `9036a929-31b0-410c-8a6c-ea9f3444c818` | private-user-data；9 表/11 行，未绑定 Worker | 2026-10-20 删除后确认不存在 | 2026-10-20 已清理 | 全量内容、完整性与外键核对通过后精确删除 |
| D1 | `codepi-health-pr-114` / `2ad4bae0-6c86-42b4-9a44-c1457082383d` | private-health-data；22 表/138,010 行，未绑定 Worker | 2026-10-20 删除后确认不存在 | 2026-10-20 已清理 | 全量内容、完整性与外键核对通过后精确删除 |
| D1 | `codepi-mcp-pr-114` / `97681747-73ec-4a2d-8aeb-edd99b8ee7dc` | auth-session-data；7 表/36 行，未绑定 Worker | 2026-10-20 删除后确认不存在 | 2026-10-20 已清理 | 全量核对、清除五表授权状态并保留注册后精确删除 |

## 2026-10-16 只读盘点

盘点使用分页 MCP `GET` 端点，只读取控制面及公开路由元数据：未读取 D1 业务内容、
secret 值、邮件、OAuth 或私人业务数据。每个分页端点均读取总元数据或其空的末页。

| 资源类型 | 盘点结果 |
|---|---|
| Pages | 4：`codepi-www`、`codepi-gu`、`codepi-gzh`、`codepi-health`；全部 `source=null`、`production_branch=main`，未发现 Git 自动部署 source |
| Workers | 5：`codepi-auth`、`codepi-auth-staging`、`codepi-health-api`、`codepi-health-api-staging`、`wechat-proxy` |
| D1 | 11：5 production、5 staging 与 `codepi-health-preview`；旧 GZH staging ID `5162…` 不存在，`GET` 返回 7404 |
| KV / R2 / Queue / Durable Object | 1 `COVERS` / 1 `sub2api-backups` / 0 / 0 |
| Tunnel | 4；详情均保留为 `unknown`，未作变更 |
| DNS | `codepi.app` 16 条、`kdp.cool` 20 条；仅导出公开路由元数据 |

所有 5 个 production Pages hostname 与 4 个 staging Pages hostname 均为 `active`；
production CNAME 精确指向相应 `codepi-*.pages.dev`，staging CNAME 指向
`staging.codepi-*.pages.dev`。`auth.codepi.app` 与 `auth-staging.codepi.app` 分别绑定
其同名逻辑 Worker；控制面的 Worker `environment=production` 是 provider service
environment 标签，并非错误的逻辑环境目标。

新建并授权的 `codepi-gzh-staging`（`1a57d7d8-6d16-4f16-b9f6-b78f78b714ab`）已应用
`0001`–`0004` migration（包括既有 demo seed）；`wrangler d1 migrations list --env preview
--remote` 报告 `No migrations to apply`。`gzh/wrangler.toml` 与 Pages project preview DB
设置均已更新为该 ID，production `acedb64c-…` 未变；尚未上传新的 staging Pages deployment，
须经 release gate，不能据此断言现有部署已经切换 UUID。

### 生产部署元数据（历史漂移证据，不是新 workflow 成功证明）

Pages 的 canonical deployment 都是 direct upload，且 `ad_hoc`、`commit_dirty=true`。
因此 reported commit 不能绑定为干净的 source SHA，也不能作为新发布 workflow 的证据。

| Pages 项目 | deployment ID | reported commit | provider URL |
|---|---|---|---|
| `codepi-www` | `3f902dd6-798d-4098-85c3-efd072ff45f8` | `3899850f30346adcae96ce7ef17d4544d623d11a` | `https://3f902dd6.codepi-www.pages.dev` |
| `codepi-gu` | `824ee45a-65e9-4b2a-84ea-03a6f1da3fec` | `3899850f30346adcae96ce7ef17d4544d623d11a` | `https://824ee45a.codepi-gu.pages.dev` |
| `codepi-gzh` | `b450cf99-3b8a-47f2-aa5c-08b2af7b4e28` | `7701511b66cdb8b5c7547d0944601d8a3b64abc1` | `https://b450cf99.codepi-gzh.pages.dev` |
| `codepi-health` | `e1569fbe-7019-489c-b92b-01ff6d597b13` | `3899850f30346adcae96ce7ef17d4544d623d11a` | `https://e1569fbe.codepi-health.pages.dev` |

| Worker | deployment ID | current version ID | traffic | source / Cron |
|---|---|---|---|---|
| `codepi-auth` | `0c013511-2b0d-4a87-a2ac-c22598bb40b9` | `246505bd-ca26-4ddf-a2be-c09ea256f7b3` | 100% | Wrangler; `17 3 * * *` |
| `codepi-auth-staging` | `c826dc36-1653-4249-aa74-7fcf3d4399ba` | `acd44524-27d1-439a-9b4f-fecb760a0e8a` | 100% | Wrangler; `17 3 * * *` |
| `codepi-health-api` | `a94308eb-fa4f-43e7-9cdd-9cf2d2dbc716` | `574ef7fc-6bca-4022-ba50-d881aec1ed2c` | 100% | Wrangler; `*/2 * * * *` |
| `codepi-health-api-staging` | `f8bfec3c-6b2b-4d81-b56a-68be7e736dcf` | `c27c7bac-d752-4b50-9156-c62c684aeb12` | 100% | Wrangler; `*/2 * * * *` |

未确认任一 Worker 的干净 source SHA；Health API `/api/health` 报告 `build=local`，不能将
线上版本绑定到新 SHA。Worker 的 D1 与 `AUTH` bindings 与本表一致；Health Pages 的
`WORKER` 指向同环境 Worker。Health Pages 配置实际以 `apps/web` 为 functions build 目录，
并通过 `../../workers/api/node_modules/.bin/wrangler` 成功编译 Worker；新增跟踪配置尚未远程上传，
provider 当前 runtime 也未报告 `ENVIRONMENT`。

### 可达的 HTTP smoke（匿名，2026-10-16）

| 端点 | 结果 |
|---|---|
| `codepi.app`、`www.codepi.app`、`health.codepi.app` | 200 HTML |
| `gu.codepi.app` | 302 → 同 host `/login` |
| `gzh.codepi.app` | 302 → 同 host `/login?next=%2F` |
| `auth.codepi.app/api/health` | 200 JSON |
| `auth-staging.codepi.app/api/health` | 503 JSON |
| `health.codepi.app/api/health`、`/api/me` | 200 JSON（后者为匿名 representation） |
| `health.codepi.app/mcp` | GET 405 JSON；POST 401 JSON metadata challenge |
| Health 两个 `/.well-known/oauth-*` 端点 | 200 JSON，origin 正确 |

以上请求未见 522。`node oura/scripts/check-api.mjs` 的 16 个 probes 全部通过：匿名私有
API 为 401、网站 SSO redirect 正确、MCP POST 返回 401 metadata challenge，两个 discovery
端点为正确 origin。没有凭证，故登录、callback 与登出完整 E2E **未通过也未声称通过**。

## 阻断、边界与退役

| 项目 | 当前事实 / 可达工作 | 阻断或未证实部分 |
|---|---|---|
| staging Auth | 仅有 `OTP_PEPPER`、`SESSION_SECRET`、`SSO_CLIENTS` secret 名；503 JSON 与缺失配置一致 | `OWNER_EMAIL`、`OTP_FROM`、`RESEND_API_KEY` 未提供；用户选择保留阻断 |
| 发布预检 | standalone `staging-auth-preflight` 已成为全部 6 个 staging deploy job（含 single-app）的 mandatory `needs`，且要求 result 为 success；以环境凭证作 metadata-only shell 实测因缺 `OWNER_EMAIL` 退出 1，发生在任何 mutation 前 | 未运行 release workflow、未发布计算部署；仅对替代 GZH staging D1 应用 migration（如上） |
| staging Access | Access `GET apps` 为空 | 未提供 required owner identity，不能创建 policy |
| GitHub Environments | `gh` 返回 401 | approval 与 scoped credential 尚未验证 |
| legacy callbacks | `kdp.cool` callback 保留至 2026-10-29 | 到期前不可删除；仍须确认旧 DNS/custom domain、真实流量与消费者为零 |

本次未作 production mutation 或数据删除。盘点中旧 compute 资源已不存在；历史删除记录
`7701511` 来自其他会话，但不构成退役窗口、消费者为零或同路径 smoke 等先决条件已经验证
的声明。`unknown`（包括 `xui001.kdp.cool` 指向的非现存 Tunnel ID）不得重命名、迁移或删除。
