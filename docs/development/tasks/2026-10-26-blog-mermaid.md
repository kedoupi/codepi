# 2026-10-26 Blog Mermaid 图表支持与发布

- 状态：PR #213 已合并并发布十个 Worker，生产 smoke、真实草稿图表验收、观察后全量巡检与七轮 Observer 均完成；最终 `healthy_reported`、无回滚。
- 用户目标：修复 Blog MCP 已提交稿件中的 Mermaid 代码块只显示源码、不能显示图表的问题；已有草稿无需重新提交，手机端可读，失败时保留源码。
- 实现：`apps/web` 对已有 `language-mermaid` 代码块按需加载 Mermaid 12，以 strict 安全模式和现有样式 token 渲染 SVG；保留可展开源码、非法图回退、键盘聚焦与窄屏图内横向滚动。无图表页面不加载 Mermaid 核心资源。
- 实现分支 / worktree：`codex/blog-mermaid` / `/Users/codepi/.worktrees/codepi/codex/blog-mermaid`；基线 `57fd8374d0003c459b0aba983ce730c807857fb8`，实现提交 `47ce06365e7ff5f218b6320c56dbff12b5606cfa`。
- 合并 / 发布 SHA：PR #213 合并为 `d233d1ab3b4bc07cbd95f05c6f45e64ce70aee45`；发布源为干净主 checkout `/Users/codepi/Coding/codepi`，HEAD、实时远程 main 与该 SHA 一致，合并树与已审查 PR 树完全一致。发布期间持有本地 production release lock。
- 证据 worktree / 分支：`/Users/codepi/.worktrees/codepi/codex/blog-mermaid-release-evidence` / `codex/blog-mermaid-release-evidence`。本记录仅回填证据，不改运行时代码或远程内容。

## 本地与 PR 验证

- 根 lockfile 因新增经用户批准的 `mermaid` 依赖变化，受影响检查和发布范围保守覆盖全工作区及十个 Worker。
- `node scripts/agent/check.mjs --base 57fd8374d0003c459b0aba983ce730c807857fb8 --run` 通过；governance、32 个 migration 文件守门与 `git diff --check` 通过。
- `npm run test:browser:desk` 通过：两张真实 Mermaid 图、非法图源码回退、源码展开/收起、无图页面懒加载、320/375/768/1024/1440px 无页面横向溢出，以及手机图内滚动与初始居中。
- 修复前同一浏览器回归因没有 `.blog-mermaid svg` 超时，修复后通过；没有删除失败断言或提高构建警告阈值。
- PR #213 的 14 项 GitHub Actions 检查全部成功，合并状态为 `CLEAN`。
- 构建保留既有 Zod Rollup 注释警告和 Mermaid 独立核心 chunk 超过 500 kB 的提示；构建成功，懒加载行为由浏览器回归验证。

## 发布与版本

- frozen install、治理与 migration 门禁通过；远程没有待应用的新 migration，未修改 secret、binding、域名或外部业务数据。
- 以下十个 Worker 均发布自 `d233d1ab3b4bc07cbd95f05c6f45e64ce70aee45`，逐服务 smoke 通过：

| 服务 | 发布前 version | 发布后 version |
| --- | --- | --- |
| auth | `3bdc80ce-0ad9-4f0c-b0fe-ef3bec0bb8cc` | `8dfff4ee-8a81-4ddb-83f4-75504913b6b7` |
| web | `adaf622b-a748-4bcf-98af-6e1a6800e4ec` | `766174a3-b035-4f86-ac6c-77eabe4d6c7a` |
| gu | `468470d7-e9de-4bf5-897e-5fe05244898b` | `9b68af6a-e55c-4c90-b7ac-2450b45b28af` |
| gzh | `f348474e-d258-480f-bc86-c5ed11b5dc5e` | `018cd51c-48c6-479c-90c7-b4aba9c49b1c` |
| project | `8e686f56-8749-4587-8e2f-69f382da9e4b` | `7209fbc0-3d7d-487f-a37d-ba01e5c83d15` |
| me | `6cdba953-d3e0-45f0-8d52-127a594a1139` | `34bafb18-fd1a-46b2-95e2-e17796857a56` |
| health-api | `2cc50ffd-a0db-4cec-b8e9-a3bdfa05bc16` | `379ca46c-892b-4d9a-84f9-fea40194544a` |
| health-web | `5975a18c-9e7a-4f5c-a486-00eab04b9488` | `c61fed45-138f-4396-872e-653c8b4c7c5e` |
| mcp | `0df7dc61-40cf-4863-8edd-ad2fb804f7a7` | `f79506af-5c75-4b75-8ca3-0b1e2c54c637` |
| ops | `ddc50bf2-b263-435c-8f0f-1329af0974b9` | `5fe22845-8e63-4570-a14a-c9f3269ed7aa` |

