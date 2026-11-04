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

## 上线前（需所有者另行授权）

1. 按 [备份与恢复](../cloudflare-backup-restore.md) 导出生产 `codepi-project`（当前 2 个项目、0 条交接）。
2. 远程应用 `0003_workbench.sql`，部署 `codepi-project` 与 `codepi-mcp`，删除不再使用的 `GITHUB_TOKEN` secret，更新资源登记（Cron 已移除）。
3. 网页建项目拿令牌，由项目仓库配置推送；首次推送后读回今天页、`work_overview` 与 `get_context`。
4. 客户端需重新读取 MCP 工具列表；旧工具名 `projects_list` 不再存在。
