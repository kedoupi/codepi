# Auth 开发边界

- 本目录是统一登录 Worker，不是 Astro 站点。先读 `README.md`、`../../packages/shared/auth/README.md` 和涉及的 SSO 契约。
- `src/` 是服务端与登录页，`scripts/build.mjs` 打包；品牌、tokens 和 OTP 邮件复用根 `packages/shared/`。
- 协议或会话行为改变必须检查 GU、Health、公众号三个消费者；客户端能力放在 `packages/shared/auth/`，不要各应用复制实现。
- 本地检查为 `npm test`、`npm run typecheck`、`npm run build`；完整跨应用范围由根 `scripts/agent/check.mjs` 选择。
- `scripts/verify-production.mjs` 会进行真实验收，包含邮件等外部副作用，不属于普通测试。需要用户对该动作的明确授权。
- D1 schema 变动新增版本 migration，记录代码与迁移顺序；不要修改已应用的 migration 来假装完成迁移。
