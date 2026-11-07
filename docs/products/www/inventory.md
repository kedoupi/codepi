# www 功能清单

> 只读盘点，基于 `~/Coding/codepi/apps/web`（Astro 6 + Workers Static Assets）及其依赖（`packages/shared`、`services/mcp`）。画布核对依据 `ds2/project/<名>.dc.html` 的可见文字（未渲染截图，视觉布局未核）。
> 路径简写：`W:` = `apps/web/`，`S:` = `packages/shared/`，`M:` = `services/mcp/`。示例数据一律为「示例」，不含凭据、IP、私有 URL。

## 概览

- 站点：codepi.app（公开站 + 本人工作台 `/desk/`），Worker 名 `codepi-www`，静态资源 + Worker 混合。`run_worker_first` 只覆盖 `/api/*`、`/desk*`、`/blog/*`、`/sitemap-blog.xml`（`W:wrangler.toml:7-10`）。
- 公开页（静态）：首页、应用、关于、联系、使用说明、隐私、404、`/prototype/three/`。博客列表/文章/标签/系列/预览由 Worker 用 HTMLRewriter 往静态 `/blog/` 壳里注入（`W:worker/index.ts:26-86`）。
- 全站外框（`S:layouts/BaseLayout.astro`）：顶栏品牌、主导航（首页/应用/博客/关于 + 我的工作台）、手机端 `<details>` 抽屉菜单、页脚（关于/博客/隐私/联系）、跳到正文链接。导航数据来自 `W:src/site.config.js:7-12`。
- 私域：`/desk/` 只出页面壳，数据全部由登录后的 `/api/*` 取（`W:AGENTS.md`）。Desk 含三源概览（健康/GU/公众号）、按需摘要、需要处理、博客审核（队列/详情/对比/小改/分类/发布/下架/归档）。
- 对外接口：Desk API（会话制）、博客 RSS/sitemap/媒体、博客 MCP 工具（经 `services/mcp` 转发，仅本人）。
- 画布已决定去掉但代码还在：应用页、联系页、使用说明页、404、`/prototype/three/`（见页面表，标「画布已移除，需张老板确认去留」）。画布导航为 首页/博客/关于/隐私说明 + 我的工作台按钮，代码导航多出「应用」。

## 页面与视图

| ID | 页面 | 路由 | 桌面/手机差异 | 源码 |
|---|---|---|---|---|
| W-P01 | 首页 | `/` | 3D 滚动 Hero（460vh 粘性舞台，四幕章节切换）；<1024px 改堆叠布局、文案顶部对齐；矮横屏（高<520）单独适配；`prefers-reduced-motion` 关动画直接显示 | `W:src/pages/index.astro:1-7`；`W:src/components/PersonalHome.astro:7-171, 1251-1380` |
| W-P02 | 应用（画布已移除，需张老板确认去留） | `/apps/` | 产品卡网格（详细版带 detail）；窄屏单列（样式在页内） | `W:src/pages/apps/index.astro:1-60`；`W:src/components/ProductList.astro:1-60` |
| W-P03 | 博客列表（含分类筛选/分页/标签页/系列页/空态） | `/blog/`、`/blog/?category=&page=`、`/blog/tag/:t/`、`/blog/series/:s/` | 卡片列表；<720px 样式收窄 | `W:src/pages/blog/index.astro:1-25`；`W:worker/index.ts:26-86, 126-135`；`W:src/styles/blog.css:98` |
| W-P04 | 文章页 | `/blog/:slug/` | 头图、目录、资料来源、上下篇、AI 协作声明；表格/代码块可横向滚动 | `W:worker/index.ts:60-80`；`W:src/styles/blog.css:27-66` |
| W-P05 | 草稿预览（仅本人） | `/blog/preview/:slug/` | 同文章页，加预览横幅、noindex、未登录 302 到登录 | `W:worker/index.ts:27-30, 66-68, 130-134` |
| W-P06 | 关于 | `/about/` | 单栏叙述页，窄屏堆叠 | `W:src/pages/about/index.astro:13-129` |
| W-P07 | 隐私说明 | `/privacy/`（旧 `/privacy-policy` 301） | 单栏文章 | `W:src/pages/privacy/index.astro:1-19`；`W:public/_redirects:1-4` |
| W-P08 | 联系（画布已移除，需张老板确认去留） | `/contact/` | 单栏文章；指向 GitHub issues | `W:src/pages/contact/index.astro:1-15` |
| W-P09 | 使用说明（画布已移除，需张老板确认去留） | `/terms/` | 单栏文章 | `W:src/pages/terms/index.astro:1-16` |
| W-P10 | 404（画布已移除，需张老板确认去留） | 未命中静态资源 | 单卡片，文案写「现在的四个产品」（实际登记 6 个，见疑点） | `W:src/pages/404.astro:1-30`；`W:wrangler.toml:12` |
| W-P11 | Three.js 首页原型（画布已移除，需张老板确认去留） | `/prototype/three/`（noindex） | 独立完整 HTML 原型，53KB | `W:src/pages/prototype/three/index.astro`；`W:public/_headers:15-16` |
| W-P12 | 我的工作台·未登录/出错/会话结束 | `/desk/`（登录卡） | 单卡居中 | `W:src/pages/desk/index.astro:25-43` |
| W-P13 | 我的工作台·已登录主视图（概览 + 审核 + 摘要 + 需要处理） | `/desk/` | 审核区 ≤900px 变「列表/详情」二选一视图，详情带「返回列表」；≤960/720px 压缩卡片间距 | `W:src/pages/desk/index.astro:45-139`；`W:src/styles/desk.css:644-700` |
| W-P14 | 手机抽屉菜单 | 全站顶栏 | 仅窄屏出现；点击链接/外部/Esc 关闭 | `S:layouts/BaseLayout.astro:110-135` |
| W-P15 | 站点地图/RSS/robots/llms.txt（非页面资源） | `/sitemap-blog.xml`、`/blog/rss.xml`、`/robots.txt`、`/llms.txt` | 无 | `W:worker/index.ts:107-117`；`W:public/robots.txt`；`W:public/llms.txt` |

