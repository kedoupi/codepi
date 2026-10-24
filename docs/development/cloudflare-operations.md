# Cloudflare 定时运维

`services/ops/` 是支撑服务，不增加产品或长期环境。代码、PR、审核仍在 GitHub；
巡检和备份由 Cloudflare 执行，不依赖 Actions runner 或个人电脑在线。
生产部署继续遵循 [本地发布](local-release.md)。

v3 的 Project/Me 备份与巡检已随 `58bd615` 上线并完成真实验收：生产备份实例
`cf_93cea89d2248417b1d15530d606a6f32cb921ac8f6cbbf8c24486786218d5572`
覆盖八库、GU 112 件与 Me 空集合，私有 R2 密文与 manifest 验收通过；新云端巡检 34/34。
当前完整覆盖定义以 `backup-core.mjs` 的 `DATABASE_NAMES` / `ORIGINAL_COLLECTIONS` 为准。
v3 清单覆盖 Project/Me D1 和 Me 原文；下文六库/v2 的已有验收记录是旧覆盖的证据。

## 运行方式

| 组件 | 职责 |
| --- | --- |
| `codepi-ops` Worker | 两个 Cron，无公网 routes、workers.dev 或 preview URL |
| `codepi-ops` Workflow | 以确定的 instance ID 去重，每个步骤最多重试两次，指数退避 |
| `codepi-ops-backups` 私有 R2 | 全库与 GU/Me 原件密文、完成清单、运维报告，以及 `reports/traffic/samples.json`；流量基线按最近 7 天逐小时滚动 |

巡检每 30 分钟运行；备份为 UTC 18:00（北京时间次日 02:00）。
这些是平台定时任务，不保证精确到分钟。只能从实际 Workflow 实例和 R2 对象确认
执行结果，配置存在不代表已经执行。

## 发布后 Ops Observer

发布经理在生产 smoke 通过后生成一个 release manifest，并触发：

```bash
pnpm exec wrangler workflows trigger codepi-ops \
  '{"kind":"observe","release_id":"<release_id>","manifest":<release-manifest-json>}'
```

`kind: observe` 由 `OperationsWorkflow` 创建观察实例；manifest 必须包含 release_id、previous/new version，以及每个服务的 `migration_applied`、`secret_changed`、`binding_changed`、`external_side_effects`。`rollback_allowed` 由这些字段和 previous version 自动推导。观察固定 30 分钟，在 t=0、5、10、15、20、25、30 分钟轮询。

Observer 状态机为 `created → notified → observing`，健康结束为 `healthy_reported`；发现降级时进入 `degraded_notified` 后继续观察；严重时进入 `critical_detected`，再按安全门进入 `rollback_pending` 或 `rollback_blocked`，回滚核验后为 `rolled_back → rollback_verified`。失败为 `observation_failed`，重复事件以 event_id 幂等处理。

每轮与事件报告写入私有 R2 `codepi-ops-backups`：

```text
reports/observer/<release_id>/events/<event_id>.json
reports/observer/<release_id>/poll-0.json
...
reports/observer/<release_id>/poll-6.json
reports/observer/<release_id>/summary.json
```

`summary.json` 是观察完成后的用户确认依据。报告只保存版本、服务、指标、阈值结论、状态和已脱敏的错误摘要；禁止写入 token、secret、私钥、SQL、请求 query、业务正文或私人数据。

### Observer severity 与通知

- `degraded`：`invocations >= 20` 且 error rate `>= 5%`，或 p99 `>=` 基线的 2 倍。
- `critical`：版本身份不一致立即触发；核心契约硬失败连续 2 轮；或 error rate `>= 20%` 且 errors `>= 20` 连续 2 轮。
- 否则为 `healthy`。阈值按每个服务计算，低于 invocation 门槛不因比例单独升级。

发布开始、降级/严重事件和观察完成/健康结论写入 GitHub 长驻 Issue **`codepi release observations`** 的 comment，label 为 `codepi-release-observations`；event_id 用于幂等。失败告警继续沿用 Cloudflare Workers Issues 邮件链，不以 GitHub comment 取代。

### 回滚安全门

