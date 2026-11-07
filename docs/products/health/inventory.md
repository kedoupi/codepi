# 健康 功能清单

> 源码路径缩写：`web/` = `~/Coding/codepi/apps/health/apps/web/src/`；`api/` = `~/Coding/codepi/apps/health/workers/api/src/`；`mcp/` = `~/Coding/codepi/services/mcp/src/`。全部来自只读阅读，未访问线上、未运行代码。示例数据一律为占位。

## 概览

- 一句话定位：个人健康空间，把 Oura 的睡眠、恢复（准备度/HRV）、活动记录汇成每日简报、睡眠详情、7 天解读、区间对比，附 AI 解读抽屉与 AI 客户端只读授权。
- 用户：只有一个「个人工作区所有者」（`PERSONAL_OWNER_ID`，`api/lib/capabilities.ts`）能看完整功能；其他已登录账号只能看评分日汇总与周报摘要（降级态，见各页「非个人」状态）。
- 入口：health.codepi.app（`packages/shared/products.ts` 登记）；登录走 CodePi 统一 SSO，Oura 是数据提供方，另有 MCP 入口 mcp.codepi.app/mcp（不在本域，Health 设置页仅展示与跳转）。
- 技术形态：Svelte 5 + Vite 单页应用（`web/App.svelte`，自写 History 路由 `web/lib/router.svelte.ts:1-40`，仅 5 个路由 `/ /sleep /insights /compare /settings`）；Cloudflare Worker API（Hono，`api/app.ts`）+ D1；Cron `*/2 * * * *`（`workers/api/wrangler.toml:24`）驱动自动同步；中英双语（`web/lib/i18n.ts`），中文为主。无独立手机端，同一套响应式（断点 760 / 680 / 600px）。
- 全局壳：未登录 → 落地页；已登录但 Oura 未连接且无历史 → 引导页；其余进入 5 页工作区，共用 `ChromeHeader` 顶栏。

## 页面与视图

| ID | 页面/视图 | 路由 | 桌面/手机差异 | 源码 |
|---|---|---|---|---|
| H-P01 | 启动加载 | 任意 | 无差异 | web/App.svelte:196-197 |
| H-P02 | 落地页（未登录） | `/` | 手机：顶栏折行，语言按钮缩窄，hero 单列；桌面双栏 | web/components/LandingView.svelte:45-121 |
| H-P03 | 全局提示条 | 所有已登录页顶部 | 无差异 | web/App.svelte:193-195 |
| H-P04 | 连接 Oura 引导页（已登录、无 Oura 连接且无历史） | 任意（设置页除外） | 无差异 | web/App.svelte:200-212 |
| H-P05 | 概览（每日简报） | `/` | 手机：顶栏导航折行、字号减小；内容栅格响应（`journal.css`） | web/components/Dashboard.svelte:201-285 |
| H-P06 | AI 解读抽屉 | 概览内浮层 | 无专门差异（宽度由 CSS 控制） | web/components/AiDrawer.svelte:134-205 |
| H-P07 | 睡眠与恢复 | `/sleep` | 手机：历史对照说明字号缩小（SleepPage.svelte:252-254），其余响应式 | web/components/SleepPage.svelte:135-248 |
| H-P08 | 近 7 天解读 | `/insights` | 响应式 | web/components/WeeklyPage.svelte:146-200 |
| H-P09 | 对比 | `/compare` | 手机：指标行内显示「当前/对照」标签与样本数（mobile-samples）；展开明细里「逐日/分布」变 Tab（mobile-detail-tabs） | web/components/ComparePage.svelte:216-259；web/components/MetricDetail.svelte:22-49 |
| H-P10 | 设置 | `/settings` | 响应式；数据面板在 600px 以下改纵向 | web/components/SettingsPage.svelte:49-151 |
| H-P11 | 同步状态条（紧凑/完整两种形态，嵌入概览与设置） | 概览 / 设置 | compact 在概览，完整在设置 | web/components/AutomaticSync.svelte:1-70 |

## 功能点

状态列图例：空=无数据空态；载=加载中；错=读取失败；未=未登录/非个人账号；同=同步中；其他见格内。触发方式「自动」指无用户动作。

