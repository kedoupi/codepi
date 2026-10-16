# 公众号工作台开发边界

- 目录与产品标识为 gzh，生产域名为 gzh.codepi.app；先读 `README.md`。现有 D1 数据库的历史名称不代表另一个产品。
- 保留 `web/`、`worker/`、`migrations/` 分层；统一登录与邮件复用根 `packages/shared/auth/`、`packages/shared/email/`。
- 草稿、审阅、发布各自保留明确状态，界面改动不能隐式触发对外发布。业务测试使用合成稿件与本地 D1，不发送真实 OTP。
- 本应用是唯一公众号发稿/审稿台；原 `gzh-preview` 已合并退役。拒绝与要求修改都进入“需改”，不要恢复平行工作台或分裂同一审阅状态。
- 本地检查：`npm test`、`npm run typecheck`、`npm run build`。测试配置是 `wrangler.test.toml`，不要替换为生产绑定。
- D1 变更新增 migration，说明旧数据兼容与上线顺序。`db:migrate:remote` 与发布属于远程操作，普通验证不执行。
