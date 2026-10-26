# Health 主睡眠缺失诊断

- 状态：PR #206 已合并，诊断接口已上线并完成 30 分钟观察；真实 owner 对账确认提供方与保存档案不一致，缺失数据尚未修复。
- 目标：区分详细主睡眠在 Oura 响应中缺失，还是同步导入遗漏；不以小睡填充主睡眠，不改变健康档案。
- 范围：`apps/health/` 诊断 API、合成集成测试及说明；无 schema、新依赖或 UI 改动。
- worktree：`~/.worktrees/codepi/codex/health-sleep-diagnosis`。
- 分支：`codex/health-sleep-diagnosis`。
- 起始 SHA：`0449a6c22ff9acadab07ec7b04c0ac3d3a1b9157`。
- 交付：诊断 API、合成测试、Health README、本记录和任务索引。
- 协调/实现/审查：当前会话顺序实现；未分配并行写入者。独立完整重审绑定 `f3fbedc7a38d3c3ad4bbadd01233842bd698fdb5`，未保留缺陷；PR CI 5 passed、7 skipped、0 failed。
- Git/发布状态：用户随后明确授权合并部署；PR #206 于 `2026-10-26T08:23:29Z` 合并为 `ac5cd6ad0f384742597b2410e25f1a54944773e8`，合并树与已审查 head 一致。Health API/MCP 已上线，前端未重发；生产未执行档案补采或数据修复。发布后文档回填仅在本 worktree，尚未提交。

## 已有证据与边界

- 已通过用户登录的 Health 页面与接口复现：官方评分正常、近期详细主睡眠缺失，多个页面因此无样本。
- 已完整翻页，并用生产 D1 只读聚合核对；不是前端分页截断。
- 当前自动同步报告完成，无未恢复失败或类别访问暂停。
- 初始调查没有同一次真实 Oura 响应证据；上线后的 owner 诊断已确认提供方现有文档未完整保存，但仍不能把某一次历史窗口替换、ID 冲突或写入失败认定为具体根因。
- 现有前端还有缓存 stale 被文案解释成同步未完成、无样本图表刻度误导问题，本补丁未修改 UI。
- 私人响应与具体健康数据不进入本任务文档或 Git。

## 本地实现

`POST /api/me/health-records/sleep-diagnosis?from=YYYY-MM-DD&to=YYYY-MM-DD`：

- 必须为已登录个人 owner 的同源 POST；日期必填，最多 7 天。
- 复用既有取数函数，读取 sleep 与 daily_sleep 全部分页。
- 比较提供方与已保存档案，输出逐日类型计数、重复 ID 数、窗口外数量以及缺失/额外/变化文档数量。
- 不输出记录 ID、指标数值、序列、token 或凭证。
- 不替换 health_records，不更新覆盖窗口或评分缓存。
- 每次上游分页前，以及令牌读取和整个刷新请求期间，只保持本次仍持有的未过期租约。读取后、刷新前及刷新返回后均确认所有权；心跳失败立即传给主流程，不再发起后续提供方请求。确认通过后才保存令牌；租约被接管或过期则返回 409，不重新夺取，也不保存令牌。成功请求解除旧授权暂停仍沿用现有逻辑。
- 文档是否变化按递归排序后的 JSON 结构比较；对象字段顺序不计为变化，数组顺序保留。
- 未新增 UI 入口或 MCP 工具。

## 验证

- 新接口未实现时，新集成测试 4/4 因 404 失败；实现后 4/4 通过。
- 审查回归先红后绿：字段重排误报变化，租约被接管后继续翻页，刷新期间并发同步取得租约，以及读取令牌时心跳失败仍继续刷新。修正并重建 API 后，诊断集成测试 9/9 通过；读取期间心跳失败的合成回归 1/1 通过，提供方刷新调用为零。档案同步与令牌刷新集成测试 27/27 通过。
- 覆盖：上游有/无主睡眠、分页、日期边界、嵌套字段顺序、数据与凭证不泄露、健康档案不变、匿名/非 owner/跨站拒绝、同步锁冲突、过期令牌和 401 刷新期间阻止并发同步、读取时心跳失败、租约接管后停止、上游失败。
- API `wrangler deploy --dry-run` 通过；仅本地产物验证，无部署。
- 全任务检查：`node scripts/agent/check.mjs --base 0449a6c22ff9acadab07ec7b04c0ac3d3a1b9157 --run` 完成 Health test（32 脚本 / 65 前端 / 1 状态 / 71 API 单测 / 134 集成）、typecheck、build、资产和正常/SSO 浏览器回归，全部通过。
- 首轮 MCP test 为 62/63；personal-tokens 的本地 Miniflare 请求发生 `ECONNRESET`。该文件单独复跑 2/2，通过；随后完整 MCP test 63/63，通过，typecheck、build 和浏览器验收退出码均为 0。未改测试标准或跳过失败。
- 新增任务文档后单独运行 `node --test scripts/agent/check.test.mjs`，35/35 通过；`git diff --check` 通过。
- 最新修正执行 `node scripts/agent/check.mjs --base 9b03157a8fd6e07103894b7ddb904df700c03294 --run`；重跑日志确认全部 11 项通过，包含 API 单测 72/72、Health/MCP 测试、typecheck、build、资产及浏览器验收。完整日志仅本机保存，不含真实健康响应。
- 已自审完整 diff；以上为发布前本地验证。后续真实验收见下文。

