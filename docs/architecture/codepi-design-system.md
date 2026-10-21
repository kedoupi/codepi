# CodePi Design System 规范

> 状态：现行规范（2026-10-20 整理）。适用于 kedoupi（codepi）全部产品与支撑页面。
> 本文把用户提供的 CodePi Design System v1.5 与 v2.0.0 原件、仓库已落地的共享实现和各应用
> 主题边界整理成一份可执行规范，供各项目 agent 优化和实现时直接引用。
> v2.0.0 的颜色、字体、图标规则和全部标志资产与 v1.5 逐字节一致；它新增的是交互状态、
> 加载、AI 组件合同、治理规则和一套 `--cp-*` token 命名（见第 3.5、9.1–9.3、16 节）。
> 本文是规范，不是实现证据；某页面是否达标，以该页面的代码、测试和桌面/手机验收为准。

文中 **必须** 表示验收条件，**应** 表示默认做法（偏离须在任务中写明理由），
**可** 表示允许的选项。

## 0. 权威顺序与文件地图

冲突时按以下顺序判定：

1. 用户的明确决定（品牌、标志、配色变更都需要用户批准）。
2. 本规范。
3. 品牌原件，均为用户提供的原样副本，只读：
   - `packages/shared/brand/codepi-v2.0/`：v2.0.0 的文档、token 源和加载参考实现；
   - `packages/shared/brand/codepi-v1.5/`：v1.5，含全部标志与平台图标资产（v2.0.0 资产与之逐字节相同，未重复存放）。

   两者冲突时以 v2.0.0 为准，但第 3.5 节列出的 v2.0.0 缺陷不采用。
   v2.0.0 包里的 React 组件、Storybook、静态模板、CI 工作流和测试没有放进仓库：
   本仓库是 Astro + Svelte，新增依赖需要用户批准，且这些代码有第 3.5 节的缺陷。原件内部混有 v1.2–v1.6 的历史说明，
   例如 “`assets/` 仍是旧版 Demo”，这类描述以本文的现状为准。
4. 共享实现：`packages/shared/styles/tokens.css`、`packages/shared/styles/site.css`、`packages/shared/brand.ts`。
5. 各应用主题文件（只能在第 12 节允许的范围内扩展）。

| 用途 | 文件 |
| --- | --- |
| 品牌原件 v2.0.0（文档、token 源、交互与加载规范） | `packages/shared/brand/codepi-v2.0/` |
| 品牌原件 v1.5（值、资产、平台规范、QA） | `packages/shared/brand/codepi-v1.5/` |
| 共享 token（唯一 CSS 来源） | `packages/shared/styles/tokens.css` |
| 主站/静态页通用样式与参考组件 | `packages/shared/styles/site.css`、`packages/shared/layouts/BaseLayout.astro` |
| 标志 SVG 与品牌文字 | `packages/shared/brand.ts`（`CODEPI_SYMBOL_SVG`、`BRAND_WORDMARK`、`PRODUCT_BRAND`） |
| 平台/网站图标导出 | `packages/shared/brand/codepi-v1.5/assets/exports/`、`assets/platform/` |
| 主站布局、公开页与应用边界 | [个人站设计规范](personal-design-system.md) |
| 产品注册表 | `packages/shared/products.ts` |

## 1. 品牌定位

- CodePi 是独立开发者与技术创作者的个人品牌，气质：克制、可靠、鲜明、有温度。
- 默认明亮暖白界面，深灰正文，少量橙色强调。
- **禁止**：蓝紫 AI 渐变、霓虹/荧光配色、厚重玻璃拟态、发光“AI 大脑”类插画、
  emoji 代替图标或标志、通篇重阴影。
- 色彩比例（视觉建议，不做硬性测量）：暖白/白 75–85%，灰与文字 10–20%，橙 5–10%。
- 品牌名：可见品牌统一用 `PRODUCT_BRAND`（kedoupi（codepi））或字标 `CodePi`；
  不另造写法。服务名、Cookie、数据库名中的 `kdp` 是技术标识，不属于可见品牌。

## 2. 标志

### 2.1 结构与变体

符号 = 大写 C（石墨灰）+ π（品牌橙）+ 内部 `</>`（石墨灰）。标准组合 = 符号 + `CodePi` 字标，
其中 “Code” 用石墨灰，“Pi” 用品牌橙。标语 `BUILD · THINK · CREATE` 可选，
不得放进应用图标或小尺寸标志。

| 变体 | 来源 | 用途 |
| --- | --- | --- |
| 符号（彩色） | `brand.ts` 的 `CODEPI_SYMBOL_SVG`（与 `assets/masters/symbol-color.svg` 逐路径一致） | 网页页头、登录页、页脚 |
| 符号（反白/单色） | `assets/masters/symbol-inverse.svg`、`symbol-monochrome.svg` | 深色背景、单色印刷/主题化图标 |
| 横向字标（官方原件） | `assets/exports/wordmark-light.svg`/`-dark.svg`、PNG 导出 | 邮件、OG、外部平台等需要图片字标的场景 |
| 主站图片字标 | `apps/web/public/brand/codepi-logo.png`、`codepi-logo-dark.png` 及 450/900px 响应式副本 | 主站与 Three.js 原型页头、页脚；源自官方 wordmark 导出的透明 RGBA，禁止使用含字体回退的旧 `codepi-logo.svg` |
| HTML 字标 | `.kdp-brand` + `.kdp-mark` + `.kdp-wordmark` / `.kdp-wordmark-pi`（`site.css`） | 私人应用或无法访问主站静态图片的页面 |
| 应用图标 | `assets/exports/app-icon-*.svg/png` | 应用、PWA、平台资料 |
| 头像 | `assets/exports/avatar-*`、`assets/platform/{wechat,social}/` | 微信、GitHub、社交平台 |

