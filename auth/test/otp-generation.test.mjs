import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from '../dist/index.js';
import { fixture, authOrigin } from './runtime.mjs';

function pauseAfterAttempt(db) {
  const reserved = Promise.withResolvers();
  const resumed = Promise.withResolvers();
  return {
    reserved: reserved.promise,
    resume: resumed.resolve,
    db: {
      prepare(query) {
        const statement = db.prepare(query);
        if (!query.includes('SET attempts=attempts+1')) return statement;
        return {
          bind(...values) {
            const bound = statement.bind(...values);
            return {
              async first() {
                // Execute the real D1 update, then delay delivery of its snapshot.
                const snapshot = await bound.first();
                reserved.resolve(snapshot);
                await resumed.promise;
                return snapshot;
              },
            };
          },
        };
      },
    },
  };
}

for (const scenario of [
  { name: 'an old attempt cannot guess the replacement OTP after five failures', guess: 123456, next: 123456, locked: true },
  { name: 'a correct old OTP cannot consume a replacement with a different hash', guess: 654321, next: 123456, locked: false },
  { name: 'a repeated OTP value still requires the same expiry generation', guess: 654321, next: 654321, locked: false },
]) {
  test(scenario.name, { timeout: 30000 }, async t => {
    const f = await fixture(t);
    const tx = await f.begin();
    const env = await f.runtime.getBindings('auth');
    let now = Date.now(), nextOtp = 654321;
    t.mock.method(Date, 'now', () => now);
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    t.mock.method(crypto, 'getRandomValues', array => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = nextOtp;
        return array;
      }
      return getRandomValues(array);
    });
    const call = (path, data, bindings = env) => handler.fetch(new Request(authOrigin + path, {
      method: 'POST',
      headers: { Cookie: tx.txCookie, Origin: authOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }), bindings);
    const send = async () => {
      const response = await call('/api/auth/request-otp', {});
      assert.equal(response.status, 200);
      assert.equal((await response.json()).dev_otp, String(nextOtp));
    };
    await send();
    const before = await f.db.prepare('SELECT otp_hash,otp_expires_at FROM auth_transactions').first();

    // Reach the resend cooldown without sleeping or bypassing the send budget.
    now += 61000;
    const gate = pauseAfterAttempt(env.DB);
    t.after(gate.resume);
    const pending = call('/api/auth/verify-otp', { code: String(scenario.guess) }, { ...env, DB: gate.db });
    try {
      const snapshot = await gate.reserved;
      assert.equal(snapshot.otp_hash, before.otp_hash);
      assert.equal(snapshot.otp_expires_at, before.otp_expires_at);
      assert.equal((await f.db.prepare('SELECT attempts FROM auth_transactions').first()).attempts, 1);

      nextOtp = scenario.next;
      await send();
      const after = await f.db.prepare('SELECT otp_hash,otp_expires_at,attempts FROM auth_transactions').first();
      assert.equal(after.attempts, 0);
      assert.equal(after.otp_expires_at, before.otp_expires_at + 61000);
      assert.equal(after.otp_hash === before.otp_hash, scenario.next === 654321);
      assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM auth_otp_sends').first()).n, 2);
      if (scenario.locked) {
        for (let i = 0; i < 5; i++) {
          const rejected = await call('/api/auth/verify-otp', { code: '000000' });
          assert.equal(rejected.status, 400);
          assert.deepEqual(await rejected.json(), { error: 'invalid_code' });
        }
        assert.equal((await f.db.prepare('SELECT attempts FROM auth_transactions').first()).attempts, 5);
      }

      gate.resume();
      const rejected = await pending;
      assert.equal(rejected.status, 400);
      assert.deepEqual(await rejected.json(), { error: 'invalid_code' });
      assert.equal(rejected.headers.get('Set-Cookie'), null);
      assert.equal((await f.db.prepare('SELECT consumed_at FROM auth_transactions').first()).consumed_at, null);
      assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM auth_sessions').first()).n, 0);
      assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM auth_codes').first()).n, 0);

      const current = await call('/api/auth/verify-otp', { code: String(nextOtp) });
      assert.equal(current.status, scenario.locked ? 400 : 200);
      assert.equal((await f.db.prepare('SELECT attempts FROM auth_transactions').first()).attempts, scenario.locked ? 5 : 1);
      assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM auth_sessions').first()).n, scenario.locked ? 0 : 1);
    } finally {
      gate.resume();
      await pending;
    }
  });
}
