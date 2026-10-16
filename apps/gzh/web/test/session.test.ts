import { afterEach, describe, expect, it, vi } from "vitest";

// Exercise the real browser entry point without introducing a DOM dependency.
async function mount(options: { login?: boolean; retry?: boolean; pendingBoard?: boolean } = {}) {
  vi.resetModules();
  const events: Record<string, () => void> = {};
  const intervals = new Map<number, () => void>();
  const controls = new Map<string, Record<string, () => unknown>>();
  const app = {
    innerHTML: "", className: "",
    replaceChildren() { this.innerHTML = ""; },
    querySelector(selector: string) {
      return { addEventListener: (name: string, fn: () => unknown) => {
        if (!controls.has(selector)) controls.set(selector, {});
        controls.get(selector)![name] = fn;
      } };
    },
    querySelectorAll: () => [],
  };
  const toasts: string[] = [];
  vi.stubGlobal("document", {
    querySelector: (selector: string) => selector === "#app" ? app : null,
    createElement: () => ({
      textContent: "", setAttribute: () => {}, classList: { add: () => {} }, remove: () => {},
      append: (child: { textContent: string }) => { toasts.push(child.textContent); },
    }),
    body: { append: () => {} },
  });
  vi.stubGlobal("window", {
    addEventListener: (event: string, fn: () => void) => { events[event] = fn; },
    setInterval: (fn: () => void, ms: number) => { intervals.set(ms, fn); return ms; },
    setTimeout: () => 0,
  });
  const replace = vi.fn();
  vi.stubGlobal("location", {
    pathname: options.login ? "/login" : "/", search: options.retry ? "?auth_error=retry" : "",
    origin: "https://gzh.codepi.app", replace, reload: () => {},
  });
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  const board = {
    ok: true, date: "2026-10-15", today: "2026-10-15", brand: "珂抖屁",
    slots: [], queue: [{
      slug: "private-draft", title: "私密待审稿件", slot: "早", publish_date: "2026-10-15",
      status: "待审", preview_path: null, note: null, digest: "私密摘要", last_review: null,
      is_demo: false, can_withdraw: false,
    }],
  };
  let resolveBoard!: (response: Response) => void;
  const fetchMock = vi.fn(async (input: string, _init?: RequestInit): Promise<Response> => {
    if (input === "/api/me") return options.login
      ? new Response("Unauthorized", { status: 401 })
      : Response.json({ account: { email: "owner@example.test", role: "owner", brand: "珂抖屁" } });
    if (input === "/api/health") return Response.json({ sso_enabled: true });
    return options.pendingBoard
      ? new Promise<Response>(done => { resolveBoard = done; })
      : Response.json(board);
  });
  vi.stubGlobal("fetch", fetchMock);
  await import("../src/main");
  if (options.login) await vi.waitFor(() => expect(app.innerHTML).toContain("统一登录"));
  else if (options.pendingBoard) await vi.waitFor(() => expect(resolveBoard).toBeTypeOf("function"));
  else await vi.waitFor(() => expect(app.innerHTML).toContain("私密待审稿件"));
  return { app, events, intervals, controls, replace, fetchMock, board, toasts, resolveBoard };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("gzh browser SSO sessions", () => {
  it("rejects an old response when another request expires the session between fetch and parse", async () => {
    vi.resetModules();
    const response = Response.json({ ok: true, post: { title: "旧会话私密稿件" } });
    const readBody = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const session = await import("../src/session");
    const originalFetch = session.sessionFetch;
    vi.spyOn(session, "sessionFetch").mockImplementation(async (input, init) => {
      const result = await originalFetch(input, init);
      session.expireSession();
      return result;
    });
    const api = await import("../src/api");
    await expect(api.getPost("private-draft")).rejects.toBeInstanceOf(session.SessionExpiredError);
    expect(readBody).not.toHaveBeenCalled();
  });

  it("rejects a response body that finishes after the request's session expires", async () => {
    vi.resetModules();
    let resolve!: (body: unknown) => void;
    const response = Response.json({});
    vi.spyOn(response, "json").mockImplementation(() => new Promise(done => { resolve = done; }));
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const api = await import("../src/api");
    const session = await import("../src/session");
    const pending = api.getPost("private-draft");
    const rejection = expect(pending).rejects.toBeInstanceOf(session.SessionExpiredError);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    session.expireSession();
    resolve({ ok: true, post: { title: "旧会话私密稿件" } });
    await rejection;
  });

  it.each(["focus", "interval", "pageshow"])("clears private HTML on confirmed unauthorized from %s", async trigger => {
    const view = await mount();
    view.fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    if (trigger === "interval") view.intervals.get(30_000)!();
    else view.events[trigger]();
    await vi.waitFor(() => expect(view.app.innerHTML).toBe(""));
    expect(view.replace).toHaveBeenCalledWith("/login?next=%2F");
    expect(view.app.innerHTML).not.toContain("私密待审稿件");
  });

  it("also clears private HTML on authenticated:false", async () => {
    const view = await mount();
    view.fetchMock.mockResolvedValue(Response.json({ authenticated: false }));
    view.events.focus();
    await vi.waitFor(() => expect(view.app.innerHTML).toBe(""));
    expect(view.replace).toHaveBeenCalled();
  });

  it("preserves private data on a 503 and checks again on focus", async () => {
    const view = await mount();
    view.fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    view.events.focus();
    await vi.waitFor(() => expect(view.toasts).toContain("会话检查暂时失败，请稍后重试"));
    expect(view.app.innerHTML).toContain("私密待审稿件");
    expect(view.replace).not.toHaveBeenCalled();
    view.fetchMock.mockResolvedValue(Response.json({ account: { email: "owner@example.test" } }));
    view.events.focus();
    await vi.waitFor(() => expect(view.fetchMock).toHaveBeenCalledTimes(4));
    expect(view.app.innerHTML).toContain("私密待审稿件");
  });

  it("does not restore an in-flight board response after invalidation", async () => {
    const view = await mount({ pendingBoard: true });
    view.fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    view.events.focus();
    await vi.waitFor(() => expect(view.app.innerHTML).toBe(""));
    view.resolveBoard(Response.json(view.board));
    await new Promise(done => setTimeout(done, 0));
    expect(view.app.innerHTML).toBe("");
  });

  it("keeps private data when global logout fails and clears it on a successful POST", async () => {
    const view = await mount();
    view.fetchMock.mockResolvedValue(Response.json({ error: "暂不可用" }, { status: 503 }));
    await view.controls.get("[data-action=logout]")!.click();
    expect(view.app.innerHTML).toContain("私密待审稿件");
    expect(view.replace).not.toHaveBeenCalled();
    view.fetchMock.mockResolvedValue(Response.json({ ok: true }));
    await view.controls.get("[data-action=logout]")!.click();
    expect(view.fetchMock).toHaveBeenLastCalledWith("/api/auth/logout", expect.objectContaining({
      method: "POST", credentials: "same-origin",
    }));
    expect(view.app.innerHTML).toBe("");
  });

  it("offers a new SSO login when the local session is expired", async () => {
    const view = await mount({ login: true });
    expect(view.app.innerHTML).toContain('href="/api/auth/login?return=%2F"');
    expect(view.app.innerHTML).not.toContain('id="otp-form"');
  });

  it("renders a recoverable callback error without checking the broken central session", async () => {
    const view = await mount({ login: true, retry: true });
    expect(view.app.innerHTML).toContain("登录未完成");
    expect(view.app.innerHTML).toContain("/api/auth/login");
    expect(view.fetchMock).toHaveBeenCalledTimes(1);
    expect(view.fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });
});
