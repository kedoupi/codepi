import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Timeline from "../src/components/Timeline.svelte";
import type { Page, TimelineDetail, TimelineView } from "../../worker/models";

const first: TimelineView = {
  id: "timeline-a",
  status: "active",
  kind: "work",
  title: "经历 A",
  org: "组织 A",
  started_on: "2020",
  ended_on: null,
  body_excerpt: "摘要 A",
  source_client: "test",
  source_name: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  reviewed_at: null,
};
const second: TimelineView = { ...first, id: "timeline-b", title: "经历 B", org: "组织 B", body_excerpt: "摘要 B" };

function page(items: TimelineView[]): Page<TimelineView> {
  return { items, next_offset: null };
}
function detail(item: TimelineView, body: string): TimelineDetail {
  return { ...item, body };
}
function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Timeline", () => {
  it("does not let an older detail response replace a newer selection", async () => {
    let resolveA!: (value: Response) => void;
    let resolveB!: (value: Response) => void;
    const fetchMock = vi.fn((path: string) => {
      if (path.includes("/api/timeline/timeline-a")) return new Promise<Response>((resolve) => { resolveA = resolve; });
      if (path.includes("/api/timeline/timeline-b")) return new Promise<Response>((resolve) => { resolveB = resolve; });
      return Promise.resolve(response(path.includes("status=pending") ? page([]) : page([first, second])));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(Timeline, { onchanged: async () => {} });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "查看全文" })).toHaveLength(2));

    const buttons = screen.getAllByRole("button", { name: "查看全文" });
    await fireEvent.click(buttons[0]);
    await fireEvent.click(buttons[1]);
    resolveB(response(detail(second, "详情 B")));
    await waitFor(() => expect(screen.getByText("详情 B")).toBeTruthy());

    resolveA(response(detail(first, "详情 A")));
    await Promise.resolve();
    expect(screen.getByText("详情 B")).toBeTruthy();
    expect(screen.queryByText("详情 A")).toBeNull();
  });
});
