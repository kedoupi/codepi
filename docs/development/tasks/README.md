# 任务与接续入口

本页是任务导航，不复制完整日志或充当跨 worktree 的实时锁。摘要依据 2026-10-20
仓库记录与所有者反馈；继续工作前核对对应记录、当前源码和必要的远程状态。
历史文件中的“待部署”“待配置”不自动等于今天的故障。

## 当前接续项


| 工作 | 最近确认的状态 | 下一步与证据 |
| --- | --- | --- |
| Health 主睡眠缺失诊断 | PR #206 已合并，API/MCP 已上线；30 分钟观察 `healthy_reported`，owner 对账确认提供方档案未完整保存，数据尚未修复 | [任务记录](2026-10-26-health-sleep-diagnosis.md)：继续定位同步覆盖与档案不一致；全局四项版本漂移及所有者实际使用确认仍待处理 |
| Blog Agent 写作与配图 | 本地实现与验证完成：配图上传、稿件修订与审核、响应式阅读、原件备份 | [任务记录](2026-10-26-blog-agent-images.md)：尚未提交或部署，远程资源与实际客户端待验收 |
| 仓库公开与全量重发 | 已改名 `kedoupi/codepi` 并公开；备份 Release/tag 已删除；十个 Worker 已重发；通知、备份、巡检、MCP 授权修复和浏览器验收均已通过 | [任务记录](2026-10-23-public-rename-redeploy.md)：真实邮件 OTP、Oura 重授权和 MCP 客户端重连待所有者操作 |
| Ops Observer 正式工作流 | 第七至十九轮候选于 2026-10-25 合并 main 并全量发布十个 Worker（`7d0c814`）；Health 应用 0013/0014 索引迁移；观察 `release-7d0c81416a61-round19` 七轮完成，R2 summary 为 `healthy_reported`、无回滚，Issue #169 通知已核对 | [任务记录](2026-10-23-ops-observer.md)：PR #192/#193 已上线，Ops `22741311` 七轮观察 `healthy_reported`，真实自动回滚 `rollback_verified`；临时资源已清理；无人值守编排及用户实际使用确认仍待验收 |
| Cloudflare 告警优化 | 已闭环：WAF 边缘拦截（含编码变体与 credentials.json）、incident 策略删除、MCP 403+warn（PR #145/#149）、巡检 423 修复（PR #151）、全部漂移 Worker 重发、codepi-blog 纳入九库备份（手动实例已回执）、monitor 连续 complete、无 active issue | [告警优化与发布](2026-10-22-cloudflare-alert-tuning.md)：开发活跃期合并共享代码即产生漂移告警，需随合并节奏发布 |
| Workers Issues 自动告警 | 十个生产 Worker 的 20 条 service 自动规则已启用并复读核对；隔离异常自动触发、原策略发送和 Gmail 收件已验收，临时资源已清理 | [告警验收](2026-10-20-workers-issues.md)：首次自动链路已实测，复发条件本轮为配置核对；私钥异机保管保留 TODO |
| Health 数据可视化 | 睡眠/7 天解读/对比页重构经 PR #117 合并并发布，API 与前端 smoke、生产巡检全部通过 | [重构与发布证据](2026-10-20-health-data-visualization.md)：线上真实数据浏览待用户确认 |
| GitHub 跨平台备份（历史证据） | 2026-10-20 的私有 GitHub Release 副本仅保留为历史验收证据；`services/ops/src/offsite.mjs` 已下线，禁止把公开仓库 Release 当作备份通道。当前备份标准是私有 R2 v3 `manifest.json` 与 `reports/backup/r2-success.json`，覆盖九库及 GU/Me 原件 | [10-23 改名记录](2026-10-23-public-rename-redeploy.md)、[R2 备份恢复 runbook](../cloudflare-backup-restore.md)、[历史验收](2026-10-20-github-offsite.md) |
| Health 历史同步告警 | PR #111 已合并，Health API/MCP 已发布；真实账号 16 类旧告警归零，48 条历史记录保留，生产巡检 24/24 通过 | [修复与发布证据](2026-10-20-health-sync-alerts.md)：刷新设置页读取新状态，无需重新同步 |
| GU 线上工作台 | 真实投资资料已迁入 revision 1；六库及 112 份资料备份、GU 隔离恢复 11 表/132 行、全部原件鉴权下载通过；恢复修复经 PR #109 合入 main，两轮临时副本已清理 | [集成与清理结果](2026-10-19-gu-online.md#集成与清理结果)：原资料、生产数据、正式密文保留；GitHub 自动复制已验收，自动研究与 GU MCP 为后续阶段 |
| 工程文档与 Agent 规范整理 | 本地整理、链接核对与受影响检查完成，经 PR #106 交付 | [本轮记录](2026-10-19-engineering-docs.md)：入口、规则、skills 与历史标记已校正；主干状态以 PR 为准，后续新任务从包含规范的 main 开始 |
| Cloudflare 定时运维 | 私有 R2 v3 备份为现行通道，覆盖九库及 GU/Me 原件；GitHub Release 自动复制已退役，仅保留历史验收记录 | [R2 备份恢复 runbook](../cloudflare-backup-restore.md)、[公开与重发记录](2026-10-23-public-rename-redeploy.md)：每日 Cron 以实际回执为准，异机私钥取回为 TODO |
| 统一 MCP / Health | 已上线；所有者确认 Claude 手机端已连接并使用。Agent 兼容扩展仍在本地工作区，未部署 | [使用确认与验收范围](2026-10-18-unified-mcp.md#2026-10-19-claude-手机端使用确认)、[接入兼容](2026-10-25-mcp-agent-compat.md)：真实客户端验收仍待所有者 |
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
2026-10-20 已确认 Project、Me、GU 只读扩展；执行范围与部署状态以领域扩展任务为准，GZH/Web MCP 仍未纳入。

## 更新约定

新工作单元使用 `YYYY-MM-DD-topic.md`；小修改可在现有任务或回复中记录，不为每次运行建文件。
跨会话任务使用[交接模板](../agent-workflow.md#跨会话任务记录)，索引只在新增接续项或状态
发生实质变化时更新。已结束记录保留证据；被后续任务替代时增加接续链接。
摘要不替代 source SHA、实际检查、用户授权或生产验收。
