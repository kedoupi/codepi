# GU 后端 Hono 迁移

- 状态：实现、本地验证和独立审查完成，待 PR CI、合并与发布。
- 目标与验收：用 Hono 组织 GU 路由和中间件，保持接口、鉴权顺序、响应格式、Cookie、安全响应头与静态资源边界；完成受影响检查和独立审查。
- 不在范围内：Svelte 前端、业务规则、D1 schema、共享认证协议、Pages 部署载体、其他应用路由。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/gu-hono-router`
- 分支：`codex/gu-hono-router`
- 起始 SHA / 审查基线：`8229faa41761d41027b2c420663704085990ec02`，开工时本地工作区干净，远程 main 经 `git ls-remote` 核对相同。
- 当前交付：未提交工作区。
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
- commit / push / PR / 合并 / 部署 / 线上验收：未执行。
- 真实邮件登录和登录后私人数据验收不在 synthetic 测试覆盖范围内。

## 继续工作

1. 按已有授权完成 PR 流程；CI 通过后再合并和核验自动发布。根锁文件变更会触发全部产品重新发布。
2. 发布前通过 Cloudflare API 核对四个 Pages 仍对应干净的 `158484cc16a78c779afc11fb8a6af24362f499de`，Auth / Health Worker 部署与上一轮记录一致；本轮发布后须重新核验。
3. 本轮完成后独立进行 GU Svelte 前端迁移。
