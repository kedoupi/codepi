import assert from 'node:assert/strict';
import test from 'node:test';
import { createObservabilityClient, ObservabilityError } from './observability-api.mjs';

const response = (result, status = 200) => new Response(JSON.stringify({ success: status < 400, result }), { status, headers: { 'content-type': 'application/json' } });
const issue = (id) => ({ id, scriptName: 'auth', title: 'failure', firstSeenAt: '2026-10-23T00:00:00Z', lastSeenAt: '2026-10-23T00:01:00Z', occurrences: 2 });

test('lists paginated issues and maps their public shape', async () => {
  const calls = [];
  const client = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async (url) => {
    calls.push(url.toString());
    return response(url.searchParams.get('page') === 'next' ? { issues: [issue('two')] } : { issues: [issue('one')], next_page: 'next' });
  } });
  assert.deepEqual(await client.listIssues({ scriptName: 'auth', sinceMinutes: 30 }), [issue('one'), issue('two')]);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/workers\/observability\/issues\?/);
});

test('retries 429 and classifies authorization failures', async () => {
  let attempts = 0;
  const client = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async () => (++attempts < 3 ? response({}, 429) : response({ issues: [] })) });
  assert.deepEqual(await client.listIssues(), []);
  assert.equal(attempts, 3);
  await assert.rejects(() => createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async () => response({}, 403) }).listIssues(), error => error instanceof ObservabilityError && error.code === 'auth');
});

test('rejects malformed response and returns null for empty telemetry', async () => {
  await assert.rejects(() => createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async () => response({ nope: true }) }).listIssues(), error => error.code === 'schema');
  const client = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async (url) => url.pathname.endsWith('/keys') ? response({ keys: [] }) : response({}) });
  assert.equal(await client.queryWorkerMetrics({ scriptName: 'auth', sinceMinutes: 30 }), null);
});

test('queries telemetry and redacts occurrence query parameters', async () => {
  const client = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async (url) => {
    if (url.pathname.endsWith('/occurrences')) return response({ occurrences: [{ occurred_at: '2026-10-23T00:00:00Z', message: 'GET https://example.test/path?token=secret&email=private@example.test' }] });
    if (url.pathname.endsWith('/keys')) return response({ keys: ['invocations'] });
    if (url.pathname.endsWith('/query')) return response({ query: 'q' });
    return response({ metrics: { invocations: 20, errors: 1, errorRate: 0.05, p95LatencyMs: 1, p99LatencyMs: 2, cpuP95Ms: 3, cpuP99Ms: 4, wallTimeP95Ms: 5, wallTimeP99Ms: 6 } });
  } });
  const occurrences = await client.getIssueOccurrences({ issueId: 'issue', limit: 20 });
  assert.ok(!occurrences[0].message.includes('secret'));
  assert.ok(!occurrences[0].message.includes('private@example.test'));
  assert.deepEqual(await client.queryWorkerMetrics({ scriptName: 'auth', versionId: 'version', sinceMinutes: 30 }), { invocations: 20, errors: 1, errorRate: 0.05, p95LatencyMs: 1, p99LatencyMs: 2, cpuP95Ms: 3, cpuP99Ms: 4, wallTimeP95Ms: 5, wallTimeP99Ms: 6 });
});
