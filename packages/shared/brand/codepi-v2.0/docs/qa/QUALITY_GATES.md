# Quality Gates v2.0.0
- G0 无依赖校验：`npm run validate`，当前可运行。
- G1 TypeScript/React 编译：需安装依赖后执行 `npx tsc -p packages/react/tsconfig.json --noEmit`。
- G2 Storybook：需安装依赖后执行 `npm run storybook:build`。
- G3 视觉回归：建议 Playwright 截图 + 基线审批；**未实现**。
- G4 无障碍：建议 axe-core + 键盘人工巡检；**未执行**。
- G5 平台：Apple/Android/微信实际审核；**未执行**。
CI 不得将未执行门禁显示为成功。
