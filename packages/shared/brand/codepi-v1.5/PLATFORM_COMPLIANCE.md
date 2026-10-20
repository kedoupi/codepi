# CodePi Platform Compliance · v1.4

核查日期：2026-10-16。规格区分为官方要求、实现建议和未核实项目；生成资源不等于平台审核通过。

| 平台 | 官方依据 | 交付资源 | 验证状态 |
|---|---|---|---|
| Apple iOS/iPadOS/macOS | 1024×1024 画布；分层图标与多种外观，Icon Composer 或 Xcode asset catalog | `apple/app-store-1024.png`、外观候选 PNG、Icon Composer 导入说明 | 尺寸检查通过；分层 `.icon` 未生成，待 Xcode/设备测试 |
| Google Play 应用详情 | 512×512、32-bit PNG、最大 1024 KB | `google-play/store-icon-512.png` | 文件属性检查通过，上传审核未做 |
| Android 自适应启动图标 | 108×108dp 图层；中央 66×66dp 安全区；前景+背景，单色层支持主题化 | `android/ic_launcher_*.png` | 图层尺寸与内容安全区检查通过；设备遮罩未测试 |
| Web / PWA | manifest icons 的 `any`/`maskable` 用途；多尺寸按项目需要配置 | `web/pwa-*`、`manifest.example.json` | JSON/PNG 检查通过；浏览器安装未测 |
| Windows | 不同 Windows 应用打包体系要求不同 | `windows/app.ico` | ICO 多尺寸可读取；商店打包未测 |
| 微信公众号、小程序 | 本轮未获得可引用的微信官方头像上传尺寸说明 | `wechat/avatar-*` | 仅候选图，未验证微信上传或裁切 |
| GitHub/X 等社交平台 | 本轮未核实平台特定硬性尺寸 | `social/avatar-*` | 仅候选图 |

## 官方参考

- Apple HIG: https://developer.apple.com/design/human-interface-guidelines/app-icons
- Apple Icon Composer: https://developer.apple.com/documentation/Xcode/creating-your-app-icon-using-icon-composer
- Google Play store listing: https://support.google.com/googleplay/android-developer/answer/9866151?hl=zh-Hans
- Android adaptive icons: https://developer.android.com/develop/ui/compose/system/icon_design_adaptive
- MDN manifest icons: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons
- MDN PWA icons: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons

## 发布阻断项

1. Logo 当前矢量为概念稿复绘，须人工批准字形与图形母版。
2. Apple `.icon` 需在 Icon Composer 完成分层、明暗/着色外观与 Xcode 构建。
3. Android 需在真实启动器上检验不同形状蒙版。
4. 微信头像需登录平台实测上传、裁切、缩略图效果。
5. 对 Logo 商标近似与字体授权单独核查。
