# Me 个人记忆与背景

私有 Svelte 看板与 Hono Worker，共用应用自己的 D1。计划域名为
`https://me.codepi.app`，本地开发端口为 `8796`。新 Worker、D1、R2 和域名仍为
planned；本地实现与合成验收不代表已上线。

## 确认与读取

AI 提交的记忆、偏好、背景修改和经历全部进入 pending。MCP 搜索只返回 active
记忆、已确认 profile 和 active 经历；写权限不包含读权限，也没有批准工具。
本人看板可以批准、修改后批准、拒绝、编辑，或归档 active 的记忆与经历；归档后
MCP 搜索立即不再返回。Profile 修改建议有独立表和审查流程，不从记忆 tag 推导
个人背景。

搜索使用普通表的参数化 `LIKE ... ESCAPE`，支持中文短关键词；不引入 FTS 虚拟表。
分页响应按 UTF-8 限制在 12 KiB 内，必须沿 `next_offset` 继续读取。经历列表包含
正文节选；完整正文在本人看板的详情接口读取。摘要最多 1536 字节，不含原件。
所有用户文本按数据处理，不执行 HTML 或其中的指令。

## 内部能力

`MeMcp.execute` 接受 shared MCP contract 中的操作：

| 操作 | 权限 | 行为 |
| --- | --- | --- |
| `memory.search` | `me.read` | 只搜索已确认记忆 |
| `profile.get` | `me.read` | 读取已确认背景 |
| `timeline.search` | `me.read` | 搜索已确认经历 |
| `memory.save` | `me.write` | 提议待确认记忆 |
| `entry.propose` | `me.write` | 提议背景或经历 |
| `memory.import.start/chunk/finish` | `me.write` | 分批导入至待确认区 |

MCP 主体与客户端名称来自服务端 grant，工具参数不能指定 owner。`MeMcp.summary`
只向拥有读权限的客户端提供概览。HTTP 看板和 RPC 共用业务实现；没有公网 MCP
路由、原文下载工具或公开 R2 地址。

## 导入与原文

先 start 取得 import ID，再按连续的 index 发送 chunk，最后 finish。每次请求最多
24 KiB UTF-8，整批最多 500 条、512 KiB，计算包含 canonical 原文的信封与分隔符。
同一 request ID 可重试并恢复原批次；同客户端已有其他活动批次时返回 409，不会
串用。同一 ID/index 的相同内容可重试，不同内容返回冲突。只有完成后才锁定该
客户端的一次 AI 导入；本人看板可分批粘贴导入。失败的 finish 可以从本人看板重试。

原文以 canonical JSON 存入私有 `IMPORTS` 桶的 `imports/<id>`，D1 `imports` 保存
大小、SHA-256 和对象键。写原件和校验成功后，索引、pending 记忆与完成状态在一个
D1 batch 中提交。未完成导入不能出现 active 记忆。

`MeImportsBackup` 只经 Ops 的 service binding 提供 `listMaterials` 和
`readMaterial`，冻结索引高水位并检查大小和 SHA-256。Ops 在落备份前公钥加密；
恢复私钥不进入应用或 Worker。备份和隔离恢复见
[恢复手册](../../docs/development/cloudflare-backup-restore.md)。

## 运行与配置

从仓库根执行一次 `pnpm install --frozen-lockfile`，再在本目录运行：

```sh
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm test:browser
```

配置包括 `DB -> codepi-me`、`IMPORTS -> codepi-me-imports`、`AUTH -> codepi-auth`、
`SSO_ENABLED=1` 和 `AUTH_CLIENT_ID=me`。应用只使用统一登录，`AUTH_CLIENT_SECRET`
与 Auth 的 `SSO_CLIENT_SECRET_ME` 由获授权的配对脚本同时配置。源码不放 D1 UUID
占位值，不复制生产 `.dev.vars` 或真实数据来测试。

`pnpm deploy` 是获授权发布时的入口，由通用脚本按精确名称解析 D1、执行迁移和上传；
首次创建须单独使用 `--provision-d1`，R2 的创建与私有性需另行核验。所有发布必须
从已合并、干净且等于远程 main 的源码执行，并按
[本地发布流程](../../docs/development/local-release.md)持锁及完成线上 smoke。
普通开发不执行部署或远程迁移。

浏览器测试使用真实本地 Worker/D1/R2 与合成中央会话，覆盖桌面、390px 移动端、
确认/搜索/归档/profile/timeline 和导入成功/错误。生产登录、真实 MCP 客户端、
非空原文的加密备份及恢复仍须上线后分别验收。