### 2.2 使用规则

- **必须**使用上述官方文件或 `CODEPI_SYMBOL_SVG`；不得描摹截图重绘、拉伸、旋转、改色、
  加描边/阴影/渐变，也不得用文字或 emoji 拼凑标志。主站完整字标使用透明 PNG；不得继续引用旧 `codepi-logo.svg`，因为其中的字体回退会造成字形和间距失真。
- 净空：四周至少 0.5 × 符号高度（暂定，待定稿母版复核）。
- 禁止 `{@html}` 的应用（Project、Me 的 CSP 与 AGENTS 规则）不能直接注入 `CODEPI_SYMBOL_SVG`，
  应使用 `<img src="/favicon.svg" alt="">` 或把同一几何写成 Svelte 组件里的 SVG 元素，路径必须与母版一致。
- 符号为装饰时必须 `aria-hidden="true"`，并与可读文字标签（品牌名或产品名）配对；
  单独使用符号作为链接时必须提供可访问名称。
- 16–32px 场景只用符号版 favicon（`favicon.svg`/`favicon-16/32.png`/`favicon.ico`），
  不缩小完整组合标志。
- 主站完整字标按官方母版比例 `1800 / 500`（3.6:1）使用 `object-fit: contain`；桌面页头约 124px 宽、页脚约 114px 宽，手机页头约 104px 宽、页脚约 100px 宽。
- 私人应用继续使用符号尺寸：桌面页头 36px，页脚 30px；不能把完整横向字标压缩到 16–32px。

### 2.3 网站图标契约

每个对外站点（首页、GU、GZH、Health、Project、Me，以及有独立页面的 Auth/MCP）**应**在 Web 根目录提供：

| 文件 | 来源 | `<head>` |
| --- | --- | --- |
| `/favicon.ico`（含 16/32/48） | `assets/exports/favicon.ico` | `<link rel="icon" href="/favicon.ico" sizes="32x32">` |
| `/favicon.svg` | `assets/exports/favicon.svg` | `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` |
| `/apple-touch-icon.png`（180×180） | `assets/exports/apple-touch-icon.png` | `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` |
| `theme-color` | 当前页面背景色（暖白 `#FAF8F4`，或应用主题背景） | `<meta name="theme-color" content="…">` |

文件必须与 `assets/exports/` 中的原件逐字节一致，不重新导出或压缩。
需要 PWA 安装时，参照 `assets/platform/web/manifest.example.json` 与 `pwa-*`/`pwa-maskable-*`。
注意示例里 `theme_color` 用的是品牌橙，接入前要按本站背景复核。

### 2.4 定稿状态

资源状态按 v2.0.0 治理规则分四级：concept（概念）→ candidate（候选）→ approved（已批准）→ production（已上线）。
v1.5 / v2.0.0 矢量母版仍是**候选稿**（candidate）。2026-10-20 经用户同意，主站已采用从官方导出解混生成的透明 PNG 字标；该图片资产用于解决网页字体回退导致的失真，不改变品牌图形母版的定稿状态。
不得宣称定稿或已通过任何平台审核：字形精修、商标近似与字体授权都未完成审查。
母版定稿后需同步 `brand.ts` 的 `CODEPI_SYMBOL_SVG`、`CODEPI_LOGO_*` 常量，以及主站 `public/brand/` 下的图片字标。
平台发布（Apple Icon Composer `.icon`、Android 启动器遮罩、微信后台上传、应用商店）
在 `PLATFORM_COMPLIANCE.md` 中标为未验收，使用前必须按平台当期规范重新核实。

## 3. Token 体系

### 3.1 分层

| 层 | 前缀 | 定义位置 | 谁能用 |
| --- | --- | --- | --- |
| 品牌 | `--brand-*` | `tokens.css` | 只用于标志、字标和少量品牌点缀 |
| 语义 | `--color-*`、`--space-*`、`--radius-*`、`--text-*`、`--leading-*`、`--motion-*`、`--font-*` | `tokens.css` | **新代码默认使用** |
| 兼容别名 | `--kdp-*` | `tokens.css`，指向语义层 | 既有组件；新代码可用，但不得新增 `--kdp-*` 名称 |
| 应用局部 | 应用自定前缀（如 `--health-*`、GU 的 `--positive`） | 应用主题文件 | 只在本应用，表达本应用业务语义 |

规则：

- 组件源码**不得**写新的十六进制色值或 `rgb()` 字面量；颜色一律来自 token。
  图表系列色、应用局部语义色先在应用主题文件里定义成变量，再在组件中引用。
