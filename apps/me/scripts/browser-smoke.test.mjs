import assert from "node:assert/strict";
import test from "node:test";

import { closeServer, resolveSmokePort, startProxy } from "./browser-smoke.mjs";

test("smoke defaults to an ephemeral port and preserves explicit overrides", () => {
  assert.equal(resolveSmokePort(undefined), 0);
  assert.equal(resolveSmokePort(""), 0);
  assert.equal(resolveSmokePort("0"), 0);
  assert.equal(resolveSmokePort("8796"), 8796);
  assert.throws(() => resolveSmokePort("not-a-port"), /ME_SMOKE_PORT/);
  assert.throws(() => resolveSmokePort("65536"), /ME_SMOKE_PORT/);
});

test("duplicate smoke startup rejects instead of sharing a listener", async () => {
  const first = await startProxy(null, 0);
  try {
    assert.ok(first.port > 0);
    assert.equal(new URL(first.origin).port, String(first.port));
    await assert.rejects(startProxy(null, first.port), /EADDRINUSE/);
  } finally {
    await closeServer(first.server);
  }
});
