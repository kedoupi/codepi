# Project 个人工作台

kedoupi（codepi）的私有工作台。Worker 名为 `codepi-project`，生产入口为
`https://project.codepi.app`，本地开发端口为 `8795`。它汇总各个项目从自己仓库推上来的
待办、需要所有者出手的事、进行中分支和变更记录，并通过内部 `ProjectMcp` 向统一 MCP 提供
`work_overview`、`task_list`、`task_get`、`project_get`、`today_get`、`today_pick`、`today_check`、`project_handoff_save`。

2026-11-04 起由「GitHub 同步的项目卡」重做为工作台（任务记录见
[2026-11-04-project-workbench](../../docs/development/tasks/2026-11-04-project-workbench.md)）：
GitHub 同步、项目卡手工编辑字段、`PROJECT_REPOS` 和 `GITHUB_TOKEN` 均已删除。仓库是待办的唯一真源；「今天」看板的挑选、完成和池子删除只记录工作台状态，待办内容仍需在仓库中删除并推送。

## 数据流

1. 所有者在网页「+ 添加项目」建项目，得到只显示一次的推送令牌（`cpw_` 前缀，D1 只存 SHA-256）。
   项目页可以重新生成令牌，旧令牌立即失效。
2. 项目仓库在合并后运行自己的推送脚本，把待办、分支和 changelog 打包成 `workbench.v1` 快照，
   `POST /api/ingest/<project>`，请求头 `Authorization: Bearer <令牌>`。
3. Worker 拒绝凭据形态的文本（节点链接、GitHub/OpenAI/AWS/Slack 令牌、私钥、JWT、URL 里的
令牌参数），只回报字段路径不回显内容；按内容哈希幂等；一次 batch 写入：出现的任务更新，
消失的任务记 `done_at`（再次出现时恢复），网页删除标记会保留到该 key 重新出现在仓库推送中，分支和 changelog 整体替换，每项目保留 30 份快照，
90 天前完成的任务删除。已被清掉的 9 条今天仍显示在「做完」里，北京时间今晚 24 点后消失。

### `workbench.v1` 快照

```json
{
  "schema": "workbench.v1",
  "generated_at": "2026-11-04T06:00:00Z",
  "project": {
    "name": "MyBrain",
    "rules_path": "AGENTS.md",
    "adapter": { "isolation": "worktree", "commit": "允许", "acceptance": ["…"], "merge": "…" }
  },
  "source": { "sha": "abbafdf", "branch": "main" },
  "tasks": [{
    "key": "可选，不传时取 sha256(分类\\n标题) 前 32 位",
    "title": "≤200", "category": "≤60",
    "status": "decide|doing|bug|verify|idea",
    "need_kind": "none|decide|attend|authorize|confirm",
    "due": "YYYY-MM-DD", "recorded": "YYYY-MM-DD",
    "what": "≤2000", "impact": "≤2000", "advice": "≤2000", "need": "≤500",
    "source": "≤300", "related": ["≤20 项，每项 ≤300"]
  }],
  "branches": [{ "name": "…", "ahead": 3, "last_commit_at": "ISO", "has_fragment": true }],
  "changelog": [{ "date": "YYYY-MM-DD", "title": "≤200", "summary": "≤500" }]
}
```

上限：请求体 256 KiB、任务 500、分支 50、changelog 100。未知字段返回 422。`generated_at` 不计入内容哈希。
`tasks` 必须出现且是数组：缺少它会被拒绝，避免推送脚本出错时把所有待办误记为完成；确实清空时显式传 `[]`。
日期必须是真实存在的日历日（`2026-02-31` 拒绝）。`project.name` 只作参考：项目名称以网页上建项目和改名时的为准，推送不覆盖。

## 页面

| 路径 | 内容 |
| --- | --- |
| `/` 今天 | 顶部日期与「已完成 x / y」进度；左侧池子按分类折叠；中间按「你的 / 助手的」分组挑选今天的待办；右侧只留当天做完的事。桌面三列，手机为「今天 / 池子 / 做完」三个标签；可将待办放进今天、退回池子、删除池子任务或标记你的事项完成。|
| `/board` 看板 | 分类 × 状态热力格（点格子筛选）；待决定、执行、缺陷、待确认、想法、最近完成六列；项目、只看需要你、搜索；`?need=any`、`?due=late|7`、`?task=<project>/<key>` 可直接打开 |
| `/p/:id` 项目 | 状态构成条、项目卡（规则入口与 Agent 协作适配段）、分支、该项目待办、最近变更、每个任务最新交接、推送令牌与项目状态 |
| `/log` 动态 | 最近 30 天每天的变更与完成柱图和按天列表 |

