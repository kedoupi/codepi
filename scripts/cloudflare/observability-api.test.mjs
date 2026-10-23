import assert from 'node:assert/strict';
import test from 'node:test';
import { createObservabilityClient, ObservabilityError } from './observability-api.mjs';

const response = (result, status = 200) => new Response(JSON.stringify({ success: status < 400, result }), { status, headers: { 'content-type': 'application/json' } });
const NOW = Date.parse('2026-10-23T05:00:00Z');
const apiIssue = (id, lastObserved) => ({ id, service: 'codepi-auth', title: 'failure', status: 'active', firstObserved: NOW - 86400000, lastObserved, count: 2 });

test('filters active issues by service, pages with perPage and keeps only recent ones', async () => {
  const calls = [];
  const first = Array.from({ length: 50 }, (_, i) => apiIssue(`old-${i}`, NOW - 3600000));
  first[0] = apiIssue('recent', NOW - 60000);
  const client = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async (url) => {
    calls.push(url);
    return response(url.searchParams.get('page') === '1' ? first : [apiIssue('recent-2', NOW - 120000)]);
  } });
  const issues = await client.listIssues({ scriptName: 'codepi-auth', sinceMinutes: 5, now: NOW });
  assert.deepEqual(issues.map(item => item.id), ['recent', 'recent-2']);
  assert.deepEqual(issues[0], { id: 'recent', scriptName: 'codepi-auth', title: 'failure', status: 'active', firstSeenAt: new Date(NOW - 86400000).toISOString(), lastSeenAt: new Date(NOW - 60000).toISOString(), occurrences: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get('service'), 'codepi-auth');
  assert.equal(calls[0].searchParams.get('status'), 'active');
  assert.equal(calls[0].searchParams.get('perPage'), '50');
  assert.equal(calls[0].searchParams.has('scriptName'), false);
});

test('retries 429 and classifies authorization failures', async () => {
  let attempts = 0;
  const client = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async () => (++attempts < 3 ? response({}, 429) : response({ issues: [] })) });
  assert.deepEqual(await client.listIssues(), []);
  assert.equal(attempts, 3);
  await assert.rejects(() => createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async () => response({}, 403) }).listIssues(), error => error instanceof ObservabilityError && error.code === 'auth');
});

test('rejects malformed issue responses', async () => {
  await assert.rejects(() => createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async () => response({ nope: true }) }).listIssues(), error => error.code === 'schema');
});

const graphqlResponse = (rows) => new Response(JSON.stringify({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: rows }] } } }), { status: 200, headers: { 'content-type': 'application/json' } });

test('aggregates per-version GraphQL invocation metrics in milliseconds', async () => {
  let request;
  const client = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async (url, init) => {
    request = { url: String(url), init };
    return graphqlResponse([
      { sum: { requests: 30, errors: 3 }, quantiles: { cpuTimeP99: 4000, wallTimeP99: 200000 } },
      { sum: { requests: 10, errors: 1 }, quantiles: { cpuTimeP99: 9000, wallTimeP99: 100000 } },
    ]);
  } });
  const metrics = await client.queryWorkerMetrics({ scriptName: 'codepi-auth', versionId: 'v-new', sinceMinutes: 5 });
  assert.deepEqual(metrics, { invocations: 40, errors: 4, errorRate: 0.1, cpuP99Ms: 9, wallTimeP99Ms: 200, p99LatencyMs: 200 });
  assert.equal(request.url, 'https://api.cloudflare.com/client/v4/graphql');
  assert.equal(request.init.method, 'POST');
  const vars = JSON.parse(request.init.body).variables;
  assert.equal(vars.scriptName, 'codepi-auth');
  assert.equal(vars.scriptVersion, 'v-new');
  assert.equal(Date.parse(vars.end) - Date.parse(vars.start), 5 * 60000);
});

test('returns null without traffic and fails on GraphQL errors', async () => {
  const idle = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async () => graphqlResponse([]) });
  assert.equal(await idle.queryWorkerMetrics({ scriptName: 'auth', versionId: 'v' }), null);
  const failing = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async () => new Response(JSON.stringify({ data: null, errors: [{ message: 'denied' }] }), { status: 200 }) });
  await assert.rejects(() => failing.queryWorkerMetrics({ scriptName: 'auth', versionId: 'v' }), error => error instanceof ObservabilityError);
});

test('redacts occurrence query parameters', async () => {
  const client = createObservabilityClient({ accountId: 'account', apiToken: 'token', fetchImpl: async () => response({ occurrences: [{ occurred_at: '2026-10-23T00:00:00Z', message: 'GET https://example.test/path?token=secret&email=private@example.test' }] }) });
  const occurrences = await client.getIssueOccurrences({ issueId: 'issue', limit: 20 });
  assert.ok(!occurrences[0].message.includes('secret'));
  assert.ok(!occurrences[0].message.includes('private@example.test'));
});
