# GU 私人投资工作台

kedoupi（codepi）旗下的私人投资工作台。Cloudflare Worker `codepi-gu`（Workers Static Assets 架构，`run_worker_first = true`，全部请求先进 Hono 鉴权链再回源静态资产），生产入口为 `https://gu.codepi.app`，通过 `auth.codepi.app` 统一登录；退出会撤销对应的中心会话。资源与域名核验记录见 [CF 资源登记表](../../docs/development/cloudflare-resource-registry.md)。2026-10-17 已从 Pages 切换到 Workers，发布遵循[本地发布操作](../../docs/development/local-release.md)，正式域名由 Worker custom domain 管理；切换与配置重建证据见 [GU 运行配置重建](../../docs/development/tasks/2026-10-17-gu-runtime-bootstrap.md)。

统一登录中心固定向本人邮箱发送验证码，登录后查看持仓、风控、报告与数据来源。生产启用 `SSO_ENABLED=1`，旧的本地验证码接口关闭；本地及预览可显式关闭 SSO 用于隔离测试。私人数据仅通过会话鉴权 API 读取，不打包进静态资源。

## 线上工作台（第一阶段）

代码新增 `#workspace` 入口。实现与部署状态见[任务记录](../../docs/development/tasks/2026-10-19-gu-online.md)；源码存在不表示生产已启用。

- 可从空账户开始，在线维护持仓、现金/其他余额、成交流水、投资规则和研究报告；规则支持 Markdown/TXT 导入，报告支持批量 Markdown/TXT 导入。
- 先预览再确认保存。D1 追加工作台版本，校验编辑者的基础版本；并发编辑冲突保留草稿供导出，不覆盖另一窗口的更新。重复保存请求按请求 ID 去重。
- 主动退出或返回旧看板前，未保存草稿需要确认丢弃；会话失效仍立即清除私人内容，不通过确认框保留过期数据。
- 保存的是账户快照；流水独立记录，录入交易不会自动重算持仓、成本或现金。历史不完整时不构造虚假账本。金额和数量使用最多六位小数的十进制文本，USD 参考估值精确汇总；空值表示未知，缺估值时不显示完整总资产。
- 原币金额、参考 USD 估值、日期和来源分别填写，日期按 Asia/Shanghai 校验。本阶段不自动换汇、采集行情或执行自由文本投资规则。报告分别保存归档日、对应交易日和日期来源；依据的工作台版本由作者明确选择，新报告默认未记录，不能从当前编辑版本推断分析依据。
- 首次保存启用线上权威模式，网页和 Desk 摘要转用同一线上数据；不再显示旧快照中的风控结论。旧上传接口返回 409，不能覆盖线上账户。
- 旧看板快照可以在启用前载入草稿供核对，确认前还会检查来源批次未变。缺失的原币种、成本、交易流水和规则正文保持未知；现金/基金合计标为待拆分。旧历史表不删除。
- 已保存版本和草稿可导出为 Schema 1 JSON；导入必须预览确认，历史版本可只读查看。导入报告的原版本编号保留为来源说明，不误指向当前环境同编号的版本。导出包含资料索引，不包含原件或登录凭证。
- 私人资料支持 PDF、PNG、JPG、TXT、Markdown、CSV、JSON，每份最多 8 MiB；保存在 R2，元数据在 D1。下载必须经过 GU 会话鉴权，不提供公开 bucket 链接。上传仅保存原件，不执行 OCR 或修改账户。
- 相同内容重传复用资料 ID，缺失的 R2 原件可由重传修复。D1 写入回执失败时保留已上传对象，避免删掉实际已提交的原件；可能留下无索引对象，后续对账不能仅凭某次失败回执删除原件。

本阶段保留单账户所有者、多资产记录能力，不引入模型提供方、定时研究或 GU MCP；
后续任务将调用线上业务能力，不再依赖外部本机脚本。

### API 与存储

| 接口 | 用途 |
| --- | --- |
| `GET /api/workspace` | 当前版本、结构化数据、估值完整性及资料能力状态 |
| `POST /api/workspace/preview` | 校验 `data` 并生成预览，不落库 |
| `PUT /api/workspace` | `data`、`base_revision`、`request_id`、`confirmed: true`；导入旧快照另带 `source_batch_id` |
| `POST /api/workspace/import-legacy` | 在线启用前读取旧快照到预览，不落库 |
| `GET /api/workspace/history` / `versions/:revision` | 最近 100 个版本索引、指定版本内容 |
| `GET /api/workspace/export` | 导出线上内容与资料索引 |
| `GET` / `POST /api/materials` | 私有资料列表 / multipart `file` 上传 |
| `GET /api/materials/:id` | 经鉴权下载原件 |

