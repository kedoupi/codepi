# Cloudflare 定时运维迁移

- 当前状态：大库流式备份与 GU 原件覆盖已发布；手动 GitHub 副本和新 Workflow 的
  自动跨平台复制均已验收。六库、112 份原件下载及内存解密通过，云端巡检 26/26，
  详见文末与[跨平台验收](2026-10-20-github-offsite.md)；下方缺凭证失败保留为历史。
- 目标：将每 30 分钟巡检和每日六库加密备份从 Actions runner 迁到 Cloudflare。
- 基线：`b248c22f0e626291f5d3880f595430287fea0630`，开工时与实时远程 main 一致。
- Worktree：`<workspace>/.worktrees/kdp.cool/codex/unified-mcp`。
- 当前 Codex 为唯一写入者、共享契约负责人、集成与发布者；无并行写入。
- 开工已有三份同一任务的诊断文档更新，保留并随本批交付，不覆盖原记录。
- 授权：沿用本会话已授权的 commit、push、PR、合并和本地 API 发布。
  本轮不修改计费方案、既有应用凭证、业务数据或 Oura 授权。

## 实施边界

1. 新增 `services/ops/` 支撑服务，无公网域名、无业务 D1，使用 Cron + Workflows。
   复用仓库已有版本的 Wrangler，不引入新的第三方库。
2. 从现有脚本抽取 Worker 可用的巡检、备份和发布范围逻辑，CLI 与云端共用断言；
   备份沿用 RSA 公钥封装、AES-GCM、gzip 和恢复格式，恢复私钥不上云。
3. R2 私有桶保存加密备份，保留 14 天；监控结果只存运维元数据。
   GitHub API 代替本地 Git，逐提交检查改动，保留 revert、删除和 merge 的覆盖。
4. GitHub 仍用于代码/PR/审核。跨平台密文可经 API 上传私有 Release，无需 runner。
   GitHub 凭证缺失、历史不完整或跨平台上传失败必须可见，不能记作全部成功。
5. 新服务进入治理、受影响检查、版本巡检和本地发布流程。
   旧 Actions 调度在新服务就绪后退为手动应急入口。

## 已核实的控制面

- Workers Paid 和 R2 已开通；未购买或修改订阅。
- R2 可用；Workflows 列表为空，当前凭证可访问其控制面。
- 本地 GitHub CLI 的现有凭证失效，环境未提供 `GH_TOKEN`/`GITHUB_TOKEN`。
  连接器可完成本次仓库操作，但不能作为新 Worker 的长期运行凭证。
- 既有 Cloudflare incident/Workers Issues 邮件通知策略启用；实际送达未验收。

## 验收与交付

- 代码已实现，尚未合并或发布。仓库只新增 Ops workspace 的 importer，复用已有的
  Wrangler 4.151.0 与现有依赖快照，未升级任何既有包版本。
- `node scripts/agent/check.mjs --base b248c22f0e626291f5d3880f595430287fea0630 --run`：
  **32/32** 本地检查通过，含四产品/Auth/MCP/Ops、shared auth、治理、
  Health 两种浏览器模式和 MCP 桌面/手机授权流程。日志 `/tmp/codepi-ops-full-checks.log`。
- 固定差异自行审查后补齐暂停实例过期、公钥变化和错误脱敏的保护；未进行独立 Agent 审查。
  最终 CF 脚本、agent 检查与 Ops 合成单测 **127/127** 通过；
  相关备份/恢复单测 **17/17** 通过；Ops 构建和原生 Workerd/Workflows/R2 执行通过。
  日志 `/tmp/codepi-ops-final-tests.log`、`/tmp/codepi-ops-review-fixes.log`、
  `/tmp/codepi-ops-final-build.log`、`/tmp/codepi-ops-final-runtime.log`。
- 本地原生测试发现 Workers 不支持 `redirect: "error"`，已改为手动检查响应，
  继续拒绝意外跳转；六份合成导出均可在进程外解密，缺 GitHub token 仍为失败。
- 治理守门、迁移追加守门、116 个脚本/18 份 JSON lint 与 `git diff --check` 通过。
- 待执行：PR 合并、干净 main 本地发布、首次六库 R2 密文和现有恢复私钥内存解密、
  Cron/Workflows/公网关闭/日志核验。GitHub 长期凭证仍缺失，不声称跨平台备份或
  云端 main 漂移检查已恢复。


