# packages/shared 严格白名单 + 退役代码清理

- 状态：独立审查通过；PR #56 等待 Health 浏览器测试修复后重新验证，尚未合并。
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
- 待前置 PR 合并后更新本分支、验证组合结果并等待新 CI 成功，再合并和验收自动发布。