- 新增或修改共享 token 必须得到用户批准，在 PR 中写明受影响的应用，并保持 `tokens.css` 的单一写入者。
  `tokens.css` 是所有产品及 Auth/MCP 页面的公共契约。
- 应用**可以**在自己的主题文件中覆盖 `--kdp-*` 颜色别名来保留应用身份（见第 12 节），
  **不得**为某个应用去改共享默认值。

### 3.2 颜色（浅色，默认）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--brand-graphite` | `#5E5A56` | 标志 C、`</>`、字标 “Code” |
| `--brand-orange` | `#FF713D` | 标志 π、字标 “Pi”、装饰点缀（下划线、细条、图形） |
| `--brand-orange-interactive` | `#C94F20` | 与 `--color-action` 相同 |
| `--brand-orange-hover` | `#A83E18` | 与 `--color-action-hover` 相同 |
| `--brand-soft` | `#FFE6D9` | 暖橙浅底（选中、次按钮悬停、提示块） |
| `--color-background` | `#FAF8F4` | 页面背景（暖白） |
| `--color-surface` | `#FFFFFF` | 卡片、面板、输入框 |
| `--color-text` | `#2D2A28` | 正文与标题 |
| `--color-text-muted` | `#706A64` | 次要信息 |
| `--color-border` | `#E7E3DC` | 装饰分隔线、卡片边框（不承担控件边界） |
| `--color-border-strong` | `#8C857E` | 输入框、次按钮等控件边界（仓库补充项，不在 v1.5 原件内） |
| `--color-focus` | `#C94F20` | 焦点环 |
| `--color-action` | `#C94F20` | 主要按钮背景 |
| `--color-action-hover` | `#A83E18` | 主按钮悬停；暖白/浅底上的橙色文字与链接 |
| `--color-action-text` | `#FFFFFF` | 主按钮文字 |
| `--color-disabled-bg` / `--color-disabled-text` | `#F3EAE4` / `#756F6A` | 禁用控件 |
| `--color-success` / `--color-warning` / `--color-danger` | `#23744C` / `#965400` / `#B42318` | 状态语义；不能用品牌橙代替 |

### 3.3 颜色（深色，可选）

`[data-theme="dark"]` 已在 `tokens.css` 定义（背景 `#242321`、表面 `#302E2B`、正文 `#F6F3ED`、
次要 `#C6BFB5`、边框 `#514D47`、动作/焦点 `#FF936C`、动作文字 `#242321`、成功 `#7AD9A5`、
警告 `#FFD080`、危险 `#FF968F`），但**目前没有页面启用**。深色模式是补充，不是品牌主展示。
启用前必须先补齐第 14 节列出的深色缺口。

### 3.4 已验证的对比度配对

下列数值由 WCAG 2.x 公式计算（2026-10-20），只覆盖纯色配对；实际渲染（透明度、叠加、
图片背景）仍须实测。

| 前景 / 背景 | 比值 | 结论 |
| --- | --- | --- |
| `--color-text` / 背景、表面 | 13.44 / 14.25 | 正文可用 |
| `--color-text-muted` / 背景、表面 | 5.03 / 5.34 | 次要正文可用 |
| 白字 / `--color-action` `#C94F20` | 4.54 | 主按钮可用（刚过 4.5，不能再变浅） |
| 白字 / `--color-action-hover` `#A83E18` | 6.24 | 可用 |
| `#C94F20` 文字 / 暖白背景 | **4.28** | **小字不达标**：暖白或浅底上的橙色文字、链接用 `--color-action-hover` |
| `#C94F20` 文字 / 白色表面 | 4.54 | 白卡片上可用，但统一用 `--color-action-hover` 更稳 |
| `--color-action-hover` / 暖白、`--brand-soft` | 5.88 / 5.22 | 橙色文字的标准选择 |
| 白字 / 品牌橙 `#FF713D` | **2.73** | **禁止**白字放在品牌橙上 |
| 正文色 / 品牌橙 | 5.21 | 品牌橙块上只能放深色字 |
| 品牌橙 / 暖白 | **2.58** | 品牌橙不能用作文字或有意义的图标颜色，只能做装饰 |
| `--color-border-strong` / 表面、背景 | 3.64 / 3.43 | 控件边界达标（≥3:1） |
| `--color-border` / 表面 | 1.28 | 只能做装饰线，不能是控件的唯一边界 |
| 焦点 `#C94F20` / 表面、背景 | 4.54 / 4.28 | 焦点指示达标（≥3:1） |
| 成功 / 警告 / 危险 文字 / 表面 | 5.72 / 5.89 / 6.57 | 可用作状态文字 |
| 禁用文字 / 禁用底 | 4.18 | 禁用控件可免于对比度要求，但不能只靠颜色表达禁用 |
| 深色：正文/背景、动作文字/动作、焦点/背景 | 14.18 / 7.21 / 7.21 | 可用 |
| 深色：`--color-border` / 表面 | 1.61 | 深色缺少强边界 token，见第 14 节 |

### 3.5 v2.0.0 token 命名与已知缺陷