## 合并与发布

- PR #103 已用 API squash 合并，main 为 `67f13bb85e7e287074190481487cdd64ed162451`；
  合并树与已验证分支 tree 相同，无组合差异。发布现场为该 SHA detached checkout，
  工作区干净且与实时远程 main 一致，并由同一本机生产锁串行执行。
- `pnpm install --frozen-lockfile` 通过；治理守门、迁移守门、既有实时探针、
  Auth/Web/GU/GZH/Health/MCP 预检均通过。新增 workspace importer 使现有
  release-scope 规则保守覆盖八个 Worker，因此全部重发而非仅发布 Ops。
- 生产发布均记录实际 version：auth `f8c74b7a-45c3-4d03-b995-e39a73267bb8`，
  web `84990bcd-bcbf-41c6-b973-50489ed8d543`，gu `760e7751-ff21-4a94-b6d6-e33f21f49656`，
  gzh `5ca9a687-bf00-4632-8d97-ba42021ef6eb`，health-api
  `95bced50-f987-4595-9baa-967ff05b91f2`，health-web
  `f93e666f-98c4-43cf-99ae-fa91fd521c1e`，mcp `7f5791a5-7adf-46c6-890c-127dc1b01dff`，
  ops `c4b6f267-967e-425f-9596-43d3b8a5d137`。均 `BUILD_SHA=67f13bb85e7e`；
  各服务既有 smoke 通过后记录。Ops 的控制面、隔离和 Cron 验收通过，完整 Workflow
  备份仍见下方失败记录。本地 `checkReleaseDrift` 8/8 通过。
- Auth、Desk、GU、GZH、MCP D1 migration 均返回无待应用；Health API migration
  无待应用。MCP 发布脚本完成配对与匿名契约 smoke；旧有真实 AI 客户端验收仍未做。
- 证据保存在 Git 外：`/tmp/codepi-ops-release-67f13bb-*.log/json` 与
  `/tmp/codepi-ops-release-67f13bb-evidence.jsonl`。

## 云端控制面验收

- Ops Worker `c4b6f267-967e-425f-9596-43d3b8a5d137` 为唯一 100% 承流版本；
  只绑定 BACKUPS、OPERATIONS、CLOUDFLARE_API_TOKEN secret、BUILD_SHA、
  CLOUDFLARE_ACCOUNT_ID、ENVIRONMENT；公网 routes/workers.dev/preview URL 均为空，
  subdomain/previews 均 disabled。Cron 为 `*/30 * * * *` 与 `0 18 * * *`，
  observability、持久日志、query redaction 与 Issues 均启用。
- R2 `codepi-ops-backups` managed domain 关闭，无 custom domain；`backups/`
  与 `reports/` 各有 14 天删除生命周期。专用 token `codepi-ops-runtime`
  active，权限仅为 D1 Write 与 Workers Scripts Read，无 Worker 发布、R2 或 token 管理权限。
  现有 incident 与 Workers Issues 邮件策略启用；邮件送达未验收。
- 首次手动 backup 实例 `acceptance-backup-67f13bb` 于 04:10:23 UTC 启动，
  auth、desk、gu、gzh 四库加密导出成功；`codepi-health` 原始 SQL 导出三次均
  超过代码设置的 16 MiB 原始导出保护上限，实例于 04:12:40 UTC errored。
  因六库未完成，未写 `reports/backup/r2-success.json`、
  `reports/backup/offsite-success.json` 或完整 manifest，也不把 4/6 密文当完整备份。
- monitor 未手动触发：此时它必然因 16 MiB 备份缺口和缺失 `GITHUB_TOKEN`
  失败。恢复入口是独立架构任务（流式/分块导出、Durable Object、非 Worker 容器
  或手动应急备份二选一），不是把容量上限静默放大。云备份完整性、跨平台副本、
  告警邮件送达均不能声称恢复。

## 首发时未完成项（历史，后续进展见下文）

1. 设计并实现 Health >16 MiB 的可靠备份方案，先保留手动 `d1-backup.yml`
   作为已授权应急入口；实现后重跑首次六库 R2、manifest 和恢复私钥内存解密。
