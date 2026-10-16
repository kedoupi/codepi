# Workspace 发布链修复

- 状态：已完成。PR #47 已 squash 合并为 `68b11a3`，main 自动发布链执行完成，
  受影响应用（auth/web/gu/gzh）已上线；GU 与 Desk 的客户端 secret 恢复为后续独立任务。
- 目标：使统一 workspace 的 CI 和 main 自动发布可运行，校正迁移后过期的工程规则。
- 范围：workflow、检查映射、Health typecheck 范围、当前架构与开发文档；不迁移产品技术栈或业务数据。
- worktree：`~/.worktrees/kdp.cool/codex/release-workspace-fixes`。
- 分支：`codex/release-workspace-fixes`。
- 基线：`eed8219409e54529b5750f6347c4f8232354a4e3`（PR #46）。
- 协调者、唯一写入者、共享契约与集成负责人：父会话。
- 独立审查者：Banach，只读本 worktree 的 workflow / workspace / 检查映射，不执行远程操作。
- 授权：用户已允许推进、推送、通过 API 配置和集成；不由本文扩大到凭证读取、数据删除或改变仓库可见性。

## 根因与修复

GitHub run `38883652043` 在依赖安装前失败，所有部署 job 均跳过：

1. `working-directory: $GITHUB_WORKSPACE` 被 Actions 当作字面目录。改为 context 表达式。
2. Health 的 pnpm/action-setup `version: 9` 与根 `packageManager: pnpm@9.15.9`
   冲突，cache 仍引用已删除的嵌套 lockfile。统一从根 manifest 与 lockfile 读取。
3. Health Pages 发布证据脚本的相对路径少一级，已按实际工作目录修正。
4. 根 workspace 文件遗漏 CI 触发与本地检查映射，已覆盖全部消费者。
5. Health `pnpm -r typecheck` 在根 workspace 下扩散到其他应用，改为两个 Health 包。
6. 独立审查发现跨 run 发布交错风险。增加整条生产 workflow 并发锁、过期 SHA 检查；
   affected 从最近成功的 main push release 计算，覆盖失败或被合并队列替换的提交。
   复核补齐所有 main push（含文档）触发、按各提交触及路径而非净 diff 判断；
   fixture 覆盖文档提交接管发布和部分发布失败后的完整 revert。
   同一队列中的单应用 dispatch 也接管积压范围，避免替换 pending push 后漏发。
7. 当前文档、skill、资源登记路径仍有旧结构或强制 staging 描述，已校正；
   保留历史记录，不将保留的 staging 配置标成已启用环境。

## 验证证据

- 新 worktree 执行 `pnpm install --frozen-lockfile`：9 个 workspace 项目安装成功。
- `node scripts/agent/check.mjs --base eed8219 --run`：23 项本地检查全部通过，
  包括五应用测试、类型检查、构建、shared auth 10 项与 Health 正常 / SSO 浏览器回归。
- 并发修复后补跑 workflow 与 Agent 回归：28 项通过；静态治理、YAML 解析、当前入口
  文档的相对链接检查与 `git diff --check` 均通过。
- 上述是本地证据，不能证明生产已发布或真实 OTP/OAuth 全流程已验收。

## 2026-10-16 线上核验

控制面和日志只提取状态、部署标识及缺失配置名称，不读取或输出凭证值。

| 对象 | 实测结果 |
| --- | --- |
| Auth `/api/health` | 200 JSON，mailConfigured=true |
| Web 公开首页 | 200 |
| Web `/api/desk/me` | 503；runtime 日志明确缺少 AUTH_CLIENT_SECRET，不能据首页 200 宣称 Desk 正常 |
| GU 首页与 `/api/me` | 503 auth_not_configured；runtime 日志明确缺少 AUTH_CLIENT_SECRET |
| GZH | 根 302、匿名私有 API 401、同环境 PKCE 登录跳转通过 |
| Health | 16 项 API/MCP/OAuth discovery probes 通过；build 仍为 local，未绑定本次 source SHA |

GU 应急 API 操作：当前部署 `065f85b0-9f97-472d-b50d-6a9a1c73b658`
（reported source `eed8219`）回退至 `aa7ca213-8b93-4e83-87ae-e0c7a0d80ece`
（reported source `cb4339a`）后仍返回 503。已通过 API 恢复原 `065f85b0` 部署。
事前核对 Worker 仅有导入路径变化、migration 内容相同；未改数据、secret 或认证行为。
此次回退不作为发布成功证据，后续修复须回到 Actions。

## 2026-10-16 PR #47 合并与生产发布

- 审查：独立 reviewer（Banach）对最终 SHA `b56a77e` 放行，无阻塞项。
- CI：PR head `b56a77e` 上 `Validate SSO and GU` 与 `Deploy platform` 全部成功，
  PR run 的 deploy jobs 按预期 skipped。
- 合并：squash merge SHA `68b11a3e4772621020616aa5926443ad1eef0c73`。
- 生产发布（Cloudflare 控制面实测，UTC 2026-10-16 10:41 前后）：
  - Auth Worker deployment `4ee360fd-0e01-4590-abbf-21f73488e4a4`，version `e7b39c76`。
  - codepi-www deployment `f53ff666`，commit `68b11a3e4`。
  - codepi-gu deployment `55020e39`，commit `68b11a3e4`。
  - codepi-gzh deployment `5029593b`，commit `68b11a3e4`。
  - Health API / Pages 本次无 `apps/oura/**` 改动，按 affected 规则未重发，保持 10-15 版本。
- 发布后 smoke：`auth /api/health` 200、`codepi.app` 200、`gzh` 检查通过、
  `health` 200；`web/gu` 的 private endpoint 仍为 503，即已知的 AUTH_CLIENT_SECRET 失效，
  不属于本次发布回归。
- 清理：worktree 与 `codex/release-workspace-fixes`、`codex/simplify-deploy`、
  `codex/workspace-migration` 三个分支已删除（内容经 squash 全部包含于 main）。

## 待处理

- GU 缺失的客户端凭证必须与中央 Auth 注册保持一致；secret 名存在不等于 runtime 值可用。
  回退未恢复它，不能用空字符串或任意新值掩盖配置问题。
- Desk 同样缺少 AUTH_CLIENT_SECRET，需要与中央 Auth 的 desk 注册同步恢复。
- GitHub CLI 凭证失效；连接器可读取 CI、创建/合并 PR，但不提供仓库管理权限。
- GitHub rulesets API 返回 403，要求私有仓库升级 Pro 或公开。保留私有仓库，
  分支强制规则与 Environment 控制面不能标记为完成。
- staging 不参与本次发布；不启用其 Auth、Access 或长期分支。
- Svelte/Hono 技术栈统一与共享包 exports 仍是后续独立迁移。
