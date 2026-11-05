# Project 开发边界

- Project 是私有工作台：`web/` 是 Svelte 页面，`worker/` 是 Hono Worker 与 `ProjectMcp`，`migrations/` 是应用自有 D1。页面、ingest、API 与 RPC 共用这一份领域数据。
- 待办的唯一真源是各项目自己的仓库；这里只收快照和展示。网页不编辑待办内容；只允许「今天」挑选（pick/unpick）与「你的」事项标完成（owner_done），待办增删改仍在各仓库。
- 推送只走 `POST /api/ingest/:project` + 项目令牌。令牌只存 SHA-256，只在建项目或重新生成时返回一次；不要在日志、响应、测试快照里出现令牌原文。错误令牌与未知项目必须不可区分（同为 401 `invalid_token`）。
- ingest 必须先做凭据形态扫描（`worker/scan.ts`），命中返回 422 且只回报字段路径；新增推送字段时扫描自动覆盖整个请求体，不要绕过。schema 用 `assertKeys` 严格校验，未知字段 422。
- 写入用 `json_each` 的少量批量语句（D1 每条语句最多 100 个绑定参数），不要按任务逐条循环写。
- 只通过命名 RPC `ProjectMcp.execute` / `ProjectMcp.summary` 向 `services/mcp` 提供能力，操作限定为 `overview`、`task_list`、`task_get`、`project_get`、`handoff_save`，与 `packages/shared/mcp/contract.ts` 的 `PROJECT_OPERATIONS` 一致。不加公网 MCP 路由或通用转发。
- 每个 MCP 回复不超过 `MCP_LIMITS.detail`（12 KiB），用 `fit()` 截短列表并写 `truncated`，计数保持准确；`task_list` 的 `revision` 覆盖筛选与完整结果，续页缺首屏 revision 或结果变化返回 `cursor_stale`，不得静默漏项。`SourceSummary` 不超过 4 KiB，不输出 `privateMetric`。
- 交接只追加；`request_id` 只在内容相同时幂等。`branch`、`base_sha` 可选，给出时 `base_sha` 必须是 40 位小写十六进制。
- 浏览器只走 `@kedoupi/shared/auth/client` 严格 SSO，不加本地登录旁路；除 ingest 外的写请求都要同源 Origin。
- 所有页面文本按纯文本节点渲染，不用 `{@html}`；保持 `style-src 'self'`，不写内联 `style`，图表用 SVG 属性与 class。颜色只用 CodePi token 与 `style.css` 里的 `--wb-*`、`--slot-*`。
- 本地检查：`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm test:browser:built`。测试只用合成项目、任务与交接；真实 SSO、真实推送和线上验收要分别记录，不能用构建通过代替。
- 部署、远程迁移、建令牌不属于普通开发；`0003_workbench.sql` 会删除旧同步表，`0004_today.sql` 追加今天挑选与主人完成表，上线前先导出生产 D1。
- `today_picks` 只保存网页/助手对任务的当天挑选与当天退回记录，`owner_done` 保存主人在网页完成的任务；两张表都按 `(project_id, task_key)` 关联快照，不回写仓库。任务标题或分类变化会生成新 key，旧 key 被推送标完成并进入当天 done，新 key 进入 pool；今天里的事尽量不改标题与分类。
- Project MCP 的 `today_get` 每次开窗先读今天、池子与当天完成事项；`today_pick` 最多写入 20 个助手挑选且不覆盖主人挑选。MCP 回复受 12 KiB 约束，截短时保留完整计数。
