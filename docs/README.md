# 工程文档入口

本目录区分现行规范、任务证据和历史方案。新 Agent 不需要通读所有文档：
先确认实际 checkout，再按任务读取现行入口；文件名、日期或旧计划的 “Accepted”
不能单独证明某个方案仍有效。

## 开始工作

1. 读[项目约束](../AGENTS.md)，检查 Git 根目录、HEAD 和已有改动。
2. 读[开发导航](development/README.md)，按修改范围找到局部 `AGENTS.md` 和 skill。
3. 接续已有工作时，查[任务索引](development/tasks/README.md)和对应任务记录；
   核对文件是否已进入当前 checkout，未提交改动不会自动出现在其他 worktree。
4. 读取相关实现与调用方，预览受影响检查，再开始改动。不同文档有冲突时，
   以当前用户决定、现行约束和实际代码/验证证据核对，不能直接沿用旧方案。

## 现行资料

| 要了解什么 | 入口及职责 |
| --- | --- |
| 产品、域名、启动方式 | [根 README](../README.md) |
| 工程结构、技术栈、服务边界、环境 | [工程架构与部署模型](architecture/workspace-and-deployment.md) |
| 共享视觉和 UI 约束 | [CodePi Design System 规范](architecture/codepi-design-system.md)（品牌、token、组件、应用主题、待实施清单）、[个人站设计规范](architecture/personal-design-system.md)（主站布局与公开页边界） |
| 统一 MCP、Health 数据语义和扩展边界 | [领域扩展与 CLI](architecture/mcp-domains.md)、[Health MCP 架构](architecture/unified-mcp.md)、[MCP README](../services/mcp/README.md) |
| 开发、审查、多 Agent 分工与交接 | [开发导航](development/README.md)、[Agent 工作流](development/agent-workflow.md) |
| 不同 CLI 如何读取同一套规则 | [工具兼容说明](development/agent-compatibility.md) |
| 分支核对、集成和退役 | [集成发布流程](development/integration-release.md) |
| 合并后从本机发布 | [本地发布操作](development/local-release.md) |
| Cloudflare 约束和资源归属 | [治理规范](development/cloudflare-governance.md)、[资源登记表](development/cloudflare-resource-registry.md) |
| 巡检、备份和恢复 | [定时运维](development/cloudflare-operations.md)、[恢复手册](development/cloudflare-backup-restore.md) |
| 已完成什么、还有哪些待办 | [任务索引](development/tasks/README.md)及其链接的任务证据 |

资源登记表与任务记录是带日期的证据，不是实时控制面。运行时版本、凭证是否就绪、
真实客户端是否可用，须按具体任务核实；用户使用确认与 Agent 独立验证分别记录。

## 历史资料

历史文件保留原位置，避免破坏旧 PR 和交接链接；正文中的目录、域名、状态及命令
描述当时的现场，不用来恢复退役产品或决定当前发布方式。

| 文件 / 目录 | 阅读方式 |
| --- | --- |
| [旧架构基线](architecture/architecture-baseline.md)、[P1 计划](architecture/p1-implementation-plan.md)、[Phase 1 记录](architecture/phase1-delivery-record.md) | 旧工具站阶段；workspace、Workers、本地发布等决策已被现行工程架构替代 |
| [应用并仓记录](architecture/product-apps-monorepo-migration.md)、[公众号合一记录](architecture/wechat-desk-unification.md)、[Health 域名迁移](architecture/health-domain-migration.md) | 用于理解迁移原因；当前目录和域名看根 README |
| [AdSense 历史记录](architecture/adsense-review-hardening-record.md) | 已退出的广告/增长方向，不作为新开发约束 |
| `superpowers/specs/`、`superpowers/plans/` | 提案与阶段计划；使用前核对用户决定、当前实现和后续任务证据 |
| `development/tasks/` 中的旧任务 | 保留当次验证与故障记录；后续进展通过索引或文件顶部的接续链接定位 |

## 维护方式

- 稳定约束写 `AGENTS.md`，操作步骤写工作流，skill 只负责选路和执行要点。
- 产品实现说明留在应用 README；当前进度与待办写对应任务，索引只保留摘要和链接。
- 架构或发布方式变化时，同批更新现行入口；被替代的方案标为历史，不改写旧验证结果。
- 交付前核对相对链接、命令是否存在、skill 引用及受影响检查。文档更新本身不代表
  已提交、已合并、已部署或已在其他 Agent 的 checkout 生效。
