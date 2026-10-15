# 多 Agent 同步与只读日历契约

本文只规定 GU 工程接口。投资规则仍只以投资工作区的
`skills/investment-analysis/SKILL.md` 为准；不在此复制规则、持仓或真实事件。
客户端适用于任意本地 Agent、用户授权的连接器及临时授权脚本。

## 实施与授权边界

- 六份投资数组继续走现有 `PUT /api/sync`，日历单独走
  `PUT /api/calendar/sync`；二者分别验证、存储和验收。
- Google 查询在已授权的本地 Agent/连接器运行环境中执行。GU Worker 不持有
  Google refresh token、service-account key 或其他长期 Google 凭证，不向 Google 发请求。
- 当前没有确认可持续授权，也没有运行同步任务。部署接口、上传一份真实快照、
  获得持续授权、启用调度是四件独立事项。
- 只读查询和上传快照不创建、修改、删除 Google 事件，也不表示券商成交。
- 新数据库表必须经维护者另行执行 migration；本次实施只在隔离测试应用 migration。
  未执行 migration 的环境可能返回 503，不能视作已接入。

## 固定日历与时间窗口

部署端新增可选绑定 `INVESTMENT_CALENDAR_ID`。值只能从投资工作区
`config/params.json` 的 `calendar.investment_calendar_id` 取得，并核对该工作区
`AGENTS.md` 第 5 节。不得使用 `primary`，不得按名称搜索后猜测，上传端不能指定白名单。
服务器无法访问本地工作区，部署者负责这一固定配置的来源核对；绑定改变时旧日历数据不会对新日历返回，
且现有数据库记录会阻止直接替换为另一个日历。

未配置、空值或脱敏占位值会保持未连接，PUT 返回 503。
不要把真实日历 ID、令牌和个人事件粘贴到示例、报告或 Git。
此绑定不是 Google 授权；仅配置 ID 不会产生连接。

时区固定 `Asia/Shanghai`。以查询执行日的北京时间当天 00:00 为下界，
第四天之后的 00:00 为**排除上界**。例如合成窗口：

```json
{
  "start": "2026-10-15T00:00:00+08:00",
  "end": "2026-10-19T00:00:00+08:00"
}
```

Google 查询参数契约：

| 参数 | 要求 |
| --- | --- |
| calendarId | 与部署绑定和投资 SSOT 相同 |
| timeMin / timeMax | 上述 start / end |
| timeZone | Asia/Shanghai |
| singleEvents | true，展开重复事件实例 |
| orderBy | startTime |
| showDeleted | false |
| pageToken | 遍历到无 nextPageToken，才可 complete=true |

保留与窗口相交的跨日事件；Google 的全天结束日期是排除上界。
不将全天事件强行转为 UTC 时间。日历标题无标题时由来源端用明确占位标题归一化。
只上传 confirmed/tentative 事件；取消事件不上传。实例 ID 必须唯一。
事件超过 500 条、分页未完成或查询失败时，不能把截断内容标为成功或空日历：
上传 `failed` + `incomplete_result`，events 为空。

## 上传接口

`PUT /api/calendar/sync` 用现有 `UPLOAD_TOKEN` 的 Bearer 鉴权，与浏览器会话隔离。
非浏览器 Agent 无需 Origin；允许不匹配 Origin 的令牌请求，这是现有批次上传同样的边界。
没有 Bearer、只有登录 Cookie 均返回 401。必须 HTTPS（仅现有本地开发例外）。
不新增匿名或凭上传令牌读取私有日历的接口。

Schema v1 是直接 JSON 对象，不复用六份数组的 payload/envelope：

```json
{
  "schema_version": 1,
  "calendar_id": "synthetic-investment@test.invalid",
  "timezone": "Asia/Shanghai",
  "attempted_at": "2026-10-15T12:00:00+08:00",
  "source": {
    "provider": "google_calendar",
    "transport": "connector",
    "name": "synthetic-example"
  },
  "window": {
    "start": "2026-10-15T00:00:00+08:00",
    "end": "2026-10-19T00:00:00+08:00"
  },
  "status": "success",
  "complete": true,
  "error_code": null,
  "events": []
}
```