### 全局与登录

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F01 | 全局 | 启动检测会话 `GET /api/me`，决定落地页/引导页/工作区 | 自动（进入页面） | 载；错（非 401 显示提示条+重试）；未登录→落地页 | web/App.svelte:128-160,196 |
| H-F02 | 全局 | 会话保活：每 30 秒与窗口重新聚焦时重查会话；被动过期事件回落到落地页 | 自动 | 过期→落地页 | web/App.svelte:162-175 |
| H-F03 | 全局提示条 | 显示偏好保存失败/URL 回跳登录或 Oura 错误/会话读取错误，带「重试」 | 自动 | 错 | web/App.svelte:193-195 |
| H-F04 | 全局 | 解析回跳 URL 错误：登录未完成/服务不可用/存储写入限额/Oura 账号标识不一致/Oura 授权未完成/未配置 | 自动（`?auth_error=` `?error=`） | 6 种文案 | web/App.svelte:46-66 |
| H-F05 | 全局 | 页面标题与 `lang` 随路由和语言切换 | 自动 | — | web/App.svelte:177-190 |
| H-F06 | 引导页 | 「连接 Oura」（跳授权）/「设置」/「退出登录」 | 点击 | 仅此页提示，无数据 | web/App.svelte:204-210 |

### 落地页（未登录）

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F07 | 落地页 | 登录健康空间（SSO 开启）/ 用 Oura 登录（未开 SSO）：请求 `/api/auth/login` 跟随 302 | 点击主按钮 | 错：actionError、API 不可达文案；可显示 URL 回跳错误 | web/components/LandingView.svelte:20-38,65,69 |
| H-F08 | 落地页 | 关于这个应用（外链 codepi.app/apps/#health） | 点击 | — | LandingView.svelte:66 |
| H-F09 | 落地页 | 顶栏「个人空间」外链 | 点击 | — | LandingView.svelte:50 |
| H-F10 | 落地页 | 语言三选一：跟随系统/中文/English（仅本地记忆，不写服务端） | 点击 | 选中态 | LandingView.svelte:51-56；App.svelte:233-240 |
| H-F11 | 落地页 | 三个方向介绍（睡眠/恢复/活动）+ 「数据登录后可见」说明 + 续集段（看板/睡眠/对比/AI/授权可撤销） | 静态 | — | LandingView.svelte:71-79 |
| H-F12 | 落地页 | 开发登录（仅 `allowDevLogin===true`，本地用） | 点击页脚 | 仅开发环境 | LandingView.svelte:81,40 |
| H-F13 | 落地页 | 跳到正文 skip link | 键盘 | — | LandingView.svelte:46 |

### 顶栏（已登录各页共用）

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F14 | 顶栏 | 主导航 5 项：概览/睡眠/近 7 天解读/对比/设置，当前项高亮，修饰键保留新标签 | 点击 | active 态 | web/components/ChromeHeader.svelte:26-52 |
| H-F15 | 顶栏 | 「账号」下拉：返回个人空间 / 账号与连接（跳 `/settings#account`）/ 退出登录 | 点击展开 | — | ChromeHeader.svelte:59-63 |
| H-F16 | 顶栏 | DEV 角标（仅开发会话） | 自动 | 开发 | ChromeHeader.svelte:56-58 |
| H-F17 | 顶栏 | 顶栏「AI 分析」按钮（`showAi`）——代码里存在但没有任何页面传入，当前不会出现 | — | 死代码 | ChromeHeader.svelte:53-55 |

