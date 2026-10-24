# 第四轮五次工程优化

- 状态：已交付；代码、CI、生产发布和 30 分钟观察均完成
- 合并 SHA：`13fb4e48e1efc34fdca8e9dbdf308529a6d2d74c`

## 五轮改动

1. **Observer 服务归因**：core failure 按 service/script/name 归因到对应服务，无关服务不因单个 core 失败被累计 critical 或回滚；不可归因的全局失败仅保留诊断。
2. **Observer 终态与部分回滚**：rollback_verified/rollback_blocked 立即停止剩余轮询；summary 包含成功回滚服务/版本、失败服务和滞留 active/expected version，保留全局安全门。
3. **部署证据 CLI**：deploy-worker/domain 支持 previous-version 与四项 evidence facts，输出 script/new_version/new_build_sha；Health source_sha 使用完整 40 位，previous version 校验 UUID。
4. **D1 导入完整性**：d1-restore 先统计解密 SQL 的非内部表和行数，导入后查询目标表覆盖和行数，缺行或表不匹配不再 PASS；不依赖 Wrangler 退出码 alone。
5. **CI 治理**：根 AGENTS.md 改动触发平台验证；scripts/cloudflare 改动不再全量触发所有应用构建，保留 Ops/governance jobs。

## 验证

- Focused tests 54/54。
- `node scripts/agent/check.mjs --base origin/main --run`：41 selected checks 通过。
- Health typecheck/build、Ops build/runtime 通过。
- PR #186 全部 CI 通过。
- 生产发布：Health API `46ae23b8`、MCP `71c3ef9b`、Ops `4332c66d`。
- 生产巡检通过。
- Observer 7 轮完成，状态 `healthy_reported`；manifest `rollback_allowed=true`。

## 剩余风险

- 自动回滚真实故障切回演练仍未执行。
- 本机共享 checkout 仍保留用户工作区状态，未覆盖或清理。
- 真实客户端、邮件 OTP、Oura 重授权需所有者场景验收。
