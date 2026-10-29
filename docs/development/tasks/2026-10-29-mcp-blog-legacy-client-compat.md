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

- MCP `blog_submit` 增加 `prepare` 钩子：请求同时缺少 `tags` 与 `category` 时判定为旧 schema
  调用，`tags` 由旧 `tag` 派生，头图与分类不再强制；给出任一分类字段的当前客户端仍按已发布
  required 列表校验。显式 `null` 的分类/标签按“客户端填不出”处理并留给审核补齐。
- 领域层：没有 `cover_media_id` 时头图取正文第一张内联图片，全文无图仍报 `cover_required`；
  分类缺省写 `null` 并在 warnings 中提示审核时补齐；旧 `tag` 仍派生 `tags`，显式空数组仍按
  1–5 个标签的既有规则拒绝。
- 授权：PAT 与登录授权一致签发全量 scope，签发前留下的窄权限令牌在读取时按全量处理；
  旧 SSE 会话在 grant 仍覆盖绑定 scope 时继续可用（scope 被收窄仍 403）。
- 诊断：MCP 错误在 code 之外回传缺失的 scope；CLI 只在安全白名单内回传 `field`/`reason`，
  并在 403 时点名缺少的 scope（如 `blog.write`）。未知字段名仍只回报父路径，不回显客户端输入键名。

## 本地验证

- `services/mcp` 70/70（逐文件串行）、`apps/web` 53/53、`packages/cli` 57/57 通过；MCP typecheck/build、
  CLI typecheck/build、Web `typecheck:desk`/build/`test:assets`、MCP 浏览器验收通过。
- 新增回归用例：旧 schema 客户端仍能提交（标签由 `tag` 派生、头图取正文首图、分类留空并告警）、
  无图文章仍报 `cover_required`、当前客户端缺必填仍按字段路径拒绝、旧 SSE 会话在 scope 升级后可用、
  旧 PAT 仍能调用新工具、CLI 回传字段诊断并点名缺失 scope。
- MCP 一次并行全量重跑出现 Miniflare `SocketError`（`metadata-flow`），单文件串行重跑通过，
  与上一轮记录的并发抖动一致，不计为失败证据。
- 未部署、未 push、未改生产数据；生产 Blog 端到端只在发布后由所有者用真实客户端验收。

## 待所有者确认与后续

- ChatGPT 连接器刷新或重连 MCP schema 后会看到新 schema；即使不刷新，旧 schema 调用现在也能提交。
- PAT 权限口径由“逐项勾选”改为“与登录一致的全量 scope”，属于权限口径调整，需要收缩时撤销令牌。
- 合并后需要重新发布 `codepi-mcp` 与 `codepi-www`（MCP 校验与领域头图回退各一处），
  发布流程见 `docs/development/local-release.md`。
