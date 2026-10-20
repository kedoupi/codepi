# Project 项目工作台

kedoupi（codepi）的私有项目领域。Worker 名为 `codepi-project`，生产入口为
`https://project.codepi.app`，本地开发端口为 `8795`。Project 保存项目卡、按任务追加的
AI/人工交接、GitHub 活动摘要与任务文档索引，并通过内部 `ProjectMcp` 向统一 MCP
提供 `projects_list`、`project_get`、`project_handoff_save` 的能力。它不开放公网 MCP
入口。

Cloudflare Worker、D1、域名、Auth client 与 secrets 已创建并部署。2026-10-20
`GITHUB_TOKEN` 配置后，Cron 已真实同步五个来源，写入仓库事件和任务文档索引；
资源与验收事实见[资源登记](../../docs/development/cloudflare-resource-registry.md)和
[领域任务](../../docs/development/tasks/2026-10-20-codepi-mcp-domains.md)。

## 数据边界

- Safari/browser 看板与 API 共用严格 SSO 会话。未登录 API 返回 401，页面跳转统一登录；
  所有写请求还要通过同源 Origin 校验。
- `projects` 是 `PROJECT_REPOS` 的投影，阶段 1 仅计划接入 `kedoupi/codepi`。项目 ID
  由仓库名稳定生成，不使用虚构 ID。
- `card_fields` 保存 `AGENTS.md` 自动提取值和本人编辑值。编辑值优先，并保留编辑时
  自动 SHA 以提示上游变化。
- `handoffs` 只追加。必填 `project`、`task_id`、`status`、`summary`、`next`、`branch`、
  `base_sha`（完整 40 位小写 SHA）；可选 `blockers`、`files`、`commit`（7–40 位小写
  SHA）、`pr`（最多 500 字符）和 `request_id`（最多 100 字符）。看板按任务展示各自
  最新交接，不把并发任务压成一条全局进度。
- `request_id` 在项目与 client 内幂等：相同内容重试返回原记录，不同内容返回
  `409 request_id_conflict`。
- `repo_events`、`task_notes` 与 `sync_state` 只保存同步投影。PR 的 `merged_at` 单独
  保存，用于“最近 14 天合并”展示；增量游标仍使用 `updated_at`。GitHub 失败时保留
  已完成游标和续传 checkpoint；没有成功完成的页面不会推进高水位。
- 从 `PROJECT_REPOS` 移除的已有项目仍保留在看板与 D1 中，但不在定时同步范围内，
  手动同步返回 `409 project_not_syncable`。

## Worker 与 RPC

`ProjectMcp` 暴露两个命名 RPC 方法：

| 方法 | 说明 |
| --- | --- |
| `execute` | `list`、`get`、`handoff_save` 三个操作；错误以 `{ ok:false, error, status }` 返回 |
| `summary` | 本人 `get_context` 使用的 Project `SourceSummary`，上限 4 KiB，无 `privateMetric` |

`get` 参数为 `{ project, handoffs?, cursor?, task_id? }`。项目卡不超过 12 KiB 时直接
返回 `ProjectCard`。超过时每页使用以下信封；`as_of` 与 `project` 在每页重复，便于
无需拼装即可显示项目身份。12 KiB 限制按整个序列化响应计算，包含这些重复元数据。

```json
{
  "as_of": "2026-10-20T05:00:00Z",
  "project": {
    "id": "kedoupi-codepi",
    "repo": "kedoupi/codepi",
    "name": "kdp.cool",
    "status": "active",
    "default_branch": "main",
    "url": "https://project.codepi.app/p/kedoupi-codepi"
  },
  "pagination": {
    "format": "project_card_json_v1",
    "encoding": "utf-8",
    "cursor": null,
    "next_cursor": "eyJ2IjoxLCJmb3JtYXQiOiJwcm9qZWN0X2NhcmRfanNvbl92MSIs...",
    "total_bytes": 24576,
    "chunk_bytes": 11000,
    "chunk": "{\"as_of\":\"2026-10-20T05:00:00Z\",\"project\":...",
    "complete": false
  }
}
```

`pagination.chunk` 是原始 `ProjectCard` 经 `JSON.stringify` 后按 Unicode 码点顺序切分的
JSON 文本片段，单页片段本身不是完整 JSON。工具调用方应按响应顺序拼接所有 `chunk`；
收到 `complete: true` 后只执行一次 `JSON.parse`。不要把重复的 `as_of` / `project`
元数据拼入 chunk。`total_bytes` 是原始 JSON 的 UTF-8 字节数，`chunk_bytes` 是本段
UTF-8 字节数。下一页使用上一页的 `next_cursor` 作为 `cursor`。游标包含 SHA-256
摘要；原始卡片变化时旧游标返回 `cursor_stale`，不会静默返回混合版本。调用方可在
拼接完成后用 `TextEncoder` 重新计算字节数，并与 `total_bytes` 比对。

协调者注册 `project_get` 时，工具描述应包含：

> Large cards use a paged envelope. Each page repeats `as_of` and `project` metadata.
> Concatenate `pagination.chunk` values in response order and call `JSON.parse` only
> after `pagination.complete` is true. Chunks are fragments of one ProjectCard JSON
> string, not standalone JSON documents. Pass `pagination.next_cursor` as `cursor`
> for the next page.

