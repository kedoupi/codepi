# 开发导航

普通开发只需根与目标目录 `AGENTS.md` 加 `.agents/skills/kdp-dev/SKILL.md`；本页用于按风险选路，不要求每次加载全部流程。默认一个 agent，不默认启动协作、审查或发布。

| 要做什么 | 入口 |
| --- | --- |
| 日常实现、验证、风险分级 | [开发与验证](agent-workflow.md) |
| 当前待办或跨会话续做 | [当前任务](tasks/README.md)；历史证据看[档案](archive/README.md) |
| 首页、GU、GZH、Health、Project、Me | 对应目录 `AGENTS.md` 和 README |
| shared、Auth、MCP、Ops、CLI | 对应目录 `AGENTS.md` 和 README |
| 审查、交接、集成与发布 | `kdp-review`、`kdp-handoff`、`kdp-release`；[集成发布](integration-release.md) |
| 生产发布、迁移、真实验收 | [本地发布](local-release.md) 与 [Cloudflare 治理](cloudflare-governance.md) |
| 工具接入 | [多工具入口](agent-compatibility.md) |

日常命令从仓库根运行：

```bash
pnpm check          # 当前未提交改动，快速检查
pnpm check:full     # 当前未提交改动，完整本地检查
pnpm check:task     # 已由 pnpm task:base 固定基线的整个任务
pnpm check:all      # 全仓完整检查
```

应用命令和影响范围唯一维护在 `scripts/agent/check-plan.mjs`；检查器及回归测试验证该配置。快速检查不代替 UI、真实授权、生产数据、远程资源和发布验收。提交、合并、部署和迁移按实际授权执行。
