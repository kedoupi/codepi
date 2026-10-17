# GU 运行配置重建与发布前置条件修正

- 状态：本地验证与独立审查通过，云端核心凭证已重建，新 Worker 匿名与资产验收通过；待合并新版发布门禁和切换域名。
- 用户决策：项目仍在重构，旧测试数据、登录态和旧实现不作为新架构必须兼容的条件；按最终方案重建。此前已有 API 操作、PR 集成和发布授权继续适用。
- 目标：解除 GU Static Assets 迁移对旧密钥原值、手动 GitHub 开关和手填账户子域的依赖，保留实际运行配置检查与新 Worker 探针。
- worktree：`/Users/codepi/.worktrees/kdp.cool/codex/gu-runtime-bootstrap`；分支：`codex/gu-runtime-bootstrap`。
- 起始 SHA：`33207cd5c2bedd3ce4ddde227499a6f176f4d3c2`，主工作区干净；旧迁移 worktree 保留。
- 协调者 / 唯一写入者 / 集成者：当前 Codex。独立审查者 Feynman（`01a149c2-b17e-7133-bbeb-4e2c0b50077b`）只读冻结的 9 文件快照，审查前后文件哈希一致。
- 允许修改：`.github/workflows/deploy-platform.yml`、`scripts/cloudflare/`、相关架构/治理/迁移记录；不改业务 API、数据 schema 或第三方授权。
- 前序：[GU Static Assets 迁移](2026-10-17-gu-static-assets.md)、[已有客户端独立轮换能力](2026-10-16-client-secret-rotation.md)。

## 根因与方案

- 旧方案假定必须把 Pages 的全部 secret 同值搬到 Worker，因此把任务交还用户手动输入。实际上 Auth 已支持 `SSO_CLIENT_SECRET_GU` 独立轮换，可在 API 执行环境生成随机值并配对写入中央 Auth 与新 GU Worker；不需要读取旧值。
- GU 生产配置为 `SSO_ENABLED=1`，`SESSION_SECRET`、`OTP_PEPPER` 仅服务旧 OTP 分支，不是生产 SSO 的前置条件。
- 新发布门禁读取 Cloudflare secret 名称、Worker `workers.dev` 开关和账户子域；必要配置缺失仍失败。移除人工 `GU_SECRETS_BOOTSTRAPPED` 声明与 `WORKERS_DEV_SUBDOMAIN` 变量。
- 生产核心凭证为 `AUTH_CLIENT_SECRET` 和 `DESK_SUMMARY_TOKEN`。前者与中央 Auth 配对；后者与首页 `GU_SUMMARY_TOKEN` 配对。名称检查只证明绑定存在，不证明值配对正确，仍需独立认证调用验收。
- 外部上传 `UPLOAD_TOKEN` 和固定日历 `INVESTMENT_CALENDAR_ID` 单独验收。没有重接入时按未连接处理，不伪造外部标识、不宣称同步已恢复；不要求恢复旧 OTP 配置。
- 每次正常部署不重新生成凭证。只有初始化或明确轮换时重建，以免每次发版导致登录态失效。
- 本次不删除业务数据或第三方凭证。若轮换 GU 客户端密钥，旧 GU 会话引用不能解密，必须同步失效处理；中央会话、其他产品及 provider/MCP 凭证不随 GU 一起重置。

## 操作顺序与恢复边界

1. 完成发布门禁修正、本地验证和独立审查。
2. API 中生成新 SSO/摘要凭证，并配对写入相应服务；值不进对话、日志、文件或 Git。
3. 合并后由正常 main workflow 重发；检查新 Worker、首页与 Auth，核对版本。
4. 上述条件通过才切换 GU 域名，再核对生产路径和摘要调用。
5. 记录已重建与尚未接入功能。旧 Pages 不再被当作必须维持兼容的目标；密钥轮换后，单纯恢复旧 DNS 不能保证旧 Pages 登录可用，恢复必须使用已配对的运行配置或修复新 Worker。

## 验证与交付

- `node --test scripts/cloudflare/deployment-evidence.test.mjs scripts/cloudflare/deploy-workflow.test.mjs scripts/cloudflare/check-pages.test.mjs`：21/21 通过。
- `node scripts/agent/check.mjs --base 33207cd5c2bedd3ce4ddde227499a6f176f4d3c2 --run`：23 项全部通过，含全部应用检查和 Health 正常/SSO 浏览器回归。
- 独立审查：未发现新增可复现 bug，无合并阻塞；明确会话失效、凭证配对与域名后的真实登录/摘要仍需分阶段验收。
- 2026-10-17 20:11 +08:00 前，当前 Codex 按用户重建授权，通过 Cloudflare API 在执行内存中生成两个独立随机值并完成四处写入：
  - GU Worker `AUTH_CLIENT_SECRET` 与 Auth `SSO_CLIENT_SECRET_GU` 配对。
  - GU Worker `DESK_SUMMARY_TOKEN` 与首页 Pages production `GU_SUMMARY_TOKEN` 配对。
  - 四次写入均成功；首页更新使用最小 PATCH，前后所有绑定名称保持一致；未读取/打印/落地密钥值。
  - 对准确 D1 `4d3b6713-85dd-4f61-ac55-9925db72394b` 仅清除 GU 的 `kdp_sso_sessions` 6 条、`kdp_sso_transactions` 2 条；复查均为 0。业务表、中央会话和其他应用未改动。
- 新 Worker `https://codepi-gu.kedoupi.workers.dev`：
  - `node scripts/cloudflare/check-pages.mjs gu production --origin ...` 通过：首页 302、私有 API 401 JSON、同环境 SSO/PKCE 跳转。
  - `cd apps/gu && npm run check:deploy -- --url ...` 通过：配置、health/login、2 个线上资产逐字节匹配当前本地构建，匿名私有 API 拒绝正常。
- `UPLOAD_TOKEN` 和 `INVESTMENT_CALENDAR_ID` 未迁入新 Worker：旧上传凭证不能继续用于新 Worker，日历显示未连接；后续接入按新流程独立处理。
- 尚未完成：新版 main 发布、正式域名切换、真实 OTP/登录/退出及首页登录后的 GU 摘要；workers.dev 匿名检查不能证明这些流程。
