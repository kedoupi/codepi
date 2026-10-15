# GU 私人投资工作台

kedoupi（codepi）旗下的私人投资工作台。Cloudflare Pages 项目 `kdp-gu`，
生产入口为 `https://gu.kdp.cool`，原 `https://kdp-gu.pages.dev` 仍可使用。
两个入口均通过 `auth.kdp.cool` 统一登录，回调在中心逐项登记。

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
npm run typecheck
npm run build
npm run dev
```

站点保持 `style-src 'self'`。动态图形位置通过 `data-*` 与 `web/src/dom.ts` 的 CSSOM 赋值实现；不要在生成的 HTML 中写内联 `style`。

## 数据来源与同步

投资原始资料在独立本地工作区 `<workspace>/Documents/独立本地投资工作区`。先读该工作区的 `AGENTS.md`；投资规则只有 `skills/investment-analysis/SKILL.md` 一份。网页是派生数据的展示层，刷新行情不代表持仓或现金已经重新确认。

生成与上传脚本位于投资工作区的 `scripts/`，不属于本 Git 仓库。当前同步 Schema v2，包含六个 JSON 数组：`account`、`positions`、`risk`、`market`、`history`、`reports`。服务端仍接受已有 Schema v1 的五份批次，缺少历史数据时不画历史曲线。

```bash
cd <workspace>/Documents/独立本地投资工作区
python3 scripts/build_dashboard.py --output-dir /tmp/gu-live-data
python3 scripts/upload_dashboard.py --input-dir /tmp/gu-live-data --dry-run
# 在授权同步的范围内，先通过环境变量配置 GU_UPLOAD_TOKEN：
python3 scripts/upload_dashboard.py --input-dir /tmp/gu-live-data --url https://kdp-gu.pages.dev
```

只上传明确标记 `live` 的完整批次。`/api/sync` 验证校验和、格式及生成时间后，事务更新 D1 当前批次指针；失败或较旧批次不会覆盖当前数据。令牌、券商原件和真实投资 JSON 不提交到网页仓库。

历史图的日期轴按实际间隔展开；档案约值与本批行情估算分别标明来源。连线不代表每日走势或收益率。现金 14% 显示为最低保留线；风控距离和是否触发分别显示，停买不能解释成卖出。

总览置顶显示疲劳锁、月投现金硬刹车等严重提醒。GOOGL 两条减仓线同时触发时，总览只显示强制减仓动作，明细保留两条规则；触发动作与临近分析期限同时展示。报告中的 HTTP/HTTPS 引用在新标签页打开，其余协议保留为文本。任何 API 返回 401 都会清空前端快照，过期前发出的刷新响应也不能恢复旧资产界面。

## 当前边界

Google 投资日历尚未连接，页面明确显示此状态。现金、港股股数和早期成交批次仍需券商凭证核实。代码部署、数据同步、自定义域名启用是独立事项，应分别验收。
