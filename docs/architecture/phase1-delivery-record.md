# Phase 1 交付记录与发布流程

> 用途：记录本次 Phase 1 从 scope review、分支发布、独立审查到 squash merge 的可复用流程。本文是交付记录，不替代 `architecture-baseline.md` 或 `p1-implementation-plan.md`。

## 1. 交付范围

Phase 1 只处理三类产品行为：

- Skill Builder 自由文本不再写入新 URL；
- shared URL state 保留外部 query 参数；
- 工具页语言菜单只暴露实际支持的语言。

架构边界保持不变：独立 Astro 站点、`shared/` alias、静态输出、一站点一个 Cloudflare Pages Project；不引入 Workers、workspace、CI、registry 或 DNS/Cloudflare 配置修改。

## 2. 初始 scope review

先读取：

- `docs/architecture/architecture-baseline.md`
- `docs/architecture/p1-implementation-plan.md`

然后检查：

- `docs/architecture/` 文件清单；
- secret、token 值、临时日志、本机绝对路径；
- 文档与 baseline 的冲突或过期状态；
- `git status --short` 和完整 changed-path 集合。

结果：初始范围只有 2 个架构文档和 4 个 Phase 1 文件。文档中的 `token`、`secret` 等均为风险说明或禁止字段，不是凭证值。计划文档在 Phase 1 完成后仍保留 `Plan only` 等历史状态，应单独做文档治理，不混入产品修复。

## 3. 两阶段提交

先拆成两个独立 commit：

### Commit A：架构文档

```text
docs(architecture): record baseline and Phase 1 plan
```

文件：

- `docs/architecture/architecture-baseline.md`
- `docs/architecture/p1-implementation-plan.md`

### Commit B：产品正确性与隐私修复

```text
fix(privacy): keep skill builder data out of URLs and preserve query state
```

文件：

- `ai/src/pages/skill-builder/index.astro`
- `shared/layouts/BaseLayout.astro`
- `shared/lib/url-state.js`
- `shared/lib/url-state.test.mjs`

拆分原则：文档可独立回滚；运行时代码和对应测试可独立回滚；不把 Cloudflare、DNS 或 Phase 2 工作混入。

## 4. Git / Deployment Preflight

在 push 前确认：

```text
current branch = main
origin default branch = origin/main
main ahead/behind origin/main = 2/0
working tree = clean
```

README 声称 `push main` 会触发 Cloudflare Pages rebuild，但 architecture baseline 明确指出仓库无法验证 Cloudflare 控制台绑定、production branch、root directory、环境变量和最近部署状态。

因此必须区分：

- **REPO_PROVEN**：Git refs、文件范围、提交关系、仓库内构建配置；
- **DOC_ONLY**：README 对 Cloudflare 自动部署的描述；
- **VERIFIED**：只有从 Cloudflare 控制台或部署 API 实际读到的绑定和状态才能使用此标签。

安全选择：不直接 push `main`，改用 feature branch + PR。

## 5. Feature branch 与 PR

从当前 HEAD 创建并推送：

```text
phase1/privacy-url-state
origin/phase1/privacy-url-state
```

PR #1：

```text
title: fix: improve URL privacy and shared query state
base: main
head: phase1/privacy-url-state
```

PR 创建前检查：

- remote 为 `kedoupi/codepi`；
- feature branch 相对 `origin/main` 只包含预期文件；
- `gh` 可用且已登录；
- 不执行 main push。

## 6. Independent Review 与 Review Fix

第一次 review 发现一个 blocking test gap：核心隐私行为只有浏览器 smoke test，没有仓库内自动化回归测试。

不引入 Playwright、Vitest 或大型 DOM 测试框架，而是提取最小纯函数：

```text
shared/lib/skill-builder-url-state.js
```

生产代码实际调用该 helper，测试通过现有 `decodeState()` 和 `pushUrlState()` 验证 URL 投影。

新增测试覆盖：

- `name`、`purpose`、`trigger`、`steps`、`inputs`、`output`、`limits`、`safety` 不进入更新后的 URL；
- `template`、`client` 保留；
- `lang=zh`、UTM 和未知 query 保留；
- 历史 URL 可读取 `name`、`purpose`；
- 后续 state update 删除历史敏感字段；
- 历史 `template`、`client` 和外部 query 保留。

Review Fix commit：

```text
ea13037 test(privacy): add regression coverage for skill builder URL state
```

验证结果：

- 新增测试：2/2 PASS；
- `cd calc && npm test`：40/40 PASS；
- `cd ai && npm run build`：PASS；
- `git diff --check`：PASS。

Review Fix 只涉及：

- `ai/src/pages/skill-builder/index.astro`
- `shared/lib/skill-builder-url-state.js`
- `shared/lib/skill-builder-url-state.test.mjs`

## 7. Merge Preflight

再次执行 `git fetch origin`，确认：

- `origin/main` 没有新提交；
- feature branch 仍基于最新 `main`；
- feature branch 包含 3 个预期 commit；
- PR 为 `OPEN`、`MERGEABLE`、`CLEAN`；
- changed files 正好 8 个；
- unresolved review threads 为 0；
- 未发现 failed 或 pending checks。

Branch protection API 因 GitHub 账户/仓库权限返回 403，无法从 API 验证 required review 或 required status checks。该限制必须明确报告，不能伪称为 VERIFIED。

## 8. Squash Merge

使用 squash merge，commit title：

```text
fix: improve URL privacy and shared query state
```

最终 main commit：

```text
3cd1a24 fix: improve URL privacy and shared query state
```

Squash merge 的结果：

- `main` 保留一个原子 Phase 1 commit；
- 原始 3 个 feature commits 保留在 feature branch 和 PR 记录中；
- 整体回滚只需 revert 一个 squash commit；
- feature branch 不删除，便于审计和对照；
- feature branch 的 commit ancestry 不再是 main 的祖先关系，但两者 tree 相同，表示没有未合并的文件内容。

合并后执行：

```text
git fetch origin
git switch main
git pull --ff-only origin main
git status
git log -5 --oneline
```

最终状态：

- local `main == origin/main == 3cd1a24`；
- 工作区干净；
- feature branch 保留；
- GitHub deployment 记录为空；
- merge commit 的 check runs 为 0；
- Cloudflare 实际部署状态仍不可由仓库验证。

## 9. 可复用发布清单

### Scope

- [ ] 读取 baseline 和 implementation plan；
- [ ] 列出 changed files；
- [ ] 检查 secrets、日志、绝对路径和文档漂移；
- [ ] 确认没有额外改动。

### Commit

- [ ] 文档与运行时代码分开提交；
- [ ] 每个 commit 文件范围精确；
- [ ] 运行相称的测试和 build；
- [ ] `git diff --check` 通过。

### Branch / PR

- [ ] fetch 后确认 `origin/main` 没有新提交；
- [ ] feature branch 基于最新 main；
- [ ] 不直接 push main；
- [ ] PR changed files 与预期一致；
- [ ] 独立 review 不只依赖 build PASS；
- [ ] 核心隐私/安全契约有自动化回归测试。

### Merge

- [ ] merge 前重新读取 PR state/base/head/mergeability；
- [ ] 检查 unresolved threads、failed/pending checks 和 deployment 状态；
- [ ] 无法验证的 GitHub/Cloudflare 外部配置明确标记；
- [ ] 采用 squash 或 merge commit 的选择有记录；
- [ ] merge 后 fetch，fast-forward 更新本地 main；
- [ ] 检查 main、origin/main、工作区和 feature branch；
- [ ] 不自动删除 feature branch；
- [ ] 不手动触发 Cloudflare 部署。
