# 2026-10-28 Blog/MCP 参数与下架修复续验

## 背景与范围

ChatGPT 通过 MCP 提交 Blog 时连续收到没有字段细节的 `invalid_arguments`。此前只补齐 Blog 必填字段的 MCP schema 仍未覆盖服务端允许的可选 `null`，且入口没有返回字段路径和校验原因。本轮按已授权范围完成 MCP 参数诊断与 Blog 下架一致性修复；没有扩大到其他 Blog 审查问题，也没有提交真实稿件或修改私人业务数据。

## 实现与本地验证

- MCP `blog_submit` 的可选字段接受 `null`，调用 Blog RPC 前递归省略这些值；参数校验返回安全的 `field`/`reason`，覆盖 required、type、pattern、长度、范围、数组元素和未知字段路径。
- Blog 下架在公开修订与待审草稿修订不一致时保持待审稿，不再出现公开快照已删除但接口返回假 `409` 的部分提交。
- 公开文章页改为 `Cache-Control: no-store`，下架后不依赖边缘缓存失效传播。
- MCP 修复 worktree 串行测试 `66/66`，`metadata-flow` 串行 `1/1`；Blog `41/41`、Web `51/51`、MCP Blog named RPC `23/23`；Desk typecheck、Web build、assets、浏览器验收及治理检查通过。并行 MCP 测试曾出现一次 Miniflare `SocketError`，串行重跑通过，不将并行结果计为成功证据。

## 合并与生产发布

- MCP 参数诊断：PR #218，main `ef0a41b447ea7b83d4b4e4d23abcabf77165c53d`；`codepi-mcp` 从 `76f3f4a9-3f00-4a0c-a0f5-3f61f4b714b4` 更新至 `ca20a88b-4993-4e73-8c92-fe1f32798ad5`，100% 承流，`BUILD_SHA=ef0a41b447ea`。
- Blog 下架与缓存：PR #219，main `c7217a1305dabff9d280ecba4ccc6c7c29df5205`；`codepi-www` 从 `f9b2bc98-c763-4d75-a5fd-05c00cf5096e` 更新至 `ed106b62-277c-4571-8283-aa264a9fe66d`，100% 承流，`BUILD_SHA=c7217a1305da`。
- MCP 随 main 后续更新再次发布至 `72f51a25-e3b4-4098-96ee-a3a1b8ba322a`，`BUILD_SHA=c7217a1305da`，用于与 Blog/共享主干保持一致。三次发布均无 migration、secret、binding 或业务数据变更。
- 生产 smoke、MCP 官方 SDK 只读验收和线上公开文章 `no-store` 响应通过；没有调用真实 Blog 写工具。

## 发布后观察与巡检

- `release-c7217a1305da-blogunpublish219`（Workflow `cf_9c730543237281d97a192ca811f805edb77e8580eb24d395a2e61ef87b96a6d8`）：2026-10-28T16:59:22.806Z，`healthy_reported`，`events=3`，`rollback=null`。
- `release-c7217a1305da-blogcontract219`（Workflow `cf_3cb2f483cf0e7087e7352eff04c0308a7c8dc3ddc17793a03d7aa40fc28500f6`）：2026-10-28T17:01:44.674Z，`healthy_reported`，`events=4`，`rollback=null`。
- 早期 `release-ef0a41b447ea-blogargs218` 在后续 MCP 更新期间检测到活动版本变化，最终为 `rollback_blocked`；该观察不能作为最终健康证据，已由最新 MCP Observer 重新完成并报告健康。后续发布没有隐藏或覆盖该事实。
- `production-monitor.mjs --require-versions` 当前为 `22` 项通过、`4` 项失败。失败项是此前累计未重发的 `codepi-gu`、`codepi-project`、`codepi-me`、`codepi-health-api`，生产仍为 `d233d1ab3b4b`，当前 main 为 `c7217a1305da`。本轮未扩大授权范围处理这些漂移，因此不能称全局巡检全绿。
- 证据保存在 Git 外 `/tmp/codepi-deployment-evidence.jsonl` 与 Cloudflare 私有 R2 Observer summaries。ChatGPT 端仍需刷新或重新连接 MCP schema；真实 ChatGPT 投稿确认另行验收。
