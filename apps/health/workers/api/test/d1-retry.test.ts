import assert from "node:assert/strict";
import { test } from "node:test";
import { withD1Retry } from "../src/lib/d1-retry.ts";

test("retries a transient D1 error once", async () => {
  let calls = 0;
  const result = await withD1Retry(async () => {
    calls++;
    if (calls === 1) throw new Error("D1_ERROR: internal error");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("throws after one transient D1 retry", async () => {
  let calls = 0;
  await assert.rejects(withD1Retry(async () => {
    calls++;
    throw new Error("D1_ERROR: internal error");
  }), /D1_ERROR: internal error/);
  assert.equal(calls, 2);
});

test("does not retry a D1 write quota error", async () => {
  let calls = 0;
  await assert.rejects(withD1Retry(async () => {
    calls++;
    throw new Error("D1_ERROR: free tier daily row write limit exceeded [code: 7500]");
  }), /7500/);
  assert.equal(calls, 1);
});
