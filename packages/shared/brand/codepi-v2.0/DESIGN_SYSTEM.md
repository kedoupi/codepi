> CodePi Design System v2.0.0 — legacy specification maintained for compatibility. For current entry see README.md.

# CodePi Design System v1.2

> 状态：Draft / 可供 AI 开发使用。发布日期：2026-10-16。品牌方向已确定；具体矢量几何、色值与平台审核细节待最终确认。

## 1. 品牌定位

CodePi 是独立开发者、技术创作者的个人品牌。品牌气质：克制、可靠、鲜明、有温度；避免蓝紫霓虹、泛 AI 科技渐变、过度玻璃拟态。

### 品牌标志
- 结构：大写 C + 希腊字母 π + 内部 `</>`，组合成可独立使用的符号。
- 主色：石墨灰 + 活力橙；默认不使用渐变。
- 标准组合：符号 + `CodePi` 字标；小尺寸场景只使用符号。
- `BUILD · THINK · CREATE` 为可选传播标语，不属于小尺寸 Logo 必选元素。
- **注意**：`assets/` 内 SVG 是依据已选 Logo 视觉重新绘制的初版近似矢量 Demo，不是原始生成图的精确矢量描摹。正式商用前需校准 C、π、`</>` 的轮廓和字距。

## 2. 色彩 Token（02 石墨灰橙，2026-10-16 确认方向）

选定 02 石墨灰橙作为主方案。保留 C + π + `</>` 几何结构，**C / Code 由纯黑改为石墨灰**；π / Pi 为活力橙。以明亮暖白作为页面主背景。以下 HEX 是设计落地的暂定标准，需在最终矢量母版审核时复核。

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--logo-graphite` | `#5E5A56` | `#E5E0DA` | Logo C / Code / 代码符号 |
| `--brand-primary` | `#FF713D` | `#FF713D` | π / Pi、品牌强调 |
| `--brand-primary-hover` | `#C94F20` | `#FF936C` | 交互强调（按对比度调整） |
| `--brand-soft` | `#FFE6D9` | `#49342C` | 暖橙浅色背景 |
| `--text-primary` | `#2D2A28` | `#F6F3ED` | 主要正文（不等于 Logo 灰） |
| `--text-secondary` | `#77746F` | `#B4AEA5` | 次要文字 |
| `--bg-page` | `#FAF8F4` | `#242321` | 页面背景 |
| `--bg-surface` | `#FFFFFF` | `#302E2B` | 卡片与面板 |
| `--border-default` | `#E7E3DC` | `#514D47` | 边框 |

**配色比例建议**：暖白 / 白色 75–85%，灰色及文字 10–20%，橙色 5–10%。这是视觉建议而非硬性测量。**橙色 `#FF713D` 上的白色小字可能不满足 WCAG 正文对比度**；主按钮可用深色字或深一档的交互橙，实际必须测试。成功、警告、错误另设语义色，不滥用品牌橙。

**候选微调（未定稿）**：02-A 标准石墨灰橙（首选）；02-B 浅石墨灰橙（更轻盈）；02-C 暖石墨灰橙（更温暖）。仅 02 主方向已选定，其他均为备选。

## 3. 排版、空间与动效

- 英文优先 Inter；中文使用 Noto Sans SC / 思源黑体；代码使用 JetBrains Mono。需核对实际字体许可和加载。
- 标题字重 600–700；正文 400–500；正文行高 1.5–1.7。
- 间距采用 4px 基准：4 / 8 / 12 / 16 / 24 / 32 / 48 / 64。
- 圆角：控件 10px、卡片 14px、弹窗 18px；可根据密度微调。
- 边框 1px；阴影尽量轻；过渡 150–220ms；尊重 `prefers-reduced-motion`。
- 响应式：移动端单栏，桌面端适度多栏；布局需在 320px 及以上宽度可用。

## 4. 组件约束

- Button：Primary、Secondary、Ghost、Destructive 四类；必须提供 hover/focus/disabled/loading 状态。
- Input：明确 label、helper text、error text；键盘焦点可见。
- Card：浅色主题白色表面+暖灰边框；深色主题暖深灰表面；不堆叠重阴影。
- Navigation：当前项以橙色细节或浅色背景提示，不整片使用高饱和橙。
- Dialog：明确标题、关闭动作与键盘可达性。
- 图标：统一 Lucide 风格，建议 1.75px stroke，尺寸 16/20/24。

