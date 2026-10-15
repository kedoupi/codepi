import { describe, expect, it } from "vitest";
import { calendarPanel } from "../src/calendar";

describe("read-only calendar display", () => {
  const format = (value: unknown) => String(value);
  it("distinguishes no connection from a successful empty query", () => {
    expect(calendarPanel(null, false, format)).toContain("尚未连接");
    expect(calendarPanel(null, false, format)).not.toContain("窗口内没有日历事件");
    expect(calendarPanel({ state: "empty" }, false, format)).toContain("本次查询成功");
  });
  it("keeps cached events qualified after a failure and escapes complete event titles", () => {
    const view = { state: "failed", last_success: { fetched_at: "2026-10-15T00:00:00Z" },
      snapshot: { stale: true, events: [{ title: "<script>账户12345美元</script>", start: { date: "2026-10-15" }, execution_status: "recorded_done" }] } };
    const visible = calendarPanel(view, true, format);
    expect(visible).toContain("仅供追溯");
    expect(visible).not.toContain("<script>");
    expect(visible).toContain("&lt;script&gt;账户12345美元&lt;/script&gt;");
    expect(visible).toContain("日历标记已成交");
    expect(visible).toContain("2026-10-15 全天");
  });
  it("qualifies an unexpired retained snapshot when authorization has been revoked", () => {
    const view = { state: "not_connected", last_success: { fetched_at: "2026-10-15T00:00:00Z" },
      snapshot: { stale: false, events: [] } };
    expect(calendarPanel(view, false, format)).toContain("仅供追溯");
  });
});