v2.0.0 把唯一 token 源放在 `brand/codepi-v2.0/packages/tokens/src/tokens.json`，生成的 CSS 改用 `--cp-*` 前缀。
色值与本文第 3.2–3.3 节完全相同，`textMuted` 统一为 `#706A64`（v1.5 的 `colors.json` 曾写 `#77746F`）。
在用户决定迁移前（第 17 节），**新代码继续使用本文的语义层名称，不引入 `--cp-*`**。

| 含义 | 本仓库 | v2.0.0 | 旧别名 |
| --- | --- | --- | --- |
| 页面背景 / 表面 / 正文 / 次要 | `--color-background` / `-surface` / `-text` / `-text-muted` | `--cp-background` / `-surface` / `-text` / `-text-muted` | `--kdp-canvas` / `-surface` / `-text` / `-muted` |
| 装饰线 / 控件边界 | `--color-border` / `--color-border-strong` | `--cp-border` / 无 | `--kdp-line` / `-line-strong` |
| 动作 / 悬停 / 浅底 | `--color-action` / `-action-hover` / `--brand-soft` | `--cp-action` / `-action-hover` / `--cp-brand-soft` | `--kdp-accent` / `-accent-strong` / `-accent-soft` |
| 4 / 8 / 12 / 16px | `--space-1` / `2` / `3` / `4` | `--cp-space-1` / `2` / `3` / `4` | `--kdp-space-1…4` |
| 24 / 32 / 48 / 64px | `--space-6` / `8` / `12` / `16` | `--cp-space-5` / `6` / `7` / `8` | `--kdp-space-5…8` |
| 控件 / 卡片 / 弹窗圆角 | `--radius-control` 10 / `-card` 14 / `-dialog` 18 | `--cp-radius-md` 10 / `-lg` 14 / `-xl` 20，另有 `-sm` 6 | `--kdp-radius-sm` / `-radius` / `-radius-lg` |
| 动效、字体、字阶 | `--motion-*`、`--font-*`、`--text-*` | 无（字阶只在 `typography.json`） | `--kdp-motion`、`--kdp-font` |

注意两套名称里同号的间距不是同一个值：本仓库 `--space-6` 是 24px，v2.0.0 的 `--cp-space-6` 是 32px。

v2.0.0 原件的以下内容**不采用**，实现时不得照搬：

1. 生成的圆角没有单位（`--cp-radius-md: 10;`），用在 `border-radius` 时是无效值，会渲染成直角；其 React `styles.css` 正是这样用的。
2. 圆角数值前后矛盾：token 源写弹窗 20px 并新增 6px，`DESIGN_SYSTEM.md` 与 `tokens/spacing.json` 仍写 10 / 14 / 18（待决，见第 17 节）。
3. 生成的 `tokens.css` 删掉了动效 token 和 reduced-motion 全局规则，没有字体与字阶变量，深色主题没有 `soft` 色。
4. 没有控件边界色：secondary 按钮和输入框用装饰线 `border`（白底 1.28:1），不满足 3:1。
5. 禁用按钮用 `opacity: .65`，而不是 `disabled-bg` / `disabled-text`。
6. 危险按钮文字用 `background` 色，深色主题下对比度会反转变差。
7. 自带验证只有 8 个结构测试；TypeScript、Storybook、视觉回归、无障碍检查均未执行（见其 `VALIDATION_REPORT_V2.md`）。

## 4. 字体与字阶

- 字体栈：`--font-sans` = Inter、Noto Sans SC，回退 PingFang SC / Hiragino Sans GB / Microsoft YaHei / system-ui；
  代码用 `--font-mono` = JetBrains Mono。目前**不加载远程字体**，要加载必须先确认许可证和性能，并取得用户批准。
- 字重：标题 600–700，正文 400–500。避免使用衬线体或展示字体另立风格。

| 角色 | Token | 桌面 | 手机 | 字重 | 行高 |
| --- | --- | ---: | ---: | ---: | ---: |
| H1 | `--text-h1` | 48px | 36px | 700 | 1.15 |
| H2 | `--text-h2` | 32px | 28px | 650 | 1.2 |
| H3 | `--text-h3` | 24px | 22px | 600 | 1.3 |
| 正文 | `--text-body` | 16px | 16px | 400 | 1.6（`--leading-body`） |
| 小字 | `--text-small` | 14px | 14px | 400 | 1.5 |
| 说明 | `--text-caption` | 12px | 12px | 400 | 1.4 |

- 最小字号 12px；正文不小于 14px，阅读型正文用 16px。
- 手机字阶由各页面用 `clamp()` 或媒体查询实现（参考 `.personal-article h1`）；共享 token 只提供桌面值。
- 必须支持浏览器 200% 文字缩放不丢失功能；不把文字烘焙进位图。

## 5. 间距、布局与响应式

- 4px 基准，只用 `--space-1/2/3/4/6/8/12/16` = 4/8/12/16/24/32/48/64px。
- 容器：内容最大 `--kdp-content-width` 1120px；连续阅读最大 `--kdp-reading-width` 720px（约 72ch）。
- 外边距：手机 16–20px（`site.css` 用 `calc(100% - 40px)`），平板 24px，桌面 32px。
- 断点起点：768 / 1024 / 1440px，现行 `site.css` 另有 720px、400px 两档窄屏规则。
- 必须在 320、375、768、1024、1440px 宽度下无横向滚动、无内容被截断。
- 主站提供舒展的阅读节奏；工作应用（GU、GZH、Health）保留适合的信息密度，
  但仍使用同一套间距刻度。
