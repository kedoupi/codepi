# AdSense 低价值内容拒审：止血与发布记录

> 状态：2026-10-10 广告阶段的历史诊断与发布记录。广告与旧工具站已退役，
> 下文审核、广告启用和部署建议不再适用，不恢复 `<ins>` 或 Post-approval 流程。
> 当前方向见[根 README](../../README.md)，现行操作见[开发导航](../development/README.md)。

## 1. 背景与目标

| 项 | 值 |
| --- | --- |
| AdSense 属性 | `kdp.cool`（apex，覆盖子域） |
| Publisher | `pub-4790759596265225` |
| 拒审项 | 低价值内容（所有权验证已通过） |
| 目标 | 提高复审通过概率，使站点可展示广告 |
| 代码落点 | `b90d24b` on `main` |

**明确不做的承诺：** 任何改动都不能保证 AdSense 通过。本记录只描述已执行动作与验证结果。

## 2. 诊断摘要

拒审主因落在「内容价值 / 站点形态」，不是 ads.txt 或 pub id 接入错误。

| 信号 | 拒审前状态 |
| --- | --- |
| 主站内容资产 | 3 个 apex 计算器 + 仅 3 篇 guides |
| 重复 URL | mortgage / paycheck / income-tax 在 `kdp.cool` 与 `calc.kdp.cool` 双活（多靠 canonical） |
| 审稿面被稀释 | `convert` / `text` / `dev` / `ai` 薄工具 + 多套品牌页 |
| 差信号 | Lorem Ipsum 等填充文工具仍可访问 |
| 技术接入 | ads.txt、AdSense loader、所有权 — 基本正常 |

策略（方案 B）：**审稿窗口内把 Google 主要视野收束到「apex 金融计算器 + 原创 guides」**，再谈复审。

## 3. 工作流（实际路径）

```text
诊断拒审
  → 定审稿表面（apex 金融）
  → P0 工程（去重 / noindex / 广告开关）
  → P1 内容（guides，数字用 shared math）
  → 本地六站 build
  → commit + push main
  → 生产抽检
  → 抽检失败：查 CF canonical deployment commit
  → 根因：Pages 仍绑定已失效的 kedoupi/kdp-tools
  → wrangler pages deploy 直传六站 dist
  → 人工把 CF Git 源改到 kedoupi/codepi
  → 复核绑定 + 线上冒烟
  → GSC 交 sitemap → 等 7–14 天 → 再点 AdSense 复审
```

### 3.1 可复用原则

1. **先定审稿表面，再写代码。** 工具农场扩站与过审目标冲突时，优先收缩索引面。
2. **push 不等于上线。** 必须用生产 URL 抽检；`pages.dev` 与自定义域一致且内容旧 → 是部署包问题，不是「等缓存」。
3. **区分证据等级：**
   - `REPO_PROVEN`：git refs、文件、本地 build
   - `DOC_ONLY`：README 对自动部署的描述
   - `VERIFIED`：CF API/控制台读到的 binding 与 deployment commit，或生产 HTTP 探针
4. **Git 源失效时的备用路径：** 本地 build + `wrangler pages deploy`（见 §6）。

## 4. P0 工程改动

| 改动 | 位置 | 作用 |
| --- | --- | --- |
| `adsenseEnabled` / `defaultRobots` | 各站 `src/site.config.js` | 卫星站关广告 + noindex；web/calc 保持 index + ads |
| 条件加载 AdSense | `shared/layouts/BaseLayout.astro`、`shared/components/AdSense.astro` | 读 site.config，一处控制六站 |
| calc 三工具 301 | `calc/public/_redirects` | → `https://kdp.cool/...` |
| calc 页 noindex 双保险 | calc 三工具页 `robots` | 防止 redirect 未生效时仍被收录 |
| sitemap 过滤 | `shared/sitemap-filter.js` + calc/text `astro.config` | calc 去掉已迁工具；text 去掉 lorem |
| lorem 301 | `text/public/_redirects` | → `/word-counter/` |
| 叙事收敛 | `web` about / llms / homepage | 主站强调计算器 + guides |

卫星站（审稿期）：

```js
export const adsenseEnabled = false;
export const defaultRobots = 'noindex, follow';
```

过审后按需改回 `true` / `index, follow`（README 已记 Review-hardening notes）。

## 5. P1 内容改动

guides 从 3 篇扩到 **10** 篇（`web/src/guides.js` + `web/src/pages/guides/*/index.astro`）。

新增：

| slug | 主题 | 主要工具 |
| --- | --- | --- |
| `15-year-vs-30-year-mortgage` | 期限权衡 | Mortgage |
| `extra-principal-payments-on-a-mortgage` | 额外还本（并注明计算器尚未模拟 extras） | Mortgage |
| `piti-vs-loan-estimate` | PITI / PMI / Loan Estimate | Mortgage |
| `marginal-vs-effective-tax-rate` | 边际 vs 有效税率 | Income tax |
| `federal-income-tax-vs-fica` | 普通税 vs FICA | Paycheck |
| `how-pretax-401k-changes-take-home-pay` | 税前 401(k) | Paycheck |
| `why-annual-tax-divided-by-pay-periods-is-only-a-model` | 年税÷期数模型 vs 15-T | Paycheck |