### 概览

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F18 | 概览 | 日期头：长日期 + 北京时间 + 「我的每日简报」 | 自动 | — | Dashboard.svelte:206 |
| H-F19 | 概览 | 读取 90 天评分 `GET /api/me/daily?days=90`；读取失败提示 + 重试 + 授权失效时「重新连接 Oura」 | 自动/点击重试 | 载；错；reconnect | Dashboard.svelte:101-114,207 |
| H-F20 | 概览 | 陈旧提示：显示最近可用评分、同步未完成、需重连 | 自动 | stale | Dashboard.svelte:208 |
| H-F21 | 概览 | 同步错误提示（含重连） | 自动 | 错 | Dashboard.svelte:209 |
| H-F22 | 概览 | 紧凑自动同步状态条 +「查看同步详情」 | 自动（仅个人账号） | 5 类标题：未开启/暂停需重连/等待额度/进行中/部分完成/已完成 | Dashboard.svelte:210；AutomaticSync.svelte:18-31,60-61 |
| H-F23 | 概览 | 「记录中的变化」标题+说明（比近期均值高/低/变化不大/记录不足） | 自动 | 载；空（无记录）；记录不足 | Dashboard.svelte:77-91,215-220 |
| H-F24 | 概览 | 「查看评分依据」：展开下方评分趋势折叠区并跳转 | 点击 | — | Dashboard.svelte:219 |
| H-F25 | 概览 | 睡眠/准备度/活动三张评分卡：分数、7 天迷你折线、较前 7 天均值差值 | 自动 | 空显示「—」「记录不足，暂不比较」 | Dashboard.svelte:221-231 |
| H-F26 | 概览 | 主睡眠 HRV 卡：数值、近 7 天折线、个人参考带（需 14 天前历史）、「查看睡眠」 | 自动/点击 | 未（非个人：仅开放个人）；错+「重新读取睡眠」；载；无参考带说明 | Dashboard.svelte:234-243 |
| H-F27 | 概览 | 睡眠/活动共用 7/14/30 天切换 | 点击 | 按下态（默认 14） | Dashboard.svelte:246 |
| H-F28 | 概览 | 每日总睡眠柱图 + 均值虚线 + 「睡眠详情」；空态 4 种（载/未/已检查无记录/没保存） | 自动 | 载；错+重试；未；空×2；同步警告 | Dashboard.svelte:248-256 |
| H-F29 | 概览 | 步数柱图（最新一天橙色标出） | 自动 | 无单独空态（无数据即空图） | Dashboard.svelte:257-262 |
| H-F30 | 概览 | 过去 30 天准备度色块日历：点选一天看分数；缺失为空框；图例 | 点击 | 缺失；选中 | Dashboard.svelte:265-271 |
| H-F31 | 概览 | 「比较两个区间」链接 | 点击 | — | Dashboard.svelte:272 |
| H-F32 | 概览 | 折叠区「展开评分趋势与数据依据」：三项评分折线 + 7/30/90 天切换 | 点击 | 折叠 | Dashboard.svelte:275-278 |
| H-F33 | 概览 | 「阅读近 7 天解读」链接 | 点击 | — | Dashboard.svelte:279 |
| H-F34 | 概览 | 「AI 分析 · N 天」按钮（仅 `capabilities.analysis`）→ 打开抽屉 | 点击 | 无权限不显示 | Dashboard.svelte:279,182-198 |
| H-F35 | 概览 | 页脚同步线：评分同步时间 +「更新数据」（个人账号提交后台任务；非个人账号直接同步评分）；按钮在更新中/自动同步关闭/暂停/需重连时禁用 | 点击 | 载；同（更新中…）；禁用 | Dashboard.svelte:134-162,282 |
| H-F36 | 概览 | 页脚「数据与连接」链接、同步范围说明、「数据来源与覆盖情况」折叠、免责声明 | 点击/静态 | — | Dashboard.svelte:282 |
| H-F37 | 概览 | 跨午夜/窗口恢复聚焦自动换日并重读 | 自动 | — | Dashboard.svelte:168-172；web/lib/calendar.ts:4-20 |
| H-F38 | 概览 | 同步完成后自动刷新评分，详情完成时每 ≥30 秒刷新睡眠 | 自动 | — | Dashboard.svelte:47-69 |
| H-F39 | 概览 | 跳到每日简报 skip link | 键盘 | — | Dashboard.svelte:204 |

### AI 解读抽屉

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F40 | AI 抽屉 | 打开/关闭：遮罩点击、×、Esc；焦点陷阱与还原，锁定背景滚动 | 点击/键盘 | — | AiDrawer.svelte:50-85,141-150 |
| H-F41 | AI 抽屉 | 请求 `GET /api/me/ai?days=`，生成中展示轮换提示文案 | 打开时 | 载 | AiDrawer.svelte:86-95,156；web/lib/ai.ts；Dashboard.svelte:182-198 |
| H-F42 | AI 抽屉 | 结果：来源标注（模型辅助排序/规则解读）、结论、主要发现（含等级标签）、可以关注、数据说明；分块逐条渐入 | 自动 | 结果 | AiDrawer.svelte:163-200 |
| H-F43 | AI 抽屉 | 回退文案：未配置模型/数据不足/每日上限/服务不可用 | 自动 | 4 种回退 | AiDrawer.svelte:117-124,168-169 |
| H-F44 | AI 抽屉 | 失败状态文案；回退为纯文本摘要；英文时提示「报告内容目前为中文」 | 自动 | 错；纯文本 | AiDrawer.svelte:152-153,202；Dashboard.svelte:196-197 |

