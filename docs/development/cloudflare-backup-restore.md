# D1 备份与恢复 runbook

当前环境为 local + production。D1 Time Travel 用于快速回溯；加密导出用于在
Cloudflare 账户之外保存一份可恢复副本。工作流文件存在不代表已产生备份，当前调度与
最新验收见 [Cloudflare 定时运维任务](tasks/2026-10-19-cloudflare-operations.md)。
[平台可靠性任务](tasks/2026-10-18-platform-reliability.md) 和
[MCP 运维补齐](tasks/2026-10-19-mcp-operations.md) 保留早期实现与故障证据，
不作为当前调度或待办清单。

## 备份架构

- 自动任务由 `services/ops` 的 Cloudflare Cron/Workflows 执行，每日 UTC 18:00
  （北京时间次日 02:00）；原 `d1-backup.yml` 为手动应急入口，不再定时消耗 runner。
- 通过 D1 polling export API 依次导出 6 个生产库（包含 MCP 授权库）。导出可能暂时影响该库请求，
  因此安排在低峰；不创建第二套业务环境。
- 每份 SQL 在内存中 gzip 压缩，再用独立随机 AES-256-GCM 密钥加密；
  RSA-3072 OAEP/SHA-256 公钥封装该密钥。库名、库 UUID、时间和公钥指纹随
  envelope 一起通过 GCM 校验。SQL 明文不写磁盘或 Actions artifact。
- 私有 R2 `codepi-ops-backups` 保存密文与完成清单，按前缀保留 14 天。全部六库
  成功后才提交 manifest；跨平台副本经 GitHub API 存私有 Release，独立记录回执。
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

库 UUID 固定在 `scripts/cloudflare/backup-core.mjs`，测试校验其与实际 binding
一致，并校验所有 managed production D1 均在清单中。原五个生产库已验证可取得
Time Travel bookmark；六库本机导出和解密记录保留在早期任务中。

2026-10-19 的[最新验收](tasks/2026-10-19-cloudflare-operations.md#大库修复发布与真实验收)
已确认 Cloudflare Workflow 完成六库 R2 密文、manifest 与完成回执，现有恢复私钥内存
解密 6/6 通过。跨平台 Release 副本和云端 GitHub 版本核对仍因缺少 `GITHUB_TOKEN`
失败；待所有者方便时配置后复验，不能把 R2 完整成功写成跨平台恢复保障已完成。
该次执行也不替代后续定时新鲜度和异机恢复演练。

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
2. 下载目标完整的 R2 前缀或私有 Release 附件到仓库之外（历史 Actions artifact 仍适用）。检查 `manifest.json`
   是否包含所需库、公钥指纹及导出时间；下载解压后的密文可用 SHA-256 对照 manifest。
3. 准备匹配的恢复私钥及本机环境变量 `CLOUDFLARE_ACCOUNT_ID` /
   `CLOUDFLARE_API_TOKEN`，使用 D1 写权限。不把值放进命令参数或日志。
4. 从仓库根目录，以当前 lockfile 中的 Wrangler 创建一个全新的空恢复库，
   记录其 UUID。不要使用六个生产库 UUID，不向已存数据的库直接导入。
5. 执行恢复脚本：

   ```bash
   node scripts/cloudflare/d1-restore.mjs \
     --file /path/outside-repo/codepi-gu.sql.enc \
     --private-key "$HOME/.config/kdp.cool/backup/recovery-private-key.pem" \
     --database-id <new-empty-D1-UUID>
   ```

   脚本拒绝所有已登记的生产 UUID，验证密文认证标签和匹配私钥，通过只读查询确认
   目标无业务表/视图，再调用 workspace 固定版本的 Wrangler 导入。临时 SQL 文件
   权限为 `0600`，所在临时目录为 `0700`，成功或普通异常退出时均删除。
   机器断电或强制终止后应检查操作系统临时目录并清理遗留明文。
   Wrangler 的 SQL 输出不会转发到终端；失败只记录退出状态。
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
