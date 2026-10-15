import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/index";
import { hash, secretHash } from "../worker/lib";
import { calendarWindow, CALENDAR_MAX_AGE_MS } from "../worker/calendar";
import type { CalendarUpload, CalendarView, Env } from "../worker/types";

const NOW = Date.parse("2026-10-15T12:00:00+08:00");
const ID = "synthetic-investment@test.invalid";
const bindings: Env = { ...env, INVESTMENT_CALENDAR_ID: ID };
const SESSION = "calendar-test-session";
const call = (request: Request, config = bindings) => worker.fetch(request, config);
const get = (cookie = true) => new Request("http://localhost/api/calendar", {
  headers: cookie ? { Cookie: `gu_session=${SESSION}` } : {},
});
function fixture(attempted = NOW - 60_000): CalendarUpload {
  return {
    schema_version: 1, calendar_id: ID, timezone: "Asia/Shanghai",
    attempted_at: new Date(attempted).toISOString(),
    source: { provider: "google_calendar", transport: "local_agent", name: "offline-test" },
    window: calendarWindow(NOW), status: "success", complete: true, error_code: null,
    events: [{
      id: "synthetic-only", title: "合成测试事项", status: "confirmed",
      start: { date_time: "2026-10-15T14:00:00+08:00" },
      end: { date_time: "2026-10-15T15:00:00+08:00" },
    }],
  };
}
function put(body: unknown, bearer = env.UPLOAD_TOKEN, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/calendar/sync", {
    method: "PUT", headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers },
    body: JSON.stringify(body),
  });
}
async function view(): Promise<CalendarView> {
  const response = await call(get());
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  await env.DB.exec("DROP TRIGGER IF EXISTS fail_calendar; DELETE FROM calendar_sync_state; DELETE FROM sessions; DELETE FROM dashboard_current; DELETE FROM dashboard_batches;");
  await env.DB.prepare("INSERT INTO sessions (id, expires_at) VALUES (?, ?)")
    .bind(await secretHash(SESSION, env.SESSION_SECRET!), NOW + 86400_000).run();
});
afterEach(() => vi.restoreAllMocks());

describe("calendar authorization and disconnected defaults", () => {
  it("requires browser sessions to read and upload credentials to write", async () => {
    expect((await call(get(false))).status).toBe(401);
    expect((await call(new Request(get(false), { headers: { Authorization: `Bearer ${env.UPLOAD_TOKEN}` } }))).status).toBe(401);
    expect((await call(put(fixture(), "", { Cookie: `gu_session=${SESSION}` }))).status).toBe(401);
    expect((await call(put(fixture(), "incorrect"))).status).toBe(401);
    expect((await call(put(fixture()), { ...bindings, UPLOAD_TOKEN: undefined })).status).toBe(401);
    expect((await call(put(fixture(), env.UPLOAD_TOKEN, { Origin: "https://evil.test" }))).status).toBe(200);
  });
  it("never connects from missing or redacted configuration", async () => {
    for (const id of [undefined, "{REDACTED_CALENDAR_ID}", "primary", " invalid "]) {
      const config = { ...bindings, INVESTMENT_CALENDAR_ID: id };
      const response = await call(get(), config);
      expect(await response.json()).toMatchObject({
        state: "not_connected", reason: "calendar_not_configured", snapshot: null, last_attempt: null,
        sustained_authorization: "unconfirmed",
      });
      expect((await call(put(fixture()), config)).status).toBe(503);
    }
    expect(await view()).toMatchObject({ state: "not_connected", reason: "no_snapshot", snapshot: null });
  });
  it("uses no-store responses and never calls Google or mail", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const response = await call(get());
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect((await call(put(fixture()))).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not permit other mutation methods or insecure remote traffic", async () => {
    expect((await call(new Request("http://localhost/api/calendar", {
      method: "DELETE", headers: { Origin: "http://localhost", Cookie: `gu_session=${SESSION}` },
    }))).status).toBe(404);
    expect((await call(new Request("http://remote.test/api/calendar/sync", {
      method: "PUT", headers: { Authorization: `Bearer ${env.UPLOAD_TOKEN}` },
    }))).status).toBe(403);
    await env.DB.prepare("UPDATE sessions SET expires_at = 0").run();
    expect((await call(get())).status).toBe(401);
  });
});