## 功能点

状态列缩写：空=无数据、载=加载中、错=出错、未登=未登录/会话到期、部=部分失败。

### 全站外框

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F01 | 全站 | 品牌 logo 回首页 | 点击 | 常态 | `S:layouts/BaseLayout.astro:87` |
| W-F02 | 全站 | 主导航：首页/应用/博客/关于/我的工作台，当前页 `aria-current` | 点击 | 常态 | `W:src/site.config.js:7-12`；`S:layouts/BaseLayout.astro:22-24, 105-109` |
| W-F03 | 全站 | 手机抽屉菜单开关；点链接、点外部、Esc 关闭 | 点击/键盘 | 仅窄屏 | `S:layouts/BaseLayout.astro:110-135` |
| W-F04 | 全站 | 页脚链接：关于/博客/隐私/联系；版权年份动态 | 点击 | 常态 | `S:layouts/BaseLayout.astro:45-47, 139-170` |
| W-F05 | 全站 | 「跳到正文」无障碍链接 | 键盘 Tab | 常态 | `S:layouts/BaseLayout.astro:84` |
| W-F06 | 全站 | SEO：title/description/canonical/OG/JSON-LD，`robots` 可按页覆盖（desk noindex） | 自动 | — | `S:layouts/BaseLayout.astro:60-81` |
| W-F07 | 全站 | 旧多语言路径 `/zh/ /es/ …` 301 到首页；`/privacy-policy` 301 | 自动 | — | `W:public/_redirects` |

### 首页

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F10 | 首页 | Hero 价值主张 + 滚动提示「向下，看光线如何凝聚」 | 加载 | 常态 | `W:src/components/PersonalHome.astro:16-26` |
| W-F11 | 首页 | Three.js/WebGL 光线核心动画，随滚动进度驱动；失败回退静态「线」 | 滚动 | WebGL 不可用走 fallback | `PersonalHome.astro:13-14, 259-274, 813-814` |
| W-F12 | 首页 | 四幕章节切换（汇聚/授权/释放）+ 右下计数 01/04，Hero 文案随滚动淡出 | 滚动 | reduced-motion 下简化 | `PersonalHome.astro:28-57, 174-215` |
| W-F13 | 首页 | 哲学过渡段「不拥有你，才有资格理解你」 | 滚动显现 | 常态 | `PersonalHome.astro:59-66` |
| W-F14 | 首页 | 一天时间线（07:00/14:00/23:00）+ 引语 | 滚动显现 | 常态 | `PersonalHome.astro:68-104` |
| W-F15 | 首页 | 「现在的起点」空间列表：由产品登记表生成 6 项，每项链到 `/apps/#id` | 点击 | 常态 | `PersonalHome.astro:106-130`；`S:products.ts` |
| W-F16 | 首页 | 授权环：点击圆环在「允许 AI 靠近/收回」间切换，`aria-pressed` + 状态文案 | 点击 | 开/关两态 | `PersonalHome.astro:132-145, 247-257` |
| W-F17 | 首页 | 结尾 CTA：「看看现在的空间」→ `/apps/`；「了解空间理念」→ `/about/` | 点击 | 常态 | `PersonalHome.astro:147-171` |
| W-F18 | 首页 | 滚动显现（IntersectionObserver）动效，reduced-motion 直接可见 | 滚动 | — | `PersonalHome.astro:226-245` |

### 应用 / 关于 / 隐私 / 联系 / 使用说明 / 404

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F20 | 应用（已移除候选） | 产品卡：名称链接、「进入应用」均新标签打开外部子域；徽标「本人使用」 | 点击 | 常态 | `W:src/components/ProductList.astro:13-60` |
| W-F21 | 应用 | 系统特征标签（「5 个生活维度」等）+ 成长区：「进入我的工作台」「了解空间理念」 | 点击 | 文案写 5 个维度，登记 6 个 | `W:src/pages/apps/index.astro:12-47` |
| W-F22 | 关于 | 理念宣言、三条生活脉络（健康/投资/个人）各带「查看…↗」链到 `/apps/#health|gu|me` | 点击 | 常态 | `W:src/pages/about/index.astro:37-81` |
| W-F23 | 关于 | 公开层/私域层边界说明 | 阅读 | 常态 | `W:src/pages/about/index.astro:83-118` |
| W-F24 | 关于 | 结尾 CTA：「看看正在使用的应用」→ `/apps/`；「联系与交流方式」→ `/contact/` | 点击 | 两目标均为画布已移除页 | `W:src/pages/about/index.astro:120-130` |
| W-F25 | 隐私 | 公开主站/私人应用/MCP 与公开范围/外部链接；含 `#mcp` 锚点；末段链到 `/terms/` `/contact/` | 阅读/点击 | 末段两链接指向已移除页 | `W:src/pages/privacy/index.astro:7-17` |
| W-F26 | 联系 | 指向 GitHub issues（新标签、`noopener`）；公开交流边界提示 | 点击 | 常态 | `W:src/pages/contact/index.astro:8-12` |
| W-F27 | 使用说明 | 使用范围、数据参考与链接说明 | 阅读 | 常态 | `W:src/pages/terms/index.astro:7-14` |
| W-F28 | 404 | 提示 + 回首页/关于；noindex | 点击 | 常态 | `W:src/pages/404.astro:1-14` |

