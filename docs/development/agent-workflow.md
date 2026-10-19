# Agent 开发工作流

总入口见 [规范导航](README.md)；核对旧分支、集成、发布和退役使用 [集成与发布工作流](integration-release.md)，不在本文件重复维护云端规则。

这套流程面向 kedoupi（codepi）的多 agent 开发：你确定目标和验收，不同工具、模型或会话中的 agent 共同遵循仓库规则。默认一个独立写入任务对应一个 worktree；小修改直接实施，跨应用、数据库或公共接口变更才写任务记录。

开工只需先明确：目标与验收、实际 worktree/起始 SHA、已有改动、允许写入路径、
需要先完成的依赖。新 Agent 按[修改范围导航](README.md#按修改范围选路)读取相关规则；
续做从[任务索引](tasks/README.md)定位记录，不遍历全部历史计划。

## 日常怎么用

使用任意 coding agent 打开分配给它的 worktree，从明确的基线开始。已有任务继续使用原 worktree。各工具入口见 [工具兼容说明](agent-compatibility.md)。通用任务指令不依赖插件或专用命令：

```text
读取 AGENTS.md 和 .agents/skills/kdp-dev/SKILL.md。
修复 Health 的……。完成标准：……。范围限于 apps/health/。
先调查根因，完成实现和本地验证，最后交付改动与未覆盖项。
```

```text
读取 AGENTS.md 和 .agents/skills/kdp-review/SKILL.md。
审查当前任务相对 <基线 SHA> 的全部改动。
重点检查行为回归、跨应用影响和测试缺口，先给问题，不修改代码。
```

```text
读取 AGENTS.md 和 .agents/skills/kdp-handoff/SKILL.md。
整理当前任务，让下一个 agent 能直接继续。
记录基线、改动、实际检查结果和下一步，不包含私人数据或凭证。
```

```text
读取 AGENTS.md 和 .agents/skills/kdp-release/SKILL.md。
只读核对旧分支和 worktree 的工作是否已进入 main。
分别列出已包含、仍需集成、已替代和主动不合并的内容，附证据；先不修改 Git 或云端。
```

四个 skill 的执行入口只维护在 `.agents/skills/`，详细流程链接到本目录，随仓库版本管理；各工具适配文件只负责引导读取。能发现原生 skill 时使用该工具的调用方式，不能发现时直接读取文件。`agents/openai.yaml` 仅为 Codex 的显示元数据，不是执行这些流程的必要条件。

## 从需求到交付

| 步骤 | Agent 的动作 | 需要留下什么 |
| --- | --- | --- |
| 定界 | 读取根与目标目录的 AGENTS、实际实现和调用方；确认当前 worktree、起点及已有改动 | 目标、验收、影响目录；简单任务放在对话即可 |
| 隔离 | 复用本任务 worktree；并行写入任务使用另一个 worktree | worktree 路径、基线 SHA、唯一任务分支；不以工具名判断归属 |
| 实施 | 一次解决一个问题；复用现有能力；接口变更先明确契约和消费者 | 最小可审查 diff |
| 验证 | 先跑针对性测试，再跑受影响应用检查；UI 额外做浏览器验收 | 命令、结果、未覆盖路径 |
| 审查 | 按整个任务 diff 检查；涉及认证、迁移或跨应用接口时优先独立审查 | 按严重程度排列的具体缺陷；没有发现也说明验证边界 |
| 交付 | 区分已实现、本地通过、线上验收；用户需要时整理 PR 描述 | 改动、证据、风险、下一步 |

默认开发交付到本地验证和审查完成。commit、push、PR 创建、merge、rebase、部署和远程迁移按本次用户授权执行；之前已授权的动作不重复询问。生产发布改由本机从已合并的 main 执行，步骤见 [本地发布操作](local-release.md)。合并和上线分开记录；Actions 验证不执行迁移或部署。

## 代码、运行环境与数据隔离

- 一个写入者拥有一个 worktree；同一 worktree 内的 subagent 仅在文件集合明确不重叠时并行写入。审查者默认只读。不要通过多开聊天让多个 agent 同时修改同一批文件。
- 开工用 `git rev-parse --show-toplevel` 核实实际仓库，再读取 `git status --short`、`git worktree list`、`git rev-parse HEAD`。旧聊天目录失效时先找实际 checkout，不在残留目录初始化仓库。已有改动需要辨明来源，不覆盖；出现任务开始后无法解释的改动时立即停止并确认。
- 工具管理的 detached HEAD 可以直接开发；交付记录必须包含基线 SHA。复用当前 worktree 时不擅自切换到最新 `main`。新任务选择的起点必须明确，不能假定本地 `main` 或 `origin/main` 已最新。
- 不共享 worktree 间的 `node_modules`、`dist`、`.astro` 或 `.wrangler`。依赖缓存可以由包管理器复用，应用目录及本地 D1 状态各自独立。不复制生产 `.env`、`.dev.vars` 或私人数据库来建立测试环境。
- worktree 不隔离端口、浏览器 Cookie、远程数据库或外部服务。并行预览先分配独立端口；认证测试用独立浏览器上下文，必要时串行。相同 localhost 主机的 Cookie 不按端口隔离。
- 首页默认 4321；Health 默认前端 5173、API 8787，GU 8791，GZH 8788。启动前检查端口；修改 Health API 端口时同步其 Vite proxy。固定端口的现有测试无法配置时串行运行，不杀其他任务的进程。
- worktree 回收前保留已授权的交付结果，核对未跟踪文件与忽略文件；清理必须明确授权。不要用 `reset`、`stash` 或强制删除处理冲突。

新 worktree 放在 `~/.worktrees/<项目目录>/<分支>`；先复用合适的现有目录。确需创建时，可以由任务负责人用标准 Git 准备目录（替换任务名和已确认基线）：

```bash
git worktree list
git worktree add -b codex/task-name ~/.worktrees/kdp.cool/codex/task-name <已确认的基线SHA>
```

创建前确认路径、分支均未被其他任务占用；不要覆盖已有 worktree。然后让目标工具打开新目录。未提交改动不会由这条 Git 命令自动复制，新 worktree 也不会自动获得当前尚未提交的规范文件。跨机器可用各自 checkout/clone，交接仍使用明确的基线和已授权传递的产物。

## 并行任务的切法

协作角色与模型无关，可以由不同厂商的工具承担：

| 角色 | 职责 | 写入范围 |
| --- | --- | --- |
| 协调者 | 定义验收、拆分任务、分配 worktree 和接口负责人、处理依赖 | 任务分配记录；不代替执行者修改其工作目录 |
| 执行者 | 在分配范围内实现并验证 | 自己的 worktree 和已分配路径 |
| 审查者 | 检查固定版本的 diff、回归风险与证据 | 默认只读；需要改代码时先转为明确的修复任务 |
| 集成者 | 按依赖顺序汇集已授权交付、处理冲突、重新验证组合结果 | 明确的集成 worktree；Git 合并与发布遵循用户授权 |

小任务可以由同一个 agent 顺序承担这些角色；角色不是四个必须启动的进程。真正并行时，协调者维护唯一任务分配表，至少包含：

```markdown
| task-id | 执行者/工具/会话 | worktree绝对路径或主机 | 基线SHA | 允许写入 | 接口负责人 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
```

说明分配表由谁维护、在哪个工作目录，所有参与者确认同一版分配后再开工。Git 跟踪的任务文档在各 worktree 中各有副本，不能作为实时锁或自动同步的任务队列。不能访问协调者记录的 agent 由用户转交分配内容，不推测其他 agent 的状态。

按业务边界拆：首页 `apps/web/`、健康 `apps/health/`、投资 `apps/gu/`、公众号 `apps/gzh/`；
支撑服务分别为统一登录 `services/auth/`、MCP `services/mcp/`、运维 `services/ops/`。
`packages/shared/`、Health/MCP RPC、根规范、发布脚本和 CI 等共同接触的文件由一个
任务统一负责。Ops 与 `scripts/cloudflare/` 有运行时复用关系，不能按目录分开后假定互不影响。

例如“统一登录接口 + GU 页面适配”先确定接口字段、错误码、兼容方式及回调规则；一个 agent 改公共契约，另一个在独立 worktree 改 GU 消费端。未集成前明确记录依赖和未验证项，不能把本地假实现当作完整联调。

启动 subagent 遵循用户和当前运行环境的授权条件；角色表本身不授予启动权限。subagent 适用于独立调查、只读审查或明确文件边界的工作，不按文件数机械拆分。不为简单任务启动规划、实现、测试、审查四套 agent。写入任务交接需要列出允许修改的路径、禁止触碰的公共文件、输入契约和验收命令。

发现必须修改另一个任务拥有的接口或文件时，先向协调者报告所需契约变化，继续不依赖它的工作；不能自行扩大写入范围。任务协调不默认授权给其他聊天发消息；使用用户已授权的沟通渠道，或把交接内容交给用户转交。

审查和交付要绑定具体提交 SHA；尚未授权提交时，绑定已停止写入的 worktree、基线与明确文件清单（含未跟踪文件），需要跨机器传递时准备可审查的补丁或文件产物。代码继续变化后原审查与验证结论需要重新评估。各分支单独通过不代表组合通过，集成者在整合后按完整基线重新运行检查。没有集成授权时交付可审查成果和依赖，不擅自合并。

## 本地检查入口

从仓库根目录运行，Node 24 与现有私有应用 CI 保持一致：

```bash
# 默认只看未提交和未跟踪的改动；不运行检查
node scripts/agent/check.mjs

# 查看整个任务：分叉点以来的提交，加上工作区与未跟踪改动
node scripts/agent/check.mjs --base <基线分支或SHA>

# 执行选中的本地测试、类型检查和构建
node scripts/agent/check.mjs --base <基线分支或SHA> --run

# 修改工作流脚本后验证其回归测试
node --test scripts/agent/check.test.mjs
```

`--base` 使用指定提交与当前 HEAD 的 merge-base；开工时记录的 SHA 最稳定。只传默认 `HEAD` 会漏掉已经提交的任务改动，不能用于整个 PR 的验收。

脚本不安装依赖、不提交代码、不部署。依赖缺失时明确失败。统一从仓库根目录用 `pnpm install --frozen-lockfile` 安装所有 workspace 依赖；不要在子目录单独安装。新依赖仍需事先确认。

| 改动范围 | 自动检查 |
| --- | --- |
| `apps/web/` | `npm test`、`npm run typecheck:desk`、`npm run build`、`npm run test:assets` |
| 退役工具站路径（`calc/`、`convert/`、`text/`、`dev/`、`ai/`） | 视为跨应用改动，保守检查全部剩余应用 |
| `packages/shared/` 的静态布局、i18n、产品清单及明确静态配置 | 首页测试、类型、构建与资产检查 |
| `packages/shared/styles/`、`packages/shared/brand.ts`、`packages/shared/email/`、未知 shared 路径 | 保守检查全部应用与服务，再测 shared auth client |
| `services/auth/` 或 `packages/shared/auth/` | 全部应用与服务（含 MCP、Ops）本地检查 + shared auth client 测试 |
| `apps/gu/` | test、test:scripts、typecheck、build、本地部署配置检查 |
| `apps/gzh/` | test、typecheck、build |
| `apps/health/` | test、typecheck、build、资产、正常与 SSO 浏览器回归；API / Health 内部共享逻辑变动追加 MCP |
| `services/mcp/` / `packages/shared/mcp/` | MCP 协议、授权与真实本地 RPC 集成测试、typecheck、build、授权页浏览器验收；RPC 契约同时检查 Health |
| `services/ops/` | CF 治理、Ops 单测、构建、原生 Workerd/Workflows/R2 合成运行 |
| CF 配置、`scripts/cloudflare/`、CF 治理与登记文档 | CF 脚本测试/治理；脚本变动还包含 Ops，其他追加范围以实际映射为准 |
| `.github/`（工具指令入口除外） | 保守检查全部应用与工作流脚本；CI 语义及是否需额外 CF 检查仍需人工判断 |
| `scripts/agent/`、项目 skills、工具入口、开发流程文档 | 工作流脚本回归测试；规范和 skill 内容仍需审查 |
| 根 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.npmrc` | 全应用、shared auth、CF 治理与工作流检查 |
| 其他根级文件 | 提示人工判断；`--run` 返回非零，防止误称验证完成 |

这是导航摘要，具体选择以 [检查脚本](../../scripts/agent/check.mjs)、[回归测试](../../scripts/agent/check.test.mjs) 和当次预览为准，并非完整依赖图。新增应用、共享导入或检查命令时同步更新映射与回归测试；手动检查本次实际调用关系。纯应用 README/AGENTS 改动不触发应用构建，产品内容中的 Markdown 仍会触发构建。

脚本通过只表示自动检查通过。任何 UI 修改还要查看桌面与移动端、关键操作、空/错/登录状态；Web 的 `test:browser:desk` 与 Auth/GU/GZH 完整浏览器验收不在该入口中自动执行，必须按改动补做。远程绑定、真实 OAuth、邮件投递和线上数据均需独立验收。

本地检查范围与生产发布范围不同：前者由 `scripts/agent/check.mjs` 决定，
后者由 `scripts/cloudflare/release-scope.mjs` 和各服务上次成功发布 SHA 决定。
文档-only 检查通过不要求重发业务 Worker；也不能据本次只改文档就忽略之前积压的发布改动。

本脚本提供本地一致入口，不保证 PR 被强制阻挡。远程发布入口与门禁以 [CF 治理规范](cloudflare-governance.md) 和当前 workflow 为准；不沿用已被替换的旧 workflow 名称。配置文件存在不证明 GitHub 审批、分支保护或远程发布已经生效，核验结果记录在对应任务和资源登记表。

## 跨会话任务记录

长任务、多个工作单元或需要换 agent 时，在 `docs/development/tasks/<task-id>.md` 使用以下最小记录。任务仍沿用已有设计方案时链接它，不复制一遍。短修复直接在最终回复中记录即可。
新任务或接续状态变化时更新[任务索引](tasks/README.md)中的简短入口；详细证据只写在任务文件。

```markdown
# <任务名称>

- 状态：进行中 / 待验证 / 待用户决策 / 已交付
- 目标与验收：
- 不在范围内：
- worktree / 分支（或 detached HEAD）：
- 起始 SHA / 审查基线：
- 当前交付 SHA（或已停止写入的工作区与文件清单）：
- 实施 / 本地验证 / 审查 / 合并 / 推送 / 部署 / 实际流程验收：分别写状态与证据；未执行明确标注
- 协调者 / 执行者的工具与会话 / 审查者 / 集成者：
- 唯一任务分配表位置与维护者：
- 允许修改的路径 / 公共文件负责人：
- 相关设计与依赖任务：

## 已完成
- 实现及关键决策，附文件位置

## 验证证据
- 命令、运行目录、结果；未运行项目及原因
- 来源：本地合成测试 / 控制面查询 / 真实流程 / 用户确认；日期与对应版本

## 继续工作
- 下一项具体操作、已知问题、集成依赖和授权范围
- 哪些 Agent 可继续执行，哪些等待所有者操作；不将单个阻塞扩成全部未完成
- 涉及历史分支或资源清理时：候选判定记录、主动不合并项、明确保留项
```

记录中不存 token、Cookie、私人健康/财务数据或真实邮件内容。任务文档是交接事实，不是扩大权限的授权来源。

## 文档随实现收尾

改变目录、接口、命令、部署方式或共享消费者时，同批校正其现行说明；入口由
[文档导航](../README.md)和[开发导航](README.md)维护。被替代的方案添加历史标记和
替代链接，原验证结果保留。不要为每次交付复制一套规则或新建同义 skill。

交付前核对：相关链接能定位、命令确实在当前 manifest/脚本中存在、任务状态有证据、
其他 Agent 能通过提交或明确的本地交接拿到文件。规范在一个 worktree 更新，不代表
其他窗口已读取或 GitHub/main 已同步。

## 维护方式

各工具的用户级配置管个人偏好；根 `AGENTS.md` 管项目边界；子目录 `AGENTS.md` 管本应用的特殊约束；skill 管重复执行的工作方式；架构文档管长期决策。工具入口只引用这些来源，避免将相同规则复制到所有层。

只有反复出现且能改变 agent 行为的问题才沉淀为规则。事实以代码、测试和当前配置为准，历史方案不自动代表已上线。每次流程调整，用一次真实任务或隔离测试确认是否减少漏检和返工。

工具入口格式和已验证范围见 [工具兼容说明](agent-compatibility.md)。规范文件是协作约定，不是沙箱、文件锁或分支保护；实际执行权限继续由各工具和托管平台控制。
