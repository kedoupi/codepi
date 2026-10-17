# GU 前端 Svelte 迁移

- 状态：实现、本地验证、两轮独立审查、PR CI、合并、自动生产发布及匿名线上核验完成；真实账号 E2E 未执行。
- 目标与验收：把 `apps/gu/web` 从 820 行 vanilla TS（手工 innerHTML + 事件绑定）迁移到 Svelte 5（runes）+ Vite，与 `apps/oura/apps/web` 结构对齐；保持界面、会话、路由、图表联动和金额 / 时间语义；完成受影响检查、真实 jsdom 测试、CDP 浏览器冒烟和独立审查。
- 不在范围内：业务规则、D1 schema、共享认证协议、Pages 部署载体、其他应用迁移。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/gu-svelte-frontend`（已随任务清理）。
- 分支：`codex/gu-svelte-frontend`
- 起始 SHA / 审查基线：`ccb930fbf08b97efa96be0ed2379c4182e9e5d8b`，开工时本地工作区干净，远程 main 经 `git ls-remote` 核对相同。
- 当前代码交付：PR #61 head `ec80592e9028bb15b4a80c41891ef2b221bee4f2`，squash 合并为 `751a20491ac63fae0feb6812569e4afc25572915`；两个提交的完整 Git tree 一致（`git diff` 为空）。
- 发布证据 worktree / 分支：`/Users/codepi/.worktrees/kdp.cool/codex/gu-svelte-evidence` / `codex/gu-svelte-evidence`，基线为上述合并 SHA，仅回填本文。
- 协调者 / 实施者 / 集成者：本任务 Codex；审查者 Hypatia 为独立 Codex subagent，只读同一冻结工作区，无写入权限。
- 唯一分配记录：本文，由本任务 Codex 维护。
- 允许写入：`apps/gu/`、`pnpm-lock.yaml`、架构文档和本文；共享文件仅本任务写入，无并行代码写入者。
- 相关设计：[工程架构与部署模型](../../architecture/workspace-and-deployment.md)。

## 实现

- `web/src/main.ts` 只负责清空 `.boot` 占位并 `mount(App)`；`App.svelte` 承载 chrome（侧栏 / 顶栏 / 提示条 / 页脚）、hash 路由、会话引导、刷新 / 退出 / 会话检查。
- `components/`：`Login.svelte`（SSO + dev OTP 两种形态）、`Overview.svelte`、`Positions.svelte`、`Reports.svelte`、`Status.svelte`；`lib/` 提供 `state.svelte.ts`（会话 / 批次全局状态）、`api.ts`（统一 fetch 边界）、`router.svelte.ts`、`format.ts`、`focus.ts`。
- 行为保持：401（含 `/api/me` 声明未登录）清空快照并回登录页；`/api/auth/*` 的 4xx 是表单错误，不触发会话清理（否则 OTP 登录表单被卸载）。`loadVersion` 并发哨兵、退出后丢弃在途响应、报告深链 `#reports/<id>` 重新登录后恢复、图表→持仓 6 秒高亮 + 600ms 淡出均逐项保留。
- `action.ts` 的 `use:chartStyles` 使用 MutationObserver 监听子树变化，在 `{@html}` 图表内容被新批次替换后重新经 CSSOM 应用 `data-*` 几何（CSP `style-src 'self'` 不允许内联 style；Svelte 不会因 `{@html}` 内容替换触发 action update）。
- `charts.ts weightHistory` 不再自带记录选择器；Overview 组件的 `#history-date` / `#history-detail` 是唯一控件，选择存 `filters.selectedHistory` 跨页保留，消除隐藏活控件与重复 ID。
- 图表 / 报告 / markdown / 格式化 / 风险 / 诊断 / 日历生成器原样复用，不改金额、盈亏、权重口径或行情时间语义。
- 依赖：新增 `svelte@^5.38.6`（锁 5.57.2）、`@sveltejs/vite-plugin-svelte@^5.1.1`、`svelte-check@^4.3.1`、`@testing-library/svelte@^5.2.8`、`jsdom@^26.1.0`；`vite` 从 `^7.1.5` 降到 `^6.0.7`（插件 peer 范围且与 oura workspace 统一）。根锁文件相应更新。

## 验证证据

- 原 DOM-stub 测试全部改为真实 jsdom 渲染（`@testing-library/svelte`）：`session`、`render-memo`、`linkage-flow`、`position-linkage` 四组场景与旧断言一一对应（SSO/OTP、401 清空、缓存批次故障恢复、刷新去重、深链恢复、联动高亮计时）。jsdom 中 Svelte 的 `onsubmit` 不响应 `requestSubmit()`，测试改用派发 `SubmitEvent`。
- 新增 `web/test/helpers.ts` 与 `migration-regressions.test.ts`：单一记录选择器更新并跨刷新持久、新批次替换图表后几何重新应用、`.boot` 占位被移除。
- `vitest.config.ts` 拆成 `worker`（cloudflare 池，原 app 测试不动）与 `web`（jsdom + svelte 插件，`resolve.conditions: ["browser"]`）两个 project。
- 新增 `scripts/browser-smoke.mjs`：CDP 无头 Chrome 走真实 `wrangler pages dev`（ENVIRONMENT=development, SSO_ENABLED=0，先本地 D1 migrate + seed），OTP 旅程 登录→dev 验证码→总览→四页 hash 导航→退出，断言零控制台错误 / 异常，并校验页面标记与 nav `aria-current`。
- GU `npm test` 15 文件 207 项通过；`npm run typecheck`（含 svelte-check）0 错误；`npm run build` 通过。
- 全仓 `node scripts/agent/check.mjs --base ccb930f… --run`：23 项全部通过（GU 测试 / typecheck / build / check:deploy + GZH / oura / shared 回归）。
- Hypatia 两轮独立审查：第一轮提出 3 个 P2 + 1 个 P3（双选择器、几何不随刷新重放、boot 占位未清、冒烟断言误报），全部修复并加回归测试；第二轮确认全部已修复、无阻塞发现，结论绑定 head `39bbd2e`；其后仅追加测试强化 commit `ec80592`（测试数据变化 + EOF 修剪，低风险）。
- 未覆盖：真实 SSO 登录跳转（本地 AUTH 绑定未连接）、UI 视觉对照（需人工 dev server 验收）。

## PR 与自动发布

- PR #61 的两个 head workflows 均为 `completed/success`：
  - 平台 CI：`38997718631`（affected / governance / www / gzh / auth / gu / health build 全 success，6 个 deploy job 按 PR 惯例 skipped）。
  - SSO/GU 专项：`38997718644`（validate apps/gu、validate services/auth 全 success）。
- 合并前核对 PR head 仍为 `ec80592e9028bb15b4a80c41891ef2b221bee4f2`，合并 API 使用完整 expected head SHA；squash 合并为 `751a20491ac63fae0feb6812569e4afc25572915`。
- main 自动发布 run：`38998146196`，`completed/success`，2026-10-17 11:20:19（上海时间）完成；validate run `38998146291` 亦 success。根锁文件变更触发全部产品重发，属预期。

## 生产版本与线上核验（2026-10-17）

Cloudflare API 核对四个 Pages canonical deployment：均为 production、完整 source SHA `751a20491ac63fae0feb6812569e4afc25572915` 且 `commit_dirty=false`。

| Pages 项目 | deployment ID |
| --- | --- |
| `codepi-www` | `48c620e2-86d6-44bc-bb7d-85c4279ddffb` |
| `codepi-gu` | `423f76ad-9c3c-4a1d-a10b-7af6fe701968` |
| `codepi-gzh` | `bcf4a4ad-e929-40b1-8113-72520fc0b5f2` |
| `codepi-health` | `ade2ee72-2e52-420f-be97-aaacb2d92404` |

- 在重装依赖后重新构建的本地产物上执行 GU `npm run check:deploy -- --url https://gu.codepi.app`：config / health / auth 全部通过，2 个线上 JS/CSS 资源与本地 build 一致（`/assets/index-L8jSaS6_.js`、`/assets/index-BbNBdaMt.css`）；`index_sha256=cec5bebce1e01bdbf60cb1e88ff3d1d2b04a49b4271ce9034e3dcd0448ddba22`。
- `node scripts/cloudflare/check-pages.mjs <web|gu|gzh> production` 三项通过；Auth `/api/health` 返回 200、`ok=true`、`mailConfigured=true`。配置就绪不等于真实投递成功。
- `OURA_EXPECT_BUILD=751a20491ac6 node apps/oura/scripts/check-api.mjs`：16 项全部通过；Health `/api/health` 返回 `build=751a20491ac6`（发布脚本把 `BUILD_SHA` 截为 GITHUB_SHA 前 12 位）。
- 注意：在主 checkout 合并后首次直接跑 check:deploy 会因本地依赖 / dist 陈旧而报 JS 哈希不一致；须先根目录 `pnpm install` 再 `npm run build`，之后与线上逐字节一致。
- 以上为匿名运行时证据，不代表已验收真实邮件、账号登录 / 退出、私人数据读取、Oura 提供方授权或真实 MCP 客户端授权。

## 继续工作

1. GZH / Health / Auth 的同类技术栈迁移另行 PR；Pages → Workers Static Assets 部署载体调整需先确认 `run_worker_first` 鉴权顺序。
2. 真实邮件登录、登录后私人数据及 Oura / MCP 完整授权流程仍需另行验收。
3. 远程功能分支 `codex/gu-svelte-frontend` 待网页端删除（MCP 无删除接口）；本地 worktree 与分支已清理。