### 博客（公开）

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F30 | 博客列表 | 页头 + 「通过 RSS 订阅」 | 点击 | 常态 | `W:src/pages/blog/index.astro:12-16` |
| W-F31 | 博客列表 | 分类筛选条（含各分类已发布篇数，当前项 `aria-current`；0 篇分类仍显示） | 点击 | 分类来自库表，非固定 | `W:worker/index.ts:67-69, 12-13` |
| W-F32 | 博客列表 | 文章卡：封面、分类、日期、约 N 分钟（字数/400）、标题、摘要、最多 3 个标签、「阅读全文」 | 点击 | 无封面则不显示图 | `W:worker/index.ts:51-54`；`W:server/blog.ts:12` |
| W-F33 | 博客列表 | 列表计数「共 N 篇文章」/「分类：X · 共 N 篇」 | 自动 | — | `W:worker/index.ts:70, 83-84` |
| W-F34 | 博客列表 | 分页：每页 12，上一页/下一页/「第 x / y 页」，非法页码回第 1 页，越界 404 | 点击 | 总数 ≤12 不显示 | `W:worker/index.ts:7, 43-47, 64-66` |
| W-F35 | 博客列表 | 空态「文章正在整理中」+「先了解我在做什么」 | 自动 | 无文章 | `W:src/pages/blog/index.astro:18-22`；`W:worker/index.ts:77` |
| W-F36 | 标签页 | `/blog/tag/:t/` 按标签筛选（≤40 字符，否则 404）；分类栏无高亮 | 点击标签 | 无命中同空态 | `W:worker/index.ts:118-124` |
| W-F37 | 系列页 | `/blog/series/:s/` 按系列筛选 | 点击系列 | 同上 | `W:worker/index.ts:118-124` |
| W-F38 | 博客列表（分类无文章） | 画布设计了「该分类还没有文章」专属空态，代码仅有全局空态 | — | 见覆盖表 | `W:worker/index.ts:77` |

### 文章页

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F40 | 文章 | 返回博客（顶/底） | 点击 | 常态 | `W:worker/index.ts:80`（`blog-back`） |
| W-F41 | 文章 | 元信息：分类（可点）、发布于、更新于（与发布日不同日才显示）、阅读时长 | 自动 | — | `W:worker/index.ts:76-78` |
| W-F42 | 文章 | 头图（eager+高优先级） | 加载 | 无头图不显示 | `W:worker/index.ts:48-50, 56` |
| W-F43 | 文章 | 目录（≥2 个 h2/h3 才显示，锚点跳转） | 点击 | 少于 2 个不显示 | `W:worker/index.ts:15-20` |
| W-F44 | 文章 | 正文（服务端渲染 Markdown，已净化）+ Mermaid 图客户端渲染，失败回退源码并提示；成功后可展开「查看 Mermaid 源码」 | 加载 | 渲染失败/加载中 | `W:src/scripts/blog.ts:1-75`；`W:server/blog.ts:53` |
| W-F45 | 文章 | 资料来源列表（仅 https，`noopener`） | 点击 | 无来源不显示 | `W:worker/index.ts:21-25` |
| W-F46 | 文章 | 标签链接→标签页；系列链接→系列页 | 点击 | 无则不显示 | `W:worker/index.ts:75, 81` |
| W-F47 | 文章 | 固定声明「本文由 AI 协作撰写，经本人审核后发布」 | 阅读 | 常态 | `W:worker/index.ts:81` |
| W-F48 | 文章 | 上一篇/下一篇 | 点击 | 无邻篇该侧留空（画布另有「这是最新一篇」） | `W:worker/index.ts:79, 41`；`W:server/blog.ts:289` |
| W-F49 | 文章 | SEO/OG/Twitter 卡、RSS alternate、article:published/modified、og:image；JSON-LD 被移除 | 自动 | — | `W:worker/index.ts:57-62` |
| W-F50 | 文章 | 正文缓存（Cache API，已发布文章；响应头 `no-store`） | 自动 | — | `W:worker/index.ts:126-135` |
| W-F51 | 预览 | 草稿预览：横幅「草稿预览，仅本人可见…」、显示「草稿更新于」、noindex、不缓存、无上下篇 | 从 Desk 点「预览草稿」 | 未登录 302 登录；非本人同 | `W:worker/index.ts:27-30, 76, 79, 90-96` |
| W-F52 | 文章 | 404：slug 不存在/未发布 | 自动 | 错 | `W:worker/index.ts:31, 7` |

