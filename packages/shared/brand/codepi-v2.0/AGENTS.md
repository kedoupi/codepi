# CodePi Agent Entry · v2.0.0
1. 先读 README.md、docs/governance/GOVERNANCE.md、AI_DESIGN_RULES.md。
2. 使用 packages/tokens/src/tokens.json，运行 `npm run tokens:build` 生成 CSS；禁止直接修改生成物。
3. 组件从 packages/react/src 导入，先复用再新增。
4. AI 产品参考 docs/ai-patterns/AI_COMPONENTS.md；交互状态参考 docs/patterns/INTERACTION_STATES.md。
5. 提交前运行 `npm run validate`；若安装了依赖再运行 Storybook 构建与 TypeScript 检查。
6. 禁止声称 Logo 最终批准或平台实际审核通过。
