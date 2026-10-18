# 本地发布操作

2026-10-18 起，正常路径为：本地检查与审查 → PR 合入 main → 本机从合并后的
main 构建、迁移、发布、验收。GitHub Actions 只提供附加验证以及独立的巡检/备份；
部署不等待 hosted runner。环境仍为 local + production。
治理约束见 [Cloudflare 规范](cloudflare-governance.md)，不新增依赖或另一套环境。

## 1. 固定源码与范围

一个协调者串行负责生产发布，不允许多个 agent 同时发布、迁移或切换版本。
记录执行人、机器、worktree、目标服务、完整 SHA、上次各服务的成功部署版本。
同一机器的 worktree 共用 Git common directory；在那里用原子 `mkdir`
建立 `codepi-production-release.lock`，整个发布结束后由创建者移除。
已存在的锁须联系持有者，不直接删除。跨机器还需协调者串行安排。

```bash
release_lock="$(git rev-parse --path-format=absolute --git-common-dir)/codepi-production-release.lock"
mkdir "$release_lock" || exit 1
trap 'rmdir "$release_lock"' EXIT
git rev-parse --show-toplevel
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

以上锁必须在整个发布所在的同一个 shell 生命周期内持有，不能预检结束就释放。
发布源码必须干净，HEAD 必须等于刚查询的远程 main SHA；支持 detached HEAD。
不得用 `GITHUB_SHA` 伪装尚未合并的源码。不要覆盖其他工作区，按集成流程准备独立
checkout。构建前和每次远程变更前复查 HEAD、工作区和远程 main；若已变化则停止，
用新主干重新确定范围和验证。不要在旧 main 上继续部署。

范围以**每个服务最后成功发布的 source SHA**为基线，检查其后所有提交触及的路径
（`git log --format= --name-only --no-renames <baseline>..HEAD`），包括部分发布失败后
被 revert 的改动。不要以最后一次提交、PR 名单或 CI 绿色 run 作为发布基线。
无可信基线、非祖先或共享依赖变更时保守扩大范围。
单纯文档/验证流程修改不要求重发无业务改动的应用，但仍需验证流程本身。
Auth/shared-auth、共享邮件/品牌/样式或 workspace 依赖变更须检查所有消费者。
Health API 与前端分别记录版本；只改 API 时不强制重发相同前端。

## 2. 本地验证与凭证

```bash
pnpm install --frozen-lockfile
node scripts/agent/check.mjs --base <本次改动之前的基线SHA> --run
node scripts/cloudflare/validate-governance.mjs
node scripts/agent/check-migrations.mjs
git diff --check
```

如果多个服务基线不同，检查范围取能覆盖所有待发布改动的基线。
PR 前的检查若与合并后树完全一致，可保留证据并只重跑受新变动影响的检查；
存在组合变动或合并冲突时重新运行。CI 未分配 runner 要记录为“未执行”，不能写成通过；
本地检查、审查、发布验收是必要条件，实际测试失败不能绕过。

使用已有环境中的 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN`，不打印或
复制值。在目标应用目录运行 workspace 锁定的 `pnpm exec wrangler whoami`，
核对 Kedoupi 账户及资源登记表。授权与 token 轮换不属于日常发布步骤。
提前读取现行版本、必要 secret **名称**、绑定和 Cron，确定回退目标。
有迁移时核实恢复方案和兼容性；Worker 回退不等于数据库回退。

## 3. 按依赖顺序发布

下表命令均在对应目录执行；仅执行本次受影响的服务。每个阶段成功后才继续下一个，
任何构建、迁移、上传、切流或验收失败都停止后续阶段，记录已经改变的生产状态。
使用 `CI=true` 避免交互确认，并将 `GITHUB_SHA` 设为已核对的完整 HEAD SHA。

| 顺序 / 服务 | 目录 | 构建 / 迁移 / 发布 |
| --- | --- | --- |
| Auth | `services/auth` | `pnpm exec wrangler deploy --dry-run` → `pnpm exec wrangler d1 migrations apply codepi-auth --remote` → `pnpm exec wrangler deploy` |
| Web / Desk | `apps/web` | `pnpm build` → `pnpm exec wrangler d1 migrations apply codepi-desk --remote` → `pnpm exec wrangler deploy` |
| GU | `apps/gu` | `pnpm build` → `pnpm exec wrangler d1 migrations apply codepi-gu --remote` → `pnpm exec wrangler deploy` |
| GZH | `apps/gzh` | `pnpm build` → `pnpm exec wrangler d1 migrations apply codepi-gzh --remote` → `pnpm exec wrangler deploy` |
| Health API | `apps/health` | `pnpm deploy:api --preflight-only` → `pnpm deploy:api` |
| Health 前端 | `apps/health/apps/web` | `pnpm build` → `pnpm exec wrangler deploy` |

