# 2026-10-28 MCP Blog 提交参数契约修复

## 根因与范围

ChatGPT 提交 Blog 时收到 `invalid_arguments`。新增头图与分类/标签模型后，Blog 服务端要求
`cover_media_id`、`category`、`tags`，但 `blog_submit` 的 MCP schema 仍只把
`slug/title/summary/body_markdown` 声明为必填。模型按 schema 省略字段后才进入服务端拒绝路径；
已有集成测试只使用完整 payload，没有断言对外 schema 与后端必填契约一致，因此未覆盖该缺口。

修复提交 `c170a804e555840c088c6a2e2ab96c253b3ee90c`：补齐 MCP schema required 列表并添加契约回归测试。
没有放宽服务端参数、内容或图片校验，没有提交或修改真实稿件。

## 本地验证与交付

- 新增回归测试修复前明确失败，缺失的 required 字段正是 `cover_media_id/category/tags`；修复后通过。
- MCP 完整测试 64/64、typecheck、build、浏览器验收通过；串行包含脚本入口的测试 67/67 通过。
- 并行 MCP 重跑出现一次 Miniflare `ECONNRESET`，串行重跑全部通过，不将其计为通过前的成功证据。
- frozen install、治理与 35 个 migration 文件守门通过。Web 49 项、Desk typecheck、build 与 assets 检查通过。
- GitHub Validate platform 首次仅 `health-build` 因 Chrome startup timeout 失败；单独重跑后全部 job 成功。

## 生产发布

- 发布时控制面显示 Web/MCP 均已承载前一基线 `0f62999df7b1`；`codepi-blog` 与 `codepi-desk`
  migration list 均无待应用 migration。因此本次只部署 MCP，不重复迁移或发布 Web。
- 从干净且等于实时远程 main 的 `c170a804e555...` 持锁发布 MCP：`0bdbc60d-262f-4852-9132-62e021a82007`
  → `76f3f4a9-3f00-4a0c-a0f5-3f61f4b714b4`，100% 承流，`BUILD_SHA=c170a804e555`。
- 无 migration、secret、binding 或外部业务数据变更。MCP 精确 build 与匿名 smoke、Auth health 通过。
- 通过现有 CLI 的正常凭证 refresh 后只读生产 `tools/list`，确认 `blog_submit` 已公开三项新增 required；
  没有调用 Blog 工具或写入生产内容。ChatGPT 连接器的 schema 缓存需重新连接或刷新。
- 全量生产 monitor 的 MCP 及核心检查通过；GU、Project、Me、Health API 仍有既有版本漂移，
  本次未扩大发布范围，不能称全局巡检全绿。
- 部署证据写入 Git 外 `/tmp/codepi-deployment-evidence.jsonl`。单一 Observer
  `release-c170a804e555-blogschema`（`cf_1c45efc2b1061924395de8b3ff5307898a5b25470aca6357ece0ace3c37d1d94`）已触发；
  首轮 healthy、22 项 core checks 通过、MCP 版本一致。Observer 于 `2026-10-28T11:58:47.583Z`
  完成，`state=healthy_reported`、`events=3`、`rollback=null`；末轮 MCP healthy、版本一致、22 项 core checks
  全部通过，metrics 为 null，不把缺失指标样本解释为没有请求。Issue #169 开始与完成通知已核对。
  观察完成不代替所有者实际 ChatGPT 投稿确认。
