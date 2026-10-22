# Ops Observer 正式工作流

- 状态：已实现，文档协议待交付；线上验收未执行
- 目标与验收：将发布后 Ops Observer 纳入五角色流水线，明确单一 release manifest、30 分钟观察、R2 报告、GitHub Issue 通知、severity 与自动回滚安全门；文档相对链接正确且不记录凭证值。
- 不在范围内：不改业务代码、Cloudflare 远程资源、生产凭证、OAuth 或发布配置。
- worktree / 分支：`~/.worktrees/kdp.cool/obs/docs` / `obs/docs`
- 起始 SHA / 审查基线：`436c19b7e85ee67c56b8c13a4e45b9a3441a520b`
- 当前交付 SHA：由协调者在文档审查后提交
- 实施：已完成（Observer 实现已存在；本任务更新正式流程文档）
- 本地验证：Observer 单元/集成测试已通过（基线实现交付记录）；本任务未重复运行代码检查
- 审查：未执行
- 合并 / 推送 / 部署：未执行
- 实际流程验收：未执行；需线上确认 observe session、R2 summary、Issue comment 与回滚阻断/核验
- 协调者 / 执行者 / 审查者 / 集成者：由 Orca main workspace 任务记录维护
- 允许修改的路径：`docs/development/agent-workflow.md`、`local-release.md`、`cloudflare-operations.md`、`cloudflare-governance.md`、`cloudflare-resource-registry.md`、本任务记录与索引

## 已实现

- `OperationsWorkflow` 支持 `kind: observe`，固定 t=0/5/10/15/20/25/30 七个轮询点。
- `release-observation.mjs` 生成并校验单一 manifest，依据 migration、secret、binding、external side effect 与 previous version 推导 `rollback_allowed`。
- Observer 写入 `reports/observer/<release_id>/events/`、`poll-0..6.json` 与 `summary.json`，报告做敏感字段过滤。
- severity 阈值、状态机和 GitHub 长驻 Issue `codepi release observations`（label `codepi-release-observations`）已实现，event_id 用于幂等。
- `rollback-worker.mjs` 在回滚前核对 active 版本及 100% 流量，使用 percentage deployment 后回读校验，禁止 force。
- `provision-ops.mjs rollback-credential` 预留独立 `CLOUDFLARE_ROLLBACK_TOKEN`，仅 Workers Scripts Write。

## 本地验证

- 已实现并测试通过：Observer、manifest、rollback、GitHub notification 与 Operations Workflow 的本地合成测试。
- 本任务只改文档，未执行远程命令；线上状态、真实凭证和用户确认不由本地测试推出。

## 未执行项

1. **凭证创建**：需在获授权、干净且等于实时 `main` 的发布环境运行 `node scripts/cloudflare/provision-ops.mjs rollback-credential`；不在任务记录保存 token 值。
2. **Orca automation**：需由协调者接入 PR reference、head SHA 重新审查、发布后自动触发 observe session 的自动化。
3. **线上验收**：需在一次真实 smoke 通过的发布后触发观察，读取 R2 `summary.json`，确认 GitHub Issue comment、健康结论和严重故障回滚安全门；线上正常后由用户确认。
