# Health 应用目录与 workspace 命名

- 状态：已合并并发布。命名迁移经 PR #76 合并；前端 Static Assets 迁移 PR #77、切换证据 PR #78、Pages 退役记录 PR #79 均已上线（2026-10-18）。后续绑定清理见 cloudflare-resource-registry.md 顶部证据记录。
- 用户决策：应用目录和包名全面改为 Health，覆盖此前保留 `oura` 应用名的约定。
- 目标：`apps/health/` 为唯一 Health 应用目录；workspace、CI、开发脚本和现行文档使用新名称；Oura 数据提供方协议和已有身份、数据标识保持各自语义。
- 基线：`4c5952f46526799c780aa3973dce38cf11dd7895`；本地和远程 main 一致（2026-10-18 核实）。
- worktree / 分支：`/Users/codepi/.worktrees/kdp.cool/codex/health-naming` / `codex/health-naming`。
- 协调者、唯一写入者、公共契约负责人、集成者：当前 Codex。
- 允许修改：Health 源码目录的移动、workspace 清单与锁文件、CI 路径、检查脚本、相关测试与现行文档。
- 部署迁移另行提交：`/Users/codepi/.worktrees/kdp.cool/codex/health-static-assets` 中已有未提交实现完整保留，基线同上；本次命名提交沿用 main 的 Pages 发布载体。

## 命名与协议边界

| 层次 | 当前名称 |
| --- | --- |
| 应用目录 | `apps/health/` |
| 应用任务包 | `health-kdp` |
| 前端 / API workspace 包 | `@health-kdp/web` / `@health-kdp/api` |
| 配额重试 workflow | `.github/workflows/retry-health-deploy.yml` |
| 开发工具变量 | `HEALTH_BROWSER_*`、`HEALTH_CHECK_*`、`HEALTH_EXPECT_*`、`HEALTH_PREVIOUS_VERSION` |
| Oura 提供方 | 保留 Oura API、OAuth 路径、`OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` / `OURA_REDIRECT_URI`、provider 模块与数据库字段 |
| 已有身份标识 | `AUTH_CLIENT_ID=oura`、会话 Cookie、MCP 授权标识沿用现行协议；目录移动不重置用户、会话或授权 |

不新增依赖、不更改 D1 schema、不搬迁或删除线上数据。历史任务、导入记录和旧设计方案中的路径、包名表示当时的状态；现行开发入口以上述命名为准。

## 验证

- 根目录 `pnpm install --frozen-lockfile` 通过，`pnpm -r list --depth -1` 确认 workspace 包名已切换为 `@health-kdp/web` / `@health-kdp/api`。
- 新增 Agent 回归通过：Git 目录移动同时产生旧路径删除和新路径新增时，`scripts/agent/check.mjs` 定位当前 `apps/health/`，不漏检、不报告未映射路径（`check.test.mjs`、`deploy-workflow.test.mjs`）。
- `node scripts/agent/check.mjs --base 4c5952f46526799c780aa3973dce38cf11dd7895 --run` 选定 23 项本地检查全部通过（含 governance、deploy-workflow、agent check、apps/web 测试与构建、services/auth、Health 正常与 SSO 浏览器回归）。
- 已核验迁移前后资产与业务源码、schema、provider 配置逐字节一致（374 个移动文件仅少量有意文本改动）；现行引用中无旧 workspace 包名或失效目录。
