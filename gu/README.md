# GU 私人投资工作台

Cloudflare Pages 项目 `kdp-gu`，访问地址 `https://gu.kdp.cool`，兼容入口 `https://kdp-gu.pages.dev`。2026-10-15 已核对自定义域名、验证和 HTTPS 为 active；两个域名的 Cookie 会话各自独立。

固定向本人邮箱发送验证码，登录后查看持仓、风控、报告与数据来源。生产环境不会返回开发验证码，私人数据仅通过会话鉴权 API 读取，不打包进静态资源。

## 代码与验证

- `web/src/`：Vite + TypeScript 前端；`charts.ts` 生成配置缺口、风控距离和历史权重图。
- `worker/`：Pages Worker，处理登录、数据校验与同步。
- `migrations/`：D1 结构；生产与预览使用独立数据库。
- `test/app.test.ts`：认证、同步、旧批次兼容与图表语义回归测试。
- `web/test/session.test.ts`：前端会话过期、路由返回与并发刷新回归测试。

在本目录执行：

```bash
npm test
npm run test:scripts
npm run typecheck
npm run build
npm run dev
```

站点保持 `style-src 'self'`。动态图形位置通过 `data-*` 与 `web/src/dom.ts` 的 CSSOM 赋值实现；不要在生成的 HTML 中写内联 `style`。

## 数据来源与同步

投资原始资料在独立本地工作区 `/Users/codepi/Documents/美股理财`。先读该工作区的 `AGENTS.md`；投资规则只有 `skills/investment-analysis/SKILL.md` 一份。网页是派生数据的展示层，刷新行情不代表持仓或现金已经重新确认。

生成与上传脚本位于投资工作区的 `scripts/`，不属于本 Git 仓库。当前同步 Schema v2，包含六个 JSON 数组：`account`、`positions`、`risk`、`market`、`history`、`reports`。服务端仍接受已有 Schema v1 的五份批次，缺少历史数据时不画历史曲线。

```bash
cd /Users/codepi/Documents/美股理财
python3 scripts/build_dashboard.py --output-dir /tmp/gu-live-data
python3 scripts/upload_dashboard.py --input-dir /tmp/gu-live-data --dry-run
# 在授权同步的范围内，先通过环境变量配置 GU_UPLOAD_TOKEN：
python3 scripts/upload_dashboard.py --input-dir /tmp/gu-live-data --url https://kdp-gu.pages.dev
```

只上传明确标记 `live` 的完整批次。`/api/sync` 验证校验和、格式及生成时间后，事务更新 D1 当前批次指针；失败或较旧批次不会覆盖当前数据。令牌、券商原件和真实投资 JSON 不提交到网页仓库。

历史图的日期轴按实际间隔展开；档案约值与本批行情估算分别标明来源。连线不代表每日走势或收益率。现金 14% 显示为最低保留线；风控距离和是否触发分别显示，停买不能解释成卖出。

总览置顶显示疲劳锁、月投现金硬刹车等严重提醒。GOOGL 两条减仓线同时触发时，总览只显示强制减仓动作，明细保留两条规则；触发动作与临近分析期限同时展示。报告中的 HTTP/HTTPS 引用在新标签页打开，其余协议保留为文本。任何 API 返回 401 都会清空前端快照，过期前发出的刷新响应也不能恢复旧资产界面。

## 当前边界

金额隐藏覆盖报告标题、摘要、正文及自由文本提醒；结构化风控动作仍可读。空批次与读取失败不会误跳登录，明确的 401 会清空快照；重新登录恢复合法站内深链接。刷新按钮读取已同步数据，显示进行中、无新批次、新批次和失败；它不触发行情采集。手机端以持仓卡片显示市值、浮盈亏、权重和现金最低保留线，需处理规则在总览图表之前。

新批次以 `weight_raw`、`cash_weight_raw`、`cash_after_dca_raw`、`current_value/current_unit`、历史当前点的 `weights_raw` 避免提前取整；旧字段保留。`quote_time` 仅用于确认的价格时刻。日线来源的 `regularMarketTime` 单独保存为 `market_time_iso`，bar 时间保存为 `bar_time`；二者不证明价格时刻或收盘阶段。缺失证据显示未确认。

Google 投资日历已于 2026-10-15 完成生产迁移、固定 ID 配置和首份真实只读快照同步；长期 Google 授权和自动调度尚未接入。前端区分未连接、查询为空、失败和过期。快照同步不代表持续连接，过期后须重新实时查询。接口与离线同步状态检查见 [多 Agent 同步契约](docs/multi-agent-sync.md)。现金、港股股数和早期成交批次仍需券商凭证核实。

GU CI 只运行测试、类型检查、构建及配置校验，不接触生产凭证。发布后分别检查：

```bash
npm run check:deploy -- --url https://gu.kdp.cool
npm run check:deploy -- --url https://kdp-gu.pages.dev
```

检查会逐字节核对线上 JS/CSS 与本地构建，并检查未登录私有接口 401。验证码真实投递、登录后数据和日历需另行验收；只通过配置检查不代表发布完成。