### 睡眠与恢复

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F45 | 睡眠 | 日期控制：前一晚/后一晚/日期选择（只在有记录日之间跳） | 点击 | 无前/后记录时按钮禁用 | SleepPage.svelte:139-147,70-73 |
| H-F46 | 睡眠 | 读取近 30 天详细睡眠（含阶段与夜间序列），并后台读 90 天作历史参考 | 自动 | 载；错+重试；未（非个人）；空-已检查/空-未采集；选中日无记录 | SleepPage.svelte:78-112,150-161,245 |
| H-F47 | 睡眠 | 只有小睡/休息的日子提示「不代表夜间睡眠」 | 自动 | nap-only | SleepPage.svelte:163-165 |
| H-F48 | 睡眠 | 一晚总结：与近期主睡眠中位数相比多/少睡 N 分钟；入床-起床时间 | 自动 | 无基线时用中性标题 | SleepPage.svelte:166-177 |
| H-F49 | 睡眠 | 四指标：实际睡眠（含卧床）/入睡用时/清醒时长/睡眠效率 | 自动 | 缺失显示「—」 | SleepPage.svelte:178-183 |
| H-F50 | 睡眠 | 同一天多段记录选择器（主睡眠/小睡/休息/晚间小睡） | 选择 | 仅多段时有意义 | SleepPage.svelte:191-193 |
| H-F51 | 睡眠 | 夜间时间线：分期条、夜间心率、夜间 HRV（缺口断线不补） | 自动 | 无分期仅序列；缺入睡起床时间无法绘制 | SleepPage.svelte:197-200；web/components/NightTimelineChart.svelte |
| H-F52 | 睡眠 | 睡眠组成：深睡/REM/浅睡/清醒时长 + 占比条 | 自动 | 空：没有保存阶段时长 | SleepPage.svelte:203-208 |
| H-F53 | 睡眠 | 与自己的历史对照：主睡眠 HRV 位于历史中间 50% 带的位置；历史不足 14 晚、非主睡眠时的说明 | 自动 | 3 种说明文案 | SleepPage.svelte:209-224 |
| H-F54 | 睡眠 | 最近 7/30 晚作息横条图，点击某晚切换选中日；缺失日禁用 | 点击 | 缺失（无记录） | SleepPage.svelte:228-243 |
| H-F55 | 睡眠 | 「查看 7 天解读」链接 | 点击 | — | SleepPage.svelte:229 |
| H-F56 | 睡眠 | 「查看数据」锚点 + 折叠「这一晚的数据与来源」（阶段时长、平均/最低心率、呼吸、断线说明） | 点击 | — | SleepPage.svelte:194,244 |
| H-F57 | 睡眠 | 页脚「同步近 30 天」（`POST /api/me/health-records?collection=sleep`）与「数据与同步」链接 | 点击 | 同（同步中…）；错（提示+「查看数据设置」） | SleepPage.svelte:114-126,149,246 |
| H-F58 | 睡眠 | 折叠「详细采集状态」：N/M 类已有记录、暂停、未完成批次，跳设置 | 展开 | 载；错+重试 | SleepPage.svelte:247；web/components/ArchiveStatus.svelte:1-45 |

### 近 7 天解读

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F59 | 近 7 天 | 窗口导航：前 7 天/后 7 天（不超过今天）/截止日期选择，同时显示对照窗口 | 点击 | 后翻到今天时禁用 | WeeklyPage.svelte:31-35,152-153 |
| H-F60 | 近 7 天 | 读取 `GET /api/me/insights/weekly`；明细（睡眠/压力/血氧/标签/评分）尽力而为，失败则静默为空 | 自动 | 载；错+重试+授权失效「重新连接 Oura」；空（数据不足） | WeeklyPage.svelte:93-137,156-157,200 |
| H-F61 | 近 7 天 | 结论 headline（睡眠多/少、HRV 上/下移、接近）+ 三项覆盖晚数 +「打开完整对比」 | 自动 | 记录还在积累 | WeeklyPage.svelte:67-87,161 |
| H-F62 | 近 7 天 | 睡眠发现卡：平均每晚多/少睡、此前值、柱图、较长两晚、链到睡眠页 | 点击链接 | 样本不足 | WeeklyPage.svelte:163-170 |
| H-F63 | 近 7 天 | 夜间恢复（主睡眠 HRV）发现卡：均值上/下移、折线、链到睡眠页 | 点击链接 | 样本不足 | WeeklyPage.svelte:172-179 |
| H-F64 | 近 7 天 | 压力与恢复发现卡：恢复时长变化、压力/恢复双柱、链到对比 | 点击链接 | 记录未覆盖全部日期 | WeeklyPage.svelte:181-188 |
| H-F65 | 近 7 天 | 这七天的生活记录：7 格每天的 Oura 标签；今天高亮；无标签提示 | 自动 | 空：这七天还没有保存生活标签 | WeeklyPage.svelte:190-193 |
| H-F66 | 近 7 天 | 「继续观察」建议 + 链接 | 点击 | — | WeeklyPage.svelte:194 |
| H-F67 | 近 7 天 | 折叠「官方评分摘要与同步状态」 | 展开 | — | WeeklyPage.svelte:195；web/components/SyncStatus.svelte:9-21 |
| H-F68 | 近 7 天 | 非个人账号：仅文字摘要列表 + 说明 | 自动 | 未 | WeeklyPage.svelte:196-198 |

