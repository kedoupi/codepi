# packages/shared 严格白名单 + 退役代码清理

- 状态：实现、独立审查、本地与 PR CI 验证完成；PR #56 已合并为 `158484c`，
  自动生产发布与匿名 smoke 完成；真实账号/Oura 授权完整 E2E 未执行。
- 目标：把 `packages/shared` 的 `exports` 从"显式映射 + `./*` 兜底"收紧为严格白名单，
  并删除无消费者的退役工具站遗留代码。
- worktree：`~/.worktrees/kdp.cool/codex/shared-strict-exports`，基线 `e11f5d8`（main）。
- 协调者 / 唯一写入者 / 集成者：父会话；独立审查者 Cicero 只读。

## 调查发现

- `packages/shared/lib/`（amortization/charts/federal-tax/income-tax/mortgage/paycheck/
  skill-builder-url-state/url-state + 测试）与 `components/CalculatorShell.astro` 是退役
  工具站（calc 等）遗留。逐一核对：gu 用的是自己的 `apps/gu/web/src/charts.ts`，
  oura smoke 的 "charts" 是 UI 断言文本；这些文件除彼此和各自测试外**零运行消费者**，
  仅出现在历史文档与 `check.test.mjs` 的退役路径 fixture（`calc/src/lib/mortgage.js`）中。
- 外部实际消费 9 个子路径 + shared 内部 `BaseLayout.astro` 自引用 2 个
  （i18n/config.js、styles/site.css），合并去重即白名单。

## 改动

- 删除 `packages/shared/lib/`（15 个文件）与 `packages/shared/components/CalculatorShell.astro`。
- `packages/shared/package.json` 删除 `./*` 兜底，仅保留 12 条显式映射（严格白名单）。
- `scripts/agent/check.mjs` 的 staticOnly 移除已删的 `lib/`、`components/`。
- `scripts/agent/check.test.mjs` 的 static fixture 由已删的 `lib/url-state.js`
  改为仍存在的 `i18n/config.js`；`calc/src/lib/mortgage.js` 退役路径 fixture 保留。
- 更新根与 shared 的 AGENTS、README 和架构文档，使共享入口与已删除目录的说明
  对应实际代码；纠正 Health 服务端已使用 Hono 的旧表述，目前仍是自有路由。

## 验证证据

- 严格化后：映射路径正常解析；未映射的 `@kedoupi/shared/products.ts`（带后缀变体）
  正确报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，证白名单生效。
- 终扫：源码/配置中无 `shared/lib/` 或 `CalculatorShell` 引用（除退役 fixture 与历史文档）。
- `scripts/agent/check.test.mjs`：22 项通过。
- `node scripts/agent/check.mjs --base e11f5d8 --run`：五应用测试/typecheck/build、
  shared auth 10 项全部通过；Health 浏览器回归中 `exhausted score retries must not become
  an infinite Cron loop` 一项失败——**已确认在干净 main（e11f5d8）上同样失败**。
- Cicero 独立审查未发现阻塞：84 次白名单解析成功、35 次未导出路径正确拒绝，
  退役代码无现行消费者。
- PR #56 CI run `38961461033` 的 Health 浏览器步骤也失败，评分断言实际为 `—`、
  预期为 `91`；此前 PR #54 的成功不能代替本次 CI 证据，因此暂不合并。

## 遗留

- 两项 Health 失败已在 PR #57 独立定位和修复：夹具模拟事件错误地跨过每日 09:00
  门禁，以及进度完成与评分 DOM 就绪之间的加载竞态。先前“仅本地环境差异”的判断
  已被新证据修正。详见 [故障与验证记录](2026-10-17-health-browser-stability.md)；
  该文件随前置 PR 合并后在主干可用。
- 前置 PR #57 已合并为 `610e2d6`，使用普通 merge 更新本分支，无冲突。

## 组合验证与合并