- 主要可点击目标至少 44×44px（`site.css` 的导航、页脚链接已按此实现）。

## 6. 圆角、边框、阴影

| 元素 | Token | 值 |
| --- | --- | --- |
| 按钮、输入框、标签等控件 | `--radius-control` | 10px |
| 卡片 | `--radius-card` | 14px |
| 弹窗、主要内容面 | `--radius-dialog` | 18px（v2.0.0 token 源为 20px，待决；决定前保持 18px） |
| 徽标、状态胶囊等小元素 | 无 | v2.0.0 新增 6px，待决；决定前沿用 `--radius-control` 或胶囊形 |

- 边框统一 1px；装饰边框用 `--color-border`，控件边界用 `--color-border-strong`。
- 阴影只用 `--kdp-shadow`（`0 8px 32px rgb(45 42 40 / 5%)`）表达内容面层级；
  不叠加多层阴影，不用阴影代替边框。
- 页面背景默认纯色，不用渐变。

## 7. 图标

- Lucide 风格线性图标，16/20/24px，线宽 1.75px，圆形端点，颜色继承 `currentColor`。
- 同一界面不混用 emoji、填充图标和其他图标族。
- 纯图标按钮必须有可访问名称；装饰图标对辅助技术隐藏。
- 引入图标库属于新增依赖，必须先得到用户批准；在批准前使用内联 SVG。

## 8. 动效

- `--motion-fast` 150ms（悬停、颜色变化），`--motion-normal` 220ms（展开、出现）。
- 优先过渡 `opacity` / `transform`；不能让理解状态依赖动画。
- 必须尊重 `prefers-reduced-motion`（`site.css` 已全局处理；独立应用需自带同等规则）。
- 不使用视差、大面积自动播放、闪烁的加载动画。

## 9. 组件契约

每个交互组件都必须定义：结构、变体、尺寸、键盘交互、可访问名称、校验方式，
以及适用的状态：default / hover / focus-visible / active / disabled / loading / error。

| 组件 | 变体 | token 映射与要求 | 参考实现 |
| --- | --- | --- | --- |
| Button | primary / secondary / ghost / destructive | primary：背景 `--color-action`，文字 `--color-action-text`，悬停 `--color-action-hover`；secondary：表面底 + `--color-border-strong` 边框，悬停 `--brand-soft`；destructive 用 `--color-danger`；高度 ≥44px（主站 48px）；loading 要宣告且防重复提交 | `.kdp-button`、`.kdp-button--secondary` |
| Link | 正文链接 / 强调链接 | 颜色 `--color-action-hover`，下划线偏移 4px；不使用 `#C94F20` 或品牌橙作为链接色 | `.kdp-link`、`.personal-article a` |
| Input / Textarea / Select | normal / error / disabled | 常驻 label；helper 与 error 通过 `aria-describedby` 关联；边界用 `--color-border-strong`；错误同时提供图标或文字，不只靠颜色 | — |
| Card | static / actionable | 表面底 + `--color-border` + `--kdp-shadow`，圆角 14px；只有可点击卡片才有悬停/焦点反馈 | `.kdp-card` |
| Navigation | 页头 / 侧栏 / 底栏 | 当前项：正文色 + 600 字重 + 品牌橙 2px 下划线，并设置 `aria-current="page"`；悬停用 `--color-action-hover`；不整片铺高饱和橙 | `.kdp-nav` |
| Tabs | default / selected / disabled | 方向键切换，tab 与 panel 互相关联 | — |
| Dialog | confirm / form | 明确标题；焦点困在弹窗内，关闭后焦点返回；Esc 关闭；圆角 18px | — |
| Toast / Alert | info / success / warning / error | 使用状态色；按紧急程度选 `aria-live` 级别；需要时可关闭 | — |
| Loading | brand / global / inline / ai | 见第 9.2 节；不显示虚构进度 | `brand/codepi-v2.0/loading/` |
| 空状态 / 错误状态（Feedback） | empty / error / offline / partial | 见第 9.1 节；说明当前状态和下一步，不编造数据、指标或内容 | — |
| Skip link | — | 键盘可达，聚焦时出现 | `.kdp-skip` |
| 焦点 | 全局 | `:focus-visible` 为 2px `--color-focus` 实线，外偏移 2px | `site.css` |

品牌橙不要出现在每张卡片上；状态信息不能只用颜色表达。

Claude 设计系统 artifact「CodePi Design System」实现了 Button、Input、Select、Card、Tabs、Nav、Dialog、Alert，
v2.0.0 包有 Button、Input、Card、Loading、Feedback 的 React 源码。两者只作视觉参考，
各应用用自己的技术栈（主站 Astro，私人应用 Svelte 5）实现。

### 9.1 交互状态

状态机：idle → pending → success | error | cancelled；offline 与 partial 是独立状态。

