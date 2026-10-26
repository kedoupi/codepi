# www 页头统一与响应式验收

- 状态：PR #207 已合并，`codepi-www` 已发布；生产响应式 smoke 与 30 分钟 Ops 观察均完成，观察报告为 `healthy_reported`，不代替实际用户使用确认。
- task_id: www-header-consistency
- base_sha: `9b03157a8fd6e07103894b7ddb904df700c03294`
- merged_sha / production source SHA: `634d43bccff3c7c1502aa339cd92afc914d7c0ff`（PR #207）
- implementation_worktree: `/Users/codepi/.worktrees/codepi/codex/www-header-consistency`
- release_worktree: `/Users/codepi/.worktrees/codepi/codex/www-header-release`（干净发布 checkout）
- evidence_worktree: `/Users/codepi/.worktrees/codepi/codex/www-header-release-evidence`
- 发布授权：用户明确授权本次 www 上线；未授权迁移、secret、binding、业务数据变更或其他服务发布。

## 范围

统一首页与公开二级页 header 的容器、尺寸、导航和移动交互。实现移除首页专属 header class、fixed/毛玻璃/尺寸覆盖及滚动 class 切换，保留既有普通页头、首页 main/footer、hero 和移动菜单。实现涉及 `packages/shared/layouts/BaseLayout.astro`、`packages/shared/styles/site.css`、`apps/web/src/components/PersonalHome.astro` 与 `docs/architecture/personal-design-system.md`。

## 合并与本地证据

- 固定审查范围 `ac5cd6a..9c625755` 未发现阻塞问题；合并后树与已验证树完全一致。
- 7 个公开页面 `/`、`/apps/`、`/blog/`、`/about/`、`/contact/`、`/privacy/`、`/terms/` 在 320/375/768/1024/1440px 无横向溢出。
- 桌面 header 样式一致；手机 menu summary 不小于 44×44，Enter 打开、Escape 与外部点击关闭通过。
- Web build、42 项测试、`typecheck:desk`、assets 检查、frozen lockfile 安装、Cloudflare governance 及 32 migration 文件守门均通过。集成后受影响检查覆盖所有应用；一次 MCP 元数据测试本地 `ECONNRESET` 后，原失败测试单独运行及完整 63 项 MCP、浏览器验收均通过，未改变代码或断言；其余 Ops、CLI 与 shared auth 检查已补齐通过。

## 生产发布与 smoke

- 2026-10-26 从干净且等于当时实时远程 main 的 checkout 持锁发布 `codepi-www`。活跃版本由 `17ae27a0-2a66-4066-9d5f-27e4bede42be` 更新为 `c04eb532-1a28-4f34-a240-6cf32438bce9`，`BUILD_SHA=634d43bccff3`。
- 本次没有 migration、secret、binding 或业务数据变更，未发布其他服务。
- PR #207 的 14 项 CI checks 均通过。
- Auth health、根页面、匿名私有 API 拒绝、同环境 SSO 重定向，以及 `codepi.app` 与 `www.codepi.app` 的 HTTP 200 通过。
- 生产 35 组响应式 matrix smoke 通过。首次 smoke 曾把不同页面滚动条占宽差误判为 header 不一致；后续按实际可用宽度验证既有容器公式与居中，并保留高度、logo、gap、font、`aria-current` 和无溢出断言，未修改生产代码或重复部署。
- 已查看真实手机 390px 截图，hero 和页头正常；生产 bsk 在 390px 的 Enter 打开、Escape 与外部点击关闭通过。
- 部署证据：`/tmp/codepi-www-header-deployment.json`、`/tmp/codepi-deployment-evidence.jsonl`。

## Ops 观察

- 发布后观察 `release-634d43bccff3-header207` 完成，实例 `cf_0965ae42f43e770d17ac4dad753b585f0d61cf20c859d240c242789b3e82e890`，`rollback_allowed=true`。最终 summary 于 `2026-10-26T10:30:07.076Z` 记录 `healthy_reported`，`rollback=null`。
- 末轮 round 6 中 `codepi-www` active version 与预期 `c04eb532-1a28-4f34-a240-6cf32438bce9` 一致；severity 为 `healthy`，无 version mismatch、active-version 检查失败、observability failure、issues 或 hard failure，22 项 core checks 均为 `ok`。
- 末轮 metrics 为 `null`；前两轮有样本且 `errors=0`。该平台观察证据不代替实际用户使用确认。
- 观察证据：`/tmp/codepi-www-header-observation-summary.json`、`/tmp/codepi-www-header-observation-poll-6.json`。
