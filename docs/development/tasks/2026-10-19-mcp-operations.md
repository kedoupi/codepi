# MCP 运维补齐

- 状态：代码已合并并完成五个 Worker 的本机发布，六库本地备份已验收。
  完整巡检 22/23；GitHub runner 已确认受账户免费分钟耗尽和零额外预算阻塞。
  Health 当前同步在正常推进，整轮完成的新鲜度告警及六库异机 artifact 仍待验收。
- 目标：MCP D1 纳入加密备份；统一 MCP 的巡检与 SSO secret 配对工具；七个生产 Worker
  对照 main 的按服务代码漂移检测。
- Worktree：`<workspace>/.worktrees/kdp.cool/codex/unified-mcp`，复用已干净的任务 checkout。
- 基线：`777dc4010e2f073ef3e655add4f604004ec03715`，开工时等于实时远程 main。
- 当前 Codex 为唯一写入者、共享脚本负责人和验证者；无并行写入。
- 写入范围：`scripts/cloudflare/`、MCP 发布/验收脚本及其测试、
  `.github/workflows/production-monitor.yml`、对应运维文档。
- 本轮不修改产品数据、认证协议、DNS 或依赖；不执行 secret 轮换或数据恢复。
  已按所有者“开始下一步”的后续授权合并本批改动，从干净 main 补发五个缺少 BUILD_SHA
  的 Worker，并验收生产巡检与六库加密备份。

## 开工现场与决策

- 原备份明确排除了 MCP 授权库。本次按所有者指出的缺口将其纳入现有公钥加密日备，
  并让清单测试对照全部 managed production D1，避免新增库再次漏接。
  通用恢复保护同步覆盖 MCP 生产 UUID；历史授权恢复须先作废 token/会话再切换。
- MCP 已有无副作用的 Auth 凭证配对 readiness，但定时巡检未接入。现在与发布 smoke
  共用一套检查，且部署脚本不能在 smoke 失败后报告成功。
- 新配对工具仅更新两个 MCP secret，随机值只用于两次 API 请求、不输出或写文件。两次 API 写入非原子，
  部分失败必须中止并恢复整对配置；普通发布不调用轮换命令。
- 实际 Cloudflare GET 确认七个 Worker 的活跃 version 均与首发记录一致、100% 流量。
  只有 Health API 和 MCP 有 `BUILD_SHA=767fb0b3d63a`；Auth、Web、GU、GZH、Health 前端缺失。
  本次没有通过手填 metadata 来伪装重新构建，首次启用严格巡检前需要带 SHA 的真实发布。
- main `777dc401` 相比已发布 `767fb0b3` 只有文档改动，不能直接把 SHA 不同视为漏发布。
  版本巡检读取当前承流版本，以其 source 为祖先基线累计所有提交路径（含 revert），
  共享代码保守覆盖消费者，Health 两个 Worker 分开判断。缺历史、权限、SHA、非祖先或
  分流都报告失败。

## 发布前验证

- `node scripts/agent/check.mjs --base 777dc4010e2f073ef3e655add4f604004ec03715 --run`：
  **29/29 通过**，含全部产品/Auth/MCP、shared auth、CF 脚本/治理、lint、
  Health 正常/SSO 浏览器回归和 MCP 桌面/手机授权流程。
  日志 `/tmp/codepi-mcp-operations-checks.log`。
- 后续仅运维脚本与文档补强：版本范围包含 merge-only 改动，忽略纯检查/发布脚本；
  对应真实 Git fixture、备份与 MCP deploy 测试 **15/15 通过**，完整应用检查不受这些改动影响。
- 最终 `node --test scripts/cloudflare/*.test.mjs services/mcp/test/deploy.test.mjs`：
  **89/89 通过**；治理守门、102 个脚本/17 份 JSON 的 lint、`git diff --check` 均通过。
  日志 `/tmp/codepi-mcp-operations-script-tests.log`；合并前复跑仍为 **89/89 通过**，
  日志 `/tmp/codepi-mcp-operations-premerge-tests.log`。
- `node services/mcp/scripts/check-live.mjs`：线上 **5/5 通过**，包含实际凭证配对 readiness、
  两个发现端点、匿名 tools/list 401 与连接管理登录门。
- `node scripts/cloudflare/production-monitor.mjs --require-d1 --require-versions`：
  **17/23 通过，6 项失败**；五项为生产缺 BUILD_SHA，另一个为 Health 最后完整同步距检查
  约 83 小时。Health API/MCP 的源代码与远程 main 一致，文档-only 差异未误报。
  日志 `/tmp/codepi-mcp-operations-live.log`。没有把线上告警改成绿色。
- 已自行审查变更；没有独立 Agent 审查。真实 secret 轮换、MCP 首次备份 artifact、
  定时 runner 恢复、真实 AI 客户端授权和查询未执行，不能据本地测试声称已验收。

