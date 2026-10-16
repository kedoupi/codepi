import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Deliberately bypasses the upload endpoint only in the local D1 emulator.
// These fictional values are never marked live and cannot pass production sync.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const rows = [
  ["GOOGL", "Alphabet Class A", 10, 200, 220, .135],
  ["NVDA", "NVIDIA", 10, 150, 180, .065],
  ["VOO", "Vanguard S&P 500 ETF", 10, 500, 550, .6],
  ["XLV", "Health Care Select Sector SPDR", 10, 120, 130, .05],
];
const total = 20000;
const positions = rows.map(([ticker, name, shares, cost, price, target]) => ({
  ticker, name, shares, avg_cost: cost, price, target, change_pct: .005,
  value_usd: shares * price, pnl_pct: price / cost - 1, weight: shares * price / total, quote_date: today,
}));
positions.push({ ticker: "现金", name: "演示现金", shares: null, avg_cost: null, price: null,
  target: .14, change_pct: null, value_usd: 9200, pnl_pct: null, weight: .46, quote_date: today });
const reports = [
  { id: "demo-post", date: today, trading_date: null, date_source: "front_matter", kind: "盘后复盘",
    headline: "这是一份界面演示：把市场的变化与自己的规则分开记录。所有金额均为虚构数据。",
    action: "只观察", rule: "演示规则", body: "# 演示复盘\n\n**本页全部为虚构数据，仅供本地验收。**\n\n## 持仓回顾\n\n看板将记录账户确认日与行情日期，不把估算结果当作券商结单。\n\n| 标的 | 示例状态 |\n|---|---|\n| NVDA | 停买，不代表卖出 |\n\n## 今日记录\n\n- 先核对数据来源。\n- 保留自己的判断依据。\n", path: `reports/${today.slice(0, 7)}/${today}_演示复盘.md` },
  { id: "demo-research", date: today, trading_date: null, date_source: "filename", kind: "深度研究",
    headline: "长期研究的阅读空间", action: "", rule: "",
    body: "# GOOGL 深度研究（界面演示）\n\n演示内容，不构成投资判断。\n\n## 数据与假设\n\n这里展示原报告正文；旧报告缺少的行动和交易日保持空值。\n", path: `reports/${today.slice(0, 7)}/${today}_演示研究.md` },
];
const data = {
  account: [{ total_usd: total, stocks_usd: 10800, hk_usd: 0, cash_usd: 9200, cash_weight: .46,
    cash_after_dca: .36, holdings_as_of: today, quote_date: today, cash_as_of: today,
    cash_age_days: 0, generated_at: new Date().toISOString(), framework: "本地演示",
    data_mode: "demo", warnings: "全部金额与行情为虚构数据，仅用于本地界面验收。 / 投资日历尚未连接。" }],
  positions,
  risk: [
    { rule_id: "demo-nvda", item: "NVDA 停买", kind: "权重", current: "9.0%", threshold: "≥ 6.5%",
      distance: .3846, level: "已触发 · 停买", triggered: true, action: "不再加仓（演示状态，不是卖出信号）", proximity: "clear" },
    { rule_id: "demo-cash", item: "现金缓冲", kind: "权重", current: "46.0%", threshold: "≥ 14%",
      distance: 2.2857, level: "未触发", triggered: false, action: "", proximity: "clear" },
  ],
  market: [
    { symbol: "^GSPC", name: "标普500（演示）", group: "指数", close: 5000, change_pct: .002, date: today, error: null },
    { symbol: "^IXIC", name: "纳斯达克（演示）", group: "指数", close: 16000, change_pct: -.003, date: today, error: null },
    { symbol: "^VIX", name: "恐慌指数（演示）", group: "指数", close: 18, change_pct: -.01, date: today, error: null },
  ],
  reports,
};
const payload = JSON.stringify(data);
const id = createHash("sha256").update(payload).digest("hex");
const literal = text => `'${text.replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const sql = `INSERT OR REPLACE INTO dashboard_batches VALUES (${literal(id)},${literal(now)},${literal(now)},${literal(payload)});
INSERT OR REPLACE INTO dashboard_current VALUES (1,${literal(id)});`;
const temp = await mkdtemp(join(tmpdir(), "gu-demo-"));
try {
  const file = join(temp, "seed.sql");
  await writeFile(file, sql, { mode: 0o600 });
  execFileSync("node_modules/.bin/wrangler", ["d1", "execute", "codepi-gu", "--local", "--file", file], { stdio: "inherit" });
} finally { await rm(temp, { recursive: true }); }