示例为合成格式，不能上传为生产事实。成功空数组只用于真实查询完成且无事件。
所有对象只接受契约列明的字段，不接受原始 Google 响应、description、attendees、access_token、
任意错误文本或其他额外字段。不要把秘密嵌入允许的 title/name/id 文本中。
服务端信任持上传令牌的执行端如实陈述来源，不能独立证明 Google 查询确实发生。

| 字段 | 契约 |
| --- | --- |
| attempted_at | 来源查询/尝试结束时间，带时区；不得超前，距接收小于 6 小时，且与当前北京时间同一天 |
| source | provider 固定 google_calendar；transport 为 local_agent / connector；name 为不含控制字符的 1–80 字符短名称 |
| status=success | complete=true、error_code=null；允许 events=[] |
| status=failed | complete=false、events=[]；error_code=permission_denied / fetch_failed / incomplete_result |
| status=not_connected | complete=false、events=[]；error_code=authorization_required / authorization_revoked |
| events | 最多 500 个；请求最多 256 KiB；id 唯一且最多 512 字符；title 1–500 字符 |

事件格式（只可选一种时间形态，start/end 形态必须一致）：

```json
{
  "id": "synthetic-instance",
  "title": "合成测试事项",
  "status": "confirmed",
  "start": { "date_time": "2026-10-16T09:00:00+08:00" },
  "end": { "date_time": "2026-10-16T10:00:00+08:00" }
}
```

全天事件则使用 `"start":{"date":"2026-10-16"}` 和 `"end":{"date":"2026-10-17"}`。
带时间的事件允许合法来源时区偏移，保留原值，显示时转换到北京时间；
无偏移日期时间、无效日期、混合形态、结束不晚于开始或完全位于窗口外均返回 400。

返回 200：`{ok:true, attempted_at, received_at, idempotent}`，时间统一 ISO UTC。
同一 attempted_at 的原样重试不更新 received_at；同时间不同内容及更旧尝试返回 409。
条件 UPSERT 将上次尝试与上次成功快照原子更新，并发旧请求不能覆盖新状态。
错误格式 400、无令牌 401、配置/存储故障 503；原始基础设施错误不会回显。
晚到的旧成功也不能覆盖更新的失败；必须重新查询后上传新 attempted_at。
不要用新 attempted_at 给缓存事件“续命”。

## 前端读取契约

会话鉴权 `GET /api/calendar`。未登录 401；已登录但尚未接入也返回 200 的状态对象。
响应带 no-store。具体 TypeScript 类型为 `worker/calendar.ts` 的 `CalendarView`，
已从 `worker/types.ts` 导出，前端可用 `import type`，不得将 Worker 实现作为运行时代码导入。

| 字段 | 含义与显示建议 |
| --- | --- |
| schema_version | 1 |
| calendar_id | 固定 ID；未配置为 null；无需在页面直接展示 |
| timezone / read_only | Asia/Shanghai / true |
| sustained_authorization | 当前始终 unconfirmed；成功快照不能据此声称持续连接 |
| state | not_connected / failed / empty / available / stale |
| reason | no_snapshot / calendar_not_configured / 错误代码 / age / window_changed / null |
| expected_window | 当前北京时间当天及未来三天，end 排除 |
| max_age_seconds | 21600（6 小时）；与交易日历无关，仅是日历快照时效 |
| last_attempt | null 或 attempted_at、received_at、status、error_code、source |
| last_success | null 或 fetched_at、received_at；与最近失败、投资批次时间独立 |
| snapshot | null 或最近成功的 fetched_at、received_at、source、window、stale、stale_reason、events |

`available` = 最新尝试成功、快照未过期且有事件；`empty` = 同条件但真实查询无事件。
`stale` = 最新尝试成功，但快照年龄 >= 6 小时或已跨北京时间自然日。
`failed` / `not_connected` 优先描述最新尝试；可能同时保留旧 snapshot，
前端须标“上次成功快照”，再看 snapshot.stale，不能把其内容说成当前查询成功。
`snapshot=null` 不能渲染为“未来三天无安排”。
网络/数据库请求 503 属读取失败，不能据此伪造某次来源同步失败。

事件保留上传字段，并新增：

