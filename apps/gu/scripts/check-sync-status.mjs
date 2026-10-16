import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { summarizeSync } from "./sync-status.mjs";

const now = Date.parse("2026-10-18T12:00:00+08:00"); // Synthetic Sunday.
const dashboard = {
  batch_id: "a".repeat(64), received_at: "2026-10-16T23:00:00Z",
  data: { account: [{ generated_at: "2026-10-17T06:53:00+08:00", data_mode: "live" }],
    positions: [{ ticker: "SYNTHETIC" }], market: [] },
};

test("reports elapsed age on Sunday without declaring a missed update or failure", () => {
  const result = summarizeSync({ dashboard, now });
  assert.equal(result.batch.generated_age_seconds, 104820);
  assert.equal(result.last_success.batch_id, dashboard.batch_id);
  assert.equal(result.last_attempt, null);
  assert.equal(result.failure_status, "unconfirmed");
  assert.equal(result.update_expectation, "unconfirmed_without_trading_calendar");
  assert.equal(result.batch.quote_time_status, "unconfirmed");
});
test("recognizes only explicitly reported execution failure and emits no raw error", () => {
  const result = summarizeSync({ dashboard, now, attempt: {
    schema_version: 1, attempted_at: "2026-10-17T00:00:00Z",
    status: "failed", error_code: "network_error", raw_error: "PRIVATE_MUST_NOT_LEAK",
  } });
  assert.equal(result.failure_status, "reported_failure");
  assert.equal(result.last_attempt.error_code, "network_error");
  assert.equal(JSON.stringify(result).includes("PRIVATE_MUST_NOT_LEAK"), false);
});
test("matches a successful execution receipt against the current batch", () => {
  for (const matches of [true, false]) {
    const result = summarizeSync({ dashboard, now, attempt: {
      schema_version: 1, attempted_at: "2026-10-17T00:00:00Z", status: "success",
      error_code: null, batch_id: (matches ? "a" : "b").repeat(64),
    } });
    assert.equal(result.last_attempt.matches_current_batch, matches);
  }
});
test("does not infer market phase from a timestamp and handles future source time", () => {
  const input = structuredClone(dashboard);
  input.data.positions[0].quote_time = "2026-10-16T16:00:00-04:00";
  input.data.account[0].generated_at = "2026-10-20T00:00:00Z";
  const result = summarizeSync({ dashboard: input, now });
  assert.equal(result.batch.quote_time_status, "recorded");
  assert.equal(result.batch.market_phase_status, "unconfirmed");
  assert.equal(result.batch.future_timestamp, true);
});
test("calendar snapshot evidence does not imply sustained authorization", () => {
  const result = summarizeSync({ dashboard, now, calendar: {
    schema_version: 1, state: "stale",
    snapshot: { fetched_at: "2026-10-16T00:00:00Z", source: { provider: "google_calendar" } },
  } });
  assert.equal(result.calendar.source_status, "reported_snapshot");
  assert.equal(result.calendar.sustained_authorization, "unconfirmed");
  assert.equal(result.calendar.state, "stale");
});
test("rejects arbitrary errors or malformed metadata and handles an empty dashboard", () => {
  assert.equal(summarizeSync({ dashboard: { empty: true }, now }).last_success, null);
  assert.throws(() => summarizeSync({ dashboard: {}, now }));
  assert.throws(() => summarizeSync({ dashboard, calendar: { state: "connected" }, now }));
  assert.throws(() => summarizeSync({ dashboard, now, attempt: {
    schema_version: 1, attempted_at: "2026-10-17T00:00:00Z", status: "failed", error_code: "raw private error",
  } }));
});
test("CLI consumes local files, redacts invalid input errors, and supports help", () => {
  const dir = mkdtempSync(join(tmpdir(), "gu-status-test-"));
  const path = join(dir, "response.json");
  const cli = args => spawnSync(process.execPath, [new URL("./sync-status.mjs", import.meta.url).pathname, ...args], { encoding: "utf8" });
  try {
    writeFileSync(path, JSON.stringify(dashboard));
    const valid = cli(["--dashboard", path, "--now", new Date(now).toISOString()]);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).batch.batch_id, dashboard.batch_id);
    writeFileSync(path, "{PRIVATE_MUST_NOT_LEAK");
    const invalid = cli(["--dashboard", path]);
    assert.equal(invalid.status, 1);
    assert.equal((invalid.stdout + invalid.stderr).includes("PRIVATE_MUST_NOT_LEAK"), false);
    assert.equal(cli(["--help"]).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
