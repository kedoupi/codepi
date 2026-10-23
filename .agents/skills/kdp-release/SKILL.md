---
name: kdp-release
description: 核对 codepi 旧分支或 worktree 是否已归并、集成有效改动、发布产品与支撑服务或清理旧资源时使用；不用于普通功能开发。
---

# kedoupi 集成与发布

读取根 `AGENTS.md` 和 [集成与发布工作流](../../../docs/development/integration-release.md) 的相关阶段。涉及具体应用时读取其局部规则；涉及 Cloudflare 时再读取 [治理规范](../../../docs/development/cloudflare-governance.md) 和 [资源登记表](../../../docs/development/cloudflare-resource-registry.md)。不要求仅核对 Git 的任务加载云端流程。

1. 确认请求是只读盘点、集成、发布还是退役；列明实际授权边界。询问“合并了吗”不授权 Git 或云端修改；已有明确授权无需重复索取。
2. 核实实际 Git 根目录、HEAD、分支与所有相关 worktree 的改动。聊天旧路径不是事实；保护已有文件和未提交工作，不自动切分支或清理。
3. 盘点时按 ancestry、单个/累计补丁和当前实现给候选分类，并记录目标 SHA 与证据。已被替代或明确放弃的旧 fagao/工具站不整支恢复；无法确认的内容不删除。
4. 集成时在固定快照审查有效差异，按依赖顺序整合并验证组合结果。发布与清理分别执行工作流中的门禁；遇到冲突、身份不唯一、验证失败或新影响就停止相应变更，不绕过。
5. 正常发布从干净且等于远程 main 的源码在本机执行，按 [本地发布操作](../../../docs/development/local-release.md) 持锁、验证、按依赖发布并记录证据。按每个服务上次成功发布以来的累计改动确定范围，Health 前后端分别记录；MCP/Ops 是支撑服务而非额外产品。Actions 只做附加验证，不把合并当成上线，纯文档修改不单独触发业务重发。
6. 输出候选判定、版本与证据、实际完成的 Git/部署/验收/清理步骤，以及保留项和阻塞。明确本地 main、远程 main 与云端 deployment 的区别；未执行阶段不宣称完成。

本 skill 不授予 commit、push、merge、部署、密钥更新、删除数据或给其他会话发消息的权限。跨会话续做按 [kdp-handoff](../kdp-handoff/SKILL.md) 留下事实，不保存凭证或私人数据。