严重状态只有在 manifest 的所有受影响服务均 `rollback_allowed=true` 时进入 `rollback_pending`；任一 migration、secret、binding 或 external side effect，或缺少 previous version，自动进入 `rollback_blocked`。允许时由 `scripts/cloudflare/rollback-worker.mjs` 执行：回滚前必须核对 expected active version 且单一版本承载 100% 流量，使用 percentage deployment POST 切换并回读校验；不支持 force。回滚后进入 `rollback_verified` 才算完成，否则保持失败/阻断并立即通知用户。

回滚使用独立的 `CLOUDFLARE_ROLLBACK_TOKEN`，通过 `node scripts/cloudflare/provision-ops.mjs rollback-credential` 创建，权限仅为 Workers Scripts Write；现有 `CLOUDFLARE_API_TOKEN` 不用于回滚且权限不变。凭证值永不写入文档、报告或日志。

云端巡检还查询 `codepi.app` zone 的 hourly Analytics，追加
`zone traffic threats exceed threshold` 与 `zone traffic requests surge` 两个结果。正常
阈值计算产生的 threats 结果带 `advisory: true`：扫描流量被 WAF 拦截时仍写入完整
报告与基线，但不使本轮生产 monitor 失败。requests 流量结果始终是阻断性检查；
基础设施、网络、权限、GraphQL、Zone Analytics 或 R2 基线损坏/写入失败等错误
没有 `advisory` 标记，继续 fail-closed 并使本轮失败。最近完整 UTC 小时缺失时也失败；
冷启动前 24 个历史小时只使用绝对阈值，之后按同一 UTC 时段的七天均值判定。

Ops token 最小权限为 `D1 Write + Workers Scripts Read + Zone Analytics Read`；
后者仅用于 `codepi.app` zone 的 GraphQL Analytics 查询。

云端版本巡检使用 GitHub REST API，将登记 Worker 的活跃 `BUILD_SHA` 与固定 main
快照比较。与本地 Git 实现共用发布范围表；逐提交读取文件列表，不使用 compare API
的净差异，避免漏掉 revert、删除、重命名和 merge。最多检查 500 个提交、每提交
最多 3,000 个文件；超过边界、历史缺失、非祖先、分流或缺少凭证均失败。

详细结果仅存 `reports/monitor/<instance>.json` 和 `latest.json`。失败实例保持失败；
下次 monitor Cron 创建新实例后，检查上一份报告是否成功且不超过 75 分钟。失败或
停滞同时表现为 Cron 调用错误，以便现有 Cloudflare Issues 通知策略捕获。
通知策略启用与邮件真实送达是不同验收，不能只凭日志宣称邮件已收到。

### Issues 自动触发与送达

Issues 检测、通知策略和自动触发规则是三个独立配置。`observability.issues.enabled=true`
使 Worker 记录问题；邮件策略提供目的地；自动规则决定何时发送。
仅有前两项不能作为自动通知就绪的证据。控制面核对须读取
`GET /accounts/<account_id>/workers/observability/issues/automations`，按
`scripts/cloudflare/release-scope.mjs` 的全部 Worker 核对 service、enabled、policy ID 与触发条件。
不为此扩大 Ops 运行时 token 权限，管理操作继续使用已授权的 API 身份。

| 规则 | 每个 Worker 的配置 | 行为 |
| --- | --- | --- |
| 首次出现 | `afterOccurrences=1` | 问题首次达到阈值时通知一次，不在每次 occurrence 后重复发送 |
| 静默后复发 | `afterInactivitySeconds=3600` | 已有问题至少一小时没有新 occurrence 后再次出现时通知；持续报错不作为周期提醒 |

