# Health 开发边界

- 产品名为 Health；源码目录与包名保留 oura，不据此保留旧云资源名。Cloudflare 物理资源命名遵循 `../../docs/development/cloudflare-governance.md`，具体资源与环境见 `../../docs/development/cloudflare-resource-registry.md`。先读 `README.md` 的当前登录说明，后面的历史 DEV 描述不能覆盖生产 SSO。
- 本目录是根 pnpm workspace 的成员。`apps/web/` 是前端，`workers/api/` 是 API，`shared/` 是 Health 内部共享逻辑，与仓库根 `packages/shared/` 区分。依赖安装从仓库根执行 `pnpm install`。
- 网站 SSO、Oura 提供方授权、MCP 客户端授权是不同生命周期；不要复用错误的 token、Cookie 或回调。生产只使用 health.codepi.app；验证提供方回调、SSO 回跳和 MCP 发现地址。
- 健康日期、时区、同步缺失与缓存新鲜度是业务语义。修改同步需覆盖重试/并发与旧数据，不能把缺失值当零；测试使用合成数据。
- 本地检查：`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm test:browser:built`。浏览器回归包括正常与 SSO 场景，缺少 Chrome 或端口冲突应明确报告，不跳过后称已通过。
- `check:api`、`check:branding` 和 deploy 脚本与线上环境相关，不纳入普通本地验证。构建 API 的 `wrangler deploy --dry-run` 仅是本地产物检查。
- `dev` / `dev:api` 会应用本地 migration；隔离 worktree 的 `.wrangler`，不复用生产数据库或复制私人记录。
