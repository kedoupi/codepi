# 仓库公开、改名与全量重发

- 状态：已交付；发布后观察已完成，线上正常待用户确认
- 目标与验收：清理敏感内容后将仓库改名为 `kedoupi/codepi` 并公开；本机主目录改为 `~/Coding/codepi`；停止向公开仓库写入备份；全部生产 Worker 从新历史的 main 重新发布并通过巡检。
- 不在范围内：轮换既有 SSO / provider 凭证、数据删除、Auth 旧回调删除（按原计划 10-29 后另行处理）。
- worktree：发布用 `~/.worktrees/codepi/release/public-redeploy`（detached HEAD）；每个修复与本记录各用独立分支。
- 起始 SHA：重写前本地 main `ffa8c70`；重写后公开 main `caf7f19`。
- 交付 SHA：全量发布 `4b65167`（PR #163）；Ops 观察器修复 `a1abba3`（PR #164）、`83c5115`（PR #165）。
- 协调者 / 执行者 / 集成者：主会话（OMP），单一写入者顺序执行；生产发布全程持 `codepi-production-release.lock`。

## 已完成

- 清理与公开（2026-10-23 旧会话执行）：删除 14 个 `ops-backup-*` Release 与对应 tag；`git filter-repo` 重写历史（统一作者为占位身份，替换个人信息、本机路径、广告 ID 与旧仓库坐标）；强制更新远程 `main` 并删除远程旧分支；仓库先改名后公开；新增根 `LICENSE`（MIT）与 `NOTICE.md`；Ops 移除 GitHub Release 备份复制。重写前完整历史只保存在本机镜像 `~/.local/share/kdp.cool/repo-mirrors/`，不得推送。
- PR #163：重写把 `packages/cli/src/repo.ts` 的 GitHub SSH 主机及测试夹具替换成非 GitHub 地址，`detectRepo` 对正常 origin 返回 `null`。已恢复标准 SCP 形式与夹具。
- PR #164：Observer 首次线上运行在 poll 0 后崩溃（`reading 'toString'`），原因是 `step.sleep` 只传了一个参数，Workflows 签名为 `(name, duration)`。同时 `telemetry/keys` 用了 GET（404），每轮都报 observability unavailable。按版本统计的指标改为读取 GraphQL `workersInvocationsAdaptive`。
- PR #165：issues 接口按 `service`/`status` 过滤，按 `page`/`perPage` 分页；原代码传的 `scriptName`/`sinceMinutes` 被忽略，导致每个服务都带上同样 20 条全账号 issue。现已映射真实字段，并在本地按 `lastObserved` 过滤 5 分钟窗口。
- 本机清理：旧 `~/.worktrees/kdp.cool/` 下 11 个 worktree 均无未提交内容。旧历史分支先打包为同目录 `local-branches-pre-rewrite-20261023.bundle`（`git bundle verify` 通过）再移除。Orca 只剩 `codepi` 登记。
- 回滚凭证：`provision-ops.mjs rollback-credential` 已创建 `codepi-ops-rollback`（仅 Workers Scripts Write），写入 `codepi-ops/CLOUDFLARE_ROLLBACK_TOKEN`。
- 全量发布（源 `4b65167`，无待执行 D1 迁移）：

| 服务 | 旧版本 | 新版本 |
| --- | --- | --- |
| ops | 366370eb | 3ffe50d3 → 2f2aa602（#164）→ 6cd996af（#165）→ 4d601fbc（回滚凭证 secret） |
| auth | b93b8374 | be166a50 |
| www | c8056e49 | 54017904 |
| gu | b322ec72 | 1bad98a7 |
| gzh | ec397aca | e54f59c1 |
| health-api | 100efebf | e411309b |
| project | 8918641d | 4084c084 |
| me | 99197b4f | ff2721b3 |
| mcp | fb3a2eca | 426e906f |
| health（前端） | ad4586bd | 74f7c5da |

Ops 最先发布，旧代码中向 GitHub Release 上传备份的路径随之下线。新 Ops 对 GitHub 只读取提交历史（版本漂移），另外写观察 Issue。

## 验证证据

- 本地：全量 `check.mjs --run` 43 项通过；PR #164/#165 的受影响检查（含原生 Workflows 合成运行）通过；`validate-governance`、`check-migrations`、`git diff --check` 通过。
- CI：PR #163/#164/#165 全部 job 在 runner 上执行并通过。此前的 run 因账户计费被拒，job 未启动；仓库公开后已恢复。
- 线上 smoke：Auth health；Web/GU/GZH 根页、匿名私有 API 拒绝与 SSO；Health API build；Project/Me `sso_ready=true`；MCP `check:live`；Health 前端 branding。
- 本地 `production-monitor.mjs --require-d1 --require-versions`：偶发单项 `fetch failed`（MCP 登录、GU 匿名 API、旧 Oura 域名各一次），立即复查均通过；最终连续三轮 `All production checks passed`，十个 Worker 的 `BUILD_SHA` 与 main 一致。
- 云端巡检：新 Ops 的 `reports/monitor/latest.json` 为 `ok=true`，含 GitHub 版本漂移检查。
- 观察 `release-a1abba3c9df5-publicredeploy2`：Workflow `complete`，七轮全部执行。九个服务每轮 healthy，无版本漂移；poll 3 起 ops 标记为 critical，原因是观察期间部署 PR #165 改变了 ops 版本（预期内）。所有服务 `rollback_allowed=false`，最终状态 `rollback_blocked`，未执行任何回滚。
- 发布期间问题：MCP 首次部署非零退出但线上版本未变，重试成功；本次运行遗留的发布锁，确认无相关进程后才移除。
- GitHub：Release 0、tag 0、分支仅 `main`、无打开 PR。

## 继续工作

1. 所有者操作：Ops `GITHUB_TOKEN` 只有 Contents 权限，观察通知返回 HTTP 403。如需 GitHub Issue 通知，给该 fine-grained token 增加 `kedoupi/codepi` 的 Issues 读写。不加不影响巡检和观察报告（R2）。
2. 所有者操作：本机主 checkout 仍停在重写前的 `ffa8c70`（工作区内容与新 main 一致），需在 `~/Coding/codepi` 执行 `git checkout -B main origin/main`。工具策略禁止 agent 切换共享 checkout。
3. 次日确认 UTC 18:00 备份：R2 完整清单已生成，公开仓库没有出现新 Release。
4. 可选：如需彻底清除旧提交缓存，联系 GitHub Support。
5. 既有遗留：Auth 旧 kdp.cool 回调 10-29 后删除。

## Project 旧项目卡

生产 D1 `codepi-project` 中，`kedoupi-kdp-cool`（repo `kedoupi/kdp.cool`）与 `kedoupi-codepi` 并存。前者 0 条交接、4 个卡片字段均无手工编辑，其余事件和任务索引已由新仓库同步重新生成。因此不迁移数据，只把旧卡设为 `archived`（2026-10-23，条件更新影响 1 行），未删除任何记录。撤销方法：把该行 `status` 改回 `active`。