| 状态 | 表现 | 恢复 |
| --- | --- | --- |
| Empty | 说明为何为空，给下一步入口 | 新建或导入 |
| Loading | 300ms 内避免闪烁，超过 2s 显示状态文字 | 超过 10s 提供取消或后台继续 |
| Error | 说明失败了什么并可重试，不暴露内部堆栈 | 重试或反馈 |
| Offline | 标出缓存数据和上次同步时间 | 网络恢复后重试 |
| Partial | 区分已完成和失败的部分 | 只重试失败项 |
| Success | 非阻塞确认，附结果链接 | 查看结果 |
| Disabled | 说明原因，不只靠颜色 | 条件满足后恢复 |
| Cancelled | 停止动画与后台任务，告知结果 | 重新发起 |

- 不可逆操作必须说明影响范围并二次确认；提交按钮必须防重复点击。
- 示例数字只用于展示，真实业务数据必须来自应用。

### 9.2 加载

| 变体 | 用途 | 视觉 | 默认文案 |
| --- | --- | --- | --- |
| brand | 应用启动、首次进入 | CodePi 字标 + 橙色圆环 | 正在加载… |
| global | 全局数据初始化 | 居中橙色圆环 + 文字 | 正在获取数据… |
| inline | 按钮内或局部区域 | 16–32px 转圈或骨架屏 | 正在处理… |
| ai | AI 推理或流式输出前的等待 | 三个脉动的橙色圆点 | AI 正在思考中… |

- 转圈尺寸 16 / 24 / 32 / 48 / 64px，线宽按比例；圆环每圈 1200ms 匀速，圆点脉动 1200ms、依次错开 150ms；只动 `transform` / `opacity`。
- 进度未知时只用不确定动画，**不得**编造百分比；流式输出一开始就替换转圈；出错时停止动画并给出可操作的错误。
- 不叠多层全局遮罩，遮罩不得挡住关键错误；阻塞式遮罩要有意识地管理焦点。
- reduced-motion 下显示静态标记和可见文字，状态本身不移除。
- 非阻塞更新用 `role="status"` + `aria-live="polite"`；加载区域设 `aria-busy="true"`，结束后复位；圆环、圆点设 `aria-hidden="true"`。
- 橙色圆环是临时实现，不得称为标志路径动画；以后做路径动画必须基于已批准的矢量母版。
- 参考实现：`brand/codepi-v2.0/loading/loading.css`、`demo.html`（静态原型，不是生产组件）。
- 仓库共享实现：`packages/shared/styles/loading.css` 已提供 `.kdp-loading` / `.cp-loading` 的 brand、global、inline、ai 四种变体，以及 `.kdp-skeleton` / `.cp-skeleton`；通过 `site.css` 供主站和 Desk 复用。状态更新必须设置 `role="status"`、`aria-live="polite"`，加载区域使用 `aria-busy`，并在完成、错误或取消后停止动画。

### 9.3 AI 交互组件

以下是设计合同，尚未实现。以后做 MCP 授权、AI 工作台等界面时按此实现。

| 组件 | 必需状态 | 约束 |
| --- | --- | --- |
| ChatMessage | streaming / complete / error | 代码可复制、支持 Markdown、引用可追溯 |
| ModelSelector | ready / unavailable / loading | 说明不可用原因，明确当前模型 |
| ToolCallCard | queued / running / succeeded / failed / cancelled | 输入输出摘要，敏感数据脱敏 |
| AgentProgress | planning / executing / waiting / done | 真实任务步骤，可取消，不伪造百分比 |
| ApprovalDialog | pending / approved / rejected / expired | 执行前说明目标、权限、风险和影响范围 |
| Attachment | uploading / processing / ready / error | 类型、大小、隐私说明，失败可恢复 |
| Citation | available / unavailable | 来源、时间，可点击查看原始证据 |
| Conversation | online / offline / syncing / conflict | 本地缓存与同步冲突提示 |

AI 不得用加载状态暗示未完成的工作已经完成；高风险工具调用必须在实际执行前取得确认。

## 10. 数据可视化

- 盈亏、警告、数据系列色各自定义清楚的语义变量，与品牌强调色分开。
- 图表必须提供图例或数据表等文字说明；悬停提示不能是获取数值的唯一途径。
- 缺失数据显示为缺失，不能画成 0；坐标网格用低对比度的应用局部变量。
- Health 现有系列色（睡眠灰蓝、准备度绿、活动/HRV 暖橙，以及深睡、REM、浅睡、清醒）保留，
  其中的灰蓝只是数据系列色，不代表品牌。

## 11. 内容与语气

- 以真实内容组织页面；没有内容时省略模块或说明当前状态，不放假按钮、假文章、假指标。
- 公开页面不嵌入私人数据（见[个人站设计规范](personal-design-system.md)）。
- 外链在新标签页打开时要有明确提示。
- 不放广告位、广告脚本或占位符。

## 12. 应用主题边界

共享部分（所有应用都必须遵守）：字体栈、字阶、间距刻度、圆角、焦点样式、动效时长、
状态色语义、组件状态契约、标志用法、可访问性标准。

应用可自定的部分：本应用的语义色（业务状态、数据系列）、信息密度与布局、
是否覆盖 `--kdp-*` 颜色别名来保留应用身份。

