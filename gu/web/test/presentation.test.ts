import { describe, expect, it } from "vitest";
import { elapsed, percent, weight, ruleCurrent } from "../src/format";
import { accountAlerts } from "../src/risk-summary";
import { reportAction, reportCategory, privateWarning, ruleAction } from "../src/privacy";
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

describe("private free text", () => {
  it("uses safe summaries while keeping rule actions readable", () => {
    const text = "⚠️ 月投 30000 美元后 12345 美元触发硬刹车";
    expect(accountAlerts(text, true)).not.toMatch(/30000|12345/);
    expect(accountAlerts(text, true)).toContain("暂停");
    expect(privateWarning("情绪疲劳锁：已亏损 350 美元")).toContain("48 小时");
    expect(privateWarning("账户 123456 美元")).not.toContain("123456");
    expect(reportCategory("2026-10-15_盘后复盘_亏损350美元")).toBe("盘后复盘");
    expect(reportAction("只观察", true)).toBe("只观察");
    expect(reportAction("卖出 350 美元", true)).not.toContain("350");
    expect(ruleAction({ rule_id: "NVDA_stop_buy", triggered: true, action: "停买，账户12345" }, true)).toContain("停买不是卖出信号");
    expect(ruleAction({ rule_id: "unknown", triggered: true, action: "减持12345" }, true)).not.toContain("12345");
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
