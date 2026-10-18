# CodePi 统一 MCP

本次实现对应“一个 CodePi 入口，先做 Health，其他产品完成后接入”的决策。
实现与验证状态见[任务记录](../development/tasks/2026-10-18-unified-mcp.md)；
以下地址和资源是发布目标，不代表已经在生产启用。

## 服务边界

```text
AI client
  └─ https://mcp.codepi.app/mcp
       ├─ services/mcp: SDK transport / OAuth / module registry
       ├─ AUTH binding → services/auth: unified website login
       ├─ MCP DB: local SSO sessions / client grants / hashed tokens
       └─ HEALTH binding → codepi-health-api#HealthMcp
                            ├─ saved Health records and score cache
                            └─ existing durable sync queue → Oura
```

`services/mcp/` 是支撑服务，四个产品不变。它处理协议、客户端授权与工具目录；
Health API 负责健康日期、字段、数据查询、统计、缺失与后台同步。
`packages/shared/mcp/contract.ts` 只定义内部 RPC 类型，不承载业务 SQL。

MCP 不绑定 Health 数据库，不保存 Oura 凭证，不把客户端 token 传给 Auth 或 Oura。
工具参数没有 `user_id`；可信客户端授权确定统一主体，Health 再映射到
`PERSONAL_OWNER_ID`。公网 Health dispatcher 没有内部 MCP HTTP 路由。

## 登录和授权

网站统一登录、Oura 提供方授权、AI 客户端授权分别管理。
新增 SSO client `mcp`；Auth 只有配置 `SSO_CLIENT_SECRET_MCP` 后才启用它，
与 MCP 的 `AUTH_CLIENT_SECRET` 单独配对，既有四个客户端的凭证不变。

AI 客户端通过 OAuth discovery 和动态注册接入；每次授权要求明确同意
`health.read health.sync`。PKCE 只接受 S256；授权码一次使用，access token 一小时，
refresh token 30 天并轮换；已轮换的 refresh token 被重放时撤销对应授权族。
授权码和 token 在 D1 只保存 hash，并绑定 `https://mcp.codepi.app/mcp` 资源。

`/connections` 展示已授权客户端，撤销需网站 owner 会话、同源 POST 和 CSRF。
撤销 MCP 不断开 Oura，也不退出网站。未来新增产品权限须重新获得同意。
浏览器 MCP 请求只接受规范 origin 或 `MCP_ALLOWED_ORIGINS` 中的精确 origin；
服务端客户端可以不发送 Origin。

## 首期工具

| Tool | 用途 | 是否触发同步 |
| --- | --- | --- |
| `list_data_sources` | 列出已实现且已授权的模块，目前只有 Health | 否 |
| `health_get_catalog` | 集合、字段、单位、统计规则与已保存历史范围 | 否 |
| `health_query_records` | 查询记录，含原始明细和看板评分缓存 | 默认首屏可触发 |
| `health_aggregate` | 全区间统计、按日/周/月分组、两区间对比 | 默认可触发 |
| `health_get_sync_status` | Oura 连接、评分缓存、明细覆盖、后台进度与错误 | 否 |

AI 先发现数据源和 catalog，再选择字段；趋势和对比优先使用 aggregate。
需要检查标签、运动或具体睡眠时段时使用明细。分析和解释由客户端 AI 完成；
服务端只提供可追溯的数据、计算规则和同步状态，不生成医学诊断或相关性的因果结论。
标签、备注和客户端名称都按数据处理，不能成为指令。

## 数据语义

- 全部已保存历史可读。自动补齐仅覆盖最近 90 天，历史未覆盖区间明确返回警告。
- 普通明细单次最多 31 天，时间戳集合最多 7 天；默认每页 20 条，较大响应也会分页，
  通过 `next_offset` 继续。默认去掉高频序列，需显式 `include_series=true`。
- 统计每个区间最多 366 天，支持两个区间对比。SQL 扫描该区间全部保存记录，
  不使用分页样本计算；只接受 catalog 内的指标与运算，不能传 SQL 或任意 JSON SQL 路径。
- 先按提供方日期形成每日值，再计算跨日统计。睡眠时长同日相加，
  HRV/平均睡眠心率按有效睡眠时长加权，同日心率样本取均值；
  跨日均值按有效天等权。只有可加指标支持 sum。
- `count` 表示有效天，`valid_records` 表示参与计算的记录数，单位随指标返回。
  无有效记录的 mean/min/max/sum 为 null，不能把缺失解释成零。
- 日期型记录使用 Oura 分配的本地日；时间戳集合按 UTC 日；个人资料和戒指配置
  是当前快照，不伪装成历史序列。返回值注明日期依据和显示时区。
- 看板评分与明细独立：`daily_metrics` 读取原有 `daily_cache`，避免把只有评分历史
  的日期误报为没有保存过健康数据。
- 覆盖来自完整同步窗口，成功的空响应也属于已验证覆盖。最近七天成功窗口十分钟后
  视为过期；已有历史窗口保留覆盖证据。失败、权限拒绝和未同步分别返回。

查询先返回已有数据，同时把需要补齐的近期窗口持久化加入现有同步队列；
既有 cron 执行，不在当前请求里等待 Oura。分页后续请求不重复触发刷新。
用户可传 `refresh=false` 完全关闭本次刷新。入队复用租约和去重，并保留
Oura 断连、集合拒绝、限流和写入配额等待；重复提问不能清除这些状态。
因此明细与统计工具的 `readOnlyHint` 为 false。

## 后续产品接入

新增模块时先实现所属应用的内部数据能力，再注册工具、Service Binding 和授权范围。
模块登记保存工具定义与调用函数，Health 的 operation 类型只约束 Health 适配器。
新产品无需变更 MCP HTTP transport，也不能直接查询另一个产品的数据库。
本期不注册 GU/GZH/Web 空工具，不创建尚不存在的数据承诺。

## 发布和旧入口切换

统一入口使用无状态 Streamable HTTP 和官方 SDK，不新增 Durable Object 或独立 SSE
服务。具体配置在 `services/mcp/wrangler.toml`，MCP 授权 D1 为独立 `codepi-mcp`。
首发脚本从精确、干净的源码 SHA 解析或创建该数据库，用同一份临时配置先迁移再部署；
不会把 Health/Auth 数据库误绑定进来，也不修改已审查源码。命令必须使用
`pnpm --dir services/mcp run deploy <SHA>`，避免命中 pnpm 的内置 deploy 命令。

发布顺序是 Auth → Health API named RPC → MCP → Health 前端。
MCP 发布失败时前端不会提前展示新入口；匿名 smoke 检查版本、发现与未授权拒绝，
健康检查通过无副作用的 Auth binding 请求核对 SSO 凭证；
缺失、不配对或 Auth 不可达时返回 503，不发送邮件或创建登录。

2026-10-18 用户明确选择直接切换，不保留旧 Health MCP。此版本删除 Health 内的
MCP transport、工具、OAuth 服务、连接管理 API 和设置页旧连接列表；不再设置旧入口
开关。Health 前端只转发 `/api/*`；旧 `/mcp`、`/oauth/*` 和发现 URL
由前端直接返回 404 JSON，避免落到 SPA HTML，也不重定向或兼容旧授权。

旧 token 不迁移到独立 MCP D1，客户端需改连统一地址并重新授权。ChatGPT、Claude
和实际 Agent CLI 的生产授权、查询、刷新与撤销仍需分别验收；本地删除旧实现不代表
已经部署或通过真实客户端验收。保留 Health 历史、既有 migration/旧表与 Oura 提供方授权，
不附带删除数据。
