# MCP Agent 接入兼容

- 状态：本地实现与验证中；未提交、未部署。
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
- 2026-10-25 受影响检查 10/10 通过：Cloudflare 脚本、治理校验、agent lint、迁移守卫、MCP 63 项测试、typecheck、build、浏览器验收。治理校验尚不覆盖 Durable Object，`LegacySse` 仍是登记表中的 planned 项。
- 未执行：生产迁移/部署、真实 Manus/Claude/ChatGPT/IDE 的客户端验收。
