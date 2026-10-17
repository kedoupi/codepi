import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/svelte";
import {
  accountResponse,
  boardResponse,
  flush,
  mockLocation,
  mountApp,
  resetClientState,
  stubFetch,
} from "./helpers";
import * as sessionModule from "../src/session";
import * as api from "../src/api";

beforeEach(() => {
  document.body.innerHTML = "";
  resetClientState();
  mockLocation();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("gzh browser sessions (jsdom)", () => {
  it("rejects an old response when another request expires the session between fetch and parse", async () => {
    const response = Response.json({ ok: true, post: { title: "旧会话私密稿件" } });
    const readBody = vi.spyOn(response, "json");
    stubFetch(async () => response);
    const originalFetch = sessionModule.sessionFetch;
    vi.spyOn(sessionModule, "sessionFetch").mockImplementation(async (input, init) => {
      const result = await originalFetch(input, init);
      sessionModule.expireSession();
      return result;
    });
    await expect(api.getPost("private-draft")).rejects.toBeInstanceOf(sessionModule.SessionExpiredError);
    expect(readBody).not.toHaveBeenCalled();
  });

  it("rejects a response body that finishes after the request's session expires", async () => {
    let resolve!: (body: unknown) => void;
    const response = Response.json({});
    vi.spyOn(response, "json").mockImplementation(() => new Promise((done) => { resolve = done; }));
    stubFetch(async () => response);
    const pending = api.getPost("private-draft");
    const rejection = expect(pending).rejects.toBeInstanceOf(sessionModule.SessionExpiredError);
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    sessionModule.expireSession();
    resolve({ ok: true, post: { title: "旧会话私密稿件" } });
    await rejection;
  });

  it.each(["focus", "pageshow"])("clears private data on confirmed unauthorized from %s", async (trigger) => {
    const loc = mockLocation();
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input.startsWith("/api/board")) return boardResponse();
      return Response.json({});
    });
    mountApp();
    await screen.findByText("私密待审稿件");

    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    if (trigger === "focus") await fireEvent.focus(window);
    else await fireEvent(window, new Event("pageshow"));

    await waitFor(() => expect(loc.replace).toHaveBeenCalledWith("/login?next=%2F"));
  });

  it("clears private data on the 30s session check interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const loc = mockLocation();
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input.startsWith("/api/board")) return boardResponse();
      return Response.json({});
    });
    mountApp();
    await screen.findByText("私密待审稿件");

    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await vi.advanceTimersByTimeAsync(30_000);
    await waitFor(() => expect(loc.replace).toHaveBeenCalledWith("/login?next=%2F"));
    vi.useRealTimers();
  });

  it("also clears private data on authenticated:false", async () => {
    const loc = mockLocation();
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input.startsWith("/api/board")) return boardResponse();
      return Response.json({});
    });
    mountApp();
    await screen.findByText("私密待审稿件");

    fetchMock.mockResolvedValue(Response.json({ authenticated: false }));
    await fireEvent.focus(window);
    await waitFor(() => expect(loc.replace).toHaveBeenCalledWith("/login?next=%2F"));
  });

  it("preserves private data on a 503 and checks again on focus", async () => {
    mockLocation();
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input.startsWith("/api/board")) return boardResponse();
      return Response.json({});
    });
    mountApp();
    await screen.findByText("私密待审稿件");

    fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    await fireEvent.focus(window);
    await waitFor(() => expect(document.body.textContent ?? "").toContain("会话检查暂时失败"));
    expect(screen.queryByText("私密待审稿件")).toBeTruthy();

    fetchMock.mockResolvedValue(accountResponse());
    await fireEvent.focus(window);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => input === "/api/me").length).toBeGreaterThanOrEqual(3));
    expect(screen.queryByText("私密待审稿件")).toBeTruthy();
  });

  it("does not restore an in-flight board response after invalidation", async () => {
    const loc = mockLocation();
    let resolveBoard!: (response: Response) => void;
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input.startsWith("/api/board")) {
        return new Promise<Response>((done) => { resolveBoard = done; });
      }
      return Response.json({});
    });
    mountApp();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/board/), expect.anything()));

    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await fireEvent.focus(window);
    await waitFor(() => expect(loc.replace).toHaveBeenCalledWith("/login?next=%2F"));

    resolveBoard(boardResponse());
    await flush();
    expect(document.body.textContent ?? "").not.toContain("私密待审稿件");
  });

  it("keeps private data when global logout fails and clears it on a successful POST", async () => {
    const loc = mockLocation();
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/me") return accountResponse();
      if (input.startsWith("/api/board")) return boardResponse();
      return Response.json({});
    });
    mountApp();
    await screen.findByText("私密待审稿件");

    fetchMock.mockResolvedValue(Response.json({ error: "暂不可用" }, { status: 503 }));
    await fireEvent.click(screen.getByRole("button", { name: "退出" }));
    await flush(10);
    expect(screen.queryByText("私密待审稿件")).toBeTruthy();
    // 503 退出不触发会话过期；toast 显示后端返回的错误文本。
    expect(document.body.textContent ?? "").toContain("暂不可用");
    expect(loc.replace).not.toHaveBeenCalledWith("/login");

    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    await fireEvent.click(screen.getByRole("button", { name: "退出" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST", credentials: "same-origin" })));
    await waitFor(() => expect(loc.replace).toHaveBeenCalledWith("/login"));
  });

  it("offers a new SSO login when the local session is expired", async () => {
    mockLocation({ pathname: "/login" });
    stubFetch(async (input) => {
      if (input === "/api/me") return new Response("Unauthorized", { status: 401 });
      if (input === "/api/health") return Response.json({ sso_enabled: true });
      return Response.json({});
    });
    mountApp();
    const link = await screen.findByRole("link", { name: "统一登录" });
    expect(link.getAttribute("href")).toBe("/api/auth/login?return=%2F");
    expect(document.querySelector("#otp-form")).toBeNull();
  });

  it("renders a recoverable callback error without checking the broken central session", async () => {
    mockLocation({ pathname: "/login", search: "?auth_error=retry" });
    const fetchMock = stubFetch(async (input) => {
      if (input === "/api/health") return Response.json({ sso_enabled: true });
      return Response.json({});
    });
    mountApp();
    await screen.findByText("登录未完成。请重新登录；服务暂时不可用时，可稍后重试。");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });
});