任务详情在侧边抽屉里（URL 带 `?task=`），显示是什么、不做会怎样、建议、需要你、出处与交接。
所有文本按纯文本渲染；图表只用 SVG 属性与 class 着色，保持 `style-src 'self'`。

## HTTP 接口

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/health` | 公开构建与 SSO 状态 |
| `GET /api/auth/login` / `callback`、`POST /api/auth/logout` | 共享 SSO |
| `POST /api/ingest/:project` | 项目令牌推送快照；不走 SSO 与 Origin 校验，错误令牌与未知项目同为 401 |
| `GET /api/overview` | 看板、项目页和任务详情使用的概览统计；首页今天看板使用 `GET /api/today`。|
| `POST /api/today/pick`、`/unpick`、`/done`、`/delete` | 今天看板的挑选、退回、标记完成与池子删除；删除写入 `owner_deleted`，待办仍需在仓库中删除。|
| `GET /api/tasks` | `project`、`status`、`need`（含 `any`）、`category`、`include_done=1` |
| `GET /api/tasks/:project/:key` | 任务详情与交接 |
| `GET /api/projects`、`GET /api/projects/:id` | 项目列表；项目卡（含令牌创建与最近使用时间，不含令牌） |
| `POST /api/projects` | 建项目，`{ id, name, repo? }`，一次性返回令牌 |
| `POST /api/projects/:id/token` | 重新生成令牌 |
| `PATCH /api/projects/:id` | 改名称或 `active`/`paused`/`archived`；归档项目不进看板与 MCP |
| `GET /api/log` | `days` 1–90，变更与完成合流 |

除 ingest 外的 `/api/*` 都要严格 SSO；写请求还要同源 Origin。

## ProjectMcp

`ProjectMcp.execute` 的操作为 `overview`、`task_list`、`task_get`、`project_get`、`handoff_save`、`today_get`、`today_pick`、`today_check`，
每个回复不超过 12 KiB，不再有片段分页：`overview` 与 `project_get` 超出时按 `truncated` 列出截短的列表，
计数保持准确；`today_get` 的 `deleted` 是主人在网页删除、仓库里还在的待办，助手应在仓库删除对应待办；池子和今天项目可带 `checks`（检查天数、最近结论、是否今天检查），
`today_check` 记录助手今天已检查但尚未完成的事项并将其移回池子，同日重复会更新结论；它也按
`pool → done → deleted → today` 顺序截短并保持计数准确。`task_list` 用 `offset` + `revision`（筛选与完整结果的 SHA-256），续页缺首屏
revision 或列表变化时返回 `cursor_stale`。`handoff_save` 的 `task` 是任务键或自由任务 ID，
`branch`、`base_sha` 可选，`request_id` 内容相同才幂等。`summary` 给 `get_context`：需要你、
逾期、7 天内到期、进行中分支和需要你的前几条链接，不超过 4 KiB，最近推送超过 3 天标记 stale。

## 配置

`wrangler.toml` 只声明按名称解析的 D1 `codepi-project`、`AUTH` 服务绑定和静态资源；没有 Cron。
运行时变量：`SSO_ENABLED=1`、`AUTH_CLIENT_ID=project`、`AUTH_ORIGIN`、`PROJECT_ORIGIN`、`BUILD_SHA`；
Secret 只有 `AUTH_CLIENT_SECRET`。推送令牌不在 Worker 配置里，由所有者在网页生成。

迁移 `0003_workbench.sql` 删除旧同步表并把 `projects`、`handoffs` 原行复制到新结构；`0004_today.sql`、`0005_owner_deleted.sql` 和 `0006_agent_checked.sql` 追加今天看板状态。上线前先按
[备份与恢复](../../docs/development/cloudflare-backup-restore.md)导出生产 D1。

## 本地开发与检查

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:browser:built
pnpm dev
```

测试只用合成项目、任务和交接：推送鉴权、凭据扫描、schema、幂等、完成判定、快照裁剪、页面接口的
SSO 与 Origin 边界、MCP 预算与分页、组件渲染与路由。浏览器冒烟检查今天看板的三列、池子操作、当天完成、看板抽屉、项目、动态在
1440px、1024px 与 390px 下的渲染和无横向滚动；它不替代真实 SSO、真实推送和线上验收。
