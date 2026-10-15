# codepi.app 四产品收尾

- 状态：部署中
- 基线：d82ba18f1a0a92e7b3f55ae7935b483f64dc1e45
- worktree：/Users/codepi/.codex/worktrees/5748/kdp.cool
- 分支：codex/four-product-retirement
- 协调者、实施者、集成者：本会话 Codex；无并行写入者。
- 范围：首页、GU、GZH、Health；auth 和 shared 为支撑层。
- 域名：codepi.app、gu.codepi.app、gzh.codepi.app、health.codepi.app、auth.codepi.app。
- 用户已授权：产品收尾、发布后线上验证、已上线功能归并 main、Cloudflare 域名管理及旧站下线、相关分支/worktree 清理。旧 kdp.cool（含 www、oura）不保留、不跳转。
- 数据边界：复用现有 D1 数据库及凭证，不删除健康、投资、稿件、认证数据。数据库 UUID 不因命名调整而改变。

## 顺序与验收

1. 核对旧分支实际变更、生产部署及当前实现，区分 squash 合并和未上线功能。
2. 删除退役工具站与首页旧入口，保留博客内容；公众号目录统一为 gzh。
3. 更新域名、登录回调、摘要链接、Health OAuth/MCP 配置与部署检查。
4. 运行受影响测试、类型检查、构建和浏览器回归。
5. 配置新域并部署验证，确认登录与 Oura 回调依赖，再撤旧域及工具站。
6. 提交、归并经验证结果，清理已处理分支及临时 worktree，保留未采用方案的可恢复 Git 记录。

## 分支结论

- #39、#42、#43：GitHub 显示已合并。squash 合并后原 SHA 不在 main 祖先链上，但内容已在 main，不重复合并。
- #20：旧 OTP 编辑者逻辑，生产使用 SSO；不引入。
- #21–#24：交稿上传、版本、弃用/测试稿、读完回执及旧站兼容。main 缺少 `worker/legacy.ts`、`worker/content.ts`、`0005`–`0007` migration；`fagao` 生产部署记录全部指向 main 提交（最新 5dc60af，2026-10-15T06:22Z），因此没有上线。这次不引入新的业务行为，保留分支记录。
- #6：包含退役 gzh-preview 的部署脚本，不引入。
- 已并入 main 的 21 个 codex/oura/fix/docs 分支可删（远程删除需授权）。

## 已完成

- 删除 `calc/`、`convert/`、`text/`、`dev/`、`ai/`（142 个受版本控制文件）与主站旧计算器、指南页、`/tools/` 存档。
- 目录 `fagao/` → `gzh/`，产品标识统一为 GZH；域名、文案、`shared/products.ts`、README/AGENTS 同步。
- 代码与配置切到 `codepi.app`、`gu.codepi.app`、`gzh.codepi.app`、`health.codepi.app`、`auth.codepi.app`。
- Health 去掉 `oura` 旧域路由与双域桥接；`SSO_EXTRA_REDIRECT_URIS` 同时登记新旧回调，登录页按产品名显示（`fagao` 客户端标为「公众号 GZH」）。
- `scripts/agent/check.mjs` 的静态站映射收敛为 `web/`，退役路径按跨应用改动处理，回归测试同步。
- Cloudflare：`codepi.app` zone 内新增 5 条 CNAME，四个 Pages 项目挂上自定义域，HTTPS 已可访问。

## 验证证据

- `node scripts/agent/check.mjs --base origin/main --run`：21 项本地检查全部通过（工作流回归、web×4、auth×3、gu×5、gzh×3、oura×4、shared auth client）。
- `oura` 集成测试 116 项通过，含改写后的新域直连与 settings 回跳用例。
- 新域 `https://codepi.app`、`www`、`health` 返回 200，`gu`、`gzh` 返回 302（重定向到登录）。
- 未覆盖：真实 Oura 授权、邮件投递、线上登录与 Cloudflare Pages 域名状态转 active 需部署后确认。

## 已完成（续）

- 数据迁移：`fagao` D1（44beaaee…，18 篇稿件 + 15 条审核 + 演示元数据）整体复制到新库 `gzh`（1da81739-fc94-4983-b57d-ebeb5a2100b4），逐表内容一致、外键无悬空；旧库保留为回滚副本。
- 全部标识切到 `gzh`：Pages 项目、D1 库、SSO 客户端 id、目录、CI 工作流。SSO 密钥无法回读，已本地生成四组新 client secret 一次性写入 `kdp-auth`（SSO_CLIENTS）与四个应用项目（AUTH_CLIENT_SECRET），旧登录态全部失效，换域后重新登录即可。
- Cloudflare：`gzh.codepi.app` 从 `fagao` 项目移到 `gzh` 项目；`kdp-auth` 的 AUTH_ORIGIN 已改为 `https://auth.codepi.app`。

## 未完成与阻塞

- Oura 应用后台仍只登记旧回调；`health.codepi.app/api/auth/oura/callback` 未登记前 Oura 设备授权不可用（网站登录不受影响）。
- 部署：合并到 `main` 后由 GitHub Actions 部署 `fagao`→`gzh` 与 `oura`；`web`/`gu`/`auth` 需手动部署或触发其 workflow。
- 已处理的远程分支、PR #6/#20–#24 关闭、旧域 `kdp.cool`/`oura.kdp.cool` 自定义域与 DNS 下线、五个退役 Pages 项目与旧 `fagao` 项目/D1 删除，均在部署验证后执行。

## 上架顺序

1. 先在 Oura 应用后台登记 `https://health.codepi.app/api/auth/oura/callback`，旧回调可暂时保留。
2. 合并到 `main` 触发部署，或在各应用内直接部署：`auth` worker → `web`/`gu`/`gzh` 三个 Pages 项目 → `oura` API worker → `oura` 前端。
3. `auth` worker 的自定义域由 `auth.kdp.cool` 改为 `auth.codepi.app` 后，旧域登录立即失效，因此四个应用要在同一批完成部署。
4. 回归新域登录、Health 提供方授权、GZH 预览与 `desk` 摘要，再撤 `kdp.cool` 自定义域与 DNS。
5. 最后删除 `kdp-tools`/`kdp-convert`/`kdp-text`/`kdp-dev`/`kdp-ai` 五个项目，并清理已处理分支。

## 外部依赖

- codepi.app Cloudflare zone 已 active，ID 268a0acf9bae4e2e2cbc4d8a0ba2c342。
- Oura 应用回调待用户在开发者后台登记 `https://health.codepi.app/api/auth/oura/callback`，登记后把 worker `OURA_REDIRECT_URI` 换成新回调并重新部署 oura API。
- 邮件发送域保留 `@kdp.cool`；`codepi.app` 不配置邮件。登录邮件不随站点下线。
- 现有浏览器会话 Cookie 为 host-only；新域需重新登录。MCP 客户端需使用新 endpoint。