`list` 参数为 `{ status?, offset?, limit?, revision? }`。`limit` 为 1–50，默认 20。
每页返回的 `revision` 是完整筛选与排序后摘要内容的 64 位 SHA-256；`offset > 0` 时
必须原样带上首屏 `revision`。筛选条件、排序位置或摘要内容变化时返回
`409 cursor_stale`，调用方应从 `offset: 0` 重新读取，不能接受缺项列表。MCP 列表不
返回完整交接，只投影每个项目最新一条的 `task_id`、`status` 和最多 160 个字符的
`next` 摘要；完整交接、卡点和文件用 `project_get`。HTTP `GET /api/projects` 仍返回
完整 `latest_handoff`，供看板使用。

```json
{
  "as_of": "2026-10-20T05:00:00Z",
  "projects": [
    {
      "id": "kedoupi-codepi",
      "repo": "kedoupi/codepi",
      "name": "kdp.cool",
      "status": "active",
      "last_activity_at": "2026-10-20T04:00:00Z",
      "url": "https://project.codepi.app/p/kedoupi-codepi",
      "latest_handoff": {
        "task_id": "mcp-project-domain",
        "status": "in_progress",
        "next": "Run integration checks."
      }
    }
  ],
  "next_offset": null,
  "revision": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

整个 `{ ok: true, data }` 回复按 UTF-8 序列化后不超过 12 KiB。请求的 `limit` 是上限；
若加入下一项会超预算，本页提前结束。`next_offset` 为下一页起点，非末页时严格大于
当前 `offset`；即使因字节预算提前结束也不会跳过项目。末页为 `null`。调用方应持续用
`next_offset` 和首屏 `revision` 请求，直到它为 `null` 再组装完整项目列表。

项目看板 HTTP 接口：

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/health` | 公开构建与 SSO 状态 |
| `GET /api/auth/login` / `callback`、`POST /api/auth/logout` | 共享 SSO |
| `GET /api/projects` | 项目列表，可按状态筛选 |
| `GET /api/projects/:id` | 项目卡；浏览器可获得完整时间线 |
| `GET /api/projects/:id/handoffs` | `before` + `before_id` 游标分页，`limit` 1–50 |
| `PATCH /api/projects/:id/card` | 编辑或恢复 `goal`/`scope`/`conventions`/`pitfalls` |
| `PATCH /api/projects/:id` | 修改名称或 `active`/`paused`/`archived` 状态 |
| `POST /api/projects/:id/handoffs` | 看板手写交接，记录 `client_id=web` |
| `POST /api/projects/:id/sync` | 手动 GitHub 同步；D1 原子租约与 Cron 共用，60 秒冷却，运行中续租 |

## 配置

`wrangler.toml` 只声明按名称解析的 D1 `codepi-project`，没有伪造 database ID；
生产发布由集成/运维流程解析并注入实际 UUID。运行时变量包括：

- `SSO_ENABLED=1`、`AUTH_CLIENT_ID=project`、`AUTH_ORIGIN`、`PROJECT_ORIGIN`。
- `PROJECT_REPOS`：逗号分隔的允许同步仓库。
- `BUILD_SHA`：构建标识。
- Secret `AUTH_CLIENT_SECRET` 与 `GITHUB_TOKEN`，生产均为 `secret_text`。GitHub token
  必须是只读 fine-grained token，仅授权目标仓库的 Contents、Metadata、Pull requests、
  Issues；不得复用 Ops 的 Contents 读写 token，不得硬编码或提交。按推荐的 90 天有效期，
  预计在 2027-01-18 到期，轮换前应先配置新 secret 并重跑同步。

`.dev.vars.example` 只含占位符。测试默认使用共享 client 已登记的 `project` ID 和合成
secret；需要隔离验证旧 allowlist 时可用 `PROJECT_TEST_AUTH_CLIENT_ID` 覆盖。生产必须
使用协调者登记的真实 `project` client。

## 本地开发与检查

从仓库根安装依赖后，在本目录运行：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:browser
pnpm dev
```

测试使用 `@cloudflare/vitest-plugin` 启动本地 D1，migration 为合成数据库；GitHub
响应、交接和项目均使用合成值，不读取真实账户资料。列表测试覆盖大交接投影、12 KiB
预算分页、revision 失效、默认 `limit=20` 和续页无遗漏；同步测试覆盖并发占用、
运行中续租、失去所有权后停止写入、失败 checkpoint 恢复、失败后仍冷却、第 59 秒
拒绝与第 60 秒放行。部署、远程 migration、secret 配置和真实登录验收不属于普通
本地检查。`test:browser` 启动本地静态产物和已安装的 Chrome，用合成 API 检查桌面
详情、字段编辑、手写交接、390px 单栏和无横向滚动；它不替代真实 SSO 或线上验收。

根 pnpm workspace 与 lockfile 由集成负责人维护。本应用合并前必须加入
`pnpm-workspace.yaml` importer，并复用仓库既有的 Hono、Svelte、Vite、Vitest 和
Wrangler 版本；不要另建锁文件。