20 条规则均按具体 Worker 限定，引用现有 Workers Issues 邮件策略；资源 UUID 维护在
[登记表](cloudflare-resource-registry.md#2026-10-20-issues-自动规则与临时验收资源)。
新增或退役 Worker 时同步管理其规则；不要用账户级规则扩大到未知服务。
首次规则不为已经越过阈值的历史问题补发告警；复发规则也不追溯历史活动。

2026-10-20 已用无生产 binding 的临时 Worker 实际触发一次异常，确认
`initiatedBy=automatic`、执行成功、原策略发送历史及 Gmail 实际收件一致，随后清理临时
Worker/规则并复查生产配置。该次覆盖首次自动触发链路；静默后复发条件为控制面核对。
重新验收时继续使用隔离合成数据，分别保存 issue/run/history/message ID 与时间，
不保存邮件正文、地址或退订凭证。详情见[验收记录](tasks/2026-10-20-workers-issues.md)。

## 数据库备份

每库一个持久步骤：D1 polling export → 流式下载 → gzip → AES-256-GCM →
RSA-3072 公钥封装 → R2 分片上传。格式与本地 `d1-backup.mjs` / `d1-restore.mjs` 相同，
公钥只有一个来源；恢复私钥不进入 Worker、Workflow 或 R2。

`DATABASE_NAMES` 中各库串行处理，不缓存整库 SQL。通过带背压的压缩管道和 5 MiB 密文分片限制常驻缓冲；
KDPB001 格式的认证 tag 位于密文之前，因此第一片等最终 tag 就绪后最后上传。
上传失败会取消源流并中止分片上传，不生成完成清单。原始 SQL 上限为 1 GiB，
用于限制单次运行的时间与流量，超过上限明确失败。这不是 Worker 内存上限，
也不再使用原来的 16 MiB 整库缓冲保护。D1 导出可能暂时影响对应库，故安排在低峰。
SQL、解密密钥和 D1 signed URL 都不作为持久步骤返回值。

对象在 `backups/<instance>/` 下，全部必需库和 GU/Me 有索引原件完成后才写 v3 `manifest.json`。
上传完成后再次流式计算密文 SHA-256，在同前缀的 `.receipt.json` 中绑定 R2 ETag、
库身份和摘要。成功步骤在重试时复用已写入的密文，保持 envelope 和 manifest 一致；
若上传提交后、回执写入前中断，重试只对已提交的密文补算摘要，不重新导出。
密文过期、身份或 ETag 不一致时失败，需新建备份实例。
半途失败不得写完整成功记录。`reports/backup/r2-success.json` 表示当前全库及 GU/Me 原件 R2 完整备份，
不表示已有 Cloudflare 之外的副本。

## GU 原件

GU 集合使用 `GU → codepi-gu#GuMaterialsBackup`，named entrypoint 只提供
分页索引和单件流；默认 HTTP handler 不映射它，既不开放内部 URL，也不增加同步 secret。
Ops 不获得 GU D1/R2 binding。该能力随 GU 先发布，随后发布 Ops 并运行首次完整备份；
未完成首次备份时，新巡检会拒绝旧 D1-only 回执。

GU 资料索引当前只追加。全部必需库导出后，GU 从 D1 取得 rowid 上限，再按固定上限分页，
覆盖导出时已有的索引；备份期间后续新上传留给下一次备份。原件清单可能比 D1 导出
稍新，恢复时只将 D1 引用视为已登记资料，额外原件单独计数，不自动改写账户或资料索引。
若以后增加删除、修改索引或重建 rowid，必须先调整此一致性约定。
未被 D1 索引引用的失败上传残留不属于这份清单；不会自动删除或宣称已备份。

原件经同一 gzip/AES-GCM/RSA envelope 流式写入
`backups/<instance>/materials/gu-material-<UUID>.bin.enc`。清单和持久步骤只含
UUID、object key、大小及摘要，不含文件名或正文。逐件验证源大小和 SHA-256 后才提交，
缺失、损坏、流中断均失败。单件 8 MiB、最多 1000 件；超限明确失败，需要先扩容并验收。
原件沿用 ETag/identity/receipt 的中断恢复，不在重试时替换已经提交的密文。

历史 v2 manifest 含 `databases` 与单一 GU `materials`；当前 v3 使用
`materials.collections` 分别记录 GU/Me 的来源、冻结上限、件数与逐件索引；
每件同时记录源 `source_bytes`/`source_sha256` 和密文 `bytes`/`sha256`。
KDPB001 envelope 保持 v1，原 D1 解密工具仍可使用。旧 `d1-backup.mjs` 与手动 Actions
应急入口只导出 D1，不生成原件完整覆盖回执。

备份完整成功的唯一标准是：所有必需 D1、GU/Me 原件均完成加密写入私有 R2，校验通过后提交
v3 `manifest.json` 与 `reports/backup/r2-success.json`。`reports/backup/latest.json` 记录
`r2=complete`、`ok=true`；Workflow 不再调用 GitHub Release，也不读取 `GITHUB_TOKEN`。
R2 与 D1 同账户，不能覆盖 Cloudflare 账户整体不可用；需要异机恢复时由人工在仓库之外导出
完整 R2 前缀并按 manifest 校验。历史 GitHub Release 不是当前备份通道，仍需在公开仓库前
按授权清理，不能把历史附件当作当前自动备份成功证据。

恢复流程及 MCP 授权状态恢复限制见 [备份 runbook](cloudflare-backup-restore.md)。

## Me 导入原文

`ME → codepi-me#MeImportsBackup` 是另一个限定的只读 named entrypoint，
提供 `imports` 追加索引的冻结分页与单件原文流。只读取成功 finish 的导入；
未完成分块不作为正式原文备份。Ops 不绑定 Me D1/R2，也不持有业务登录凭证。
原文写入 `backups/<instance>/materials/me-import-<ULID>.bin.enc`，
每件核对索引大小和 SHA-256，再使用同一公钥 envelope 加密。

GU 和 Me 各自最多 1000 件、单件最多 8 MiB；超限使完整备份失败。
即使某集合没有原件，v3 仍须保留该集合的空记录；不能通过缺省集合冒充已覆盖。
恢复使用 `originals-restore.mjs` 同时核验两类索引与原文；
旧 GU-only 工具留给历史 v2 副本，不能验收 v3。

## 首次初始化与凭证

在干净且等于实时远程 main 的源码中，持有生产发布锁后：

```bash
node scripts/cloudflare/provision-ops.mjs storage
pnpm --dir services/ops build
node scripts/cloudflare/deploy-worker.mjs ops <完整 main SHA>
node scripts/cloudflare/provision-ops.mjs credentials
```

storage 阶段只针对登记的运维桶设置私有访问与两个 14 天生命周期前缀。
credentials 阶段为运维服务创建账户 token，仅授予 `D1 Write`（D1 export API 要求）
与 `Workers Scripts Read`。没有 Worker 发布、DNS、R2 管理或 token 创建权限。
R2 写入通过 bucket binding；不会把本机的管理 token 放进 Worker。
新值在内存中直写 `CLOUDFLARE_API_TOKEN` secret，不输出或保存；既有 secret 不轮换。
两步间断时按返回的非敏感 token ID 调查，不能通过反复创建 token 掩盖故障。

GitHub API 仍可用于巡检所需的仓库历史读取；Ops 不再配置或读取用于备份复制的
`GITHUB_TOKEN`。历史 Release 中的密文附件属于公开前待清理对象，不是当前备份成功标准。
公开前由仓库所有者在 GitHub 控制面清理历史 Release，并在仓库外保留经授权的恢复副本；
本任务不执行远程删除。

## 操作与证据

从 `services/ops/` 使用 workspace 锁定的 Wrangler：

```bash
pnpm exec wrangler workflows trigger codepi-ops '{"kind":"monitor"}'
pnpm exec wrangler workflows trigger codepi-ops '{"kind":"backup"}'
pnpm exec wrangler workflows instances list codepi-ops
pnpm exec wrangler workflows instances describe codepi-ops <instance-id>
pnpm exec wrangler r2 bucket lifecycle list codepi-ops-backups
```

创建 backup 实例会读取生产库并写入密文，应按已授权运维范围串行执行。
报告或密文通过 R2 API/CLI 下载到 Git 之外；严禁把解密结果写入仓库。
本地验证使用 `pnpm --dir services/ops test`、`build` 和 `test:runtime`；
后者真实运行 Workerd、Workflows、GU named RPC 和本地 D1/R2，只使用合成数据与网络 stub；
并把备份恢复至另一组隔离 D1/R2，验证匿名拒绝、会话下载与逐字节一致。

原 `production-monitor.yml` / `d1-backup.yml` 保留为手动应急入口，已去掉 push 和
schedule。GitHub CI 仍可验证代码，其账户分钟耗尽不影响 CF 定时任务。
Cloudflare 本身不可用时，不能依靠同平台调度监控自身；跨平台密文与恢复私钥的独立
保管仍是恢复边界。资源事实和本次上线证据见
[登记表](cloudflare-resource-registry.md) 与 [任务记录](tasks/2026-10-19-cloudflare-operations.md)。
