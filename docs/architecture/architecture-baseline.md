# kdp.cool Architecture Baseline

> 状态：基线决策。后续架构任务优先读取本文，不重复讨论已确认的总体方向。
>
> 范围：只记录已完成仓库调查、线上验证和 reviewer 诊断结论。不包含本文件之外的重构方案。

## 1. 已确认保留的架构决策

### 1.1 仓库与站点边界

- 保留一个 Git 仓库：`kedoupi/kdp.cool`。
- `web/` 继续作为主站，域名为 `kdp.cool`。
- `calc/`、`convert/`、`text/`、`dev/`、`ai/` 继续作为独立二级站。
- 每个站点继续是独立 Astro 项目，拥有自己的 `package.json`、lockfile、`astro.config.mjs`、`public/` 和构建产物。
- 新二级站继续采用“一目录、一构建、一域名”的边界。

原因：站点职责清楚，域名、SEO、构建和故障边界独立；当前规模下复制现有站点骨架的成本可接受。

证据：`web/`、`calc/`、`convert/`、`text/`、`dev/`、`ai/`；各站点 `package.json` 与 `astro.config.mjs`。

### 1.2 技术栈与输出

- 保留 Astro 6、Tailwind CSS 3、`@astrojs/sitemap`、Node.js `>=22.12.0`。
- 保留 `output: 'static'`、目录式输出和 `trailingSlash: 'always'`。
- 继续使用浏览器本地计算和静态页面，不为静态工具引入后端。
- 保留 Node 原生 `node:test`，不引入新的测试框架作为架构前提。

原因：静态输出简单、成本低、缓存友好、部署风险小，适合当前工具型产品。

证据：各站点 `astro.config.mjs`、`package.json`、`.npmrc`。

### 1.3 公共源码层

- 保留 `shared/` 作为公共源码目录，不立即包装成 npm package。
- 保留每个站点 Astro 配置中的 Vite alias：
  - `@shared` → `../shared`
  - `@site` → 当前站点 `src/`
- `shared/` 继续承载公共 UI、布局、SEO、广告、国际化、URL 状态、图表和重定向能力。
- 每站 `src/site.config.js` 继续承载本站品牌信息。

原因：当前共享能力已经有效复用，且没有仓库外消费或独立发布需求；alias 比包发布更轻。

证据：`shared/`、各站点 `astro.config.mjs`、各站点 `src/site.config.js`、`shared/layouts/BaseLayout.astro`。

### 1.4 Cloudflare 部署边界

- 继续保持“一站点一个 Cloudflare Pages Project”。
- 继续由 Git push 触发各站点自动部署；每个 Pages Project 使用对应站点目录作为 root directory。
- 不合并主站和二级站的 Pages Project。
- Cloudflare Workers/Pages Functions 不作为当前静态站点的默认运行时。

原因：独立 Pages Project 提供域名、构建和故障隔离；当前静态站不需要服务端能力。

说明：仓库只能直接证明静态构建和站点目录；Pages 项目、控制台绑定、环境变量和最近部署详情此前无法通过当前环境读取，仍以 Cloudflare 控制台为准。

证据：各站点 `astro.config.mjs`；部署表和触发说明见 `README.md`，属于文档记录而非仓库内可执行配置。

### 1.5 复杂度边界

- 优先选择低依赖、低配置、可复制的方案。
- 不为了形式上的“标准 monorepo”改变当前站点边界。
- 新能力首先复用现有 `shared/` 和站点模板，不新建额外平台层。

## 2. 明确暂时不做的事情

| 事项 | 决策 | 原因 |
|---|---|---|
| npm/pnpm workspace | 暂不做 | 当前独立 lockfile 与 Pages root directory 兼容；workspace 会增加安装和部署耦合。 |
| Turborepo / Nx | 暂不做 | 当前没有构建编排瓶颈；引入后增加缓存、任务图和配置复杂度。 |
| `shared/` npm package | 暂不做 | 没有仓库外消费者或版本发布需求；alias 已满足当前共享。 |
| 合并 Cloudflare Pages Projects | 不做 | 会削弱站点故障隔离，并引入多域名路由和单应用部署耦合。 |
| Terraform / Pulumi | 暂不做 | Cloudflare 资源规模和变更频率尚未证明需要 IaC；当前会增加第二套配置源。 |
| 复杂脚手架生成系统 | 暂不做 | 新站确定性步骤可以用清单或轻量脚本覆盖，不需要维护完整生成平台。 |
| Workers | 暂不做 | 当前站点是静态浏览器工具；只有明确出现密钥、实时外部 API 或服务端计算需求时再评估。 |
| 构建期统一生成所有 `public/` | 暂不做 | `robots.txt`、`llms.txt`、图标和 headers 存在站点差异，构建魔法会增加隐式行为。 |

## 3. 当前需要解决的问题

### P1：产品正确性 / 隐私 / 运行治理

1. **Skill Builder 将自由文本写入 URL**
   - 文件：`ai/src/pages/skill-builder/index.astro`
   - `name`、`purpose`、`trigger`、`steps`、`inputs`、`output`、`limits` 等内容进入 query string。
   - 这与页面的 browser-only / nothing-uploaded 隐私表达不一致，并可能进入浏览器历史、分享链接、Referer 或日志。

2. **缺少提交前的全站验证门禁**
   - 证据：仓库无根级构建脚本、无 `.github/workflows/`；只有 `calc/package.json` 有测试脚本。
   - `shared/` 改动可能影响全部站点，但当前没有提交前的全站 build/test 验证。