### Desk 外壳与登录

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F60 | Desk | 页头：日期（北京时间含星期）、状态行（正在确认登录状态…）| 加载 | 载 | `W:src/pages/desk/index.astro:13-24`；`W:src/scripts/desk.ts:744` |
| W-F61 | Desk | 登录卡「本人登录 →」：走 SSO，登录后回 `/desk/` | 点击 | 未登/会话到期/出错时显示 | `desk/index.astro:31`；`W:server/desk.ts:106-110` |
| W-F62 | Desk | 「重新检查连接」重走初始化 | 点击 | 出错/未登 | `desk/index.astro:33`；`desk.ts:741` |
| W-F63 | Desk | 登录说明与信任标签（SSO 统一鉴权/私域数据隔离/随时撤回会话） | 阅读 | 登录卡 | `desk/index.astro:36-41` |
| W-F64 | Desk | 无 JavaScript 提示 | 自动 | noscript | `desk/index.astro:43` |
| W-F65 | Desk | 登录状态多文案：到期/已退出、连接不可用（首次部署可能未完成）、会话暂无法验证并隐藏数据 | 自动 | 未登/错 | `desk.ts:55-59, 61-80, 640-668, 745-753` |
| W-F66 | Desk | 退出登录：先清空页面私有数据，再 POST 退出；失败显示「重试退出登录」 | 点击 | 退出中/成功/失败 | `desk.ts:724-738`；`desk/index.astro:20, 34` |
| W-F67 | Desk | 刷新概览（刷新期间禁用刷新与生成，清空旧摘要） | 点击 | 载/错 | `desk.ts:611-638, 740` |
| W-F68 | Desk | 隐私保护：离开页/隐藏标签页/bfcache 恢复即清空私有数据并重新校验；每 60 秒校验会话，失败则隐藏数据 | 自动 | 未登 | `desk.ts:32-54, 745-757` |
| W-F69 | Desk | 页脚声明「仅本人可见 · 各应用保留自己的数据日期 · 退出会撤销…」 | 阅读 | 常态 | `desk/index.astro:139` |
| W-F70 | Desk | 请求超时 20 秒；401 一律回到登录；403/404/409/400 对博客操作给专门中文提示 | 自动 | 错 | `desk.ts:61-80` |

### Desk 三源概览与需要处理

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F80 | Desk | 三张来源卡（健康/投资理财/公众号）：徽标「已读取/请核对时效/暂无数据/暂不可用」、最多 6 个指标、备注、时间（记录/批次/查询）| 自动/刷新 | 空/部/错 | `desk.ts:566-592`；`desk/index.astro:46-68`；`W:server/desk.ts:18-43` |
| W-F81 | Desk | GU 资产金额默认折叠，点「查看资产金额」展开 | 点击 | 仅 GU 有 | `desk.ts:586-591`；`W:server/desk.ts:39-41` |
| W-F82 | Desk | 每卡「进入X ↗」链到对应子域 | 点击 | 常态 | `desk/index.astro:62-66` |
| W-F83 | Desk | 单源失败只标该卡「暂不可用」，不记 0，整体状态行标「部分来源暂不可用」；8 秒超时、32KB 上限、令牌缺失提示「摘要连接尚未配置」 | 自动 | 部/错 | `W:server/desk.ts:45-89, 215-222` |
| W-F84 | Desk | 「需要处理」列表：汇总各源 attention（链接仅限该源域名）；失败源给「摘要暂不可用，进入应用查看」 | 点击 | 空：「还没有可用于判断…」/「暂无待处理事项」 | `desk.ts:593-610`；`desk/index.astro:126-138` |

### Desk 按需摘要

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F90 | Desk | 选择范围：当前概览 / 最近 7 天（画布仅文字提示，无差异示例） | 单选 | — | `desk/index.astro:101-105` |
| W-F91 | Desk | 选择纳入应用（健康/投资理财/公众号，默认全选；一个都不选提示「请至少选择一个应用」） | 多选 | 错 | `desk/index.astro:106-110`；`desk.ts:671-678` |
| W-F92 | Desk | 「生成摘要 →」：POST 汇总；按应用分段显示数据日期、要点、备注、进入链接；状态行显示「摘要已生成/部分完成 · 范围 · 时间」 | 提交 | 载/错/部 | `desk.ts:679-715`；`W:server/desk.ts:201-215` |
| W-F93 | Desk | 改范围/来源即清空旧摘要并提示「范围已更改，请生成新的摘要」 | 变更 | — | `desk.ts:717-723` |
| W-F94 | Desk | 摘要空态「为一次回顾，留一点空间」+「摘要只保留在当前页面」 | 自动 | 空 | `desk/index.astro:116-123` |
| W-F95 | Desk | 防竞态：刷新/登出/范围变化使进行中的摘要作废 | 自动 | — | `desk.ts:9-12, 32-37` |

