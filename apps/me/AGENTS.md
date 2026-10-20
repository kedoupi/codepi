# Me 开发边界

- Me 是私有领域应用：`web/` 是 Svelte 看板，`worker/` 是 Hono Worker、`MeMcp` 与只读 `MeImportsBackup`，`migrations/` 是应用自有 D1。页面、API 与 RPC 共用同一份领域数据。
- 只通过命名 RPC `MeMcp.execute` / `MeMcp.summary` 向 `services/mcp` 提供能力，操作限定为 `memory.search`、`memory.save`、`memory.import.start`、`memory.import.chunk`、`memory.import.finish`、`profile.get`、`timeline.search`、`entry.propose`。不要增加公网 MCP 路由或下载入口。
- 所有 AI 写入，包括 preference 与 note，都必须进入 pending；只有本人通过同源看板确认、修改后确认或亲自编辑，才能成为 active。profile proposal 使用独立表，不能从任意 memory tags 推导可信 profile。
- 记忆和经历检索只用参数化 `LIKE ... ESCAPE`，支持中文二字查询；不建 FTS 虚拟表，因为 D1 导出无法稳定恢复。
- 导入是 `start` / `chunk` / `finish` 三阶段：单请求 JSON 不超过 24 KiB，整批不超过 500 条和 512 KiB。分块按 `import_id + index + digest` 幂等，索引和聚合边界在单条原子 SQL 写入中检查。只有成功 finish 后才能锁定该客户端的一次导入；未完成批次不得产生可读的 active 记忆。
- 导入原文只存 R2 `IMPORTS` 的 `imports/<id>`，D1 `imports` 只追加索引，记录 `bytes`、`sha256`、`r2_key`。`MeImportsBackup` 仅供 Ops 显式 service binding 读取并校验完整性，不映射 HTTP，不返回公开链接。
- 认证只走 `@kedoupi/shared/auth/client`，生产 `AUTH_CLIENT_ID=me`；本地 D1 保留自己的 SSO 事务与会话表。浏览器写操作必须同源，主体固定为 Owner。
- 不接受疑似 secret 的写入；拒绝路径不回显或记录内容。日志只记录错误码和必要元数据。
- 页面只按文本节点渲染，不使用 `{@html}`；CSP 保持 `script-src 'self'`。桌面与 390px 移动布局复用共享视觉 token，不允许横向溢出。
- 本地检查：`npm test`、`npm run typecheck`、`npm run build`、`npm run test:browser`。浏览器冒烟使用合成 SSO 与真实本地 Worker/D1/R2，覆盖桌面和移动的确认、搜索、profile、timeline、导入成功及错误路径。
- 根 workspace、lockfile 与共享 contract 由集成负责人维护；本应用沿用既有依赖版本，不自行增加包或远程资源 UUID。
