# D1 与私有原件备份恢复 runbook

当前环境为 local + production。D1 Time Travel 用于快速回溯；加密导出用于在
Cloudflare 账户之外保存一份可恢复副本。工作流文件存在不代表已产生备份，当前调度与
最新验收见 [Cloudflare 定时运维任务](tasks/2026-10-19-cloudflare-operations.md)。
[平台可靠性任务](tasks/2026-10-18-platform-reliability.md) 和
[MCP 运维补齐](tasks/2026-10-19-mcp-operations.md) 保留早期实现与故障证据，
不作为当前调度或待办清单。

## 2026-10-20 新覆盖

Project/Me D1 与 Me 导入原文已纳入 v3 生产备份并完成隔离恢复验收。
必需库名来自 `backup-core.mjs` 的 `DATABASE_NAMES`；旧库 UUID 固定，新库必须精确名称解析。
原件集合来自 `ORIGINAL_COLLECTIONS`：GU `gu_materials` 和 Me `imports`，分别通过
`GuMaterialsBackup` / `MeImportsBackup` 读取，Ops 不直接绑定业务桶。

新 v3 manifest 必须包含全部数据库和两组原件；缺少某组（包括空组记录）也不算完整备份。
v2 仍支持历史恢复，不能用它证明 Me 原文已备份。恢复必须固定同一次 manifest，先恢复
隔离 D1，按对应索引、大小、SHA-256 校验和恢复隔离 R2，然后用该领域的鉴权流程验收。
不把恢复的 SSO/MCP 授权状态直接送回生产，私钥继续仅由所有者保管。

2026-10-20 生产 v3 实例
`cf_93cea89d2248417b1d15530d606a6f32cb921ac8f6cbbf8c24486786218d5572`
已从 GitHub 分片副本恢复 Auth、Desk、GU、GZH、Health、MCP、Project、Me 八个全新 D1：
98 张表、138,986 行逐字段值和类型比对一致，`quick_check` 与外键检查通过。GU 112 份
原件逐件摘要通过，索引 112、额外原件 0；Me 正式集合为 0 件，空集合记录被明确覆盖。
MCP 临时库清除历史 token、授权码、同意请求和 SSO 会话，保留客户端注册。全部临时
D1、明文和日志已清理，生产绑定未改。尚未有非空 Me 导入原文的恢复证据。

## 备份架构

- 自动任务由 `services/ops` 的 Cloudflare Cron/Workflows 执行，每日 UTC 18:00
  （北京时间次日 02:00）；原 `d1-backup.yml` 为手动应急入口，不再定时消耗 runner。
- 通过 D1 polling export API 依次导出 `DATABASE_NAMES` 中的全部生产库（包含 MCP 授权库）。导出可能暂时影响该库请求，
  因此安排在低峰；不创建第二套业务环境。
- 每份 SQL 在内存中 gzip 压缩，再用独立随机 AES-256-GCM 密钥加密；
  RSA-3072 OAEP/SHA-256 公钥封装该密钥。库名、库 UUID、时间和公钥指纹随
  envelope 一起通过 GCM 校验。SQL 明文不写磁盘或 Actions artifact。
- 私有 R2 `codepi-ops-backups` 保存密文与完成清单，按前缀保留 14 天。全部必需库和
  GU/Me 有索引原件成功后才提交 v3 manifest；跨平台副本经 GitHub API 存私有 Release，独立记录回执。
  缺少 GitHub token 或复制失败时，不得称为跨平台备份完成。Release 当前不自动删除。
- R2 与 D1 同账户，不能覆盖 Cloudflare 账户整体不可用。专用运维 token 仅有
  D1 Write（导出要求）和 Workers Scripts Read，不将本机管理 token 放入 Worker。
  运行细节见[定时运维](cloudflare-operations.md)。恢复私钥不上云。
- 手动 Actions 仍可输出相同格式的 14 天 artifact，保留应急恢复入口；
  已记录的账户分钟限制见任务证据，不能将工作流文件存在当作该入口当前可用。

