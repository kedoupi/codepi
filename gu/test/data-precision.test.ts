import { describe, expect, it } from "vitest";
import { validateDashboard } from "../worker/data";
import type { Dashboard } from "../worker/dashboard-types";

function fixture(): Dashboard {
  return {
    account: [{ data_mode: "live", generated_at: "2026-10-13T00:00:00Z", framework: "test", holdings_as_of: "2026-09-16",
      quote_date: "2026-10-12", cash_as_of: "2026-09-16", warnings: "", total_usd: 100, stocks_usd: 60,
      hk_usd: 0, cash_usd: 40, cash_weight: .4, cash_after_dca: .3, cash_age_days: 27 }],
    positions: [{ ticker: "TEST", name: "测试", quote_date: "2026-10-12", shares: 1, avg_cost: 50, price: 60,
      value_usd: 60, weight: .6, change_pct: null, pnl_pct: .2, target: .5 }],
    risk: [{ rule_id: "TEST", item: "测试", kind: "权重", current: "60%", threshold: "50%", level: "触发",
      proximity: "near", triggered: true, action: "测试", distance: .2 }],
    market: [], history: [{ date: "2026-10-12", source: "test", approx: true, weights: { TEST: .6 } }], reports: [],
  };
}

describe("optional quote and precision contract", () => {
  it("accepts unchanged old batches and new optional fields, including negative projected cash", () => {
    const data = fixture();
    expect(() => validateDashboard(data)).not.toThrow();
    Object.assign(data.positions[0], { weight_raw: .60004, quote_time: null, quote_time_status: "unconfirmed",
      quote_session: "unconfirmed", market_time_iso: "2026-10-13T04:00:00+08:00", bar_time: "2026-10-12T21:30:00+08:00" });
    Object.assign(data.account[0], { cash_weight_raw: .39996, cash_after_dca_raw: -.1 });
    Object.assign(data.risk[0], { current_value: .60004, current_unit: "ratio" });
    data.history![0].weights_raw = { TEST: .60004 };
    expect(() => validateDashboard(data)).not.toThrow();
  });
  it.each([
    ["weight_raw", 1.2], ["weight_raw", "0.3"], ["quote_time", "2026-10-15T03:00:00"],
    ["quote_time", "nonsense"], ["quote_session", "guessed"],
  ])("rejects malformed optional position field %s=%s", (key, value) => {
    const data = fixture(); data.positions[0][key] = value;
    expect(() => validateDashboard(data)).toThrow();
  });
});
