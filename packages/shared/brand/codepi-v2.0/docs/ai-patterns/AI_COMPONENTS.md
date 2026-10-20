# AI 原生交互组件规范 · v2.0.0
**以下为设计合同，尚未实现 React 组件。**

| 组件 | 必需状态 | 约束 |
|---|---|---|
| ChatMessage | streaming/complete/error | 代码复制、Markdown、引用可追溯 |
| ModelSelector | ready/unavailable/loading | 不可用原因、明确当前模型 |
| ToolCallCard | queued/running/succeeded/failed/cancelled | 输入输出摘要、敏感数据脱敏 |
| AgentProgress | planning/executing/waiting/done | 真实任务步骤、可取消，不伪造百分比 |
| ApprovalDialog | pending/approved/rejected/expired | 执行前说明目标、权限、风险、影响范围 |
| Attachment | uploading/processing/ready/error | 类型大小、隐私、失败恢复 |
| Citation | available/unavailable | 来源、时间、可点击原始证据 |
| Conversation | online/offline/syncing/conflict | 本地缓存与同步冲突提示 |

AI 不得通过 Loading 暗示已经完成未完成的工作；高风险工具调用必须在实际执行前取得确认。
