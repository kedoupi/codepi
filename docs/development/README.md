# 开发规范与工作流导航

本页是 kedoupi（codepi）的流程入口，不另建一套规则。omp、Codex 和 Claude Code 共用以下来源；按任务读取，不要求日常启动协作 agent。先确认当前 Git 仓库和任务范围，不要每次加载所有历史计划。
全项目文档分类见[工程文档入口](../README.md)，跨会话续做先看[任务索引](tasks/README.md)。

## 规则放在哪里

| 内容 | 唯一维护位置 | 使用边界 |
| --- | --- | --- |
| 个人语言、协作与授权偏好 | 用户级 AGENTS / 工具配置 | 不复制到每个项目 skill |
| 产品范围、现有技术栈、共享契约 | [根 AGENTS.md](../../AGENTS.md) | 产品以 shared/products.ts 为准；Auth/MCP/Ops/shared 为支撑层 |
| 应用与服务内部约束 | 下方“按修改范围选路”表中的局部 `AGENTS.md` | 改对应目录前读取；实现、调用方与测试也要核对 |
| 开发、验证、协作与交接 | [Agent 开发工作流](agent-workflow.md) | 默认单 agent 本地实现与验证；协作、审查和发布按需 |
| 分支核对、集成、发布与退役 | [集成与发布工作流](integration-release.md) | 先核实事实，再执行已授权的变更 |
| Cloudflare 平台约束 | [CF 治理规范](cloudflare-governance.md) | 命名、环境、密钥、发布门禁与退役条件 |
| 云资源归属与核验记录 | [CF 资源登记表](cloudflare-resource-registry.md) | 版本化快照，不是实时控制面；关注 last_verified 和未决项 |
| 本地发布操作 | [本地发布操作](local-release.md) | PR 合并后，从干净且等于远程 main 的源码验证、发布及验收；CI 只做附加验证 |
| 定时巡检与备份 | [Cloudflare 定时运维](cloudflare-operations.md) | 私有 Cron/Workflows、R2 v4 密文与独立的外部灾备/恢复验收 |
| 各工具如何读取以上内容 | [工具兼容说明](agent-compatibility.md) | 入口只引用，不复制流程；不假定已完成所有客户端验收 |
| 本地自动检查范围 | [检查脚本](../../scripts/agent/check.mjs)及[回归测试](../../scripts/agent/check.test.mjs) | 预览计划不等于执行成功，脚本不能替代实际流程验收 |

## 按修改范围选路

| 要改什么 | 先读 | 调用关系与验证重点 |
| --- | --- | --- |
| 首页、博客、Desk | [Web 规则](../../apps/web/AGENTS.md)、[Web README](../../apps/web/README.md) | 静态公开内容与私有聚合分开；Desk 依赖 Auth 和三应用摘要接口 |
| GU | [GU 规则](../../apps/gu/AGENTS.md)、[GU README](../../apps/gu/README.md) | 线上账户/规则版本、资料鉴权、金额与来源语义；Worker/schema 还检查 Ops 原件备份；旧快照切换及部署状态见任务记录 |
| GZH | [GZH 规则](../../apps/gzh/AGENTS.md)、[GZH README](../../apps/gzh/README.md) | 草稿、审阅、预览和发布状态，不隐式对外发文 |
| Health UI、数据、Oura 同步 | [Health 规则](../../apps/health/AGENTS.md)、[Health README](../../apps/health/README.md) | 日期/覆盖/同步语义；API 或内部数据能力变动还检查 MCP |
| Project / Me / CLI | [领域契约](../architecture/mcp-domains.md)、各自目录 AGENTS | 任务化交接、确认区、分批导入、OAuth 跨进程刷新；新资源不等于已上线 |
| 统一登录、shared auth | [Auth 规则](../../services/auth/AGENTS.md)、[SSO 客户端说明](../../packages/shared/auth/README.md) | 客户端以 shared/auth/clients.ts 为准；网站 SSO 与提供方/MCP 授权分开 |
| MCP transport、授权或工具 | [MCP 规则](../../services/mcp/AGENTS.md)、[MCP README](../../services/mcp/README.md)、[架构](../architecture/unified-mcp.md) | MCP 授权 D1 与业务库分开；通过 named RPC 调用 Health/Project/Me/GU/Blog，各工具单独校验 scope |
| 巡检、备份、运维调度 | [Ops 规则](../../services/ops/AGENTS.md)、[Ops README](../../services/ops/README.md)、[运维流程](cloudflare-operations.md)、[恢复手册](cloudflare-backup-restore.md) | `services/ops/` 与 `scripts/cloudflare/` 共用实现；R2 v4 完整成功、外部灾备和隔离恢复分别记录 |
| 共享样式、品牌、产品和接口 | [shared 规则](../../packages/shared/AGENTS.md)、[CodePi Design System 规范](../architecture/codepi-design-system.md) | 先查 imports 和文件系统读取；公共契约由一个写入者维护 |
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

## 维护与完成状态

规则归属由根 `AGENTS.md`、局部规则、工作流、skill 和工具兼容页分别维护；本导航只负责路由。实现、验证、审查、合并、部署和实际流程验收按工作流分别记录，不能相互推定。
任务进度写入已有的 `tasks/<task-id>.md` 并更新[任务索引](tasks/README.md)；修改流程后核对链接、skill 元数据、检查映射和一个真实任务场景。
