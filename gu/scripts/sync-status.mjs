import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const states = ["not_connected", "failed", "empty", "available", "stale"];
const errors = ["generation_failed", "validation_failed", "network_error", "sync_rejected"];
const isObject = value => typeof value === "object" && value !== null && !Array.isArray(value);
const timestamp = value => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const age = (value, now) => timestamp(value) ? Math.max(0, Math.floor((now - Date.parse(value)) / 1000)) : null;

export function summarizeSync({ dashboard, calendar = null, attempt = null, now = Date.now() }) {
  if (!Number.isFinite(now) || !isObject(dashboard)) throw new Error("Invalid status input");
  let batch = null;
  if (dashboard.empty !== true) {
    const account = dashboard.data?.account;
    if (!digest(dashboard.batch_id) || !timestamp(dashboard.received_at) ||
      !Array.isArray(account) || account.length !== 1 || !isObject(account[0]) ||
      !timestamp(account[0].generated_at)) throw new Error("Invalid dashboard response");
    const a = account[0];
    const rows = [dashboard.data.positions, dashboard.data.market].flatMap(rows => Array.isArray(rows) ? rows : []);
    batch = {
      batch_id: dashboard.batch_id,
      generated_at: a.generated_at,
      received_at: dashboard.received_at,
      generated_age_seconds: age(a.generated_at, now),
      received_age_seconds: age(dashboard.received_at, now),
      future_timestamp: Date.parse(a.generated_at) > now || Date.parse(dashboard.received_at) > now,
      source_mode: a.data_mode === "live" ? "live" : "unconfirmed",
      quote_time_status: rows.length && rows.every(row => isObject(row) && timestamp(row.quote_time)) ? "recorded" : "unconfirmed",
      // A date or label alone cannot establish a market session.
      market_phase_status: "unconfirmed",
    };
  }
  let lastAttempt = null;
  if (attempt !== null) {
    if (!isObject(attempt) || attempt.schema_version !== 1 || !timestamp(attempt.attempted_at) ||
      !["success", "failed"].includes(attempt.status) ||
      (attempt.status === "failed" && !errors.includes(attempt.error_code)) ||
      (attempt.status === "success" && (!digest(attempt.batch_id) || attempt.error_code !== null))) {
      throw new Error("Invalid execution receipt");
    }
    lastAttempt = {
      attempted_at: attempt.attempted_at, status: attempt.status,
      error_code: attempt.status === "failed" ? attempt.error_code : null,
      matches_current_batch: attempt.status === "success" ? attempt.batch_id === batch?.batch_id : null,
      evidence: "local_execution_receipt",
    };
  }
  let calendarStatus = { state: "unconfirmed", source_status: "unconfirmed", sustained_authorization: "unconfirmed" };
  if (calendar !== null) {
    if (!isObject(calendar) || calendar.schema_version !== 1 || !states.includes(calendar.state)) {
      throw new Error("Invalid calendar response");
    }
    calendarStatus = {
      state: calendar.state,
      source_status: calendar.snapshot?.source?.provider === "google_calendar" &&
        timestamp(calendar.snapshot?.fetched_at) ? "reported_snapshot" : "unconfirmed",
      sustained_authorization: "unconfirmed",
    };
  }
  return {
    schema_version: 1,
    inspected_at: new Date(now).toISOString(),
    batch,
    last_success: batch ? { batch_id: batch.batch_id, received_at: batch.received_at } : null,
    last_attempt: lastAttempt,
    failure_status: lastAttempt?.status === "failed" ? "reported_failure" : "unconfirmed",
    update_expectation: "unconfirmed_without_trading_calendar",
    calendar: calendarStatus,
  };
}

async function inputFile(path) {
  if ((await stat(path)).size > 8 * 1024 * 1024) throw new Error("Input too large");
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const usage = "Usage: node scripts/sync-status.mjs --dashboard FILE [--calendar FILE] [--attempt FILE] [--now ISO_TIMESTAMP]";
  if (args.length === 1 && args[0] === "--help") { console.log(usage); return; }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--dashboard", "--calendar", "--attempt", "--now"].includes(args[i]) ||
      !args[i + 1] || options[args[i]]) throw new Error(usage);
    options[args[i]] = args[i + 1];
  }
  if (!options["--dashboard"] || (options["--now"] && !timestamp(options["--now"]))) throw new Error(usage);
  const [dashboard, calendar, attempt] = await Promise.all([
    inputFile(options["--dashboard"]),
    options["--calendar"] ? inputFile(options["--calendar"]) : null,
    options["--attempt"] ? inputFile(options["--attempt"]) : null,
  ]);
  console.log(JSON.stringify(summarizeSync({
    dashboard, calendar, attempt, now: options["--now"] ? Date.parse(options["--now"]) : Date.now(),
  }), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Input files may contain private API data. Never echo their values or parser diagnostics.
    console.error("Status check failed: supply valid local API responses and an optional execution receipt. Use --help for arguments.");
    process.exitCode = 1;
  });
}
