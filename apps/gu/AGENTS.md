# GU 开发边界

- 保留 `web/` 前端、`worker/` 服务端与 `migrations/` 数据边界；读 `README.md` 了解上传契约与数据来源。
- 展示调整不能改变金额、盈亏、估值口径或数据时间语义。没有数据与数值零不能混淆；测试使用合成数据。
- 保持 `style-src 'self'`；动态样式遵循 `web/src/dom.ts` 的现有 CSSOM 模式。
- SSO 复用 `../../packages/shared/auth/client.ts`，生产认证、旧 OTP 的开发模式及授权失败路径分别验证。
- 本地检查：`npm test`、`npm run test:scripts`、`npm run typecheck`、`npm run build`、`npm run check:deploy -- --mode config`。线上验收是独立步骤。
- 投资工作区的生成与上传脚本不在本仓库，不擅自修改或用真实投资数据构造 fixture。
- 线上账户以 `gu_workspace_head` 指向的追加版本为准；首次确认保存前保留旧快照模式，启用后旧上传不得覆盖线上账户。写操作保留版本比较、请求去重、同源校验及保存预览。
- 金额/数量保留十进制文本与未知值；参考 USD 估值不代表实时行情。交易流水、账户快照、规则正文和 AI 结论不能隐式互相改写。
- 原件只经 GU 鉴权访问 `MATERIALS`，不生成公开 R2 链接。`GuMaterialsBackup` 仅向 Ops 的显式 service binding 提供只读清单与流，不映射 HTTP 路由、不另加同步 secret。
- `gu_materials` 当前只追加，备份在 D1 导出后固定 rowid 上限；新增删除、改写或重建索引能力前必须调整备份一致性方案。D1 与原件恢复分别验收，见恢复 runbook；测试用合成文件。
