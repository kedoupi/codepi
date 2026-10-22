import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyGithub } from './github-notify.mjs';

function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return body; } }; }

test('finds the long-lived observation issue and appends a safe comment', async () => {
  const calls = [];
  const request = async (url, options = {}) => { calls.push({ url, options }); if (url.includes('/issues?')) return response([{ number: 7, title: 'codepi release observations' }]); return response({ id: 99 }); };
  await notifyGithub({ releaseId: 'rel-1', severity: 'critical', summary: 'bad?token=secret', services: [{ service: 'api' }] }, { env: { GITHUB_TOKEN: 'synthetic', GITHUB_REPOSITORY: 'owner/repo' }, fetchImpl: request });
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.doesNotMatch(calls.at(-1).options.body, /secret/);
});

test('creates the issue when it does not exist', async () => {
  const calls = [];
  const request = async (url, options = {}) => { calls.push({ url, options }); if (url.includes('/issues?')) return response([]); if (options.method === 'POST' && url.endsWith('/issues')) return response({ number: 8 }); return response({ id: 100 }); };
  await notifyGithub({ releaseId: 'rel-2', severity: 'degraded', summary: 'slow', services: [] }, { env: { GITHUB_TOKEN: 'synthetic', GITHUB_REPOSITORY: 'owner/repo' }, fetchImpl: request });
  assert.ok(calls.some(call => call.options.method === 'POST' && call.url.endsWith('/issues')));
});

test('missing token is reported as a notification error without network access', async () => {
  let called = false;
  await assert.rejects(notifyGithub({ releaseId: 'rel-3' }, { env: {}, fetchImpl: async () => { called = true; } }), /token is missing/);
  assert.equal(called, false);
});

test('permission failures are sanitized', async () => {
  await assert.rejects(notifyGithub({ releaseId: 'rel-4' }, { env: { GITHUB_TOKEN: 'synthetic', GITHUB_REPOSITORY: 'owner/repo' }, fetchImpl: async () => response({ message: 'secret' }, 403) }), /HTTP 403/);
});

test('existing label 422 is ignored and duplicate event comments are skipped', async () => {
  const calls = [];
  const request = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/issues?')) return response([]);
    if (url.endsWith('/labels')) return response({ message: 'already exists' }, 422);
    if (url.endsWith('/issues')) return response({ number: 9 });
    if (url.includes('/comments')) return response([{ body: 'event_id: evt-1' }]);
    return response({ id: 1 });
  };
  const result = await notifyGithub({ event_id: 'evt-1', releaseId: 'rel-5', severity: 'critical' }, { env: { GITHUB_TOKEN: 'synthetic', GITHUB_REPOSITORY: 'owner/repo' }, fetchImpl: request });
  assert.equal(result.issueNumber, 9);
});
