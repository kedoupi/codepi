# 2026-10-26 分支与依赖整理后的全量生产同步

- 状态：生产同步、线上 smoke 与七轮 Observer 观察均已完成；本记录及资源登记表的证据回填待本 PR 合并。
- 目标与验收：从干净、实时 `main` 的发布源完成全部十个生产 Worker 的同步发布，记录完整版本切换、生产 smoke、巡检和观察结果；不把未执行的真实外部流程或所有者使用确认写成完成。
- 范围：本 PR 仅补充发布证据文档，不改运行时代码、资源配置、迁移、secret、binding 或外部业务数据；合并后无需重发业务 Worker。
- 发布源：干净 detached `/Users/codepi/.worktrees/codepi/codex/full-sync-release`，HEAD 与实时远程 `main` 均为 `cc0579cd27677db68a163887b44b07509b3c5ab1`；发布时持有本地 production release lock。累计发布基线为 `7d0c81416a61601123fcde87d140b4980fb21105`。
- 证据 worktree / 分支：`/Users/codepi/.worktrees/codepi/codex/full-sync-release-evidence` / `codex/full-sync-release-evidence`，起始 SHA `cc0579cd27677db68a163887b44b07509b3c5ab1`。
- 协调者 / 发布执行者 / 文档执行者：主会话（OMP）顺序协调并持锁发布；本 worktree 仅写入证据文档。无并行写入者。
- 允许修改的路径：`docs/development/cloudflare-resource-registry.md`、`docs/development/tasks/README.md`、本任务记录。

## 发布与版本

- 已完成 frozen install，并执行 `node scripts/agent/check.mjs --base 7d0c81416a61601123fcde87d140b4980fb21105 --run`：43 项通过；governance、32 个 migration 文件守门与 `git diff --check` 均通过。覆盖所有应用/服务的测试、类型检查、构建及选定浏览器回归。
- 未应用新 migration，未修改 secret、binding 或外部业务数据。
- 以下十个 Worker 均为单一版本、100% 承流，且 `BUILD_SHA=cc0579cd2767`：

| 服务 | 发布前 version | 发布后 version |
| --- | --- | --- |
| auth | `e836432d-dcc7-435e-91e4-6e4ee531f3d1` | `3bdc80ce-0ad9-4f0c-b0fe-ef3bec0bb8cc` |
| web | `c04eb532-1a28-4f34-a240-6cf32438bce9` | `adaf622b-a748-4bcf-98af-6e1a6800e4ec` |
| gu | `23a2ec39-a9f0-4639-a5e6-b5d1927a29fe` | `468470d7-e9de-4bf5-897e-5fe05244898b` |
| gzh | `72aef8c2-6fb5-4413-b231-75d9eb267a30` | `f348474e-d258-480f-bc86-c5ed11b5dc5e` |
| project | `5f0ee11d-0d0a-4e57-b6c3-99d7cdcd53bd` | `8e686f56-8749-4587-8e2f-69f382da9e4b` |
| me | `5a63efaa-3662-4568-9ce5-1af609f4ff80` | `6cdba953-d3e0-45f0-8d52-127a594a1139` |
| health-api | `8c3decbe-373a-45af-9a06-99a2e4a13007` | `2cc50ffd-a0db-4cec-b8e9-a3bdfa05bc16` |
| health-web | `7c2a2a8f-7dea-400f-a2b9-d05377cbbb43` | `5975a18c-9e7a-4f5c-a486-00eab04b9488` |
| mcp | `a3af9f75-52d4-4644-acd0-050c40d5aee1` | `0df7dc61-40cf-4863-8edd-ad2fb804f7a7` |
| ops | `8f722bd4-f5f9-44bb-8d76-ed141dac4ad6` | `ddc50bf2-b263-435c-8f0f-1329af0974b9` |

## 生产验收与观察

- Auth health；Web/GU/GZH `check-pages`；Project/Me readiness 与精确 build；Health API 18 项检查与 branding；MCP `check:live` 均通过。
- 发布后及观察后均执行 `production-monitor.mjs --require-d1 --require-versions` 并通过，包含十个版本漂移与 Health 自动同步新鲜度核对。
- Git 外证据：`/tmp/codepi-deployment-evidence.jsonl`；发布前后快照分别为 `/tmp/codepi-full-sync-cc0579cd2767-before.json` 与 `/tmp/codepi-full-sync-cc0579cd2767-after.json`。这些文件不随本 PR 提交。
- 单一 Observer 为 `release-cc0579cd2767-fullsync`，实例 `cf_35e1f022ae6b23cc6b117d8d4f0b0e8fb8ac2f9ce63dbc7e36597cf39bacb392`。七轮均完成，Workflow 为 `Completed/Success`，summary 为 `state=healthy_reported`、`events=3`、`rollback=null`，于 `2026-10-26T12:58:44.173Z` 完成。summary 位于 `/tmp/codepi-full-sync-cc0579cd2767-observation.json`。
- 首次 31 分钟读取时实例仍为 `Running`、summary 尚未生成，未将其记为成功；最终在第 33 分钟完成后才核实，不需要重发。

## 未覆盖项与回滚边界

- 未执行真实 Oura sleep-diagnosis、对账或补采；没有把 Health 数据修复记为完成。
- 未执行真实 Manus、Claude、ChatGPT 或 IDE 客户端验收，也未获得所有者实际使用确认。
- 本次未执行回滚；Observer 结果为 `rollback=null`。由于未应用 migration、未改 secret、binding 或外部业务数据，本记录不应被当成已演练或已批准的回滚操作；如需回滚，必须按当时 release manifest、预期 active version 与生产回滚安全门另行核对并获得授权。

## 文档 PR 验证

- 本 PR 文档改动后，按其 source/base `cc0579cd27677db68a163887b44b07509b3c5ab1` 执行 `node scripts/agent/check.mjs --base cc0579cd27677db68a163887b44b07509b3c5ab1 --run`、governance、migration guard 与 `git diff --check`；结果见本 PR 对应提交及检查输出。