| 范围 | 主题入口 | 当前身份与允许的定制 |
| --- | --- | --- |
| 主站 `apps/web` | `BaseLayout.astro` + `site.css` | 完全采用 v1.5 默认色板；页头为符号 + HTML 字标 |
| Desk（主站私有区） | `apps/web/src/styles/desk.css` | 只用 `--kdp-*`，无字面色值；保持现状 |
| GU `apps/gu` | `apps/gu/web/src/style.css` | 导入共享 tokens，把应用变量映射到 `--kdp-*`；可保留投资业务语义色（盈亏、预警），页头和登录页用 `CODEPI_SYMBOL_SVG` |
| GZH `apps/gzh` | `apps/gzh/web/src/styles.css` | 导入共享 tokens，移动优先的工作台密度；`-soft` 系列浅色背景可作为应用局部语义色 |
| Health `apps/health` | `apps/health/apps/web/src/theme.css`（在共享 tokens 之后加载） | 保留暖纸主题：背景 `#fbf8f3`、表面 `#fffdf9`、陶橙 `#a3421c`/`#813719`、浅暖 `#f4e9df`；字体、间距、圆角沿用共享；图表系列色见第 10 节 |
| Project `apps/project` | `apps/project/web/src/style.css`（导入共享 tokens，另有 `--project-*` 变量） | 可保留看板信息密度和项目状态语义色；品牌面（标志、favicon、`theme-color`、主色）必须回到 CodePi 暖白 + 橙，不另立蓝色品牌 |
| Me `apps/me` | `apps/me/web/src/style.css`（导入共享 tokens） | 同 Project；页头已用 `PRODUCT_BRAND` 文字 |
| Auth 登录页、MCP 授权页 | `services/auth/src/ui.ts`、`services/mcp/src/pages.ts`（内嵌 `tokens.css`） | 使用共享 token；品牌展示用 `PRODUCT_BRAND` |

覆盖 `--kdp-*` 的应用主题同样必须满足第 3.4 节和第 13 节的对比度要求：
正文、次要文字、链接、按钮文字 ≥ 4.5:1，焦点和控件边界 ≥ 3:1，并在该应用的 PR 中给出计算或实测结果。

## 13. 可访问性验收（WCAG 2.2 AA）

- 正文 ≥ 4.5:1，大字（≥24px，或 ≥18.66px 粗体）≥ 3:1，有意义的 UI 边界与图标 ≥ 3:1。
- 全部功能可用键盘完成，焦点始终可见，Tab 顺序合理。
- 语义化标题层级、地标区域，表单有 label；错误有文字描述并与字段关联。
- 200% 缩放、320px 宽度下功能完整。
- 状态不只靠颜色表达（禁用、错误、选中、盈亏）。
- 尊重 `prefers-reduced-motion`。
- 触控目标 ≥ 44×44px；确有例外时在任务中写明。

## 14. 现状与待实施清单（2026-10-20 核对 main）

以下是规范与当前代码之间的差距，供各项目 agent 认领。认领时请在任务记录中写明范围，
完成后更新本节。行号与计数以核对当时为准，动手前请重新核实。

### 已落地

- `tokens.css` 已复制 v1.5 语义 token，`--kdp-*` 别名全部指向语义层（#118）。
- 首页、GU、GZH、Health 的 favicon，以及首页、GU 的 `apple-touch-icon`，都已换成 v1.5 导出文件，
  并于 2026-10-20 发布到生产，线上文件与仓库逐字节一致（#123）。
- 主站页头/页脚与 Three.js 原型已使用透明 PNG 字标；GU 页头与登录页继续使用 `CODEPI_SYMBOL_SVG` + 字标。
- 主站共享层已接入 v2.0.0 Loading 变体；Desk 的概览、摘要状态使用共享圆环和 reduced-motion 规则。
- Auth、MCP 页面内嵌共享 `tokens.css`。

### 待实施

