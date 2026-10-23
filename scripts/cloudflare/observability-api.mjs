const API_ROOT = 'https://api.cloudflare.com/client/v4/accounts';
const MAX_MESSAGE_LENGTH = 500;

export class ObservabilityError extends Error {
  constructor(message, code = 'unknown', { status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ObservabilityError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function safeMessage(value) {
  return String(value || 'unknown').replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]').replace(/https?:\/\/[^\s]+/gi, '[url redacted]').slice(0, 180);
}

function redactOccurrenceMessage(value) {
  let message = String(value ?? '').replace(/https?:\/\/[^\s]+/gi, url => url.replace(/[?#].*$/, ''));
  message = message.replace(/([?&](?:[^=&#\s]+)=)[^&#\s]*/gi, '$1[redacted]');
  message = message.replace(/([?&][^\s]*)(?=\s|$)/g, match => match.replace(/=.*/, '=[redacted]'));
  return message.slice(0, MAX_MESSAGE_LENGTH);
}

function number(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function unwrap(payload) {
  if (!payload || typeof payload !== 'object' || payload.success !== true) throw new ObservabilityError('Cloudflare response schema is invalid', 'schema');
  return payload.result;
}

function pageItems(result, names) {
  if (Array.isArray(result)) return result;
  for (const name of names) if (Array.isArray(result?.[name])) return result[name];
  return null;
}

function epochIso(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return String(value ?? '');
}

function issue(item) {
  if (!item || typeof item !== 'object' || item.id == null) throw new ObservabilityError('Cloudflare issue schema is invalid', 'schema');
  return {
    id: String(item.id),
    scriptName: String(item.service ?? ''),
    title: String(item.title ?? ''),
    status: String(item.status ?? ''),
    firstSeenAt: epochIso(item.firstObserved),
    lastSeenAt: epochIso(item.lastObserved),
    occurrences: number(item.count),
  };
}

function occurrence(item) {
  if (!item || typeof item !== 'object') throw new ObservabilityError('Cloudflare occurrence schema is invalid', 'schema');
  return { occurredAt: String(item.occurredAt ?? item.occurred_at ?? item.timestamp ?? ''), message: redactOccurrenceMessage(item.message ?? item.error ?? item.message_template ?? '') };
}

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
const METRICS_QUERY = `query ObserverMetrics($accountTag: String!, $scriptName: String!, $scriptVersion: String!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 100, filter: { scriptName: $scriptName, scriptVersion: $scriptVersion, datetime_geq: $start, datetime_leq: $end }) {
      sum { requests errors }
      quantiles { cpuTimeP99 wallTimeP99 }
    }
  } }
}`;

async function graphql(fetchImpl, apiToken, timeoutMs, query, variables) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response, payload;
  try {
    response = await fetchImpl(GRAPHQL_URL, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
  } catch (cause) {
    throw new ObservabilityError('Cloudflare metrics request failed (network)', 'network', { cause });
  } finally { clearTimeout(timer); }
  if (response.status === 401 || response.status === 403) throw new ObservabilityError('Cloudflare metrics authorization failed', 'auth', { status: response.status });
  try { payload = await response.json(); } catch (cause) { throw new ObservabilityError('Cloudflare metrics response is not JSON', 'schema', { status: response.status, cause }); }
  if (!response.ok || (Array.isArray(payload?.errors) && payload.errors.length)) throw new ObservabilityError(`Cloudflare metrics request failed (HTTP ${response.status})`, 'unknown', { status: response.status });
  return payload?.data;
}

// Sums are exact across sampled rows; quantiles are the worst row, which is conservative.
// GraphQL reports CPU/wall time in microseconds.
function invocationMetrics(rows) {
  if (!rows.length) return null;
  let invocations = 0, errors = 0, cpu = 0, wall = 0;
  for (const row of rows) {
    const requests = row?.sum?.requests, failed = row?.sum?.errors;
    if (!Number.isFinite(requests) || !Number.isFinite(failed)) throw new ObservabilityError('Cloudflare metrics schema is invalid', 'schema');
    invocations += requests; errors += failed;
    cpu = Math.max(cpu, Number(row?.quantiles?.cpuTimeP99) || 0);
    wall = Math.max(wall, Number(row?.quantiles?.wallTimeP99) || 0);
  }
  return { invocations, errors, errorRate: invocations ? errors / invocations : 0, cpuP99Ms: cpu / 1000, wallTimeP99Ms: wall / 1000, p99LatencyMs: wall / 1000 };
}

export function createObservabilityClient({ accountId, apiToken, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!accountId || !apiToken) throw new ObservabilityError('Cloudflare observability credentials are required', 'auth');
  const base = `${API_ROOT}/${encodeURIComponent(accountId)}/workers/observability`;
  async function request(path, { method = 'GET', body, query } = {}) {
    const url = new URL(`${base}/${path}`);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined) url.searchParams.set(key, String(value));
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { method, redirect: 'manual', signal: controller.signal, headers: { authorization: `Bearer ${apiToken}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        if (response.status === 429) { if (attempt < 2) { await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt)); continue; } throw new ObservabilityError('Cloudflare observability rate limited', 'rate_limited', { status: 429 }); }
        if (response.status === 403 || response.status === 401) throw new ObservabilityError('Cloudflare observability authorization failed', 'auth', { status: response.status });
        let payload;
        try { payload = await response.json(); } catch (cause) { throw new ObservabilityError('Cloudflare observability response is not JSON', 'schema', { status: response.status, cause }); }
        if (!response.ok) throw new ObservabilityError(`Cloudflare observability request failed (HTTP ${response.status})`, 'unknown', { status: response.status });
        return unwrap(payload);
      } catch (error) {
        if (error instanceof ObservabilityError) throw error;
        throw new ObservabilityError('Cloudflare observability request failed (network)', 'network', { cause: error });
      } finally { clearTimeout(timer); }
    }
    throw new ObservabilityError('Cloudflare observability rate limited', 'rate_limited', { status: 429 });
  }

  // The API filters by `service` and `status` and pages with `page`/`perPage`; it has
  // no time filter, so recency is applied to `lastObserved` here.
  async function listIssues({ scriptName, sinceMinutes, now = Date.now() } = {}) {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const result = await request('issues', { query: { service: scriptName, status: 'active', page, perPage: 50 } });
      const rows = pageItems(result, ['issues', 'items', 'data']);
      if (!rows) throw new ObservabilityError('Cloudflare issues list schema is invalid', 'schema');
      all.push(...rows.map(issue));
      if (rows.length < 50) break;
    }
    if (!sinceMinutes) return all;
    const cutoff = now - sinceMinutes * 60000;
    return all.filter(item => Date.parse(item.lastSeenAt) >= cutoff);
  }

  return {
    listIssues,
    async getIssueOccurrences({ issueId, limit = 20 } = {}) {
      if (!issueId) throw new ObservabilityError('Issue ID is required', 'schema');
      const result = await request(`issues/${encodeURIComponent(issueId)}/occurrences`, { query: { limit } });
      const rows = pageItems(result, ['occurrences', 'items', 'data']);
      if (!rows) throw new ObservabilityError('Cloudflare occurrences schema is invalid', 'schema');
      return rows.map(occurrence);
    },
    // Per-version invocation metrics come from the GraphQL Analytics dataset; the
    // telemetry endpoints are event-log queries and do not expose these aggregates.
    async queryWorkerMetrics({ scriptName, versionId, sinceMinutes = 5 } = {}) {
      if (!scriptName || !versionId) throw new ObservabilityError('script and version are required', 'schema');
      const end = new Date();
      const start = new Date(end.getTime() - sinceMinutes * 60000);
      const response = await graphql(fetchImpl, apiToken, timeoutMs, METRICS_QUERY, {
        accountTag: accountId, scriptName, scriptVersion: versionId, start: start.toISOString(), end: end.toISOString(),
      });
      const rows = response?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
      if (!Array.isArray(rows)) throw new ObservabilityError('Cloudflare metrics schema is invalid', 'schema');
      return invocationMetrics(rows);
    },
  };
}
