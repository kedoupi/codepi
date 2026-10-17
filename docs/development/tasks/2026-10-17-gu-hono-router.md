# GU 后端 Hono 迁移

- 状态：实现、本地验证、独立审查、PR CI、合并、自动生产发布及匿名线上核验完成；真实账号 E2E 未执行。
- 目标与验收：用 Hono 组织 GU 路由和中间件，保持接口、鉴权顺序、响应格式、Cookie、安全响应头与静态资源边界；完成受影响检查和独立审查。
- 不在范围内：Svelte 前端、业务规则、D1 schema、共享认证协议、Pages 部署载体、其他应用路由。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/gu-hono-router`
- 分支：`codex/gu-hono-router`
- 起始 SHA / 审查基线：`8229faa41761d41027b2c420663704085990ec02`，开工时本地工作区干净，远程 main 经 `git ls-remote` 核对相同。
- 当前代码交付：PR #59 head `b510e9d07e23c730a1c39d34c7f35ecd5cc6f93c`，squash 合并为 `ffe762e60b79efe1a76de704628ece5af93c6505`；两个提交的完整 Git tree 一致。
- 发布证据 worktree / 分支：`/Users/codepi/.worktrees/kdp.cool/codex/gu-hono-release-evidence` / `codex/gu-hono-release-evidence`，基线为上述合并 SHA，仅回填本文和资源登记表。
- 协调者 / 实施者 / 集成者：本任务 Codex；审查者 Hypatia 为独立 Codex subagent，只读同一冻结工作区，无写入权限。
- 唯一分配记录：本文，由本任务 Codex 维护。
- 允许写入：`apps/gu/`、`pnpm-lock.yaml`、架构文档和本文；共享文件仅本任务写入，无并行代码写入者。
- 相关设计：[工程架构与部署模型](../../architecture/workspace-and-deployment.md)。

## 实现

- `worker/app.ts` 使用 Hono，复用原有 auth、data、calendar、desk-summary 处理函数；`worker/index.ts` 负责 Worker 入口、统一安全响应头和外层异常兜底。
- 内部 Desk 摘要保持独立传输 / 方法 / token 检查；两个 PUT 上传入口继续使用上传令牌，不受浏览器 Origin / Cookie 鉴权替代。
- 浏览器写操作先验证 Origin；私有 API 包括未知接口先验证会话再返回 404。
- 保留原始 `URL.pathname` 匹配；GET API 不因 Hono 的 HEAD 分发而触发登录或回调。
- 依赖沿用 GZH 的 `hono: ^4.9.8` 范围，解析为已有锁定版本 `4.13.13`；没有升级其他应用依赖。
- 前端、共享契约、数据库迁移、Cloudflare 配置均无改动。

## 验证证据

- 迁移前先在旧入口运行 `pnpm exec vitest run test/routing.test.ts`：34 项通过，固定既有路由行为。
- 迁移后 `pnpm exec vitest run test/routing.test.ts test/sso.test.ts`：45 项通过；包含 SSO HEAD 不创建 / 消费 transaction 的补充用例。
- GU `pnpm run typecheck`：通过。
- 全仓 `node scripts/agent/check.mjs --base 8229faa41761d41027b2c420663704085990ec02 --run`：23 项全部通过。GU 204 项测试、75 项脚本测试、类型检查、构建和部署配置检查通过；web/auth/GZH/Health 的测试与构建、Health 普通与 SSO 浏览器回归、shared auth 10 项、治理 36 项和工作流 22 项均通过。
- Hypatia 独立审查无阻塞发现；冻结快照（按路径排序的 `path + NUL + content + NUL`）SHA256：`7be4dea858dfe1748a1362e29f21478a86e49384f0c7648bd63e08505a4e18de`。审查完成后仅回填本文验证记录。
- 审查者独立复跑 routing + SSO 45 项，并在内存合成绑定上比较新旧实现的 64,350 个组合，状态码、响应头、Cookie、非 HEAD 响应体和调用顺序无差异。HEAD 响应体按 HTTP 语义不参与比较。
- 同构建选项下，Worker 未压缩 bundle 从 51,624 字节增至 108,362 字节；前端资源无改动。
- commit / push / PR / 合并 / 部署 / 匿名线上验收：已完成，见当前代码交付和下方发布记录。
- 真实邮件登录和登录后私人数据验收不在 synthetic 测试覆盖范围内。

## 继续工作

1. 独立进行 GU Svelte 前端迁移，保持界面、业务展示和金额 / 时间语义，供用户对照验收。
2. 真实邮件登录、登录后私人数据及 Oura / MCP 完整授权流程仍需另行验收。

## PR 与自动发布

- PR #59 的两个 head workflows 均为 `completed/success`：
  - 平台 CI：`38991211439`。
  - SSO/GU 专项：`38991211430`。
- 合并前重新核对远程 main 仍为基线 `8229faa`、PR head 仍为 `b510e9d`；合并 API 使用完整 expected head SHA，避免合入未审查的新提交。
- main 自动发布 run：`38991512923`，source SHA 为 `ffe762e60b79efe1a76de704628ece5af93c6505`，`completed/success`；2026-10-17 上海时间 09:40:14 完成。
- 根锁文件变更触发全部产品发布。发布前四个 Pages 仍对应干净的 `158484cc16a78c779afc11fb8a6af24362f499de`，Auth / Health Worker 部署与上一轮记录一致。

## 生产版本与线上核验（2026-10-17）

Cloudflare API 核对四个 Pages canonical deployment：均为 production、success、完整 source SHA `ffe762e60b79efe1a76de704628ece5af93c6505` 且 `commit_dirty=false`。

| Pages 项目 | deployment ID |
| --- | --- |
| `codepi-www` | `7745cfc8-bbe5-4ae0-b465-691945b42cde` |
| `codepi-gu` | `8db7b16a-9cd4-461a-a659-bc07948cd0e0` |
| `codepi-gzh` | `6a5036e9-b924-4d16-a493-fc7be4961488` |
| `codepi-health` | `0d12e2fc-6e36-456e-b8a7-810eedb19be2` |

| Worker | deployment ID | version ID | 流量 |
| --- | --- | --- | --- |
| `codepi-auth` | `6d7d3c26-05b0-4590-9700-c2126c0b69ca` | `031de12d-a44d-474f-9939-4613da892c68` | 100% |
| `codepi-health-api` | `87eed08f-6a39-4664-801c-37943d599d2f` | `6559d1b8-0cc1-4160-b00e-43ab5356a461` | 100% |

- 在与发布版本完整 Git tree 一致的本地构建上执行 GU `npm run check:deploy -- --url https://gu.codepi.app`：config / health / auth 全部通过，2 个线上 JS/CSS 资源逐字节匹配；`index_sha256=d6cd25a8714f77ef0ca07405fd27f47ed3973b532cf3a81c2d78026ec6a77a6f`。
- GU 另执行 10 项无凭证 HTTP 探测：HEAD health / login / callback 为 401、HEAD 内部摘要为 405、OPTIONS health 为 401、尾斜杠与编码 health 为 401、裸 `/api` / 编码 API 前缀 / 私有 JSON 静态路径为 404；均保留安全响应头，无重定向和 Set-Cookie，HEAD 响应体为空。
- `node scripts/cloudflare/check-pages.mjs <web|gu|gzh> production` 三项通过；Auth `/api/health` 返回 200、`ok=true`、`mailConfigured=true`。配置就绪不等于真实投递成功。
- `OURA_EXPECT_BUILD=ffe762e60b79 OURA_EXPECT_SSO_ENABLED=true node apps/oura/scripts/check-api.mjs`：16 项全部通过，包含网站 SSO、Oura 未登录拒绝、私人数据拒绝、MCP 和 OAuth discovery；Health `/api/health` 返回 `build=ffe762e60b79`。
- 以上为匿名运行时及合成回归证据，不代表已验收真实邮件、账号登录 / 退出、私人数据读取、Oura 提供方授权或真实 MCP 客户端授权。
- 发布证据文档的 `node scripts/agent/check.mjs --base ffe762e60b79efe1a76de704628ece5af93c6505 --run`：3 项通过，包含 36 项治理测试、治理验证和 22 项工作流测试。
