# CodePi CLI 开发边界

- `packages/cli/` 是 `@kedoupi/codepi`。命令和退出码是 agent 接口：`0` 成功、`1` 参数、`2` 认证、`3` scope、`4` 远端错误；改动时同步 README、帮助和测试。
- MCP 必须使用官方 `@modelcontextprotocol/sdk` 固定版本 `1.32.1` 的 `Client` / `StreamableHTTPClientTransport`。不要自行实现 JSON-RPC、SSE 或 401 重试解析。
- 运行时只使用 Node 24+ 内置模块和该 SDK；不要新增依赖或额外版本。workspace 注册、根 manifest 和 lockfile 由集成协调者维护。
- 凭证按 server 隔离。目录 `0700`、文件 `0600`；token 只通过临时文件 + `rename` 原子写入。刷新必须持有跨进程锁，取得锁后重新读取并检查有效期，禁止并发重放 refresh token family。
- 不要打印、记录、提交或回传 token、Authorization header、client secret、PKCE verifier 或真实凭证文件。错误信息也要遮蔽敏感值。
- OAuth metadata 的 issuer、授权、token、注册、撤销端点必须与受信任 server 同 origin；只有 loopback 开发服务器可使用 HTTP。回调固定 `127.0.0.1`、随机端口和 `/callback`，严格校验 state。
- `connect` 只输出当前官方客户端配置/命令，不写入配置、不执行安装、不添加桥接器。模板集中在 `src/connect.ts`，更新时核对官方文档。
- `init` 必须先打印内容，只有显式 `--yes` 才写；以 `<!-- codepi:start -->` 保持幂等。其他命令不得修改仓库文件。
- 项目/交接命令参数以 MCP 工具 schema 为准；`project_get` 的 `--cursor`、`--task-id`、`--handoffs` 直接透传。`handoff` 的 `task`、`status`、`summary`、`next` 必填，branch 和完整 40 位 base SHA 从 Git 推导时失败要给出可操作的参数错误；`--pr` 最多 500 字符，`--request-id` 最多 100 字符。
- `projects_list` 的 `--status` 筛选必须在续页时保留；沿 `next_offset` 读取全部页面并携带首屏 64 位 SHA-256 `revision`，各页 revision 必须一致。续页缺失或变化、未推进/重复游标、重复项目必须失败，不得静默返回部分列表。
- `project_get` 的 `project_card_json_v1` 分页必须在内存中沿 `next_cursor` 读取、校验字节数并拼接完整 JSON 后才可输出；保持相同的 `project`、`handoffs`、`task_id`，限制页数与总字节。`cursor_stale`、游标重复或不完整 JSON 必须报错并要求重启，不得打印半张卡片。
- 测试使用本地合成数据。必须实际运行 `pnpm build`、`pnpm typecheck`、`pnpm test`；UI、真实 OAuth、生产 MCP 和客户端连接验收不能由本地单测代替。
