import assert from "node:assert/strict";
import { test } from "node:test";
import { compareOuraIdentity, fetchPersonalInfo } from "../src/lib/oura.ts";

test("identity diagnostics distinguish formatting from a different provider ID without returning identifiers", () => {
  const stored = { id: "synthetic-provider-123", email: "owner@example.invalid" };
  for (const [id, comparison] of [
    [stored.id, "exact"],
    [` ${stored.id} `, "whitespace_only"],
    [stored.id.toUpperCase(), "case_only"],
    ["syntheticprovider123", "format_only"],
    ["other-provider-456", "different"],
  ]) {
    const result = compareOuraIdentity(stored, { id, email: stored.email });
    assert.deepEqual(result, {
      idComparison: comparison, emailComparison: "exact",
      storedIdLength: stored.id.length, receivedIdLength: id.length,
    });
    const serialized = JSON.stringify(result);
    for (const value of [stored.id, id, stored.email]) {
      assert.equal(serialized.includes(value), false);
    }
  }
});

test("matching email remains diagnostic even when provider IDs differ; missing emails are not a match", () => {
  const stored = { id: "synthetic-old", email: "owner@example.invalid" };
  for (const [email, comparison] of [
    [stored.email, "exact"],
    [" OWNER@example.invalid ", "format_only"],
    ["someone@example.invalid", "different"],
    [undefined, "unavailable"],
    [null, "unavailable"],
    ["", "unavailable"],
    [" ", "unavailable"],
  ] as const) {
    assert.equal(compareOuraIdentity(stored, { id: "synthetic-new", email }).emailComparison, comparison);
    assert.equal(compareOuraIdentity(stored, { id: "synthetic-new", email }).idComparison, "different");
  }
  assert.equal(compareOuraIdentity({ id: stored.id }, stored).emailComparison, "unavailable");
});

for (const id of [null, undefined, 123, {}, [], "", " "]) {
  test(`personal_info rejects ${JSON.stringify(id)} as an invalid provider identity`, async t => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ id }));
    await assert.rejects(fetchPersonalInfo("synthetic-access"), { code: "invalid_upstream_response" });
  });
}
