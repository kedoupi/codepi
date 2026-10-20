# CodePi Design System v2.0.0
**状态：工程基础版（可复用源码 + Storybook 配置 + 静态模板 + 本地自动化校验）。**
品牌：石墨灰 `#5E5A56`、活力橙 `#FF713D`、暖白 `#FAF8F4`。

## 快速开始
- `npm run validate`：无外部依赖的 Token 构建与结构检查。
- `npm install` 后 `npm run storybook`：运行 Storybook（依赖安装和实际启动仍需验证）。
- `apps/playground/index.html`：直接在浏览器查看三种静态页面模板。
- `AGENTS.md`：AI 开发入口。

## 交付范围
已实现：Button、Input、Card、Loading、Feedback 的 React 源码与部分 Stories；Token 单一源与生成脚本；静态官网/Dashboard/AI Workspace 模板；Node 内置测试。
仅规范：完整 AI 组件、复杂表格/导航、发布流程、视觉回归与跨端原生测试。
Logo SVG 为候选重建母版，需人工审批。旧版 QA 报告属于历史快照，不是 v2.0.0 的测试结果。

## 文档入口
- docs/patterns/INTERACTION_STATES.md
- docs/ai-patterns/AI_COMPONENTS.md
- docs/templates/TEMPLATES.md
- docs/governance/GOVERNANCE.md
- VALIDATION_REPORT_V2.md
