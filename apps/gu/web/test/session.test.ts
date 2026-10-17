import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { cleanup, screen } from "@testing-library/svelte";
import {
  baseData,
  dashResponse,
  goTo,
  mountApp,
  resetClientState,
  stubFetch,
} from "./helpers";

beforeEach(() => {
  resetClientState();
});

afterEach(async () => {
  cleanup();
  await new Promise((done) => setTimeout(done, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("session bootstrap", () => {
  it("removes the retired gu-hide preference exactly once at entry", async () => {
    const removeItem = vi.fn();
    vi.stubGlobal("sessionStorage", { getItem: vi.fn(), removeItem, setItem: vi.fn() });
    await import("../src/main-side-effect");
    expect(removeItem).toHaveBeenCalledWith("gu-hide");
  });

  it("loads health, session and dashboard, then renders the overview", async () => {
    const { calls } = stubFetch({ sso: true });
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    expect(calls).toContain("/api/health");
    expect(calls).toContain("/api/me");
    expect(calls).toContain("/api/dashboard");
    expect(calls).toContain("/api/calendar");
    expect(document.querySelector("#refresh")).toBeTruthy();
    expect(document.querySelector("#logout")).toBeTruthy();
  });

  it("redirects to the SSO login when the session is rejected", async () => {
    stubFetch({ sso: true }).setHandler(async (path) =>
      path === "/api/me" ? new Response("expired", { status: 401 }) : undefined,
    );
    mountApp("#reports/private");
    await screen.findByText("统一登录");
    const link = document.querySelector<HTMLAnchorElement>("a.primary")!;
    expect(link.href).toContain(
      "/api/auth/login?return=" + encodeURIComponent("/#reports/private"),
    );
    expect(document.body.innerHTML).not.toContain("发送验证码");
    expect(document.body.innerHTML).not.toContain("估算总资产");
  });

  it.each(["focus", "visibilitychange"] as const)(
    "clears a revoked SSO session on %s and keeps the report return link",
    async (event) => {
      const stub = stubFetch({ sso: true });
      mountApp("#reports/private");
      // 深链直达报告详情；正文出现说明会话与数据已加载完成。
      await vi.waitFor(() =>
        expect(document.body.textContent ?? "").toContain("123456 美元"),
      );
      stub.setHandler(async (path) =>
        path === "/api/me"
          ? Response.json({ authenticated: false, authMode: "sso" })
          : undefined,
      );
      if (event === "focus") {
        window.dispatchEvent(new Event("focus"));
      } else {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }
      await screen.findByText("统一登录");
      expect(document.body.innerHTML).toContain(
        "/api/auth/login?return=" + encodeURIComponent("/#reports/private"),
      );
    },
  );

  it("keeps the session in the empty state during navigation", async () => {
    stubFetch({ sso: true, dashboardStatus: 404 });
    mountApp("#reports");
    await screen.findByText("等待第一批投资数据");
    await goTo("#positions");
    await screen.findByText("等待第一批投资数据");
    expect(document.body.innerHTML).not.toContain("登录投资工作台");
  });
});

describe("refresh and failure recovery", () => {
  it("shows refresh progress, disables the button and reports an unchanged batch", async () => {
    const stub = stubFetch({ sso: true });
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    let complete!: (value: Response) => void;
    stub.setHandler(async (path) => {
      if (path === "/api/me") return Response.json({ authenticated: true });
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    });
    document.querySelector<HTMLButtonElement>("#refresh")!.click();
    await screen.findByText("刷新中…");
    expect(document.querySelector("#content")!.getAttribute("aria-busy")).toBe("true");
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    complete(Response.json(dashResponse()));
    await screen.findByText("已检查，当前已是最新同步批次。未重新采集行情。");
    expect(document.querySelector("#content")!.getAttribute("aria-busy")).toBe("false");
  });

  it("keeps cached assets during an outage and recovers with a new batch notice", async () => {
    const stub = stubFetch({ sso: true });
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    stub.setHandler(async () => Response.json({ error: "auth_unavailable" }, { status: 503 }));
    document.querySelector<HTMLButtonElement>("#refresh")!.click();
    await screen.findByText(/刷新失败，仍展示上一批数据/);
    expect(document.body.innerHTML).toContain("估算总资产");
    expect(document.body.innerHTML).not.toContain("登录投资工作台");
    stub.setHandler(async (path) =>
      path === "/api/me"
        ? Response.json({ authenticated: true })
        : Response.json(dashResponse(baseData(), "two")),
    );
    document.querySelector<HTMLButtonElement>("#refresh")!.click();
    await screen.findByText("已载入新同步批次。");
  });

  it.each(["/api/me", "/api/dashboard"] as const)(
    "clears cached assets after %s returns a non-JSON 401",
    async (blocked) => {
      const stub = stubFetch({ sso: true });
      mountApp();
      await screen.findByText("估算总资产 · 美元");
      stub.setHandler(async (path) =>
        path === blocked ? new Response("Unauthorized", { status: 401 }) : undefined,
      );
      document.querySelector<HTMLButtonElement>("#refresh")!.click();
      await screen.findByText("登录投资工作台");
      for (const hash of ["#overview", "#positions", "#reports", "#status"]) {
        await goTo(hash);
        expect(document.body.innerHTML).toContain("登录投资工作台");
        expect(document.body.innerHTML).not.toContain("估算总资产");
        expect(document.body.innerHTML).not.toContain("情绪疲劳锁");
      }
    },
  );

  it.each(["offline", "html", "server"] as const)(
    "persists %s failure with cached batch across routes, then recovers",
    async (mode) => {
      const stub = stubFetch({ sso: true });
      mountApp();
      await screen.findByText("估算总资产 · 美元");
      stub.setHandler(async () => {
        if (mode === "offline") throw new TypeError("Failed to fetch");
        return mode === "html"
          ? new Response("<html>bad gateway</html>", { status: 502 })
          : Response.json({ error: "server" }, { status: 500 });
      });
      document.querySelector<HTMLButtonElement>("#refresh")!.click();
      await screen.findByText(/刷新失败，仍展示上一批数据/);
      await goTo("#status");
      await screen.findByText(/刷新失败，仍展示上一批数据/);
      stub.setHandler(null);
      document.querySelector<HTMLButtonElement>("#refresh")!.click();
      await screen.findByText("已检查，当前已是最新同步批次。未重新采集行情。");
      expect(document.body.innerHTML).not.toContain("刷新失败");
    },
  );

  it("deduplicates refreshes and discards a pending dashboard response after logout", async () => {
    const stub = stubFetch({ sso: true });
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    let resolve!: (value: Response) => void;
    stub.setHandler(async (path) => {
      if (path === "/api/me" || path === "/api/auth/logout")
        return Response.json(path === "/api/me" ? { authenticated: true } : { ok: true });
      return new Promise<Response>((done) => {
        resolve = done;
      });
    });
    document.querySelector<HTMLButtonElement>("#refresh")!.click();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const count = stub.fetchMock.mock.calls.length;
    document.querySelector<HTMLButtonElement>("#refresh")!.click();
    expect(stub.fetchMock.mock.calls.length).toBe(count);
    document.querySelector<HTMLButtonElement>("#logout")!.click();
    await screen.findByText("统一登录");
    resolve(Response.json(dashResponse()));
    await new Promise((done) => setTimeout(done, 0));
    await goTo("#overview");
    expect(document.body.innerHTML).toContain("统一登录");
    expect(document.body.innerHTML).not.toContain("估算总资产");
  });

  it("restores a report deep link after reauthentication (OTP path)", async () => {
    const stub = stubFetch({ sso: false });
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    await goTo("#reports/private");
    stub.setHandler(async (path) =>
      path === "/api/me" || path === "/api/dashboard"
        ? new Response("expired", { status: 401 })
        : undefined,
    );
    document.querySelector<HTMLButtonElement>("#refresh")!.click();
    await screen.findByText("发送验证码");
    // OTP 验证成功后 App 会恢复 returnHash 并重新加载。
    stub.setHandler(async (path) => {
      if (path === "/api/auth/verify-otp") return Response.json({ ok: true });
      if (path === "/api/me") return Response.json({ authenticated: true });
      return Response.json(dashResponse());
    });
    // 先点发送（确保 send 的 onclick 后 Svelte 已注册表单 handler），
    // 再补 OTP 输入并直接派发 submit；jsdom 的 requestSubmit 行为不可靠。
    document.querySelector<HTMLButtonElement>("#send")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#login-message")?.textContent ?? "").toContain("验证码"),
    );
    const input = document.querySelector<HTMLInputElement>("#code")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const form = document.querySelector<HTMLFormElement>("#verify")!;
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(
      () => {
        expect(location.hash).toBe("#reports/private");
        expect(document.querySelector(".report-body")?.textContent ?? "").toContain("123456 美元");
      },
      { timeout: 3000 },
    );
  });
});

describe("complete data across routes", () => {
  it("always displays complete data across routes with legacy hide preference removed", async () => {
    stubFetch({ sso: true });
    sessionStorage.setItem("gu-hide", "1");
    // 真实入口在 main-side-effect.ts 里清理；这里模拟入口已运行的环境。
    sessionStorage.removeItem("gu-hide");
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    expect(sessionStorage.getItem("gu-hide")).toBeNull();
    await goTo("#positions");
    await screen.findByText("214.6206");
    expect(document.body.innerHTML).toContain("347.64");
    await goTo("#reports");
    await vi.waitFor(() =>
      expect(document.body.textContent ?? "").toContain("+350 美元"),
    );
    await goTo("#reports/private");
    await vi.waitFor(() =>
      expect(document.body.textContent ?? "").toContain("123456 美元"),
    );
    expect(document.body.innerHTML).toContain("214.6206 股");
    expect(document.body.innerHTML).toContain('href="https://example.com/123456"');
    expect(document.body.innerHTML).toContain("reports/2026-10/private.md");
    expect(document.body.innerHTML).toContain("章节目录 · 3 节");
    await goTo("#status");
    await screen.findByText("当前批次");
    expect(document.body.innerHTML).toContain("情绪疲劳锁");
    for (const hash of ["#overview", "#positions", "#reports", "#status"]) {
      await goTo(hash);
      await tick();
      expect(document.body.innerHTML).not.toMatch(
        /id="hide"|显示金额|隐藏金额|隐私模式|摘要已隐藏|原始记录路径已隐藏/,
      );
      expect(document.querySelector("#refresh")).toBeTruthy();
      expect(document.querySelector("#logout")).toBeTruthy();
    }
  });
});
