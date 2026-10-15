import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loggedOutMe } from '../src/lib/session.ts';
import { fetchAi } from '../src/lib/ai.ts';

test('logout and confirmed expiration preserve public SSO options and discard private state', () => {
  const previous = {
    authenticated: true, source: 'sso', userId: 'owner',
    ssoEnabled: true, oauthConfigured: true, allowDevLogin: true,
    websiteAccount: { userId: 'owner', source: 'sso' },
    ouraConnection: { status: 'connected', ouraUserId: 'private-provider-id' },
    capabilities: { personal: true }, sync: { private: true },
  };
  assert.deepEqual(loggedOutMe(previous), {
    authenticated: false, source: null, userId: null,
    ssoEnabled: true, oauthConfigured: true, allowDevLogin: false,
  });
  assert.equal(loggedOutMe({ ...previous, ssoEnabled: false }).allowDevLogin, true);
  assert.equal(loggedOutMe(null).allowDevLogin, false);
});

test('AI uses api structured errors including session, provider and infrastructure failures', async t => {
  for (const [status, code] of [[401, 'unauthorized'], [401, 'reconnect_required'], [503, 'auth_unavailable']]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: code, retryAt: 'retry' }, {
      status, headers: { 'X-Request-ID': 'ai-request' },
    }));
    await assert.rejects(fetchAi(7), { code, status, requestId: 'ai-request', retryAt: 'retry' });
    mock.mock.restore();
  }
});