### 对比

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F69 | 对比 | 模式切换：区间比较 / 个人历史参照（后者无对照区间，改与近 30 天均值比） | 点击 | 按下态 | ComparePage.svelte:204-207,220 |
| H-F70 | 对比 | 当前区间/对照区间的日期前移、后移、日期选择（历史模式下对照区间不可动） | 点击 | 禁用态 | ComparePage.svelte:45-56,222-225 |
| H-F71 | 对比 | 区间长度 7 天 / 30 天 / 自定义；自定义开始日期（1–90 天）；显示 N 天对 M 天、日期是否重叠 | 点击/选择 | 自定义态 | ComparePage.svelte:57-59,226-228 |
| H-F72 | 对比 | 读取 `GET /api/me/insights/compare?mode=`，明细（睡眠/评分/血氧/压力）并行拉取 | 自动 | 载；错+重试+重连；locked（账号未开放） | ComparePage.svelte:164-202,229-231 |
| H-F73 | 对比 | 指标分类 Tab：睡眠与恢复 / 活动 / 压力 | 点击 | 按下态 | ComparePage.svelte:233-236 |
| H-F74 | 对比 | 指标表 9 行：主睡眠时长/睡眠效率/入睡用时/主睡眠 HRV/夜间平均心率/日均步数/夜间血氧/日间压力时长/恢复时长；每行当前、对照、变化、有效记录 | 自动 | 样本不足不给变化值 | ComparePage.svelte:88-155,237-247 |
| H-F75 | 对比 | 点击行展开明细：逐日折线（按第 N 天对齐或与历史均值）、两期分布散点、较长两晚说明；手机分 Tab | 点击 | 展开；缺失断线 | ComparePage.svelte:248；web/components/MetricDetail.svelte:15-35 |
| H-F76 | 对比 | 折叠「官方分数对照与数据口径」：睡眠/准备度/活动评分两期表 + 同步状态 + 口径说明 | 展开 | — | ComparePage.svelte:251-255 |
| H-F77 | 对比 | 页脚「查看数据口径」链接设置页 | 点击 | — | ComparePage.svelte:256 |
| H-F78 | 对比 | 非个人账号：只看官方分数对照，指标表不渲染 | 自动 | 未 | ComparePage.svelte:234,250 |

