# Cloudflare governance rollout

- 状态：本地实现与此前独立审查完成；2026-10-16 提交前全量检查的 Health 普通浏览器场景首轮失败、单独复跑通过，稳定性仍待确认。远程发布与完整 E2E 的既有阻断未解除，整个计划尚未完成
- 目标与验收：落实 [Cloudflare 治理规范](../cloudflare-governance.md) 与[资源登记表](../cloudflare-resource-registry.md)中的环境隔离、静态守门与受控发布，并以全量受影响检查和远程 E2E/发布证据完成验收。
- 不在范围内：读取 secret 值或业务数据；未经另行授权的数据删除、生产部署、push、PR、merge。本次用户已单独授权将这 24 个 CF 文件提交到 main，未授权推送。
- worktree / 分支：`<workspace>/Coding/kdp.cool`（`main`）
- 起始 SHA / 审查基线：`6709564067027c8420b1f01be0d7a9132f19a3d8`
- 当前交付 SHA：见本记录所属的 CF 提交；提交前 main 基线为 `b1d275f48fd2a045e4b291060aed89ab8197e4fd`，本次仅本地 commit，不 push
- 协调者 / 集成者：Parent/Main；IntegrationFixes（workflow、oura、check scripts）、IsolationRules（validator/tests）、ResourceEvidence（docs）与 GzhStagingBinding（GZH staging UUID）均已停止写入；独立 reviewer 已关闭其发现的 staging preflight P1，未报告新的 P0/P1/P2。
- 唯一任务分配表：Parent/Main 的本次会话分工；并行 writer 路径互不重叠。
- 允许修改的路径 / 公共文件负责人：ResourceEvidence 仅 `docs/development/cloudflare-resource-registry.md`、`docs/development/cloudflare-governance.md` 及本记录；其余路径由上述对应 writer 拥有。
- 相关设计与依赖：本记录链接的治理规范与资源登记表；生产回调撤销、Access 与 GitHub Environment 配置依赖账户所有者。

## 已完成

- 以分页只读控制面盘点更新资源登记表：Pages 4、Workers 5、D1 11、KV 1、R2 1、Queue/DO 0、Tunnel 4，以及 `codepi.app` 16 / `kdp.cool` 20 条 DNS 的公开路由元数据；未读取业务数据或 secret。
- 已创建授权的 `codepi-gzh-staging` replacement D1，并执行 `0001`–`0004` migration；Pages preview DB project setting 与仓库配置已指向新 UUID。staging Pages 尚未上传，须经 release gate，不能视为部署已切换。
- 登记了 canonical direct-upload Pages 与 Worker deployment/version 元数据；现有 Pages `commit_dirty=true`，Worker 未确认干净 source SHA，均不作为新 workflow 成功证明。
- 规范已明确 staging Auth secret-name preflight 必须在任何远程 migration/deploy 前 fail-closed；将过时的 Auth 404 期待改为配置完成后的 200 JSON。
- 并行清理 commit `7701511` 不属于本任务；其历史删除不代表退役窗口、消费者为零或 smoke 先决条件已验证。

## 验证证据

- 在 `oura/`：`corepack pnpm@9.15.9 exec node ../scripts/agent/check.mjs --base 6709564 --run` 已通过 root/web/auth/GU `npm test`，随后因 GU `test:scripts` fixture 停止；修复后单独通过 GU `test:scripts`（75）、`typecheck`、`build`、`check:deploy` config，GZH `test`（83）、`typecheck`、`build`，Health `test`、`typecheck`、`build`、`test:browser:built`（normal 与 SSO），及 shared Auth（10）。全部受影响计划命令已分别通过；这不是一次单轮完整 runner 全绿。
- 扩展后的 governance validator（22）、deployment evidence（5）、registry mapping（21）均通过。`actionlint` v1.7.12 在最终 workflow 与 retry 文件上通过（包含 staging preflight 修复后）；workflow affected shell 的 8 个实际场景均成功。
- standalone `staging-auth-preflight` 已被实际 YAML 检查为全部 6 个 staging deploy job（包括 single-app）的 mandatory `needs`，并要求 result success。以环境凭证执行 metadata-only preflight shell，因缺 `OWNER_EMAIL` 按预期 exit 1，且发生在任何 mutation 前。
- production 与 staging `node oura/scripts/check-api.mjs` 均为 16 probes 通过；staging 明确使用 `expectedOauth=false`、`SSO=true`、`auth-staging`，不期待新 SHA，live build 为 `local`。生产验证包括匿名私有 API 401、网站 SSO redirect、MCP POST 401 metadata challenge 与正确 origin 的两份 discovery。
- Health Pages functions build 从 `apps/web` 使用 `../../workers/api/node_modules/.bin/wrangler` 编译成功；新增 config 尚未远程上传。Evidence CLI 对真实 Pages deployment 只读解析返回 `3f902dd6…`；缺 URL/version 参数按预期以 exit 1 失败。
- 未运行完整登录/callback/logout E2E：缺 staging Auth 配置和 owner 身份。本次续接未运行 release workflow 或计算发布，未作 production mutation 或数据删除；已授权的替代 GZH staging D1 migration 见“已授权远程动作”。

