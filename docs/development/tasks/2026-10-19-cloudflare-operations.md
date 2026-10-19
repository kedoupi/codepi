# Cloudflare 定时运维迁移

- 目标：将每 30 分钟巡检和每日六库加密备份从 Actions runner 迁到 Cloudflare。
- 基线：`b248c22f0e626291f5d3880f595430287fea0630`，开工时与实时远程 main 一致。
- Worktree：`<workspace>/.worktrees/kdp.cool/codex/unified-mcp`。
- 当前 Codex 为唯一写入者、共享契约负责人、集成与发布者；无并行写入。
- 开工已有三份同一任务的诊断文档更新，保留并随本批交付，不覆盖原记录。
- 授权：沿用本会话已授权的 commit、push、PR、合并和本地 API 发布。
  本轮不修改计费方案、既有应用凭证、业务数据或 Oura 授权。

## 实施边界

1. 新增 `services/ops/` 支撑服务，无公网域名、无业务 D1，使用 Cron + Workflows。
   复用仓库已有版本的 Wrangler，不引入新的第三方库。
2. 从现有脚本抽取 Worker 可用的巡检、备份和发布范围逻辑，CLI 与云端共用断言；
   备份沿用 RSA 公钥封装、AES-GCM、gzip 和恢复格式，恢复私钥不上云。
3. R2 私有桶保存加密备份，保留 14 天；监控结果只存运维元数据。
   GitHub API 代替本地 Git，逐提交检查改动，保留 revert、删除和 merge 的覆盖。
4. GitHub 仍用于代码/PR/审核。跨平台密文可经 API 上传私有 Release，无需 runner。
   GitHub 凭证缺失、历史不完整或跨平台上传失败必须可见，不能记作全部成功。
5. 新服务进入治理、受影响检查、版本巡检和本地发布流程。
   旧 Actions 调度在新服务就绪后退为手动应急入口。

## 已核实的控制面

- Workers Paid 和 R2 已开通；未购买或修改订阅。
- R2 可用；Workflows 列表为空，当前凭证可访问其控制面。
- 本地 GitHub CLI 的现有凭证失效，环境未提供 `GH_TOKEN`/`GITHUB_TOKEN`。
  连接器可完成本次仓库操作，但不能作为新 Worker 的长期运行凭证。
- 既有 Cloudflare incident/Workers Issues 邮件通知策略启用；实际送达未验收。

## 验收与交付

- 代码已实现，尚未合并或发布。仓库只新增 Ops workspace 的 importer，复用已有的
  Wrangler 4.151.0 与现有依赖快照，未升级任何既有包版本。
- `node scripts/agent/check.mjs --base b248c22f0e626291f5d3880f595430287fea0630 --run`：
  **32/32** 本地检查通过，含四产品/Auth/MCP/Ops、shared auth、治理、
  Health 两种浏览器模式和 MCP 桌面/手机授权流程。日志 `/tmp/codepi-ops-full-checks.log`。
- 固定差异自行审查后补齐暂停实例过期、公钥变化和错误脱敏的保护；未进行独立 Agent 审查。
  最终 CF 脚本、agent 检查与 Ops 合成单测 **127/127** 通过；
  相关备份/恢复单测 **17/17** 通过；Ops 构建和原生 Workerd/Workflows/R2 执行通过。
  日志 `/tmp/codepi-ops-final-tests.log`、`/tmp/codepi-ops-review-fixes.log`、
  `/tmp/codepi-ops-final-build.log`、`/tmp/codepi-ops-final-runtime.log`。
- 本地原生测试发现 Workers 不支持 `redirect: "error"`，已改为手动检查响应，
  继续拒绝意外跳转；六份合成导出均可在进程外解密，缺 GitHub token 仍为失败。
- 治理守门、迁移追加守门、116 个脚本/18 份 JSON lint 与 `git diff --check` 通过。
- 待执行：PR 合并、干净 main 本地发布、首次六库 R2 密文和现有恢复私钥内存解密、
  Cron/Workflows/公网关闭/日志核验。GitHub 长期凭证仍缺失，不声称跨平台备份或
  云端 main 漂移检查已恢复。