## 5. 场景与资产矩阵

| 场景 | 资产建议 | 说明 |
|---|---|---|
| Apple App Store / iOS 应用 | `app-icon-light.svg` → 1024×1024 PNG | 正方形、不预烘焙圆角；发布前以 App Store Connect / Xcode 当前要求为准 |
| macOS / Windows 应用 | 从母版生成多尺寸 PNG、ICNS、ICO | 需按平台要求生成最终包；当前未附 ICNS/ICO |
| 网站导航栏 | `web-logo-light.svg` / `web-logo-dark.svg` | 横向字标，适用于浅色和深色页头 |
| Favicon | `icon-16.png` / `icon-32.png` / SVG | 极小尺寸可能需删除内部 `</>` 细节 |
| 微信公众号 / 微信开放平台头像 | `avatar-orange.png` / `app-icon-light.png` | 使用居中正方形图；各入口尺寸和审核规则单独确认 |
| 小程序 / 社交媒体 / GitHub | `avatar-orange.png` | 考虑圆形裁切安全区，避免关键内容贴边 |
| Open Graph 分享封面 | 后续单独制作 1200×630 PNG | 应含横向 Logo 和简洁品牌背景，不复用方形头像 |

**统一规则**：源文件优先 SVG，分发图优先 PNG；透明版本只在支持透明的平台使用。小尺寸版本简化细节，不直接缩小带标语的完整版。禁止拉伸、旋转、改色、加描边、擅自加渐变。

## 6. 目录约定

```text
codepi-brand/
  DESIGN_SYSTEM.md
  tokens.css
  assets/
    app-icon-light.svg / .png
    app-icon-dark.svg / .png
    avatar-orange.svg / .png
    symbol-transparent.svg / .png
    web-logo-light.svg / .png
    web-logo-dark.svg / .png
    icon-16.png, icon-32.png, ...
```

## 7. AI Agent 执行规则（可直接引用）

> 你正在开发 CodePi 品牌的网站或应用。请先读取 `DESIGN_SYSTEM.md` 和 `tokens.css`。严格复用现有品牌色与间距 Token，不自行添加蓝紫 AI 渐变、荧光配色或厚重玻璃拟态。默认优先浅色暖白背景、深灰正文、少量活力橙强调。Logo 只能使用 `assets/` 提供的官方变体，不能重新绘制或使用 emoji 代替。实现按钮、表单和导航时必须覆盖焦点、禁用和错误状态，检查可访问性对比度和移动端响应式。平台图标输出前核对该平台当前规格。设计有歧义时优先保持现有系统一致性，并列出需人工确认的差异。

## 8. 待确认事项

1. Logo 最终矢量母版：字形精修与符号细节。
2. 活力橙最终 HEX 与文本对比度测试。
3. 微信各具体入口（公众号头像、小程序图标、开放平台应用图标等）的当期规范。
4. App Store 最终交付图及各系统图标的构建流水线。
5. 组件库示例页和真实网站/应用 Mockup。

## 9. 版本迁移说明（v1.0 → v1.2）

- 废弃旧版 Logo 炭黑 `#20201E` 和旧品牌橙 `#E86A33` 作为主品牌色；保留仅供历史稿对照。
- `assets/` 中既有 SVG / PNG 是 v1.0 的旧色 Demo，**尚未完成 v1.1 重着色，不可当作最终 02 版品牌资产发布**。必须从审核通过的母版重新导出网站、App Store、微信、favicon 等平台资源。
- 网站与 App 默认明亮主题；深色模式作为补充而非品牌主展示。

## 10. v1.2 模块化规范（优先阅读）

本文件保留品牌总览；实施时同时读取 `DESIGN_TOKENS.md`、`COMPONENTS.md`、`TYPOGRAPHY.md`、`LAYOUT.md`、`ACCESSIBILITY.md` 和 `AI_DESIGN_RULES.md`。机器可读 Token 位于 `tokens/`，`tokens.css` 已升级为语义色映射。原 `assets/` 仍是旧版 Demo，不是可发布的最终 Logo。


## Loading System v1.6

See `LOADING_SYSTEM.md`, `loading/loading.css`, and `loading/demo.html`.