### 设置

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F79 | 设置 | 分组锚点：偏好 / 数据同步 / 账号 / 应用连接（非个人账号只有偏好） | 点击 | 未 | SettingsPage.svelte:66-69 |
| H-F80 | 设置 | 「返回看板」 | 点击 | — | SettingsPage.svelte:63 |
| H-F81 | 设置 | 界面语言三选（跟随系统/中文/English），登录态下 `PUT /api/me/prefs` 持久化 | 点击 | 保存中…（按钮禁用）；错→全局提示条 | SettingsPage.svelte:70-88；App.svelte:102-119 |
| H-F82 | 设置 | 数据采集与历史记录面板：N/M 类已有数据；Oura 未连接时不显示 | 自动 | 空/载 | HealthDataPanel.svelte:91 ；SettingsPage.svelte:91 |
| H-F83 | 设置 | 完整自动同步状态卡：每天 09:00、官方评分阶段、详细记录批次进度条、下一批次、最近成功时间、下次计划、错误、受限类别、「重新连接 Oura，恢复自动同步」 | 自动 | 未开启/暂停/等待额度/进行中/部分/完成 | AutomaticSync.svelte:18-69 |
| H-F84 | 设置 | 「更新数据」：提交后台同步任务（`POST /api/me/health-records/automatic`），页面可关闭；状态轮询 | 点击 | 同（更新中…）；禁用（关闭/暂停/需重连）；错 | HealthDataPanel.svelte:100-104,117-123 |
| H-F85 | 设置 | 上游访问受限类别提示（Oura 限制，已有记录保留，「更新数据」不重试） | 自动 | 暂停 | HealthDataPanel.svelte:94-99 |
| H-F86 | 设置 | 需处理批次清单：按类别分组、批次日期、请求编号前 8 位、「重新连接并继续补齐」 | 点击/展开 | 失败批次 | HealthDataPanel.svelte:106-117 |
| H-F87 | 设置 | 18 类数据卡片：名称、记录数、起止日、状态（访问暂停/下一批次/有未完成批次/等待同步/已有数据/已同步暂无记录） | 自动 | 6 种 | HealthDataPanel.svelte:118-130；api/lib/health-records.ts:9-28 |
| H-F88 | 设置 | 说明 + 「重新授权 Oura（可选）」 | 点击 | — | HealthDataPanel.svelte:131 |
| H-F89 | 设置 | `?sync=90` 回补参数：授权回跳后自动清参数并开始补齐 | 自动 | — | HealthDataPanel.svelte:77-85 |
| H-F90 | 设置 | `?connect_oura=1&health_return=` 自动转去 Oura 授权 | 自动 | — | SettingsPage.svelte:37-46 |
| H-F91 | 设置 | 个人工作区块：网站账号、来源、Oura 状态（未连接/需重连/已连接 + 标识）、连接/重新连接 Oura | 点击 | 3 种连接态 | SettingsPage.svelte:92-109 |
| H-F92 | 设置 | 「原账号连接修复」：POST `intent=repair_identity` 重新授权（仅 SSO 且已有 Oura 标识） | 点击 | 折叠 | SettingsPage.svelte:110-122；api/routes/auth.ts:90-165 |
| H-F93 | 设置 | 接口版本与构建短 SHA | 自动 | — | SettingsPage.svelte:123-125 |
| H-F94 | 设置 | AI 应用连接：展示 MCP 地址 + 「管理 CodePi 授权」外链（撤销在 mcp.codepi.app/connections，不在本页） | 点击 | — | SettingsPage.svelte:128-137 |
| H-F95 | 设置 | 非个人账号：账号权限说明块 | 自动 | 未 | SettingsPage.svelte:139-143 |
| H-F96 | 设置 | 非医疗声明条（中英） | 静态 | — | SettingsPage.svelte:146-149 |

### 后台

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| H-F97 | 后台 | 每天 09:00（北京）自动同步 90 天评分与近 7 天/缺失详情；Cron 每 2 分钟推进批次；每日额度、授权失效暂停 | 自动 | 同；暂停 | api/index.ts:70-72；workers/api/wrangler.toml:24；api/lib/auto-sync.ts:134,246 |
| H-F98 | 后台 | 睡眠逐日诊断 `POST /api/me/health-records/sleep-diagnosis`——前端没有调用点 | 仅 API | — | api/routes/health-records.ts:14-21 |

## 对外接口

### 站内 API（`api/app.ts:61-97`）

| 名称 | 用途 | 谁调用 |
|---|---|---|
| `GET /api/me` | 会话、能力位、Oura 连接状态、语言偏好、同步状态、版本 | 前端启动与 30 秒轮询（App.svelte:133） |
| `PUT/POST /api/me/prefs` | 保存语言偏好 | 设置页、App.svelte:107 |
| `GET /api/auth/login` `/callback` | SSO 登录与回调 | 落地页（LandingView.svelte:23） |
| `GET/POST /api/auth/oura/start` `/callback` | Oura 授权（含 `repair_identity`、`sync_health`、`health_return`） | 引导页、设置、各重连链接 |
| `GET /api/auth/dev/session` | 本地开发登录 | 仅开发 |
| `POST /api/auth/logout` | 退出 | 顶栏、引导页 |
| `GET /api/me/daily?days=7/30/90`、`POST /api/me/sync?days=90` | 评分日汇总；非个人账号的评分刷新 | 概览、周报、对比 |
| `GET/POST /api/me/health-records?collection&from&to&offset&include_series` | 读取已保存记录；POST 先同步该窗口 | 睡眠页、周报、对比、MCP |
| `GET /api/me/health-records/status` | 各类数据覆盖与自动同步状态 | 设置、睡眠页折叠区 |
| `GET/POST /api/me/health-records/automatic` | 读/提交自动同步任务 | 概览、设置 |
| `POST /api/me/health-records/sleep-diagnosis` | 睡眠窗口诊断 | 无前端调用 |
| `GET /api/me/ai?days=` | AI 解读（规则模板 + 模型排序，带缓存与每日限额） | 概览 AI 抽屉 |
| `GET /api/me/insights/weekly` `/compare?mode=` | 周报、对比摘要 | 近 7 天、对比页 |
| `GET /api/health` | 服务探活（版本、配置位） | 部署检查 |
| `GET /api/internal/desk-summary?range=` | 供个人工作台聚合的摘要 | project.codepi.app 工作台（内部） |
| Cron `*/2 * * * *` | 自动同步批次 | Cloudflare 调度 |