| 优先 | 范围 | 差距 | 期望结果 |
| --- | --- | --- | --- |
| P1 | GZH | 页头是纯文字品牌（`App.svelte` 中的 `brand-kicker` / `brand`），没有标志；缺少 `apple-touch-icon` | 按第 2 节接入符号与字标，补齐第 2.3 节图标契约 |
| P1 | Health | `ProductBrand.svelte` 用 `/icon.svg` 图片作标志；`apple-touch-icon` 指向 512px 的 `icon.png`，不是 180px 文件 | 评估改用 `CODEPI_SYMBOL_SVG`；补 180px `apple-touch-icon.png` 并同步 `check:branding` |
| P1 | Project、Me | favicon 是蓝底（`#3568c7`）自绘字母图标，`theme-color` 为冷灰 `#f4f7fb`；Project 的 `--project-*` 主题以海军蓝/蓝色为主（`style.css` 41 处字面色值），与“禁止蓝紫、默认暖白 + 橙”冲突；页头没有标志 | 换成 v1.5 图标文件并补齐第 2.3 节契约；`theme-color` 与背景改为共享暖白；主色映射到 `--color-action`，仅保留必要的业务状态色；页头按第 2.2 节无 `{@html}` 方式接入符号 |
| P1 | Auth 登录页、MCP 授权页 | 只有文字品牌，没有标志；没有 favicon | 加上符号 + 文字品牌，并按第 2.3 节提供图标 |
| P2 | GU | `style.css` 有 24 处十六进制字面色值 | 改为应用主题变量或共享 token；业务语义色集中定义 |
| P2 | GZH | `styles.css` 有 18 处字面色值（如 `--ok-soft`、`--danger-soft`） | 集中到主题变量区，并验证对比度 |
| P2 | Health | `styles.css` 24 处、`report.css` 5 处字面色值 | 归入 `theme.css` 的局部变量 |
| P2 | 全部私人应用 | 新代码直接用 `--kdp-*` 别名；语义层 `--color-*` 尚无应用使用 | 新增样式优先引用语义 token；不强制一次性迁移旧代码 |
| P2 | 全部应用 | 没有统一的 Loading 与 Feedback（空、错误、离线、部分完成）实现 | 按第 9.1–9.2 节在各应用实现，并覆盖 reduced-motion 与 live region |
| P2 | 手机字阶 | 共享 token 只有桌面字号 | 需要时以 `clamp()` 实现第 4 节手机值；如要新增共享 token，需用户批准 |
| P3 | 深色模式 | 深色缺 `--color-border-strong` 和石墨灰（v1.5 原件为 `#E5E0DA`）；暖白 `theme-color`、图标未区分深浅；没有页面启用 | 先补 token（需批准），再逐应用验收后启用 |
| P3 | PWA / 平台图标 | 未接入 manifest；Apple `.icon`、Android 启动器、微信上传均未验收 | 有需求时按 `PLATFORM_COMPLIANCE.md` 逐平台实测 |
| P3 | Claude 设计系统 artifact | 缺 Loading、Feedback 组件 | 按第 9.1–9.2 节补齐，供设计稿使用 |
| P3 | 品牌母版 | 矢量母版仍是候选稿；商标与字体授权未审查 | 用户确认定稿后替换第 2.4 节所列两处 |

## 15. 实施流程（给各项目 agent）

1. 先读本文、目标应用的 `AGENTS.md`，以及要改的组件和应用主题文件；
   品牌值有疑问时再查 `brand/codepi-v2.0/`、`brand/codepi-v1.5/` 原件。
2. 先复用 `site.css` 参考组件、应用里已有的组件和 token，再考虑新增；不新增依赖、远程字体或图标库。
3. 只在本应用的主题文件中加局部变量；需要改 `tokens.css`、`site.css`、`brand.ts` 时，
   单独开任务并请用户批准，PR 中列出所有消费方
   （主站、GU、GZH、Health、Project、Me、Auth、MCP，见 `packages/shared/AGENTS.md`）。
4. 完成前自查：
   - 新增代码没有十六进制或 `rgb()` 字面色（可用 `rg -n '#[0-9a-fA-F]{3,8}\b' <改动文件>` 检查）；
   - 新增的颜色配对给出对比度；
   - 状态覆盖 default / hover / focus-visible / disabled / loading / error / empty；
   - 320 / 375 / 768 / 1024 / 1440px 宽度和 200% 缩放下正常；
   - 键盘可完成全部操作，焦点始终可见；开启 reduced-motion 后动画关闭；
   - 登录、空数据、错误、图表等私人应用场景逐一检查。
5. 运行 `node scripts/agent/check.mjs --base <起点SHA> --run`；改动 Health 品牌资源时同时更新 `check:branding`。
6. 交付说明写明：遵守了哪些规则、跑了哪些检查、桌面和手机截图证据、哪些仍是暂定或未验证。
   不能凭“已导入 token”宣称视觉已统一。

## 16. 变更治理

- 品牌标志、品牌色、字体或共享 token 的任何变更，都需要用户批准、changelog 记录和受影响组件复查。
- `brand/codepi-v1.5/`、`brand/codepi-v2.0/` 是只读原件；新版本作为新目录放入，
  再更新 `tokens.css`、`brand.ts` 和本文。
- 版本号遵循 SemVer：major 为破坏性的 token 或组件 API 变更，minor 为兼容新增，patch 为文档与修复。
- 设计变更写明背景、范围、token 影响、迁移计划、截图和回滚方式。
- 组件废弃时旧 API 至少保留一个 minor 版本并附迁移说明。
- 不得把未执行的检查（视觉回归、无障碍、平台审核）标记为通过。
- 本文由共享层的单一写入者维护；应用 agent 发现规范缺口时，在任务记录中提出，
  或单独提 PR 修改本文，不在应用代码里各自约定。
- 本文第 14 节是带日期的盘点，不是实时状态；更新时注明日期和核对的 commit。

## 17. 待决事项

用户做出决定前，实现保持现状，不自行选择。

1. 弹窗圆角用 18px（现网、v1.5、v2.0.0 文档）还是 20px（v2.0.0 token 源）；是否启用 6px 小圆角。
2. 是否把 CSS 变量迁到 v2.0.0 的 `--cp-*` 命名；如果迁，间距按下标编号还是按倍数编号。
3. 深色模式是否跟随系统 `prefers-color-scheme`；深色下控件边界色与石墨灰取值。
4. 是否自托管 Inter 与 Noto Sans SC（需先核对授权）。
5. GU 涨跌色方向，以及正常 / 关注 / 异常 / 待核实四种状态色的映射。
6. Health 暖纸主题是否并回共享色板。
7. 标志母版何时从 candidate 升为 approved。
