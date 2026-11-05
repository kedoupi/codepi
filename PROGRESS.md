# today-api

## 计划

- 新增 today D1 迁移与 Worker 领域实现。
- 接入 HTTP `/api/today` 读写路由，保持 SSO 与同源 Origin 约束。
- 接入 Project MCP `today_get` / `today_pick`、工具注册、文档和合约。
- 增加合成数据单测与迁移检查，运行验收命令。

## 已完成

- 已读取任务说明、仓库与 `apps/project` 规则、共享开发规范及相关实现。
- 已按要求设置 Node `PATH` 并完成 `pnpm install --frozen-lockfile --offline`。
- 新增 `0004_today.sql`、Worker today 领域与 HTTP `/api/today` 读写接口。
- 新增 `today_get` / `today_pick` Project MCP RPC、工具注册、合约、边界文档和任务推送规则。
- 增加北京日期、排序、who/carried、owner_done、退回跳过、改名 key、SSO/Origin 和 MCP 截短计数测试。
- 已通过项目测试 50/50、MCP 服务测试 77/77、两套类型检查和迁移规则检查。

## 当前状态

- 正在运行总验收命令；验收通过后提交并回报 lead。