| execution_status | actionable | 含义 |
| --- | --- | --- |
| unconfirmed | true | 尚未带完成前缀，需要确认；不是下单许可 |
| recorded_done | false | 来源标题带 ✅；仅说明日历的记录状态，不证明券商成交 |
| recorded_skipped | false | 来源标题带 ⏸ / ⏸️ |
| recorded_postponed | false | 来源标题带 🔄 |

返回事件按开始时间排序。保留已有状态事件便于追溯，今日待确认/近期提醒仅筛 actionable=true；
展示旧快照时同样保留过期提示，不产生新的执行结论。
字段 title/name/id 均当普通不可信文本转义渲染，不能直接 innerHTML。

## 多 Agent 通用流程

1. 读投资工作区 AGENTS、唯一规范和当前持仓；按工作流查询指定投资日历。
2. 生成联网投资批次到临时目录；运行现有上传脚本 dry-run；保持六份数组完整性和 Schema v1/v2 兼容。
3. 在用户已有授权范围内同步批次；失败保留原始错误在安全的本地执行记录，不打印令牌。
4. 独立获取日历真实快照。没有可用授权就保持未连接，或在确实尝试后上报具体状态；
   不使用历史事件、投资计划或模型记忆补快照。
5. 同步后分别核对当前 batch_id 与日历 last_attempt/last_success；成功一项不能宣称另一项成功。
6. 有可靠交易日历和预期调度证据前，只报告批次年龄。周末、节假日、没有新批次均不能直接推断漏更或任务失败。
7. 后续接入调度前检查已有任务，保留原时间，不建立重复任务。本次不创建定时任务。

令牌只经环境或已有安全存储注入，不出现在提示词、命令行参数、源码、报告、网页或执行回执。
上传端应在实际授权连接器中获得日历内容；连接器短期可用不代表 GU 获得长期凭证。

## 离线同步状态检查

`scripts/sync-status.mjs` 只读取本地保存的鉴权 API 响应，无联网、令牌读取、数据上传或调度行为。
输入文件有私人数据，放在安全临时目录，用完由执行端清理，不加入 Git：

```bash
node scripts/sync-status.mjs --dashboard /tmp/gu-dashboard-response.json \
  --calendar /tmp/gu-calendar-response.json \
  --attempt /tmp/gu-sync-attempt.json
```

dashboard 是 `GET /api/dashboard` 的完整响应；空态可用 `{ "empty": true }`。
calendar/attempt 可省略；省略时相关来源/尝试状态明确为未确认。
`--now` 接收带时区时间戳，用于离线复现；默认真实当前时间。

执行回执是执行端**真实尝试后**写入的本地文件，不是服务端持久化监控：

```json
{
  "schema_version": 1,
  "attempted_at": "2026-10-15T12:00:00+08:00",
  "status": "failed",
  "error_code": "network_error"
}
```

允许失败码 generation_failed / validation_failed / network_error / sync_rejected。
成功回执用 status=success、error_code=null，并必须带 batch_id；脚本核对是否等于当前批次。
脚本仅输出安全结构化字段，不复制任意 raw_error 内容。失败回执是执行端报告证据，
不等于服务端能证实该本地执行发生；无回执时 last_attempt=null、failure_status=unconfirmed。
它不会假称六份批次接口已记录全局“上次失败”。

输出含 batch 的生成/接收年龄、source_mode、quote_time_status、last_success、last_attempt、
calendar 状态。没有每行明确 quote_time 就标未确认，任何日期/阶段标签都不足以推断市场阶段。
`update_expectation` 固定 unconfirmed_without_trading_calendar；
退出码 0 只表示输入可解析和检查成功，未连接/过期并不自动等于故障。
输入缺失或无效退出 1，错误不回显文件内容。

离线验证：

```bash
npx vitest run test/calendar.test.ts
node --test scripts/check-sync-status.mjs
```

## 当前真实接入阻塞

尚未确认任意连接器可供持续使用的 Google 授权；未读取真实事件或生成生产快照。
部署者仍需从 SSOT 注入固定 ID，另行执行数据库迁移、发布兼容代码，
经用户授权查询并同步真实快照，再登录验收。当前不执行上述线上动作。
完整市场交易日历、六份批次的全局执行失败回报渠道和调度验收均未接入；
当前状态脚本通过本地执行回执补充可见性，不推断未知状态。
