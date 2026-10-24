import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, normalizeApiError, storageQuotaResetAt, upstreamFetch } from "../src/lib/errors.ts";

test("Oura's missing-scope 401 is a permission error, not an expired token", async t => {
  for (const scope of ["stress", "ring_configuration"]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({
      detail: `Token is not authorized access ${scope} scope.`,
    }, { status: 401 }));
    await assert.rejects(upstreamFetch("https://api.ouraring.com/v2/usercollection/daily_resilience"),
      (error: unknown) => error instanceof ApiError && error.code === "oura_scope_required" && error.status === 403);
    t.mock.restoreAll();
  }
});

test("unknown, malformed and oversized Oura errors keep their HTTP classification", async t => {
  for (const response of [
    new Response("not JSON", { status: 401 }),
    Response.json({ detail: "expired token" }, { status: 401 }),
    Response.json({ detail: "Token is not authorized access stress scope.", padding: "x".repeat(4096) }, { status: 401 }),
    Response.json({ detail: "subscription expired" }, { status: 403 }),
  ]) {
    const expected = response.status === 401 ? "oura_access_token_rejected" : "permission_or_membership_required";
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(upstreamFetch("https://api.ouraring.com/v2/usercollection/daily_resilience"),
      (error: unknown) => error instanceof ApiError && error.code === expected);
    t.mock.restoreAll();
  }
});

test("Oura rate limits stay rate_limited instead of becoming upstream_unavailable", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 429 }));
  await assert.rejects(
    upstreamFetch("https://api.ouraring.com/v2/usercollection/daily_sleep"),
    (error: unknown) => error instanceof ApiError && error.code === "rate_limited" && error.status === 429,
  );
});

test("permission diagnostics read split chunks and cancel oversized streams", async t => {
  let cancelled = false;
  const encoder = new TextEncoder();
  let stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"detail":"Token is not authorized '));
      controller.enqueue(encoder.encode('access ring_configuration scope."}'));
      controller.close();
    },
  });
  t.mock.method(globalThis, "fetch", async () => new Response(stream, { status: 401 }));
  await assert.rejects(upstreamFetch("https://api.ouraring.com/v2/usercollection/ring_configuration"),
    (error: unknown) => error instanceof ApiError && error.code === "oura_scope_required");
  stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode("x".repeat(4097))); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(upstreamFetch("https://api.ouraring.com/v2/usercollection/ring_configuration"),
    (error: unknown) => error instanceof ApiError && error.code === "oura_access_token_rejected");
  assert.equal(cancelled, true, "discard the unbounded remainder instead of buffering it");
});

test("D1 write quota is recognized through nested causes without misclassifying read limits", () => {
  const quota = new Error("D1_ERROR: free tier daily row write limit exceeded [code: 7500]");
  assert.equal(normalizeApiError(new Error("DB batch failed", { cause: quota })).code, "storage_write_quota_exceeded");
  assert.equal(normalizeApiError(new Error("D1_ERROR: batch failed", {
    cause: new Error("daily row write limit exceeded [code: 7500]"),
  })).code, "storage_write_quota_exceeded");
  assert.equal(normalizeApiError(new Error("D1_ERROR: daily row read limit [code: 7500]")).code, "internal_error");
  assert.equal(normalizeApiError(new Error("D1_ERROR: no such table")).code, "internal_error");
  assert.equal(normalizeApiError(new Error("Provider daily write limit")).code, "internal_error");
  const provider = new ApiError("reconnect_required", 401);
  assert.equal(normalizeApiError(provider), provider);
  assert.equal(normalizeApiError(null, "upstream_unavailable", 502).status, 502);
});

test("storage reset is the next UTC midnight across month and year boundaries", () => {
  for (const [now, next] of [
    ["2026-10-14T05:00:00Z", "2026-10-15T00:00:00.000Z"],
    ["2026-10-15T00:00:00Z", "2026-10-16T00:00:00.000Z"],
    ["2026-10-31T23:59:59Z", "2026-11-01T00:00:00.000Z"],
    ["2026-12-31T23:59:59Z", "2027-01-01T00:00:00.000Z"],
  ]) assert.equal(storageQuotaResetAt(Date.parse(now)), next);
});