### Desk 博客审核

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F100 | 审核 | 并行读取 草稿队列/已发布/归档与测试/分类；状态行「N 篇待审核，M 篇已发布」；「重新读取」按钮 | 自动/点击 | 载/错（红色提示+重试） | `desk.ts:410-439, 553-560` |
| W-F101 | 审核 | 待审核队列：每项标题 + 「待审核/已拒绝 · 修订 N · 时间」，点选进详情；空态「暂无待审核的草稿。通过 MCP 提交的草稿会出现在这里。」 | 点击 | 空 | `desk.ts:172-188, 398-409` |
| W-F102 | 审核 | 详情：封面、标题、状态·修订·来源客户端、更新时间、摘要、审阅说明（若有）、分类·标签·系列 | 选中 | 空：「选择左侧稿件…」 | `desk.ts:223-253` |
| W-F103 | 审核 | 手机/窄屏：列表与详情二选一，详情顶部「← 返回列表」 | 点击 | ≤900px | `desk.ts:228-233`；`desk.css:644-649` |
| W-F104 | 审核 | 修改分类（下拉，选项来自分类表）、标签（1–5 个，中英文逗号）、系列（可选）→「保存分类与标签」 | 点击 | 标签数不合法提示 | `desk.ts:254-277, 447-462` |
| W-F105 | 审核 | 阅读全文与配图：默认展开，渲染服务端净化后的 HTML + Mermaid | 自动/展开 | — | `desk.ts:278-297` |
| W-F106 | 审核 | 「与上一版对比」：惰性请求；标题/摘要变更行 + 行级 diff（±、省略同行）；无上一版/正文一致/过大各有文案；失败显示「对比暂时不可用」 | 展开 | 载/空/错 | `desk.ts:189-222, 298-312`；`W:server/desk.ts:157-163` |
| W-F107 | 审核 | 「小改」：编辑标题、摘要、正文 Markdown →「保存小改（生成新修订）」或「小改后发布」 | 点击 | 小改后发布需清单齐 | `desk.ts:313-347, 463-479` |
| W-F108 | 审核 | 审核清单 4 项（事实有来源/配图合规/无敏感信息/标题摘要分类标签已核对）；全勾选才启用「发布」「小改后发布」；清单状态仅存内存，换稿保留、改稿清除 | 勾选 | 未齐按钮禁用 | `desk.ts:41-50, 348-376` |
| W-F109 | 审核 | 审阅说明文本框（≤1000 字，退回时随稿保存、提交者可见） | 输入 | — | `desk.ts:377-383` |
| W-F110 | 审核 | 「预览草稿」新页打开 `/blog/preview/:slug/` | 点击 | 需登录 | `desk.ts:384-388` |
| W-F111 | 审核 | 发布（先 `confirm` 弹窗；带修订号防冲突；成功后重读列表） | 点击 | 载/409「草稿已有新修订」 | `desk.ts:441-510`；`W:server/desk.ts:164-171` |
| W-F112 | 审核 | 退回/拒绝（无确认弹窗；可附说明）→ 状态「已拒绝」；已拒绝稿件不再可编辑/发布，只能预览或归档 | 点击 | — | `desk.ts:389-396, 249-252`；`W:server/desk.ts:172-179` |
| W-F113 | 审核 | 归档（确认弹窗）：移出队列，可在「测试与归档」恢复 | 点击 | — | `desk.ts:398-402, 441-452`；`W:server/desk.ts:188-196` |
| W-F114 | 审核 | 已发布列表（最近 100 篇）：封面、「已发布 · 修订」、更新时间、摘要、分类标签、「查看文章」「下架」（确认弹窗，公开页即失效）；超过 100 篇提示 | 点击 | 空：「暂无已发布的文章。」 | `desk.ts:98-170, 425-434`；`W:server/desk.ts:197`、`180-187` |
| W-F115 | 审核 | 已发布且有新修订的稿件显示「更新待审核 · 当前公开版本为修订 N，发布更新前继续保留」，按钮为「发布更新」 | 自动 | — | `desk.ts:98-110, 140-146` |
| W-F116 | 审核 | 「测试与归档」列表：测试稿件/已归档，「恢复到审核队列」「预览草稿」 | 点击 | 空：「暂无测试或已归档的稿件。」 | `desk.ts:98-170, 429-431`；`W:server/desk.ts:140-142` |
| W-F117 | 审核 | 管理分类（折叠）：列表显示「名称（slug）· N 篇已发布」+「删除」（确认；被稿件使用不可删）；表单「分类 slug / 分类名称」→「添加分类」（slug `[a-z0-9-]` ≤40，名称 ≤20，分类上限 8） | 点击/提交 | 错：校验提示 | `desk.ts:512-552`；`desk/index.astro:71-79`；`W:server/blog.ts:130-146` |
| W-F118 | 审核 | 列表中的草稿行内展开阅读全文（`renderReview` 的非详情分支，供已发布/归档行使用） | 展开 | — | `desk.ts:120-134` |
| W-F119 | 审核 | 所有写操作期间按钮禁用 + `aria-busy`，状态文案「正在发布…/归档…」 | 自动 | 载 | `desk.ts:441-509` |

### 后台与公开资源

| ID | 所属页面 | 功能/操作 | 触发方式 | 状态 | 源码 |
|---|---|---|---|---|---|
| W-F130 | 资源 | RSS（最近 50 篇，标题/链接/日期/分类/摘要，zh-CN） | 订阅 | 无文章为空频道 | `W:worker/index.ts:94-100` |
| W-F131 | 资源 | `/sitemap-blog.xml`（最多 1000 篇） | 爬虫 | — | `W:worker/index.ts:101-106` |
| W-F132 | 资源 | 博客配图公开读取 `/blog/media/:uuid` 与上传 `PUT /api/blog/uploads/:uuid` | 浏览/AI 客户端 | 404/过期 | `W:server/media.ts:145-175` |
| W-F133 | 资源 | robots：放行 AI 爬虫，屏蔽 `/desk/` `/api/`；`llms.txt` 公开入口说明 | 爬虫 | — | `W:public/robots.txt`；`W:public/llms.txt` |
| W-F134 | 资源 | `www.codepi.app` 访问 `/desk` 与 API 一律 302 到根域 | 自动 | — | `W:worker/index.ts:150-152`；`W:server/desk.ts:96-102` |
| W-F135 | 资源 | 安全头：X-Frame-Options DENY、`/desk/*` no-store + noindex + no-referrer | 自动 | — | `W:public/_headers` |

