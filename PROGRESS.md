# rhythm-polish 进度

## 计划
- 修正 live 状态卡无可判断数据时的 `asOf` 语义与前端文案。
- 修正手机 `no-response` 沿用快照前态时的 20 分钟有效期。
- 补齐共享状态、解析、API 与页面测试，升级每日算法版本。
- 更新 README 与 Rhythm 开发边界，运行任务要求的验收命令。

## 已完成
- `PhoneObservation` 增加独立 `validity` 字段；沿用快照前态的事件 `no-response` 继续按快照 freshness 判断，事件前态仍按事件区间判断。
- 新增状态单测和共享 fixture，覆盖快照在线后 10 分钟事件 `no-response` 在第 30 分钟仍有效、第 31 分钟未知。
- 上游布尔解析测试覆盖 `NaN`、`undefined` 与缺失字段，并断言 `locked`/`scan_ok` 为 `null`。
- 针对性验证：`bun node_modules/vitest/vitest.mjs run test/domain/state.test.ts test/domain/upstream.test.ts`，52 tests passed。

## 当前状态
- 核心状态修复已验证，准备提交。
- 当前状态卡、版本号、文档和全量验收尚未完成。
