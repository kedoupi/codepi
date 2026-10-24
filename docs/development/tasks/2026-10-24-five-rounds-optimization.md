# 五轮工程优化

- 状态：已交付；代码、CI、生产发布和 30 分钟观察均完成
- 目标：自主发现并修复五类高置信工程问题，覆盖可靠性、性能、监控、发布工作流和治理护栏。
- 基线：`origin/main` `0658fd4`
- 交付：PR #179，合并 SHA `9271c7a34fee237ab2ef801527dd23b42da72668`

## 五轮改动

1. **Observer 可靠性**
   - 持续 degraded 的发布不再在观察结束时误报 `healthy_reported`。
   - 新终态为 `degraded_reported`，summary 与完成通知使用最后一轮真实状态。

2. **Project 性能**
   - 项目列表和摘要移除逐项目串行 D1 查询。
   - handoff、repo activity、sync state、open PR 改为集合查询后内存分组。
   - 保持原响应字段、排序、分页、裁剪和空值语义。

3. **Health 可靠性**
   - 自动同步 cron 的 lease 释放复用 `withD1Retry`。
   - 瞬时 D1 错误重试一次；最终失败只记录 warning，不覆盖主流程异常。

4. **PR/发布工作流安全**
   - GitHub Actions concurrency 使用 PR number，避免跨 fork 同名分支互相取消。
   - `validate-sso.yml` 变更会触发平台验证。
   - Worker/Domain 部署在 D1 创建、迁移和部署前重新校验远程 main，防止检查后主干漂移。

5. **治理与回归护栏**
   - agent lint 增加 Markdown 相对路径和 GitHub anchor 检查，忽略 fenced code 与外链。
   - 修正 Project/Me 产品状态、六产品口径和 Observer/rollback registry 的过时事实。

## 最终复核补充

- 发布后 Observer 7 轮完成，状态 `healthy_reported`；应用、MCP、Health、Web/GU/GZH smoke 全部通过。
- 随后的真实 Cron monitor 发现独立的 zone 请求峰值：最新完整小时 `requests=2829`，阈值 `1000`，因此 monitor 正确保持失败；同期 threats=120 仅为 `advisory`。这不是应用回归，需按流量运营事件处理，未通过调高阈值或吞掉错误来掩盖。
- 该小时的 Cloudflare Analytics 只读复核受当前 CLI token 的 Zone Analytics 权限限制，Ops 自身仍能写出流量报告并执行告警；应用健康检查继续通过。

## 验证
- Observer 测试：6/6。
- Project：46 tests、typecheck、production build 通过。
- Health API：68 tests 通过。
- Deploy domain/workflow：12/12 通过。
- Markdown lint：3/3 回归测试；175 scripts、25 JSON、160 Markdown lint-clean。
- 合并后 `node scripts/agent/check.mjs --base 0658fd4 --run`：通过。
- PR #179：affected、governance、全部应用 build CI 通过。
- 生产发布源：`9271c7a34fee237ab2ef801527dd23b42da72668`。
- 发布服务：Health API、Project、MCP、Ops；其余服务没有受影响业务代码，不重复发布。
- 线上 smoke：Health API build、Project SSO readiness、MCP Auth/discovery/anonymous rejection/login requirement、生产 monitor 全部通过。
- 发布后 Observer：7 轮完成，summary 状态 `healthy_reported`，R2 report 完整。

## 剩余风险

- 真实自动回滚只验证过安全门阻断，未执行生产切回演练。
- 真实邮件 OTP、Oura 重授权、MCP 实际客户端重连仍需所有者在真实客户端中确认。
- 本机共享 checkout 仍可能落后远程 main；发布使用独立干净 worktree，未覆盖共享工作区。
