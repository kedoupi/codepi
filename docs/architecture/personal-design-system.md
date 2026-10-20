# kedoupi（codepi）共享设计规范

**品牌依据：CodePi Design System v1.5**，原样保存在 `packages/shared/brand/codepi-v1.5/`。
它与本文冲突时以 v1.5 为准。编写或修改 UI 前，先读其中的 `AI_DESIGN_RULES.md`、
`DESIGN_SYSTEM.md`、`DESIGN_TOKENS.md` 和 `COMPONENTS.md`。v1.5 的 Logo 矢量母版和平台图标
仍是待人工批准的候选稿，替换各站 Logo/图标需单独授权，不随 token 改动附带。

适用范围：首页、GU、GZH、Health，以及 Auth/MCP 的登录与授权页面。
当前源码均复用共享样式；具体页面改动仍需桌面/手机验收，不能仅凭导入 token 判断完成。

## 设计原则

- 以个人介绍、实际内容和工作任务组织布局。
- 主站提供舒展的阅读节奏；工作应用保留合适的信息密度。
- 同一品牌共享 v1.5 的配色、字体、间距、圆角、组件风格、图标规范和交互语义。各 app 只在主题文件中补充本应用的语义色（如 GU 状态色、Health 数据系列色），不另立品牌色；不要求所有页面使用同一种布局。
- 成功、警告、错误使用 v1.5 的 `--color-success` / `--color-warning` / `--color-danger`，不滥用品牌橙。
- 没有真实内容时省略模块或说明当前状态，不编造文章、指标或个人经历。

## 共享规范与应用主题

`packages/shared/styles/tokens.css` 复制 v1.5 的 `--color-*` / `--brand-*` 语义 token，并把既有 `--kdp-*` 名称保留为别名；它定义共享字体、间距、圆角、动效和色板，
`packages/shared/styles/site.css` 定义静态页面通用外观。唯一 Astro 主站 `apps/web/`
通过 `packages/shared/layouts/BaseLayout.astro` 使用这些样式。

私人应用接入时导入 token 文件，沿用共享的字体、间距、圆角和交互规则，并用本 app 的语义主题定义颜色。应用主题只在本 app 加载，可以局部覆盖共享颜色变量以兼容现有组件，不为某个应用改动共享默认色板。图表的盈亏、警告和数据系列色保持清楚且独立的语义。

| 项目 | 规则 |
| --- | --- |
| 背景 | `--kdp-canvas` = v1.5 暖白 `--color-background`（`#FAF8F4`）；页面默认不用渐变；Health 暂保留暖纸主题，待单独评估 |
| 内容面 | `--kdp-surface` = `--color-surface`，白色卡片 + 暖灰边框 `--color-border` |
| 正文与标题 | `--kdp-text` / `--kdp-ink`，均为 `--color-text`（`#2D2A28`） |
| 次要信息 | `--kdp-muted` = `--color-text-muted`；不能用于不可辨认的低对比度文本 |
| 主要动作与链接 | `--kdp-accent` = `--color-action`（交互橙 `#C94F20`），悬停 `--color-action-hover`；品牌橙 `#FF713D` 只做点缀，不放白色小字。`#C94F20` 作小字在暖白底只有 4.3:1，暖白或 `--kdp-accent-soft` 底上的橙色文字用 `--kdp-accent-strong`（`#A83E18`）；导航当前项用正文色 + 橙色下划线 |
| 控件边界 | `--kdp-line-strong` = `--color-border-strong`（`#8C857E`，v1.5 之外的有意补充，白底 3.6:1）；`--color-border` 只作装饰线 |
| 焦点 | `:focus-visible` 为 2px `--color-focus` 实线 + 2px 偏移 |
| 字体 | Inter + Noto Sans SC（回退 PingFang SC / Hiragino Sans GB / Microsoft YaHei）；代码 JetBrains Mono；当前不加载远程字体，未安装时使用回退字体 |
| 字阶 | `--text-h1` 48 / `--text-h2` 32 / `--text-h3` 24 / `--text-body` 16 / `--text-small` 14 / `--text-caption` 12；正文行高 `--leading-body` 1.6，最小字号 12px |
| 间距 | `--space-1/2/3/4/6/8/12/16` = 4、8、12、16、24、32、48、64px（`--kdp-space-1…8` 为别名） |
| 圆角 | 控件 10px；卡片 14px；弹窗/主要内容面 18px |
| 阴影 | 仅用于内容面层级，低强度，不使用通篇重阴影 |
| 标志 | v1.5 符号（C + π + `</>`）来自 `@kedoupi/shared/brand` 的 `CODEPI_SYMBOL_SVG`，与文字「Code」石墨灰 + 「Pi」品牌橙组成页头字标；各站 favicon / 苹果触摸图标 / Health 图标取自 `brand/codepi-v1.5/assets/exports`。母版仍是候选稿，定稿后在这两处替换 |
| 图标 | Lucide 风格，16/20/24px，1.75px 线宽，统一圆形端点；颜色继承 `currentColor` |
| 页面宽度 | 内容最大 1120px；连续阅读最大 720px |
| 点击区域 | 主要控件至少 44px 高 |
| 动效 | 150ms（快）/ 220ms（常规），服务交互反馈；尊重 reduced-motion |

Health 主题位于 `apps/health/apps/web/src/theme.css`，由应用的 `styles.css` 在共享 tokens 之后加载。暖纸背景 `#fbf8f3`、内容面 `#fffdf9`、陶橙强调色 `#a3421c`、悬停色 `#813719` 和浅暖色 `#f4e9df` 保留其应用身份；字体、间距、圆角和当前组件布局继续沿用共享规范。普通正文、次要文字、链接及按钮标签在其背景上的对比度至少为 4.5:1，焦点指示至少为 3:1。

Health 图表保留睡眠灰蓝、准备度绿、活动/HRV 暖橙，以及深睡、REM、浅睡、清醒的独立系列色。数据系列中的灰蓝不承担品牌强调色语义；图例和数据表继续提供文字说明。

## 主站布局

- 桌面：左右个人介绍与应用关系图；横向应用列表；下部内容积累与 AI 连接。
- 手机：单列阅读，应用关系图保留可点击入口；应用列表缩小图标，保持文字完整。
- 首页、应用、博客、关于、联系和隐私等公开页面共用导航、页脚及内容排版；工具存档已退役。
- 未发布栏目不加入导航；建设状态不做成可点击的假按钮。
- 公开页不请求私人应用数据；外链在新标签页打开时使用明确的辅助说明。

## 应用边界

- 产品名称、公开用途、访问方式和当前入口集中在 `packages/shared/products.ts`；域名映射见根 README。
- Health 应用使用本地暖色主题；MCP 授权页和统一登录页直接嵌入共享 tokens.css，其配色独立管理。旧 Oura/工具站域名不保留兼容。
- GU 与 GZH 已使用自己的 Svelte 应用样式，分别从 `apps/gu/web/src/style.css` 和
  `apps/gzh/web/src/styles.css` 引入共享 tokens，保留各自信息密度与业务主题。
- Health 的登录入口、导航、概览和详情页沿用共享组件风格，保留自身配色和当前布局。私人应用的 UI 变更仍须检查桌面、手机、登录、空状态、错误状态及图表。
- 不能以“已经有 token 文件”宣称所有私人应用已完成视觉统一。

## 去广告

共享广告 loader、广告组件与占位、`ads.txt` 已移除，旧工具站和工具 URL 已退役，
不恢复入口、广告或兼容页。历史实施顺序保存在任务记录中。

不再以 AdSense 复审作为页面结构或内容调整的约束。历史复审文件作为历史资料保留。