数字约束：worked example 必须与 `shared/lib/{amortization,federal-tax,paycheck,income-tax,mortgage}.js` 一致，禁止手写与实现漂移的整数。

## 6. Cloudflare 部署事故（VERIFIED）

### 6.1 现象

- GitHub `kedoupi/codepi` 已有新 guides 与 `b90d24b`
- 生产仍为旧 CSS hash、旧 about 文案；新 guide URL 软 404 回首页
- `kdp-portal.pages.dev` 与 `kdp.cool` 一致 → 非自定义域单独缓存问题

### 6.2 根因

| 项 | 值 |
| --- | --- |
| CF 六项目原 Git 源 | `kedoupi/kdp-tools`（`repo_id=1232140953`） |
| 实际代码仓 | `kedoupi/codepi`（`id=992747824`） |
| GitHub 上 `kdp-tools` | 404 |
| 结果 | push 到 `kdp.cool` 无法稳定触发/对齐最新 production 构建 |

### 6.3 修复

1. **直传（已执行）：** 本地六站 `npm run build`，再：

```bash
# 凭证来自本机 CF env；勿把 token 写入仓库
npx wrangler@4 pages deploy <site>/dist \
  --project-name=<kdp-portal|kdp-tools|...> \
  --branch=main
```

映射：

| 目录 | CF project |
| --- | --- |
| `web` | `kdp-portal` |
| `calc` | `kdp-tools` |
| `convert` | `kdp-convert` |
| `text` | `kdp-text` |
| `dev` | `kdp-dev` |
| `ai` | `kdp-ai` |

2. **Git 重绑（操作者手工，已复核）：** 六项目 source → `kedoupi/codepi`，`repo_id=992747824`，branch `main`，root 如上表，`npm run build` / `dist`。

### 6.4 修复后 VERIFIED 状态

- 六项目 `repo=kedoupi/codepi`，root/build/out 正确
- production canonical commit = `b90d24b`，`deploy/success`
- 线上：新 guide 正文、calc 301、卫星 noindex 且无 adsbygoogle、apex 仍加载 AdSense

## 7. 生产抽检清单（每次相关发布后）

```text
[ ] GET kdp.cool/guides/<new-slug>/  — 正文 title/h1，不是首页回落
[ ] GET kdp.cool/guides/             — 列表含全部 guides
[ ] GET calc.kdp.cool/mortgage-calculator/ — 301 → kdp.cool/...
[ ] GET text.kdp.cool/ 与 convert... — robots 含 noindex；无 adsbygoogle
[ ] GET kdp.cool/                    — 仍有 adsbygoogle（审稿主表面）
[ ] CF 各项目 canonical deployment commit == git rev-parse HEAD
[ ] ads.txt 仍含 pub-4790759596265225
```

软 404 特征：未知路径也 200 且 canonical 指向 `/` → 该路径不在当前部署包内。

## 8. 复审节奏（非代码）

| 时机 | 动作 |
| --- | --- |
| 生产对齐后 | GSC 提交 `https://kdp.cool/sitemap-index.xml`；可请求编入新 guides |
| 7–14 天 | 确认新 guides 有收录迹象 |
| 收录后 | AdSense 勾选「已解决问题」并申请审核 |
| 过审后 | `AdSense.astro` placeholder → 真 `<ins>`；按需恢复卫星站 index/ads |

**不要在生产未对齐或索引未更新时立刻复审。**

## 9. 仓库约定（本轮之后）

1. 唯一应用源码仓：`kedoupi/codepi`（禁止 Pages 再指向 `kdp-tools`）。
2. 审稿期卫星站保持 noindex + ads off，除非产品明确要求打开。
3. 不要把 apex 已托管的 mortgage/paycheck/income-tax 再作为 calc 可索引主副本。
4. `shared/` 改动会影响六站 build；push 后按 §7 抽检，不能只信 README 自动部署描述。

## 10. 关键路径速查

| 路径 | 说明 |
| --- | --- |
| `shared/layouts/BaseLayout.astro` | adsense / robots 开关 |
| `shared/components/AdSense.astro` | 占位广告；过审后换 `<ins>` |
| `shared/sitemap-filter.js` | calc 已迁工具、lorem 过滤 |
| `*/src/site.config.js` | 每站 adsenseEnabled / defaultRobots |
| `calc/public/_redirects` | 三工具 301 到 apex |
| `text/public/_redirects` | lorem 301 |
| `web/src/guides.js` | guides 注册表 |
| `web/src/pages/guides/*/index.astro` | guide 正文 |
| `README.md` | AdSense 状态与 Review-hardening notes |
| `CLAUDE.md` | 审稿期 pitfall 提示 |

## 11. 结果一句话

内容上收缩审稿面并加深 guides；工程上去重与 noindex；发布上暴露并修复「CF 仍绑旧仓」导致 push 不上线的问题。当前生产与 `kedoupi/codepi@b90d24b` 对齐，Git 自动构建应恢复；复审需等 GSC 收录后再进行。
