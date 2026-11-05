# Project 重做为个人工作台（含 MCP）

- 日期：2026-11-04
- 分支：`team/project-workbench`（agent-team：Claude 实现、Codex 只读审查）
- 依据：所有者确认的设计稿（MyBrain 仓库 `docs/designs/project-hub-2026-11-04.md`，私有，不复制到本仓库）

## 目标

`project.codepi.app` 从「GitHub 同步的项目卡」改成个人工作台：各项目的待办、需要所有者决定 / 到场 /
授权 / 确认的事、进行中分支、最近完成与变更一处看；MCP 同步改为按任务读写。所有者的三个决定：推翻重做
Project 与 MCP；项目仓库合并后自动推送（长期许可只覆盖待办、changelog 标题与分支名）；第一期网页只读。

## 范围与结果

| 部分 | 内容 |
| --- | --- |
| D1 | `0003_workbench.sql`：保留 SSO 表；`projects` 改为 slug ID、可空 `repo`、规则入口与适配段、最近推送；新增 `ingest_tokens`（只存哈希）、`snapshots`、`tasks`、`branches`、`changelog_entries`；`handoffs` 改挂 `task_key`、分支与 SHA 可空；旧行复制后删除五张同步表 |
| Worker | 删除 GitHub 同步与 Cron；新增 `POST /api/ingest/:project`（项目令牌、凭据形态扫描、严格 schema、内容哈希幂等、`json_each` 批量写入、完成判定）；SSO 接口 overview / tasks / task / projects / log，建项目与轮换令牌 |
| 页面 | 今天、看板、项目、动态四页与任务抽屉；SVG 图表，无内联 style |
| MCP | `PROJECT_OPERATIONS` 改为 overview / task_list / task_get / project_get / handoff_save；工具 `work_overview`、`task_list`、`task_get`、`project_get`、`project_handoff_save`；去掉片段分页，`read_document` 只服务 Health |
| CLI | 新增 `codepi work`、`codepi tasks`；`project` / `project list` / `handoff` 迁移到新工具；删除项目卡与项目列表分页代码 |

## 验证（本地，合成数据）

见分支上的 agent-team 测试日志与审查记录；`node scripts/agent/check.mjs --base main --run` 为验收命令。
浏览器冒烟覆盖 1440px 与 390px。真实 SSO、真实推送、生产迁移与客户端连接均未验证。

## 发布记录（2026-11-04 周三，所有者授权）

源码 `64d0754`（已推送 origin/main）。发布锁内依次：治理与迁移检查、`check.mjs --base 634d43bccff3 --run` 51 项通过（首轮因主工作区残留旧 `.svelte-check` 缓存失败，清缓存后通过）；
本机导出生产 `codepi-project`（项目 id 均合规、交接 0 条）；Web `35bd7003`（desk/blog 无待迁移，check-pages 通过）；
Project `c5e7549a`（应用 0003，2 个项目行保留，旧同步表删除；health、匿名 401、页面跳登录、无令牌 ingest 401 通过）；
MCP `f39133c1`（应用 0004_oauth_maintenance，check:live 通过）；删除 `GITHUB_TOKEN`（Project 版本 `04d4aa4f`）；
0003 与 mcp 0004 移入迁移基线。本次 Web/MCP 同时带上 main 上此前待发布的 Blog 1 MiB 与依赖升级。待办：所有者建项目与令牌后首次推送并读回。

## 上线步骤（已按此执行）

1. 按 [备份与恢复](../cloudflare-backup-restore.md) 导出生产 `codepi-project`（2026-11-04 读 MCP：2 个项目、0 条交接）；
   确认所有项目 id 只含小写字母、数字、连字符且不超过 64 字符（新表 CHECK，不满足会让迁移整体失败回滚）。
2. 顺序：先远程应用 `0003_workbench.sql`，紧接着部署 `codepi-project`，再部署 `codepi-mcp`。迁移到部署之间旧 Worker
   的 15 分钟 Cron 和旧 MCP 工具会读到已删除的表并报错（Cron 失败只记日志）；部署完成后恢复。反过来先部署会让新代码
   读不存在的表，更糟。然后删除不再使用的 `GITHUB_TOKEN` secret，从 `scripts/agent/check-migrations-baseline.json` 的
   `notApplied` 移入基线，更新资源登记（Cron 已移除）。
3. 网页建项目拿令牌，由项目仓库配置推送；首次推送后读回今天页、`work_overview` 与 `get_context`。
4. 客户端需重新读取 MCP 工具列表；旧工具名 `projects_list` 不再存在。

## 完成记录（2026-11-06）

- 2026-11-05 21:49 所有者签发推送令牌（只在本机钥匙串，D1 只存哈希），项目 id 沿用 `kedoupi-codepi`（`6ef2d84`）；首次推送 6 条任务，`task_list` 与 `work_overview` 读回一致。
- 2026-11-06 01:15 统筹看板「今天 + 池子 + 做完」上线（`137421f`；Project `2636ec09`，迁移 0004；MCP `4d2f0f29` 新增 `today_get` / `today_pick`）。
- 本任务完成，已从当前任务表移出。