这些接口均处于已有 SSO/会话门后，写入还校验同源 Origin；上传令牌不能替代浏览器会话。
Schema 由 `worker/workspace-types.ts` 和 `workspace-validation.ts` 定义。工作台正文总计
最多 1.5 MB，适合个人记录；JSON 导入文件上限 8 MiB，包含格式化和资料索引开销，
导入后的正文仍遵循 1.5 MB 限制。大型附件放资料库。旧客户端未声明 `X-GU-Workspace: 1`
时，启用后的 `/api/dashboard` 返回 409 要求重新加载，避免把线上账户误解为旧快照。

### 发布前置与数据迁移

2026-10-19 已经 PR #107 完成 migration、私有资料桶及 GU → Ops 发布，
真实 GU D1 隔离恢复通过；生产仍为 revision 0、资料 0 件，尚未执行首次确认或真实资料迁移。
跨平台副本与非空真实原件恢复仍未验收，具体见[任务证据](../../docs/development/tasks/2026-10-19-gu-online.md#实际发布与验收)。
以下为流程约定，不能据此重复创建既有资源或自动导入账户。

1. 在授权发布中创建并核验私有 R2 `codepi-gu-uploads`（`MATERIALS`），关闭公开域名和公开 r2.dev；登记状态由 `planned` 更新为实际证据。
2. 对 GU D1 应用追加迁移 `0003_online_workspace.sql`，然后发布兼容代码。迁移本身不启用线上模式、不复制或删除真实数据。
3. 在登录后从旧快照/导出文件建立草稿，补充规则与原始报告；核实之后确认首次保存。确认前旧批次模式继续可读。
4. 分别验收账户保存、旧上传拒绝、SSO 退出、Desk 摘要、私有资料上传下载和导出。
5. 原件由 Ops 经 `GU → codepi-gu#GuMaterialsBackup` 读取，在现有公钥加密链路中独立备份。
   Ops 无 GU D1/R2 binding、无新增同步 secret；公开 HTTP 不提供该能力。
   六库和全部有索引原件成功后才提交完整清单，跨平台复制另验收。实现与本地合成恢复通过
   不代表生产已备份；启用唯一线上保存前，按[恢复 runbook](../../docs/development/cloudflare-backup-restore.md)
   核验真实密文、新鲜度及隔离恢复。先发布 GU 的 RPC，再发布 Ops。

首次启用后，代码回退到不认识线上版本的实现会显示旧快照；这不是安全的业务回退方式。
发生故障应前向修复或读取保留版本恢复，不能以 Worker rollback 代替数据恢复。

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

## 旧批次的数据来源与同步（首次线上保存前）

旧模式的投资原始资料在独立本地工作区 `/Users/codepi/Documents/美股理财`。访问前读该工作区的 `AGENTS.md`；旧投资规则在 `skills/investment-analysis/SKILL.md`。这些资料是一次性迁移来源，线上启用后以 GU 已确认版本为准，不再要求本机持续生成/上传。旧模式网页展示派生数据，刷新行情不代表持仓或现金已经重新确认。

生成与上传脚本位于投资工作区的 `scripts/`，不属于本 Git 仓库。当前同步 Schema v2，包含六个 JSON 数组：`account`、`positions`、`risk`、`market`、`history`、`reports`。服务端仍接受已有 Schema v1 的五份批次，缺少历史数据时不画历史曲线。

```bash
cd /Users/codepi/Documents/美股理财
python3 scripts/build_dashboard.py --output-dir /tmp/gu-live-data
python3 scripts/upload_dashboard.py --input-dir /tmp/gu-live-data --dry-run
# 在授权同步的范围内，先通过环境变量配置 GU_UPLOAD_TOKEN：
python3 scripts/upload_dashboard.py --input-dir /tmp/gu-live-data --url https://gu.codepi.app
```

只上传明确标记 `live` 的完整批次。`/api/sync` 验证校验和、格式及生成时间后，事务更新 D1 当前批次指针；失败或较旧批次不会覆盖当前数据。令牌、券商原件和真实投资 JSON 不提交到网页仓库。

历史图的日期轴按实际间隔展开；档案约值与本批行情估算分别标明来源。连线不代表每日走势或收益率。现金 14% 显示为最低保留线；风控距离和是否触发分别显示，停买不能解释成卖出。

总览置顶显示疲劳锁、月投现金硬刹车等严重提醒。GOOGL 两条减仓线同时触发时，总览只显示强制减仓动作，明细保留两条规则；触发动作与临近分析期限同时展示。报告中的 HTTP/HTTPS 引用在新标签页打开，其余协议保留为文本。任何 API 返回 401 都会清空前端快照，过期前发出的刷新响应也不能恢复旧资产界面。

## 旧批次界面边界

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
