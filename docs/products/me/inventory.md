# Me 记忆 功能清单

> 源码根：`~/Coding/codepi/apps/me`。`W/` = `web/src/`，`K/` = `worker/`。行号为 2026-11-07 读到的版本。

## 概览

- 一句话定位：个人记忆、背景（profile）与经历（timeline）的私有看板。AI 只能「提议」，所有 AI 写入先进待确认区，只有本人在看板确认/修改后确认/亲自编辑才变成 active；MCP 只读已确认内容。
- 用户：张老板本人（统一登录，主体固定 Owner）；AI 客户端通过 MCP 间接读写。
- 入口域名：`me.codepi.app`（`wrangler.toml` 的 custom_domain 路由）。
- 技术形态：Cloudflare Worker（Hono）+ Static Assets（`run_worker_first`）+ D1 + R2 `IMPORTS`（导入原文，私有）；前端 Svelte 5 多页面形态（路径路由，`location.pathname`，整页跳转而不是 SPA 路由）；对外只通过命名 RPC `MeMcp.execute/summary` 给 `services/mcp`，无公网 MCP 路由。
- 是否已上线：推断为已配置部署（`ENVIRONMENT=production`、`SSO_ENABLED=1`、自定义域名）。但 README 明说「本地实现或配置不代表当前线上健康、真实 SSO 使用或非空原文恢复验收」，且 `database_id` 由授权发布时注入、源码里没有，所以线上是否在跑从代码读不出。

## 页面与视图

| ID | 页面/视图 | 路由 | 桌面/手机差异 | 源码 |
|---|---|---|---|---|
| M-P01 | 登录页（统一登录） | `/login`（未登录访问其他页面时带 `?return=` 302 到此） | 左品牌叙事 + 右面板；手机见 640px 断点（login 部分未逐行核对） | `W/App.svelte:59-74`，`K/app.ts:195-204` |
| M-P02 | 记忆（首页） | `/` | 桌面左侧栏；≤900px 侧栏缩窄；≤640px 侧栏变顶部静态条，导航 4 列 | `W/components/Memories.svelte`，`W/style.css:84-101` |
| M-P03 | 个人背景 | `/profile` | 同上 | `W/components/Profile.svelte` |
| M-P04 | 经历 | `/timeline` | 同上 | `W/components/Timeline.svelte` |
| M-P05 | 导入 | `/imports` | 同上 | `W/components/Imports.svelte` |
| M-P06 | 外壳（侧栏 / 顶栏 / 概览四计数 / 页脚） | 全局 | 手机隐藏侧栏底部文案；概览计数数字缩小 | `W/App.svelte:75-106` |
| M-P07 | 加载中 / 读取失败 / 会话过期回登录 三种全局态 | 全局 | - | `W/App.svelte:87-88,45` |
| M-P08 | 内联编辑器（记忆）、内联编辑器（经历） | 嵌在列表条目或页面顶部 | - | `W/components/MemoryEditor.svelte`，`TimelineEditor.svelte` |
| M-P09 | 其他任意路径 | 非列出路径（含 `/assets` 之外） | 直接 404，无友好 404 页 | `K/app.ts:216-224` |