### MCP 工具（`services/mcp/src/modules.ts:97-140`，经 mcp.codepi.app/mcp，只读健康）

| 名称 | 用途 | 谁调用 |
|---|---|---|
| `health_get_catalog` | 列出已保存数据集、字段单位、统计方式、覆盖 | 用户授权的 AI 客户端（Claude 等） |
| `health_query_records` | 读已保存记录（≤31 天，时间戳类 ≤7 天，分页，可 `refresh`） | 同上 |
| `health_aggregate` | 区间统计与两期对比（count/mean/min/max/sum，按日/周/月） | 同上 |
| `health_get_sync_status` | Oura 连接、缓存、覆盖与后台进度（不触发同步） | 同上 |

## 现有原型覆盖

核实方式：解析 `ds2/project/<名>.dc.html` 可见文字，对照上表。标注：已画 / 漏画 / 与代码不一致（含原型比代码多的）。

| 画板 | 对应页面 | 结论 |
|---|---|---|
| H-Landing / H-Landing-Phone | H-P02 | 已画 F07 F08 F09 F10 F11；原型多画了「睡眠 — 准备度 — 活动」示意三格（代码无，代码是「三个方向」文字卡）= 与代码不一致；顶栏有「CodePi 健康」品牌。F12 开发登录漏画（可不画）；F13 漏画（无障碍，可不画） |
| H-Landing-States | H-P01/H-P03/H-P04 | 已画 F01 加载、F07 错误（3 文案）、F03 提示条、F06 引导页；F04 的「存储限额」「授权未完成」多种文案只画了部分 = 漏画 |
| H-Overview / H-Overview-Phone | H-P05 | 已画 F18 F22 F23 F24 F25 F26 F27 F28 F29 F30 F32 F34 F35；以下问题：F15 账号下拉与退出登录漏画（顶栏只画了「示意数据 / AI 解读 / 小」）；F17 顶栏「AI 解读」按钮与代码不一致（代码顶栏没有该按钮，AI 入口在评分趋势折叠区里）；原型 HRV 卡的「查看数据表」代码无 = 与代码不一致；F19 读取失败/F20 陈旧/F21 同步错误三类提示条漏画；F31「比较两个区间」、F33「阅读近 7 天解读」、F36 页脚「数据与连接」「数据来源与覆盖」漏画；F37-F39 无需画 |
| H-Overview-Empty | H-P05 空态 | 已画 F23 F25 空值；F26 空；F28 空；步数空文案「连接后会每天同步步数与活动」「数据设置」与代码不一致（代码步数无空态，也没有「数据设置」链接） |
| H-Sync-States | H-P11 | 已画 F22 紧凑形态 5 种（进行中/完成/受限/部分/失败）；代码还有「自动同步未开启」「等待额度恢复」两种 = 漏画；完整形态见 H-Settings |
| H-Sleep / H-Sleep-Phone | H-P07 | 已画 F45 F48 F49 F51 F52 F53 F54 F55 F56；F50 记录选择器漏画；F57 页脚「同步近 30 天」仅在 States 里出现；F58「详细采集状态」折叠漏画；日期选择器的原生 date input 可不画 |
| H-Sleep-States | H-P07 | 已画 F47 F46（载/错/空×2/选中日无记录/非个人）；F57 同步错误提示条（含「查看数据设置」）漏画 |
| H-Weekly / H-Weekly-Phone | H-P08 | 已画 F59（日期头）F61 F62 F63 F64 F65 F66；F59 的前/后 7 天按钮与日期选择漏画；F67 官方评分摘要折叠漏画 |
| H-Weekly-States | H-P08 | 已画 F60 载/错/重连/空/记录积累；F68 非个人摘要、F65 无标签 |
| H-Compare / H-Compare-More / H-Compare-Phone | H-P09 | 已画 F69 F70 F71 F73 F74 F75（含历史参照）；F76 官方分数对照折叠、F77 口径链接漏画；F72 的 locked/错/重连状态漏画；原型展开明细里的「查看对应睡眠 →」代码里没有（MetricDetail 无此链接，仅「较长两晚」文字）= 与代码不一致；F78 非个人账号对比页漏画 |
| H-Settings / H-Settings-Phone | H-P10 | 已画 F79 F80 F81 F82 F83 F84 F87 F91；与代码不一致：应用连接区画了「CodePi MCP · 只读 · 最近使用 2 小时前 · 撤销」，代码只有 MCP 地址和「管理 CodePi 授权」外链，没有最近使用和撤销按钮；F88 重新授权、F92 原账号连接修复画面（仅文字，折叠交互未画）、F93 接口版本、F96 非医疗声明有画（`非医疗建议 / Not medical advice`）；F86 失败批次清单在 States 里；F85 暂停提示已有（「上游受限，暂停」）；F89 F90 无需画 |
| H-Settings-States | H-P10 | 已画 F84 同状态（更新中…、下一批次、失败将重试）、F95 非个人、F91 未连接、F81 保存中；F86 批次详情折叠与请求编号漏画 |
| H-AI | H-P06 | 已画 F41 载、F42 结果、F44 失败、F43/F44 回退；F43 的 4 种回退文案只画一种；F44 英文提示漏画 |
| Arch-Health | 全部 | 已列 5 页 + 子视图；功能覆盖面与上方一致，漏列项同上（账号/退出、失败提示条、官方分数对照） |
| Feat-Health | 全部 | 同 Arch-Health，一致 |
| C-Health | 组件 | 指评分卡、同步条、HRV 带、柱图、分期、30 天矩阵、发现卡；与代码一致方向 |
| Health-Overview / Health-Overview-Phone | 旧稿 | 与代码不一致整份：画的是「昨晚睡眠/恢复/活动/静息心率」四卡、「手环 3 天没同步」提示、「现在同步」按钮、「AI 的一句话 / 问问 AI / 接着问」，这些在代码里都不存在（也没有静息心率卡）；顶栏「近 7 天」文案与代码「近 7 天解读」不同。建议明确标为废弃稿，避免改版误当真源 |

