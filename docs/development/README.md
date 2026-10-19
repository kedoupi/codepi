# 开发规范与工作流导航

本页是 kedoupi（codepi）的流程入口，不另建一套规则。先确认当前 Git 仓库和任务范围，再按需读取下列来源；不要每次加载所有历史计划。
全项目文档分类见[工程文档入口](../README.md)，跨会话续做先看[任务索引](tasks/README.md)。

## 规则放在哪里

| 内容 | 唯一维护位置 | 使用边界 |
| --- | --- | --- |
| 个人语言、协作与授权偏好 | 用户级 AGENTS / 工具配置 | 不复制到每个项目 skill |
| 产品范围、现有技术栈、共享契约 | [根 AGENTS.md](../../AGENTS.md) | 四个产品：首页、GU、GZH、Health；Auth/MCP/Ops/shared 为支撑层 |
| 应用与服务内部约束 | 下方“按修改范围选路”表中的局部 `AGENTS.md` | 改对应目录前读取；实现、调用方与测试也要核对 |
| 开发、验证、协作与交接 | [Agent 开发工作流](agent-workflow.md) | 小任务不强制建计划，多任务明确文件所有权 |
| 分支核对、集成、发布与退役 | [集成与发布工作流](integration-release.md) | 先核实事实，再执行已授权的变更 |
| Cloudflare 平台约束 | [CF 治理规范](cloudflare-governance.md) | 命名、环境、密钥、发布门禁与退役条件 |
| 云资源归属与核验记录 | [CF 资源登记表](cloudflare-resource-registry.md) | 版本化快照，不是实时控制面；关注 last_verified 和未决项 |
| 本地发布操作 | [本地发布操作](local-release.md) | PR 合并后，从干净且等于远程 main 的源码验证、发布及验收；CI 只做附加验证 |
| 定时巡检与备份 | [Cloudflare 定时运维](cloudflare-operations.md) | 私有 Cron/Workflows、R2 密文与独立的跨平台备份验收 |
| 各工具如何读取以上内容 | [工具兼容说明](agent-compatibility.md) | 入口只引用，不复制流程；不假定已完成所有客户端验收 |
| 本地自动检查范围 | [检查脚本](../../scripts/agent/check.mjs)及[回归测试](../../scripts/agent/check.test.mjs) | 预览计划不等于执行成功，脚本不能替代实际流程验收 |

## 按修改范围选路

| 要改什么 | 先读 | 调用关系与验证重点 |
| --- | --- | --- |
| 首页、博客、Desk | [Web 规则](../../apps/web/AGENTS.md)、[Web README](../../apps/web/README.md) | 静态公开内容与私有聚合分开；Desk 依赖 Auth 和三应用摘要接口 |
| GU | [GU 规则](../../apps/gu/AGENTS.md)、[GU README](../../apps/gu/README.md) | 线上账户/规则版本、资料鉴权、金额与来源语义；Worker/schema 还检查 Ops 原件备份；旧快照切换及部署状态见任务记录 |
| GZH | [GZH 规则](../../apps/gzh/AGENTS.md)、[GZH README](../../apps/gzh/README.md) | 草稿、审阅、预览和发布状态，不隐式对外发文 |
| Health UI、数据、Oura 同步 | [Health 规则](../../apps/health/AGENTS.md)、[Health README](../../apps/health/README.md) | 日期/覆盖/同步语义；API 或内部数据能力变动还检查 MCP |
| 统一登录、shared auth | [Auth 规则](../../services/auth/AGENTS.md)、[SSO 客户端说明](../../packages/shared/auth/README.md) | 五个客户端：GU、Health、GZH、Desk、MCP；网站 SSO 与提供方/MCP 授权分开 |
| MCP transport、授权或工具 | [MCP 规则](../../services/mcp/AGENTS.md)、[MCP README](../../services/mcp/README.md)、[架构](../architecture/unified-mcp.md) | MCP 授权 D1 与 Health 业务库分开；通过 named RPC 调用 Health |
| 巡检、备份、运维调度 | [Ops 规则](../../services/ops/AGENTS.md)、[运维流程](cloudflare-operations.md)、[恢复手册](cloudflare-backup-restore.md) | `services/ops/` 与 `scripts/cloudflare/` 共用实现；R2 完整成功与跨平台成功分别记录 |
| 共享样式、品牌、产品和接口 | [shared 规则](../../packages/shared/AGENTS.md)、[设计规范](../architecture/personal-design-system.md) | 先查 imports 和文件系统读取；公共契约由一个写入者维护 |
| 发布脚本、CI、资源与域名 | [集成发布](integration-release.md)、[本地发布](local-release.md)、[CF 治理](cloudflare-governance.md) | 检查范围不等于发布范围；多服务发布由一个协调者持锁执行 |

具体命令以目标包的 `package.json` 和 `scripts/agent/check.mjs` 为准。
开发与审查的自动检查只使用本地合成数据；生产探针、真实授权、导出、迁移和发布各自核对授权。

## 按任务选择 skill

| 任务 | 共享 skill | 交付物 |
| --- | --- | --- |
| 实现功能、修复问题 | [kdp-dev](../../.agents/skills/kdp-dev/SKILL.md) | 最小改动、实际检查、未覆盖项 |
| CR、审查 PR 或工作区 | [kdp-review](../../.agents/skills/kdp-review/SKILL.md) | 固定快照上的缺陷与证据；默认只读 |
| 核对旧 worktree、归并分支、部署、清理资源 | [kdp-release](../../.agents/skills/kdp-release/SKILL.md) | 归并判定或经授权的集成/发布记录；不自动扩大权限 |
| 换 agent、跨会话续做 | [kdp-handoff](../../.agents/skills/kdp-handoff/SKILL.md) | 基线、写入边界、当前事实与可执行下一步 |

保留 `kdp-*` skill 名作为已有调用入口，不因域名迁移另建一套 `codepi-*` 同义 skill。Cloudflare 等通用平台 skill 提供工具用法，本仓库规范决定产品范围和发布约束。

## 什么才算完成

分别记录：**方案、已实现、本地验证、已审查、已提交/推送、已合并、已部署、实际流程验收**。这些状态不自动相互推出；API 合并和本地提交也不是固定先后关系，每一步附对应的版本、命令或平台证据。

- worktree 消失、分支删除或 Git 历史里出现相似标题，不代表内容已合并；按集成工作流检查 ancestry、补丁与当前行为。
- 本地 main 不一定等于远程 main；云端报告的 commit 也不一定对应干净源码。不要只用一句“都是最新的”交付。
- YAML、Wrangler 配置或密钥名称存在，不代表远程审批、绑定、密钥值及运行时已验收。不得在记录中存储凭证或私人业务数据。
- 历史任务与设计计划保留为决策依据，不覆盖当前产品边界。`apps/`、`services/`、`packages/` 与根 pnpm workspace 已实施；当前技术栈和服务边界见[工程架构与部署模型](../architecture/workspace-and-deployment.md)，后续改造按具体任务确定。

## 以后如何更新

约束写 AGENTS，重复操作写工作流，skill 只保留触发条件和执行要点，工具适配入口只做引用。实际进度写入已有的 `tasks/<task-id>.md`；新任务才新建记录，并按需更新[任务索引](tasks/README.md)。一次性的故障日志不直接升级为全局规范。

修改流程后检查相对链接、skill 元数据与检查映射，并用相关任务场景核对行为。若规范与实现矛盾，明确差异；不能通过改文档把尚未执行的迁移或验收标成完成。