Health API 的现有脚本已包含 dry-run、权限/当前版本预检、D1 migration、带 SHA 的
版本上传、切换 100% 流量和 Cron 核对；不得用裸 `wrangler deploy` 丢失这些步骤。
前端使用 Workers Static Assets，不使用已退役的 Pages deploy。

Health 示例（在仓库根运行，替换基线，凭证只从已授权环境读取）：

```bash
test -z "$(git status --porcelain)" || exit 1
release_sha=$(git rev-parse HEAD)
remote_main=$(git ls-remote origin refs/heads/main | cut -f1)
test "$release_sha" = "$remote_main" || exit 1
CI=true GITHUB_SHA="$release_sha" pnpm --dir apps/health deploy:api
HEALTH_EXPECT_BUILD="${release_sha:0:12}" pnpm --dir apps/health check:api
```

此示例是第 3 节执行片段，不替代锁、安装、完整检查和预检。日志仅保存非敏感构建、
provider 标识和错误信息；禁止保存 credentials、Cookie、OAuth code 或私人数据。

## 4. 验收与证据

从仓库根运行。未改 Auth 也必须确认其运行时健康和客户端精确回调。

| 服务 | 验证 |
| --- | --- |
| Auth | `https://auth.codepi.app/api/health` 返回 200 JSON 且 `ok=true`；核对 SSO 客户端及回调元数据 |
| Web / GU / GZH | `node scripts/cloudflare/check-pages.mjs <web或gu或gzh> production`，检查私有接口拒绝和 SSO |
| Health API | `HEALTH_EXPECT_BUILD=<SHA前12位> pnpm --dir apps/health check:api`，16 项含 MCP/OAuth 和实际 build |
| Health 前端 | API 验收通过后，`pnpm --dir apps/health check:branding` 及本次 UI/登录流程验收 |

用 `deployment-evidence.mjs resolve-worker` 核对实际 runtime secret 名称和 origin：
Web 的 required secrets 为 `AUTH_CLIENT_SECRET,HEALTH_SUMMARY_TOKEN,GU_SUMMARY_TOKEN,WECHAT_SUMMARY_TOKEN`；
GU/GZH 为 `AUTH_CLIENT_SECRET,DESK_SUMMARY_TOKEN`。Health 前端为纯代理，明确传
`--script codepi-health --no-required-secrets`。Web/GU/GZH 还可用 `check-pages.mjs`
的 `--origin` 探测控制面解析出的新 Worker origin。Health API 用现有发布预检和
精确 build 契约，不把“secret 名存在”当作成功登录。

发布日志必须解析出真实 Worker version ID（`deployment-evidence.mjs worker-version`），
解析失败不能标成功。逐服务记录 JSONL（输出位置在 Git 之外）：

```bash
node scripts/cloudflare/deployment-evidence.mjs append \
  --file /tmp/codepi-deployment-evidence.jsonl \
  --service health-api --target production --sha <完整sourceSHA> \
  --provider worker --identifier <实际versionID> --smoke pass
```

控制面再次确认活跃版本、绑定、Cron、持久日志、Issues；登记表和当前任务回填执行人、
时间、source SHA、previous/new version、检查结果及未验收路径。只有 smoke 通过才写
`--smoke pass`。线上登录、Oura 重连和真实数据同步单独验收，不以 HTTP 200 代替。
多服务部分成功时分别记录；下次发布仍包含未成功服务。

## 5. 失败与日常运行

迁移失败则不切换代码；上传后切流失败保留原版本；切流后验收失败仅在 schema 和配置
兼容时回退到已记录版本，或修复后重新发布。D1 限额恢复后从当前 main 重新走本流程，
不自动重跑旧 Actions 部署。凭证、域名、数据清理必须保持各自授权边界。

`production-monitor.yml` 和 `d1-backup.yml` 仍负责定时巡检和加密备份，部署迁到本机
不表示它们已经恢复。可按需本地执行 `node scripts/cloudflare/production-monitor.mjs --require-d1`；
备份按既有备份 runbook 执行，异机保存与密钥保管仍须另行验收。不把个人电脑临时在线
描述成全天候调度保障。
