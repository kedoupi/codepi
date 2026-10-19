# GU 私人投资工作台

kedoupi（codepi）旗下的私人投资工作台。Cloudflare Worker `codepi-gu`（Workers Static Assets 架构，`run_worker_first = true`，全部请求先进 Hono 鉴权链再回源静态资产），生产入口为 `https://gu.codepi.app`，通过 `auth.codepi.app` 统一登录；退出会撤销对应的中心会话。资源与域名核验记录见 [CF 资源登记表](../../docs/development/cloudflare-resource-registry.md)。2026-10-17 已从 Pages 切换到 Workers，发布遵循[本地发布操作](../../docs/development/local-release.md)，正式域名由 Worker custom domain 管理；切换与配置重建证据见 [GU 运行配置重建](../../docs/development/tasks/2026-10-17-gu-runtime-bootstrap.md)。

统一登录中心固定向本人邮箱发送验证码，登录后查看持仓、风控、报告与数据来源。生产启用 `SSO_ENABLED=1`，旧的本地验证码接口关闭；本地及预览可显式关闭 SSO 用于隔离测试。私人数据仅通过会话鉴权 API 读取，不打包进静态资源。

## 代码与验证

- `web/src/`：Svelte 5 + Vite + TypeScript 前端；`charts.ts` 生成配置缺口、风控距离和历史权重图。
- `worker/app.ts`：Hono 路由与中间件，处理登录、数据校验与同步；`worker/index.ts` 是 Worker 入口（`main = "worker/index.ts"`，由 wrangler 直接编译，不再需要 esbuild 预打包）和统一安全响应头。
- `migrations/`：D1 结构；本地自动测试使用合成数据，staging 已退役。
- `test/app.test.ts`：认证、同步、旧批次兼容与图表语义回归测试。
- `test/routing.test.ts`：路由顺序、精确路径与方法、Origin、静态资源边界和错误响应回归测试。
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

服务端路由按内部摘要独立鉴权、HTTPS、公开 GET 与令牌上传、浏览器 Origin、登录与退出、私有 API 会话、静态资源依次处理。API 的 GET 仅接受 GET，HEAD 不启动 SSO 登录或消费回调；编码路径和末尾斜杠保留原有精确匹配语义。业务处理函数仍在各自模块；部署载体已随后续 Static Assets 迁移切换到 Workers。

## 数据来源与同步

投资原始资料在独立本地工作区 `<workspace>/Documents/独立本地投资工作区`。先读该工作区的 `AGENTS.md`；投资规则只有 `skills/investment-analysis/SKILL.md` 一份。网页是派生数据的展示层，刷新行情不代表持仓或现金已经重新确认。

生成与上传脚本位于投资工作区的 `scripts/`，不属于本 Git 仓库。当前同步 Schema v2，包含六个 JSON 数组：`account`、`positions`、`risk`、`market`、`history`、`reports`。服务端仍接受已有 Schema v1 的五份批次，缺少历史数据时不画历史曲线。

```bash
cd <workspace>/Documents/独立本地投资工作区
python3 scripts/build_dashboard.py --output-dir /tmp/gu-live-data
python3 scripts/upload_dashboard.py --input-dir /tmp/gu-live-data --dry-run
# 在授权同步的范围内，先通过环境变量配置 GU_UPLOAD_TOKEN：
python3 scripts/upload_dashboard.py --input-dir /tmp/gu-live-data --url https://gu.codepi.app
```

只上传明确标记 `live` 的完整批次。`/api/sync` 验证校验和、格式及生成时间后，事务更新 D1 当前批次指针；失败或较旧批次不会覆盖当前数据。令牌、券商原件和真实投资 JSON 不提交到网页仓库。

历史图的日期轴按实际间隔展开；档案约值与本批行情估算分别标明来源。连线不代表每日走势或收益率。现金 14% 显示为最低保留线；风控距离和是否触发分别显示，停买不能解释成卖出。

总览置顶显示疲劳锁、月投现金硬刹车等严重提醒。GOOGL 两条减仓线同时触发时，总览只显示强制减仓动作，明细保留两条规则；触发动作与临近分析期限同时展示。报告中的 HTTP/HTTPS 引用在新标签页打开，其余协议保留为文本。任何 API 返回 401 都会清空前端快照，过期前发出的刷新响应也不能恢复旧资产界面。

## 当前边界

工作台仅向已登录的本人显示完整金额、股数、报告和日历，不提供金额显隐开关，旧的隐藏偏好在启动时清理。报告保留章节目录和引用链接。空批次与读取失败不会误跳登录，明确的 401 会清空快照；重新登录恢复合法站内深链接。刷新按钮读取已同步数据，显示进行中、无新批次、新批次和失败；它不触发行情采集。手机端以持仓卡片显示市值、浮盈亏、权重和现金最低保留线，需处理规则在总览图表之前。

新批次以 `weight_raw`、`cash_weight_raw`、`cash_after_dca_raw`、`current_value/current_unit`、历史当前点的 `weights_raw` 避免提前取整；旧字段保留。`quote_time` 仅用于确认的价格时刻。日线来源的 `regularMarketTime` 单独保存为 `market_time_iso`，bar 时间保存为 `bar_time`；二者不证明价格时刻或收盘阶段。缺失证据显示未确认。

Google 投资日历曾于 2026-10-15 完成固定 ID 配置和首份真实只读快照同步。2026-10-17 重构切换没有恢复旧 `INVESTMENT_CALENDAR_ID` 与 `UPLOAD_TOKEN`，当前新 Worker 的日历为未连接，外部上传尚未重新接入；旧上传命令需先完成新凭证配置才能使用。长期 Google 授权和自动调度也尚未接入。前端区分未连接、查询为空、失败和过期。接口与离线同步状态检查见 [多 Agent 同步契约](docs/multi-agent-sync.md)。现金、港股股数和早期成交批次仍需券商凭证核实。

本地检查与只验证的 CI 不执行部署。远程迁移和发布遵循 [CF 治理规范](../../docs/development/cloudflare-governance.md) 与[本地发布操作](../../docs/development/local-release.md)，不把检查脚本当作发布工具。发布后，对与部署 source SHA 对应的本地构建执行：

```bash
npm run check:deploy -- --url https://gu.codepi.app
```

检查会逐字节核对线上 JS/CSS 与本地构建，并检查未登录私有接口 401。验证码真实投递、登录后数据和日历需另行验收；只通过配置检查不代表发布完成。

## 运维记录

- 2026-10-16：GU 的 `AUTH_CLIENT_SECRET` 经中央 per-client override（`SSO_CLIENT_SECRET_GU`）轮换，应用侧同值配对后重发；轮换后 GU 现有登录需重新登录。
- 2026-10-17：切换到 Workers 时新建 SSO 与 Desk 摘要凭证并配对更新消费者，只清除旧 GU 登录记录，不迁移旧 OTP 配置；已有 GU 登录需重新登录。完整登录后的数据/摘要与外部上传/日历单独验收。
