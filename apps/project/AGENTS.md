# Project 开发边界

- Project 是一个私有产品：`web/` 是 Svelte 看板，`worker/` 是 Hono Worker 与 `ProjectMcp`，`migrations/` 是应用自有 D1。页面、API 与 RPC 共用这一份领域数据，不把数据拆到其他应用。
- 只通过命名 RPC `ProjectMcp.execute` / `ProjectMcp.summary` 向 `services/mcp` 提供能力，操作限定为 `list`、`get`、`handoff_save`。不要增加公网 MCP 路由、静态入口或通用 RPC 转发。
- 浏览器只走 `@kedoupi/shared/auth/client` 严格 SSO，不增加本地登录旁路。生产 `AUTH_CLIENT_ID=project` 要求统一登录中心登记对应 client、callback 与 secret；共享 client allowlist 必须继续包含 `project`。
- D1 保存共享 SSO 表、项目卡、只追加交接、GitHub 事件、任务文档索引和同步状态。不要在代码或迁移中写入虚构的远程资源 ID。GitHub token 只从 `GITHUB_TOKEN` secret 读取，权限保持只读；不保存其他凭证，不把交接正文、token 或 provider 原始错误写入日志。
- 交接必须带 `task_id`、四种状态之一、`branch`、40 位 `base_sha`；`commit`、`pr`、`request_id` 可选。交接只追加；每个任务分别取最新一条，项目卡同时给出所有任务的 `task_progress`。重复 `request_id` 只在内容相同时幂等。
- GitHub 同步逐来源记录成功游标、失败 checkpoint 和错误码。Link 分页失败时不得推进已完成高水位；429 后停止本轮后续来源。手动与定时同步共用 D1 租约；长任务续租，每次 GitHub 请求和领域写入前验证所有权，失去租约后不得继续请求或写入。任务状态只映射到四种状态或 `unknown`。
- MCP 列表每页返回筛选后完整排序摘要的 64 位 SHA-256 `revision`；`offset > 0` 必须带首屏值，筛选、顺序或摘要变化时返回 `cursor_stale`，不得静默漏项。
- `project_get` 超过 12 KiB 时返回有界 UTF-8 JSON 分页；每页必须重复 `as_of` 和完整 `project` 元数据并计入 12 KiB，调用方按序拼接 `pagination.chunk`。不得静默裁掉交接、任务或仓库字段；游标使用 SHA-256，卡片变化后旧游标必须失败。`SourceSummary` 不超过 4 KiB，且不输出 `privateMetric`。
- 所有页面文本按纯文本节点渲染，不渲染 Markdown 或 HTML，不使用 `{@html}`。保持 `style-src 'self'`，不写内联 `style`；浏览器变更必须同源并经过 SSO 会话。
- 本地检查：`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm test:browser`。测试只使用合成项目、交接与 GitHub 响应；浏览器冒烟覆盖桌面与 390px 单栏，但真实 SSO、同步和线上验收必须分别记录，不能用构建通过代替。
- 根 workspace 与 lockfile 由集成负责人维护；本应用集成时必须成为 workspace 成员并使用既有依赖版本。