describe("strict independent calendar snapshots", () => {
  it("reads a real-source contract with original event times and explicit prefix states", async () => {
    const input = fixture();
    input.source.transport = "connector";
    input.events = ["合成待确认", "✅ [已成交 2026-10-15] 合成测试", "⏸️ [已跳过 2026-10-15] 合成测试",
      "🔄 [推迟至 2026-10-17] 合成测试"].map((title, n) => ({
        id: `synthetic-${n}`, title, status: "confirmed", start: { date: "2026-10-16" }, end: { date: "2026-10-17" },
      }));
    expect((await call(put(input))).status).toBe(200);
    const result = await view();
    expect(result).toMatchObject({
      state: "available", read_only: true, sustained_authorization: "unconfirmed",
      snapshot: { stale: false, source: input.source, window: input.window },
    });
    expect(result.snapshot?.events.map(e => [e.execution_status, e.actionable])).toEqual([
      ["unconfirmed", true], ["recorded_done", false], ["recorded_skipped", false], ["recorded_postponed", false],
    ]);
    expect(result.snapshot?.events[0].start).toEqual({ date: "2026-10-16" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dashboard_batches").first("n")).toBe(0);
    expect((await call(new Request("http://localhost/api/dashboard", { headers: { Cookie: `gu_session=${SESSION}` } }))).status).toBe(404);
  });
  it("distinguishes successful empty queries from no connection", async () => {
    const input = fixture(); input.events = [];
    expect((await call(put(input))).status).toBe(200);
    expect(await view()).toMatchObject({ state: "empty", last_attempt: { status: "success" }, snapshot: { events: [] } });
  });
  it("preserves last success after a reported failure or revoked authorization", async () => {
    expect((await call(put(fixture())))).toHaveProperty("status", 200);
    const input = fixture(NOW - 30_000);
    input.status = "failed"; input.complete = false; input.error_code = "fetch_failed"; input.events = [];
    expect((await call(put(input))).status).toBe(200);
    expect(await view()).toMatchObject({
      state: "failed", reason: "fetch_failed", last_attempt: { status: "failed" },
      snapshot: { events: [{ id: "synthetic-only" }] },
    });
    input.attempted_at = new Date(NOW).toISOString();
    input.status = "not_connected"; input.error_code = "authorization_revoked";
    expect((await call(put(input))).status).toBe(200);
    expect(await view()).toMatchObject({
      state: "not_connected", reason: "authorization_revoked", snapshot: { events: [{ id: "synthetic-only" }] },
    });
  });
  it("reports a first failed attempt without inventing a successful connection", async () => {
    const input = fixture(); input.status = "failed"; input.complete = false; input.error_code = "permission_denied"; input.events = [];
    expect((await call(put(input))).status).toBe(200);
    expect(await view()).toMatchObject({ state: "failed", last_success: null, snapshot: null });
  });
  it("expires snapshots by elapsed time and at Beijing midnight", async () => {
    expect((await call(put(fixture()))).status).toBe(200);
    vi.mocked(Date.now).mockReturnValue(NOW + CALENDAR_MAX_AGE_MS);
    expect(await view()).toMatchObject({ state: "stale", snapshot: { stale_reason: "age" } });
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-10-16T00:00:00+08:00"));
    expect(await view()).toMatchObject({ state: "stale", snapshot: { stale_reason: "window_changed" } });
  });
  it("calculates exclusive four-day windows across years and leap days", () => {
    expect(calendarWindow(Date.parse("2026-12-31T16:30:00Z"))).toEqual({
      start: "2027-01-01T00:00:00+08:00", end: "2027-01-05T00:00:00+08:00",
    });
    expect(calendarWindow(Date.parse("2028-02-28T00:00:00+08:00")).end).toBe("2028-03-03T00:00:00+08:00");
  });
  it("accepts overlapping multi-day events and explicit foreign offsets", async () => {
    const input = fixture();
    input.events[0].start = { date_time: "2026-10-14T23:00:00-04:00" };
    input.events[0].end = { date_time: "2026-10-19T00:00:00+08:00" };
    expect((await call(put(input))).status).toBe(200);
  });
  it.each([
    ["wrong calendar", (d: CalendarUpload) => { d.calendar_id = "primary"; }],
    ["wrong timezone", (d: Record<string, unknown>) => { d.timezone = "UTC"; }],
    ["missing complete", (d: Record<string, unknown>) => { delete d.complete; }],
    ["partial results", (d: CalendarUpload) => { d.complete = false; }],
    ["unknown extra field", (d: Record<string, unknown>) => { d.access_token = "synthetic-forbidden-field"; }],
    ["array transport", (d: Record<string, unknown>) => { (d.source as Record<string, unknown>).transport = ["connector"]; }],
    ["array event status", (d: Record<string, unknown>) => { (d.events as Record<string, unknown>[])[0].status = ["confirmed"]; }],
    ["wrong window", (d: CalendarUpload) => { d.window.end = "2026-10-18T00:00:00+08:00"; }],
    ["future attempt", (d: CalendarUpload) => { d.attempted_at = new Date(NOW + 1).toISOString(); }],
    ["stale attempt", (d: CalendarUpload) => { d.attempted_at = new Date(NOW - CALENDAR_MAX_AGE_MS).toISOString(); }],
    ["no offset", (d: CalendarUpload) => { d.attempted_at = "2026-10-15T11:59:00"; }],
    ["invalid date", (d: CalendarUpload) => { d.attempted_at = "2026-02-30T11:59:00Z"; }],
    ["mixed time types", (d: CalendarUpload) => { d.events[0].end = { date: "2026-10-16" }; }],
    ["zero duration", (d: CalendarUpload) => { d.events[0].end = d.events[0].start; }],
    ["invalid offset", (d: CalendarUpload) => { d.events[0].start = { date_time: "2026-10-15T10:00:00+14:30" }; }],
    ["duplicate ids", (d: CalendarUpload) => { d.events.push(d.events[0]); }],
    ["outside window", (d: CalendarUpload) => { d.events[0].start = { date: "2026-10-19" }; d.events[0].end = { date: "2026-10-20" }; }],
    ["ends at window start", (d: CalendarUpload) => { d.events[0].start = { date: "2026-10-14" }; d.events[0].end = { date: "2026-10-15" }; }],
    ["cancelled event", (d: Record<string, unknown>) => { (d.events as Record<string, unknown>[])[0].status = "cancelled"; }],
    ["failed with events", (d: CalendarUpload) => { d.status = "failed"; d.complete = false; d.error_code = "fetch_failed"; }],
    ["raw error text", (d: Record<string, unknown>) => { d.error_code = "raw connector error"; }],
    ["array error code", (d: Record<string, unknown>) => {
      d.status = "failed"; d.complete = false; d.events = []; d.error_code = ["fetch_failed"];
    }],
  ])("rejects %s without modifying current data", async (_label, mutate) => {
    expect((await call(put(fixture()))).status).toBe(200);
    const input = JSON.parse(JSON.stringify(fixture()));
    mutate(input);
    expect((await call(put(input))).status).toBe(400);
    expect(await view()).toMatchObject({ state: "available", last_attempt: { status: "success" } });
  });
  it("rejects excessive, malformed, and non-JSON bodies", async () => {
    expect((await call(put({ padding: "x".repeat(256 * 1024) }))).status).toBe(400);
    expect((await call(new Request("http://localhost/api/calendar/sync", {
      method: "PUT", headers: { Authorization: `Bearer ${env.UPLOAD_TOKEN}`, "Content-Type": "application/json" }, body: "{",
    }))).status).toBe(400);
    expect((await call(put(fixture(), env.UPLOAD_TOKEN, { "Content-Type": "text/plain" }))).status).toBe(400);
    const input = fixture(); input.events = Array.from({ length: 501 }, () => input.events[0]);
    expect((await call(put(input))).status).toBe(400);
  });
});

describe("calendar ordering and persistence", () => {
  it("is idempotent but rejects older attempts and different equal-time contents", async () => {
    const input = fixture();
    const first = await (await call(put(input))).json() as { received_at: string };
    vi.mocked(Date.now).mockReturnValue(NOW + 1000);
    const retry = await call(put(input));
    expect(await retry.json()).toMatchObject({ ok: true, idempotent: true, received_at: first.received_at });
    const changed = fixture(); changed.events = [];
    expect((await call(put(changed))).status).toBe(409);
    expect((await call(put(fixture(NOW - 120_000)))).status).toBe(409);
    expect(await view()).toMatchObject({ state: "available", last_attempt: { received_at: first.received_at } });
  });
  it("orders concurrent writes atomically and permits recovery after failure", async () => {
    const inputs = [fixture(NOW - 90_000), fixture(NOW - 60_000), fixture(NOW - 30_000)];
    const results = await Promise.all(inputs.reverse().map(d => call(put(d))));
    expect(results.every(r => [200, 409].includes(r.status))).toBe(true);
    expect((await view()).last_success?.fetched_at).toBe(new Date(NOW - 30_000).toISOString());
    const failure = fixture(NOW - 10_000);
    failure.events = []; failure.status = "failed"; failure.complete = false; failure.error_code = "fetch_failed";
    expect((await call(put(failure))).status).toBe(200);
    expect((await call(put(fixture(NOW - 20_000)))).status).toBe(409);
    expect((await call(put(fixture(NOW)))).status).toBe(200);
    expect((await view()).state).toBe("available");
  });
  it("retains the previous snapshot when storage fails and returns no internals", async () => {
    expect((await call(put(fixture()))).status).toBe(200);
    await env.DB.exec("CREATE TRIGGER fail_calendar BEFORE UPDATE ON calendar_sync_state BEGIN SELECT RAISE(ABORT, 'synthetic-private-storage-error'); END;");
    const result = await call(put(fixture(NOW)));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("synthetic-private-storage-error");
    expect((await view()).last_success?.fetched_at).toBe(new Date(NOW - 60_000).toISOString());
  });
  it("does not expose a snapshot belonging to a previous deployment calendar ID", async () => {
    expect((await call(put(fixture()))).status).toBe(200);
    const changed = { ...bindings, INVESTMENT_CALENDAR_ID: "different@test.invalid" };
    expect(await (await call(get(), changed)).json()).toMatchObject({ state: "not_connected", snapshot: null });
    const input = fixture(NOW); input.calendar_id = changed.INVESTMENT_CALENDAR_ID;
    expect((await call(put(input), changed)).status).toBe(409);
  });
  it("does not touch an existing six-array batch during calendar updates", async () => {
    const id = await hash("synthetic-investment-batch");
    await env.DB.prepare("INSERT INTO dashboard_batches (id, generated_at, received_at, payload) VALUES (?, ?, ?, ?)")
      .bind(id, new Date(NOW).toISOString(), new Date(NOW).toISOString(), "{}").run();
    await env.DB.prepare("INSERT INTO dashboard_current (singleton, batch_id) VALUES (1, ?)").bind(id).run();
    expect((await call(put(fixture()))).status).toBe(200);
    expect(await env.DB.prepare("SELECT batch_id FROM dashboard_current").first("batch_id")).toBe(id);
    expect(await env.DB.prepare("SELECT payload FROM dashboard_batches WHERE id = ?").bind(id).first("payload")).toBe("{}");
  });
});
