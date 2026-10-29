import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupExpiredData } from '../src/maintenance.ts';
import { fixture } from './runtime.mjs';

const NOW = Date.parse('2026-10-29T00:00:00.000Z');
const DAY = 86400_000;

test('OAuth maintenance removes expired state in bounded, repeatable passes', async t => {
  const f = await fixture(t);
  await f.db.batch([
    f.db.prepare(`INSERT INTO oauth_consent_requests
      (consent_id,client_id,user_id,redirect_uri,code_challenge,scope,resource,csrf_hash,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind('consent-expired', 'client', 'user', 'https://a.example/cb', 'challenge', 'scope', 'resource', 'csrf', NOW - 1),
    f.db.prepare(`INSERT INTO oauth_consent_requests
      (consent_id,client_id,user_id,redirect_uri,code_challenge,scope,resource,csrf_hash,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind('consent-live', 'client', 'user', 'https://a.example/cb', 'challenge', 'scope', 'resource', 'csrf', NOW + DAY),
    f.db.prepare(`INSERT INTO oauth_auth_codes
      (code_hash,client_id,user_id,redirect_uri,code_challenge,scope,resource,expires_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind('code-expired', 'client', 'user', 'https://a.example/cb', 'challenge', 'scope', 'resource', NOW - 1),
    f.db.prepare(`INSERT INTO oauth_auth_codes
      (code_hash,client_id,user_id,redirect_uri,code_challenge,scope,resource,expires_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind('code-live', 'client', 'user', 'https://a.example/cb', 'challenge', 'scope', 'resource', NOW + DAY),
    f.db.prepare(`INSERT INTO mcp_tokens
      (token_hash,user_id,client_id,kind,scope,resource,expires_at,family_id)
      VALUES (?,?,?,?,?,?,?,?)`).bind('access-expired', 'user', 'client', 'access', 'scope', 'resource', NOW - 1, 'family-expired'),
    f.db.prepare(`INSERT INTO mcp_tokens
      (token_hash,user_id,client_id,kind,scope,resource,expires_at,family_id,revoked_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind('refresh-old-revoked', 'user', 'client', 'refresh', 'scope', 'resource', NOW + DAY, 'family-old', NOW - 8 * DAY),
    f.db.prepare(`INSERT INTO mcp_tokens
      (token_hash,user_id,client_id,kind,scope,resource,expires_at,family_id,revoked_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind('refresh-recent-revoked', 'user', 'client', 'refresh', 'scope', 'resource', NOW + DAY, 'family-recent', NOW - 2 * DAY),
    f.db.prepare(`INSERT INTO mcp_tokens
      (token_hash,user_id,client_id,kind,scope,resource,expires_at,family_id)
      VALUES (?,?,?,?,?,?,?,?)`).bind('refresh-live', 'user', 'client', 'refresh', 'scope', 'resource', NOW + DAY, 'family-live'),
    f.db.prepare(`INSERT INTO mcp_personal_tokens
      (token_id,token_hash,user_id,name,scope,expires_at)
      VALUES (?,?,?,?,?,?)`).bind('pat-expired', 'hash-expired', 'user', 'expired', 'scope', NOW - 1),
    f.db.prepare(`INSERT INTO mcp_personal_tokens
      (token_id,token_hash,user_id,name,scope,expires_at)
      VALUES (?,?,?,?,?,?)`).bind('pat-live', 'hash-live', 'user', 'live', 'scope', NOW + DAY),
    f.db.prepare(`INSERT INTO kdp_sso_transactions
      (id,state_hash,code_verifier,return_to,created_at,expires_at)
      VALUES (?,?,?,?,?,?)`).bind('sso-tx-expired', 'state', 'verifier', '/', NOW - DAY, NOW - 1),
    f.db.prepare(`INSERT INTO kdp_sso_transactions
      (id,state_hash,code_verifier,return_to,created_at,expires_at)
      VALUES (?,?,?,?,?,?)`).bind('sso-tx-live', 'state', 'verifier', '/', NOW, NOW + DAY),
    f.db.prepare(`INSERT INTO kdp_sso_sessions
      (id,user_id,subject,central_ref,expires_at,created_at)
      VALUES (?,?,?,?,?,?)`).bind('sso-session-expired', 'user', 'subject', 'ref', NOW - 1, NOW - DAY),
    f.db.prepare(`INSERT INTO kdp_sso_sessions
      (id,user_id,subject,central_ref,expires_at,created_at)
      VALUES (?,?,?,?,?,?)`).bind('sso-session-live', 'user', 'subject', 'ref', NOW + DAY, NOW),
    f.db.prepare(`INSERT INTO oauth_registration_events
      (id,source_hash,bucket_started,created_at) VALUES (?,?,?,?)`).bind('registration-old', 'source', 0, NOW - 2 * DAY),
    f.db.prepare(`INSERT INTO oauth_registration_events
      (id,source_hash,bucket_started,created_at) VALUES (?,?,?,?)`).bind('registration-live', 'source', NOW, NOW),
  ]);

  const first = await cleanupExpiredData({ DB: f.db }, NOW);
  assert.deepEqual(first, {
    oauth_consent_requests: 1,
    oauth_auth_codes: 1,
    mcp_tokens: 2,
    mcp_personal_tokens: 1,
    kdp_sso_transactions: 1,
    kdp_sso_sessions: 1,
    oauth_registration_events: 1,
  });

  const count = async (table, idColumn, id) =>
    (await f.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${idColumn}=?`).bind(id).first()).count;
  assert.equal(await count('oauth_consent_requests', 'consent_id', 'consent-expired'), 0);
  assert.equal(await count('oauth_consent_requests', 'consent_id', 'consent-live'), 1);
  assert.equal(await count('oauth_auth_codes', 'code_hash', 'code-expired'), 0);
  assert.equal(await count('mcp_tokens', 'token_hash', 'refresh-old-revoked'), 0);
  assert.equal(await count('mcp_tokens', 'token_hash', 'refresh-recent-revoked'), 1);
  assert.equal(await count('mcp_tokens', 'token_hash', 'refresh-live'), 1);
  assert.equal(await count('mcp_personal_tokens', 'token_id', 'pat-live'), 1);
  assert.equal(await count('kdp_sso_transactions', 'id', 'sso-tx-live'), 1);
  assert.equal(await count('kdp_sso_sessions', 'id', 'sso-session-live'), 1);
  assert.equal(await count('oauth_registration_events', 'id', 'registration-live'), 1);

  const second = await cleanupExpiredData({ DB: f.db }, NOW);
  assert.deepEqual(second, {
    oauth_consent_requests: 0,
    oauth_auth_codes: 0,
    mcp_tokens: 0,
    mcp_personal_tokens: 0,
    kdp_sso_transactions: 0,
    kdp_sso_sessions: 0,
    oauth_registration_events: 0,
  });
});
