# Health 历史同步告警修复与发布

- 状态：已实现、验证、合并、发布并完成真实账号状态验收。
- 日期与执行人：2026-10-20，当前 Codex 会话，本机执行。
- 目标：已由后续成功同步覆盖的旧失败，不再显示为当前告警；仍未恢复的失败继续显示。
- 范围：Health 状态读取、窗口错误和集成回归；无新增依赖、schema 迁移或凭证更新。
- worktree：`<workspace>/.worktrees/kdp.cool/codex/health-sync-alerts`。
- 开发基线：`1907d1ed23c3e06c4a3cf016d321db82b988da7e`；集成基线：
  `b6cec89564a8fd489b5aff602423d4fa52f0b495`。
- 已验证分支树：`b48bd712435c5502bc6b1a28311c9790aecc47f4`；
  [PR #111](https://github.com/kedoupi/codepi/pull/111) 合并为
  `fcb838be044c8a941e0f149fa60b42cc21236453`，两者 tree 相同。

## 实现与本地验证

旧状态接口直接统计 `health_sync_windows.last_error`，未识别其他成功窗口已经补齐的失败。
现在按同一用户、同一类别检查失败之后的成功覆盖：日期范围须连续或重叠覆盖整个失败范围，
个人资料和戒指信息则由更新的成功快照替代。状态读取即可识别恢复，不需要再次同步或清理历史。

回归先在旧实现上复现，再验证 16 类、48 条旧失败的恢复，以及日期缺口、旧成功、新失败、
用户/类别隔离、快照替代和空结果成功批次。针对性测试 45/45 通过。
合入当前 main 后执行：

```bash
pnpm install --frozen-lockfile
node scripts/agent/check.mjs --base b6cec89564a8fd489b5aff602423d4fa52f0b495 --run
node scripts/cloudflare/validate-governance.mjs
node scripts/agent/check-migrations.mjs
git diff --check
```

9 项受影响检查全部通过，包含 Health/MCP 测试、类型检查、构建、Health 资产检查、
Health 正常/SSO 浏览器回归和 MCP 桌面/移动端授权验收。治理、23 个 migration 文件检查通过。
PR 的 GitHub Actions 没有分配 runner，所有失败 job 的 steps 为空；annotation 指向
账户付款或 spending limit，不能记为 CI 通过。发布采用仓库既定的本地验证流程。

## 生产发布

本机持有 Git common directory 中的 `codepi-production-release.lock`，
从干净且等于实时远程 main 的 source SHA 发布。按每个服务的当前 build 累计检查改动后，
本次发布 Health API 和 MCP；Health 前端无运行代码变化，保留原版本。

| 服务 | 前一 version | 新 version | 新 BUILD_SHA |
| --- | --- | --- | --- |
| Health API | `95bced50-f987-4595-9baa-967ff05b91f2` | `c0ef45e9-a3fc-4d7b-9231-2b7057a94c52` | `fcb838be044c` |
| MCP | `7f5791a5-7adf-46c6-890c-127dc1b01dff` | `13442128-8f7c-4ae5-9705-9fcaba2001b1` | `fcb838be044c` |

两者均为唯一活跃版本，承接 100% 流量。API smoke 于 `2026-10-20T00:19:20.647Z`、
MCP smoke 于 `2026-10-20T00:19:47.982Z` 完成并记录部署证据。
Health 使用现有 `deploy:api` 预检、migration 检查、版本上传、切流和 Cron 核对；
没有待应用迁移。MCP 通过现有部署脚本解析同一独立 D1、检查 migration、发布和 readiness。

Health API 18 项正式域名检查、MCP 5 项正式探针通过。Auth runtime 与 Health 精确 SSO
callback 预检通过；控制面再次确认八个 Worker 的活跃 version、绑定、secret 名称、
Cron、持久日志、查询串脱敏和 Issues。前端保留
`f93e666f-98c4-43cf-99ae-fa91fd521c1e / 67f13bb85e7e`；
Auth/Web/GU/GZH/Ops 均保留原活跃版本。
本地 `production-monitor.mjs --require-d1 --require-versions` 24/24 通过。

临时配置复核脚本曾因 JSON 省略缺省字段而误报差异，修正序列化比较后重新持锁完成
全部控制面复核和巡检；未为该误报再次发布服务。

## 真实账号验收与边界

通过已授权的 CodePi `health_get_sync_status` 调用真实 Health RPC，
发布前为 16 类、48 条当前失败；发布后 18 类均为 `failed_windows=0`、`failed_ranges=[]`，
Oura 连接为 `connected`。只读 D1 聚合确认 16 类、48 条原始
`upstream_unavailable` 历史记录仍保留。验收没有触发提供方同步或修改健康记录。

本轮真实账号验收覆盖设置页共用的 Health 状态逻辑；未另行执行真实网站 SSO 登录、
Oura 重新授权或客户端刷新/撤销。网站原有页面刷新即可读取新状态，不需要重新同步。
发布锁已释放，没有删除工作区或分支。

非敏感证据保存在 Git 外：

- `/tmp/codepi-health-sync-alerts-release-checks-20261020.log`
- `/tmp/codepi-health-sync-alerts-deployment-evidence-20261020.jsonl`
- `/tmp/codepi-health-sync-alerts-release-before-20261020.json`
- `/tmp/codepi-health-sync-alerts-release-after-20261020.json`
- `/tmp/codepi-health-sync-alerts-release-monitor-20261020.log`
- `/tmp/codepi-health-sync-alerts-authenticated-acceptance-20261020.json`