## 合并、发布与观察

- 当前会话在本机任务 worktree，从干净且等于当时实时远程 main 的 `ac5cd6ad0f384742597b2410e25f1a54944773e8` 持锁发布 Health API，再发布 MCP。治理检查与 32 个 migration 文件守门通过；两库无待应用 migration；未修改 secret 或 binding。main checkout 未修改。
- Health API：`ec64a674-1524-4ccd-84b9-de167234514a` → `8c3decbe-373a-45af-9a06-99a2e4a13007`；MCP：`f61cc5ae-2d36-46aa-9d2e-8ea2dd91d313` → `a3af9f75-52d4-4644-acd0-050c40d5aee1`。两者均单一版本 100% 承流，`BUILD_SHA=ac5cd6ad0f38`；观察结束后控制面复查仍一致。Health 前端保持既有版本。
- Health `check:api` 与 MCP `check:live` 通过，覆盖精确 build、SSO、私有接口匿名拒绝、Auth 凭证配对和 discovery；没有重做真实 MCP 客户端授权。
- 全局 `production-monitor.mjs --require-d1 --require-versions` 非零：运行时与同步新鲜度检查通过，但 Web/GU/Project/Me 的累计版本漂移检查失败。Web 在 `405ab04a3ebb` 与目标之间的运行文件树相同，累计历史仍包含分支汇合带来的历史 Web 改动；GU/Project/Me 旧基线后有共享 MCP 合约改动。本次没有扩大部署，也未将全局巡检记为全绿。
- 发布脚本因此在触发 Observer 前停止并释放锁；调查上述失败后，重新持锁仅为已切流的两个服务生成单一观察，不重跑部署。`release-ac5cd6ad0f38-health-sleep` 的实例为 `cf_c5e549397d22f87faa1e263cf01d80dbbe49de14b0fe41a23d5b024de4b676ca`，两服务 manifest 均推导 `rollback_allowed=true`。
- 私有 R2 最终 summary 于 `2026-10-26T09:10:11.974Z` 写入，`state=healthy_reported`、`rollback=null`。末轮 round 6 两服务均 healthy、版本与 manifest 一致，无 hard failure、版本读取失败或 observability failure，22 项 core 检查全部成功；Health 末轮 2 次调用、0 错误，MCP `metrics=null`。平台观察不代替所有者实际使用确认。
- Git 外证据目录：`/tmp/codepi-health-release-20261026/`，含 `evidence.jsonl`、smoke/monitor 日志、Observer `summary`、首轮和末轮报告；R2 路径为 `reports/observer/release-ac5cd6ad0f38-health-sleep/`。未保存私人原始健康响应或凭证。

## 真实对账与剩余边界

- 已用独立 Agent Window 的现有 owner 登录，执行两个短窗口同源诊断 POST，均返回 200。真实提供方中有主睡眠文档，而已保存档案缺失；评分类档案在窗口内一致。具体私人日期、计数与健康指标不写入 Git。
- 只读 D1 复核发现相关同步窗口与队列标记成功，但不能据此证明档案完整。当前已排除仅前端分页截断和“提供方当前没有对应文档”；尚不能区分历史上游响应不完整、后续未补采或具体写入路径异常。
- 诊断未替换健康档案、覆盖窗口或评分缓存；未触发强制同步、补采或数据修复。令牌正常刷新仍沿用既有行为。浏览器会话已关闭。

## 下一步

1. 以合成场景复现“窗口成功但档案缺失”，继续核对请求日期边界、覆盖规划及窗口替换的实际影响；没有证据前不改同步策略。
2. 若后续明确授权真实补采，可用一个已知缺口的单日窗口执行受控同步，并立即对账，区分提供方历史变化与写入问题。
3. 另行处理全局版本漂移；本次发布健康不代表缺失数据已修复，所有者实际使用确认仍未取得。
