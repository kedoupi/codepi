# CodePi CLI 开发边界

- `packages/cli/` 是 `@kedoupi/codepi`。命令和退出码是 agent 接口：`0` 成功、`1` 参数、`2` 认证、`3` scope、`4` 远端错误；改动时同步 README、帮助和测试。
- MCP 必须使用官方 `@modelcontextprotocol/sdk` 固定版本 `1.32.1` 的 `Client` / `StreamableHTTPClientTransport`。不要自行实现 JSON-RPC、SSE 或 401 重试解析。
- 运行时只使用 Node 24+ 内置模块和该 SDK；不要新增依赖或额外版本。workspace 注册、根 manifest 和 lockfile 由集成协调者维护。
- 凭证按 server 隔离。目录 `0700`、文件 `0600`；token 只通过临时文件 + `rename` 原子写入。刷新必须持有跨进程锁，取得锁后重新读取并检查有效期，禁止并发重放 refresh token family。
- 不要打印、记录、提交或回传 token、Authorization header、client secret、PKCE verifier 或真实凭证文件。错误信息也要遮蔽敏感值。
- OAuth metadata 的 issuer、授权、token、注册、撤销端点必须与受信任 server 同 origin；只有 loopback 开发服务器可使用 HTTP。回调固定 `127.0.0.1`、随机端口和 `/callback`，严格校验 state。
- `connect` 只输出当前官方客户端配置/命令，不写入配置、不执行安装、不添加桥接器。模板集中在 `src/connect.ts`，更新时核对官方文档。
- `init` 必须先打印内容，只有显式 `--yes` 才写；以 `<!-- codepi:start -->` 保持幂等。其他命令不得修改仓库文件。
- 工作台命令参数以 MCP 工具 schema 为准：`work` → `work_overview`，`tasks` → `task_list`，`project` → `project_get`，`project list` → `work_overview.projects`，`handoff` → `project_handoff_save`。`handoff` 的 `task`、`status`、`summary`、`next` 必填；branch 和 base SHA 能从 Git 推导就带上，推导不出就省略，显式传入的 `--base` 必须是完整 40 位；`--pr` 最多 500 字符，`--request-id` 最多 100 字符。
- `task_list` 的筛选必须在续页时保留；沿 `next_offset` 读取全部页面并携带首屏 64 位 SHA-256 `revision`，各页 revision 必须一致。revision 变化、未推进游标、重复任务必须失败，不得静默返回部分列表。
- 测试使用本地合成数据。必须实际运行 `pnpm build`、`pnpm typecheck`、`pnpm test`；UI、真实 OAuth、生产 MCP 和客户端连接验收不能由本地单测代替。
