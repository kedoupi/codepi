import { escapeHtml as e } from "./markdown";

export interface CalendarView {
  state: string;
  last_success?: { fetched_at: string } | null;
  snapshot?: {
    stale: boolean;
    events: { title: string; start: { date?: string; date_time?: string }; execution_status: string }[];
  } | null;
}

export function calendarPanel(view: CalendarView | null, failed: boolean, time: (value: unknown) => string) {
  const labels: Record<string, string> = { not_connected: "尚未连接", failed: "同步失败", empty: "查询成功，窗口内无事件", available: "已同步只读快照", stale: "日历快照已过期" };
  const label = failed ? "日历暂时无法读取" : labels[view?.state || "not_connected"] || "日历状态未确认";
  const snapshot = view?.snapshot;
  return `<section class="surface calendar-panel"><div class="section-title"><h2>投资日历</h2><span class="seal">${e(label)}</span></div>
    <p>查询范围为北京时间当天及未来三天。仅展示指定投资日历的只读快照；持续授权尚未确认，日历与行情分别同步。</p>
    ${view?.last_success ? `<p class="fine">最后成功查询：${e(time(view.last_success.fetched_at))}${snapshot?.stale || failed || !["available", "empty"].includes(view.state) ? "；以下记录仅供追溯，请重新查询后再操作。" : ""}</p>` : ""}
    ${snapshot?.events?.length ? `<ul class="calendar-events">${snapshot.events.map(event => `<li><time>${e(event.start.date ? `${event.start.date} 全天` : time(event.start.date_time))}</time><strong>${e(event.title)}</strong><span>${e(({ unconfirmed: "待确认执行状态", recorded_done: "日历标记已成交", recorded_skipped: "日历标记已跳过", recorded_postponed: "日历标记已推迟" } as Record<string, string>)[event.execution_status] || "执行状态未确认")}</span></li>`).join("")}</ul>` : `<p>${view?.state === "empty" && !failed ? "本次查询成功，窗口内没有日历事件。" : "当前没有可用日程。请由有权限的 Agent 实时查询投资日历并同步，历史日期列表不用于替代。"}</p>`}
  </section>`;
}
