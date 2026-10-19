# 首页与 Desk 开发边界

- 先读 `README.md`。`src/` 是 Astro 页面与浏览器代码，`worker/` 和 `server/` 是
  Desk 服务端；只有本应用使用 Astro，私人应用的 Svelte 方案不自动适用于首页。
- 首页、博客、应用介绍及其他公开页不能请求或嵌入私人数据；`/desk/` 只生成页面壳，
  数据由已鉴权的 `/api/*` 返回，保持 no-store 和退出/离开后的数据清理。
- Desk 使用自己的会话 D1，经共享 SSO 登录；三来源摘要通过现有内部 HTTP 契约和
  独立凭证读取，不直接绑定业务库、不转发浏览器 Cookie、不接受自定义上游 URL。
  单个来源失败不得伪装为零或使其他来源数据失真。
- 品牌、产品清单、布局和样式复用 `@kedoupi/shared/<subpath>`；公开内容改动核对
  sitemap、robots、草稿/私密可见性，不恢复旧工具、广告或退役域名。
- 本地检查：`npm test`、`npm run typecheck:desk`、`npm run build`、
  `npm run test:assets`。Desk 交互另做 `npm run test:browser:desk`，端口和合成
  SSO 配置见 README；普通 `astro dev` 不运行完整 Worker 登录/摘要流程。
- 生产入口是 Workers Static Assets。发布走 `docs/development/local-release.md`
  （仓库根相对路径）；旧 Pages Functions 和 `build:functions` 已退役。
