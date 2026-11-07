# 设计画布生成器

codepi 全部产品共用一张固定设计画布（`https://claude.ai/artifact/6ktcuY2pcMxnmZMKSTEJtj`，见根 `AGENTS.md` 与 `docs/architecture/codepi-design-system.md` §0）。本目录是画布上画板的**源码**：画布是成品，这里能一键重建全部画板。所有者 2026-11-07 决定生成器随项目放在本仓库。

## 目录

| 路径 | 内容 |
| --- | --- |
| `gen/` | 画板生成脚本：`gen.py`（公共骨架、首页，`add()` 写画板与预览）、`norm.py`（把颜色、字号、间距、圆角吸附到设计规范）、`gen2.py` 规范与组件、`gen3.py` 公共组件、`gen_www.py` / `gen_desk.py` www、`gen_proj.py` project、`gen_jw.py` JW、`gen_health.py` 健康、`gen_pcomp.py` 各项目组件与图表主题、`gen_maps.py` / `gen_tree.py` / `gen_arch.py` 旧版架构与功能图、`gen_now*.py` / `gen_projv2.py` project 改版板、`layout4.py` 全量排版（只在首次建画布时用） |
| `data/heights.json` | 每张画板的高度（板名 → px） |
| `data/*.json` | 交给 arch-diagram 的架构图数据：`www-arch.json`（www 上下文图、分层图、功能树）、`proj-v2.json`（project 改版功能树） |
| `assets/ui/codepi-ui.css` | 画布里的设计系统组件样式（`cp-*`），构建时复制到 `build/project/ui/` |
| `charts/` | 图表主题图：`charts.html` 用 Chart.js 渲染、`shoot.mjs` 截成 `out/*.png` |
| `tools/build.py` | 一键重建，输出到 `build/`（不入库） |
| `tools/render.sh` | 打开预览量真实高度并截图 |

## 用法

```bash
python3 design/canvas/tools/build.py                 # → design/canvas/build/project/*.dc.html 与 build/preview/
zsh design/canvas/tools/render.sh Main:1440 Home-Phone:390   # 量高度，写回 data/heights.json 后再 build
```

- 架构图由 MyBrain 的 arch-diagram Skill（`archdiag.py --theme codepi`）生成，`build.py` 默认在 `~/MyBrain/.agents/skills/workflow/arch-diagram/scripts/archdiag.py` 找，也可用 `--archdiag` 或环境变量 `ARCHDIAG` 指定；找不到时跳过架构图。
- 发布到画布用 MyBrain 的 design-canvas Skill：读线上 `canvas.json` → `canvas_patch.py lint --theme codepi` → `insert` / `resize` 只动目标页 → 发布 → `verify` 读回。画布发布是线上写入，需所有者批准。
- 生成器互相 import 并按顺序重写同名画板（`build.py` 的 `ORDER`），后写的为准。

## 规范

- 页面与说明板只用设计系统组件（`cp-*`）与 token；字号只用规范三套字阶（www 页已严格吸附；其他页面板仍用 `norm.py` 的旧吸附表，随各产品改版改为严格模式）。
- 架构图、功能树、上下文图只用 arch-diagram 生成，不手写，不用竖排文字。
- 只用示例数据，不放真实个人数据、凭据、IP 或私有地址。

## 不在本目录的画板

- 设计系统页的「规范 · 深色主题」（Spec-Dark）、「待决事项对比板」（Spec-Decisions）、「加载与反馈」（Comp-Loading）由其他会话直接在画布上画，没有生成器；改它们以画布为准，或先补生成器。
- 线上设计系统页的「设计规范」（Spec）在 2026-11-07 被其他会话改过（高度与内容），与 `gen2.py` 生成的版本不同；重发 Spec 前先读线上版本对照。