## 当前文件清单（24）

### 2026-10-16 提交前复核

- 从 `b1d275f` 运行 `node scripts/agent/check.mjs --base b1d275f --run`：CF 治理/evidence 测试、静态守门、agent 检查测试，以及 Web、Auth、GU、GZH、Health 的单元测试、类型检查和构建均通过。
- runner 在 Health 普通浏览器场景停止：`oura/scripts/browser-smoke.mjs:458` 断言期望 `91`、实际 `—`；同轮 SSO 场景通过。随后在 `oura/` 单独运行 `OURA_BROWSER_SSO=0 pnpm test:browser:built` 通过，未修改代码、断言或测试标准；不能把这次复跑当作首次全量 runner 全绿，间歇性原因仍未定位。
- 补跑 `node --experimental-strip-types --test shared/auth/client.test.mjs`，10 项通过。两个 workflow YAML 可解析，94 个 run step 经表达式占位后的 `bash -n` 检查通过，6 个 staging deploy job 均依赖 preflight success。本机 PATH 未找到 actionlint，本次未复跑，不将上述语法检查等同于 actionlint。
- 仅提交已有 CF 改动和本段交接更新；没有远程调用、迁移、部署或 secret 操作。staging Auth、Access、GitHub Environment 与真实登录 E2E 的待办仍以原登记为准，未作新一轮控制面确认。

### 文件

`D .github/workflows/deploy-product-apps.yml`; `.github/workflows/retry-oura-deploy.yml`;
`.github/workflows/deploy-platform.yml`; `docs/development/cloudflare-governance.md`;
`docs/development/cloudflare-resource-registry.md`;
`docs/development/tasks/2026-10-15-cloudflare-governance.md`;
`gu/scripts/check-deploy-regression.mjs`; `gu/scripts/check-deploy.mjs`; `gzh/wrangler.toml`;
`oura/README.md`; `oura/apps/web/test/deploy-recovery.test.mjs`; `oura/apps/web/wrangler.toml`;
`oura/scripts/check-api.mjs`; `oura/scripts/deploy-api.mjs`;
`oura/scripts/lib/wrangler-config.mjs`; `oura/scripts/retry-quota-deploy.mjs`;
`oura/scripts/tests/check-api.test.mjs`; `oura/scripts/tests/deploy-preflight.test.mjs`;
`scripts/agent/check.mjs`; `scripts/agent/check.test.mjs`;
`scripts/cloudflare/validate-governance.mjs`;
`scripts/cloudflare/validate-governance.test.mjs`;
`scripts/cloudflare/deployment-evidence.mjs`;
`scripts/cloudflare/deployment-evidence.test.mjs`。

## 阻断与继续工作

- staging Auth 缺 `OWNER_EMAIL`、`OTP_FROM`、`RESEND_API_KEY`；用户明确选择暂时保留该阻断。预检应在远程 migration/deploy 之前停止。
- Access apps 查询为空，且未提供 required owner identity；不能创建 Access policy。
- GitHub CLI 返回 401；GitHub `production`/`staging` Environment approval 与 scoped credentials 未验证。
- `kdp.cool` legacy callbacks 保留至 2026-10-29；到期前不得删除，届时仍须核实旧 DNS/custom domain、真实流量与消费者为零。
- 下一步：满足账户前提后，运行受控 staging release、上传 Pages，并完成 login/callback/logout E2E 与 provider deployment evidence 关联；2026-10-29 后且全部退役条件获证实后，再处理 legacy callback。

## 已授权远程动作

- 已实际执行：只读 Cloudflare inventory；创建 replacement staging D1、应用四个 GZH migrations、PATCH Pages preview DB 设置。
- 本次续接未执行：计算发布、production mutation、数据删除、读取 secret 或业务数据、commit、push、PR、merge；这不改变此前已授权 rollout 的范围。