| 数据库 | 配置来源 |
| --- | --- |
| `codepi-auth` | `services/auth/wrangler.jsonc` |
| `codepi-desk` | `apps/web/wrangler.toml` |
| `codepi-gu` | `apps/gu/wrangler.toml` |
| `codepi-gzh` | `apps/gzh/wrangler.toml` |
| `codepi-health` | `apps/health/workers/api/wrangler.toml` |
| `codepi-mcp` | `services/mcp/wrangler.toml` 精确名称解析；UUID 由资源登记表核对 |
| `codepi-project` | `apps/project/wrangler.toml`；生产 UUID `03612540-2ac6-4dd2-9bf6-ed431dda17c9` |
| `codepi-me` | `apps/me/wrangler.toml`；生产 UUID `7236c118-1f92-4b07-8283-e731c2771953` |

库 UUID 固定在 `scripts/cloudflare/backup-core.mjs`，测试校验其与实际 binding
一致，并校验所有 managed production D1 均在清单中。原五个生产库已验证可取得
Time Travel bookmark；六库本机导出和解密记录保留在早期任务中。

2026-10-20 的[GU 验收](tasks/2026-10-19-gu-online.md#2026-10-20-投资资料迁移与非空恢复)
已确认 Cloudflare Workflow 完成六库和 112 份资料的 R2 密文、v2 manifest 与完整回执。
现有恢复私钥内存解密六库通过；真实 GU SQL 导入隔离 D1 后，11 张表、132 行全部内容
核对一致，112 份原件及其资料索引、鉴权下载全部匹配生产导出。
上述两轮演练当时的跨平台复制因缺少 `GITHUB_TOKEN` 失败，该次执行不替代后续
定时新鲜度和异机恢复演练。

2026-10-20 后续[跨平台验收](tasks/2026-10-20-github-offsite.md)已将定时备份
`backup-20261019T180026000Z` 手动复制到私有 GitHub Release：
六份 D1 密文、112 份原件密文和 manifest 共 119 个附件。
从 GitHub 下载的六库和全部原件已通过摘要、身份及既有私钥内存解密；
未写明文或重新导入生产库。手动回执独立记录，未改写自动备份状态。
随后所有者配置凭证，新实例 `acceptance-github-backup-20261020T010216314Z`
已由生产 Workflow 自动复制到私有 Release `417899953`，生成自动跨平台成功回执。
全部 119 个附件独立下载、六库与 112 份原件的摘要、GCM、身份和内存解密通过，
未写明文或导入生产库；新云端巡检 26/26。
本轮手动触发 Workflow 验收自动链路，下一次 Cron 定时运行仍以实际报告为准。
详细时间、版本和未覆盖项见上述跨平台记录。

随后[其余五库恢复验收](tasks/2026-10-20-recovery-acceptance.md)直接使用上述自动
GitHub 副本，Auth/Desk/GZH/Health/MCP 共 47 表、138,106 行导入全新隔离 D1，
全部 schema、字段值和类型、完整性及外键检查通过。MCP 另在隔离库清除五张表中的
快照授权状态，两个客户端注册保持一致；五库及本机临时文件均已清理。
六库各有真实导入证据，不表示跨库事务快照或跨账户服务重建已验收。
平台事件邮件已确认实际收件；[后续告警验收](tasks/2026-10-20-workers-issues.md)又补齐
Workers Issues 自动触发、发送与实际收件，恢复私钥异机保管继续保留 TODO。

恢复工具修复已由 PR #109 合入 main；两轮 GU 隔离 D1/R2 和私人临时文件已按授权清理，
正式 R2 备份保留。两次演练下载的完整密文另存
`/Users/codepi/.local/share/kdp.cool/backups/<backup-instance>/`，保留原 manifest 和目录结构，
大小/SHA-256 已核对，未保留解密原件或 SQL。该目录是本次手动保留的固定副本，
不代表自动异机托管或新增的自动保留策略；详情见[清理与保留证据](tasks/2026-10-19-gu-online.md#集成与清理结果)。

GU 原件链路已按 GU → Ops 顺序发布并核验只读 named RPC。
首次发布时的 0 件恢复与合成上传记录保留为历史证据；后续非空恢复另有完整真实验收。
原件通过 GU 的只读 named RPC 取得，公钥格式、私钥位置与 D1 共用；
原件的大小和内容 SHA-256、密文大小和 SHA-256 分别保存。完整回执含原件覆盖信息，
旧 D1-only 回执不满足新巡检。具体一致性与上限见[定时运维](cloudflare-operations.md#gu-原件)。

历史 Actions 六库 artifact 未生成的故障不再代表当前自动备份状态，也不要求恢复旧
Actions 调度。实际 Time Travel 可回溯窗口以账户套餐和控制面为准，不在本 runbook
假定固定天数。

## 密钥保管

- Git 中只有 `scripts/cloudflare/backup-public-key.pem`，为 RSA SPKI 公钥。
  它允许 CI 加密，不能用于解密。
- 本次生成的恢复私钥在
  `~/.config/kdp.cool/backup/recovery-private-key.pem`，文件权限为 `0600`，
  不属于仓库，也不上传到 Actions。
- 需要由所有者把恢复私钥备存到密码管理器或另一处离线介质。当前机器上的一份私钥
  不是异地密钥备份；丢失私钥后无法恢复对应密文。
- 更换公钥之前生成新的私钥并验证恢复，保留旧私钥直到旧备份全部过期。
  `manifest.json` 和每份 envelope 的 `key_id` 用于选择对应私钥。
- 备份恢复密钥与 Health 的 `TOKEN_ENCRYPTION_KEY` 是两套独立密钥。
  数据库导出包含加密的 provider tokens，但不包含 Worker runtime secrets；
  迁移到新账户后还需重建绑定和第三方配置，或重新连接 Oura。

## 恢复流程

恢复由人工启动，不能由定时工作流自动覆盖生产数据。

1. 确认事故时间与目标库。优先评估 D1 Time Travel；直接回溯生产库属于单独的
   事故操作，先记录目标 bookmark、影响范围和授权。
2. 下载目标完整的 R2 前缀或私有 Release 附件到仓库之外（历史 Actions artifact 仍适用）。
   分片 Release 按下节索引收齐全部附件。检查 `manifest.json`
   是否包含所需库、公钥指纹及导出时间；下载解压后的密文可用 SHA-256 对照 manifest。
3. 使用仓库约定的 Node 24 环境，准备匹配的恢复私钥及本机环境变量 `CLOUDFLARE_ACCOUNT_ID` /
   `CLOUDFLARE_API_TOKEN`，使用 D1 写权限。不把值放进命令参数或日志。
   恢复前通过精确名称查询取得 `DATABASE_NAMES` 全部生产 UUID；也可从已核验配置提供完整
   `D1_DATABASE_IDS` JSON 映射。缺库、重复身份、不完整映射或无法查询均停止恢复。
4. 从仓库根目录，以当前 lockfile 中的 Wrangler 创建一个全新的空恢复库，
   记录其 UUID。不要使用任何生产库 UUID，不向已存数据的库直接导入。
5. 执行恢复脚本：

   ```bash
   node scripts/cloudflare/d1-restore.mjs \
     --file /path/outside-repo/codepi-gu.sql.enc \
     --private-key "$HOME/.config/kdp.cool/backup/recovery-private-key.pem" \
     --database-id <new-empty-D1-UUID>
   ```

   脚本归一化 UUID 大小写并排除完整生产清单和密文源库，验证密文认证标签和匹配私钥，通过只读查询确认
   目标无业务表/视图，再调用 workspace 固定版本的 Wrangler 导入。临时 SQL 文件
   权限为 `0600`，所在临时目录为 `0700`，成功或普通异常退出时均删除。
   机器断电或强制终止后应检查操作系统临时目录并清理遗留明文。
   Wrangler 的 SQL 输出不会转发到终端；失败只记录退出状态。
   大正文可能让 D1 导出的单条 `INSERT` 超过 SQL 长度限制。恢复工具用 Node 内置 SQLite
   解析语句，将超限 `INSERT` 的文本字面量分块写入一次性辅助表，再读取完整值完成原插入，
   最后移除辅助表；每条生成语句不超过 80,000 字节，仍由 Wrangler 整批导入。
   普通导出保持原样，不缩短正文、不改变备份格式。超长 BLOB 或无法安全转换的 SQL
   在导入前明确失败，错误不回显私人 SQL。此路径已通过本地合成测试和本次真实 GU 恢复；
   修复的提交与集成状态见任务记录。
   SQL 解析从短前缀开始按需扩大，只接受完整语句边界或完整剩余输入，避免多行 INSERT
   截断和对大量普通行反复解析整段剩余 SQL。真实 Health 的约 49 MB、13.8 万条 INSERT
   已通过此路径完成恢复与全量核对；性能及回归证据见上述五库验收。
6. 核对 schema、行数与关键业务约束。正式 binding 切换、流量恢复或生产库回溯
   另行评估和执行；脚本成功不等于生产已切换。
7. 把备份 run、恢复目标 UUID、验证结果和临时资源清理情况记录到任务文档。
   真实备份恢复出的临时库仍属于私人数据，清理前按授权确认。

MCP 恢复额外要求：备份可能早于 token 撤销、refresh rotation 或授权码消费。
恢复到临时库后、任何生产 binding 切换之前，必须清除恢复库中的 `mcp_tokens`、
`oauth_auth_codes`、`oauth_consent_requests`、`kdp_sso_sessions` 和
`kdp_sso_transactions`，保留客户端注册 `oauth_clients`，让客户端重新授权；
不得把历史 token 的“未撤销”状态直接恢复到线上。此清理属于事故恢复中的显式步骤，
通用 restore 脚本不会自动修改生产库。授权备份仍按敏感数据加密保管。

## GitHub 分片副本下载

新版主 Release 只保存 `offsite-index.json` 和原始 `manifest.json`；
密文分散在索引列出的 `ops-backup-<instance>-part-<编号>` Release。
下载到尚未使用的 Git 外目录，先核对索引 `format=codepi-offsite-v1`，
再核对 manifest 字节数、SHA-256 与 `index.manifest` 一致。

遍历 `index.shards`，按其中精确的 `tag` 或 `release_id` 下载该片全部 `assets`。
每件核对 `file`、`bytes`、`sha256`，并与原 manifest 的对应项比对；
数据库文件放根目录，原件放 `materials/`，也可全部平铺在同一个下载目录。
拒绝缺件、重复文件、重复路径、路径越界以及与 manifest 不一致的映射。
整个目录仅需一份原 manifest，不拼接或重写它。
所有分片核对完毕后才进入恢复；单个 Release 下载成功不代表完整副本。

旧 v2/v3 单 Release 没有 `offsite-index.json`，仍按原 manifest 直接下载和校验，
不要据此推断缺少新版分片。现有恢复工具读取原 manifest 与密文，
无需知道来源是单 Release、分片 Release 还是 R2。

## v3 GU 与 Me 原件隔离恢复

下载同一个 v3 `manifest.json`、全部相关 D1 密文和两类原件密文到 Git 外目录。
Release 附件可平铺放置，R2 下载也可保留 `materials/` 子目录；不得混合不同备份实例。
先用 `d1-restore.mjs` 分别将 GU、Me SQL 导入两个全新隔离 D1，
再指定这两个恢复库执行：

```bash
node scripts/cloudflare/originals-restore.mjs \
  --backup-dir /path/outside-repo/download \
  --private-key /path/outside-repo/recovery-private-key.pem \
  --database codepi-gu=<GU-recovery-D1-UUID> \
  --database codepi-me=<Me-recovery-D1-UUID> \
  --out /path/outside-repo/recovered-originals
```

`--out` 必须尚不存在且其父目录在 Git 之外。工具校验八库清单与两组原件的覆盖、
身份、大小、摘要和 GCM，拒绝生产 UUID、不完整清单及索引不匹配；
只读取隔离 D1，不修改数据库或上传 R2。输出在
`codepi-gu/materials/<UUID>` 和 `codepi-me/imports/<ULID>`，按原 object key 组织，
目录 `0700`、文件 `0600`。全部成功后写 `restore-report.json`，
每组分别记录索引件数和比 D1 快照更新的 `extra_objects`，不自动补写索引。

恢复验收再将原件上传到两组隔离私有 R2，分别启动 GU/Me：
核对本人鉴权和索引、拒绝匿名读取、原件字节摘要一致、MCP 无原文下载能力。
本地 Ops runtime 使用真实 `GuMaterialsBackup`、`MeImportsBackup` 和合成 D1/R2；
它不替代线上非空 Me 导入、跨账户恢复或真实 SSO 验收。
正式流量切换与临时资源/明文清理继续单独授权。

## 历史 v2 GU 原件隔离恢复与验收

1. 选择同一次完整 v2 备份，下载 `manifest.json`、`codepi-gu.sql.enc` 及全部
   `materials/gu-material-<UUID>.bin.enc` 到 Git 之外。GitHub Release 附件为平铺文件名，
   可直接放在下载目录；脚本优先读取 `materials/`，不存在时读取平铺附件。
   原 `.receipt.json` 用于备份重试，恢复只需完整 manifest 与对应密文。
2. 按前节用 `d1-restore.mjs` 把这份 GU SQL 导入全新空 D1，核对 schema 与行数。
   记录恢复 UUID，不复用或绑定生产库。
3. 执行原件恢复，`--out` 必须是父目录已存在、目标本身尚不存在的 Git 外目录：

   ```bash
   node scripts/cloudflare/gu-materials-restore.mjs \
     --backup-dir /path/outside-repo/download \
     --private-key "$HOME/.config/kdp.cool/backup/recovery-private-key.pem" \
     --database-id <new-recovery-D1-UUID> \
     --out /path/outside-repo/gu-recovered
   ```

   需要本机 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`，只读查询恢复库
   的 `gu_materials`。工具拒绝所有已登记的生产 UUID、旧版无原件 manifest、
   错误私钥、重复项、路径越界、符号链接密文、缺失文件及大小/摘要/GCM/身份不符。
   同时验证匹配的 GU SQL 密文摘要；不会自动导入 D1 或写入任何 R2。
4. 工具将原件写到 `<out>/materials/<UUID>`，目录 `0700`、文件 `0600`，
   保留原 `object_key`。每个恢复库索引都必须匹配原件大小和 SHA-256；全部验证后才写
   `restore-report.json`。普通异常删除本次部分恢复目录；不覆盖已有目录。
   断电、强制终止后需检查 Git 外临时目录并按授权处理残留明文。
5. 清单可能比 D1 导出稍新，工具保留并单独计数 `extra_objects`，不自动补写资料索引。
   核对 `indexed` 等于恢复库索引行数，并核对完整件数；不能把额外原件自动当作已登记资料。
   未索引的失败上传残留不在备份承诺中，不凭一次失败回执自动清理。
6. 为实际流程验收创建隔离私有 R2，将恢复目录中的 `materials/<UUID>` 按原 key
   上传；GU 使用隔离 D1/R2 和独立合成登录配置启动。真实恢复库含私人数据时，
   禁止开放临时公网 URL，SSO/会话策略另按授权安排。不得为演练改生产 binding。
7. 确认匿名 `/api/materials/:id` 为 401，登录后索引名称、类型、大小与原 D1 一致，
   下载为 attachment、`Cache-Control: no-store`，逐件内容摘要一致；
   GU 的公开 HTTP 不提供备份 RPC 路径。缺任一原件即失败。
8. 记录备份 instance、key_id、隔离 D1/R2、恢复件数/索引件数、摘要和下载结果，
   不记录文件名、正文或凭证。正式生产切换及临时库/桶/明文清理分别按授权执行。

`pnpm --dir services/ops test:runtime` 提供本地合成演练：原生 GU RPC → Workflow →
加密 R2 → GitHub digest stub → GU SQL 与原件恢复 → 另一组本地 D1/R2 →
真实 GU 会话下载。D1 导入用本地原生 D1 API 执行解密 SQL，不调用远程 Wrangler；
它不替代真实跨账户恢复、生产 SSO 或离线私钥保管的验收。

## 演练与失效场景

至少每季度做一次合成恢复演练：生成合成 SQL，经生产公钥加密，使用离线私钥和同一
恢复脚本导入临时 D1，再查询合成表验证。不得用真实健康/投资记录构造 fixture。
新备份链路启用后，还要核对密文与 manifest 完整性和私钥解密结果；
R2 成功、跨平台复制与恢复导入分别验收。

最新演练与各存储副本状态以任务记录为准；旧版对称加密脚本的成功演练不能
作为当前 envelope 和恢复脚本已验收的证据。

- 当前 Cron/Workflows 告警按[定时运维](cloudflare-operations.md)核验 Issues 与
  实际送达；手动 GitHub 工作流另依赖 Actions 通知设置。不能仅凭策略或 workflow
  文件断言已收到邮件。
- GitHub 不可用时可以评估 Cloudflare Time Travel；Cloudflare 不可用时可在本地
  解密现存备份。两者不保证与同一事故中的账户访问同时可用。
- artifact 只保留 14 天；如需更长保留，下载密文到另一处安全介质。不要把
  `manifest.json` 中的日期当作调度准时完成的证明。
