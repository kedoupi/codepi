# 当前任务

这里只保留仍需开发、验证或所有者操作的事项。已完成的发布、迁移和客户端验收记录按年度放入[档案](../archive/README.md)，不再逐项堆在当前索引中。历史记录中的“待部署”或“待配置”不能覆盖后续源码和更新的证据。

| 工作 | 当前事实 | 下一步 |
| --- | --- | --- |
| Blog/MCP 参数与下架修复续验 | PR #218/#219 已合并并发布；记录中有 GU、Project、Me、Health API 四项版本漂移 | 按[2026-10-28 续验记录](2026-10-28-blog-mcp-followup.md)核对真实客户端和漂移，不从旧记录直接执行发布 |
| Health 主睡眠缺失诊断 | PR #206 已合并并发布，真实 Oura 对账和数据修复未执行 | 按[诊断记录](2026-10-26-health-sleep-diagnosis.md)继续数据侧定位，不修改真实数据作为普通开发步骤 |
| Rhythm 作息页面待合并 | `codex/rhythm-pages`（含 rhythm-daily、rhythm-trends-ui，P1–P4）相对 main 全量检查 2026-11-04 两次各只失败 `web test:browser:desk:built`（下行的并行不稳定，与 Rhythm 无关，单独重跑 3/3 通过）；数据侧在 MyBrain 尚未部署 | 并行检查稳定后再全量检查并合并；发布与 MyBrain 数据侧一起另行授权 |
| Blog 内联图片上限 1 MiB 待合并 | `codex/mcp-blog-inline-upload-limit` 2026-11-04 提交并同步 main；mcp 75、cli 58、web 53 项单独运行通过，全量并行检查有下行的不稳定失败 | 所有者决定是否合并；生效需发布 web 与 mcp |
| 全量检查并行不稳定 | 2026-11-04 `check.mjs --run` 并行时：Desk 浏览器测试等待条件在触发前已满足（`browser-desk.mjs`「concurrent initialize」竞态）；MCP 测试重建 CLI 时与 CLI 测试并发撞 `dist`；miniflare 偶发 ECONNRESET。单独运行均通过 | 修测试等待条件、串行化构建依赖后复测 |
| 旧生产 SSO 验收脚本 | `services/auth/scripts/verify-production.mjs` 仍含退役 Pages 目标且会发送真实邮件 | 使用时先更新目标与覆盖范围，并单独取得真实邮件授权 |
| MCP / Blog / Desk 实际使用 | 实现和日期化发布证据已存在，真实客户端、所有者持续使用和部分专项验收不由本地测试证明 | 按各应用 README 和对应档案中的证据验收，不重建既有资源 |

## 使用约定

- 新增长任务或跨会话交接时新增 `YYYY-MM-DD-topic.md`；小修复只在回复中交付。
- 状态改变时更新本表；完成任务只移动到档案索引，不复制完整日志。
- 每个事项链接最新证据；无法确认线上状态时明确写“未核验”，不把旧快照当实时状态。
- 记录不包含凭证、Cookie、私人业务数据或完整邮件内容。
