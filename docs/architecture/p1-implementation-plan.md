# kdp.cool P1 修复与架构治理实施计划

> 状态：Plan only。本文不执行任何代码、配置、Cloudflare 或 DNS 修改。
>
> 基准：`docs/architecture/architecture-baseline.md`。
>
> 冻结边界：不重新讨论当前总体架构；不引入 workspace、Turborepo/Nx、`shared` npm package、Workers、合并 Pages Project、Terraform/Pulumi 或复杂脚手架系统。

## 0. 已核对的当前事实

- `ai/src/pages/skill-builder/index.astro` 导入 `decodeState`/`pushUrlState`，并将自由文本字段写入 URL。
- `shared/lib/url-state.js` 的 `pushUrlState()` 只用 pathname + 当前工具 state 重建 URL，会丢弃既有 query 参数。
- `shared/layouts/BaseLayout.astro` 对非首页的非 `zh` 语言回退到站点首页；`zh` 工具页使用 `?lang=zh`。
- `shared/i18n/config.js` 定义 9 个 locale；当前非英语首页由 `[locale]/index.astro` 生成。
- `shared/i18n/home-content.js` 保存站点元数据、工具清单和首页内容，但不是唯一站点登记源。
- `shared/components/LocalizedHome.astro` 将 `siteKey` union 写死为六个站点。
- 只有 `calc/package.json` 有 `test` script；仓库没有根级构建编排或 `.github/workflows/`。
- 六个站点通过 `@shared` alias 直接消费 `shared/`；共享变更需要全站验证。

### CONFLICT：基线与现有约定的文档冲突

`AGENTS.md`、`README.md`、`CLAUDE.md` 对站点数量、页面数量和 URL state 约定不完全一致。计划不自行重写基线；文档同步作为 Workflow B 的治理任务，实施时以代码和 registry 为准，并在 PR 中明确解决每个冲突。

---

# Workflow A：产品正确性 / 隐私

Workflow A 不改变“一站点一目录、一站点一 Pages Project”的架构，不引入新的运行时服务。

## A1. Skill Builder 的 URL 隐私边界

### 问题现状

`skill-builder` 当前每次输入变化都通过 `pushUrlState()` 序列化：

- `template`
- `client`
- `name`
- `purpose`
- `trigger`
- `steps`
- `inputs`
- `output`
- `limits`

自由文本可能包含客户信息、内部流程、日志、源码或凭证片段。页面文案同时声明 browser-only、nothing uploaded、private，存在产品语义冲突。

### 涉及文件

- `ai/src/pages/skill-builder/index.astro`
- `shared/lib/url-state.js`
- 可能新增：`ai/src/pages/skill-builder/` 对应测试或纯状态辅助测试文件

### 根因

Skill Builder 复用了面向可分享工具状态的通用 URL 机制，但没有区分：

- 可公开分享的低敏感状态
- 用户自由输入的私密内容

### 修改方案

推荐边界：

1. 默认模式下，自由文本不写入 URL。
2. 当前页面内的生成、编辑、复制体验保持不变。
3. URL 如需保留，只保留明确非敏感的选择项，例如模板类型和 client 类型；是否保留这些字段需按产品定义确认。
4. 如果保留分享能力，必须改成显式用户动作：用户主动点击“生成分享链接”，界面明确提示链接会包含输入内容。
5. 默认输入不应因为普通编辑、刷新、复制按钮而进入 URL。
6. 不使用隐式 URL 编码来继续保存自由文本，以免只是换一种泄露形式。

### 必须保持不变的行为

- 浏览器本地生成 Markdown 的主要流程不变。
- 不调用 AI 模型、不上传到后端的产品边界不变。
- 模板、client 选择、字段编辑、实时预览、复制输出继续可用。
- 页面现有的默认模板和字段初始化行为不变。
- 不为此引入 Workers、数据库、账号系统或新的依赖。

### 潜在副作用