## 合并与本机发布（2026-10-19）

- 本地提交 `2163e4bfb252f7e2d418f974be1b482dada9cc82` 经 PR #101 squash 合并为
  `0ce7d35636d53291b1b7ebbc7f84d7d7d6a0741b`。合并树与检查通过的提交逐文件一致。
- 在本任务 worktree 切换到该干净 main，确认实时远程 main 相同、Wrangler 账户为
  Kedoupi。当前 Codex 在 Git common directory 持有同一个发布锁，串行完成冻结
  lockfile 安装、治理/迁移检查、构建、迁移预检、发布及逐服务 smoke；每次远程变更前
  复核 HEAD、工作区和实时 main。四个 D1 均报告无待应用 migration。
- 五个新版本均为真实构建和发布，`BUILD_SHA=0ce7d35636d5`，各自承接 100% 流量。
  绑定、secret 名称、Cron、持久日志、查询串脱敏和 Issues 均经控制面复核。
  发布于 `2026-10-19T03:01:02.456Z` 完成后释放锁。

| 服务 | 前一 version | 本次 version |
| --- | --- | --- |
| Auth | `5d44973d-b23d-460f-9b7f-c0cd27c5ce74` | `9ce0a674-5a0c-4dc5-8c54-8b7b97f986b6` |
| Web / Desk | `6924e315-5ddd-4867-88eb-9dd289186511` | `b3fc211b-afdd-4643-a20d-b1c8f3111ba6` |
| GU | `c83f0adc-e415-42dd-b3b7-eac519a563a7` | `baad660d-c82d-4d82-b660-39b928e5d141` |
| GZH | `24011868-67ec-44ce-97b4-1997d412f59a` | `af934298-364a-444a-b1b5-653ad35683c5` |
| Health 前端 | `cd1759eb-755e-4f77-b25c-cbe1c076ae91` | `0ba5fc00-8069-455d-abb7-6f4fe0768617` |

Health API `601e1ddf-eff9-40ee-8d14-b50787240e82`、MCP
`dabf3c40-2360-40ec-b603-50c1d317ec13` 保留首发版本和
`BUILD_SHA=767fb0b3d63a`。首发后到本次 main 没有其运行代码变更，新的发布/验收脚本
不要求重发相同业务代码；七个 Worker 的按服务代码漂移检查均通过。

发布后验收：

- Web/GU/GZH 正式域名与控制面解析出的 Worker origin 均通过 `check-pages.mjs`。
- Health API **18/18** 契约与精确原 build 检查通过，前端 `check:branding` 通过。
- MCP **5/5** 探针通过；额外确认其 SSO 使用精确 callback、S256，中央 Auth
  接受该客户端并返回 200 登录页。未发送邮件、执行真实用户登录或 AI 查询。
- `2026-10-19T03:02:19.844Z` 的完整巡检 **22/23 通过，整体仍为失败**；
  唯一失败为 Health 最后完整自动同步约 84 小时前，超过 30 小时门槛。
  没有降低阈值或把旧上游问题标为本次已修复。
- 逐服务证据：`/tmp/codepi-mcp-operations-deployments.jsonl`；
  控制面前后快照：`/tmp/codepi-mcp-operations-before.json`、
  `/tmp/codepi-mcp-operations-after.json`；
  完整巡检：`/tmp/codepi-mcp-operations-postdeploy-monitor.json`。
- 证据回填仅修改本任务、资源登记表与备份 runbook；针对发布源码 `0ce7d356` 的
  `node scripts/agent/check.mjs --base 0ce7d35636d53291b1b7ebbc7f84d7d7d6a0741b --run`
  选中 **4/4 检查通过**，日志 `/tmp/codepi-mcp-operations-evidence-checks.log`。
  该文档更新不要求重复发布 Worker。

## 六库备份与调度验收

- PR CI run `39192075087` 的首批 job 无 steps、无日志地址，其他构建被跳过，
  不记为 CI 通过。
- main push 已触发 D1 backup run `39192113905`（job `117866982001`）与
  Production monitor run `39192113912`（job `117866981954`）。两者均在 3 至 4 秒内
  失败，`runner_id=0`、runner 名为空、`steps=[]`；备份 artifacts 列表为空。
  这次没有取得 runner 执行证据，不把工作流已合并视为定时任务恢复。
- 作为当次补充，在发布完成后重新持有发布锁，使用 main 中相同的 `runBackup`
  和公钥执行六库导出。密文与 manifest 保存在仓库外
  `<workspace>/.local/share/kdp.cool/backups/2026-10-19-mcp-q41mYg`。
  导出时间 `2026-10-19T03:02:41.957Z`，验证完成时间 `2026-10-19T03:03:42.780Z`。
