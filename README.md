# kedoupi（codepi）个人数字空间

`codepi.app` 是 kedoupi（codepi）的个人产品与内容入口。健康、投资理财、公众号工作台承载个人生活与工作；博客、笔记和公共 MCP 按阶段建设。广告收入与流量增长不再作为项目目标。

产品目录位于 `apps/`，公开入口的唯一清单是 `packages/shared/products.ts`。Auth、MCP、Ops 与 shared 是支撑层。统一 MCP 的 Health 版本已上线；本轮扩展 Project、Me、GU 只读能力，并新增 `codepi` CLI。新增资源仍为 planned，实际实现、检查与上线状态分别记录在[领域扩展任务](docs/development/tasks/2026-10-20-codepi-mcp-domains.md)。

原先的 `calc/`、`convert/`、`text/`、`dev/`、`ai/` 五个静态工具站、主站旧计算器与指南页、`/tools/` 工具存档，以及 `kdp.cool`、`oura.kdp.cool` 域名均已退役，不保留跳转。退役范围与迁移顺序见 [codepi.app 四产品收尾](docs/development/tasks/2026-10-15-codepi-cutover.md)。

新 Agent 从[工程文档入口](docs/README.md)和[开发导航](docs/development/README.md)开始；
当前结构见[工程架构](docs/architecture/workspace-and-deployment.md)，剩余工作见
[任务索引](docs/development/tasks/README.md)。[个人数字空间方案](docs/superpowers/plans/2026-10-15-personal-digital-space-roadmap.md)
保留最初规划，不能覆盖后续目录、域名与发布决策；统一视觉规则见[共享设计规范](docs/architecture/personal-design-system.md)。

首页是唯一的静态 Astro 站点，通过 `@kedoupi/shared/<subpath>` 复用基础样式、布局与契约，共享入口由严格的 `exports` 白名单声明。所有应用由根 pnpm workspace 统一管理依赖。私人应用保留现有技术栈与数据边界。

## 产品与支撑层

| Path | Domain | CF project | 说明 |
| --- | --- | --- | --- |
| `apps/web/` | `codepi.app` + `www.` | `codepi-www` | 首页、应用介绍、博客与 `desk` 摘要接口 |
| `apps/gu/` | `gu.codepi.app` | `codepi-gu` | 私人投资工作台 |
| `apps/gzh/` | `gzh.codepi.app` | `codepi-gzh` | 公众号稿件、预览与审核台 |
| `apps/health/` | `health.codepi.app` | `codepi-health` + worker `codepi-health-api` | Health |
| `apps/project/` | `project.codepi.app`（planned） | `codepi-project` | 项目卡、任务交接与 GitHub 同步 |
| `apps/me/` | `me.codepi.app`（planned） | `codepi-me` | 待确认记忆、个人资料与经历 |
| `services/auth/` | `auth.codepi.app` | worker `codepi-auth` | 统一登录，客户端表见 shared/auth/clients.ts |
| `services/mcp/` | `mcp.codepi.app` | worker `codepi-mcp` | 统一 MCP，逐工具授权与领域 RPC；独立授权 D1 |
| `services/ops/` | 无公网入口 | worker/workflow `codepi-ops` | 定时巡检、私有 R2 加密备份；见[运维说明](docs/development/cloudflare-operations.md) |
| `packages/cli/` | — | — | 官方 MCP SDK 客户端；本地 CLI |
| `packages/shared/` | — | — | 布局、样式 token、产品登记等共享源码 |

部署要点：`apps/web` 的部署配置已迁为 Workers Static Assets（`/api/*` 与 `/desk` 路径优先进入 Worker，公开页面静态服务），实施与域名切换状态见 [首页迁移记录](docs/development/tasks/2026-10-17-web-static-assets.md)；`apps/gu` 与 `apps/gzh` 自 2026-10-17 起使用 Workers Static Assets，分别由 Worker `codepi-gu`、`codepi-gzh` 服务正式域名（`run_worker_first = true`，经 `wrangler deploy` 发布），GZH 切换证据见 [迁移记录](docs/development/tasks/2026-10-17-gzh-static-assets.md)；`apps/health` 前端发布到 `codepi-health`，API worker 名 `codepi-health-api`。所有应用共享根 pnpm workspace。发布从已合并 main 在本机执行，复用各应用脚本，步骤遵循下方 CF 治理规范。数据库与环境绑定以资源登记表及运行配置为准。


## 广告与历史工具

广告脚本、广告组件与占位、`ads.txt` 都已移除，不要重新引入广告审核或占位要求。旧计算器与工具地址已随工具站一起退役，不再保留入口。

