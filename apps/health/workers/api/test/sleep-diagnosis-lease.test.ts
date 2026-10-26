import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDay } from "../../../shared/dates.ts";
import { encryptJson, packEncryptedBlob } from "../src/lib/crypto.ts";
import { diagnoseSleepWindow } from "../src/lib/health-records.ts";
import { tokenAad } from "../src/lib/tokens.ts";

const flush = () => new Promise(resolve => setImmediate(resolve));

test("a heartbeat failure during the token read stops the provider refresh", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const day = calendarDay();
  const userId = "test-user";
  const expired = packEncryptedBlob(await encryptJson("integration-encryption-secret", {
    refresh_token: "stored-private-refresh",
    access_token: "stored-private-access",
    expires_at: Date.now() - 60_000,
  }, tokenAad(userId)));
  let leaseId: string | null = null;
  let leaseUntil = 0;
  let tokenWrites = 0;
  let openRead = () => {};
  let markReadStarted = () => {};
  const readGate = new Promise<void>(resolve => { openRead = resolve; });
  const readStarted = new Promise<void>(resolve => { markReadStarted = resolve; });
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { args = values; return statement; },
        async first() {
          if (sql.includes("INSERT INTO sync_state")) {
            if (leaseUntil >= Number(args[3])) return null;
            leaseId = String(args[1]);
            leaseUntil = Number(args[2]);
            return { lease_id: leaseId };
          }
          if (sql.includes("UPDATE sync_state SET lease_until=?")) {
            if (leaseId !== args[2] || leaseUntil <= Number(args[3])) return null;
            leaseUntil = Number(args[0]);
            return { lease_id: leaseId };
          }
          if (sql.includes("FROM encrypted_tokens")) {
            markReadStarted();
            await readGate;
            return expired;
          }
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          if (sql.includes("UPDATE sync_state SET lease_until=0")) {
            if (leaseId === args[1]) leaseUntil = 0;
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE encrypted_tokens")) {
            tokenWrites++;
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected write: ${sql}`);
        },
        async all() { throw new Error(`Unexpected all query: ${sql}`); },
      };
      return statement;
    },
  };
  const env = {
    DB: db,
    TOKEN_ENCRYPTION_KEY: "integration-encryption-secret",
    OURA_CLIENT_ID: "integration-client",
    OURA_CLIENT_SECRET: "integration-client-secret",
  } as any;
  let providerCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    providerCalls++;
    return Response.json({
      access_token: "refreshed-private-access",
      refresh_token: "refreshed-private-refresh",
      expires_in: 3600,
    });
  });
  const pending = diagnoseSleepWindow(
    new Request("https://oura.example/api/me/health-records/sleep-diagnosis"),
    env, userId, day, day,
  );
  try {
    await readStarted;
    leaseId = "successor";
    leaseUntil = Date.now() + 120_000;
    t.mock.timers.tick(30_000);
    await flush();
    openRead();
    await assert.rejects(pending, { code: "sync_in_progress" });
    assert.equal(providerCalls, 0, "the provider refresh ran after the heartbeat lost the lease");
    assert.equal(tokenWrites, 0);
    assert.equal(leaseId, "successor");
  } finally {
    openRead();
    await pending.catch(() => {});
  }
});