- 六份密文共 1,589,735 字节，manifest 的库 UUID、字节数、SHA-256、公钥指纹、
  GCM 认证元数据和现有恢复私钥的内存解密均通过；MCP 六张授权/会话表包含在导出中。
  目录为 `0700`，七个文件为 `0600`；SQL 明文未写磁盘，未导入或恢复生产数据。
  非敏感验证结果见 `/tmp/codepi-mcp-operations-backup-evidence.json`。
- 这是一份本机加密快照，尚未产生新的 GitHub 异机 artifact，也不提供持续调度保障。
  恢复私钥的异机托管仍未验证。

## 剩余独立验收

1. 所有者决定 Actions 额外付费预算后，恢复 hosted runner 执行，取得包含六库的成功
   异机 artifact 和实际定时巡检证据；免费额度耗尽与当前零额外预算已确认。
2. 验收 Health 当前补同步队列完成，并重新检查 30 小时以内的完整成功记录。
   当前任务无失败且持续推进，不能继续描述成仍有未经核实的上游故障。
3. 所有者在实际 AI 客户端完成新 MCP 授权、Health 查询、refresh 与撤销验收。
   当前凭证配对正常，本次未运行轮换工具。

## Runner 根因与 Health 进度复核（2026-10-19）

本轮基线为干净的 `b248c22f0e626291f5d3880f595430287fea0630`，GitHub API 核实
实时远程 main 与之相同。继续使用同一任务 worktree，当前 Codex 为唯一写入者，
仅回填本任务、资源登记表和备份 runbook；未修改应用、工作流、预算或生产配置。

### GitHub Actions

- 通过 GitHub API 重跑 backup job `117866982001`，run `39192113905` attempt 2
  的 job `117871787834` 于 `2026-10-19T03:14:02Z` 至 `03:14:06Z` 再次失败，
  仍为 `runner_id=0`、`steps=[]`，没有执行备份脚本。
- 成功对照为 `39090056809` 的 job `117564710265`：同样使用 `ubuntu-latest`，
  有实际 runner 和成功的导出、加密、上传步骤，不能仅凭本次无步骤就更换 runner 标签。
- 当前连接器不支持读取 check-run annotations 和 Actions 设置；本机 `gh` API
  返回 401。使用已有浏览器登录态只读核对 run 摘要和账户计费页后关闭了专用 session，
  没有提取登录凭证。
- run 错误明确说明任务因付款或支出限制未启动。账户计费页进一步确认：
  本月 Actions 分钟为 **2,000 / 2,000，100%**，Actions 额外预算为 **$0**，
  显示 `Usage blocked`；这是现有 runner 启动失败的直接原因。
  不再把原因记为未确认的 billing/quota/outage。
- 提高付费预算需要所有者明确决定；本轮未提高预算、绑定付款方式、注册本机 runner，
  或修改 CI 来绕过账户限制。定时巡检和六库异机备份仍没有恢复执行证据。

### Health 自动同步

- `2026-10-19T03:15:48.851Z` 的 D1 只读元数据查询：当天整轮任务为 `running`，
  **68 / 92** 完成、24 待处理、0 失败，任务错误码为空；18 类详细数据集合均有当天
  成功的同步窗口。未读取健康指标值、用户标识或加密授权内容。
- `2026-10-19T03:21:09.729Z` 再次只读核对：**71 / 92** 完成、21 待处理、
  0 失败、`last_error=NULL`。两个快照之间真实 Cron 完成了 3 个任务，
  不需要再次要求所有者重连来解释当前告警。
- `auto-sync.ts` 只在整轮任务达到 `completed` 时更新 `last_success_at`；
  当前该字段仍为 `2026-10-15T15:16:55.898Z`。因此“整轮完成时间超出 30 小时”
  仍是有效告警，但不能据此推断当前没有成功请求或授权仍然失效。
- 保留现有 30 小时门槛和历史队列；未手动修改同步状态、跳过待处理任务或清空错误记录。
  当前恢复进度通过，整轮完成尚未验收。
- 元数据证据保存在 Git 外：
  `/tmp/codepi-platform-sync-diagnostics-20261019.json`、
  `/tmp/codepi-platform-sync-progress-20261019.json`；
  严格生产巡检日志为 `/tmp/codepi-platform-runner-followup-monitor-20261019.log`。

本轮验证：`node scripts/agent/check.mjs --base b248c22f0e626291f5d3880f595430287fea0630 --run`
选择并通过 **4 / 4** 本地检查，含 Cloudflare 脚本回归、治理守门、agent 检查回归与 lint；
`git diff --check` 通过。严格生产巡检仍为 **22 / 23**，唯一失败是上述整轮完成时间。
检查日志为 `/tmp/codepi-runner-diagnosis-doc-checks-20261019.log`。
本轮只有三份运维文档的本地更新，尚未提交或推送，不需要发布应用。
