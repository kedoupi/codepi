# audit-fixes 报告

## 改动

- `packages/shared/mcp/contract.ts`：新增 `MCP_REQUEST_LIMIT = ceil(1 MiB / 3) * 4 + 16 KiB`，覆盖 inline 图片 base64 与 JSON-RPC 开销。
- `services/mcp/src/protocol.ts`：使用共享请求体上限。
- `services/mcp/test/connector.test.mjs`：验证恰好 1 MiB 上传成功、1 MiB + 1 字节返回 `payload_too_large`，以及超限请求体仍返回 413。
- `services/mcp/test/legacy-sse.test.mjs`：同步 413 边界。
- `scripts/agent/check-plan.mjs` / `check.test.mjs`：Health 与 MCP 测试共享 `health-api-dist` 锁，并断言事件存在。
- `.github/workflows/deploy-platform.yml`：`shared-auth` 运行 registry 不变量测试。

## 提交

- `0bff794 fix(mcp): allow one MiB inline image requests`
- `eb9e0ab test(ci): serialize health artifacts and run registry checks`

## 已验证

- `pnpm install --frozen-lockfile --offline`：通过。
- `pnpm --dir services/mcp test`：77/77 通过。
- `node --test scripts/agent/check.test.mjs`：22/22 通过。
- `node --experimental-strip-types --test packages/shared/registry.test.mjs`：5/5 通过。
- `node scripts/agent/lint.mjs`：通过。
- `node scripts/agent/check.mjs --base main --run`：通过，38/38 项本地检查通过（含各应用测试、构建、浏览器 smoke、MCP 77 项测试与 registry 5 项测试）。

未修改文档：工具描述、MCP README 与 Blog guide 已一致声明解码后 1 MiB。
