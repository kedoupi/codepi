# codepi-notify

`codepi-notify` accepts the shared `notify.event/v1` contract through the `NotifyApi` named
RPC entrypoint and the authenticated `notify-api.codepi.app/v1/events` endpoint. It stores
validated events, incident state, channel attempts and one outbox delivery row per notification in its own D1 database. Feishu is the primary channel; critical and selftest notifications use both Feishu and email, while warning notifications fall back to email after a permanent or exhausted Feishu failure.

Issue an HTTP producer token locally:

```bash
node scripts/issue-token.mjs --source surgeconf.watchdog --kinds agent.stuck,approval.pending,plans.orphan_digest,notify.selftest,daily-review --out /path/to/token --sql /path/to/token.sql
```

The token file is created with mode `0600`; SQL stores only the token id, SHA-256 hash, source and allowed kinds. `rpc` is reserved for the named RPC entrypoint and cannot be issued here. To revoke, set `revoked_at` for the token id in `producer_tokens`; the old token must then return HTTP 401 before replacement use.

For the health producer, issue a token with both event kinds:

```bash
node scripts/issue-token.mjs --source mybrain.job-health --kinds job.health,job.unhealthy --out /path/to/job-health-token --sql /path/to/job-health-token.sql
```

`job.health` info events are alert deliveries sent through Cron, with each daily card delivered alone; each standalone daily card consumes one quota slot. `job.unhealthy` warning events send firing and, after a successful firing delivery, resolved notifications. Both kinds use Feishu first with the existing email fallback.

`NOTIFY_TO` is injected as a runtime secret by the authorized release operator; it is never committed or stored in D1. After release, read back a synthetic `notify.selftest` event and confirm the delivery status and provider message id. Binding success means accepted for delivery, not mailbox receipt.

Feishu uses the runtime secrets `FEISHU_APP_ID`, `FEISHU_APP_SECRET` and `FEISHU_RECEIVE_OPEN_ID`; they are never committed, returned by the read-back API or written to logs. Token caching is isolated to the Worker runtime and keyed by app id. The card UUID is `notify-<minimum delivery id>` and Feishu's one-hour idempotency window means a retry after that window may produce a duplicate message. Conversely, if Feishu accepted a send but the Worker timed out locally, a batch with the same minimum id within one hour may be deduplicated by Feishu and the new content may not be delivered.

`channel_attempts` is the source for per-channel retry state. A notification reserves quota once; channel fan-out, fallback and retries do not reserve additional quota. The `0002_channel_attempts.sql` migration is additive and must be applied after `0001_notify.sql`. Rollback keeps the migration applied and requires a Worker version that understands the new table.

## 飞书卡片模板

`buildFeishuCard` 使用卡片 JSON 2.0，并按 kind 选择模板：

| 类别 | kind | 样式 |
| --- | --- | --- |
| alert | `agent.stuck`、`job.unhealthy`、`magpie.unresponsive`、`magpie.source_disabled`、`magpie.spend` | 按严重度显示红、橙或恢复绿标签，首行给出处理结论 |
| status | `ledger.status` | 蓝色状态变化卡，优先显示旧状态 → 新状态 |
| approval | `approval.pending` | 黄色待批准卡，链接按钮显示“去批准” |
| delivery | `ledger.delivered` | 绿色已交付卡，优先显示验收结果 |
| notice | `daily-review`、`job.health`、`ledger.digest`、`notify.selftest`、`notify.merged` 及未知 kind | 蓝色通知卡，统一结论、事实分栏和来源页脚 |

每张卡都使用 header、markdown、column_set/column、hr、button 和 text_tag_list；标题使用事件标题，facts 每行两栏，页脚显示北京时间、来源及仅在实际省略提醒时出现的限额提示。飞书页链接只接受无端口、无账号密码的 `https://*.feishu.cn` 子域，或原有 `https://*.codepi.app` 子域。新增 kind 后需为 `mybrain.ledger` 重发令牌。

离线预览：

```bash
node services/notify/scripts/preview-feishu-cards.mjs
```

组件参考：[卡片 JSON 2.0](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/card-json-v2-overview)、[卡片 header](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/card-json-v2-components/card-header)、[column_set](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/card-json-v2-components/column-set)、[markdown](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/card-json-v2-components/content-components/markdown)、[button](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/card-json-v2-components/action-components/button)、[hr](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/card-json-v2-components/content-components/divider)。Markdown 中的控制字符会被转义，待样卡目视确认具体渲染效果。

## 发布与回滚

`NOTIFY_TO` 是 Worker runtime secret，固定实际收件地址；`NOTIFY_DESTINATION_ADDRESS` 只在授权的 `deploy-domain.mjs --app notify` 过程中注入临时 Wrangler 配置的 Email Sending destination，占位配置和 Git 中不保存真实地址。两者都不写入事件或 D1。

发布前运行受影响检查和 `pnpm --filter @codepi/notify build`，再执行 `pnpm --dir services/notify run deploy --sha <reviewed-source-sha>`（必须带 `run`，否则会被 pnpm 内置的 `deploy` 命令截走）。每次部署都要在环境中提供 `NOTIFY_DESTINATION_ADDRESS`，缺失时脚本直接报错；没有其他来源时，可用 `wrangler versions view <当前线上版本> --name codepi-notify --json` 读出现有 `send_email` 绑定的 destination，只放进环境变量，不打印、不入库，部署后读回新旧版本的 destination 一致。发布后用合成 `notify.selftest` 读回 delivery 状态和 provider message id。回滚沿用根发布流程的已核对 Worker version；D1 migration 不随 Worker 回滚，任何 schema 不兼容都先停止。

For the ledger producer, issue a token for the ledger kinds:

```bash
node scripts/issue-token.mjs --source mybrain.ledger --kinds ledger.digest,ledger.status,ledger.delivered --out /path/to/ledger-token --sql /path/to/ledger-token.sql
```

`ledger.digest` remains a standalone alert delivery. `ledger.status` uses the status template and `ledger.delivered` uses the delivery template; all three use Feishu first with email fallback. A new ledger kind requires reissuing the `mybrain.ledger` token.

For the Magpie gateway watcher, issue a token for its three alert kinds:

```bash
node scripts/issue-token.mjs --source mybrain.magpie --kinds magpie.unresponsive,magpie.source_disabled,magpie.spend --out /path/to/magpie-token --sql /path/to/magpie-token.sql
```
