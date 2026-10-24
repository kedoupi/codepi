# Ops Observer 正式工作流

- 状态：已实现并完成线上验收；自动化接入和真实安全回滚演练仍未完成
- 目标与验收：将发布后 Ops Observer 纳入五角色流水线，明确单一 release manifest、30 分钟观察、R2 报告、GitHub Issue 通知、severity 与自动回滚安全门；文档相对链接正确且不记录凭证值。
- 不在范围内：不改业务代码、Cloudflare 远程资源、生产凭证、OAuth 或发布配置。
- worktree / 分支：第七至十八轮候选依次叠加到 `codex/round18-integration`，均未合并 main（`08bdfed`）
- 起始 SHA / 审查基线：`436c19b7e85ee67c56b8c13a4e45b9a3441a520b`
- 当前交付 SHA：第十八轮候选（提交后回填）；尚未合并 main
- 实施：第七至十七轮见前次记录。第十八轮新增 observe manifest 运行时校验、Health sync window 覆盖查询索引、GU 材料内容哈希对象键、GU OTP 发送重入保护、Health probe 仅允许 GET
- 本地验证：`check.mjs --base f5f19b1 --run` 23 项全部通过；GU 265、Health API 130、Cloudflare 181 项测试通过；GU 实际浏览器连续点击只产生 1 次 OTP 请求并进入冷却；migration guard 29 个文件通过
- 审查：第十八轮 diff 已审查；主 checkout 未提交改动未被覆盖，真实生产发布和线上观察未执行
- 合并 / 推送 / 部署：候选分支 `codex/round18-integration` 待推送；GitHub CLI token 无效仍阻塞 PR 创建。主 checkout 的 `main` 为 `1d7e242`、落后 `origin/main` 且有 41 个未提交文件，按要求未执行 `git pull --ff-only`；合并后按 release-scope 发布受影响服务
- 实际流程验收：第五轮 observe session `cf_28eb7d963c4f9b104cc0b71fc7f1e215eda7d09b78cd7aafc911b9159d23e081` 七轮完成，R2 summary 为 `healthy_reported`；Issue #169 开始与完成通知均已核对
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
- 第五轮线上证据：`release-db367df0e71a-fifth-round-ops` 的 active/expected version 七轮一致，无 Issues 或核心检查失败；实例于 2026-10-24T09:30:02Z 完成，完成评论 event ID 为 `release-db367df0e71a-fifth-round-ops-completed`。
- 第七轮候选风险：Health 读路径改为并行查询并复用窗口结果，需线上观察 D1 访问与同步状态；GZH 失败邮件路径保留限流记录但作废本次 OTP；Me smoke 默认端口改为随机，显式 `ME_SMOKE_PORT` 仍可固定；Ops scope 扩大后会让相关脚本变更触发 Ops 发布。

## 第五轮修复

- `errorRate` 缺失且存在调用计数时，由 `errors / invocations` 推导；真实有限比率优先，保留低流量阈值。
- GitHub Issue 和 comments 按最新顺序有界分页，避免超过 100 条后幂等检查失效；degraded/critical 使用逐轮稳定事件 ID。
- rollback step 使用共享 `STEP` 有界重试；响应失败后独立读取 active version，已切回 previous version 的服务不再误报为失败。
- `observer` 与 `operations` 共同使用 `step-options.mjs`，避免 ESM 循环依赖。
- CLI 变更触发 MCP CI；Health 不再重复构建；公开 GitHub Release 备份通道在现行索引中明确退役。

## 未执行项

1. **Orca automation**：当前 PR Supervisor 已配置为每 5 分钟扫描超过 10 分钟且没有 review/comment 的 open PR；发布后自动触发 observe session 的完整自动化仍未接入。
2. **真实安全回滚演练**：本轮验证了 `rollback_blocked` 安全门，没有执行真正的自动切回；需要独立的无迁移、无 secret、无不可逆副作用测试发布。
3. **用户确认**：浏览器与真实 MCP 授权已由本地验收完成；真实邮件 OTP、Oura 重授权和实际客户端重连仍需所有者操作。
