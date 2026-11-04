# 开发与验证

普通开发默认走 agent-team 流程：lead 与所有者讨论并出计划，只读 agent 核验，执行者在任务 worktree 里实现，测试终端验收、独立只读审查通过后由 lead 合并到本地 main；不需要分配表或任务文档。根 `AGENTS.md`、目标目录 `AGENTS.md` 和 `kdp-dev` 已包含日常入口；只有续做、跨工具交接、独立审查或发布时才使用本导航的其他文档。

## 日常开发

1. 明确目标、验收和允许修改的路径，确认真实 Git 根目录、HEAD 与已有改动。
2. 读取目标实现、调用方和邻近测试，确定根因后做最小完整修改。
3. 从仓库根运行 `pnpm check`：只检查当前未提交改动，执行测试和类型检查等快速项。
4. UI 或关键交互另外做对应浏览器验收；远程授权、生产数据和真实邮件不属于本地自动检查。
5. 交付改动、实际结果和未覆盖路径。任务分支内可提交；合并本地 main 须验收与审查通过；push、deploy、迁移需所有者授权。

```bash
pnpm install --frozen-lockfile  # 首次或 lockfile 变化后
pnpm check                     # 当前改动，快速检查
pnpm --filter web test       # 需要时单独运行目标应用命令
```

完整检查按需选择：

| 命令 | 范围 |
| --- | --- |
| `pnpm check:quick` | 当前未提交改动；测试、类型检查、静态检查 |
| `pnpm check:full` | 当前未提交改动；增加构建、资产和配置中的完整检查 |
| `pnpm task:base` + `pnpm check:task` | 跨会话任务或已提交改动；记录基线后检查整个任务 |
| `pnpm check:all` | 全仓完整本地检查；共享依赖或发布前使用 |
| `node scripts/agent/check.mjs --base <SHA> --run` | 集成、发布或历史审查的显式基线 |

`check` / `check:quick` 不需要基线；`check:task` 才需要 `.agent/task-base`。基线属于当前 worktree，不能同步到其他 checkout，也不能用 `HEAD` 代替整个任务的起点。检查器不安装依赖、不提交、不部署。full 包含已登记的构建后浏览器检查，使用本地合成数据，不代替真实产品验收。

## 影响范围

应用命令和跨服务依赖集中在 `scripts/agent/check-plan.mjs`；新增应用、共享消费者或检查命令只修改该配置并补充回归测试。`scripts/agent/check.mjs` 只负责计算范围、选择 quick/full 并执行，独立检查最多并行四路；构建为独占检查，测试脚本会顺带重建其他包产物时在配置里声明 `locks`，同名锁的检查不并行（2026-11-04：MCP 测试重建 CLI 曾与 CLI 测试并发撞 `dist`）；CI 通过 `scripts/agent/ci-plan.mjs` 复用同一配置，不另维护路径正则。发布范围仍由 `scripts/cloudflare/release-scope.mjs` 单独表达 Health 前后端和运行时依赖，不将测试范围直接当作发布范围。

- 普通应用：只检查自己的测试、类型、构建及专属验证。
- Health API / Health shared：追加 MCP。
- GU Worker / migrations：追加 MCP 和 Ops；Project / Me Worker / migrations：追加 MCP，Me 还追加 Ops。
- shared MCP contract：检查各领域与 CLI；Auth/shared auth 或高风险 shared：检查全部消费者和 shared auth client。
- Wrangler、Cloudflare 与运维路径：追加本地治理检查；migration 追加 append-only guard。
- 文档通常只检查链接和格式，不触发应用构建；无法映射的路径必须明确处理，不能静默记为通过。

`quick` 用于日常反馈，不代表 UI、完整集成或生产验收。发布仍以 `local-release.md` 的完整显式基线检查为准；生产发布范围由 Cloudflare 发布记录独立计算，不能直接复用本地检查范围。

## 风险分级

- **小型单应用修改**：上述快速检查即可进入交付；涉及可见 UI 时补浏览器证据。
- **共享契约、跨应用、已提交任务**：运行完整任务检查，核对所有消费者。
- **Auth、MCP、migration、备份、生产发布**：保留现行专项审查、治理与真实流程验收，不因快速检查通过而省略。

## 跨会话与并行

短任务在回复中交付即可。只有长任务、换 agent 或并行写入时才建立 `docs/development/tasks/<task-id>.md`，记录目标、基线、worktree、允许路径、验证证据和下一步；当前待办写入[任务索引](tasks/README.md)，已结束记录按年度放入[档案](archive/README.md)。

并行任务才需要共享分配表，至少包含负责人、worktree、允许路径、公共接口负责人和依赖。共享契约只有一个写入者。任务文档不是锁，也不扩大 Git 或远程授权。

多 Agent 协作（lead 出计划与分派、执行者实现、测试终端验收、独立只读审查）默认使用所有者本机的 `agent-team` 流程（skill 不在本仓库，按需在本机建 `.claude/skills/agent-team` 链接，不提交）；最多 3 轮审查，通过后 lead 自动合并到本地 main，push 与发布需所有者授权；隔离、提交、验收与合并方式只写在[根 AGENTS.md 的「Agent 协作适配」](../../AGENTS.md#agent-协作适配)，本页其余约定照常适用。

审查固定提交 SHA；未提交时固定基线、停止写入并列明文件清单。发布、合并和本地验证分别记录，不相互推定。完整协作细节按需查看 [kdp-review](../../.agents/skills/kdp-review/SKILL.md)、[kdp-handoff](../../.agents/skills/kdp-handoff/SKILL.md) 和 [kdp-release](../../.agents/skills/kdp-release/SKILL.md)。
