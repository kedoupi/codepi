# Cloudflare 定时运维

`services/ops/` 是支撑服务，不增加产品或长期环境。代码、PR、审核仍在 GitHub；
巡检和备份由 Cloudflare 执行，不依赖 Actions runner 或个人电脑在线。
生产部署继续遵循 [本地发布](local-release.md)。

## 运行方式

| 组件 | 职责 |
| --- | --- |
| `codepi-ops` Worker | 两个 Cron，无公网 routes、workers.dev 或 preview URL |
| `codepi-ops` Workflow | 以确定的 instance ID 去重，每个步骤最多重试两次，指数退避 |
| `codepi-ops-backups` 私有 R2 | 六库密文、完成清单和运维报告，按前缀保留 14 天 |
| GitHub API | 私有仓库 main/逐提交历史读取；凭证就绪后把密文复制到私有 Release |

巡检每 30 分钟运行；备份为 UTC 18:00（北京时间次日 02:00）。
这些是平台定时任务，不保证精确到分钟。只能从实际 Workflow 实例和 R2 对象确认
执行结果，配置存在不代表已经执行。

## 巡检与失败

复用 `scripts/cloudflare/monitor-core.mjs` 的 Auth、四个产品登录契约、MCP、
旧泄漏入口与 Health 整轮同步新鲜度断言。原来的本地 `production-monitor.mjs`
命令继续可用。云端额外检查 R2/跨平台六库备份在 30 小时内完成。

云端版本巡检使用 GitHub REST API，将八个 Worker 的活跃 `BUILD_SHA` 与固定 main
快照比较。与本地 Git 实现共用发布范围表；逐提交读取文件列表，不使用 compare API
的净差异，避免漏掉 revert、删除、重命名和 merge。最多检查 500 个提交、每提交
最多 3,000 个文件；超过边界、历史缺失、非祖先、分流或缺少凭证均失败。

详细结果仅存 `reports/monitor/<instance>.json` 和 `latest.json`。失败实例保持失败；
下次 monitor Cron 创建新实例后，检查上一份报告是否成功且不超过 75 分钟。失败或
停滞同时表现为 Cron 调用错误，以便现有 Cloudflare Issues 通知策略捕获。
通知策略启用与邮件真实送达是不同验收，不能只凭日志宣称邮件已收到。

## 六库备份

每库一个持久步骤：D1 polling export → 内存下载 → gzip → AES-256-GCM →
RSA-3072 公钥封装 → R2。格式与本地 `d1-backup.mjs` / `d1-restore.mjs` 相同，
公钥只有一个来源；恢复私钥不进入 Worker、Workflow 或 R2。

每个原始 SQL 导出上限 16 MiB，六库串行处理，避免 Worker 内存耗尽。超过上限必须
报错并评估流式导出，不静默截断。D1 导出可能暂时影响对应库，故安排在低峰。
SQL、解密密钥和 D1 signed URL 都不作为持久步骤返回值。

对象在 `backups/<instance>/` 下，全部六库完成后才写 `manifest.json`。
成功步骤在重试时复用已写入的密文，保持 envelope 和 manifest 一致；
半途失败不得写完整成功记录。`reports/backup/r2-success.json` 表示六库 R2 完整备份，
不表示已有 Cloudflare 之外的副本。

有 `GITHUB_TOKEN` 时，逐个把密文经 API 上传私有 Release，manifest 最后上传，
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
pnpm exec wrangler workflows trigger codepi-ops --params '{"kind":"monitor"}'
pnpm exec wrangler workflows trigger codepi-ops --params '{"kind":"backup"}'
pnpm exec wrangler workflows instances list codepi-ops
pnpm exec wrangler workflows instances describe codepi-ops <instance-id>
pnpm exec wrangler r2 bucket lifecycle list codepi-ops-backups
```

创建 backup 实例会读取生产库并写入密文，应按已授权运维范围串行执行。
报告或密文通过 R2 API/CLI 下载到 Git 之外；严禁把解密结果写入仓库。
本地验证使用 `pnpm --dir services/ops test`、`build` 和 `test:runtime`；
后者真实运行 Workerd、Workflows 和本地 R2，只使用合成数据与网络 stub。

原 `production-monitor.yml` / `d1-backup.yml` 保留为手动应急入口，已去掉 push 和
schedule。GitHub CI 仍可验证代码，其账户分钟耗尽不影响 CF 定时任务。
Cloudflare 本身不可用时，不能依靠同平台调度监控自身；跨平台密文与恢复私钥的独立
保管仍是恢复边界。资源事实和本次上线证据见
[登记表](cloudflare-resource-registry.md) 与 [任务记录](tasks/2026-10-19-cloudflare-operations.md)。
