# rhythm-hourly

## 计划
- 将按小时方案改为实际工作时间块，新增 `workBlocks` 数据契约。
- 接入实时/历史 API、今天页展示与未配置分类 App 列表。
- 补纯函数、页面、浏览器冒烟和 README 验证。

## 已完成
- 新增 `workBlocks` 类型、实时计算与历史汇总计算；短于 `workBlockMinGapMinutes=2` 的单分钟离座空档并入相邻在电脑前块。
- 接入今天/昨天与历史 API；历史块标记 `appsKind: "category"`，缺失日返回空数组。
- 完成今天页工作块、主 App/前三 App/其余折叠、离座推断说明、未配置分类 App 列表与响应式样式。
- 更新纯函数、API、页面、浏览器冒烟测试与 README 口径。
- 本地等价验证：123 tests passed；Worker/Web TypeScript 与 Svelte check 通过；Vite production build 通过。

## 当前状态
- 代码已完成，待提交；官方验收命令受当前环境缺少 `node`/`pnpm` 阻塞，浏览器冒烟与 `check.mjs --run` 未能按原命令执行。