- 默认刷新页面后，自由文本可能不再自动恢复；这是隐私边界改变，必须在 UI 或产品文案中明确，而不是静默发生。
- 旧的包含自由文本的 URL 需要定义兼容策略：推荐仍可读取旧 URL，但不再继续把内容写回 URL；或明确废弃旧分享链接。不能无说明地改变旧链接含义。
- 若产品必须支持分享，需要额外的显式分享交互和安全提示，不能把“URL 分享”与“默认隐私”同时当作无条件能力。

### 测试方案

- 使用页面行为测试或最小浏览器 smoke test，确认普通输入后 `location.search` 不含自由文本。
- 验证模板/client 等允许保留的字段是否符合最终产品决策。
- 验证生成结果、复制按钮和字段编辑未回归。
- 验证旧 URL 的兼容策略：读取、降级或明确拒绝必须有固定结果。
- 对可能包含 `token`、`Authorization`、客户文本的输入做专门回归样例；测试不得打印真实敏感数据。

### 验收标准

- 普通编辑不会把 Skill Builder 自由文本写入地址栏。
- 页面生成和复制体验保持可用。
- 隐私文案与真实 URL 行为一致。
- 分享能力若存在，必须是显式 opt-in，并有内容进入 URL 的提示。
- 旧 URL 的迁移策略有测试和文档记录。

### 是否需要迁移已有行为

**需要定义兼容策略。** 不能直接删除旧 URL 解析而不说明。推荐：旧 URL 可读取一次用于恢复表单，但后续默认不再写回自由文本；历史 URL 本身仍可能含敏感内容，产品文案和分享功能要明确这一点。

---

## A2. `url-state` 保留已有 query 参数

### 问题现状

`shared/lib/url-state.js:53-57` 当前生成：

```text
pathname + encodeState(state)
```

因此会丢失：

- `lang=zh`
- UTM 参数
- consent 或其他非工具参数
- 未来由外部系统加入的 query 参数

### 涉及文件

- `shared/lib/url-state.js`
- `shared/lib/url-state.test.mjs`
- 使用 `pushUrlState()` 的各站点页面（需要按调用方验证）

### 根因

`pushUrlState()` 不读取 `window.location.search`，也没有区分“当前工具拥有的 key”和“外部 key”。

### 修改方案

1. 在现有 URLSearchParams 基础上修改当前工具 state。
2. 只删除/覆盖本次工具明确拥有的 key。
3. 保留未知或外部 query 参数。
4. 保持当前 `undefined`/`null` 的 state 语义：工具 state 中被置空的字段仍按现有约定处理。
5. 保持 `history.replaceState`、不新增历史记录、调用方 debounce 逻辑不变。
6. 设计 API 时优先保持现有 `pushUrlState(state)` 调用兼容；如确需 owned keys，采用可选参数，不强制所有调用方一次性迁移。

### 必须保持不变的行为

- 工具字段仍能被 URL 恢复。
- 同名工具字段仍由新值覆盖。
- URL state 仍使用 `replaceState`。
- 不改变 pathname、locale 路由或各工具默认值。
- 不把新的敏感自由文本自动纳入 URL；A1 的隐私边界优先于通用 URL state。

### 潜在副作用

- URL 可能比现在包含更多历史遗留参数。
- 某些调用方如果依赖“重建 URL 会清空全部 query”，需要先识别并单独处理；不能用全局清空继续掩盖问题。
- 现有旧 URL 不需要迁移格式；这是向后兼容的合并行为。

### 测试方案

扩展 `shared/lib/url-state.test.mjs`，覆盖：

- 保留 `lang=zh` 并新增工具字段。
- 保留 UTM/未知字段。
- 同名工具字段被更新。
- 工具字段被移除时，非工具字段仍保留。
- 无 query 时生成结果与现有行为一致。
- 空 state、`null`、`undefined` 的行为固定。

浏览器 smoke test 验证真实 `history.replaceState` 后地址栏结果。

### 验收标准