## 功能点

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| M-F01 | 登录 | 「统一登录」跳转 SSO，成功回到原页面（只允许四个白名单路径） | 点击 | 错：`auth_error` 显示「登录未完成」警示 | `App.svelte:15-18,70-71` |
| M-F02 | 登录 | 提示「登录最多保留 7 天，退出同步退出其他应用」 | 静态 | - | `App.svelte:72` |
| M-F03 | 外壳 | 侧栏四项导航（记忆/个人背景/经历/导入），当前页高亮 | 点击（整页跳转） | - | `App.svelte:16,80` |
| M-F04 | 外壳 | 侧栏「返回个人空间 ↗」跳 codepi 主站；品牌链接回 `/` | 点击 | - | `App.svelte:79,81` |
| M-F05 | 外壳 | 顶栏「退出」 | 点击 | 载：「退出中…」；错：顶部红色提示 | `App.svelte:35-43,84` |
| M-F06 | 外壳 | 概览四计数：已确认记忆、待确认记忆（均链到 `/`）、背景提议（链到 `/profile`）、经历提议（链到 `/timeline`）；操作后自动刷新 | 自动/点击 | 取数失败：提示条 | `App.svelte:20-23,90-97` |
| M-F07 | 外壳 | 窗口聚焦/页面可见时检查会话；401 事件清空数据回登录 | 自动 | 未登：回登录页 | `App.svelte:44-56` |
| M-F08 | 外壳 | 全局读取失败页「暂时无法读取」+「重试」；加载中「正在读取私人记录…」 | 自动/点击 | 载/错 | `App.svelte:86-88` |
| M-F09 | 外壳 | 「跳到内容」无障碍链接；页脚「内容由本人确认 · 北京时间」 | 键盘/静态 | - | `App.svelte:76,104` |
| M-F10 | 记忆 | 「亲自记一条」：打开内联编辑器，保存立即生效 | 点击 | - | `Memories.svelte:58,61` |
| M-F11 | 记忆（编辑器） | 记忆内容（≤2000）、类型（偏好/事实/决定/经验/笔记）、标签（逗号分隔，最多 10 个）；保存按钮随上下文显示「保存并确认 / 保存并生效」；取消 | 输入/提交 | 载：「保存中…」；疑似密钥被拒（后端 `secret_detected`，内容不保存、不回显） | `MemoryEditor.svelte:14-22`，`K/validation.ts:12-27` |
| M-F12 | 记忆 | 待确认区：列表条目（类型、来源、时间、「来自导入」链接、正文、标签） | 自动 | 空：「没有待确认的记忆。背景和经历提议可在各自页面查看」；载：「正在读取…」 | `Memories.svelte:62-80` |
| M-F13 | 记忆（待确认） | 「确认」→ 变 active，提示「已确认，可供 AI 读取」 | 点击 | 错：冲突 409（非待确认/导入未完成） | `Memories.svelte:72` |
| M-F14 | 记忆（待确认） | 「修改后确认」：内联编辑后「保存并确认」 | 点击 | - | `Memories.svelte:73,37-42` |
| M-F15 | 记忆（待确认） | 「拒绝」 | 点击 | - | `Memories.svelte:74` |
| M-F16 | 记忆（待确认） | 「更多待确认记忆」分页（每页 10） | 点击 | 无更多时隐藏 | `Memories.svelte:79` |
| M-F17 | 记忆（待确认） | 「按导入批次处理 ↗」跳导入页 | 点击 | - | `Memories.svelte:63` |
| M-F18 | 记忆 | 记忆库搜索表单：关键词（中文二字可搜）、类型、精确标签、来源客户端、状态（已确认/已拒绝/已归档）；「搜索记忆」按钮；需提交才生效，不是实时过滤 | 提交 | 空：「没有匹配的记忆。试试其他关键词，或亲自记下第一条」 | `Memories.svelte:81-91` |
| M-F19 | 记忆（记忆库） | 条目展示：类型 · 状态、来源、更新时间、正文、标签 | 自动 | - | `Memories.svelte:92-97` |
| M-F20 | 记忆（记忆库） | 对已确认条目：「编辑」（内联，保存并生效）、「归档」（AI 不再读取） | 点击 | 已拒绝/已归档条目无任何操作按钮 | `Memories.svelte:98-103` |
| M-F21 | 记忆（记忆库） | 「更多记忆」分页 | 点击 | - | `Memories.svelte:108` |
| M-F22 | 记忆 | 操作结果提示「已保存并生效 / 已确认 / 已拒绝 / 已归档」；失败时红条 + 「重试读取」 | 自动 | 错 | `Memories.svelte:59-60,30-36` |
| M-F23 | 个人背景 | 「添加背景字段」/ 已确认条目「编辑背景」：字段名（≤80，如 name/role/bio/working_style）+ 内容（≤2000），保存并生效；点编辑时滚到页面顶部 | 点击/提交 | 疑似密钥被拒 | `Profile.svelte:38,41-50,77` |
| M-F24 | 个人背景 | 待确认的背景提议列表（来源、时间、字段名、建议内容、「确认会更新个人背景中的 xx 字段」） | 自动 | 空：「暂无背景提议」 | `Profile.svelte:51-73` |
| M-F25 | 个人背景（提议） | 「确认更新背景」/「修改后确认」（内联改内容后「保存并确认」）/「拒绝」 | 点击 | 冲突 409 | `Profile.svelte:57-68` |
| M-F26 | 个人背景 | 已确认背景列表（字段、内容、更新时间） | 自动 | 空：「还没有背景信息。可以从姓名、角色和一句简介开始」 | `Profile.svelte:74-81` |
| M-F27 | 个人背景 | 「更多背景提议」「更多背景字段」分页 | 点击 | - | `Profile.svelte:72,80` |
| M-F28 | 经历 | 「亲自添加经历」：类型（工作/创业/教育/项目/生活）、标题、组织（选填）、开始日期（YYYY / YYYY-MM / YYYY-MM-DD）、结束日期（留空=至今）、正文（≤8000） | 点击/提交 | - | `Timeline.svelte:64,67`，`TimelineEditor.svelte` |
| M-F29 | 经历 | 待确认的经历区：条目（类型 · 状态、来源、时间、日期区间、标题、组织、正文节选） | 自动 | 空：「暂无经历提议」 | `Timeline.svelte:68-100` |
| M-F30 | 经历（待确认） | 「确认经历」「修改后确认」「拒绝」「查看全文」 | 点击 | 冲突 409 | `Timeline.svelte:92-96` |
| M-F31 | 经历 | 时间线搜索表单：关键词、类型、开始于、截止于（手动输入 YYYY-MM-DD）、状态；「搜索经历」 | 提交 | 空：「没有匹配的经历。可以亲自添加，或在 AI 提交后确认」；日期范围非法后端 400 | `Timeline.svelte:71-81` |
| M-F32 | 经历（时间线） | 「查看全文」（拉取详情替换节选）、「编辑经历」、「归档」；日期缺失显示「日期待补」，无结束日显示「至今」 | 点击 | 已归档/已拒绝无操作 | `Timeline.svelte:88-97,35-44` |
| M-F33 | 经历 | 「更多经历」分页 | 点击 | - | `Timeline.svelte:101` |
| M-F34 | 导入 | 粘贴导入：分条方式（按行/按空行）、原文文本框、实时统计「N 条 · X KiB」、预览前 5 条折叠；按钮「导入到待确认区」（0 条、>500 条、>512KiB 时禁用） | 输入/提交 | 载：「导入中…」；成功提示「导入完成，内容已进入待确认区」；请求 ID 随输入变更重新生成以去重 | `Imports.svelte:39-47,27-33` |
| M-F35 | 导入 | 导入记录列表：来源名/客户端、时间、状态徽标（open/finishing/finished/failed 的中文）、条数/已确认/待确认/已拒绝统计；未完成批次显示已收分块数与下一序号；出错显示「导入未完成，请重试完成操作」 | 自动 | 空：「还没有导入记录」 | `Imports.svelte:48-56` |
| M-F36 | 导入 | 对 finished 且有待确认的批次：「确认本批待确认内容」/「拒绝本批待确认内容」→ 二次确认框 → 「确认处理本批」/ 取消 | 点击 | - | `Imports.svelte:57-66` |
| M-F37 | 导入 | 对 open/finishing 批次：「完成已收到的导入」（重试失败的 finish） | 点击 | - | `Imports.svelte:66-68` |
| M-F38 | 导入 | 「刷新状态」「更多导入记录」；页头「查看待确认区」链接 | 点击 | 载：禁用 | `Imports.svelte:36,48,73` |
| M-F39 | 全局安全 | 页面按文本节点渲染（不使用 `{@html}`），CSP `script-src 'self'`；内容含疑似 secret 的写入被拒且不回显 | 自动 | - | `AGENTS.md`，`K/validation.ts` |

