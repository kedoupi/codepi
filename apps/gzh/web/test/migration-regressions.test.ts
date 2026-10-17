import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import { unmount } from "svelte";
import {
  accountResponse,
  boardResponse,
  mockLocation,
  mountApp,
  resetClientState,
  stubFetch,
} from "./helpers";

beforeEach(() => {
  document.body.innerHTML = "";
  resetClientState();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("gzh Svelte migration regressions", () => {
  it("clears the #app boot placeholder on mount", async () => {
    mockLocation({ pathname: "/login" });
    stubFetch(async (input) => {
      if (input === "/api/me") return new Response("Unauthorized", { status: 401 });
      if (input === "/api/health") return Response.json({ sso_enabled: true });
      return Response.json({});
    });
    // 直接走真实入口 main.ts：先 replaceChildren 再 mount，不应残留 .boot 占位。
    const host = document.createElement("div");
    host.id = "app";
    host.innerHTML = '<p class="boot">正在读卷发稿台…</p>';
    document.body.append(host);
    const entry = await import("../src/main");
    try {
      await screen.findByRole("link", { name: "统一登录" });
      expect(document.querySelector(".boot")).toBeNull();
    } finally {
      // 真实入口的 mount 不在 Testing Library 清理表里，需显式卸载避免泄漏。
      await unmount(entry.app);
    }
  });

  it("OTP form: send code then verify with 6 digits", async () => {
    mockLocation({ pathname: "/login" });
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return new Response("Unauthorized", { status: 401 });
      if (input === "/api/health") return Response.json({ sso_enabled: false });
      if (input === "/api/auth/request-otp") return Response.json({ ok: true, message: "已发送", dev_otp: "123456" });
      if (input === "/api/auth/verify-otp") return Response.json({ ok: true, account: { email: "owner@example.test", role: "owner", brand: "珂抖屁" } });
      return Response.json({});
    });
    const loc = (globalThis as Record<string, unknown>).location as { replace: ReturnType<typeof vi.fn> };
    mountApp();
    await screen.findByPlaceholderText("name@example.com");
    await fireEvent.input(screen.getByPlaceholderText("name@example.com"), { target: { value: "owner@example.test" } });
    await fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
    await screen.findByText(/本地开发码：123456/);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/request-otp", expect.objectContaining({ method: "POST" }));

    const codeInput = screen.getByPlaceholderText("••••••");
    await fireEvent.input(codeInput, { target: { value: "123456" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/verify-otp", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(loc.replace).toHaveBeenCalledWith("/"));
  });

  it("desk renders slots and queue, date nav uses location.search", async () => {
    const loc = mockLocation({ pathname: "/" });
    stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input.startsWith("/api/board")) return boardResponse();
      return Response.json({});
    });
    mountApp();
    await screen.findByText("私密待审稿件");
    expect(screen.getByText("待审队列")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "前一天" }));
    expect(loc.search).toMatch(/^\?date=\d{4}-\d{2}-\d{2}$/);
  });

  it("re-lock then unlock: review dock gates 过/要改/拒 until read", async () => {
    mockLocation({ pathname: "/p/private-draft/" });
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input === "/api/posts/private-draft") {
        return Response.json({
          ok: true,
          brand: "珂抖屁",
          post: {
            slug: "private-draft", title: "私密待审稿件", slot: "早", publish_date: "2026-10-15",
            status: "待审", preview_path: null, note: null, digest: null, last_review: null,
            is_demo: false, can_withdraw: false,
          },
        });
      }
      return Response.json({});
    });
    mountApp();
    await screen.findByText("请先通读全文");
    // 空预览 → read-gate 直接解锁（unlockReviewDock）。
    await waitFor(() => {
      const pass = screen.getByRole("button", { name: "过" }) as HTMLButtonElement;
      expect(pass.disabled).toBe(false);
    });
    void fetchMock;
  });

  it("rejected review failure re-enables the 拒 button for retry", async () => {
    mockLocation({ pathname: "/p/private-draft/" });
    let attempts = 0;
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input === "/api/posts/private-draft") {
        return Response.json({
          ok: true,
          brand: "珂抖屁",
          post: {
            slug: "private-draft", title: "私密待审稿件", slot: "早", publish_date: "2026-10-15",
            status: "待审", preview_path: null, note: null, digest: null, last_review: null,
            is_demo: false, can_withdraw: false,
          },
        });
      }
      if (input === "/api/review") {
        attempts += 1;
        return Response.json({ error: "暂不可用" }, { status: 503 });
      }
      return Response.json({});
    });
    mountApp();
    await screen.findByText("请先通读全文");
    // 空预览解锁 → 先点「拒」armed，再点确认；第一次 503 后按钮应可再次点击。
    await waitFor(() => expect((screen.getByRole("button", { name: "拒" }) as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(screen.getByRole("button", { name: "拒" }));
    const confirm = await screen.findByRole("button", { name: "确认拒绝？再点一次" });
    await fireEvent.click(confirm);
    await waitFor(() => expect(attempts).toBe(1));
    // 失败后按钮复位，可再次触发（仍是 armed→confirm 或直接可用，取决于组件状态）。
    await waitFor(() => {
      const reject = screen.getByRole("button", { name: "拒" }) as HTMLButtonElement;
      expect(reject.disabled).toBe(false);
    });
    void fetchMock;
  });

  it("inline preview: review actions locked until read-complete unlocks", async () => {
    mockLocation({ pathname: "/p/private-draft/" });
    // 非空 inline 正文（同域 /previews/ 路径）。
    const articleHtml = `<!doctype html><html><head><link rel="stylesheet" href="/previews/x/a.css"></head><body><article><p>正文</p></article></body></html>`;
    stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input === "/api/posts/private-draft") {
        return Response.json({
          ok: true,
          brand: "珂抖屁",
          post: {
            slug: "private-draft", title: "私密待审稿件", slot: "早", publish_date: "2026-10-15",
            status: "待审", preview_path: "/previews/x/", note: null, digest: null, last_review: null,
            is_demo: false, can_withdraw: false,
          },
        });
      }
      if (input === "/previews/x/") return new Response(articleHtml, { headers: { "content-type": "text/html" } });
      return Response.json({});
    });
    const observers: Array<{ callback: IntersectionObserverCallback; observer: IntersectionObserver }> = [];
    class FakeIO implements IntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observers.push({ callback, observer: this });
      }
      observe = vi.fn();
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = "";
      thresholds: number[] = [];
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
    // 长页面：窗口 scroll 的 isReadComplete 不成立，锁定只能靠 observer 解锁。
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(5000);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("scrollY", 0);

    mountApp();
    await screen.findByText("请先通读全文");
    // dock 比异步正文先渲染；等 read-gate 完成绑定后再模拟读到正文底部。
    await waitFor(() => {
      expect(observers).toHaveLength(1);
      expect(observers[0].observer.observe).toHaveBeenCalledWith(document.getElementById("read-end"));
      expect(document.getElementById("preview-article")?.shadowRoot?.textContent).toContain("正文");
      expect(document.querySelector(".dock-review")?.classList.contains("is-locked")).toBe(true);
      for (const name of ["过", "要改", "拒"]) {
        expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
      }
    });
    const { callback, observer } = observers[0];
    callback([{ isIntersecting: true } as IntersectionObserverEntry], observer);
    await waitFor(() => {
      for (const name of ["过", "要改", "拒"]) {
        expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
      }
    });
  });

  it("iframe cross-origin preview: manual read-done unlocks review actions", async () => {
    mockLocation({ pathname: "/p/private-draft/" });
    stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input === "/api/posts/private-draft") {
        return Response.json({
          ok: true,
          brand: "珂抖屁",
          post: {
            slug: "private-draft", title: "私密待审稿件", slot: "早", publish_date: "2026-10-15",
            status: "待审", preview_path: "https://third.example/article/", note: null, digest: null, last_review: null,
            is_demo: false, can_withdraw: false,
          },
        });
      }
      return Response.json({});
    });
    mountApp();
    await screen.findByText("请先通读全文");
    // 初始锁定。
    await waitFor(() => {
      for (const name of ["过", "要改", "拒"]) {
        expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
      }
    });
    // 跨源 iframe 无法读内部滚动，提供手动「已读完」解锁。
    await fireEvent.click(screen.getByRole("button", { name: "已读完，解锁审核" }));
    await waitFor(() => {
      for (const name of ["过", "要改", "拒"]) {
        expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
      }
    });
  });

  it("two-tap confirm arms then confirms withdraw on preview dock", async () => {
    mockLocation({ pathname: "/p/private-draft/" });
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input === "/api/posts/private-draft") {
        return Response.json({
          ok: true,
          brand: "珂抖屁",
          post: {
            slug: "private-draft", title: "私密待审稿件", slot: "早", publish_date: "2026-10-15",
            status: "可推箱", preview_path: null, note: null, digest: null, last_review: null,
            is_demo: false, can_withdraw: true,
          },
        });
      }
      if (input === "/api/posts/private-draft/withdraw") return Response.json({ ok: true });
      return Response.json({});
    });
    const loc = (globalThis as Record<string, unknown>).location as { reload: ReturnType<typeof vi.fn> };
    mountApp();
    await screen.findByText("已过审。去微信后台推进草稿箱，回来点「已进箱」。");

    const withdraw = screen.getByRole("button", { name: "撤回待审" });
    await fireEvent.click(withdraw);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("withdraw"))).toBe(false);
    // 第二次点击（已 armed）才真正提交。
    const armed = await screen.findByRole("button", { name: "确认撤回？再点一次" });
    await fireEvent.click(armed);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("withdraw"))).toBe(true));
    await waitFor(() => expect(loc.reload).toHaveBeenCalled());
  });

  it.each([
    { label: "撤回待审", confirmLabel: "确认撤回？再点一次", endpoint: "/api/posts/private-draft/withdraw" },
    { label: "标为正式稿", confirmLabel: "确认转正式？再点一次", endpoint: "/api/posts/private-draft" },
    { label: "撤掉演示", confirmLabel: "确认撤档？再点一次", endpoint: "/api/posts/private-draft/release-demo" },
  ])("$label failure shows an error and allows retry", async ({ label, confirmLabel, endpoint }) => {
    const loc = mockLocation({ pathname: "/p/private-draft/" });
    let attempts = 0;
    stubFetch(async (input, init) => {
      if (input === "/api/me") return accountResponse();
      if (input === "/api/posts/private-draft" && !init?.method) {
        return Response.json({
          ok: true,
          brand: "珂抖屁",
          post: {
            slug: "private-draft", title: "私密待审稿件", slot: "早", publish_date: "2026-10-15",
            status: "可推箱", preview_path: null, note: null, digest: null, last_review: null,
            is_demo: true, can_withdraw: true,
          },
        });
      }
      if (input === endpoint) {
        attempts += 1;
        return Response.json({ error: "操作暂不可用" }, { status: 503 });
      }
      return Response.json({});
    });
    mountApp();
    const button = await screen.findByRole("button", { name: label });
    await fireEvent.click(button);
    await fireEvent.click(await screen.findByRole("button", { name: confirmLabel }));
    await screen.findByText("操作暂不可用");
    await waitFor(() => {
      expect(attempts).toBe(1);
      expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled).toBe(false);
    });
    await fireEvent.click(screen.getByRole("button", { name: label }));
    await fireEvent.click(await screen.findByRole("button", { name: confirmLabel }));
    await waitFor(() => expect(attempts).toBe(2));
    expect(loc.reload).not.toHaveBeenCalled();
    expect(loc.href).toBe("https://gzh.codepi.app/p/private-draft/");
  });
});
