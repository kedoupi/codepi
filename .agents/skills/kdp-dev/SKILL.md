---
name: kdp-dev
description: 在 kdp.cool 仓库实现功能或修复问题时使用，确定应用边界、worktree 隔离和受影响检查；适合 agent 开发任务，不用于纯讨论或单独代码审查。
---

# kedoupi 项目开发

本流程与工具、模型无关；原生 skill 入口不可用时直接读取本文件即可。跨工具入口见 [agent-compatibility.md](../../../docs/development/agent-compatibility.md)。

1. 读取仓库根 `AGENTS.md` 和目标目录的 `AGENTS.md`，再读相关实现与调用方。路径均以 Git 仓库根目录为准。流程参考 [agent-workflow.md](../../../docs/development/agent-workflow.md)，首次应用或涉及并行隔离时读取相关章节。
2. 用 `git status --short`、`git worktree list`、`git rev-parse HEAD` 确定工作区、已有改动和起始 SHA。复用本任务的独立 worktree；多个无关任务不要共享写入目录。detached HEAD 可继续工作，不强制建分支或切换基线。
3. 用简短说明明确目标、受影响应用和验收。并行写入前确认协调者、唯一任务分配表、自己拥有的 worktree/路径、接口负责人和依赖；分配表在不同 worktree 的副本不代表实时状态。小修改直接做；涉及多应用、认证协议或数据迁移时，记录接口、消费者、兼容方式和实施顺序；需要跨会话时使用流程文档中的任务模板。
4. 保持最小修改。公共 `shared/` 变动先查全部引用；并行子任务明确文件所有权，共享接口由一个写入者负责。Health 用其独立 pnpm workspace；其他应用使用自己的 npm 项目，不引入根 workspace。
5. 先跑针对性验证，再运行 `node scripts/agent/check.mjs --base <起始SHA>` 阅读整个任务的检查计划；用 `--run` 执行适用检查。未知路径、缺失依赖或失败不得当作通过。UI 额外浏览器验收；检查脚本不替代真实调用关系分析。
6. 完成后审查整个任务 diff，报告改动、实际检查和未覆盖项。交付绑定具体 SHA；未提交时停止写入并列出基线和文件清单。指定集成者在整合后重新检查组合结果；各分支单独通过不能代替集成验证。commit/push/PR/部署及跨 agent 消息按用户已有授权执行；缺少授权时仍先完成可审查的本地结果，不在实现中途反复请求确认。

不要把历史计划的“待实施”或“已上线”直接当事实。涉及认证、生产配置或应用身份迁移时，核对当前代码和对应应用说明。不要把公开首页与私有健康、投资、稿件数据混入同一个数据边界。
