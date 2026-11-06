# today-checked

## 计划

- 修复 ingest 删除任务与 `owner_deleted` 的生命周期。
- 增加 `agent_checked` 历史、`today_check` RPC、today board 汇总与网页检查提示。
- 更新测试、迁移基线和项目/MCP 文档。
- 运行 Project、MCP、迁移和浏览器验收。

## 已完成

- 新增 `apps/project/migrations/0006_agent_checked.sql`，登记迁移基线。
- ingest 在任务重新出现且没有未完成行时清除 `owner_deleted`；写 `done_at` 不再清除该标记。
- `todayView` 返回跨日 `checks`、当天 `counts.checked`；`checkAgentToday` 支持批量检查、同日幂等更新、完成/网页删除跳过、缺失任务整批 404，并将 today pick 移回池子。
- Project MCP 和统一 MCP 工具注册 `today_check`；网页池子显示检查次数与最近北京时间。
- 更新 today、ingest、MCP 测试及 Project/MCP 文档。

## 当前状态
- Project 类型检查通过。
- Project 全量测试通过：8 files / 59 tests。
- MCP 类型检查通过；MCP 域测试通过：77 tests。
- Project build 与桌面/390px 浏览器冒烟通过。
- 迁移检查与 `git diff --check` 通过。
- `node scripts/agent/check.mjs --base main --run` 通过：35 个选定本地检查全部通过。
- 已提交 `9e0bb46 feat(project): record assistant daily checks`，工作区干净。
