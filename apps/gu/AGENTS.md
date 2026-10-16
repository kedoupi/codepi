# GU 开发边界

- 保留 `web/` 前端、`worker/` 服务端与 `migrations/` 数据边界；读 `README.md` 了解上传契约与数据来源。
- 展示调整不能改变金额、盈亏、估值口径或数据时间语义。没有数据与数值零不能混淆；测试使用合成数据。
- 保持 `style-src 'self'`；动态样式遵循 `web/src/dom.ts` 的现有 CSSOM 模式。
- SSO 复用 `../../packages/shared/auth/client.ts`，生产认证、旧 OTP 的开发模式及授权失败路径分别验证。
- 本地检查：`npm test`、`npm run test:scripts`、`npm run typecheck`、`npm run build`、`npm run check:deploy -- --mode config`。线上验收是独立步骤。
- 投资工作区的生成与上传脚本不在本仓库，不擅自修改或用真实投资数据构造 fixture。
