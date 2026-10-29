# 2026-10-29 MCP Blog 旧客户端与授权兼容

## 根因与范围

ChatGPT 通过 MCP 提交 Blog 一直失败。生产实测确认：连接器缓存的是 2026-10-22（#152）第一版
`blog_submit` schema —— 只有单个自由文本 `tag`，没有 `cover_media_id`、`category`、`tags`；
2026-10-27 之后服务端把三者列为必填，于是旧客户端在 schema 校验阶段就被挡在
`/cover_media_id` → `/category` → `/tags`，根本到不了领域层。领域层其实已有 `tag`→`tags`
兼容（`apps/web/server/blog.ts`），但被 MCP schema 校验挡在前面，不可达。

授权侧另有三处只对新连接成立、对旧连接不成立：

- OAuth：服务端固定授予全量 scope，refresh 时把旧的部分授权升级为全量（既有测试覆盖）。
- 个人访问令牌（PAT）：scope 原样存储、原样使用，没有升级路径；签发表单默认只勾选 `.read`，
  早于 `blog.write` 存在的令牌永远拿不到 Blog 写权限。
- 旧 SSE 会话：会话按 scope 字符串全等绑定，refresh 升级 scope 后，已打开的流立刻
  `session_grant_mismatch` 403。

本轮把“旧连接”与“新连接”收敛到同一份契约，不改动已发布 schema 的必填项、不放宽内容与
图片校验，也不提交或修改真实稿件。

## 实现

- MCP `blog_submit` 增加 `prepare` 钩子：请求缺少 `tags` 且仍带旧 `tag`（或同时缺 `category`）时
  判定为旧 schema 调用，`tags` 由旧 `tag` 派生，头图与分类不再强制；已带 `category` 但仍用旧
  `tag` 的混合形态同样被服务。给出新 `tags` 列表的当前客户端仍按已发布 required 列表校验。
  显式 `null` 的分类/标签按“客户端填不出”处理并留给审核补齐。
- 领域层：没有 `cover_media_id` 时头图取正文第一张内联图片，全文无图仍报 `cover_required`；
  分类缺省写 `null` 并在 warnings 中提示审核时补齐；旧 `tag` 仍派生 `tags`，显式空数组仍按
  1–5 个标签的既有规则拒绝。
- 授权：PAT 与登录授权一致签发全量 scope，签发前留下的窄权限令牌在读取时按全量处理；
  旧 SSE 会话在 grant 仍覆盖绑定 scope 时继续可用（scope 被收窄仍 403）。
- 诊断：MCP 错误在 code 之外回传缺失的 scope；CLI 只在安全白名单内回传 `field`/`reason`，
  并在 403 时点名缺少的 scope（如 `blog.write`）。未知字段名仍只回报父路径，不回显客户端输入键名。

## 本地验证

- `services/mcp` 70/70（13 个测试文件逐个串行，合计 70 例）、`apps/web` 53/53、`packages/cli` 57/57 通过；MCP typecheck/build、
  CLI typecheck/build、Web `typecheck:desk`/build/`test:assets`、MCP 浏览器验收通过。
- 新增回归用例：旧 schema 客户端仍能提交（标签由 `tag` 派生、头图取正文首图、分类留空并告警）、
  旧客户端同时带 `category` 的混合形态仍能提交、无图文章仍报 `cover_required`、当前客户端缺必填
  仍按字段路径拒绝、旧 SSE 会话在 scope 升级后可用、旧 PAT 仍能调用新工具、CLI 回传字段诊断并点名缺失 scope。
- MCP 一次并行全量重跑出现 Miniflare `SocketError`（`metadata-flow`），单文件串行重跑通过，
  与上一轮记录的并发抖动一致，不计为失败证据。
- 2026-10-29 生产联调（修复未部署，生产仍为旧行为）：在已发布的 MCP 上实测三种旧形态
  均按预期被 schema 拦截——tag-only → `/cover_media_id required`、tag+cover →
  `/category required`、tag+cover+category → `/tags required`，证实根因判断；新契约路径
  实测可用（`blog_upload_image` → `blog_submit` `is_test:true` → `blog_retract`，头图比例
  校验正常给出 warning，测试稿件已全部撤回，未留生产稿件）。
- 观测到一次 `unknown_media`：upload 成功后立即 submit 报媒体不存在，而 D1 主库直查该行
  存在；随后多轮同路径探测（含 SDK 直连）均未复现。判定为疑似读后写时序/副本一致性问题，
  **未证实、未改动**，需要可复现路径后再处理。
- 新增 SDK 级回归：connector 测试用 `@modelcontextprotocol/sdk` 的
  `StreamableHTTPClientTransport` 走真实 HTTP 提交旧 schema，防止协议层差异漏测。
- `services/mcp` 并行全量重跑仍有 Miniflare flake（本轮落在 `personal-tokens.test.mjs` 的
  `fetch failed / ECONNRESET`，历史上也抖在 `metadata-flow`）；逐文件串行 70/70 全绿。
  属独立测试基础设施问题，另行跟踪。
- 读后写异常追查：用官方 SDK 直连生产连续 10 轮「upload → 立即 submit → retract」全部成功
  （0 失败），此前的单次 `unknown_media` 未复现，因此不加防御性重试或 session 固化，保持观察。
  探针产生的测试稿件（含上一轮遗留的 3 条 pending）已全部 retract，审核队列恢复为空。
- 并行 flake 追查：本机 `node --test test/*.test.mjs` 连续 6 轮全绿（70/70），最终
  `scripts/agent/check.mjs --run` 的 `pnpm test` 也通过。未复现即不改并发设置，避免为一次
  未定位的抖动拖慢 CI；若 CI 再次出现，保留失败日志（文件、错误、并发负载）再定位。
- 上述保守结论随后被发布门禁推翻：干净 main 上连续两次 `pnpm test` 分别随机失败于
  `legacy-sse`、`metadata-flow` + `personal-tokens`，均为 Miniflare `ECONNRESET`，隔离重跑全过。
  因重复复现且随机换文件，将 `pnpm test` 固定为 `--test-concurrency=1`：覆盖仍为同一组 70 例，
  只串行启动 workerd，避免继续用随机重跑充当发布证据。
- 最终验证：`node scripts/agent/check.mjs --base c7217a1 --run` 全部通过（agent 检查 35/35、
  lint、Web 53/53 + typecheck/build/assets、MCP 70/70 + typecheck/build + 浏览器验收、
  CLI 57/57 + typecheck/build）。
- 未部署、未 push。

## 待所有者确认与后续

- ChatGPT 连接器刷新或重连 MCP schema 后会看到新 schema；即使不刷新，旧 schema 调用现在也能提交。
- PAT 权限口径由“逐项勾选”改为“与登录一致的全量 scope”，属于权限口径调整，需要收缩时撤销令牌。
- 合并后需要重新发布 `codepi-mcp` 与 `codepi-www`（MCP 校验与领域头图回退各一处），
  发布流程见 `docs/development/local-release.md`。
