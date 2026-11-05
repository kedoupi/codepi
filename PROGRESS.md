# rhythm-history

## 计划

- 调查 Rhythm 状态计算、回看窗口、实时 API、页面时间线与测试约束。
- 实现手机事件区间、旧网络推断、当前状态延迟和时间线绝对定位。
- 更新日汇总口径、文档、fixture、浏览器冒烟与领域测试。
- 运行可用的针对性验证并提交当前分支。

## 已完成

- `worker/state.ts`：新增旧网络 cutoff、36 小时手机事件区间、快照 freshness、心跳证据、pending/null 处理；推断公司分钟参与办公指标、App 构成、键鼠、专注和关键时刻证据。
- `worker/daily.ts`：算法版本升至 `p5-2026-11-05`，App 构成和手机缺口原因复用最终状态/共享手机区间。
- `worker/recompute.ts`：家中数据回看窗口扩大到 `homeLookbackMinutes=2160`，工作机仍为 30 分钟。
- `worker/app.ts` 与 `web/src/App.svelte`：当天当前状态回看 20 分钟并返回/显示 `asOf`。
- `web/src/style.css`：时间线段按分钟绝对定位。
- 更新 README、fixture、领域/Web 测试和浏览器冒烟脚本。

## 当前状态

- 已验证：`bun test --run test/domain`，53 passed；`git diff --check` 通过。
- 全部仓库依赖未安装：`npm`/`tsc` 不在环境中，直接跑全量 Bun 测试缺少 `cloudflare:test` 与 `@testing-library/svelte`；未执行依赖安装（按任务要求需 lead 授权）。
- 尚未提交；下一步为 lead 审阅 diff 后提交本分支。