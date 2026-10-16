# 共享层开发边界

- 此目录是私有 pnpm workspace 包 `@kedoupi/shared`，不对外发布 npm。模块使用 `@kedoupi/shared/<subpath>` 导入，`package.json` 的 `exports` 是严格白名单；增加公共入口前先查调用方并同步登记。
- `layouts/`、`i18n/` 及静态配置由 `apps/web/` 主站消费；修改后验证主站。退役工具的 `components/`、`lib/` 已移除，不再作为共享入口。
- `styles/`、`brand.ts`、`email/` 也可能影响统一登录和私有应用；查全部包名导入及文件系统读取。schema 读取、Tailwind content 扫描等文件系统路径不受 `exports` 约束。
- `auth/` 由 GU、Health、GZH Worker 消费，改契约时联动 `services/auth/` 中心；先读 `auth/README.md`。schema 变更需要各应用自己的版本化 migration。
- 公共产品信息放 `products.ts`，不引入私人业务数据。个人视觉规则以 `../../docs/architecture/personal-design-system.md` 为准。
- 并行任务中共享接口由单一写入者维护。新增消费者或共享路径时更新根 `scripts/agent/check.mjs` 的影响映射与回归测试。
