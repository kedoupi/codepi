import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, normalizeApiError, storageQuotaResetAt } from "../src/lib/errors.ts";

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