2. 用户配置仅含 repo Contents 读写的 `GITHUB_TOKEN` secret 后，重跑 monitor 与
   backup，验证 GitHub 历史检查与跨平台 Release 回执。
3. 明确恢复私钥的异机托管方案并演练；真实 AI 客户端 MCP 验收与 Health 整轮同步
   仍是独立剩余项。Actions 账户额度仍耗尽，不代表 CI 通过。

## 大库备份修复（已合并发布，六库 R2 验收通过）

- 基线 `06b5e01c695fc1291147a634e5241519b89bc69b`，与开工时实时远程 main 一致；
  原 worktree 干净，复用为 `codex/ops-streaming-backup`。当前 Codex 是唯一写入者、
  共享备份格式负责人和发布者，无并行写入。
- 范围：`scripts/cloudflare/backup-core.mjs`、`github-api.mjs`、
  `services/ops/` 及相关运维文档；不改变业务应用、数据库 schema、订阅或第三方凭据。
- 保留 KDPB001 envelope、gzip、AES-GCM/RSA-OAEP 和恢复私钥。下载与压缩按流处理，
  以 5 MiB 分片上传 R2；第一片等待最终 GCM tag 再上传，文件格式保持不变。
  完成后流式核对 SHA-256，单独的元数据回执绑定 R2 ETag，支持上传完成后的中断恢复。
- 1 GiB 原始导出上限是运行时间/流量保护，不是内存上限；常驻密文缓冲为两片，
  不缓存整库 SQL。跨平台上传也改用流，避免在后续复制环节重新缓冲整个密文。
- 验收：超过 16 MiB 的难压缩合成 SQL、多片上传失败与取消、缺失/变化的密文和回执、
  旧恢复格式、原生 Workerd/Workflows/R2 大文件流程；合并发布后重跑真实六库备份
  和私钥内存解密。GitHub token 缺失时 offsite 仍失败，R2 完整成功单独确认。
- 针对性单测 **22/22** 通过；原生 Workerd/Workflows/R2 验证 64 MiB 以上合成 SQL、
  分片上传、旧格式恢复、缺 token 失败和流式跨平台复制通过。
  初次测试发现 Node `CompressionStream` 提前读完源流；改为 `node:stream` +
  `node:zlib` 背压管道后，上传失败取消源流的断言通过，原生运行时也已重验。
  日志：`/tmp/codepi-ops-streaming-tests.log`、`/tmp/codepi-ops-streaming-runtime.log`。
- 全任务受影响检查 **7/7** 通过，包含 CF 脚本 **93/93**、Agent 工作流 **25/25**、
  Ops 单测 **14/14**、治理守门、119 个脚本/18 份 JSON lint、构建及原生执行。
  迁移追加守门与 `git diff --check` 通过，未变更依赖；最终差异自行审查，
  未另起独立审查 Agent。原生测试有 Miniflare RPC disposal 提示，流程断言均通过。
  日志：`/tmp/codepi-ops-streaming-checks.log`。
- `github-api.mjs` 使用 Workerd `FixedLengthStream` 包装跨平台请求体，
  使 GitHub 收到明确的 Content-Length；流错误或传输超时会取消复制，保留失败状态。
- 以八个服务上次成功发布的 `67f13bb85e7e287074190481487cdd64ed162451`
  累计核对发布范围，本次仅 Ops 受影响。控制面确认旧版本仍为
  `c4b6f267-967e-425f-9596-43d3b8a5d137`，未配置 `GITHUB_TOKEN`。

## 大库修复发布与真实验收

- PR #104 经 API squash 合并为 `da3324db27bf3562cf5515237f1f5b6dfe197488`；
  与已验证的 `69a9254349c729ed2104772c5f1cdba0fc86ee30` tree 完全一致。
  当前 Codex 从该干净、等于实时远程 main 的 detached checkout 持有生产锁发布，
  冻结安装、构建、治理、迁移守门与 `git diff --check` 通过；保留同树的本地检查证据。
- 仅发布 Ops，新 version 为 `7ec36e4e-0682-4e42-8e4a-fc87c030fd37`，
  唯一承接 100% 流量，`BUILD_SHA=da3324db27bf`。前一 version 为
  `c4b6f267-967e-425f-9596-43d3b8a5d137`；其余七个 Worker 运行代码未变，保留原版本。
