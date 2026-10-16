# Health 浏览器回归的时间与加载竞态修复

- 状态：修复与本地完整检查完成，待独立审查和 PR CI；未合并、未发布。
- 目标：解除 PR #56 的 Health 回归阻塞，保留原有评分、重试与登录验收要求。
- worktree / 分支：`~/.worktrees/kdp.cool/codex/health-test-stability` /
  `codex/health-test-stability`。
- 起始 SHA：`e11f5d89d48e3c8097e1aaf195a2cdeabc3ffc4a`。
- 协调者 / 唯一写入者 / 集成者：父会话；独立审查者只读。
- 写入范围：`apps/oura/scripts/browser-fixture.mjs`、
  `apps/oura/scripts/browser-smoke.mjs`、本任务记录。无共享契约变更。

## 根因与复现

1. 浏览器夹具将每个模拟 Cron 的事件时间固定为当天上海 09:00，但手动任务按实际
   时间接收。上海凌晨执行时，手动任务没有消费 09:00 的每日门禁；任务结束后的
   模拟 Cron 合法启动每日任务，被测试误报为无限重试。干净 main 上完整回归失败；
   仅 HTTP 驱动真实夹具的最小复现中，终态 `partial` / 3 项 / 11 次请求，在一次
   Cron 后变为 `running` / 239 项 / 12 次请求。
2. 进度 API 和每日评分 API 分别加载。原 permission 场景只等待进度 DOM，立即读取
   评分时可能仍为加载占位符 `—`。新增测试门闩阻塞真实评分响应后，原断言稳定出现
   `— !== 91`，与 PR #56 CI 的失败一致；不是 fixture 丢失评分。

## 修复

- 模拟 Cron 使用 `Date.now()`，与手动任务处于同一时间线。09:00 门禁、跨日、
  重试及未来每日刷新由现有 API 集成测试覆盖；不改生产调度逻辑。
- permission 浏览器场景控制全部每日评分响应的交付，先断言加载占位符，再释放真实
  响应，等待 DOM 显示 `91`。覆盖进度先于评分到达的顺序，不增加固定 sleep。
- 页面初始化脚本在本次导航后移除，不影响后续场景。

## 验证

- 修复前：`pnpm build && pnpm test:browser:built`，正常场景在评分重试终态断言失败，
  SSO 场景通过。
- 回归先红：新增评分响应门闩、保留原立即断言，正常浏览器场景稳定失败为
  `— !== 91`。
- 修复后：`node scripts/agent/check.mjs --base e11f5d8 --run` 的 Health 四项检查全部
  通过：240 项测试、typecheck、web/API build、正常与 SSO 浏览器回归。正常回归包含
  上海午夜 focus 刷新与 375/390px 移动端场景。
- `node --test scripts/agent/check.test.mjs`：22 项通过；`git diff --check` 通过。
- 独立审查、PR CI、合并与自动发布：待执行；线上业务流程本次尚未重新验收。
