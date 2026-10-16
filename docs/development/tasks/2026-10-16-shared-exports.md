# packages/shared exports 收敛

- 状态：本地验证完成，待审查、合并与发布。
- 目标：把 `packages/shared` 的消费从"alias + 深相对路径 + 裸相对路径"三分裂，
  统一为包名 `@kedoupi/shared/<subpath>` 导入，用 package `exports` 声明可消费边界。
- worktree：`~/.worktrees/kdp.cool/codex/shared-exports`，基线 `f388f7f`（main）。
- 协调者 / 唯一写入者：父会话；独立审查者另派。
- 决策：采用"显式映射 + `./*` 兜底"与"全部应用统一"（用户确认 1A+2A），不改运行行为。

## 改动

- `packages/shared/package.json` 新增 `exports`：brand / products / auth/client /
  auth/schema.sql / desk/contract / email/otp / styles/*.css / layouts/BaseLayout.astro /
  privacy-redirects.js / sitemap-filter.js 显式映射，`./*` 兜底（后续逐步收紧）。
- 六个应用（web/gu/gzh/oura-web/oura-api/auth）`devDependencies` 加
  `@kedoupi/shared: workspace:*`，pnpm 软链到 `packages/shared`。
- JS/TS 与 Svelte/Astro 的 import、`@shared/...` alias、深相对路径全部改为包名导入；
  `.ts` 后缀去除（exports 键无后缀）。
- `packages/shared/layouts/BaseLayout.astro` 内部 `@shared/*` 自引用改为
  `@kedoupi/shared/*`（自引用经 exports）。
- 删除 `apps/web/astro.config.mjs` 的 `@shared` alias 与 `tsconfig.desk-web.json` 的
  paths/baseUrl（pnpm 软链 + bundler resolution 已可解析包名）。
- CSS `@import "@kedoupi/shared/styles/tokens.css"`：Vite 原生支持 bare specifier，实测保留。
- `apps/oura/apps/web/test/theme.test.mjs` 断言由旧相对路径改为包名导入（行为不变）。

## 保持原样（非模块边界）

- `readFile(new URL('.../auth/schema.sql', import.meta.url))`：文件系统读取，exports 不适用。
- `apps/web/tailwind.config.mjs` 的 content glob：文件系统扫描。
- `services/auth/test/email.test.mjs` 的 esbuild entryPoints：文件系统入口。
- `dist/`、`.wrangler/` 内 esbuild 来源注释：构建产物，随重新生成更新。

## 验证证据

- 五应用构建全部成功：web `build:pages`、gu/gzh `vite build + bundle-worker`、oura `build`、
  auth；产物中 `--kdp-canvas` tokens 与 `kedoupi` 品牌正确内联。
- `node scripts/agent/check.mjs --base f388f7f --run`：23 项受影响检查全部通过，
  含五应用测试/typecheck/build、shared auth 10 项、Health 正常 + SSO 浏览器回归、
  移动端 375/390 截图。
- 终扫：除上述文件系统路径与构建产物注释外，无遗留 `@shared/` 或深相对路径模块导入。

## 复杂度与后续

- `.astro` / `.css` / `.sql` 非 JS，exports 仅映射路径，类型/打包仍由各应用
  Vite/Astro 处理（行为不变）。
- 新增共享文件需同步登记 exports（兜底期内不强制，收紧后强制）。
- 后续：逐步移除 `./*` 兜底转为严格白名单；本次不动 `check.mjs` 的路径前缀映射
  （它按文件路径而非依赖图，未受影响）。
