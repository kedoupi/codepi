import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
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
    mountApp();
    await screen.findByRole("link", { name: "统一登录" });
    // main.ts 先 replaceChildren 再 mount，不应残留旧占位。
    expect(document.querySelector(".boot")).toBeNull();
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
});
