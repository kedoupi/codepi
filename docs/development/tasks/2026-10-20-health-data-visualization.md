# Health 睡眠 / 7 天解读 / 对比页数据可视化重构与发布

- 状态：已实现、验证、合并、发布；线上真实数据浏览待用户确认。
- 日期与执行人：2026-10-20，当前 Codex 会话，本机执行。
- 目标：按已确认的桌面/手机设计稿重构 Health 睡眠、7 天解读、对比三个数据页，
  全部使用已保存真实数据表达，替代原有的原始列表展示。
- 范围：`apps/health` 前端与测试夹具；无 API 协议变化、无新增依赖、无 schema 迁移、无凭证更新。
- worktree：`/Users/codepi/.codex/worktrees/3392/kdp.cool`（开发分支 `codex/health-data-viz`）。
- 开发基线：`3982013f7bd831e36c2aadaff024744c3b0b6f8f`。
- 已验证分支树：`e63b859`；[PR #117](https://github.com/kedoupi/kdp.cool/pull/117)
  squash 合并为 `a00c2f09457a9fc515427edbc9fe5de226df40a2`。

## 实现

- 睡眠页以「这一晚」为中心：日期导航、实际睡眠/入睡用时/清醒时长/睡眠效率，与近期中位数对照；
  主视觉为睡眠阶段 hypnogram 与夜间心率、夜间 HRV 按时间轴对齐（SVG，断口不补零）；
  右侧睡眠组成条形与主睡眠 HRV 个人历史中位 50% 参考带；底部近 7 晚作息横条可切换夜晚。
- 7 天解读页：一条总结 + 覆盖度行；三个有证据支撑的发现（睡眠时长、主睡眠 HRV、压力/恢复），
  各含当前值/对照值/差值/有效样本数；生活记录只作时间线索不表因果；非个人账号降级为摘要，
  不再发起 owner-gated 的 health-records 请求。
- 对比页：当前区间与对照区间逐指标对齐（时长/效率/入睡用时/HRV/夜间心率/步数/血氧），
  可展开逐日双线对齐图与两期分布；样本不足保留原值显示「样本不足」不计算差值；
  手机版为可展开指标行；保留官方分数对照表。
- 数据口径：缺失值不计 0；主睡眠与小睡分开（优先 `long_sleep`）；HRV 只取明确主睡眠；
  睡眠序列（5 分钟阶段、HR、HRV）经 `include_series=true` 加载，>31 天窗口按 API 上限自动分块；
  序列以 bedtime 为原点按 interval 对齐；时间保留记录中的当地时间。
- 新增纯模型 `sleep-model.ts`（时间轴/阶段/中位数/HRV 历史带）与
  `insights-model.ts`（逐夜序列、两窗各 ≥3 天才比较），视图层 `MiniBars/MiniLine/NightTimelineChart`。

## 本地验证

```bash
node --experimental-strip-types --test apps/web/test/*.test.mjs   # 62/62（新增 sleep-model 13 例）
pnpm --dir apps/health typecheck                                   # 0 错误
pnpm --dir apps/health test                                        # 105/105
pnpm --dir apps/health build                                       # 通过
pnpm --dir apps/health test:browser:built                          # normal + SSO 双场景全部 PASS
node scripts/agent/check.mjs --base 3982013f7bd831e36c2aadaff024744c3b0b6f8f --run  # 5 项通过
```

合并后在干净 main 上复跑：`node scripts/agent/check.mjs --base 84383d2 --run` 5 项通过；
`validate-governance.mjs`、`check-migrations.mjs`（23 个文件）、`git diff --check` 全部通过。
PR #117 的 GitHub Actions 未分配 runner（账户付款/spending limit annotation，job steps 为空），
按发布流程记为「未执行」，以本地验证为准。

## 生产发布

本机持有 Git common directory 的 `codepi-production-release.lock`，从干净且等于实时远程
main 的 `a00c2f09457a9fc515427edbc9fe5de226df40a2` 发布；发布前后复查 HEAD、工作区与远程 main 一致。
本次仅 Health API（业务构建带 SHA）与 Health 前端受影响，Auth/Web/GU/GZH/MCP/Ops 保留原版本。

| 服务 | 前一 version | 新 version | 新 BUILD_SHA |
| --- | --- | --- | --- |
| Health API | `c0ef45e9-a3fc-4d7b-9231-2b7057a94c52` | `b17817b4-9c98-46ab-a118-60a6dba580f4` | `a00c2f09457a` |
| Health 前端 | `f93e666f-98c4-43cf-99ae-fa91fd521c1e` | `e532e784-e731-49d0-9720-dce0ed91ff4e` | `a00c2f09457a` |

Health API 经 `deploy:api` 预检、migration 检查、版本上传、100% 切流与 Cron 核对；
无待应用迁移。验收：`HEALTH_EXPECT_BUILD=a00c2f09457a pnpm --dir apps/health check:api`
16 项正式域名检查通过（含 `/api/health` build 契约与旧 MCP/OAuth 404）；
`pnpm --dir apps/health check:branding` 通过，https://health.codepi.app 200 且加载新构建资源。
部署证据记录于 `/tmp/codepi-deployment-evidence.jsonl`（2026-10-20T03:57:19Z，smoke pass）。
发布后 `production-monitor.mjs --require-d1 --require-versions` 全部通过，
八个 Worker 活跃 BUILD_SHA 与 main 一致，Health 自动同步 30 小时内有成功记录。

## 剩余事项

- 序列时间轴采用「bedtime 为原点 + interval 步进」的 Oura 口径；测试夹具只有 6 小时序列，
  真实整晚数据建议用户在线上打开睡眠页确认曲线铺满与阶段颜色。
- 压力/恢复、血氧、生活标签依赖对应 collection 已同步；未同步时对应模块按缺失降级，不显示 0。
- 线上登录、Oura 重连与真实数据浏览验收由用户侧确认。