- `/tool/?lang=zh` 输入变化后仍保留 `lang=zh`。
- 既有非工具参数不被静默删除。
- 所有现有 URL state 调用方仍能恢复表单。
- `shared/lib/url-state.test.mjs` 覆盖保留和覆盖边界。

### 是否需要迁移已有行为

**不需要 URL 格式迁移。** 旧链接继续可读；改变的是更新时不再删除外部参数。

---

## A3. i18n 语言切换边界

### 问题现状

`BaseLayout.astro` 当前规则：

- 首页：使用 `/<locale>/` 静态路径。
- 非首页英文：保留当前工具路径。
- 非首页中文：保留当前工具路径并加 `?lang=zh`。
- 非首页其他语言：回到该站本地化首页。

语言菜单展示了多种语言，但工具页并不都提供同页翻译。

### 涉及文件

- `shared/layouts/BaseLayout.astro`
- `shared/i18n/config.js`
- `shared/components/LocalizedHome.astro`
- `shared/i18n/zh-tool-translations.js`
- 各站 `[locale]/index.astro`
- 受影响工具页的 `pushUrlState()` 调用

### 根因

首页静态多语言和工具页客户端中文替换共存，但语言菜单没有明确表达“当前页面支持哪些语言”。

### 修改方案

先冻结并记录产品边界，再实施最小行为：

1. 首页继续保留现有 9 locale 静态路由。
2. 中文工具页继续使用当前 `?lang=zh` 机制，直到另有完整翻译方案。
3. 对没有同页翻译实现的其他语言，不再把跳回首页伪装成当前工具的语言切换。推荐在工具页只展示实际支持的语言，或明确标记为“返回该语言首页”。
4. 不在本计划中扩展全站工具页的 9 语言静态翻译。
5. `url-state` 修复必须保留 `lang=zh`。
6. canonical、sitemap、hreflang 语义不因本次修复被错误扩展到不存在的翻译页面。

### 必须保持不变的行为

- 首页 locale 路由保持现有路径格式。
- 默认英文路径保持不变。
- 中文工具页的现有访问方式保持兼容。
- 不凭空生成未翻译语言的工具页。
- 不把 query 翻译页宣称为完整独立 SEO 页面。

### 潜在副作用

- 部分语言选项可能从工具页菜单隐藏或显示为不可用，属于可见 UX 变化，必须在验收中确认。
- 现有收藏的 `?lang=zh` URL 依赖 A2 修复才能保持语言。
- 如果未来产品决定支持完整工具页多语言，需要另立范围，不在本次 P1 计划内。

### 测试方案

- 首页选择各 locale，验证仍进入对应 `/<locale>/`。
- 中文工具页进入 `?lang=zh`，验证页面语言状态和 URL state 更新保持一致。
- 未支持语言的工具页选择行为符合最终产品决策，不再无提示误导用户。
- 验证 canonical/hreflang 只覆盖真实静态本地化页面。

### 验收标准

- 语言菜单的显示内容与实际支持范围一致。
- 中文工具页刷新、复制 URL、输入变化不会丢失 `lang=zh`。
- 首页多语言路由不回归。
- 未实现的工具语言不会被错误标记为完整翻译。

### 是否需要迁移已有行为

**需要兼容已有 `?lang=zh` URL；不需要生成其他语言工具页迁移。**

---

# Workflow B：架构治理

## B1. 全站验证门禁

### 当前问题

- 没有根级验证入口。
- 只有 `calc/` 有 test script。
- 没有 `.github/workflows/`。
- `shared/` 直接影响六个站点。

### 目标状态

每个 PR 在合并前至少能验证：

- 六站依赖可安装
- 六站可构建
- calc 测试通过
- shared/lib 测试被执行
- site registry 完整性通过

### 涉及文件

计划新增：

- `.github/workflows/validate.yml`
- `scripts/check-site-registry.mjs`（或同等轻量检查脚本）

可能修改：

