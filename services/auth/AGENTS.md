# Auth 开发边界

- 本目录是统一登录 Worker，不是 Astro 站点。先读 `README.md`、`../../packages/shared/auth/README.md` 和涉及的 SSO 契约。
- `src/` 是服务端与登录页，`scripts/build.mjs` 打包；品牌、tokens 和 OTP 邮件复用根 `packages/shared/`。
- 协议或会话行为改变必须检查 shared/auth/clients.ts 登记的全部客户端；客户端能力放在 `packages/shared/auth/`，不要各应用复制实现。MCP 网站登录与 AI 客户端 grants 是不同生命周期，不能把网站退出当作 MCP token 撤销。
- 本地检查为 `npm test`、`npm run typecheck`、`npm run build`；完整跨应用范围由根 `scripts/agent/check.mjs` 选择。
- `scripts/verify-production.mjs` 是含真实邮件副作用的显式验收脚本，覆盖七个现行客户端，不是默认发布命令。真实邮件需要明确授权；普通单测使用 mock，不访问生产或发送邮件。
- D1 schema 变动新增版本 migration，记录代码与迁移顺序；不要修改已应用的 migration 来假装完成迁移。
