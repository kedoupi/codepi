# CodePi CLI

`@kedoupi/codepi` 是 CodePi MCP 的官方命令行客户端。它让任何能执行 shell 的编码 agent 读取工作台（要所有者出手的事、待办、项目卡）、写入任务交接，不新增服务端接口。

## 命令

```bash
codepi login [--scopes context.read,projects.read,projects.write] [--server URL] [--json]
codepi logout [--server URL] [--json]
codepi context [--server URL] [--json]
codepi work [--server URL] [--json]
codepi tasks [--repo PROJECT] [--status S] [--need N] [--include-done] [--server URL] [--json]
codepi project list [--server URL] [--json]
codepi project [--repo PROJECT] [--server URL] [--json]
codepi handoff --task KEY --status STATUS --summary TEXT --next TEXT [options]
codepi connect <tool> [--server URL]
codepi init [--yes] [--json]
```

默认 server 为 `https://mcp.codepi.app`，也可使用 `CODEPI_SERVER` 或 `--server`。默认登录 scope 为 `context.read projects.read projects.write`。

`codepi work` 调 `work_overview`：需要你的事（标出决定 / 到场 / 授权 / 确认和截止日）、
7 天内到期、最近 7 天完成和进行中分支；服务端截短了列表时会提示用 `codepi tasks` 看全部。

`codepi tasks` 调 `task_list`，`--status` 为 `decide`、`doing`、`bug`、`verify`、`idea`，
`--need` 为 `any`、`none`、`decide`、`attend`、`authorize`、`confirm`。CLI 沿 `next_offset`
读取全部页面并带上首屏 64 位 SHA-256 `revision`；revision 变化、游标不推进或任务重复时以
退出码 `4` 失败，不输出部分列表。

`codepi project` 调 `project_get`，输出规则入口、Agent 协作适配段（隔离、提交、验收、合并）、
按状态计数、分支和每个任务最新交接；`codepi project list` 列出各项目的未完成数、需要你数和最近推送。

`PROJECT` 是项目 ID 或 `owner/repo`；不传时读取 `git remote get-url origin`（支持 GitHub SCP、
HTTPS 和 SSH URL）。没有 GitHub 远端的仓库请传 `--repo <项目 ID>`。

`handoff` 要求：

- `--task`：任务键（`codepi tasks` 里的 key）或自由任务 ID。
- `--status`：`in_progress`、`blocked`、`ready_for_review`、`done`。
- `--summary`：本次做了什么；传 `-` 从 stdin 读取。
- `--next`：下一步；`done` 时可说明完成情况。
- `--branch`：默认读取当前 Git 分支，读不到就省略。
- `--base`：完整的 40 位 Git SHA；默认执行 `git merge-base HEAD origin/main`，算不出就省略。

可选参数为 `--blockers`、`--files a,b`（可重复或使用 `--file`）、`--commit`、`--pr`、`--repo` 和 `--request-id`。`--pr` 最多 500 字符；未传 `--request-id` 时自动生成 UUID，手工传入最多 100 字符。最终 `project_handoff_save` 参数包含：

```text
project task status summary next blockers files branch? base_sha? commit pr request_id
```

## 凭证与刷新

配置目录按平台选择：

- `CODEPI_CONFIG_DIR`（显式覆盖，适用于测试或隔离环境）
- Windows：`%APPDATA%\codepi\`
- 其他系统：`$XDG_CONFIG_HOME/codepi/` 或 `~/.config/codepi/`

每个 server 使用独立的 `servers/<digest>.json`，避免环境间互相覆盖。目录为 `0700`，凭证文件为 `0600`；写入使用同目录临时文件、`fsync` 和逐 server `rename`，不会把 token 写进仓库。

跨进程刷新使用逐 server 文件锁。取得锁后重新读取凭证并再次检查有效期，避免两个进程并发轮换同一 refresh token。若另一个进程已经在等待期间完成轮换，当前进程直接采用新凭证让官方 SDK 重试，不再发送新的 token 请求。同一进程内并发 401 刷新共享一次 token 请求、持久化结果和原子保存，后到调用复用已启动的请求，不会重放旧 refresh token。锁内只在确认 PID 已死亡时回收同主机陈旧锁，包括遗留的 reclaim 锁；其他主机的有效锁不会自动抢占。

OAuth 使用动态客户端注册、PKCE S256、随机 `state` 和 `127.0.0.1` 随机端口 `/callback`。注册使用 `http://127.0.0.1/callback`，服务端需允许 loopback 端口变化。授权服务器 metadata、token、注册和撤销端点必须与受信任 server 同 origin，且只允许 HTTPS；仅 loopback 开发服务器允许 HTTP。