- 各站点 `package.json`，仅在确有必要时补齐 `test` script；不强制为没有测试逻辑的站点制造空测试。

### 最小实现方式

- 使用 GitHub Actions matrix，站点为 `web`, `calc`, `convert`, `text`, `dev`, `ai`。
- 每个 matrix job 在对应目录执行 `npm ci` 和 `npm run build`。
- 单独执行 `cd calc && npm test`，该脚本同时覆盖 `calc/src/lib/*.test.mjs` 与 `../shared/lib/*.test.mjs`。
- 单独执行 registry 完整性检查。
- 使用 Node 22，与 `package.json` engines 和 README 记录一致。
- 不添加 workspace、Turborepo、Nx 或新的测试框架。

### 全量构建还是选择性构建

**第一阶段推荐每个 PR 六站全量 build。**

原因：

- 当前只有六站，复杂度低。
- `shared/` alias 依赖难以靠简单路径过滤完整判断。
- 全量构建最容易证明当前架构契约。
- 先测量真实 CI 时间，再决定是否优化。

选择性构建只作为后续优化：

- 仅某站目录变更：构建该站。
- `shared/`、站点 registry、公共脚本或构建配置变更：构建六站。
- 规则必须保守，不能为了省构建时间漏掉 shared 依赖。

### 风险

- CI 消耗增加。
- Cloudflare 仍可能在 push 后重新构建，CI 不替代 Pages 部署。
- `npm ci` 是否与现有 `.npmrc` 和 lockfile 完全兼容，需要实施阶段实际验证。

### 验证方式

- 提交一个只读的 workflow PR，在无业务改动的前提下观察六站 build、calc test、registry check。
- 本地先逐站执行同样命令。

### 验收标准

- PR 检查能明确报告每个站点 build 结果。
- calc 与 shared/lib 测试在 CI 中执行。
- registry 缺项或域名不一致会使 CI 失败。
- 没有任何 Cloudflare 写操作或部署路径改变。

---

## B2. shared/ 变更后的全站验证

### 当前问题

`shared/` 通过 alias 被所有站点直接消费，没有版本边界或提交前验证。

### 目标状态

任何 `shared/` 变更都触发六站构建验证；shared 变更不改变 Pages 项目边界。

### 涉及文件

- `.github/workflows/validate.yml`
- `shared/`
- 各站点 `astro.config.mjs`
- 可能的 `scripts/check-site-registry.mjs`

### 最小实现方式

不新增运行时逻辑，只在 CI 中将 `shared/**` 视为全站影响路径。第一版直接六站全量 build，不做依赖图系统。

### 是否新增文件

是：CI workflow；可复用检查脚本。

### 是否修改现有运行时逻辑

否。

### 风险

- CI 时间随站点数线性增加。
- 规则过于激进会产生无必要构建，但不会漏验证。

### 验证方式与验收标准

- 修改任一 shared 文件时，六站 build job 都出现。
- 任一站点构建失败，PR 不能通过。
- 不修改 Cloudflare 配置，不修改部署触发方式。

---

## B3. 中心 site registry

### 当前问题

站点身份、域名、门户展示和部署文档存在多个来源，新增站点容易漏登记。

### 目标状态

一份轻量 registry 描述“站点身份和外部部署映射”，用于检查和少量确定性展示，不成为万能配置中心。

### 建议文件位置

```text
shared/site-registry.js
```

理由：

- 已有 `shared/` 源码共享边界。
- 项目当前大量使用 `.js` 模块。
- 可被 Astro 页面和 Node 检查脚本读取。
- 不需要 package 化或新的构建层。

### 格式选择

推荐使用 **JavaScript 模块**，不是 JSON 或 `mjs`：

```js
export const sites = { ... };
export const siteKeys = Object.keys(sites);
```

理由：

- 当前项目已经是 ESM JavaScript。
- 可以导出派生的 key 列表和校验用字段。
- 不需要额外 JSON 解析层。
- 不引入运行时副作用。

### 建议字段