## 对外接口

### Desk HTTP API（会话 Cookie，仅 `desk-owner`，响应一律 `no-store`/noindex）`W:server/desk.ts`

| 方法与路径 | 作用 | 行 |
|---|---|---|
| GET `/api/auth/login` / `callback`；POST `/api/auth/logout` | SSO 登录、回调（会话 7 天）、退出 | 106-114 |
| GET `/api/desk/me` | 校验是否登录 | 198 |
| GET `/api/desk/overview` | 三源当前概览（限 6 指标/12 事实/12 备注/6 待办） | 212-222 |
| POST `/api/desk/summary` `{range: current|week, sources[]}` | 按需摘要，需 JSON 与同源 Origin | 201-222 |
| GET `/api/blog/drafts`、`?view=archived`、`/:slug` | 待审队列、测试与归档、单稿 | 140-148 |
| GET `/api/blog/drafts/:slug/diff` | 与上一修订对比 | 157-163 |
| POST `/api/blog/drafts/:slug/{publish,reject,archive,restore,revise,metadata}` | 审核动作，均需修订号（乐观并发，冲突 409） | 132-196 |
| POST `/api/blog/posts/:slug/unpublish`；GET `/api/blog/posts` | 下架；已发布列表（100） | 180-197 |
| GET/POST `/api/blog/categories`；POST `…/:slug/delete` | 分类读取/新增/删除 | 119-131 |

### 公开 HTTP（`W:worker/index.ts`）

`GET /blog/`（含 `?category=&page=`）、`/blog/tag/:t/`、`/blog/series/:s/`、`/blog/:slug/`、`/blog/preview/:slug/`（本人）、`/blog/rss.xml`、`/sitemap-blog.xml`、`/blog/media/:id`、`PUT /api/blog/uploads/:id`（一次性令牌）。

### 博客 MCP 工具（经 CodePi 统一 MCP，仅本人 `kdp-owner`；`M:src/modules.ts:281-330`，实现 `W:worker/blog.ts`）

| 工具 | 作用 |
|---|---|
| `blog_guide` | 写作与配图规范 + 当前分类表（`W:server/guide.ts`） |
| `blog_list`（view=published/submissions） | 列已发布或本人投稿及审核状态/意见 |
| `blog_get` | 分页读 Markdown 与元数据，带 revision |
| `blog_submit` | 提交完成稿进审核队列（cover_media_id、category 必填，tags 1–5，series/sources 可选，`is_test`，`base_revision`，`request_id` 幂等） |
| `blog_retract` | 撤回草稿 |
| `blog_upload_image` | ≤1MiB base64 内联传图（需 alt） |
| `blog_create_image_upload` | 10 分钟单次 PUT 链接传 ≤8MiB 图 |
| 内部 | `BlogMcp.summary` 给 Desk 的博客摘要；`BlogMediaBackup` 供备份读取配图（`W:worker/blog.ts:43-66`） |

### 依赖的内部契约

三源摘要：Desk 以独立令牌调用健康/GU/公众号的 `/api/internal/desk-summary?range=`，不直连业务库（`W:server/desk.ts:65-89`）。

## 现有原型覆盖

依据画板可见文字核对。判定：已画 / 漏画 / 与代码不一致。画板对照关系：Main=W-P01 桌面；Home-Phone=W-P01 手机；Web-Blog/Web-Blog-Phone/Web-Blog-States=W-P03；Web-Post/-Phone/-Preview=W-P04/05；Web-About(-Phone)=W-P06；Web-Privacy(-Phone)=W-P07；Web-Menu-Phone=W-P14；Web-Desk-Login(-Phone)/Web-Desk(-Phone)/Web-Desk-Review(-Phone/-More)/Web-Desk-States=W-P12/13；Ctx/Arch/Feat/C-WWW=架构与组件。

