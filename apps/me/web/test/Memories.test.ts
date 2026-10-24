import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import Memories from "../src/components/Memories.svelte";
import type { MemoryView, Page } from "../../worker/models";

const memory: MemoryView = {
  id: "memory-1",
  status: "pending",
  kind: "note",
  text: "已处理的旧提议",
  tags: [],
  source_client: "test",
  source_name: null,
  import_id: null,
  import_item_index: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  reviewed_at: null,
};

function page(items: MemoryView[]): Page<MemoryView> {
  return { items, next_offset: null };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Memories", () => {
  it("does not let a slow pending response revive a processed item", async () => {
    let resolvePending!: (response: Response) => void;
    let resolveRecords!: (response: Response) => void;
    const fetchMock = vi.fn((path: string) => {
      if (path.includes("status=pending")) {
        return new Promise<Response>((resolve) => { resolvePending = resolve; });
      }
      return new Promise<Response>((resolve) => { resolveRecords = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(Memories, { onchanged: async () => {} });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await fireEvent.submit(screen.getByRole("button", { name: "搜索记忆" }).closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    resolveRecords(new Response(JSON.stringify(page([])), { status: 200 }));
    await waitFor(() => expect(screen.getByText("没有匹配的记忆。试试其他关键词，或亲自记下第一条。")).toBeTruthy());

    resolvePending(new Response(JSON.stringify(page([memory])), { status: 200 }));
    await tick();
    await tick();
    expect(screen.getByText("没有待确认的记忆。背景和经历提议可在各自页面查看。")).toBeTruthy();
  });
});