示例结构，仅用于计划，不创建文件：

```js
export const sites = {
  web: {
    directory: 'web',
    domain: 'kdp.cool',
    siteName: 'Kdp.Cool',
    role: 'portal',
    cfProject: 'kdp-portal',
    rootDirectory: 'web',
    enabled: true,
  },
  calc: {
    directory: 'calc',
    domain: 'calc.kdp.cool',
    siteName: 'CalcKDP',
    role: 'tool-family',
    cfProject: 'kdp-tools',
    rootDirectory: 'calc',
    enabled: true,
  },
};
```

建议字段：

- `directory`：仓库目录
- `domain`：主域名
- `siteName`：站点显示名
- `role`：`portal` 或 `tool-family`
- `cfProject`：README 记录的 Cloudflare Pages 项目标识，明确视为外部映射
- `rootDirectory`：Pages root directory 的文档映射
- `enabled`：是否应出现在当前站点家族
- `order`：门户展示顺序，可选

### 不应放入 registry 的字段

不要放：

- 工具页面完整文案
- 所有工具 slug 和工具业务逻辑
- 法务文案
- AdSense publisher ID 或 secret
- Cloudflare API token、环境变量值
- DNS 全部记录
- 组件实现路径
- 统计账号或用户数据
- 每个页面的 SEO 长文
- 站点内部导航的全部细节
- 运行时用户状态

### 现有代码可逐步读取 registry 的部分

第一阶段可迁移：

1. `web/src/pages/index.astro` 的站点 family 卡片元数据。
2. `web/src/pages/about/index.astro` 的站点列表。
3. `shared/i18n/home-content.js` 的 `siteMeta` 基础身份字段。
4. `scripts/check-site-registry.mjs` 的目录、域名、配置完整性检查。
5. 文档校验所需的 Pages root/project 映射。

### 暂时不要迁移的部分

- `src/site.config.js` 的完整内容：它仍是各站点品牌配置的本地真源。
- `homeContent` 的多语言长文案。
- 每站工具数组和工具页内容。
- `navLinks` 的全部运行时逻辑。
- `llms.txt` 原始文本。
- Cloudflare 控制台实际配置。

### 防止 registry 变成万能配置中心

遵守三条边界：

1. Registry 只描述站点级身份、目录和外部映射。
2. 业务内容继续留在各站点和 `shared/i18n/home-content.js`。
3. 任何新增字段都必须回答：是否被至少一个检查或站点级索引消费；否则不加入。

### 验收标准

- registry 中每个 key 对应一个实际站点目录。
- 每个 directory 的 `astro.config.mjs` 的 `site` 与 registry domain 一致。
- registry 不包含 secret 或长篇内容。
- 删除或新增站点时，缺失登记会被检查脚本报告。

---

## B4. 新增站点 checklist

### 当前问题

README 的新增站点 recipe 已覆盖大部分复制步骤，但没有覆盖所有当前真实触点，尤其是：

- registry
- `shared/i18n/home-content.js`
- `LocalizedHome.astro` 的 site key
- 主站 `llms.txt`
- 文档同步

### 目标状态

新增一个二级站可以按照一份仓库内 checklist 完成，不依赖记忆。

### 建议文件

```text
docs/architecture/new-site-checklist.md
```

### Checklist 范围

- 复制参考站点骨架
- 修改 package name
- 修改 `astro.config.mjs` 的 `site`
- 保留 `.npmrc`、Tailwind shared glob、tsconfig
- 添加 `src/site.config.js`
- 添加首页、locale 首页、工具页、品牌页
- 添加/检查 `public/` 文件
- 更新 `shared/site-registry.js`
- 更新必要的 i18n site metadata
- 更新门户入口、llms 和文档
- 本地 build/test
- CI 验证
- Cloudflare Pages 项目、域名和 DNS 由外部步骤单独完成

### 是否修改运行时逻辑

Checklist 本身不修改运行时逻辑。

### 验收标准