- 控制面复查：Ops 无公网域名，workers.dev/preview URL 关闭；两个 Cron、
  BACKUPS/OPERATIONS 绑定、持久日志、查询串脱敏、Issues、私有 R2 和 14 天生命周期
  均保持预期。专用 token 仍仅为 D1 Write 与 Workers Scripts Read，未更新凭证或订阅。
- `acceptance-backup-da3324d` 于 `2026-10-19T07:49:36.763Z` 启动，
  `07:50:13.808Z` 完成六库 R2 密文、manifest 和完成回执。Auth/Desk/GU/GZH/Health/MCP
  均导出成功，修复了首发的 Health 容量失败。随后逐份核对 SHA-256、GCM、
  库 ID 与时间元数据，并用现有恢复私钥内存解密，**6/6** 通过；明文未保存。
  Git 外仅保留密文和 manifest，目录 `/tmp/codepi-ops-verified-ciphertext-jmFETR`。
- offsite 步骤因缺少 `GITHUB_TOKEN` 重试三次后失败，实例于
  `2026-10-19T07:51:45.060Z` errored；报告明确 `r2=complete`、`offsite=failed`、
  `reason=github_token_missing`，无跨平台成功回执。R2 完整成功不等于 Workflow 全绿。
- `node scripts/cloudflare/production-monitor.mjs --require-d1 --require-versions`
  **24/24** 通过，包含八个 Worker 的 main 版本核对、MCP 配对和 Health 同步新鲜度。
  手动 `acceptance-monitor-da3324d` 报告确认六库 R2 30 小时新鲜度通过，
  剩余两项失败为缺 GitHub token 的云端版本核对、缺少跨平台完整副本；
  重试三次后实例于 `2026-10-19T07:52:53.739Z` errored。
- 证据：`/tmp/codepi-ops-streaming-release-*.log/json`、
  `/tmp/codepi-ops-control-da3324d.json`、`/tmp/codepi-ops-instance-acceptance-*.json`、
  `/tmp/codepi-ops-backup-verified-da3324d.json`、
  `/tmp/codepi-ops-streaming-local-monitor.log`、
  `/tmp/codepi-ops-streaming-deployment-evidence.jsonl`。

## 当前剩余项

1. **Ops GitHub 运行凭证与自动复制已验收，不再是阻塞项。**
   所有者配置凭证后，确认 `GITHUB_TOKEN` 为加密 Secret。新 backup 实例
   `acceptance-github-backup-20261020T010216314Z` 为 `complete`，
   自动复制六库、112 份原件及 manifest 共 119 个附件到私有 Release `417899953`，
   自动跨平台回执匹配；从 GitHub 独立下载、摘要与内存解密全部通过。
   新 monitor 实例 `acceptance-github-monitor-20261020T010216314Z` 云端 26/26，
   包含八个 Worker 的 GitHub 版本核对及两处完整备份新鲜度。
   详见[跨平台验收](2026-10-20-github-offsite.md)。本机 `gh` 未转存到 Worker，
   旧失败报告与独立手动回执保留；本轮手动触发生产 Workflow，没有等待下一次 Cron。
2. 实际告警邮件送达、恢复私钥异机保管仍未验收。
   后续 [GU 非空恢复](2026-10-19-gu-online.md#2026-10-20-投资资料迁移与非空恢复)已完成六库密文校验、
   GU 隔离 D1 的 11 表/132 行恢复及全部 112 份真实资料的鉴权下载，不替代其他五库的
   导入演练。大正文恢复工具与证据已由 PR #109 合入 main；
   [两轮临时副本已清理](2026-10-19-gu-online.md#集成与清理结果)，正式 R2 与本机固定密文、
   原资料、生产数据和恢复私钥均保留。
   所有者已于 2026-10-19
   确认 Claude 手机端连接并使用 MCP；其他客户端及刷新、撤销等专项验收见
   [MCP 任务记录](2026-10-18-unified-mcp.md)。Health 30 小时新鲜度本轮已通过，
   不再列为当前故障。
3. GitHub Actions 账户额度问题与本次发布分开；本地验证和云端验收已实际执行，
   不将 Actions 未运行标为通过。
