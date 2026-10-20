# Interaction States · v2.0.0
状态机：idle → pending → success | error | cancelled。offline 和 partial 是独立状态。
| 状态 | 表现 | 恢复 |
|---|---|---|
| Empty | 原因、下一步 CTA | 新建/导入 |
| Loading | 300ms 内避免闪烁，2s 后状态文字 | 10s 后取消或后台继续 |
| Error | 明确失败与重试，不泄露内部栈 | 重试/反馈 |
| Offline | 标记缓存和同步时间 | 网络恢复后重试 |
| Partial | 区分完成和失败部分 | 仅重试失败项 |
| Success | 非阻塞确认、结果链接 | 查看结果 |
| Disabled | 原因说明，不能只靠颜色 | 条件满足后恢复 |
| Cancelled | 停止动画与后台任务，告知结果 | 重新发起 |
不可逆操作必须说明影响范围并二次确认；按钮提交需防重复点击；键盘和 reduced-motion 必须支持。