3. **全量部署 fan-out 缺少验证隔离**
   - 证据：`README.md` 记录一次 push 会触发全部 Pages 项目；各站点直接 alias 引用 `shared/`。
   - 这不是要求合并 Pages 的理由，而是说明 shared 变化需要先验证，避免回归同时进入多个站点。

4. **统计能力缺失或不可从仓库复现**
   - `shared/layouts/BaseLayout.astro` 有 AdSense 注入，但没有可见的共享 analytics 脚本、事件收集器或站点测量配置。
   - 隐私页/文档若声明 Cloudflare Web Analytics，则该能力属于 Cloudflare 外部配置，当前仓库无法复现或验证。

### P2：架构治理 / 可扩展性 / 体验一致性

1. **URL state 会覆盖已有 query 参数**
   - 文件：`shared/lib/url-state.js`
   - 写入工具状态时重建 query，可能丢失 `lang=zh`、UTM 或其他既有参数。

2. **工具页 i18n 语义不完整**
   - 文件：`shared/layouts/BaseLayout.astro`
   - 非首页选择部分语言会回到站点首页，而不是保留当前工具页。
   - 中文工具页主要靠客户端 DOM 翻译，不是独立可索引的完整语言页面。

3. **缺少单一站点 registry**
   - 站点清单分散在 `web/src/pages/index.astro`、`web/src/pages/about/`、`web/public/llms.txt`、`shared/i18n/home-content.js`、`README.md`、`AGENTS.md` 和 `CLAUDE.md`。
   - 新增站点容易漏门户、i18n、llms 或文档登记。

4. **文档与代码漂移**
   - `AGENTS.md` 仍按五站点描述，当前代码是六站点。
   - README 的 indexable page 数量与实际 `[locale]` 路由、guides 路由不一致。
   - 部分文档仍使用旧仓库名 `kdp-tools`。

5. **重复配置和公共资产已开始分叉**
   - 六份 `astro.config.mjs`、`.npmrc`、`tsconfig.json`、`tailwind.config.mjs`、`public/` 和品牌页高度相似但分开维护。
   - 不同站点的 Astro 版本和依赖分类已出现差异。

### P3：低优先级清洁项

- 文档中的工具数量、站点数量、页面数量和旧名称等小型漂移。
- 个别 schema、品牌资产和公共文案的小差异。
- 重复声明但当前行为没有明显错误的低风险配置。

P3 不应单独驱动架构重构。

## 4. 两类工作边界

### A. 产品正确性 / 隐私 / Bug

包括：

- Skill Builder 隐私内容进入 URL
- `url-state` 丢失已有 query 参数
- i18n 语言切换离开当前工具页
- 统计声明与实际实现不一致
- 各工具页面实际逻辑错误、输入边界和输出正确性

这类工作应优先按具体文件、具体行为修复，不应借机重构整个仓库。

### B. 架构治理 / 可扩展性

包括：

- 提交前全站 build/test 验证
- 站点 registry
- 新增站点 checklist 或轻量 scaffold
- 文档和站点清单同步
- 重复配置的低风险收敛

这类工作不能改变“一站点一目录、一站点一 Pages Project”的基础边界。

## 5. 未来优化的核心目标

总目标：

> 保持当前简单部署模式，同时把新增二级站变成低成本、低遗漏、可验证的标准流程。

可衡量目标：

1. **新增站点登记完整率 100%**
   - 新站必须同时出现在站点 registry、主站入口、i18n、`llms.txt`、部署表和文档中。

2. **新增站点的确定性步骤可重复执行**
   - 站点目录、配置、基础 public 文件和品牌页骨架不再依赖临时记忆；执行清单应能覆盖全部必改文件。

3. **共享层变更在发布前完成全站验证**
   - 任何 `shared/` 变更都应验证受影响站点；至少不能只依赖生产部署后才发现构建失败。

4. **站点级故障保持隔离**
   - 一个站点的页面、构建或域名问题不应要求合并所有站点，也不应改变其他站点的 Pages 边界。

5. **公共产品能力有可验证的单一事实来源**
   - UI、SEO、i18n、导航、广告、统计的状态应能从仓库或明确的 Cloudflare 配置中核对，而不是只依赖散落文档。

## 6. Architecture Decision Record

### ADR-001：保留独立静态站点 monorepo

- **状态**：Accepted
- **决策**：一个 Git 仓库承载主站和多个独立 Astro 静态站点；站点通过 `shared/` 源码和 Vite alias 复用公共能力。
- **原因**：低运行时耦合、低部署复杂度、站点级故障隔离、适合 Cloudflare Pages。
- **拒绝的替代**：workspace、共享 npm package、单应用多域名、Workers-first 架构。
- **重新评估条件**：只有当依赖管理、站点登记、构建验证或服务端能力出现明确瓶颈时，才重新评估对应边界；不能仅因站点数量增加而自动推翻当前架构。

### ADR-002：保留一站点一个 Cloudflare Pages Project

- **状态**：Accepted
- **决策**：每个站点继续使用自己的 root directory、构建产物、域名和 Pages Project。
- **原因**：保持部署和故障隔离，符合当前静态站点模型。
- **重新评估条件**：只有 Cloudflare 项目数量、构建时间或运维成本形成已验证瓶颈时，才讨论其他部署形态。

### ADR-003：新增站点优先解决登记和验证，不引入重型平台

- **状态**：Accepted
- **决策**：新增站点先采用明确 checklist、中心 registry 和轻量验证；不先引入 workspace、Turborepo、Nx、IaC 或复杂 scaffold 平台。
- **原因**：当前真实瓶颈是遗漏和缺少门禁，不是构建系统表达能力不足。
