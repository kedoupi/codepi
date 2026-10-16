# packages/shared 严格白名单 + 退役代码清理

- 状态：本地验证完成，待审查、合并与发布。
- 目标：把 `packages/shared` 的 `exports` 从"显式映射 + `./*` 兜底"收紧为严格白名单，
  并删除无消费者的退役工具站遗留代码。
- worktree：`~/.worktrees/kdp.cool/codex/shared-strict-exports`，基线 `e11f5d8`（main）。
- 协调者 / 唯一写入者：父会话；独立审查者另派。

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

## 验证证据

- 严格化后：映射路径正常解析；未映射的 `@kedoupi/shared/products.ts`（带后缀变体）
  正确报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，证白名单生效。
- 终扫：源码/配置中无 `shared/lib/` 或 `CalculatorShell` 引用（除退役 fixture 与历史文档）。
- `scripts/agent/check.test.mjs`：22 项通过。
- `node scripts/agent/check.mjs --base e11f5d8 --run`：五应用测试/typecheck/build、
  shared auth 10 项全部通过；Health 浏览器回归中 `exhausted score retries must not become
  an infinite Cron loop` 一项失败——**已确认在干净 main（e11f5d8）上同样失败**，
  与本改动无关；PR #54（d87a801）CI 的 "Browser regression (normal and SSO)" 步骤为
  success，判为本地环境差异（端口/时序/Chrome），非代码缺陷，需独立跟进。

## 遗留

- 本地 Health 浏览器 Cron 重试断言偶发失败（main 上可复现、CI 通过）：建议作为独立
  环境问题排查（本地 Chrome/端口/时序），不阻塞本次 exports 收尾。
