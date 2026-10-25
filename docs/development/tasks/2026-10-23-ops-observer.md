# Ops Observer 正式工作流

- 状态：已实现并完成线上验收；自动化接入和真实安全回滚演练仍未完成
- 目标与验收：将发布后 Ops Observer 纳入五角色流水线，明确单一 release manifest、30 分钟观察、R2 报告、GitHub Issue 通知、severity 与自动回滚安全门；文档相对链接正确且不记录凭证值。
- 不在范围内：不改业务代码、Cloudflare 远程资源、生产凭证、OAuth 或发布配置。
- worktree / 分支：第七至十九轮候选依次叠加为 `codex/round19-final`，2026-10-25 fast-forward 合并 main；旧候选分支与 worktree 已清理
- 起始 SHA / 审查基线：`436c19b7e85ee67c56b8c13a4e45b9a3441a520b`
- 当前交付 SHA：见 main 上的第十九轮提交；第十八轮为 `ea0f1b1dd7adfe4da563131c8e5dba532166085f`
- 实施：第七至十七轮见前次记录。第十九轮新增 GZH 审核/进箱/撤回/改名 compare-and-swap 与原子批写、Project 卡片按未完成任务查询及任务同步只按完整目录清理。第十八轮新增 observe manifest 运行时校验、Health sync window 覆盖查询索引、GU 材料内容哈希对象键、GU OTP 发送重入保护、Health probe 仅允许 GET
- 本地验证：`check.mjs --base f5f19b1 --run` 23 项全部通过；GU 265、Health API 130、Cloudflare 181 项测试通过；GU 实际浏览器连续点击只产生 1 次 OTP 请求并进入冷却；migration guard 29 个文件通过
- 审查：第十八轮 diff 已审查；主 checkout 未提交改动未被覆盖，真实生产发布和线上观察未执行
- 合并 / 推送 / 部署：2026-10-25 从干净 main `7d0c81416a61601123fcde87d140b4980fb21105` 串行发布全部十个 Worker 并验收通过。版本：auth `e836432d`、web `9e8e3a5f`、gu `23a2ec39`、gzh `72aef8c2`、project `5f0ee11d`、me `5a63efaa`、health-api `ec64a674`（前 `fba6218b`）、health-web `7c2a2a8f`、mcp `dead5910`、ops `f7a53d5f`。Health D1 应用索引迁移 `0013_daily_cache_user_day`、`0014_sync_window_lookup`；无 secret/binding 变更。生产巡检含版本核对全部通过。观察 `release-7d0c81416a61-round19`（实例 `cf_bfa4192b4af2c7ab9f8ae886e97281980bc2496901ef83efbb6551b67e13a98a`）七轮完成，R2 summary 为 `healthy_reported`、无回滚，于 2026-10-25T03:57:10Z 完成；Issue #169 开始与完成通知已核对。Health API 因迁移推导 `rollback_allowed=false`，其余服务为 true。
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
- 第六轮线上证据：`release-08bdfeded196-sixth-round` 覆盖 Health API `fba6218b`、GU `e20349c5`、MCP `986e55e2`、Ops `5afd53b5`；七轮完成，R2 summary 为 `healthy_reported`、无回滚；实例于 2026-10-24T10:47:20Z 完成。Issue #169 通知因本机 `gh` 认证失效未复核。 Issue #169 开始与完成通知已于 2026-10-25 复核。
- 第七轮候选风险：Health 读路径改为并行查询并复用窗口结果，需线上观察 D1 访问与同步状态；GZH 失败邮件路径保留限流记录但作废本次 OTP；Me smoke 默认端口改为随机，显式 `ME_SMOKE_PORT` 仍可固定；Ops scope 扩大后会让相关脚本变更触发 Ops 发布。

## 第五轮修复

- `errorRate` 缺失且存在调用计数时，由 `errors / invocations` 推导；真实有限比率优先，保留低流量阈值。
- GitHub Issue 和 comments 按最新顺序有界分页，避免超过 100 条后幂等检查失效；degraded/critical 使用逐轮稳定事件 ID。
- rollback step 使用共享 `STEP` 有界重试；响应失败后独立读取 active version，已切回 previous version 的服务不再误报为失败。
- `observer` 与 `operations` 共同使用 `step-options.mjs`，避免 ESM 循环依赖。
- CLI 变更触发 MCP CI；Health 不再重复构建；公开 GitHub Release 备份通道在现行索引中明确退役。

## 第六轮修复

- PR #190（`e88f1a3`）：Health `aggregatePeriod` 多 metric 改为单次 D1 batch；GU 指纹资产使用 `private, max-age=31536000, immutable`，HTML/API/404 保持 `no-store`；`packages/shared/mcp` 变更纳入 Web `BlogMcp` 检查；MCP deadline 测试改用 mock timers；GitHub 通知请求增加 30s 超时、`redirect: manual` 与错误详情上限。
- PR #191（`08bdfed`）：恢复 Health `deploy-api.mjs` 中被 PR #186 删除的 `installedCrons` 定义，并修正切流后失败的提示与回滚命令。
- 线上验收：`check:api`、GU `check-pages`、MCP `check:live` 和生产巡检全部通过。
- 发布注意：Ops/MCP 巡检按累计改动判定漂移；只改测试的 MCP 也需随 shared 改动重发以消除版本漂移告警。

## 未执行项

1. **Orca automation**：当前 PR Supervisor 已配置为每 5 分钟扫描超过 10 分钟且没有 review/comment 的 open PR；发布后自动触发 observe session 的完整自动化仍未接入。
2. **真实安全回滚演练**：本轮验证了 `rollback_blocked` 安全门，没有执行真正的自动切回；需要独立的无迁移、无 secret、无不可逆副作用测试发布。
3. **用户确认**：浏览器与真实 MCP 授权已由本地验收完成；真实邮件 OTP、Oura 重授权和实际客户端重连仍需所有者操作。