| 功能点 | 判定 | 说明 |
|---|---|---|
| W-F01~F05 外框 | 已画 | C-WWW「站点顶栏/手机顶栏/页脚」、Web-Menu-Phone；跳到正文链接未画（属无障碍，可不画） |
| W-F02 主导航 | 与代码不一致 | 画布导航为 首页/博客/关于/隐私说明 + 我的工作台按钮，**无「应用」**，隐私说明进了顶栏；代码顶栏 首页/应用/博客/关于/我的工作台，隐私在页脚 |
| W-F04 页脚 | 与代码不一致 | 画布页脚=顶栏同五项；代码页脚是 关于/博客/隐私/联系 |
| W-F03 抽屉菜单 | 已画 | Web-Menu-Phone 含博客篇数「3 篇」徽标与工作台说明句（代码无） |
| W-F10 Hero 文案 | 已画 | Main/Home-Phone |
| W-F11 3D 光线动画 | 与代码不一致 | 画布 Hero 为「07:10 醒来…你」生活片段汇聚示意图，并注明「图中片段为示例」，未体现 WebGL/回退；是否保留 Three.js 需张老板定 |
| W-F12 四幕章节与计数 | 与代码不一致 | 画布三步「第一步·汇聚/授权/释放」，无 01/04 计数与滚动联动；幕数 4→3 |
| W-F13 哲学段 | 已画 | |
| W-F14 一天时间线 | 已画 | 画布加了 00/06/12/18/24 刻度轴 |
| W-F15 空间列表 | 与代码不一致 | 画布 6 张卡直接显示子域名并外链、末尾「下一个空间」占位；代码链到站内 `/apps/#id`（而应用页画布已去掉，该链接失效）；画布「公众号」描述为「稿件、预览与审核，收在同一个工作台」，代码为登记表文案 |
| W-F16 授权环 | 已画（形态不同） | 画布用「收回授权」按钮 + 「正在允许 AI 靠近」状态，代码是圆环按钮 |
| W-F17 结尾 CTA | 与代码不一致 | 画布 CTA 同名「看看现在的空间」「了解空间理念」，但应用页已移除，目标未定义 |
| 画布新增：首页「写下来的」最新文章区（2 篇，看全部文章） | 画布有、代码无 | 代码首页完全没有博客入口区块与数据（且公开首页不得请求私人数据，博客数据可公开，需新增读取） |
| W-F20~F21 应用页 | 漏画（已决定去掉） | 画板里无 /apps/ |
| W-F22~F23 关于 | 已画 | Web-About 三条脉络、边界两栏齐；脉络链接「查看…↗」画布保留（目标 `/apps/#…` 待定） |
| W-F24 关于结尾 CTA | 漏画/不一致 | 画布 Web-About 无「看看正在使用的应用」「联系与交流方式」两个按钮 |
| W-F25 隐私 | 与代码不一致 | 画布无「联系页/使用说明」结尾链接；MCP 段落删去「统一 MCP 已上线，首期接入健康数据」一句；无 `#mcp` 锚点 |
| W-F26~F28 联系/使用说明/404 | 漏画（已决定去掉） | |
| W-F30~F31 列表页头/RSS/分类筛选 | 已画 | 画布分类名（数字空间/健康记录…）与代码不同：代码分类来自分类表，上限 8，当前线上是网络技术科普/AI 深度观察/生活感悟等；画布示例分类为设计占位，注意别当固定 |
| W-F32 文章卡 | 已画 | 缺：封面图、最多 3 个标签小标（画布无封面/标签位） |
| W-F33 计数 | 已画 | |
| W-F34 分页 | 已画 | Web-Blog-States |
| W-F35 全站空态「文章正在整理中」 | 漏画 | 画布只画了「分类没有文章」 |
| W-F36~F37 标签/系列页 | 已画 | Web-Blog-States 底部一句 |
| W-F38 分类无文章专属空态 | 画布有、代码无 | 代码走全站空态（且当前分类有文章时才渲染筛选条，空分类下用户无法返回筛选），需补实现 |
| W-F40~F48 文章页各块 | 已画 | Web-Post；「这是最新一篇」画布有、代码是空 span；头图 2.35:1 提示有 |
| W-F44 Mermaid 渲染与回退、源码折叠 | 漏画 | 文章页与审核详情都有，画布未体现 |
| W-F49~F50 SEO/缓存 | 不适用 | 非视觉 |
| W-F51 草稿预览 | 已画 | Web-Post-Preview；画布横幅多「回到审核台」按钮，代码无（仅 `blog-back`「返回博客」） |
| W-F60 页头日期/状态行 | 已画 | |
| W-F61~F64 登录卡 | 已画 | Web-Desk-Login(-Phone) 多了「登录后，这里会出现」三张占位预告；无 JS 提示漏画 |
| W-F65 登录状态多文案 | 已画 | Web-Desk-States |
| W-F66 退出（含失败重试） | 已画 | Web-Desk-States 有 退出中/已退出/退出失败 |
| W-F67 刷新概览 | 已画 | |
| W-F68 离开即清空 / 60s 校验 | 不适用 | 行为，非视觉；「会话暂时无法验证，数据已隐藏」已画 |
| W-F80~F83 三源卡与部分失败 | 已画 | Web-Desk 三态、Web-Desk-States「部分完成」 |
| W-F81 资产金额折叠 | 已画 | |
| W-F84 需要处理 | 与代码不一致 | 画布（Web-Desk）3 项来自 GU/健康；C-WWW 却画了「2 篇稿件等待审核 · 博客 · 去处理」，代码里博客不在 attention 里；且画布每条带一句说明与「来源·X」「进入X」，代码只有 来源小字+标题 |
| W-F90~F94 按需摘要 | 与代码不一致 | Web-Desk 同代码（当前/7 天、三应用）；C-WWW 画成 今天/近 7 天/近 30 天，与代码 `current/week` 两档不符；摘要段落画布含「来自当前概览」标注，代码按事实列表 |
| W-F100 状态行/重新读取 | 已画 | |
| W-F101~F103 队列/详情/手机二选一 | 已画 | Web-Desk-Review、-Phone「① 列表 ② 详情」 |
| 画布结构 | 与代码不一致 | 画布把「博客审核」拆成独立页（Web-Desk 仅一张汇总卡 + 「进入博客审核 →」，另有「← 返回工作台」），代码是 `/desk/` 同页内嵌，无子路由；需决定是否新增路由/视图 |
| W-F104 分类/标签/系列编辑 | 已画 | 画布未画「保存分类与标签」按钮细节，C-WWW 的「修订对比」把分类/标签变化也列为对比行，代码 diff 只比标题/摘要/正文 |
| W-F105 全文与配图 | 已画 | |
| W-F106 与上一版对比 | 已画 | Web-Desk-Review-More 画了标题/摘要/正文一致；缺：行级 ± 配色之外的「正文过大无法对比」「没有可对比的上一版」「读取失败」 |
| W-F107 小改 | 已画 | Web-Desk-Review-More「小改」 |
| W-F108 审核清单 | 与代码不一致 | 画布 4 项文案/顺序与代码不同（画布首项「标题、摘要、分类与标签已核对」，代码末项）；画布有「已确认 3/4 项」进度与逐条未确认提示，代码无进度文案，仅禁用按钮 |
| W-F109 审阅说明 | 已画 | |
| W-F111 发布 | 与代码不一致 | 画布按钮「发布修订 3」，代码为「发布」/「发布更新」；画布另说明 confirm 对话框「焦点默认落在取消、危险按钮红色」，代码用浏览器原生 `window.confirm`，无自定义对话框 |
| W-F112 退回 vs 拒绝 | 与代码不一致 | 画布同一详情画了「退回」+「拒绝」两个按钮，且 C-WWW 称拒绝需二次确认；代码详情只有「退回」，二者都调同一 reject 接口，且**无确认弹窗** |
| W-F113 归档 | 已画 | |
| W-F114~F115 已发布与更新待审核 | 已画 | |
| W-F116 测试与归档 | 已画 | Web-Desk-Review-More「5 测试与归档」 |
| W-F117 分类管理 | 已画 | 画布还画了分类删除确认对话框与 slug 规则提示 |
| W-F118 行内全文展开 | 不适用 | 次要 |
| 加载/空/错状态 | 部分漏画 | Desk-States 有「博客审核为空」「需要处理为空」；漏画审核区「正在读取博客审核列表…」「读取失败·重新读取」红色提示、409 冲突提示、各写操作进行中文案 |
| W-F130~F135 RSS/sitemap/robots/重定向 | 不适用 | 非视觉；RSS 入口已画 |
| 手机（Web-*-Phone） | 已画 | 首页、博客、文章、关于、隐私、菜单、Desk 三屏；Desk 手机未体现审核「返回列表」之外的差异 |
| Ctx/Arch/Feat-WWW | 已画 | Feat-WWW 功能树漏：标签/系列已有；漏「管理分类」外的「小改」「对比」「下架」「恢复」「归档」「预览」细项；「访客」入口漏「应用」页 |

