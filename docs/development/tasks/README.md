# 任务与接续入口

本页是任务导航，不复制完整日志或充当跨 worktree 的实时锁。摘要依据 2026-10-19
仓库记录与所有者反馈；继续工作前核对对应记录、当前源码和必要的远程状态。
历史文件中的“待部署”“待配置”不自动等于今天的故障。

## 当前接续项

| 工作 | 最近确认的状态 | 下一步与证据 |
| --- | --- | --- |
| GU 线上工作台 | 第一阶段与原件加密备份/恢复工具已完成；14 项检查、247 个 GU 测试、19 个 Ops 单测及隔离 D1/R2 恢复下载通过；尚未提交或发布 | [任务记录](2026-10-19-gu-online.md)：沿用前轮桌面/移动验收；下一步按授权处理私有 R2、GU→Ops 发布、真实备份/恢复和资料迁移；自动研究与 GU MCP 为后续阶段 |
| 工程文档与 Agent 规范整理 | 本地整理、链接核对与受影响检查完成，经 PR #106 交付 | [本轮记录](2026-10-19-engineering-docs.md)：入口、规则、skills 与历史标记已校正；主干状态以 PR 为准，后续新任务从包含规范的 main 开始 |
| Cloudflare 定时运维 | Ops 已发布；六库 R2 密文与解密校验通过；云端 GitHub 版本核对和跨平台副本因缺运行凭证失败 | [当前剩余项](2026-10-19-cloudflare-operations.md#当前剩余项)：凭证由所有者方便时配置，再验收；邮件送达、异机私钥保管和恢复演练仍待确认 |
| 统一 MCP / Health | 已上线；所有者确认 Claude 手机端已连接并使用 | [使用确认与验收范围](2026-10-18-unified-mcp.md#2026-10-19-claude-手机端使用确认)：按使用反馈改进，其他客户端及刷新/撤销等专项检查按需补齐 |
| Desk 真实使用验收 | Worker、D1 和所需 secret 名称已有后续发布证据；不能继续仅凭最初 P6 记录判断“未部署” | [首页迁移](2026-10-17-web-static-assets.md)、[资源登记表](../cloudflare-resource-registry.md)、[应用说明](../../../apps/web/README.md)：如继续此产品，核对登录后的三来源摘要，不因旧 TODO 重建资源或轮换凭证 |
| 旧生产 SSO 验收脚本 | `services/auth/scripts/verify-production.mjs` 仍含退役 Pages 目标，未覆盖 Desk/MCP | 本轮仅记录：[Auth 使用限制](../../../services/auth/README.md#validation)。后续先更新目标和覆盖范围，再按授权执行真实邮件验收；不影响现行发布探针 |

## 已落地阶段与历史接续关系

| 主题 | 记录 |
| --- | --- |
| 四产品、迁域与旧资源退役 | [cutover](2026-10-15-codepi-cutover.md)、[Health 命名](2026-10-18-health-naming.md) |
| workspace 与严格共享导出 | [workspace 修复](2026-10-16-workspace-release-repair.md)、[严格 exports](2026-10-17-shared-strict-exports.md) |
| 私有应用 Svelte / Hono | [GU 前端](2026-10-17-gu-svelte-frontend.md)、[GZH 前端](2026-10-17-gzh-svelte-frontend.md)、[GU 路由](2026-10-17-gu-hono-router.md)、[Health API](2026-10-17-health-hono-api.md)、[Auth](2026-10-17-auth-hono.md) |
| Workers Static Assets | [首页](2026-10-17-web-static-assets.md)、[GU](2026-10-17-gu-static-assets.md)、[GZH](2026-10-17-gzh-static-assets.md)、[Health 命名与收尾](2026-10-18-health-naming.md) |
| Health 授权故障与早期备份 | [可靠性记录](2026-10-18-platform-reliability.md) → [MCP 运维补齐](2026-10-19-mcp-operations.md) → [CF 定时运维](2026-10-19-cloudflare-operations.md)；最新记录已确认 Health 同步新鲜度通过 |
| Desk 最初实现 | [P6](p6-personal-desk.md)是历史实现记录；后续发布与配置看上表，不执行其中旧 Pages 命令 |

待产品讨论的方向（如公开内容 MCP、GU/GZH 的 MCP 模块）不是自动开工清单。
沿用当前决定：统一 CodePi 入口先提供 Health，其他模块在产品能力和需求明确后设计。

## 更新约定

新工作单元使用 `YYYY-MM-DD-topic.md`；小修改可在现有任务或回复中记录，不为每次运行建文件。
跨会话任务使用[交接模板](../agent-workflow.md#跨会话任务记录)，索引只在新增接续项或状态
发生实质变化时更新。已结束记录保留证据；被后续任务替代时增加接续链接。
摘要不替代 source SHA、实际检查、用户授权或生产验收。
