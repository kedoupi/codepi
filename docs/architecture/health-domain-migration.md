# Health 域名与设计迁移

日期：2026-10-15

本文保留为历史迁移记录。当前生产域名已切换到 `health.codepi.app`，不再保留旧域；
2026-10-18 起本地实现直接移除旧 Health MCP，统一入口为 `mcp.codepi.app/mcp`，
不再沿用下文的旧连接兼容方案。当前边界与发布状态见
[统一 MCP](unified-mcp.md)和[任务记录](../development/tasks/2026-10-18-unified-mcp.md)。

## 当前设计

- 主入口：`https://health.kdp.cool`。
- 兼容入口：`https://oura.kdp.cool`，继续服务网页、回调和旧 MCP 连接，本轮不做整站跳转。
- 两个域名关联同一个 Pages 项目 `oura-kdp`，API、MCP、OAuth、发现元数据路由均指向 `oura-kdp-api`。
- 沿用 D1 `oura_kdp`、用户 ID、`oura` SSO client ID、加密密钥、令牌表和定时任务。不移动数据，不重建账号。
- 主站、Health、统一登录、MCP 授权页共用 `shared/styles/tokens.css`。页面内容密度按用途调整。

## 网页登录

`auth/wrangler.jsonc` 增加 Health 的精确回调：

```text
https://health.kdp.cool/api/auth/callback
```

原 Oura 回调仍由现有客户端登记保留，GU 的额外回调也保留。SSO 在每个域名建立独立的 `__Host-` Cookie；不能直接复制旧域 Cookie。已登录中央账号时可通过 SSO 建立新域会话。

`FRONTEND_ORIGIN` 指向 Health，`FRONTEND_ORIGINS` 精确列举新旧域。错误回流优先回到发起域名，未知域名不进入该允许列表。

## Oura 设备授权过渡

Oura 应用当前已登记的回调仍为：

```text
https://oura.kdp.cool/api/auth/oura/callback
```

从 Health 点击连接：

1. 验证 Health 网站会话。
2. 跳到旧域 `/api/auth/login`，通过中央 SSO 建立旧域会话。
3. 返回旧域 `/settings?connect_oura=1`，再从旧域发起 Oura 授权。
4. 提供方回调、网站会话和 state Cookie 始终位于同一域。
5. 更新原用户的加密令牌后返回 Health 设置页。原先请求的 90 天同步可回到 `/settings?sync=90`。

跨域返回只允许配置中的主入口 `/settings` 和 `/settings?sync=90` 两个完整地址。不得接受任意 `return`、任意子域或宽松前缀匹配。原有 MCP 同域授权返回规则仍保留。

未来若在 Oura 开发者后台登记 Health 回调，再同步修改 `OURA_REDIRECT_URI`；此时同域路径会自动使用新回调。不能只修改 Worker 变量就假定外部登记已经完成。

## MCP 与同步

- 新连接地址为 `https://health.kdp.cool/mcp`。
- 旧 `/mcp`、`/oauth*`、`/.well-known*` 保持原行为，不跳转到新域。
- 发现元数据按当前请求域名生成；旧客户端可继续使用原有令牌、刷新与撤销流程。
- 两个域名使用原有同步任务与存储，本轮不新增定时器或重复数据库。

## 发布顺序

1. 关联新 Pages 域名，创建到 `oura-kdp.pages.dev` 的代理 CNAME，添加四组 API 路由。
2. 验证并部署统一登录 Worker，登记新回调。
3. 发布 Health Worker，验证新旧域的 API、MCP 与未登录边界。
4. 发布 Pages，检查登录页、概览、睡眠、周报、对比、设置、手机与桌面。
5. 将主站应用入口切换到 Health。

Cloudflare 普通发布 API token 可能只有 Pages/Worker 权限。DNS、路由操作使用具备相应权限的 Cloudflare 连接器；不要输出凭证或扩大线上访问权限。

## 回退

主站入口可恢复旧域；Worker 和 Pages 可恢复前一部署版本。保留新旧域名、原数据库、SSO 登记和提供方回调，不通过删除数据、重置用户或关闭 SSO 回退。

## 验证边界

本地集成测试覆盖双域 SSO、设备授权回流、恶意返回地址拒绝、用户与令牌连续性、旧 MCP 令牌及刷新。浏览器测试使用本地中央登录/Oura fixture，覆盖导航、语言、图表、同步、空状态、错误、退出和会话失效。

线上公开端点、域名/TLS、版本和同步状态另行核实；真实邮箱验证码、提供方重新同意，以及用户现有 AI 客户端的新地址授权，需要在实际账号中完成一次使用验收，不能由 fixture 通过推断。
