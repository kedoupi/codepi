# Ops Observer 正式工作流

- 状态：已实现并完成线上验收；自动化接入和真实安全回滚演练仍未完成
- 目标与验收：将发布后 Ops Observer 纳入五角色流水线，明确单一 release manifest、30 分钟观察、R2 报告、GitHub Issue 通知、severity 与自动回滚安全门；文档相对链接正确且不记录凭证值。
- 不在范围内：不改业务代码、Cloudflare 远程资源、生产凭证、OAuth 或发布配置。
- worktree / 分支：历史实现来自独立 Observer worktree；后续修复经 PR #164/#165/#174/#175 合并到 main
- 起始 SHA / 审查基线：`436c19b7e85ee67c56b8c13a4e45b9a3441a520b`
- 当前交付 SHA：Observer 相关当前 main `805af3fc3a6f`
- 实施：已完成；Observer 运行时、指标、Issues 过滤、GitHub User-Agent 和服务名显示问题均已修复
- 本地验证：Observer、manifest、rollback、GitHub notification 与 Operations Workflow 测试通过；受影响 CI 通过
- 审查：PR #164、#165、#174、#175 的 CI 与受影响检查通过
- 合并 / 推送 / 部署：已完成；Ops 当前版本以 Cloudflare 控制面为准
- 实际流程验收：已完成；30 分钟 observe session、R2 summary、GitHub Issue comment、healthy_reported 和 rollback_blocked 均已实测
- 协调者 / 执行者 / 审查者 / 集成者：主会话（OMP）顺序协调
- 允许修改的路径：`docs/development/agent-workflow.md`、`local-release.md`、`cloudflare-operations.md`、`cloudflare-governance.md`、`cloudflare-resource-registry.md`、本任务记录与索引

## 已实现

- `OperationsWorkflow` 支持 `kind: observe`，固定 t=0/5/10/15/20/25/30 七个轮询点。
- `release-observation.mjs` 生成并校验单一 manifest，依据 migration、secret、binding、external side effect 与 previous version 推导 `rollback_allowed`。
- Observer 写入 `reports/observer/<release_id>/events/`、`poll-0..6.json` 与 `summary.json`，报告做敏感字段过滤。
- severity 阈值、状态机和 GitHub 长驻 Issue `codepi release observations`（label `codepi-release-observations`）已实现，event_id 用于幂等。
- `rollback-worker.mjs` 在回滚前核对 active 版本及 100% 流量，使用 percentage deployment 后回读校验，禁止 force。
- `provision-ops.mjs rollback-credential` 预留独立 `CLOUDFLARE_ROLLBACK_TOKEN`，仅 Workers Scripts Write。

## 本地与线上验证

- 已实现并测试通过：Observer、manifest、rollback、GitHub notification 与 Operations Workflow 的本地合成测试。
- 线上证据：`release-c97ae7a7fa7b-uafix` 7 轮观察完成，状态 `healthy_reported`；R2 summary 已写入；Issue #169 收到开始、critical/blocked 历史事件和完成评论。后续 `release-805af3fc3a6f-namesfix` 的通知显示 `services: ops`。
- 生产巡检和备份：`reports/monitor/latest.json` 为 `ok=true`；`reports/backup/latest.json` 为 9 个 D1、114 个 GU/Me 原件对象、`ok=true`、`r2=complete`。

## 未执行项

1. **Orca automation**：当前 PR Supervisor 已配置为每 5 分钟扫描超过 10 分钟且没有 review/comment 的 open PR；发布后自动触发 observe session 的完整自动化仍未接入。
2. **真实安全回滚演练**：本轮验证了 `rollback_blocked` 安全门，没有执行真正的自动切回；需要独立的无迁移、无 secret、无不可逆副作用测试发布。
3. **用户确认**：浏览器与真实 MCP 授权已由本地验收完成；真实邮件 OTP、Oura 重授权和实际客户端重连仍需所有者操作。