## 对外接口

### HTTP API（`K/app.ts`；HTTPS；写操作同源；`/api/*` 需会话，401 返回 `unauthorized`）

| 接口 | 用途 | 源码 |
|---|---|---|
| `GET /api/health` | 健康 + SSO 就绪（未就绪返回 503） | `app.ts:31-35` |
| `GET /api/auth/login`、`/callback`，`POST /api/auth/logout` | SSO 登录/回调/退出 | `app.ts:37-38,47` |
| `GET /api/me`、`GET /api/overview` | 会话检查、四计数 | `app.ts:52-53` |
| `GET/POST /api/memories`，`POST /:id/review`，`PUT /:id`，`POST /:id/archive` | 记忆列表（status/query/kind/tag/source/offset/limit）、亲自新增、审核（approve/edit_approve/reject）、编辑 active、归档 | `app.ts:59-100` |
| `GET /api/profile`，`PUT /api/profile/:key`，**`DELETE /api/profile/:key`**，`GET /api/profile/proposals`，`POST /proposals/:id/review` | 背景读写、提议审核；**DELETE 已有接口但页面上没有对应按钮** | `app.ts:101-126` |
| `GET/POST /api/timeline`，`GET /:id`，`PUT /:id`，`POST /:id/archive`，`POST /:id/review` | 经历列表/新增/详情/编辑/归档/审核 | `app.ts:127-165` |
| `GET /api/imports`，`POST /imports/paste`，`POST /:id/finish`，`POST /:id/review` | 导入记录、粘贴导入、重试完成、整批确认/拒绝 | `app.ts:166-186` |
| `GET /robots.txt` | 禁止爬取 | `app.ts:216` |