- 最终任务 SHA：`3e03299b4bb3b2a4bb7a70ffe0c1e8e6fabceeea`；
  审查基线：`610e2d63cadf7f0b16ce208f4e0cfa50e474377d`。
- Cicero 对最终 SHA 放行，确认 19 个非 Markdown 路径的完整补丁与原审查补丁
  逐字节一致，无意外代码变化；文档增量发现的 README 遗漏已修正。
- `node scripts/agent/check.mjs --base 610e2d6 --run`：21 项全部通过，涵盖
  web/auth/GU/GZH/Health 的测试、类型检查与构建，Health 正常/SSO 浏览器回归、
  shared auth 10 项与工作流脚本 22 项。
- 在七个消费上下文再次验证：84 次白名单解析成功，35 次内部路径导入正确报
  `ERR_PACKAGE_PATH_NOT_EXPORTED`。`git diff --check` 通过。
- PR CI run `38965920812` 成功；PR #56 squash 合并为
  `158484cc16a78c779afc11fb8a6af24362f499de`。
- main 自动发布 run `38966431148` 为 `completed/success`，六个部署 job 全部成功。

## 生产发布与线上核验（2026-10-17，Asia/Shanghai）

- 发布来源：`158484cc16a78c779afc11fb8a6af24362f499de`，对应
  [Actions run 38966431148](https://github.com/kedoupi/codepi/actions/runs/38966431148)；
  run 于上海时间 05:05:36 完成。
- Cloudflare API 复核四个 Pages canonical deployment：均为 production、
  `success`、上述完整 source SHA，且 `commit_dirty=false`。

| Pages 项目 | deployment ID |
| --- | --- |
| `codepi-www` | `f76a1341-dda5-4664-8d20-1806638801d3` |
| `codepi-gu` | `f9153889-df5f-488c-b25b-ec2745ccbec9` |
| `codepi-gzh` | `2f49decf-f757-4dec-8291-0af94948d95f` |
| `codepi-health` | `226d4462-beac-46e4-a370-b6130b10c981` |

| Worker | deployment ID | version ID | 流量 |
| --- | --- | --- | --- |
| `codepi-auth` | `8f291e98-9406-4e02-b25a-e045f30cd12e` | `f6ec96c5-a8f0-4f72-937e-525736ebc2d4` | 100% |
| `codepi-health-api` | `1da0c4be-c546-464e-82a2-6b0571a664e3` | `e05337c9-0a33-4e67-978e-463ace4c650e` | 100% |

- `scripts/cloudflare/check-pages.mjs` 的 web、gu、gzh production 检查全部通过；
  `www.codepi.app` 返回 200；Auth `/api/health` 返回 200，
  `mailConfigured=true`。配置就绪不等于真实邮件投递已验收。
- 在仓库根目录运行
  `OURA_EXPECT_BUILD=158484cc16a7 OURA_EXPECT_SSO_ENABLED=true node apps/oura/scripts/check-api.mjs`：
  16 项全部 PASS，退出码 0。覆盖 build、SSO 登录跳转、匿名私有 API 拒绝、
  MCP challenge 与两个 OAuth discovery 端点。
- Health API 报告 `build=158484cc16a7`；Auth 没有 `BUILD_SHA` binding，
  本次记录其控制面 deployment/version 与成功发布 run，不声称 Auth 运行时返回了 source SHA。
- 未执行真实账号登录/callback/退出、真实邮件投递、Oura 提供方授权与真实 MCP 客户端
  授权 E2E；匿名 smoke 和本地 synthetic 浏览器回归不能替代这些验收。

## 收尾边界

- 发布证据在 `codex/shared-release-evidence` worktree 归档，仅修改任务记录与资源登记表。
- `codex/health-test-stability`（`b2bf5b3`）和 `codex/shared-strict-exports`
  （`3e03299`）分别由 PR #57、#56 squash 保留；清理前另核对累计补丁与未交付文件。
- 下一项为 Svelte/Hono 统一方案讨论；尚未实施技术栈迁移。