- Checklist 覆盖当前代码实际必改文件。
- 新站不因遗漏 registry、locale key、portal 或 sitemap 而出现静默缺项。

---

## B5. 文档与代码同步

### 当前问题

已确认文档漂移：

- `AGENTS.md` 的站点数量口径过期。
- `README.md` 页面数量统计不准确。
- `CLAUDE.md`、README、代码的工具数量描述不完全一致。
- 文档仍残留旧仓库名。
- “所有工具页都持久化 URL”的描述与实际调用范围不一致。此项标记为 **CONFLICT**，实施时必须以代码行为和产品意图重新定稿。

### 目标状态

- registry 成为站点数量、目录和域名的机器可检验事实源。
- README 保留面向人类的部署说明，但不再承担所有代码清单的唯一事实源。
- 文档对 URL state、i18n 和 Cloudflare 外部配置使用准确措辞。

### 涉及文件

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `web/public/llms.txt`
- `docs/architecture/architecture-baseline.md`（如最终事实发生改变，必须显式标记 CONFLICT，不静默改写）

### 是否修改现有运行时逻辑

否。文档同步与 registry 校验应和产品行为修复分开提交。

### 验收标准

- 文档站点列表与 registry 一致。
- 文档不再声称当前没有实现的 URL/i18n 能力。
- 旧仓库名只保留在明确标注为历史的文档中。

---

## B6. 公共配置漂移检测

### 当前问题

六份配置和 public 文件高度相似但独立维护：

- `astro.config.mjs`
- `.npmrc`
- `tsconfig.json`
- `tailwind.config.mjs`
- `_headers`
- `_redirects`
- `ads.txt`
- `robots.txt`

其中部分文件按站点定制，部分文件应该保持共同约束。

### 目标状态

不合并 public，不改变运行时边界；通过检查脚本发现确定性遗漏。

### 最小实现方式

在 `scripts/check-site-registry.mjs` 或同等独立脚本中检查：

- registry 目录都存在
- 每站存在 `package.json`、`astro.config.mjs`、`.npmrc`、`src/site.config.js`
- `astro.config.mjs` 的 site 与 registry domain 匹配
- `package.json` 存在 `build: astro build`
- `.npmrc` 包含公共 registry 和 `legacy-peer-deps=true`
- `tailwind.config.mjs` 包含站点和 `../shared` content glob
- required public 文件存在
- `robots.txt` 的 sitemap host 与站点 domain 匹配
- 站点 key、registry key、locale 首页 `siteKey` 不出现孤立值

不自动重写文件，只失败并报告。

### 是否新增文件

是：检查脚本；后续由 CI 调用。

### 是否修改运行时逻辑

否。

### 验收标准

- 新增站点遗漏必需文件时检查失败。
- 域名、目录、site key 不一致时检查失败。
- 站点特有的 `llms.txt`、图标和文案不被错误强制成相同内容。

---

# 最小 CI 设计

## 推荐模型：先全量、后选择性

### 第一阶段：六站全量 build

每个 PR 执行：

```text
for site in web calc convert text dev ai:
  cd site
  npm ci
  npm run build
```

并执行：

```text
cd calc
npm test
```

`calc` 的 test script 当前已经包含：

```text
calc/src/lib/*.test.mjs
../shared/lib/*.test.mjs
```

另执行：

```text
node scripts/check-site-registry.mjs
```

### 为什么第一阶段不做选择性构建

- 当前只有六站。
- `shared/` alias 让依赖影响面宽。
- 选择性构建规则本身会成为新的漏检点。
- 全量构建最容易证明架构边界。

### 后续选择性构建条件

只有在实际 CI 时间成为问题后再优化：

| 变更路径 | 构建范围 |
|---|---|
| `web/**` | `web` |
| `calc/**` | `calc` |
| `convert/**` | `convert` |
| `text/**` | `text` |
| `dev/**` | `dev` |
| `ai/**` | `ai` |
| `shared/**` | 六站 |
| `shared/site-registry.js` | 六站 + registry check |
| `scripts/**`、构建配置或公共文档 | 至少 registry check；配置影响不明确时六站 |

