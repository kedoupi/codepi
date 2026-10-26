# Health 主睡眠缺失诊断

- 状态：本地诊断接口已实现；真实提供方响应对账待上线授权。
- 目标：区分详细主睡眠在 Oura 响应中缺失，还是同步导入遗漏；不以小睡填充主睡眠，不改变健康档案。
- 范围：`apps/health/` 诊断 API、合成集成测试及说明；无 schema、新依赖或 UI 改动。
- worktree：`~/.worktrees/codepi/codex/health-sleep-diagnosis`。
- 分支：`codex/health-sleep-diagnosis`。
- 起始 SHA：`0449a6c22ff9acadab07ec7b04c0ac3d3a1b9157`。
- 交付：尚未提交；文件为 Health README、API app/lib/route、新诊断集成测试、本记录和任务索引。
- 协调/实现/审查：当前会话顺序执行；未分配并行写入者。
- Git/发布状态：未 commit、push、创建 PR、合并或部署；生产仅执行只读查询。

## 已有证据与边界

- 已通过用户登录的 Health 页面与接口复现：官方评分正常、近期详细主睡眠缺失，多个页面因此无样本。
- 已完整翻页，并用生产 D1 只读聚合核对；不是前端分页截断。
- 当前自动同步报告完成，无未恢复失败或类别访问暂停。
- 没有同一次真实 Oura 原始响应证据，不能把合法响应的窗口替换机制认定为实际根因。
- 现有前端还有缓存 stale 被文案解释成同步未完成、无样本图表刻度误导问题，本补丁未修改 UI。
- 私人响应与具体健康数据不进入本任务文档或 Git。

## 本地实现

`POST /api/me/health-records/sleep-diagnosis?from=YYYY-MM-DD&to=YYYY-MM-DD`：

- 必须为已登录个人 owner 的同源 POST；日期必填，最多 7 天。
- 复用既有取数函数，读取 sleep 与 daily_sleep 全部分页。
- 比较提供方与已保存档案，输出逐日类型计数、重复 ID 数、窗口外数量以及缺失/额外/变化文档数量。
- 不输出记录 ID、指标数值、序列、token 或凭证。
- 不替换 health_records，不更新覆盖窗口或评分缓存；持有既有同步租约，令牌刷新与授权恢复沿用现有逻辑。
- 未新增 UI 入口或 MCP 工具。

## 验证

- 新接口未实现时，新集成测试 4/4 因 404 失败；实现后 4/4 通过。
- 覆盖：上游有/无主睡眠、分页、日期边界、数据与凭证不泄露、健康档案不变、匿名/非 owner/跨站拒绝、同步锁冲突、上游失败。
- API `wrangler deploy --dry-run` 通过；仅本地产物验证，无部署。
- 全任务检查：`node scripts/agent/check.mjs --base 0449a6c22ff9acadab07ec7b04c0ac3d3a1b9157 --run` 完成 Health test（32 脚本 / 65 前端 / 1 状态 / 71 API 单测 / 134 集成）、typecheck、build、资产和正常/SSO 浏览器回归，全部通过。
- 首轮 MCP test 为 62/63；personal-tokens 的本地 Miniflare 请求发生 `ECONNRESET`。该文件单独复跑 2/2，通过；随后完整 MCP test 63/63，通过，typecheck、build 和浏览器验收退出码均为 0。未改测试标准或跳过失败。
- 新增任务文档后单独运行 `node --test scripts/agent/check.test.mjs`，35/35 通过；`git diff --check` 通过。
- 已自审完整 diff；没有上线或取得真实 Oura 原始响应。

## 下一步

1. 完成本地检查并审查整个任务 diff。
2. 按用户授权进行提交、PR、合并与本机生产发布；遵循 `docs/development/local-release.md`，不能从未合并工作区直接上线。
3. 上线后用 owner 会话对缺失时段选择短窗口执行一次诊断，检查两端主睡眠计数与差异。
4. 有证据后才决定补采或修改同步逻辑；窗口替换、ID 冲突与历史覆盖规划当前均只是待验证方向。
