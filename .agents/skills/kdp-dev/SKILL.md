---
name: kdp-dev
description: 在 codepi 实现功能、修复问题或维护工程文档时使用，确定应用边界、worktree 隔离和受影响检查；不用于纯讨论或单独代码审查。
---

# kedoupi 项目开发

本流程与工具、模型无关；原生 skill 入口不可用时直接读取本文件即可。跨工具入口见 [agent-compatibility.md](../../../docs/development/agent-compatibility.md)。

1. 读取根 `AGENTS.md`，再按[开发导航](../../../docs/development/README.md)选择目标目录的 `AGENTS.md` 及相关实现/调用方；续做时从[任务索引](../../../docs/development/tasks/README.md)定位证据，不从旧计划推断当前状态。
2. 核实 `git rev-parse --show-toplevel`，检查 `git status --short`、`git worktree list` 和 `git rev-parse HEAD`；记录基线并保护已有改动。复用当前任务 worktree；仅为真正并行或独立负责的任务另建 worktree。支持 detached HEAD。
3. 简要说明目标、验收、影响路径和依赖。普通单 agent 任务无需分配表；并行写入时，在一张共享表中记录每位负责人的 worktree、允许路径、接口负责人和依赖。
4. 做最小且完整的改动，复用现有模式。共享契约由一个写入者负责，改动前检查所有消费者；不添加依赖或触碰已退役产品路径。
5. 先跑针对性检查，再预览并默认执行 `node scripts/agent/check.mjs --base <starting-SHA> --run`。报告命令、结果和未覆盖路径；UI、真实授权、生产数据和远程操作仍需单独验收。
6. 更新受影响的现行文档和任务证据。交付前审查完整 diff，将证据绑定到基线及已停止写入的 worktree/文件清单；未经授权不得 commit、push、merge、deploy 或执行远程操作。

不要把历史计划的“待实施”或“已上线”直接当事实。涉及认证、生产配置或应用身份迁移时，核对当前代码和对应应用说明。不要把公开首页与私有健康、投资、稿件数据混入同一个数据边界。

涉及 Cloudflare 配置先读 [治理规范](../../../docs/development/cloudflare-governance.md)，只记录元数据与验证结果，不输出 secret 值。旧分支核对、合并、发布或退役任务转入 [kdp-release](../kdp-release/SKILL.md)，不在开发流程中默认附带执行。