这是 CI 优化，不是 Cloudflare 部署架构变更。

## CI 验收标准

- 六站 build 均有独立结果。
- calc 与 shared/lib 测试执行。
- registry check 执行。
- 任一站 build/test/check 失败，PR 不通过。
- 不需要 Cloudflare token。
- 不触发 Cloudflare 写操作。
- 不改变 Pages Project、root directory 或 Git push 部署方式。

---

# 分阶段实施顺序

## Phase 1：Workflow A，URL/隐私/i18n 行为边界

### 范围

- Skill Builder URL 隐私边界
- `url-state` query 合并
- i18n 语言菜单与当前工具页行为
- 相关单元测试和浏览器 smoke test

### 独立性

可独立提交、独立回滚，不依赖 registry 或 CI。

### 验证命令/场景

```text
cd calc && npm test
```

以及针对 Skill Builder、中文工具 URL、语言菜单的定向浏览器 smoke test。

### 完成标准

- 自由文本默认不进入 URL，或显式分享边界已产品确认并实现。
- 非工具 query 参数保留。
- `lang=zh` 不丢失。
- i18n 菜单行为与实际支持范围一致。
- 旧 URL 兼容策略有测试。

## Phase 2：站点 registry + 新站 checklist

### 范围

- 新增 `shared/site-registry.js`
- 新增 `docs/architecture/new-site-checklist.md`
- 添加 registry 完整性/一致性检查脚本
- 最小接入主站 family 清单和必要 i18n 元数据

### 独立性

不改变 Pages Project，不引入 workspace，不依赖 CI；可以独立回滚。若 registry 接入运行时页面，必须保证回滚后门户和 i18n 一起回滚。

### 验证命令

```text
node scripts/check-site-registry.mjs
```

相关站点本地 `npm run build`。

### 完成标准

- 六个现有站点全部登记。
- 目录、域名、site key、一致性检查通过。
- 新增站 checklist 覆盖当前真实必改点。
- registry 没有业务长文案、secret 或万能配置字段。

## Phase 3：全站验证 CI

### 范围

- 新增 `.github/workflows/validate.yml`
- 六站 `npm ci` + `npm run build`
- calc + shared/lib `npm test`
- registry check

### 独立性

不改变运行时逻辑、Pages Project 或 Cloudflare 资源。可单独回滚 workflow 文件。

### 验证命令

本地逐站执行与 CI 相同命令；再通过一个无业务变更的 PR 验证 workflow。

### 完成标准

- PR 合并前可以阻止构建、测试或 registry 失败。
- shared 变更触发六站验证。
- CI 不使用 Cloudflare 写权限。

## Phase 4：文档和公共配置漂移治理

### 范围

- 同步 `README.md`、`AGENTS.md`、`CLAUDE.md`
- 修正页面/站点/工具数量口径
- 清理旧仓库名，或明确标记为历史
- 将“每个工具都持久化 URL”等冲突声明改为准确契约
- 将公共配置漂移检查纳入 registry check

### 独立性

主要是文档和检查逻辑；不依赖 workspace、package 化或 Cloudflare 改造。

### 验证命令

```text
node scripts/check-site-registry.mjs
```

并人工核对文档中的站点表、域名表和构建命令。

### 完成标准

- 文档不再与当前代码和 registry 冲突。
- 运行时行为没有因文档治理产生意外变化。
- 检查脚本只报告问题，不自动重写文件。

---

# 下一阶段边界

下一阶段只应先执行 **Phase 1 的详细实现计划**，优先处理产品正确性和隐私边界；不要同时启动 workspace、package 化、Workers 或 Pages 合并等冻结范围之外的工作。

本文件是实施计划，不是实施结果。当前未修改任何业务代码、配置、Cloudflare 资源或 DNS。
