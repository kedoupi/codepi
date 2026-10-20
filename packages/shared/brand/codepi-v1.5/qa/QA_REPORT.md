# CodePi v1.5 — 交付与验证报告

日期：2026-10-16

## 范围

基于 v1.4 资源，新增可审核的跨平台视觉总览、SHA-256 资产清单和独立格式解析检查。未改变 Logo 结构及品牌配色。

## 独立复核结果

- PASS Apple · default: 1024x1024 RGBA
- PASS Apple · dark: 1024x1024 RGBA
- PASS Google Play: 512x512 RGBA
- PASS Android · foreground: 432x432 RGBA
- PASS Android · mono: 432x432 RGBA
- PASS Web · favicon 16: 16x16 RGBA
- PASS Web · PWA: 192x192 RGBA
- PASS Web · maskable: 512x512 RGBA
- PASS WeChat · avatar: 256x256 RGBA
- PASS Social · avatar: 256x256 RGBA
- PASS Windows · icon: 256x256 RGBA
- PASS Apple · touch: 180x180 RGBA

- SVG XML 解析成功：18 个
- JSON 解析成功：6 个
- 资产 SHA-256 清单：`qa/asset-manifest.json`

## 官方规范更新

- Apple：当前官方指南推荐使用 Icon Composer 分层资源，默认/深色/透明/着色外观，1024px 方形画布；仅有 PNG 不代表已完成 `.icon` 工程。https://developer.apple.com/documentation/Xcode/creating-your-app-icon-using-icon-composer
- Android：前景、背景两层；108×108 dp 图层，中央 66×66 dp 安全区，主题单色层。https://developer.android.google.cn/develop/ui/compose/system/icon_design_adaptive?hl=en
- 微信、社交平台：官方上传限制与裁切规则尚未通过后台验证，当前为候选图。

## 尚未通过的发布门槛

1. 用户人工确认矢量 Logo 与选定视觉方案完全一致。
2. 在 Apple Icon Composer 制作并验证实际 `.icon` 文件；Xcode 模拟器和真机验收。
3. Android 在不同厂商启动器测试圆形/方圆蒙版。
4. 微信后台实际上传测试及裁切。
5. 商标相似性与字体使用许可审查。

本报告的 PASS 仅代表本地文件验证，不代表平台审核、视觉识别度或真机测试通过。
