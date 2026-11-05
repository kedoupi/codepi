# Rhythm 开发边界

- Rhythm 是私有领域应用：`web/` 是 Svelte 看板，`worker/` 是 Hono Worker，`migrations/` 是应用自有 D1。页面与 API 共用同一份领域数据。
- 只读两路上游：家中设备（心跳/快照/事件）与工作机采样，统一经通用 service binding `STATUS_READ` 访问。源码不写真实私有服务名、域名、设备名、网络名、MAC、IP 或硬件地址。
- 状态计算放在 `worker/state.ts` 的纯函数里，共享用例在 `shared/fixtures/state-cases.json`；改阈值或规则必须同时更新用例与 `README`。
- 缺失数据永远是「未知」，不能当 0、不能当离开；`pending-offline` 不等于离开。通勤与离座都是推断，必须标注「推断」类别。
- 认证只走 `@kedoupi/shared/auth/client`，生产 `AUTH_CLIENT_ID=rhythm`；本地 D1 保留自己的 SSO 事务与会话表。浏览器只允许同源请求，主体固定为 Owner。
- 页面只按文本节点渲染，不使用 `{@html}`；CSP 保持 `script-src 'self'`。桌面与 390px 移动布局复用共享视觉 token 与本应用语义色，不允许横向溢出。
- 本地检查：`npm test`、`npm run typecheck`、`npm run build`、`npm run test:browser:built`。浏览器冒烟使用合成 SSO 与本地 Worker/D1、假的 `STATUS_READ`。
- 每日汇总 `daily_status` / `daily_metrics` 由每日 Cron 重算最近 3 天；设置页与 `POST /api/admin/recompute` 可手动重算。改状态或汇总口径必须升 `DAILY_ALGORITHM_VERSION` 并同步 `README`；发布与线上重算按 `docs/development/local-release.md` 由所有者授权。
- 根 workspace、lockfile 与共享 contract 由集成负责人维护；本应用沿用既有依赖版本，不自行增加包或远程资源 UUID。
