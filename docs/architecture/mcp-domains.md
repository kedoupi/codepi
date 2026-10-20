# CodePi MCP 领域扩展

本页记录 2026-10-20 确认的实现契约。生产基线仍是已上线的 Health MCP；新代码、检查、
部署与真实客户端验收分别见[任务记录](../development/tasks/2026-10-20-codepi-mcp-domains.md)。
PDF 使用旧提交和部分已过时模型，不能覆盖以下修正。

## 领域与数据边界

统一入口保持 `https://mcp.codepi.app/mcp`，无状态 Streamable HTTP 使用官方 SDK。
MCP D1 只保存授权、token hash 和本站 SSO 会话，不存项目卡、记忆、健康或投资记录。

| 所有者 | named RPC | 权威数据 | MCP 能力 |
| --- | --- | --- | --- |
| Health API | `HealthMcp` | Health D1 与同步队列 | catalog、records、aggregate、sync status |
| Project | `ProjectMcp` | 独立 D1；GitHub 自动提取与追加交接 | projects_list、project_get、project_handoff_save |
| Me | `MeMcp` | 独立 D1；私有 R2 导入原文 | memory_search/save/import、profile、timeline、proposal |
| GU | `GuMcp` | `gu_workspace_head` 指向的线上版本 | portfolio、cash、trades、rules、reports |

共享层只定义类型、操作枚举和大小常量。HTTP 和 MCP 共用所属应用的业务代码。
工具参数不接受 user_id/client_id；subject 和客户端名称来自服务端 grant，领域再次核对 owner。
所有用户文本、GitHub 标题和交接均为数据，不作为 Agent 指令或 HTML 执行。

## 授权与上下文

支持 `context.read`、`projects.read`、`projects.write`、`health.read`、`health.sync`、
`me.read`、`me.write`、`invest.read`。授权页仅显示本次请求的权限，Health/Me/GU 默认不勾选。
空选择不消耗同意事务；额外权限被拒绝。已有 `health.read health.sync` token 继续有效，
不自动获得新领域。refresh 只能保持或缩小，新权限必须重新授权。

工具逐一检查权限。仅写权限不能读取领域摘要。Health read-only grant 可读保存数据；
没有 `health.sync` 时默认不刷新，显式要求 refresh=true 被拒绝。旧 grant 行为不变。
连接页合并同一客户端全部活动授权族的 scope，不用 SQL `MAX(scope)` 代替集合并集。

`get_context` 只调用拥有读权限的来源，并发执行、每个来源 2 秒超时；
失败只将该来源置为 unavailable。白名单过滤返回字段，永不转发 privateMetric。
UTF-8 JSON 预算：单领域概览最多 4 KiB（Me 最多 1.5 KiB），详情页 12 KiB，
总概览 8 KiB。删减摘要会明确提示，详情通过分页或显式截断元数据继续读取。
Health 超限响应使用 `health_data_json_v1` JSON 片段分页；保持原参数，沿
`pagination.next_cursor` 拼接后再解析。游标绑定查询和内容 SHA-256，变化返回
`cursor_stale`；后台刷新持续改变结果时用 `refresh=false` 重新开始。分页只切输出，
统计输入与现有记录分页的 `next_offset` 语义不变。

## Project 与 CLI

项目卡合并 AGENTS.md 自动字段和本人编辑值；记录提取 SHA，自动源变化时提示。
交接按 task_id 分组，状态为 in_progress/blocked/ready_for_review/done；解析不出的仓库
任务状态显示 unknown。每条记录包含分支、base SHA，可关联 commit 和 PR，不用“最新一条”
覆盖多个并行任务。写入只追加；重复请求使用相同 request_id。
项目列表只返回有界摘要，使用 `offset/limit` 和 `next_offset` 分页；续页必须携带
首屏内容哈希 `revision`，列表期间变化返回 `cursor_stale`，不得输出漏项的部分列表。完整交接通过
`project_get` 读取，不能借列表绕过 12 KiB 详情预算。

GitHub 只读同步按 Link 翻页，分页失败保留断点，完成前不推进高水位游标。
缺少授权、限流、未同步和数据为空分别显示，不伪造仓库进度。

`packages/cli` 使用锁定版本的官方 SDK 和 Node 内置模块，不自己实现 JSON-RPC/SSE。
凭证按 server 隔离，目录 0700、文件 0600、原子替换。刷新使用同进程单一任务和跨进程锁，
锁内重新读取凭证，覆盖读取、刷新请求和保存，防止并发消耗同一个 refresh token。
loopback 只有 HTTP IP 的端口可变；scheme、IP、path、query 必须相同，
授权码和换 token 仍绑定授权时的实际 URI。

`codepi init` 默认预览，必须 --yes 才修改仓库；`connect` 只打印配置。
交接需显式 task/status/branch/base SHA；猜不出 repo 或基线时失败并说明缺失参数。

## Me

全部 AI 写入进入 pending，包括 preference/note。只有本人看板操作能确认、修改后确认、
拒绝、归档或直接编辑 active 内容。Profile 提议有独立类型，不从任意记忆 tag 推导修改权限。
搜索只返回 active，使用参数化 LIKE 并支持中文短关键词；首版不用 FTS 虚拟表，
以保持现有 D1 SQL 导出和恢复链路可用。

导入是 start/chunk/finish 协议：单请求 24 KiB、整批 500 条/512 KiB，按 import ID、
chunk index、digest 去重。重试不能重复插入或越过总量限制；完成之前不能出现已确认内容。
原文进入私有 R2、索引保留大小和摘要；MCP 无原文下载工具。Ops 通过
`MeImportsBackup` 只读能力获取原件，在写备份前公钥加密；恢复私钥不进入 Worker。

## GU

使用线上 WorkspaceView，而非 PDF 中已过时的 dashboard_batches 模型。
保留 decimal 文本、币种、参考估值和未知值；分页固定 revision，避免混读更新前后状态。
规则正文和报告是可追溯文本，不把自由文本自动解释成风控结果，不新增交易写入能力。
原有 `GuMaterialsBackup` 与资料鉴权保持。

## 发布与验收

新 Worker/D1/域名及 Me R2 先登记 planned；本地构建不证明云端资源就绪。
从已合并、干净 main 串行发布。先发布 Auth，再初始化 Project/Me 资源并上传各自 Worker，
随后配对并验证新增 Auth 客户端；未配对时 readiness 返回 503，不标成发布成功。
领域 Worker 验收完成后发布 MCP，最后 Ops 和受影响公开入口。具体首发与持锁步骤见
[本地发布操作](../development/local-release.md#project--me--gu-mcp-扩展发布)。
批次为公共基础、Project+CLI、Me、GU；
实际分批时，MCP 与 Ops 配置必须只引用当批已经创建、发布的依赖，不能先部署悬空绑定。

新 D1 与原件必须纳入备份清单、跨平台复制和恢复。巡检包含健康端点、权限配对、
BUILD_SHA 漂移与备份新鲜度；Workers Issues 策略和实际送达需要上线时单独核验。
自动检查只用合成数据。真实客户端验收底线是 Claude 手机端、Codex、codepi CLI，
并包括权限隔离、刷新/撤销和跨客户端任务交接，未经实际操作不能填“通过”。
