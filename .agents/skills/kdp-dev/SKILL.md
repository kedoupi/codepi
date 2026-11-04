---
name: kdp-dev
description: 在 codepi 实现功能、修复问题或维护工程文档时使用，确定应用边界、worktree 隔离和受影响检查；不用于纯讨论或单独代码审查。
---

# kedoupi 项目开发

本 skill 只补充执行顺序；根与目标目录 `AGENTS.md` 是规则来源。原生 skill 不可用时直接读取本文件。

1. 明确目标、验收和允许修改的路径；核实 Git 根目录、HEAD、已有改动。执行者在 lead 分配的任务 worktree（任务分支）里工作，不建任务文档或分配表。
2. 读取根和目标目录规则、实现、调用方及邻近测试。先确认根因，做最小完整修改；共享契约由一个写入者负责，新增消费者同步更新 `scripts/agent/check-plan.mjs`。
3. 普通未提交修改从仓库根运行 `pnpm check`。需要构建、完整任务或全仓验证时分别使用 `pnpm check:full`、`pnpm task:base && pnpm check:task`、`pnpm check:all`；显式基线场景保留 `node scripts/agent/check.mjs --base <SHA> --run`。
4. UI、真实 OAuth、生产数据、远程绑定和邮件按影响单独验收。测试只用本地合成数据，不因快检通过宣称完整或生产验收通过。
5. 更新受影响的现行文档。交付实际命令、结果和未覆盖路径；短任务不写任务记录，跨会话才按 `kdp-handoff` 留下基线、文件清单和下一步。

不要把公开页面与私人健康、投资、稿件数据混入同一数据边界。不要恢复退役产品，不新增依赖，任务分支内可提交；合并本地 main 由 lead 在验收与审查通过后进行；push、deploy、远程迁移需所有者授权。
