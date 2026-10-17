# GZH 前端 Svelte 迁移

- 状态：实现、本地验证、CDP 浏览器冒烟完成；独立审查、PR CI、合并与线上核验待进行。
- 目标与验收：把 `apps/gzh/web` 从 951 行 vanilla TS（手工 innerHTML + 事件绑定）迁移到 Svelte 5（runes）+ Vite，与 `apps/gu/web`、`apps/oura/apps/web` 结构对齐；保持界面、会话生命周期、看板 / 预览 / 审核流程、演示稿操作、阅读闸（read-gate）与文稿语义。
- 不在范围内：业务规则、D1 schema、共享认证协议、Pages 部署载体、worker 路由、`preview-session.ts` 静态预览探针、其他应用迁移。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/gzh-svelte-frontend`
- 分支：`codex/gzh-svelte-frontend`
- 起始 SHA / 审查基线：`13d31e432e7029ef6eec7761d09b179d8295e7f6`，开工时本地工作区干净，远程 main 经 `git ls-remote` 核对相同。
- 协调者 / 实施者 / 集成者：本任务 Codex；审查者为独立 Codex subagent（只读冻结工作区）。
- 唯一分配记录：本文，由本任务 Codex 维护。
- 允许写入：`apps/gzh/`、`pnpm-lock.yaml`、本文；共享文件仅本任务写入，无并行代码写入者。
- 相关设计：[工程架构与部署模型](../../architecture/workspace-and-deployment.md)、GU 迁移记录 `2026-10-17-gu-svelte-frontend.md`。

## 实现

- `web/src/main.ts` 只负责清空 `#app` 启动占位并 `mount(App)`；`App.svelte` 承载路由（`/login`、`/`、`/p/<slug>`）、会话引导、30s/focus/pageshow 会话检查、会话过期清理（等价旧 `clearPrivateView`）。
- 组件：`Masthead.svelte`（含退出）、`Login.svelte`（SSO + dev OTP 两种形态）、`Desk.svelte`（日期看板 + 待审队列）、`Preview.svelte`（成稿预览 + 审核 dock + read-gate）、`ComposeForm.svelte`（交稿 / 改稿）、`DemoTools.svelte`（演示稿操作）、`TwoTapButton.svelte`（两段式确认）。
- `lib/`：`state.svelte.ts`（route/account 全局状态）、`router.svelte.ts`、`toast.ts`（toast / 跨跳转 flash）；`api.ts`、`session.ts`、`preview-embed.ts`、`read-gate.ts`、`format.ts` 原样复用，不改鉴权、消毒、阅读闸或文稿语义。
- 行为保持：401 / `authenticated:false` 清空私有视图并回 `/login?next=…`；`/api/auth/*` 4xx 是表单错误不过期；预览页同源 HTML 内联进 Shadow DOM（消毒 + 样式表白名单），跨源回退 sandboxed iframe 并自适应高度；read-gate 在 inline/iframe 两种模式下分别用 IntersectionObserver+scroll 与 iframe 内部 scroll 解锁审核钮，空预览直接解锁；`read-progress` 进度条随窗口滚动更新；两段式确认用于拒 / 撤回 / 转正式 / 撤演示；键盘 ←/→ 换日（输入框聚焦时不抢）；日期导航仍用 `location.search` 整页跳转。
- `Login.svelte` 的发送验证码按钮保留 `id="send"`（静态预览探针与冒烟依赖）。
- 依赖：新增 `svelte@^5.38.6`、`@sveltejs/vite-plugin-svelte@^5.1.1`、`svelte-check@^4.3.1`、`@testing-library/svelte@^5.2.8`、`jsdom@^26.1.0`；`vite` 从 `^7.1.5` 降到 `^6.0.7`（插件 peer 范围，与 GU / oura workspace 统一）。根锁文件相应更新。

## 验证证据

- 原 DOM-stub `web/test/session.test.ts` 全部改写为真实 jsdom 渲染（`@testing-library/svelte` + `web/test/helpers.ts`）：SSO 登录页、OTP 表单、401 / `authenticated:false` 过期、503 保留、focus/pageshow/30s 三种检查触发、在途 board 响应失效、退出失败保留 + 成功清空、回调错误页只查一次 health，场景与旧断言一一对应。
- 新增 `web/test/migration-regressions.test.ts`：`.boot` 占位清除、OTP 发送 + 6 位自动登录全旅程、看板渲染 + 日期导航、预览页两段式撤回。
- `vitest.config.ts` 拆 `worker`（`@cloudflare/vitest-pool-workers` 不动）与 `web`（jsdom + svelte 插件 + `resolve.conditions:["browser"]`）双 project；`web/test/preview-session.test.ts`（不依赖 DOM 的 documentElement stub）保持在 web project 通过。
- GZH `npm test` 11 文件 87 项通过；`npm run typecheck`（tsc ×2 + svelte-check）0 错误；`npm run build` 通过（vite 6.4.4）。
- 新增 `scripts/browser-smoke.mjs`：CDP 无头 Chrome 走真实 `wrangler pages dev`（ENVIRONMENT=development, SSO_ENABLED=0，先本地 D1 migrate），覆盖 登录页 → dev OTP → 看板 → 退出，断言零控制台错误 / 异常，本地已通过。
- 全仓 `node scripts/agent/check.mjs --base 13d31e4… --run`：23 项全部通过。
- 未覆盖：真实 SSO 登录跳转（本地 AUTH 绑定未连接）、真实邮件投递、UI 视觉对照（需人工 dev server 验收）。

## PR 与自动发布（回填）

## 生产版本与线上核验（回填）

## 继续工作（回填）
