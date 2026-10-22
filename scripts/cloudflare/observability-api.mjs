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

function issue(item) {
  if (!item || typeof item !== 'object' || item.id == null) throw new ObservabilityError('Cloudflare issue schema is invalid', 'schema');
  return {
    id: String(item.id),
    scriptName: String(item.scriptName ?? item.script_name ?? item.script ?? ''),
    title: String(item.title ?? item.name ?? ''),
    firstSeenAt: String(item.firstSeenAt ?? item.first_seen_at ?? item.first_seen ?? ''),
    lastSeenAt: String(item.lastSeenAt ?? item.last_seen_at ?? item.last_seen ?? ''),
    occurrences: number(item.occurrences ?? item.occurrence_count),
  };
}

function occurrence(item) {
  if (!item || typeof item !== 'object') throw new ObservabilityError('Cloudflare occurrence schema is invalid', 'schema');
  return { occurredAt: String(item.occurredAt ?? item.occurred_at ?? item.timestamp ?? ''), message: redactOccurrenceMessage(item.message ?? item.error ?? item.message_template ?? '') };
}

function findMetric(result, names) {
  if (!result || typeof result !== 'object') return undefined;
  for (const name of names) if (result[name] !== undefined) return result[name];
  return undefined;
}

function metricResult(result) {
  if (!result || typeof result !== 'object') return null;
  const source = result.metrics && typeof result.metrics === 'object' ? result.metrics : result;
  const fields = {
    invocations: findMetric(source, ['invocations', 'requests', 'count']), errors: findMetric(source, ['errors', 'error_count']),
    errorRate: findMetric(source, ['errorRate', 'error_rate']), p95LatencyMs: findMetric(source, ['p95LatencyMs', 'p95_latency_ms', 'latency_p95_ms']),
    p99LatencyMs: findMetric(source, ['p99LatencyMs', 'p99_latency_ms', 'latency_p99_ms']), cpuP95Ms: findMetric(source, ['cpuP95Ms', 'cpu_p95_ms']),
    cpuP99Ms: findMetric(source, ['cpuP99Ms', 'cpu_p99_ms']), wallTimeP95Ms: findMetric(source, ['wallTimeP95Ms', 'wall_time_p95_ms']),
    wallTimeP99Ms: findMetric(source, ['wallTimeP99Ms', 'wall_time_p99_ms']),
  };
  if (Object.values(fields).some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
  return fields;
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

  async function listIssues({ scriptName, sinceMinutes } = {}) {
    const all = [];
    let page;
    for (let pages = 0; pages < 100; pages++) {
      const result = await request('issues', { query: { scriptName, sinceMinutes, page } });
      const rows = pageItems(result, ['issues', 'items', 'data']);
      if (!rows) throw new ObservabilityError('Cloudflare issues list schema is invalid', 'schema');
      all.push(...rows.map(issue));
      const next = result?.nextPage ?? result?.next_page ?? result?.pagination?.next_page;
      if (!next || next === page) break;
      page = next;
    }
    return all;
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
    async queryWorkerMetrics({ scriptName, versionId, sinceMinutes } = {}) {
      const keysResult = await request('telemetry/keys', { query: { scriptName } });
      const keys = pageItems(keysResult, ['keys', 'items', 'data']);
      if (!keys) throw new ObservabilityError('Cloudflare telemetry keys schema is invalid', 'schema');
      if (!keys.length) return null;
      const queryResult = await request('telemetry/query', { method: 'POST', body: { scriptName, versionId, sinceMinutes, keys } });
      const valuesResult = await request('telemetry/values', { method: 'POST', body: { scriptName, versionId, sinceMinutes, keys, query: queryResult } });
      return metricResult(valuesResult) || metricResult(queryResult);
    },
  };
}
