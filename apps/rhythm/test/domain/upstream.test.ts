import { UPSTREAM_MAX_PAGES } from "../../worker/lib";
import { describe, expect, it, vi } from "vitest";
import {
  parseActivity, parseDevices, parseEvents, parseHeartbeats, parseSnapshots, readUpstream,
  UPSTREAM_ACTIVITY_SAMPLES_PATH,
} from "../../worker/upstream";
import type { Env } from "../../worker/types";

function envWith(fetchImpl: (input: string) => Promise<Response>): Env {
  const fetcher = { fetch: (input: RequestInfo | URL) => fetchImpl(String(input)) };
  return { STATUS_READ: fetcher } as unknown as Env;
}

describe("上游行解析", () => {
  it("丢弃没有合法时间戳的采样行", () => {
    const rows = parseActivity([
      { sampled_at: "2026-11-01T09:00:00+08:00", net: "office", key_idle_sec: 20 },
      { sampled_at: "not-a-date" },
      { net: "home" },
      null,
      "string",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].net).toBe("office");
  });

  it("net 只接受已知取值，其余按缺失处理", () => {
    const rows = parseActivity([
      { sampled_at: "2026-11-01T09:00:00+08:00", net: "home" },
      { sampled_at: "2026-11-01T09:01:00+08:00", net: "office" },
      { sampled_at: "2026-11-01T09:02:00+08:00", net: "other" },
      { sampled_at: "2026-11-01T09:03:00+08:00", net: "" },
      { sampled_at: "2026-11-01T09:04:00+08:00", net: "unknown-net" },
    ]);
    expect(rows.map(row => row.net)).toEqual(["home", "office", "other", "", null]);
  });

  it("设备、快照、事件与心跳都按契约过滤非法行", () => {
    expect(parseDevices([{ device_id: "dev-a", room: "卧室" }, { name: "缺 id" }, null])).toHaveLength(1);
    expect(parseSnapshots([
      { device_id: "dev-a", observed_at: "2026-11-01T09:00:00+08:00", status: "online" },
      { device_id: "dev-a", observed_at: "2026-11-01T09:00:00+08:00", status: "weird" },
      { device_id: "dev-a", status: "online" },
    ])).toHaveLength(1);
    expect(parseEvents([
      { device_id: "dev-a", event_at: "2026-11-01T09:00:00+08:00", status: "offline" },
      { device_id: "dev-a", event_at: "bad" },
    ])).toHaveLength(1);
    expect(parseHeartbeats([
      { observed_at: "2026-11-01T09:00:00+08:00", scan_ok: true, device_count: 3 },
      { observed_at: "bad" },
    ])).toHaveLength(1);
  });
});

describe("上游只读调用", () => {
  it("按 nextCursor 翻页并把 limit 传给上游", async () => {
    const seen: string[] = [];
    const fetchImpl = async (input: string) => {
      seen.push(input);
      const url = new URL(input);
      if (!url.searchParams.get("cursor")) {
        return Response.json({
          ok: true, resource: UPSTREAM_ACTIVITY_SAMPLES_PATH,
          rows: [{ sampled_at: "2026-11-01T09:00:00+08:00" }], nextCursor: "next-page",
        });
      }
      return Response.json({
        ok: true, resource: UPSTREAM_ACTIVITY_SAMPLES_PATH,
        rows: [{ sampled_at: "2026-11-01T09:01:00+08:00" }],
      });
    };
    const rows = await readUpstream(
      envWith(fetchImpl), UPSTREAM_ACTIVITY_SAMPLES_PATH,
      { from: "2026-11-01T00:00:00+08:00", to: "2026-11-02T00:00:00+08:00" },
    );
    expect(rows).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("from=");
    expect(seen[0]).toContain("limit=1000");
    expect(seen[1]).toContain("cursor=next-page");
  });

  it("上游失败时抛出明确的错误码且不泄露行数据", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(readUpstream(envWith(async () => new Response("boom", { status: 500 })), UPSTREAM_ACTIVITY_SAMPLES_PATH))
      .rejects.toMatchObject({ code: "upstream_unavailable", status: 502 });
    await expect(readUpstream(envWith(async () => Response.json({ ok: false })), UPSTREAM_ACTIVITY_SAMPLES_PATH))
      .rejects.toMatchObject({ code: "upstream_unavailable" });
    await expect(readUpstream(envWith(async () => { throw new Error("network down"); }), UPSTREAM_ACTIVITY_SAMPLES_PATH))
      .rejects.toMatchObject({ code: "upstream_unavailable" });
    expect(error).toHaveBeenCalledWith("upstream_unavailable");
    for (const call of error.mock.calls) expect(JSON.stringify(call)).not.toContain("boom");
    error.mockRestore();
  });

  it("翻满最大页数仍有下一页时报错，不静默截断", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let pages = 0;
    const endless = envWith(async () => {
      pages += 1;
      return Response.json({ ok: true, rows: [{ sampled_at: "2026-11-03T09:00:00+08:00" }], nextCursor: String(pages) });
    });
    await expect(readUpstream(endless, UPSTREAM_ACTIVITY_SAMPLES_PATH)).rejects.toMatchObject({ code: "upstream_unavailable", status: 502 });
    expect(pages).toBe(UPSTREAM_MAX_PAGES);
    expect(error).toHaveBeenCalledWith("upstream_truncated");
    error.mockRestore();
  });
});

