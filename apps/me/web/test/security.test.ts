import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import App from "../src/App.svelte";
import Memories from "../src/components/Memories.svelte";
import { api } from "../src/lib/api";

type Json = Record<string, unknown>;

function response(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function memoryPage(text: string) {
  return {
    items: [{
      id: "memory-xss",
      status: "active",
      kind: "note",
      text,
      tags: ["安全"],
      source_client: "test",
      source_name: "测试",
      import_id: null,
      import_item_index: null,
      created_at: "2026-10-24T00:00:00Z",
      updated_at: "2026-10-24T00:00:00Z",
      reviewed_at: "2026-10-24T00:00:00Z",
    }],
    next_offset: null,
  };
}

function emptyPage() {
  return { items: [], next_offset: null };
}

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Me web text rendering", () => {
  it("renders untrusted memory text as text without creating or executing HTML", async () => {
    const payload = '<script>window.__meXssExecuted = true</script><img src="x" onerror="window.__meXssExecuted = true">';
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path.startsWith("/api/memories")) return path.includes("status=pending") ? response(emptyPage()) : response(memoryPage(payload));
      throw new Error(`unexpected request: ${path}`);
    }));

    render(Memories, { onchanged: async () => {} });

    expect(await screen.findByText(payload, { exact: true })).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(window, "__meXssExecuted")).toBe(false);
  });
});

describe("Me web session expiry", () => {
  it("clears the authenticated app when the API dispatches a 401 expiry event", async () => {
    let expired = false;
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const path = String(input);
      if (path === "/api/me" && expired) return response({}, 401);
      if (path === "/api/me") return response({ user: "Owner" });
      if (path === "/api/overview") return response({ active_memories: 0, pending_memories: 0, pending_profile: 0, pending_timeline: 0 });
      if (path.startsWith("/api/memories")) return response(emptyPage());
      throw new Error(`unexpected request: ${path}`);
    }));

    render(App);
    await screen.findByText("由你确认的记忆");

    expired = true;
    await expect(api("/api/me")).rejects.toThrow("登录已过期，请重新登录。");
    await waitFor(() => expect(screen.getByText("回到你的 Me")).toBeTruthy());
  });
});