### MCP（`MeMcp.execute`，经 `services/mcp`）

操作与权限（`K/mcp.ts:43-77`，README「内部能力」）：

| 内部操作 | 对应外部 MCP 工具（推断，来自会话工具清单，未逐一核对） | 权限 |
|---|---|---|
| `memory.search` | `memory_search` | read，只返回 active |
| `profile.get` | `me_get_profile` | read，只返回已确认 |
| `timeline.search` | `me_search_timeline` | read，只返回 active |
| `memory.save` | `memory_save` | write，进 pending |
| `entry.propose` | `me_propose_entry` | write，背景/经历进 pending |
| `memory.import.start/chunk/finish` | `memory_import` | write，分块进 pending；每客户端仅一次首次导入 |
| `MeMcp.summary` | 经 `list_data_sources`/`work_overview` 一类聚合（未核对） | read，≤1536 字节 |

另有 `MeImportsBackup`（仅 Ops service binding，不映射 HTTP）。

### 数据模型

D1：`memories`、`import_sessions`/`import_chunks`/`imports`、`profile`（已确认字段）、`profile_proposals`、`timeline`，状态机 pending→active/rejected、active→archived（`migrations/0001_init.sql`）；另有 SSO 事务与会话表。R2：`imports/<id>` 原文。

## 现有原型覆盖：画布上无，全部记「漏画」

M-P01 至 M-P09、M-F01 至 M-F39 全部「漏画」。

## 日常使用流与体验疑点（推断标明）

日常流（推断）：
1. AI 在别处（Claude/Codex）记下偏好或经历 → 进入 Me 的待确认区。
2. 张老板打开 `/`，看顶部四计数里的待确认数，逐条「确认 / 修改后确认 / 拒绝」；背景提议与经历提议要分别去 `/profile`、`/timeline`。
3. 首次把旧记忆搬进来：`/imports` 粘贴，批量确认。
4. 偶尔搜索、归档或自己补记。

体验疑点：
- **待确认分散在三页**（事实）：记忆、背景提议、经历提议分处三个页面，顶部计数里「已确认记忆」和「待确认记忆」都跳 `/`，没有「全部待确认」统一收件箱。
- **没有恢复入口**（事实）：已归档、已拒绝的记忆/经历没有任何按钮，无法撤销归档或拒绝。
- **背景字段没有删除按钮**（事实）：`DELETE /api/profile/:key` 存在，页面没入口。
- **背景字段名是自由文本**（事实）：没有预设字段，只靠占位符「name、role、bio、working_style」提示；而 MCP 摘要里特别认 `name/role/bio/summary`（`K/mcp.ts:116-117`），拼错会静默不参与摘要。
- **搜索需点按钮**（事实），没有实时过滤；经历的日期过滤是手输文本框而非日期选择器；标签是「精确标签」手输。
- 页面是整页路径跳转而非 SPA（事实）：切页会重新加载，筛选条件、未保存编辑不跨页保留。
- 手机上侧栏变成页面顶部静态条（不固定），长列表下导航随页面滚走（推断，`style.css:92`）。
- 「亲自记一条」保存即 active，不经确认（设计如此），文案已说明；与「AI 写入先 pending」一致。
- 导入「分块序号」「finishing」等技术状态直接露给用户（`Imports.svelte:55`），推断对非技术场景偏硬。
- 全局只有一个错误条位置，操作失败的错误信息在页面顶部，长列表里点操作后看不到（推断）。
