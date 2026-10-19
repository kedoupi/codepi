# 开发规范与工作流导航

本页是 kedoupi（codepi）的流程入口，不另建一套规则。先确认当前 Git 仓库和任务范围，再按需读取下列来源；不要每次加载所有历史计划。

## 规则放在哪里

| 内容 | 唯一维护位置 | 使用边界 |
| --- | --- | --- |
| 个人语言、协作与授权偏好 | 用户级 AGENTS / 工具配置 | 不复制到每个项目 skill |
| 产品范围、现有技术栈、共享契约 | [根 AGENTS.md](../../AGENTS.md) | 四个产品：首页、GU、GZH、Health；auth/shared 是支撑层 |
| 应用内部约束 | [Auth](../../services/auth/AGENTS.md)、[GU](../../apps/gu/AGENTS.md)、[GZH](../../apps/gzh/AGENTS.md)、[Health](../../apps/health/AGENTS.md)、[shared](../../packages/shared/AGENTS.md) | 改对应目录前读取；实现、调用方与测试也要核对 |
| 开发、验证、协作与交接 | [Agent 开发工作流](agent-workflow.md) | 小任务不强制建计划，多任务明确文件所有权 |
| 分支核对、集成、发布与退役 | [集成与发布工作流](integration-release.md) | 先核实事实，再执行已授权的变更 |
| Cloudflare 平台约束 | [CF 治理规范](cloudflare-governance.md) | 命名、环境、密钥、发布门禁与退役条件 |
| 云资源归属与核验记录 | [CF 资源登记表](cloudflare-resource-registry.md) | 版本化快照，不是实时控制面；关注 last_verified 和未决项 |
| 本地发布操作 | [本地发布操作](local-release.md) | PR 合并后，从干净且等于远程 main 的源码验证、发布及验收；CI 只做附加验证 |
| 定时巡检与备份 | [Cloudflare 定时运维](cloudflare-operations.md) | 私有 Cron/Workflows、R2 密文与独立的跨平台备份验收 |
| 各工具如何读取以上内容 | [工具兼容说明](agent-compatibility.md) | 入口只引用，不复制流程；不假定已完成所有客户端验收 |
| 本地自动检查范围 | [检查脚本](../../scripts/agent/check.mjs)及[回归测试](../../scripts/agent/check.test.mjs) | 预览计划不等于执行成功，脚本不能替代实际流程验收 |

## 按任务选择 skill

| 任务 | 共享 skill | 交付物 |
| --- | --- | --- |
| 实现功能、修复问题 | [kdp-dev](../../.agents/skills/kdp-dev/SKILL.md) | 最小改动、实际检查、未覆盖项 |
| CR、审查 PR 或工作区 | [kdp-review](../../.agents/skills/kdp-review/SKILL.md) | 固定快照上的缺陷与证据；默认只读 |
| 核对旧 worktree、归并分支、部署、清理资源 | [kdp-release](../../.agents/skills/kdp-release/SKILL.md) | 归并判定或经授权的集成/发布记录；不自动扩大权限 |
| 换 agent、跨会话续做 | [kdp-handoff](../../.agents/skills/kdp-handoff/SKILL.md) | 基线、写入边界、当前事实与可执行下一步 |

保留 `kdp-*` skill 名作为已有调用入口，不因域名迁移另建一套 `codepi-*` 同义 skill。Cloudflare 等通用平台 skill 提供工具用法，本仓库规范决定产品范围和发布约束。

## 什么才算完成

依次区分：**方案 → 已实现 → 本地验证 → 已审查 → 已合并 → 已推送 → 已部署 → 实际流程验收**。这些状态不自动相互推出，每一步附对应的版本、命令或平台证据。

- worktree 消失、分支删除或 Git 历史里出现相似标题，不代表内容已合并；按集成工作流检查 ancestry、补丁与当前行为。
- 本地 main 不一定等于远程 main；云端报告的 commit 也不一定对应干净源码。不要只用一句“都是最新的”交付。
- YAML、Wrangler 配置或密钥名称存在，不代表远程审批、绑定、密钥值及运行时已验收。不得在记录中存储凭证或私人业务数据。
- 历史任务与设计计划保留为决策依据，不覆盖当前产品边界。`apps/`、`services/`、`packages/` 与根 pnpm workspace 已实施，当前架构见 [工程架构与部署模型](../architecture/workspace-and-deployment.md)；目标技术栈仍按应用逐步迁移。

## 以后如何更新

约束写 AGENTS，重复操作写工作流，skill 只保留触发条件和执行要点，工具适配入口只做引用。实际进度写入已有的 `tasks/<task-id>.md`；新任务才新建记录。一次性的故障日志不直接升级为全局规范。

修改流程后检查相对链接、skill 元数据与检查映射，并用相关任务场景核对行为。若规范与实现矛盾，明确差异；不能通过改文档把尚未执行的迁移或验收标成完成。
