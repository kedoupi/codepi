# Rhythm（作息）

私人作息看板：把「家中设备的只读观察」和「工作机的只读采样」整理成一天的状态时间线、关键时刻和四个数字，并公开每个结论的判断方法与口径。

- `web/` 是 Svelte 看板（今天 / 趋势 / 来源）。
- `worker/` 是 Hono Worker，只读两路上游，状态计算是纯函数。
- `migrations/` 是应用自有 D1（SSO 会话表 + `settings`）。
- `shared/fixtures/state-cases.json` 是共享用例，`shared/cases.ts` 负责展开与装载。

## 只读上游

上游通过通用 service binding `STATUS_READ` 访问（`wrangler.toml` 里 `service` 是占位，部署时注入）：

| 资源 | 用途 |
|---|---|
| 工作机采样资源 | 工作机每分钟的采样：网络、键鼠空闲、锁屏、应用名 |
| 家中设备资源 | 家中设备的设备表、观察快照、事件与心跳 |

时序资源必须同时带 `from`/`to`（ISO 8601 带时区），跨度 ≤ 8 天，`limit` ≤ 1000，按 `nextCursor` 翻页。上游失败统一返回 `upstream_unavailable`，页面显示「数据暂不可用」，不会用假数据兜底。

## 状态判定

| 状态 | 判断 | 类别 |
|---|---|---|
| 卧室 / 客厅 | 本人手机在线，房间标签对应 | 看到 |
| 在家（房间未知） | 手机在线但房间为空；或工作机网络是 `home` | 看到 |
| 公司 · 在电脑前 | 工作机网络是 `office`，且最近几分钟有键鼠、未锁屏 | 看到 |
| 公司 · 离座 | 工作机网络是 `office`，但锁屏或没有操作，且夹在两段办公之间 | 推断 |
| 通勤 | 手机最后一次在家 → 工作机第一次在电脑前（下班方向相反） | 推断（上限） |
| 其他网络 | 工作机网络是 `other`，显示网络名，没有则显示网络标识 | 看到 |
| 未知 | 两路都没有新鲜数据，或看不出来 | 无数据 |

缺失数据永远是「未知」，不能当 0，也不能当离开；`pending-offline` 只是抖动，不等于离开。手机落家里、工作机被远程操作都会让结论偏，来源页对此有明确说明。

### 阈值

阈值集中在 `worker/state.ts` 的 `STATE_THRESHOLDS`，改阈值必须同时更新 `shared/fixtures/state-cases.json` 与本表：

| 常量 | 默认值 | 含义 |
|---|---|---|
| `activityFreshnessMinutes` | 5 | 工作机采样多久内算新鲜 |
| `homeFreshnessMinutes` | 20 | 家中设备观察多久内算新鲜（要宽过一次扫描间隔） |
| 来源页家中扫描新鲜度 | 10 | 两次心跳窗口内显示为新鲜 |
| 来源页工作机新鲜度 | 5 | 与 `activityFreshnessMinutes` 一致 |
| `activeIdleSeconds` | 180 | 空闲秒数低于该值算有键鼠活动 |
| `activityLookbackMinutes` | 5 | 「最近几分钟有键鼠」回看多久 |
| `officeAwayMaxMinutes` | 120 | 离座最长多久仍可报告 |
| `commuteMaxMinutes` | 120 | 通勤最长多久仍可报告，超出则保持未知 |
| `wakeEarliestMinute` | 240 | 一天从客厅开始时，最早几点才算「起床」 |
| `futureTimestampToleranceSeconds` | 60 | 上游时间晚于服务器当前时间超过该容差时标记为「时间异常」 |

时间按 `Asia/Shanghai` 切天；同一时刻写成 `+08:00` 或 `Z` 结果相同。
查看当天时，当前时间之后的分钟标记为「未到」，不参与状态、指标或 App 构成计算；过去日期仍计算完整 24 小时。

### 四个数字

- **上班通勤 / 下班通勤（上限）**：推断区间，缺口超过 `commuteMaxMinutes` 时保持未知，不会硬凑。
- **在电脑前**：时间线里「公司 · 在电脑前」的分钟数。
- **在家**：卧室 + 客厅 + 房间未知。

「在电脑前做什么」按任务书口径只统计 `net=office` 且有键鼠的分钟，所以手机落家里时，App 构成仍可能有值，而时间线会显示在家——这正是来源页所说的偏差。

## 设置

`settings` 表保存 `subject_device_ids`（哪台设备是本人的手机）与 `app_categories`（应用名 → 类别）。未归类的应用一律算「其他」。本期只读取，不做编辑界面；本地/测试用 `local/seed-settings.sql` 播种合成数据。

## 本地检查

```bash
npm test              # 状态用例 + 上游解析 + Worker API + 页面
npm run typecheck
npm run build
npm run test:browser:built   # 合成 SSO + 本地 Worker/D1 + 假 STATUS_READ
```

浏览器冒烟需要本机 Chrome；缺 Chrome 或端口冲突会直接报错，不会跳过。

## 隐私边界

仓库里不写真实设备名、网络名、房间与地址对应、MAC、IP、私有服务名或用途说明；上游只读接口只用通用 service binding 名 `STATUS_READ`；测试数据全部是合成数据。日志只记录错误码，不记录行数据。