历史拒审与部署记录保存在 `docs/architecture/adsense-review-hardening-record.md`，只供历史参考。

## SEO + GEO

公开内容保留搜索与 AI 可发现性设施；不作为广告或流量增长目标，私有应用和 Desk 数据不进入公开索引。

| Lever                                | Where it lives                              |
| ------------------------------------ | ------------------------------------------- |
| Sitemaps (`sitemap-index.xml` + `sitemap-0.xml`) | Auto-emitted by `@astrojs/sitemap` for `apps/web/` |
| `robots.txt` explicitly Allows AI bots (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, etc.) | `apps/web/public/robots.txt` |
| `llms.txt` (site summary + key page links per [llmstxt.org](https://llmstxt.org/)) | `apps/web/public/llms.txt` |
| Internal links between products | `apps/web/src/components/ProductList.astro` |
| Cloudflare crawler / AI bot settings | 平台设置须按需只读核实，仓库文件不证明当前开关状态 |

搜索平台登记是按需操作，不是 Agent 默认下一步。

## Local development

从 [规范与工作流导航](docs/development/README.md) 开始：根与局部 `AGENTS.md` 定义项目约束；`.agents/skills/` 提供 `kdp-dev`、`kdp-review`、`kdp-release`、`kdp-handoff` 四个入口；[开发工作流](docs/development/agent-workflow.md) 和 [集成发布流程](docs/development/integration-release.md) 维护执行步骤。各工具按 [兼容说明](docs/development/agent-compatibility.md) 共用这些来源。`node scripts/agent/check.mjs --base <基线SHA>` 只预览检查计划，加 `--run` 才执行。

The homepage is the only Astro project; it imports shared APIs via the `@kedoupi/shared/<subpath>` exports allowlist and its own `src/site.config.js` via `@site/*`. The private apps use their own stacks. All packages are managed by a single pnpm workspace.

```bash
pnpm install                    # install all workspace dependencies
cd apps/web && npm run dev      # :4321
cd apps/web && npm test         # builds services/auth, then node:test
cd apps/web && npm run build    # → apps/web/dist
```

Health: `cd apps/health && pnpm test`, `pnpm typecheck`, `pnpm build`.
MCP: `cd services/mcp && pnpm test`, `pnpm typecheck`, `pnpm test:browser:built`。架构、数据语义与扩展方式见[统一 MCP](docs/architecture/unified-mcp.md)。

The root `.npmrc` pins `legacy-peer-deps=true` and `registry=https://registry.npmjs.org/`. `pnpm install` from the repository root installs all workspace packages.

`packages/shared/` is a workspace member consumed by the homepage and by the private app bundles. `packages/shared/auth/client.test.mjs` runs against the Health workspace dependencies.

## Deployment

Cloudflare 基础设施的命名、环境、域名、密钥、发布与退役规范见
[Cloudflare 项目级治理规范](docs/development/cloudflare-governance.md)；
资源归属、最近核验记录与未决项见
[Cloudflare 资源登记表](docs/development/cloudflare-resource-registry.md)。
登记表是版本化快照，不是实时控制面。受控发布按 [本地发布操作](docs/development/local-release.md) 从已合并 main 执行；GitHub Actions 只验证，合并不等于上线。

### Build commands (reference)

| Project | Command working directory | Build cmd | Output relative to working directory |
| --- | --- | --- | --- |
| `codepi-www` | `apps/web` | `npm run build` | `dist` |
| `codepi-gu` | `apps/gu` | `npm run build` | `dist` |
| `codepi-gzh` | `apps/gzh` | `npm run build` | `dist` |
| `codepi-health` | `apps/health` | `pnpm --filter @health-kdp/web build` | `apps/web/dist` |

这里只列构建命令，不是 Dashboard 自动构建设置，也不代表完整检查与发布步骤。Node、依赖安装和发布参数以当前 workflow 为准。
Health workspace 包名为 `health-kdp`、`@health-kdp/web`、`@health-kdp/api`；Oura 是其中一个数据提供方。命名调整记录见 [Health 应用命名](docs/development/tasks/2026-10-18-health-naming.md)。

`codepi-www` 由 Astro 输出静态文件，Wrangler 打包 `apps/web/worker/index.ts` 并上传资产。
不再生成 Pages `_worker.js`；静态文件与 Desk API 的路由由 `apps/web/wrangler.toml` 声明。

### DNS records (CF zone for `codepi.app`)

| Name              | Type  | Target                       | Proxied |
| ----------------- | ----- | ---------------------------- | ------- |
| `codepi.app` (apex) | —    | Worker custom domain `codepi-www`（2026-10-17 已切换） | yes |
| `www`             | —     | Worker custom domain `codepi-www`（2026-10-17 已切换） | yes |
| `gu`              | AAAA | `100::`（Worker custom domain `codepi-gu` 自动管理，2026-10-17 已切换） | yes |
| `gzh`             | AAAA | `100::`（Worker custom domain `codepi-gzh` 自动管理，2026-10-17 已切换） | yes |
| `health`          | —     | Worker custom domain `codepi-health`（2026-10-18 已切换） | yes |
| `auth`            | —     | Worker custom domain `codepi-auth` | yes |

上表描述产品域名映射，不是本次实时 DNS 查询。`kdp.cool` 与 `oura.kdp.cool` 的产品网站已退役，不再作为产品入口或跳转目标；实际残留与兼容入口按资源登记表核实。原 `kdp.cool` 的邮件路由与邮件身份、用户指定保留的 `wechat-proxy` 不在网站退役范围，不能随旧站一并删除。

## Adding or retiring a product

经批准新增应用时：

1. 新建 `apps/<id>/`、局部 AGENTS/README、自己的 D1 migration 和 SSO schema；沿用 workspace 技术栈。
2. 更新 `packages/shared/products.ts` 与公开入口；Desk 只展示其已实现的摘要来源，不能因产品登记就自动查询新业务。
3. 在 `packages/shared/auth/clients.ts` 登记客户端与精确回调，配对 secret 独立授权执行，不轮换其他客户端。
4. 登记 Worker、D1、域名、私有对象桶为 planned；真实 ID 与上线证据只能在创建、验证后回填。
5. 更新 affected 检查、migration guard、CI、release scope、版本巡检与 Workers Issues。
6. 将 D1 和索引原件纳入备份、跨平台副本及隔离恢复；无完整恢复证据不能称已验收。
7. 接入 MCP 时，应用导出 `<Name>Mcp` named RPC；shared 只放契约，MCP 注册工具、逐工具 scope 和 binding，不绑定业务库。
8. `get_context` 摘要需独立读权限、大小限制与超时降级；新增客户端真实授权与发布按任务逐项验收。

`SSO_EXTRA_REDIRECT_URIS` 只追加精确 callback，不创建客户端。Project/Me 的默认
callback 可以先声明，缺少 opt-in secret 时客户端仍关闭，既有登录保持可用。
仅保留 local 与 production。

退役产品时按顺序执行：先移除代码与入口，再更新 `packages/shared/products.ts` 和文档，然后按资源登记表撤下 Worker 自定义域/路由，最后处理 DNS 与服务资源。平台管理的 DNS 需核实实际归属；数据（D1、对象存储）单独确认后再处理。具体步骤见[集成与退役流程](docs/development/integration-release.md)。

## Notes

- `output: 'static'` + `trailingSlash: 'always'` + `format: 'directory'` produces clean URLs like `/about/` with `index.html` inside.
- Sitemap is emitted as `sitemap-index.xml` (index) referencing `sitemap-0.xml`. `robots.txt` points at the index.
- Static response headers come from the app's `_headers`/asset configuration; Worker-generated responses use their own handlers. Check the app's asset tests and response code when changing either path.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` hold design specs and implementation plans from the brainstorm → plan → execute workflow used to build this repo.
- `packages/shared/` is a private workspace package. Consumers import its source through the explicit `@kedoupi/shared/<subpath>` exports allowlist; unlisted module paths are rejected.

## Roadmap

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| P1 | 个人首页、应用介绍、共享视觉基础 | 已上线 |
| P2 | Health 视觉统一 | 已上线 |
| P3 | GU 视觉统一 | 已上线 |
| P4 | 公众号工作台（GZH）视觉统一 | 已上线 |
| P5 | 博客栏目上线（`/blog/`），公开笔记与内容发布 | 博客已上线 |
| P6 | 本人工作台与按需摘要（`/desk/`） | 已部署；登录后的三来源摘要使用验收见任务索引，不凭早期 TODO 判断配置缺失 |
| P9 | 五站下线、codepi.app 迁域、四产品收尾 | 已完成（Pages 全部退役，四产品均为 Workers Static Assets） |
| P7 | 公开内容 MCP | 待实施 |
| P8 | 私人应用的授权 AI 能力 | 统一 MCP 已上线，Health 已在 Claude 手机端使用；其他模块按产品进度设计 |

私人应用全面换肤在各自迁移阶段执行，须沿用共享设计规范并单独验证业务状态。

P10：CodePi MCP 领域扩展的实现与验收见[当前任务](docs/development/tasks/2026-10-20-codepi-mcp-domains.md)，未发布部分不得按旧 Health 上线记录推定完成。
