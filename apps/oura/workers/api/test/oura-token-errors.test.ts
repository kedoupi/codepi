import assert from "node:assert/strict";
import { test } from "node:test";
import { refreshAccessToken } from "../src/lib/oura.ts";

const args = { refreshToken: "test-refresh", clientId: "test-client", clientSecret: "test-secret" };

for (const [status, body, code] of [
  [400, { error: "invalid_grant" }, "reconnect_required"],
  [400, { error: "invalid_request" }, "upstream_request_rejected"],
  [401, { error: "invalid_client" }, "oura_not_configured"],
  [429, { error: "invalid_grant" }, "rate_limited"],
  [500, { error: "invalid_grant" }, "upstream_unavailable"],
] as const) {
  test(`refresh response ${status}/${body.error} is classified without exposing its body`, async t => {
    t.mock.method(globalThis, "fetch", async () => Response.json({
      ...body, error_description: "secret-provider-detail",
    }, { status }));
    await assert.rejects(refreshAccessToken(args), (error: any) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes("secret-provider-detail"), false);
      return true;
    });
  });
}

test("malformed token lifetime cannot become a permanently unrefreshable token", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    access_token: "access", refresh_token: "refresh", expires_in: "not-a-number",
  }));
  await assert.rejects(refreshAccessToken(args), { code: "invalid_upstream_response" });
});
