# MCP Agent 接入兼容

- 状态：PR #195 已合并，MCP 已发布；生产观察 `healthy_reported`（2026-10-25T16:16:24Z，3 个事件，无回滚），真实客户端验收仍待所有者。
- 目标：补齐 OAuth 差异兼容、PAT、手动客户端注册、Client ID Metadata Document、旧版 HTTP+SSE 和 Agent 可直接读取的分页。
- worktree / 分支：`~/.worktrees/codepi/codex/mcp-agent-compat` / `codex/mcp-agent-compat`。
- 起始 SHA：`81553b8fa993ab5afee8b95d19b1ab5c84caaf4e`；保留此前同任务未提交修改。
- 接口所有者 / 集成者：主会话。写入边界：主会话负责 MCP 其余实现、迁移、配置、文档与回归；元数据子任务仅 `src/client-metadata.ts`、`test/client-metadata.test.mjs`；SSE 子任务仅 `src/legacy-sse.ts`、`test/legacy-sse.test.mjs`。均在同一任务 worktree，文件集合不重叠。
- 不在范围：不修改业务数据、SSO 配对凭证，不新增依赖，不把兼容探针当真实客户端验收。

## 接口与实施顺序

1. MCP D1 追加 client auth/refresh rotation 字段、独立 PAT hash 表；旧迁移保持不变。
2. PAT 由 owner 网站会话、同源及 CSRF 创建/撤销，权限显式选择、默认只读，7/30/90 天有效，仅创建响应显示原值。OAuth 仍保持已批准的全量 scope 策略。
3. 手动客户端注册与 DCR 共用客户端表、PKCE 校验；元数据客户端按 HTTPS 文档校验，不能把 URL 当已授权连接。
4. 旧 SSE 使用 Durable Object 维护短期连接；每个 POST 重新校验 token 与连接主体，不能把 sessionId 当凭证。发布须新增 DO binding/migration，不能按无 binding 变更声明回滚安全。
5. `read_document` 在内存有界拼接原 RPC 分片，输出完整字段/数组条目/文本区间；保留原分页协议与 CLI，不持久化业务快照。
6. 本地真实 Workerd/RPC、SDK Streamable HTTP/SSE、PAT/元数据授权及浏览器桌面手机流程；审查整体 diff 后交付。

## 验证

- 前一阶段：8 项受影响检查通过，MCP 46 项测试、typecheck/build、浏览器授权/撤销通过；9 项新测试在旧实现失败。
- 本阶段定向：PAT（含 20 个上限）、手动注册、元数据授权全流程、`read_document` Unicode/覆盖/digest、PAT+SSE 撤销均通过。
- 2026-10-25 受影响检查 10/10 通过：Cloudflare 脚本、治理校验、agent lint、迁移守卫、MCP 63 项测试、typecheck、build、浏览器验收。治理校验尚不覆盖 Durable Object，binding 由发布控制面单独核对。
- 未执行：真实 Manus/Claude/ChatGPT/IDE 的客户端验收。

## 2026-10-25 发布

- 用户授权“提交部署吧”；实现提交 `f182e6e` 经 [PR #195](https://github.com/kedoupi/codepi/pull/195) 合入 main `f6fb328aef50b46338903dfc579997649f25c49a`。合并后的树与本地验证树一致；GitHub 4 项检查通过、8 项跳过。
- 主会话在本机持 production release lock，从干净且等于远程 main 的源码执行标准 MCP deploy；仅 MCP 自上次 source `7d0c81416a61` 后有运行时差异。
- previous `dead5910-935a-4c0c-8cc4-1b25d7cf5fd2` → new `78e3b6e7-419d-4a6e-a6c3-64b1b9cdbc04`，100% 承流；`BUILD_SHA=f6fb328aef50`。
- D1 `73c6ef4e-e2a0-41c2-9bce-ab41c7391caa` 应用 `0002_client_auth.sql`、`0003_personal_tokens.sql`，复查无待应用迁移；冻结两文件 SHA-256。
- 新增 `LEGACY_SSE → LegacySse`，namespace `63bd0761417044169d4e8b9be97ee4c7`，migration `legacy-sse-v1`。没有轮换 secret 或改变其他 Worker。
- 线上 smoke：Auth 配对、精确 build、两种发现、匿名 MCP 401、连接管理登录保护通过；匿名 `/sse` 401、未知 SSE session 404，PAT/手动注册管理页均 302 登录。
- Observer `release-f6fb328aef50-mcp195`，instance `cf_5ebca0db28e8cc4089444184413e0362666bf60ccc07737900e615b145caa39e`；首轮 healthy。明确 `migration_applied=true`、`binding_changed=true`、其余副作用 false，推导 `rollback_allowed=false`。R2 `reports/observer/release-f6fb328aef50-mcp195/summary.json` 最终状态 `healthy_reported`，完成于 2026-10-25T16:16:24.510Z，`rollback=null`。