覆盖统计见文末汇总。

## 日常使用流与体验疑点

事实部分（有源码依据）：
1. 访客：首页滚动阅读 → 点空间列表（现链到 `/apps/#id`）或 CTA → 博客列表按分类/标签筛选 → 文章（目录、上下篇、RSS）。
2. 张老板：AI 客户端经 MCP `blog_submit` 提交 → 打开 `/desk/`（SSO，7 天会话）→ 在博客审核队列选稿 → 读全文、看 diff、勾 4 项清单 → 发布；有问题则退回（带说明，提交者下次读到）；小问题直接小改后发布；已发布稿的新修订走「发布更新」，旧版保留到点发布。
3. 每日：Desk 先看三源卡与「需要处理」，必要时点「生成摘要」，去子应用处理。

疑点（推断已标明）：
- 【事实】导航与链接依赖已移除页：画布去掉「应用」，但首页空间列表、首页两个 CTA、关于页三个脉络链接、关于结尾按钮、Desk 无关，均指向 `/apps/`；隐私页指向 `/contact/` `/terms/`；404 文案指向「四个产品」。改版若删页必须同步迁移这些入口，否则变死链或被 `not_found_handling = 404-page` 兜底。
- 【事实】「博客审核」画布是独立页，代码是同页。手机端审核区在同页下半屏，需滚过三源卡、摘要，才到审核（推断：这正是画布拆页的原因，需新增 `/desk/review/` 类视图或锚点）。
- 【事实】拒绝无确认弹窗而发布/下架/归档/删分类有；退回和拒绝在画布是两个动作，在代码是一个。需要产品定义是否真有「拒绝（终止）」与「退回（修改后再提）」的区别；现状 `reject` 后稿件仍可被提交者按 revision 重新提交，没有终止态。
- 【事实】清单状态只在内存，刷新页面即清空；离开标签页 `visibilitychange` 会清空全部私有数据并重新加载，审阅说明文本框未提交内容会丢（画布 Desk-States 也承认「未保存的审阅说明不会保留」）。（推断：每次切标签页回来都会重新请求 4 个审核接口 + 概览，网络慢时体验抖动。）
- 【事实】已拒绝稿件在详情中不可编辑、不可发布，也不显示审核清单，只有预览与归档；画布 Review 列表里「已拒绝」只画了列表行，没画详情。
- 【事实】分类上限 8，AI 只能选已有分类；空分类用户在公开博客侧仍可点进去，目前显示全站空态而非画布的「该分类还没有文章」。
- 【事实】首页「应用/5 个生活维度」文案与登记表 6 个产品不一致；404 写「四个产品」。均属文案过期。
- 【推断】首页手机端 460dvh 的超长滚动 + WebGL，低端机性能风险；代码已有 fallback，画布静态示意稿若替换为纯 CSS 版则可去掉 three 依赖（需张老板决定，影响首屏体积）。
- 【事实】`/prototype/three/` 为 noindex 的 53KB 旧原型，无任何站内入口。

## 汇总数字

- 页面/视图 15 个；功能点 95 条（W-F01~W-F135，编号不连续，以表内实际条目为准）。
- 画布覆盖判定（覆盖表 21 行为问题项）：漏画约 7（应用/联系/使用说明/404、Mermaid、全站空态、审核区加载/出错/已拒绝详情态）；与代码不一致约 13；画布有而代码无 2（首页最新文章区、分类空态）。
