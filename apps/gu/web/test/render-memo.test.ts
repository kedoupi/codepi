import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/svelte";
import { goTo, mountApp, resetClientState, stubFetch } from "./helpers";

beforeEach(() => {
  resetClientState();
});

afterEach(async () => {
  cleanup();
  await new Promise((done) => setTimeout(done, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stable render shell", () => {
  it("mounts the chrome exactly once and keeps it across page switches", async () => {
    stubFetch({ sso: true });
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    const sidebar = document.querySelector(".sidebar");
    const topbar = document.querySelector(".topbar");
    await goTo("#positions");
    await screen.findByText("当前持仓");
    await goTo("#status");
    await screen.findByText("当前批次");
    await goTo("#overview");
    await screen.findByText("估算总资产 · 美元");
    expect(document.querySelector(".sidebar")).toBe(sidebar);
    expect(document.querySelector(".topbar")).toBe(topbar);
    expect(document.querySelectorAll(".sidebar").length).toBe(1);
  });

  it("keeps the notice as a persistent node outside #content", async () => {
    stubFetch({ sso: true });
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    const notice = document.querySelector("#notice")!;
    expect(notice.parentElement?.id).not.toBe("content");
    await goTo("#positions");
    await screen.findByText("当前持仓");
    expect(document.querySelector("#notice")).toBe(notice);
  });

  it("updates the active nav item without remounting the workspace", async () => {
    stubFetch({ sso: true });
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    const workspace = document.querySelector(".workspace");
    await goTo("#positions");
    await screen.findByText("当前持仓");
    expect(
      document.querySelector('[data-nav="positions"]')!.getAttribute("aria-current"),
    ).toBe("page");
    expect(document.querySelector('[data-nav="overview"]')!.getAttribute("aria-current")).toBeNull();
    expect(document.querySelector(".workspace")).toBe(workspace);
  });

  it("does not re-fetch when hashchange fires without a hash change", async () => {
    const stub = stubFetch({ sso: true });
    mountApp();
    await screen.findByText("估算总资产 · 美元");
    const before = stub.fetchMock.mock.calls.length;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await new Promise((done) => setTimeout(done, 0));
    expect(stub.fetchMock.mock.calls.length).toBe(before);
  });
});
