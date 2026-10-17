import { tick } from "svelte";
import { render } from "@testing-library/svelte";
import { vi } from "vitest";
import App from "../src/App.svelte";
import { appState } from "../src/lib/state.svelte";
import * as sessionModule from "../src/session";

export interface MockLocation {
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  href: string;
  assign: ReturnType<typeof vi.fn>;
  replace: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
}

export function mockLocation(options: { pathname?: string; search?: string } = {}): MockLocation {
  const pathname = options.pathname ?? "/";
  const search = options.search ?? "";
  const loc: MockLocation = {
    pathname,
    search,
    hash: "",
    origin: "https://gzh.codepi.app",
    href: `https://gzh.codepi.app${pathname}${search}`,
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
  };
  vi.stubGlobal("location", loc);
  return loc;
}

export function resetClientState() {
  sessionModule.onSessionExpired(() => {});
  appState.route = "desk";
  appState.account = null;
  appState.booted = false;
  // 让 session 版本前进，避免上一个用例的过期回调泄漏。
  sessionModule.expireSession();
}

export function mountApp() {
  resetClientState();
  const host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  const result = render(App, { target: host });
  return { host, ...result };
}

export function stubFetch(handler: (input: string, init?: RequestInit) => Promise<Response> | Response) {
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export function accountResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    account: { email: "owner@example.test", role: "owner", brand: "珂抖屁", ...overrides },
  });
}

export function boardResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    ok: true,
    date: "2026-10-15",
    today: "2026-10-15",
    brand: "珂抖屁",
    slots: [],
    queue: [
      {
        slug: "private-draft", title: "私密待审稿件", slot: "早", publish_date: "2026-10-15",
        status: "待审", preview_path: null, note: null, digest: "私密摘要", last_review: null,
        is_demo: false, can_withdraw: false,
      },
    ],
    ...overrides,
  });
}

export async function flush(ms = 0) {
  await new Promise((done) => setTimeout(done, ms));
  await tick();
}
