# Project 开发边界

- Project 是私有工作台：`web/` 是 Svelte 页面，`worker/` 是 Hono Worker 与 `ProjectMcp`，`migrations/` 是应用自有 D1。页面、ingest、API 与 RPC 共用这一份领域数据。
- 待办的唯一真源是各项目自己的仓库；这里只收快照和展示。网页「今天/池子」页已迁到飞书清单「建国工作台」，旧 `/api/today*` 路由与 today_* MCP 接口保留并返回迁移提示，待办增删改仍在各仓库。
- 推送只走 `POST /api/ingest/:project` + 项目令牌。令牌只存 SHA-256，只在建项目或重新生成时返回一次；不要在日志、响应、测试快照里出现令牌原文。错误令牌与未知项目必须不可区分（同为 401 `invalid_token`）。
- ingest 必须先做凭据形态扫描（`worker/scan.ts`），命中返回 422 且只回报字段路径；新增推送字段时扫描自动覆盖整个请求体，不要绕过。schema 用 `assertKeys` 严格校验，未知字段 422。
- 写入用 `json_each` 的少量批量语句（D1 每条语句最多 100 个绑定参数），不要按任务逐条循环写。
- 只通过命名 RPC `ProjectMcp.execute` / `ProjectMcp.summary` 向 `services/mcp` 提供能力，操作限定为 `overview`、`task_list`、`task_get`、`project_get`、`handoff_save`、`today_get`、`today_pick`、`today_check`，与 `packages/shared/mcp/contract.ts` 的 `PROJECT_OPERATIONS` 一致。不加公网 MCP 路由或通用转发。
- 每个 MCP 回复不超过 `MCP_LIMITS.detail`（12 KiB），用 `fit()` 截短列表并写 `truncated`，计数保持准确；`task_list` 的 `revision` 覆盖筛选与完整结果，续页缺首屏 revision 或结果变化返回 `cursor_stale`，不得静默漏项。`SourceSummary` 不超过 4 KiB，不输出 `privateMetric`。
- 交接只追加；`request_id` 只在内容相同时幂等。`branch`、`base_sha` 可选，给出时 `base_sha` 必须是 40 位小写十六进制。
- 浏览器只走 `@kedoupi/shared/auth/client` 严格 SSO，不加本地登录旁路；除 ingest 外的写请求都要同源 Origin。
- 所有页面文本按纯文本节点渲染，不用 `{@html}`；保持 `style-src 'self'`，不写内联 `style`，图表用 SVG 属性与 class。颜色只用 CodePi token 与 `style.css` 里的 `--wb-*`、`--slot-*`。
- 本地检查：`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm test:browser:built`。测试只用合成项目、任务与交接；真实 SSO、真实推送和线上验收要分别记录，不能用构建通过代替。
- 部署、远程迁移、建令牌不属于普通开发；`0003_workbench.sql` 会删除旧同步表，`0004_today.sql` 追加今天挑选与主人完成表，`0005_owner_deleted.sql` 追加池子删除标记，`0006_agent_checked.sql` 追加助手检查历史，上线前先导出生产 D1。
- today 相关表与 `worker/today.ts`、`/api/today*` 路由保留用于回退兼容；当前网页与 MCP 迁移路径不再读写这些表。
- Project MCP 的 today_get、today_pick、today_check 保留兼容调用并返回迁移提示，不再读写 today_picks / owner_done / owner_deleted / agent_checked；网页首页显示飞书迁移说明。/log 页卡名为「动态」但内容是工作日报，使用 `/api/journal` 显示当前周汇总、7 格和逐日卡片；旧 `/board` 链接重定向到首页。
