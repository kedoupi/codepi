# Cloudflare 定时运维

`services/ops/` 是支撑服务，不增加产品或长期环境。代码、PR、审核仍在 GitHub；
巡检和备份由 Cloudflare 执行，不依赖 Actions runner 或个人电脑在线。
生产部署继续遵循 [本地发布](local-release.md)。

## 运行方式

| 组件 | 职责 |
| --- | --- |
| `codepi-ops` Worker | 两个 Cron，无公网 routes、workers.dev 或 preview URL |
| `codepi-ops` Workflow | 以确定的 instance ID 去重，每个步骤最多重试两次，指数退避 |
| `codepi-ops-backups` 私有 R2 | 六库与 GU 原件密文、完成清单和运维报告，按前缀保留 14 天 |
| GitHub API | 私有仓库 main/逐提交历史读取；凭证就绪后把密文复制到私有 Release |

巡检每 30 分钟运行；备份为 UTC 18:00（北京时间次日 02:00）。
这些是平台定时任务，不保证精确到分钟。只能从实际 Workflow 实例和 R2 对象确认
执行结果，配置存在不代表已经执行。

## 巡检与失败

复用 `scripts/cloudflare/monitor-core.mjs` 的 Auth、四个产品登录契约、MCP、
旧泄漏入口与 Health 整轮同步新鲜度断言。原来的本地 `production-monitor.mjs`
命令继续可用。云端额外检查 R2/跨平台的六库与 GU 原件完整备份在 30 小时内完成。
旧版仅六库的成功回执缺少 `materials` 覆盖信息，会失败而不会继续当作完整备份。

云端版本巡检使用 GitHub REST API，将八个 Worker 的活跃 `BUILD_SHA` 与固定 main
快照比较。与本地 Git 实现共用发布范围表；逐提交读取文件列表，不使用 compare API
的净差异，避免漏掉 revert、删除、重命名和 merge。最多检查 500 个提交、每提交
最多 3,000 个文件；超过边界、历史缺失、非祖先、分流或缺少凭证均失败。

详细结果仅存 `reports/monitor/<instance>.json` 和 `latest.json`。失败实例保持失败；
下次 monitor Cron 创建新实例后，检查上一份报告是否成功且不超过 75 分钟。失败或
停滞同时表现为 Cron 调用错误，以便现有 Cloudflare Issues 通知策略捕获。
通知策略启用与邮件真实送达是不同验收，不能只凭日志宣称邮件已收到。

## 六库备份

每库一个持久步骤：D1 polling export → 流式下载 → gzip → AES-256-GCM →
RSA-3072 公钥封装 → R2 分片上传。格式与本地 `d1-backup.mjs` / `d1-restore.mjs` 相同，
公钥只有一个来源；恢复私钥不进入 Worker、Workflow 或 R2。

六库串行处理，不缓存整库 SQL。通过带背压的压缩管道和 5 MiB 密文分片限制常驻缓冲；
KDPB001 格式的认证 tag 位于密文之前，因此第一片等最终 tag 就绪后最后上传。
上传失败会取消源流并中止分片上传，不生成完成清单。原始 SQL 上限为 1 GiB，
用于限制单次运行的时间与流量，超过上限明确失败。这不是 Worker 内存上限，
也不再使用原来的 16 MiB 整库缓冲保护。D1 导出可能暂时影响对应库，故安排在低峰。
SQL、解密密钥和 D1 signed URL 都不作为持久步骤返回值。

对象在 `backups/<instance>/` 下，全部六库和 GU 有索引原件完成后才写 v2 `manifest.json`。
上传完成后再次流式计算密文 SHA-256，在同前缀的 `.receipt.json` 中绑定 R2 ETag、
库身份和摘要。成功步骤在重试时复用已写入的密文，保持 envelope 和 manifest 一致；
若上传提交后、回执写入前中断，重试只对已提交的密文补算摘要，不重新导出。
密文过期、身份或 ETag 不一致时失败，需新建备份实例。
半途失败不得写完整成功记录。`reports/backup/r2-success.json` 表示六库及 GU 原件 R2 完整备份，
不表示已有 Cloudflare 之外的副本。

## GU 原件

Ops 仅绑定 `GU → codepi-gu#GuMaterialsBackup`，GU 的 named entrypoint 只提供
分页索引和单件流；默认 HTTP handler 不映射它，既不开放内部 URL，也不增加同步 secret。
Ops 不获得 GU D1/R2 binding。该能力随 GU 先发布，随后发布 Ops 并运行首次完整备份；
未完成首次备份时，新巡检会拒绝旧 D1-only 回执。

GU 资料索引当前只追加。六库导出后，GU 从 D1 取得 rowid 上限，再按固定上限分页，
覆盖导出时已有的索引；备份期间后续新上传留给下一次备份。原件清单可能比 D1 导出
稍新，恢复时只将 D1 引用视为已登记资料，额外原件单独计数，不自动改写账户或资料索引。
若以后增加删除、修改索引或重建 rowid，必须先调整此一致性约定。
未被 D1 索引引用的失败上传残留不属于这份清单；不会自动删除或宣称已备份。

原件经同一 gzip/AES-GCM/RSA envelope 流式写入
`backups/<instance>/materials/gu-material-<UUID>.bin.enc`。清单和持久步骤只含
UUID、object key、大小及摘要，不含文件名或正文。逐件验证源大小和 SHA-256 后才提交，
缺失、损坏、流中断均失败。单件 8 MiB、最多 1000 件；超限明确失败，需要先扩容并验收。
原件沿用 ETag/identity/receipt 的中断恢复，不在重试时替换已经提交的密文。

v2 manifest 保留 `databases`，新增 `materials` 的来源、冻结上限、件数与逐件索引；
每件同时记录源 `source_bytes`/`source_sha256` 和密文 `bytes`/`sha256`。
KDPB001 envelope 保持 v1，原 D1 解密工具仍可使用。旧 `d1-backup.mjs` 与手动 Actions
应急入口只导出 D1，不生成原件完整覆盖回执。

有 `GITHUB_TOKEN` 时，逐个把密文经流式 API 上传私有 Release，manifest 最后上传，
按 GitHub 返回的 SHA-256 验证。重试只接受名称、状态和 digest 完全匹配的既有附件，
不删除或覆盖不一致的附件。全部完成后才写
`reports/backup/offsite-success.json`。Release 不消耗 Actions runner；
当前实现保留这些密文 Release，清理为独立操作。
未配置凭证或上传失败时，保留已完成的 R2 备份，标记 `offsite=failed`，
Workflow 仍失败，不把同账户 R2 当成跨平台备份。

恢复流程及 MCP 授权状态恢复限制见 [备份 runbook](cloudflare-backup-restore.md)。

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

`GITHUB_TOKEN` 需要所有者的一次凭证配置：只选 `kedoupi/kdp.cool`，
授予 **Contents: Read and write**，用于历史读取和备份附件。不需要 Actions 或账户管理
权限。通过 Wrangler secret 输入配置，不放在命令行参数、源码、PR 或聊天中。
现有 ChatGPT GitHub 连接器支持本次仓库操作，但不是 Worker 可长期调用的凭证。
未配置该 secret 时，GitHub 相关检查和跨平台备份必须保持失败。

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
