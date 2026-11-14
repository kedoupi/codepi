// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";

const overview = {
  as_of: "2026-11-04T06:00:00Z",
  today: "2026-11-04",
  counts: { open: 2, need_you: 1, overdue: 0, due_7d: 1, branches: 0, done_7d: 0 },
  need_you: [{ project: "alpha", key: "a", title: "选择示例方案", status: "decide", category: "流程", due: "2026-11-05",
    need_kind: "decide", done_at: null }],
  due_soon: [],
  dated: [],
  recently_done: [],
  branches: [],
  projects: [{ id: "alpha", name: "Alpha", repo: null, status: "active", last_push_at: "2026-11-04T06:00:00Z",
    open: 2, need_you: 1, branches: 0, url: "" }],
};

function backend(failMutation = false) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    calls.push(path);
    if (path === "/api/me") return Response.json({ authenticated: true });
    if (path === "/api/projects") return Response.json({ projects: overview.projects });
    if (path === "/api/overview") return Response.json(overview);
    if (path === "/api/tasks/alpha/a") {
      return Response.json({ project: { id: "alpha" }, task: { ...overview.need_you[0], what: "示例说明", impact: null, advice: "示例建议",
        need: "决定", source: "docs/a.md", related: [], recorded: "2026-11-01", first_seen: "", last_seen: "" }, handoffs: [] });
    }
    if (path === "/api/today/unpick") return failMutation ? Response.json({ error: "today_failed" }, { status: 500 }) : Response.json({ written: 1 });
    return Response.json({ error: "not_found" }, { status: 404 });
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("App routing", () => {
  it("renders the Feishu migration notice without requesting today APIs", async () => {
    const calls = backend();
    render(App);
    expect(await screen.findByRole("heading", { name: "今天/池子已迁到飞书清单「建国工作台」" })).toBeTruthy();
    expect(calls.filter(path => path.startsWith("/api/today"))).toEqual([]);
  });

  it("deep-links straight to a task from a summary link", async () => {
    history.replaceState(null, "", "/board?task=alpha%2Fa");
    backend();
    render(App);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.textContent).toContain("示例建议"));
  });
});
