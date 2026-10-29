# CodePi MCP 领域扩展

本页记录当前实现契约。Health 是首个上线模块；Health、Project、Me、GU、Blog 五个模块的
实现与日期化发布证据见[任务索引](../development/tasks/README.md)，实际控制面和客户端验收另行核验。
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
| Blog（Web Worker） | `BlogMcp` | Web Worker 自有 Blog D1/R2 | 博客查询、草稿与审核辅助；发布仍需 owner 审核 |

共享层只定义类型、操作枚举和大小常量。HTTP 和 MCP 共用所属应用的业务代码。
工具参数不接受 user_id/client_id；subject 和客户端名称来自服务端 grant，领域再次核对 owner。
所有用户文本、GitHub 标题和交接均为数据，不作为 Agent 指令或 HTML 执行。

## 授权与上下文

支持 `context.read`、`projects.read`、`projects.write`、`health.read`、`health.sync`、
`me.read`、`me.write`、`invest.read`、`blog.read`、`blog.write`。这是单用户部署，登录并确认连接后一次性授予
当前全部已支持 scope；授权页完整展示范围，但不提供逐项勾选。即使客户端只请求部分
scope，服务端也返回全量 scope 并在 token 响应中如实声明。已有部分授权在下一次
refresh 时升级为全量；refresh 忽略客户端的缩小请求，不能把连接降回部分权限。
需要收缩能力时撤销整个客户端连接，而不是在同一连接上保留部分 scope。

工具逐一检查权限；仅写权限不能读取领域摘要，`blog.write` 也不推出 `blog.read`。Health read-only grant 可读保存数据；
没有 `health.sync` 时默认不刷新，显式要求 refresh=true 被拒绝。
连接页合并同一客户端全部活动授权族的 scope，不用 SQL `MAX(scope)` 代替集合并集。

个人访问令牌与登录授权一致，只签发全量 scope；签发前留下的窄权限令牌在读取时按全量处理，
不会因为新工具上线而失效。需要收缩能力时撤销令牌，不保留部分 scope 的旧形态。
旧 SSE 会话按绑定 scope 校验：新 grant 仍覆盖绑定 scope 时继续可用，被收窄才 403。

Blog 的 `blog_submit` 允许旧 schema 调用：同时缺少 `tags` 与 `category` 的请求按第一次
schema 处理，`tags` 由旧 `tag` 派生，头图取正文第一张内联图片，分类留空由 owner 审核时补齐。
给出任一分类字段的当前客户端仍按已发布 required 列表校验，显式 `null` 视为“填不出”而不是错误参数。
未知字段名只回报父路径，不回显客户端输入的键名。

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

## 发布与验收边界

以下是领域首次创建或替代资源时的历史 bootstrap/recovery 顺序；现有资源的常规更新不得重复
provision。新 Worker/D1/域名及 Me R2 的历史创建记录和日期化发布证据见任务索引，本地构建
不证明云端资源就绪。

首次或替代创建时，从已合并、干净 main 串行发布：先发布 Auth，再初始化 Project/Me 资源并上传各自 Worker，
随后配对并验证新增 Auth 客户端；未配对时 readiness 返回 503，不标成发布成功。领域 Worker 验收完成后
发布 MCP，最后 Ops 和受影响公开入口。具体持锁步骤见
[本地发布操作](../development/local-release.md#project--me--gu-mcp-扩展首发归档流程)。

新 D1 与原件必须纳入备份清单和恢复范围；当前 v4 完整备份覆盖九库及 GU/Me/Blog 三组原件，
跨平台复制另行记录。巡检包含健康端点、权限配对、BUILD_SHA 漂移与备份新鲜度；Workers Issues
策略和实际送达需要单独核验。自动检查只用合成数据。真实客户端验收底线是 Claude 手机端、Codex、
codepi CLI，并包括权限隔离、刷新/撤销和跨客户端任务交接，未经实际操作不能填“通过”。