MCP transport 使用官方 `@modelcontextprotocol/sdk@1.32.1` 的 `Client` 和 `StreamableHTTPClientTransport`。JSON 与 SSE 响应、initialize 和 401 后的一次重试均由 SDK 处理。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 参数或本地 Git 输入错误 |
| `2` | 未登录、需要重新授权或刷新失败 |
| `3` | 权限不足，需要额外 scope |
| `4` | MCP、网络、服务端或工具错误 |

结果写 stdout，错误写 stderr。`--json` 输出工具的 `structuredContent`；没有结构化内容时输出原始文本（若文本是 JSON，则原样保留）。MCP 工具错误只显示已登记的安全错误代码或通用消息，不回显远端 `text`；其他错误路径也不会输出可能含敏感值的远端文本。

## connect

`connect` 只打印配置或命令，不创建、修改或安装任何客户端配置，也不安装桥接程序。

当前模板按 2026-10-20 官方文档核对：

- [Codex](https://developers.openai.com/codex/mcp)：`~/.codex/config.toml` 原生 Streamable HTTP，或 `codex mcp add codepi --url ...`。
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/mcp)：`claude mcp add --transport http`。
- [Cursor](https://cursor.com/docs/mcp)：`.cursor/mcp.json` 的 `mcpServers.codepi.url`。
- [VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)：`.vscode/mcp.json` 的 `servers.codepi`，`type: "http"`。
- [Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md)：`~/.gemini/settings.json` 的 `mcpServers.codepi.httpUrl`。
- `stdio`：打印 `npx -y mcp-remote <url>`，但不执行。
- `chatgpt`、`claude-app`：打印自定义连接器 URL 和账号/版本限制说明。

支持值：

```text
codex claude-code cursor vscode gemini stdio chatgpt claude-app
```

## init

`init` 查找 Git 根目录的 `AGENTS.md`。它先打印拟追加内容，只有 `--yes` 才写入；没有文件时创建。重复运行以 `<!-- codepi:start -->` 为幂等标记，不会重复追加。

首版未实现 managed block 自动迁移。已有 marker 时，`init` 只报告
`already_initialized` 并显示当前版本块，不会静默覆盖或升级旧内容。需要更新时：

1. 先备份 `AGENTS.md`，并确认 marker 之外的用户内容需要原样保留。
2. 运行 `codepi init`（或 `codepi init --json`）获取当前标准块。
3. 只替换 `<!-- codepi:start -->` 与 `<!-- codepi:end -->` 之间的内容，不删除或改写 marker 之外的内容。
4. 运行 `git diff -- AGENTS.md`，确认改动范围和交接授权说明符合预期。

写入的块明确要求：MCP/CLI 不可用时继续本地工作；远程交接仅在用户授权后执行。

`init` 是唯一会主动修改仓库文件的命令；`connect`、登录和 MCP 调用都只读写用户配置目录。

## 开发与测试

需要 Node.js 24+。从仓库根执行 `pnpm install` 后：

```bash
cd packages/cli
pnpm build
pnpm typecheck
pnpm test
```

`pnpm test` 自行构建并运行 `node:test`。测试只使用合成凭证和本地 HTTP 服务器，覆盖：

- 多进程真实刷新竞争、锁内重读和 refresh token 轮换；
- 全链路合成登录：DCR、PKCE、随机 loopback 端口、state 校验和 token 落盘；
- loopback 回调 state 拒绝、DCR 请求和 metadata origin；
- 官方 MCP SDK 的 JSON/SSE 响应、401 单次重试、403 scope 和工具错误映射；
- `task_list` 的 `revision` 一致性、`next_offset` 全量续页、重复任务与不推进游标拒绝；
- `work`、`tasks`、`project`、`project list` 的文本渲染与参数校验，无远端仓库的交接；
- Git remote 解析、凭证权限/隔离、`init` 幂等和 CLI 端到端。

真实登录、生产 MCP 和客户端连接仍需用户现场验收。
