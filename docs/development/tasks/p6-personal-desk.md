# P6 本人工作台与按需摘要

> 历史实现记录，以下“未部署”和旧路径描述当次现场。后续已完成
> [Worker 迁移与凭证配对](2026-10-17-web-static-assets.md)；当前接续范围见
> [任务索引](README.md)，不得据本文件重复创建数据库或执行旧 Pages 发布。

- 状态：本地实现与验证完成，未提交、未部署
- 工作区：`<workspace>/.codex/worktrees/c650/kdp.cool`
- 基线：`7a55110c031469133b41ccd42c8ab9dc87aff8dc`
- 执行与公共契约负责人：当前 Codex 会话，单一写入者
- 范围：web、auth、shared/auth、shared/desk、GU/Health/公众号只读摘要适配、检查映射
- 授权：实现及本地验证；本轮不提交、不推送、不修改生产资源。

## 接口与顺序

1. `desk` 作为第四个 SSO 客户端；沿用中央本人身份和全局会话撤销。
2. 主站 `/desk/` 为无私人内容的静态页面壳；Pages Functions 处理 `/api/*`。
3. `/api/desk/overview` 查询当前概览；`POST /api/desk/summary` 接收
   `range: current | week`、`sources: (health | gu | wechat)[]`。
4. 每个领域的 `/api/internal/desk-summary?range=...` 用独立的
   `DESK_SUMMARY_TOKEN` 保护，仅返回摘要字段。工作台持有三份独立服务凭证，
   不转发浏览器 Cookie、不接受自定义上游 URL、不直接绑定业务数据库。
5. Health 仅查询已有 daily_cache / sync_state；现有日缓存没有睡眠时长，
   使用睡眠评分、恢复评分与步数。日期沿用 Asia/Shanghai，与原记录日期保持一致。
6. GU 只描述当前批次，不推算周收益。公众号排除演示稿件，按实际状态计数；
   已进箱不代表已发布。
7. 摘要按需计算、不落库、不请求模型、不触发上游同步。
8. 主站复用共享 BaseLayout 和 tokens；只对个人站增加工作台入口。

## 验收

本人登录与退出、未授权接口、非法来源、接口凭证隔离、部分失败、过期和缺失数据、
期间统计、浏览器桌面/手机、摘要期间退出、公开产物无私人内容。
按照 agent 检查入口运行受影响检查，发布配置与真实邮件/OAuth 另行验收。

## 已完成与验证证据

- 主站页面、第四个 SSO 客户端、三应用只读摘要接口、同域聚合均完成。
- `node scripts/agent/check.mjs --base 7a55110c031469133b41ccd42c8ab9dc87aff8dc --run`：27 项全部通过。
  包含六站构建、calc 40 tests、auth 17 tests、GU 162 tests + 70 script tests、
  公众号 83 tests、Health 各测试/类型/构建与普通/SSO 浏览器回归、共享 SSO 10 tests。
  原始日志：`/tmp/kdp-p6-checks.log`。
- 全量通过后补充 www 规范域名跳转与慢来源测试；再次运行 web 的
  `typecheck:desk`、`test`（10 项全部通过）、`build:functions`、`build`，全部通过。
- `npm run test:browser:desk` 最终通过：真实本地 SSO 登录、生成、七日范围切换、刷新、
  部分失败、空状态、1440/390/320px 无横向溢出、生成期间退出及 DOM 数据清除。
  未出现 JavaScript 运行异常；预期的未登录 401 和主动取消请求不视为故障。
- 桌面/手机截图已人工查看，与主站使用相同 BaseLayout、tokens、字体和视觉布局规则。
  最终截图目录：`/var/folders/tf/by849xr51djfhx_x0fw2rqth0000gn/T/kdp-desk-browser-WD9LgF`。
  截图和测试仅使用合成数据。
- `git diff --check` 通过；未修改依赖锁文件、未引入依赖。

## 发布前仍需完成

参见 `web/README.md`：新增 desk 客户端注册与独立会话 D1、绑定 AUTH，
配置三应用各自的只读摘要凭证，再依次部署与进行生产登录验收。
本轮没有创建线上 D1、设置线上 secrets、发送真实邮件、调用私人生产数据或部署。
Health 只读摘要以已有日缓存为来源；不能把睡眠评分说成睡眠时长。

## 停止写入时的文件范围

审查基线仍为 `7a55110c031469133b41ccd42c8ab9dc87aff8dc`，本轮没有提交。

- `README.md`
- `auth/README.md`
- `auth/scripts/browser-fixture.mjs`
- `auth/src/index.ts`
- `auth/test/auth.test.mjs`
- `auth/test/runtime.mjs`
- `docs/development/tasks/p6-personal-desk.md`
- `fagao/worker-configuration.d.ts`
- `fagao/worker/desk-summary.ts`
- `fagao/worker/index.ts`
- `gu/worker/desk-summary.ts`
- `gu/worker/index.ts`
- `gu/worker/types.ts`
- `oura/workers/api/src/env.ts`
- `oura/workers/api/src/index.ts`
- `oura/workers/api/src/routes/desk-summary.ts`
- `scripts/agent/check.mjs`
- `scripts/agent/check.test.mjs`
- `shared/auth/README.md`
- `shared/auth/client.ts`
- `shared/desk/contract.ts`
- `shared/layouts/BaseLayout.astro`
- `shared/styles/site.css`
- `web/README.md`
- `web/astro.config.mjs`
- `web/functions/api/[[path]].ts`
- `web/migrations/0001_desk_sso.sql`
- `web/package.json`
- `web/public/_headers`
- `web/public/_redirects`
- `web/public/_routes.json`
- `web/public/robots.txt`
- `web/scripts/browser-desk.mjs`
- `web/server/desk.ts`
- `web/src/pages/desk/index.astro`
- `web/src/scripts/desk.ts`
- `web/src/styles/desk.css`
- `web/test/desk.test.mjs`
- `web/test/runtime.mjs`
- `web/tsconfig.desk-web.json`
- `web/tsconfig.desk.json`
