# 共享层开发边界

- 此目录没有 package.json；不要安装依赖或引入根 workspace。先查调用方，再决定改动范围。
- `layouts/`、`components/`、`lib/`、`i18n/` 及静态配置由 web/ 主站消费；修改后验证主站。退役工具模块没有线上消费方。
- `styles/`、`brand.ts`、`email/` 也可能影响统一登录和私有应用；不能只查 `@shared` alias，服务端还使用相对路径导入。
- `auth/` 由 GU、Health、GZH Worker 消费，改契约时联动 auth 中心；先读 `auth/README.md`。schema 变更需要各应用自己的版本化 migration。
- 公共产品信息放 `products.ts`，不引入私人业务数据。个人视觉规则以 `../docs/architecture/personal-design-system.md` 为准。
- 并行任务中共享接口由单一写入者维护。新增消费者或共享路径时更新根 `scripts/agent/check.mjs` 的影响映射与回归测试。
