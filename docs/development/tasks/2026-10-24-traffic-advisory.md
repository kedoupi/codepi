# Cloudflare threats 告警分级

- 状态：代码已合并并发布；手动 monitor 验收通过，等待下一轮 Cron monitor 复核
- 目标：公开站点扫描被 WAF 拦截时，保留 threats 记录与基线，但不让单纯 threats 超阈值使整个 Ops monitor 失败。
- 不在范围内：不改变 threats/requests 阈值；不关闭 Cloudflare 安全扫描；不把网络、权限、GraphQL、缺失小时、损坏 baseline、R2 或业务检查错误改成 advisory。
- 基线：远程 main `92919b7`；交付合并 SHA `4d3f8b1f7aee444851923f1e4a648a04fb36d19d`；Ops 发布 version `d2559813-3ef1-4a20-afb6-33527561a187`。

## 实现

- `traffic-monitor.mjs`：只有正常阈值计算产生的 threats 结果增加 `advisory: true`；requests 结果保持阻断。
- `operations.mjs`：使用统一 blocking predicate 计算 `report.ok` 和失败计数；所有结果仍写入 R2 monitor report。
- `checkTraffic` 的异常路径不带 advisory，继续 fail-closed。
- 运维文档明确 advisory 与 blocking 语义。

## 验证

- `node --test scripts/cloudflare/traffic-monitor.test.mjs services/ops/test/operations.test.mjs`：21/21 通过。
- `node scripts/agent/check.mjs --base origin/main --run`：通过；首次失败仅因隔离 worktree 未安装依赖，安装 `pnpm install --frozen-lockfile` 后重跑通过。
- PR #177：affected、governance、全部应用 build CI 通过。
- 手动 monitor Workflow：Completed；R2 `reports/monitor/latest.json` 为 `ok=true`，threats 结果保留 `advisory=true`。
- 当前生产巡检报告 build=`4d3f8b1f7aee`。

## 待复核

- 下一轮 `*/30 * * * *` Cron monitor：确认真实定时路径同样完成且 `ok=true`。
- 若后续出现 requests surge、基础设施错误或业务健康失败，仍应保持阻断并使 Workflow 失败。
