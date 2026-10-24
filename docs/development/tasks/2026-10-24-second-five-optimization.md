# 第二轮五次工程优化

- 状态：已交付；代码、CI、生产发布和 30 分钟观察均完成
- 交付合并 SHA：`1cee37121befc82bdce350c413dab945724a536d`

## 五轮改动

1. **Oura 同步一致性**：daily 分页超过 8 页现在抛出 `sync_window_too_large`，保留旧 daily cache，不把截断数据标记为新鲜成功。
2. **Project 资源边界**：latest handoff 使用窗口查询，移除相关反连接和无界历史读取，保持最新 row 语义。
3. **Observer 诊断**：active version / observability API 瞬时失败记录诊断字段并降级，不误判版本漂移、误触发回滚或静默 healthy。
4. **发布证据安全**：deploy scripts 不再伪造 migration、secret、binding、external side effect 或空 previous version；facts 必须显式传入且严格校验。
5. **CI 回归护栏**：修改 `deploy-platform.yml` 自身会触发平台验证。

## 验证

- Health focused：20/20。
- Project focused：8/8，typecheck/build 通过。
- Cloudflare focused：21/21。
- Ops Observer：32/32，build 通过。
- 合并后完整 `check.mjs --base 0658fd4 --run`：通过。
- PR #182 全部 CI 通过。
- 生产发布：Health API `aed029ab`、MCP `4d0e9260`、Project `310cbcb0`、Ops `b4c03f03`。
- 发布后生产巡检：通过。
- Observer：7 轮完成，`healthy_reported`；manifest `rollback_allowed=true`，证明发布事实不再被硬编码锁死。

## 剩余风险

- 自动回滚真实切回演练仍未执行；本轮只验证了允许回滚的 manifest 和正常观察路径。
- 共享 checkout 仍未由 agent 切换到远程 main；发布使用独立干净 worktree。
- 真实客户端、邮件 OTP、Oura 重授权仍需所有者场景验收。