小结：功能点共 98 项（H-F01–H-F98）；画板对应较完整的主流程功能，但「账号/退出」「三类概览提示条」「官方分数对照」「同步近 30 天与采集状态」「顶栏 AI 入口位置」「MCP 撤销」等存在漏画或不一致。

## 日常使用流与体验疑点

使用流（来自代码，非访谈）：
1. 早上打开 → 概览（简报）读一句话结论和三项评分 → 点 HRV / 睡眠 / 准备度日历看细节。
2. 想看细节 → 睡眠页按晚翻看，看作息横条与历史对照。
3. 周末或周初 → 近 7 天解读 → 打开完整对比（7/30/自定义）→ 展开某指标看逐日对齐。
4. 数据看起来旧 → 概览页脚「更新数据」或设置页「更新数据」；不用等页面，后台继续跑。
5. 偶发：授权失效 → 各页都有「重新连接 Oura」→ 回设置确认；给 AI 客户端授权在设置页跳出本域管理。

体验疑点（推断，需张老板确认）：
- 同步入口分散：概览页脚「更新数据」、设置页「更新数据」、睡眠页「同步近 30 天」、概览紧凑条「查看同步详情」，行为不同（前两者提交 90 天任务，后者只同步睡眠）。推断：用户不易分清，改版时要统一入口并保留这三种范围。
- AI 分析藏在概览最底部「展开评分趋势与数据依据」里，且需 `capabilities.analysis`；原型把它画在顶栏。改版若提到顶栏，要同时处理手机顶栏拥挤（现已折行）。
- 退出登录只在「账号」下拉里；原型漏画，容易在改版中丢失。
- 设置页「应用连接」撤销授权需跳到 mcp.codepi.app/connections；原型画成页内「撤销」按钮，实现与设计差一步。
- 非个人账号看到的是大量「仅向个人工作区开放」的空态，没有升级路径；若这个账号类型本就不存在（只有所有者使用），推断可以收敛到一种提示。
- 手机导航 5 项 + 账号下拉在 760px 以下折行成多行，点击区 44px；与「手机稿」底部 tab（概览/睡眠/7 天/对比/设置）不同，实现里没有底部栏。
- `ChromeHeader` 的 `showAi` 分支与组件 `HeatmapPanel`、`SummaryCards`、`SleepPreview`、`ContribBars`、`LandingReveal`、`LandingSlot` 无引用（只读检查），属遗留代码，改版时不要当现有功能。
- 睡眠诊断接口（`sleep-diagnosis`）无 UI；若要做「睡眠问题排查」，是现成后端能力。
- 数据新鲜度表达分散在多处（概览同步线、紧凑条、陈旧提示、数据来源折叠、睡眠页脚日期），口径略不同：评分同步于 vs. 详细记录同步于。改版时需保留「缺失不是 0」「陈旧时仍显示最近成功数据」的语义（`apps/health/AGENTS.md`）。