- Auth health；Web/GU/GZH `check-pages`；Project/Me readiness 与精确 build；Health API 18 项与 branding；MCP `check:live` 均通过。
- 发布后及观察后 `production-monitor.mjs --require-d1 --require-versions` 均全部通过，含十个 Worker 的版本漂移与 Health 自动同步新鲜度。
- 部署证据在 Git 外 `/tmp/codepi-deployment-evidence.jsonl`；发布前后快照为 `/tmp/codepi-mermaid-d233d1ab3b4bc07cbd95f05c6f45e64ce70aee45-before.json` 与对应 `-after.json`。

## 真实草稿图表验收

- 使用本人已登录浏览器的隔离 Agent Window，只读打开现有待审稿 `openai-google-cloud-model-distribution-analysis-20261026` 的生产预览；没有修改、发布或重新提交文章。
- 两张 Mermaid 图均生成可见 SVG，`errors=0`，两份源码均为 `rendered`；SVG 具有 `role=img` 和可读标签，Mermaid 核心资源两次页面加载均返回 200，控制台无错误。
- 桌面两张图容器均无内部溢出，页面无横向溢出。390px 手机视口重载后两张图均完成渲染，页面无横向溢出；图容器 `clientWidth=348`、`scrollWidth=592`、`scrollLeft=122`，可在图内横向滚动且初始位置居中。
- 手机端源码可展开并收起，原始 `flowchart TD` 保留。桌面全页和手机图截图分别为 `/tmp/codepi-mermaid-production-desktop.png`、`/tmp/codepi-mermaid-production-mobile.png`；浏览器捕获保存在 Git 外 `/tmp/codepi-mermaid-browser-evidence.json`，不提交私人正文或凭证。
- 匿名访问该草稿预览返回 302，公开博客列表没有该草稿链接；文章继续保持待审核。

## 观察与剩余边界

- 单一 Observer `release-d233d1ab3b4b-mermaid213`，Workflow 实例 `cf_6324cb3a670d37724b0fa483aa2eb4d4a2907adb60841953dca347b73d040931`；manifest 对十服务均推导 `rollback_allowed=true`。t=0/5/10/15/20/25/30 七轮完成，Workflow `Completed`，最后一个成功步骤为 `observer poll 6-1`。
- 私有 R2 `reports/observer/release-d233d1ab3b4b-mermaid213/summary.json` 于 `2026-10-26T16:58:57.954Z` 写入最终结论：`state=healthy_reported`、`events=3`、`rollback=null`。末轮十服务均为 healthy、active version 与 manifest 一致，无版本错配、硬失败或 observability 失败，22 项 core checks 全部通过；末轮仅 Health API 有 2 次调用、0 错误的指标样本，其余服务 metrics 为 null，不把缺失样本解释为没有流量。
- 第 32 分钟 Workflow 仍在 `observer wait 6-1` 且 summary 不存在，未提前记为成功；最终在第 34 分钟完成并读取报告。Issue #169 的 `started` 与 `healthy_reported` 完成通知均已核对。
- 原始 summary 与末轮 poll 下载到 Git 外 `/tmp/codepi-mermaid-d233d1ab3b4b-observation.json`、`/tmp/codepi-mermaid-d233d1ab3b4b-poll-6.json`。
- 未执行真实 Oura 对账/补采、真实邮件 OTP、MCP 客户端重新授权或所有者持续使用确认；这些不属于本次 Mermaid 修复的完成证据。
- 本次未执行回滚。是否需要及能否回滚必须以最终 release manifest 和 Observer 的真实 `rollback` 结果为准；文档回填本身无需重发业务 Worker。
