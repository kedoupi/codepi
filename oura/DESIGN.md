# oura.kdp.cool 设计摘要

## 1. 现网数据链路

- 前端：`https://h5.xiaotaozi.cc/health/` — 静态 COS HTML（非 SPA）+ Chart.js
- 数据：公开 SCF，无前端登录、无 Oura token
  - `GET https://api.xiaotaozi.cc/oura/daily?user_id=kedoupi&days=90`
  - `/oura/ai`、`/oura/sync`
- Token 仅在服务端；现为「个人公开看板」模式

## 2. 目标产品

- 用户 Oura OAuth 授权 → 后端代拉数据 → 个人看板
- 自托管友好；域名 `oura.kdp.cool`（CF Pages/Workers；DNS 由运维，本仓不改 DNS）
- 开源仓：`kedoupi/oura-kdp`

## 3. 默认可拍板假设（待建国确认）

| 项 | 假设 |
|---|---|
| 许可证 | MIT |
| 栈 | CF Pages（前端）+ Workers（OAuth/API）+ D1（用户/会话）；refresh token 加密存 D1（或 Worker secrets + per-user encrypted blob） |
| 密钥 | 禁止 client secret / token 写进仓；仅环境变量 |
| OAuth scope | 默认 `daily personal email`（睡眠/准备度/活动） |
| 首版范围 | **不做**现网 AI 诊断（`/oura/ai`）；看板对齐现网：7/30/90 天睡眠/准备度/活动趋势 |
| 多用户 | 每人 OAuth 自己的 Oura；**不做**「公开无登录个人看板」默认路径（可后续加 share link） |
| 仓库 | `kedoupi/oura-kdp`，公开 |
| 分支 | 一律 PR，不直接推 main |

## 4. 安全边界

- `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` / `TOKEN_ENCRYPTION_KEY` 仅环境变量 / Worker secrets
- `.env.example` 无真值；`.gitignore` 含 `.env`
- 前端永不持有 Oura token

## 5. Phase 0 日数据契约（已落地，叠在 OAuth 会话上）

`GET /api/me/daily?days=7|30|90` 主形状对齐现网个人看板，不以扁平 `series[]` 为真源：

```json
{
  "ok": true,
  "from": "YYYY-MM-DD",
  "to": "YYYY-MM-DD",
  "count": 30,
  "days": [{
    "date": "YYYY-MM-DD",
    "sleep": { "score": 76, "contributors": { "deep_sleep": 95, "efficiency": 88, "latency": 43, "rem_sleep": 78, "restfulness": 94, "timing": 90, "total_sleep": 65 } },
    "readiness": {
      "score": 79,
      "temperature_deviation": -0.08,
      "temperature_trend_deviation": 0.06,
      "contributors": { "activity_balance": 79, "body_temperature": 100, "hrv_balance": 89, "previous_day_activity": 91, "previous_night": 77, "recovery_index": 62, "resting_heart_rate": 88, "sleep_balance": 61 }
    },
    "activity": { "score": 97, "steps": 6861, "active_calories": 486 }
  }]
}
```

- 真源样本：`workers/api/src/data/oura_daily_kedoupi_30d.json`（live `user_id=kedoupi`）。
- **DEV** 在 per-user OAuth 之前使用该公开看板数据集（可 live fetch，失败则 bundled 30d）。禁止用正弦波假序列冒充契约。
- **OAuth** 路径：Oura Cloud `daily_*` → `pickSleep` / `pickReadiness` / `pickActivity` → 同一套 `days[]`。
- 看板 CSS 锁死为现网 `h5.xiaotaozi.cc/health/` `<style>` 原文（颜色/间距/组件），禁止另做皮肤。未登录营销页样式只挂在 `#landing-view`，登录后仍走原看板。
- DEV `/api/me/ai` 代理现网 kedoupi AI；per-user OAuth AI 尚未落地（501）。
- 二次解读 MVP：`/insights` 模板周报（中文正文）+ `/compare` 两列对照 + Stripe Checkout ¥39/月占位。不改官方分数算法。未订阅只开放周报前三行。

## 6. 验收清单

- [ ] 仓库公开，MIT，含 DESIGN / README / LICENSE / .gitignore / .env.example
- [ ] Worker 路由占位：`/api/auth/oura/start`、`/api/auth/oura/callback`、`/api/me/daily`
- [ ] 前端看板壳：摘要卡 + 趋势图区（7/30/90）
- [ ] 本地可 `pnpm i && pnpm dev`（或等价）跑通壳子
- [ ] 无真实密钥入库
- [ ] 骨架经 PR 合入，未直推 main
- [ ] 未改 DNS / 未部署生产
