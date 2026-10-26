# CodePi Ops

`services/ops/` 是私有 Cron/Workflow 支撑服务，不是产品，也没有公网 HTTP、workers.dev 或 preview 入口。运行边界以 [AGENTS.md](AGENTS.md) 为准。

## 当前边界

- 仅通过 `GU -> GuMaterialsBackup`、`ME -> MeImportsBackup`、`BLOG -> BlogMediaBackup` 三个只读 named RPC 获取已索引原件；不绑定业务 D1、业务 R2、Auth 或恢复私钥。
- 私有 R2 仅保存公钥加密的备份和非敏感运维报告。v4 完整备份的九库与 GU/Me/Blog 三组原件契约由 [`scripts/cloudflare/backup-core.mjs`](../../scripts/cloudflare/backup-core.mjs) 唯一维护。
- 本地 Wrangler 配置、源码和日期化任务记录不证明当前生产资源、备份实例或外部灾备副本存在；这些状态须按控制面和回执单独核验。

## 开发

从仓库根目录使用冻结 lockfile 安装依赖；本包已有命令：

```sh
pnpm --dir services/ops test
pnpm --dir services/ops build
pnpm --dir services/ops test:runtime
```

普通开发不执行远程发布、导出或恢复，也不记录 secret、恢复私钥、D1 export URL 或真实业务数据。

## 权威操作文档

- [Cloudflare 定时运维](../../docs/development/cloudflare-operations.md)
- [备份恢复 runbook](../../docs/development/cloudflare-backup-restore.md)
- [本地发布操作](../../docs/development/local-release.md)
- [Cloudflare 治理规范](../../docs/development/cloudflare-governance.md)
