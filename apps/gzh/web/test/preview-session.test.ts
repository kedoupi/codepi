import { afterEach, describe, expect, it, vi } from "vitest";

async function mount(response = Response.json({ authenticated: true })) {
  vi.resetModules();
  const events: Record<string, () => void> = {};
  const intervals = new Map<number, () => void>();
  const documentElement = {
    innerHTML: "<head><title>Private preview</title></head><body><article>Private draft</article></body>",
    replaceChildren: vi.fn(function () { documentElement.innerHTML = ""; }),
  };
  const replace = vi.fn(() => { expect(documentElement.innerHTML).toBe(""); });
  vi.stubGlobal("document", { documentElement });
  vi.stubGlobal("location", {
    pathname: "/previews/private-draft/", search: "?edition=2", hash: "#notes", replace,
  });
  vi.stubGlobal("window", {
    addEventListener: (event: string, fn: () => void) => { events[event] = fn; },
    setInterval: (fn: () => void, ms: number) => { intervals.set(ms, fn); return ms; },
  });
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  await import("../src/preview-session");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  // Worker Response bodies finish on a later event-loop turn.
  await new Promise(done => setTimeout(done, 0));
  return { documentElement, events, intervals, replace, fetchMock };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("standalone preview sessions", () => {
  it("checks immediately and clears the entire document before redirecting on a non-JSON 401", async () => {
    const view = await mount(new Response("Unauthorized", { status: 401 }));
    expect(view.fetchMock).toHaveBeenCalledWith("/api/me", expect.objectContaining({
      credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal),
    }));
    expect(view.documentElement.innerHTML).toBe("");
    expect(view.replace).toHaveBeenCalledWith(
      "/login?next=%2Fpreviews%2Fprivate-draft%2F%3Fedition%3D2%23notes",
    );
  });

  it.each(["focus", "pageshow", "interval"])("clears a loaded preview after revocation from %s", async trigger => {
    const view = await mount();
    expect(view.documentElement.innerHTML).toContain("Private draft");
    view.fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    if (trigger === "interval") view.intervals.get(30_000)!();
    else view.events[trigger]();
    await vi.waitFor(() => expect(view.replace).toHaveBeenCalledOnce());
    expect(view.documentElement.innerHTML).toBe("");
  });

  it("also clears on an explicit unauthenticated successful response", async () => {
    const view = await mount(Response.json({ authenticated: false }));
    expect(view.documentElement.innerHTML).toBe("");
    expect(view.replace).toHaveBeenCalledOnce();
  });

  it.each(["503", "network", "invalid JSON"])("preserves the preview on %s and retries later", async failure => {
    const view = await mount();
    const original = view.documentElement.innerHTML;
    if (failure === "network") view.fetchMock.mockRejectedValue(new TypeError("offline"));
    else if (failure === "503") {
      view.fetchMock.mockResolvedValue(Response.json({ authenticated: false }, { status: 503 }));
    } else view.fetchMock.mockResolvedValue(new Response("not JSON"));
    view.events.focus();
    await vi.waitFor(() => expect(view.fetchMock).toHaveBeenCalledTimes(2));
    await new Promise(done => setTimeout(done, 0));
    expect(view.documentElement.innerHTML).toBe(original);
    expect(view.replace).not.toHaveBeenCalled();

    view.fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    view.events.pageshow();
    await vi.waitFor(() => expect(view.replace).toHaveBeenCalledOnce());
  });

  it("coalesces overlapping checks and stops requests after confirmed expiration", async () => {
    const view = await mount();
    let resolve!: (response: Response) => void;
    view.fetchMock.mockImplementation(() => new Promise(done => { resolve = done; }));
    view.events.focus();
    view.events.pageshow();
    view.intervals.get(30_000)!();
    expect(view.fetchMock).toHaveBeenCalledTimes(2);
    resolve(new Response("Unauthorized", { status: 401 }));
    await vi.waitFor(() => expect(view.replace).toHaveBeenCalledOnce());
    view.events.focus();
    view.intervals.get(30_000)!();
    expect(view.fetchMock).toHaveBeenCalledTimes(2);
    expect(view.documentElement.replaceChildren).toHaveBeenCalledOnce();
  });
});
