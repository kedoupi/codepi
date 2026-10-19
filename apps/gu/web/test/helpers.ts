import { tick } from "svelte";
import { render } from "@testing-library/svelte";
import { vi } from "vitest";
import App from "../src/App.svelte";
import { session } from "../src/lib/state.svelte";
import { syncFromLocation } from "../src/lib/router.svelte";
import { clearHighlight } from "../src/lib/focus";
import { resetFilters } from "../src/lib/state.svelte";

export function baseData() {
  return {
    account: [
      {
        framework: "v4.2",
        holdings_as_of: "2026-09-16",
        cash_as_of: "2026-09-16",
        total_usd: 123456,
        cash_usd: 400200,
        stocks_usd: 172100,
        hk_usd: 0,
        cash_age_days: 29,
        generated_at: "2026-10-15T02:21:00Z",
        dca_amount_usd: 20000,
        cash_after_dca_raw: 0.664,
        cash_weight_raw: 0.699,
        warnings: "⚠️ 情绪疲劳锁：48 小时禁止卖出/调仓",
        quote_date: "2026-10-14",
      },
    ],
    positions: [
      {
        ticker: "GOOGL",
        name: "Alphabet Class A",
        shares: 214.6206,
        avg_cost: 302.86,
        price: 347.64,
        value_usd: 74600,
        pnl_pct: 0.148,
        weight_raw: 0.13,
        target: 0.135,
      },
      {
        ticker: "现金",
        name: "现金 / 货币基金",
        shares: null,
        avg_cost: null,
        price: null,
        value_usd: 400200,
        pnl_pct: null,
        weight_raw: 0.699,
        target: 0.14,
      },
    ],
    risk: [
      {
        rule_id: "NVDA_stop_buy",
        item: "NVDA 停买",
        kind: "价格",
        current_value: 170.25,
        current_unit: "USD",
        threshold: "< 160 美元",
        level: "停买",
        action: "不得新开定投",
        triggered: false,
        proximity: "near",
        distance: 0.064,
      },
    ],
    market: [
      {
        symbol: "TEST",
        name: "测试指数",
        group: "指数",
        close: 100,
        change_pct: 0.02,
        date: "2026-10-12",
        error: null,
      },
    ],
    history: [
      {
        date: "2026-09-16",
        source: "portfolio/snapshots/2026-09-16_持仓档案_SSOT.md",
        approx: true,
        weights: { GOOGL: 0.6 },
      },
      {
        date: "2026-10-14",
        source: "本批行情（positions.json）",
        approx: false,
        weights: { GOOGL: 0.6 },
      },
    ],
    reports: [
      {
        id: "private",
        kind: "盘后复盘",
        date: "2026-10-15",
        headline: "组合当日约 +350 美元",
        action: "只观察",
        body: "# 账户 123456 美元\n## 持仓 214.6206 股\n[来源](https://example.com/123456)\n## 记录",
        path: "reports/2026-10/private.md",
        trading_date: "2026-10-14",
        date_source: "front_matter",
      },
    ],
  };
}

export type Dash = ReturnType<typeof baseData>;

export function dashResponse(data: unknown = baseData(), batchId = "one") {
  return { batch_id: batchId, received_at: "2026-10-15T02:30:00Z", data };
}

export type Route =
  | { health: Record<string, unknown> }
  | { me: Record<string, unknown> | Response }
  | { dashboard: unknown }
  | { calendar: unknown }
  | { logout: unknown };

/**
 * 可编程 fetch。handlers 按 path 前缀命中；未命中时回落到 defaults。
 * 每次调用重新读取 handlers，方便测试中途切换（401 → 503 → 200）。
 */
export function stubFetch(defaults: {
  sso?: boolean;
  dashboardStatus?: number;
  data?: unknown;
}) {
  const calls: string[] = [];
  const impl = {
    handler: null as null | ((path: string) => Response | Promise<Response | undefined> | undefined),
  };
  const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
    const path = String(input);
    calls.push(path);
    const dynamic = impl.handler ? await impl.handler(path) : undefined;
    if (dynamic) return dynamic;
    if (path === "/api/health")
      return Response.json({ sso_enabled: defaults.sso === true });
    if (path === "/api/me") return Response.json({ authenticated: true });
    if (path === "/api/calendar") return Response.json({ state: "not_connected" });
    if (path === "/api/auth/logout") return Response.json({ ok: true });
    if (defaults.dashboardStatus && defaults.dashboardStatus !== 200)
      return Response.json({ error: "尚未同步数据" }, { status: defaults.dashboardStatus });
    return Response.json(dashResponse(defaults.data ?? baseData()));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls, setHandler: (h: typeof impl.handler) => (impl.handler = h) };
}

/** 在 jsdom 里挂载真实 App。gu-hide 清理副作用在 session.test.ts 单独验证。 */
export async function mountApp(hash = "#overview") {
  // jsdom 未实现 window.scrollTo；App 的 hashchange 处理器会调用它。
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  location.hash = hash;
  const view = render(App);
  await tick();
  return view;
}

/** 切换 hash 并派发 hashchange，等价于用户点导航。 */
export async function goTo(hash: string) {
  location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await tick();
}

export function resetClientState() {
  // 退役偏好：真实入口在 main-side-effect.ts 清理，这里保持测试环境一致。
  try {
    sessionStorage.removeItem("gu-hide");
  } catch {
    /* ignore */
  }
  session.snapshot = null;
  session.online = null;
  session.workspaceOpen = false;
  session.workspaceDirty = false;
  session.calendar = null;
  session.calendarFailed = false;
  session.auth = "unknown";
  session.dataState = "loading";
  session.loading = false;
  session.notice = "";
  session.ssoMode = undefined;
  session.returnHash = "";
  session.pendingPositionFocus = null;
  session.loadVersion++;
  resetFilters();
  clearHighlight();
  syncFromLocation();
}
