# 第三轮五次工程优化

- 状态：已交付；代码、CI、生产发布和 30 分钟观察均完成
- 合并 SHA：`b72329e13460289b176655265b077dfbc9d73b1c`

## 五轮改动

1. **Oura 恢复链**：保留 401/403/429 原始错误分类，401 触发 token refresh，429 进入 rate-limit backoff；刷新 token 持久化复用 D1 retry。
2. **GZH OTP 边界**：verify-otp attempts 改为原子 UPDATE reservation，防止并发猜测绕过 5 次上限。
3. **Observer 自动回滚闭环**：rollback_pending 接入 rollback-worker，按 critical 服务执行真实 previous version 回滚，独立 active version 复核后进入 rollback_verified；失败进入 rollback_blocked，不再永久 pending。
4. **备份恢复完整性**：恢复 D1 必须覆盖 manifest `through` 之前的所有原件索引；缺行 fail-closed，不再 false-pass；through 后新增原件仍允许。
5. **CI 治理**：docs/development、agent/skill/rules、根治理文件改动触发 PR platform validation，并新增反向映射回归。

## 验证

- Focused tests、GZH auth 10 tests、Health API unit 70、Health integration 125 全部通过。
- Observer 33 tests 通过，覆盖真实 rollback 成功、worker 失败、校验失败与终态。
- Restore originals/GU materials 12 tests 通过，缺行失败与新原件允许场景均覆盖。
- `node scripts/agent/check.mjs --base origin/main --run`：41 selected checks 通过。
- PR #184 CI 全部通过。
- 生产发布：Health API `9758d6c3`、GZH `93858b97`、MCP `70879027`、Ops `cb157778`。
- 生产 smoke 和完整生产巡检通过。
- Observer：7 轮完成，状态 `healthy_reported`；manifest `rollback_allowed=true`。

## 剩余风险

- 自动回滚逻辑已上线，但本轮未人为制造生产故障做真实切回演练；真实回滚只在受控/真实故障场景验证。
- 真实客户端重连、邮件 OTP、Oura 重授权仍需所有者场景验收。
- 本机共享 checkout 仍保留用户工作区状态，未由 agent 覆盖或清理。
