# MCP 运维补齐

- 状态：本地实现与完整检查通过，按所有者“开始下一步”的授权进入提交、合并和本机发布。
- 目标：MCP D1 纳入加密备份；统一 MCP 的巡检与 SSO secret 配对工具；七个生产 Worker
  对照 main 的按服务代码漂移检测。
- Worktree：`<workspace>/.worktrees/kdp.cool/codex/unified-mcp`，复用已干净的任务 checkout。
- 基线：`777dc4010e2f073ef3e655add4f604004ec03715`，开工时等于实时远程 main。
- 当前 Codex 为唯一写入者、共享脚本负责人和验证者；无并行写入。
- 写入范围：`scripts/cloudflare/`、MCP 发布/验收脚本及其测试、
  `.github/workflows/production-monitor.yml`、对应运维文档。
- 本轮不修改产品数据、认证协议、DNS 或依赖；不执行 secret 轮换或数据恢复。
  下一阶段授权范围为合并本批改动、从干净 main 补发五个缺少 BUILD_SHA 的 Worker，
  并验收生产巡检与六库加密备份。

## 现场证据与决策

- 原备份明确排除了 MCP 授权库。本次按所有者指出的缺口将其纳入现有公钥加密日备，
  并让清单测试对照全部 managed production D1，避免新增库再次漏接。
  通用恢复保护同步覆盖 MCP 生产 UUID；历史授权恢复须先作废 token/会话再切换。
- MCP 已有无副作用的 Auth 凭证配对 readiness，但定时巡检未接入。现在与发布 smoke
  共用一套检查，且部署脚本不能在 smoke 失败后报告成功。
- 新配对工具仅更新两个 MCP secret，随机值只用于两次 API 请求、不输出或写文件。两次 API 写入非原子，
  部分失败必须中止并恢复整对配置；普通发布不调用轮换命令。
- 实际 Cloudflare GET 确认七个 Worker 的活跃 version 均与首发记录一致、100% 流量。
  只有 Health API 和 MCP 有 `BUILD_SHA=767fb0b3d63a`；Auth、Web、GU、GZH、Health 前端缺失。
  本次没有通过手填 metadata 来伪装重新构建，首次启用严格巡检前需要带 SHA 的真实发布。
- main `777dc401` 相比已发布 `767fb0b3` 只有文档改动，不能直接把 SHA 不同视为漏发布。
  版本巡检读取当前承流版本，以其 source 为祖先基线累计所有提交路径（含 revert），
  共享代码保守覆盖消费者，Health 两个 Worker 分开判断。缺历史、权限、SHA、非祖先或
  分流都报告失败。

## 验证

- `node scripts/agent/check.mjs --base 777dc4010e2f073ef3e655add4f604004ec03715 --run`：
  **29/29 通过**，含全部产品/Auth/MCP、shared auth、CF 脚本/治理、lint、
  Health 正常/SSO 浏览器回归和 MCP 桌面/手机授权流程。
  日志 `/tmp/codepi-mcp-operations-checks.log`。
- 后续仅运维脚本与文档补强：版本范围包含 merge-only 改动，忽略纯检查/发布脚本；
  对应真实 Git fixture、备份与 MCP deploy 测试 **15/15 通过**，完整应用检查不受这些改动影响。
- 最终 `node --test scripts/cloudflare/*.test.mjs services/mcp/test/deploy.test.mjs`：
  **89/89 通过**；治理守门、102 个脚本/17 份 JSON 的 lint、`git diff --check` 均通过。
  日志 `/tmp/codepi-mcp-operations-script-tests.log`。
- `node services/mcp/scripts/check-live.mjs`：线上 **5/5 通过**，包含实际凭证配对 readiness、
  两个发现端点、匿名 tools/list 401 与连接管理登录门。
- `node scripts/cloudflare/production-monitor.mjs --require-d1 --require-versions`：
  **17/23 通过，6 项失败**；五项为生产缺 BUILD_SHA，另一个为 Health 最后完整同步距检查
  约 83 小时。Health API/MCP 的源代码与远程 main 一致，文档-only 差异未误报。
  日志 `/tmp/codepi-mcp-operations-live.log`。没有把线上告警改成绿色。
- 已自行审查变更；没有独立 Agent 审查。真实 secret 轮换、MCP 首次备份 artifact、
  定时 runner 恢复、真实 AI 客户端授权和查询未执行，不能据本地测试声称已验收。

## 激活顺序

1. 本地检查和审查完成后，按授权提交/PR 合入 main。
2. 从干净 main 使用带 BUILD_SHA 的命令发布五个缺标记 Worker；MCP 如需发布则自动验收。
3. 执行完整线上巡检，记录每项结果；Health 既有同步新鲜度问题独立处理，不降低门槛。
4. 在 main 执行备份工作流，核对六份密文及 manifest；检查定时任务是否实际取得 runner。
5. 当前配对正常则不轮换 secret。真实 AI 客户端授权和查询仍独立验收。
