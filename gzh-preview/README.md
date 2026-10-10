# gzh-preview（已下线）

原公众号预览/审稿站已并入 **发稿台** [`fagao/`](../fagao/) → https://fagao.kdp.cool 。

本目录仅保留 Pages `_redirects`，把 `gzh-preview.kdp.cool/*` 301 到 `fagao.kdp.cool`。  
不要在这里加业务功能。

部署：

```bash
npx wrangler pages deploy gzh-preview/public --project-name=gzh-preview --branch=main
```

更好的长期方案：在 Cloudflare 区域为 `gzh-preview.kdp.cool` 配置 Redirect Rule 后，可删除本 Pages 项目。
