# Governance · v2.0.0
1. 设计变更使用 RFC：背景、变更范围、Token 影响、迁移计划、截图、回滚策略。
2. SemVer：major=破坏性 Token/组件 API，minor=兼容新增，patch=文档/修复。
3. 单一事实来源：`packages/tokens/src/tokens.json`；生成文件不可手改。
4. 新组件需要 props 契约、键盘/无障碍规则、Storybook 示例和自动化测试。
5. 资源状态：concept / candidate / approved / production。现有 Logo 母版是 candidate，不得声称平台审核通过。
6. 发布门禁：构建、类型检查、组件测试、视觉回归、人工视觉审核；缺失工具必须标记未验证。
7. 组件弃用：至少一个 minor 版本保留旧 API，发布迁移指南；重大更改提高 major。
8. 品牌 Token 修改需要跨网站、桌面、移动端回归；PR 必须说明影响范围。
