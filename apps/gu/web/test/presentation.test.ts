import { describe, expect, it } from "vitest";
import { elapsed, percent, weight, ruleCurrent, reportAction, reportCategory, ruleAction } from "../src/format";
import { accountAlerts } from "../src/risk-summary";
import { headings, markdown } from "../src/markdown";
import { allocationGap, riskRail } from "../src/charts";

describe("consistent financial presentation", () => {
  it("uses raw weights before rounding to a single display precision", () => {
    const row = { ticker: "XLV", weight: .0355, weight_raw: .035499343, target: .12 };
    expect(percent(weight(row))).toBe("3.5%");
    expect(percent(.0355)).toBe("3.6%");
    expect(allocationGap([row])).toContain("3.5%");
    const risk = { ...row, kind: "权重", current: "3.6%", current_value: .035499343, current_unit: "ratio" };
    expect(ruleCurrent(risk)).toBe("3.5%");
    expect(riskRail([risk])).toContain("当前 3.5%");
    expect(weight({ weight: .4 })).toBe(.4);
  });
  it("labels cash as a minimum and makes no unsupported freshness claim", () => {
    expect(allocationGap([{ ticker: "现金", weight: .4, target: .14 }])).toContain("最低 14.0%");
    expect(elapsed(null)).toBe("时间未记录");
    expect(elapsed("2026-10-15T00:00:00Z", Date.parse("2026-10-15T03:00:00Z"))).toBe("3 小时前生成");
  });
});

describe("complete financial text", () => {
  it("retains report amounts, shares, links and reading structure", () => {
    const text = "# 账户 $123,456.78\n## 持仓 214.6206 股\n组合当日 +350 美元，现金两万美元。\n## 下一步\n[来源 2026](https://example.com/123456)\n## 记录\n保留自己的判断。";
    const rendered = markdown(text);
    expect(rendered).toContain("$123,456.78");
    expect(rendered).toContain("214.6206 股");
    expect(rendered).toContain("+350 美元，现金两万美元");
    expect(rendered).toContain('href="https://example.com/123456"');
    expect(headings(text)).toHaveLength(4);
    expect(rendered).toContain('id="report-section-4"');
    expect(markdown("1. 成交 350 美元\n2. 保留记录")).toContain('<ol start="1"><li>成交 350 美元</li><li>保留记录</li></ol>');
  });
  it("preserves complete warning and action details while escaping HTML", () => {
    const text = "⚠️ 月投 30000 美元后 12345 美元触发硬刹车";
    expect(accountAlerts(text)).toContain(text);
    expect(accountAlerts("⚠️ <script>账户 12345 美元</script>")).toContain("&lt;script&gt;");
    expect(ruleCurrent({ current_value: 160, current_unit: "USD" })).toBe("$160.00");
    expect(reportCategory("2026-10-15_盘后复盘_亏损350美元")).toBe("盘后复盘");
    expect(reportAction("只观察")).toBe("只观察");
    expect(reportAction("卖出 350 美元")).toBe("卖出 350 美元");
    expect(reportAction(null)).toBe("历史报告未记录行动");
    expect(ruleAction({ rule_id: "NVDA_stop_buy", triggered: true, action: "停买，保留现有持仓；不是卖出信号" })).toContain("不是卖出信号");
    expect(ruleAction({ rule_id: "unknown", triggered: true, action: "减持12345" })).toBe("减持12345");
  });
});

describe("long report navigation", () => {
  it("matches unique section ids and excludes code blocks", () => {
    const text = "# 标题\n## 重复标题\n```\n## 代码\n```\n## 重复标题";
    const sections = headings(text);
    expect(sections.map(h => h.id)).toEqual(["report-section-1", "report-section-2", "report-section-3"]);
    expect(sections).toHaveLength(3);
    for (const section of sections) expect(markdown(text)).toContain(`id="${section.id}"`);
    expect(markdown(text)).not.toContain("<h1");
  });
  it("retains ordered lists and escapes headings and unsafe destinations", () => {
    const rendered = markdown("3. 第三项\n4. 第四项\n- 无序项\n## <script>alert(1)</script>\n[危险](javascript:alert(1))");
    expect(rendered).toContain('<ol start="3"><li>第三项</li><li>第四项</li></ol><ul>');
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain('href="javascript:');
  });
});
