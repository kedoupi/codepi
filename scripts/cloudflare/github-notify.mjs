import assert from 'node:assert/strict';

export const OBSERVATION_ISSUE_TITLE = 'codepi release observations';
export const OBSERVATION_REPOSITORY = 'kedoupi/codepi';
export const OBSERVATION_LABEL = 'codepi-release-observations';
export const MAX_GITHUB_PAGES = 10;
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;

function redact(value) {
  return String(value ?? '').replace(/([?&](?:token|key|secret|password|authorization|signature|code)=)[^&\s]*/gi, '$1[REDACTED]').replace(/\b(?:bearer\s+)[^\s]+/gi, 'Bearer [REDACTED]').slice(0, 2000);
}

async function request(api, path, options = {}, timeoutMs = GITHUB_REQUEST_TIMEOUT_MS) {
  const response = await api(`https://api.github.com${path}`, {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'codepi-ops', 'x-github-api-version': '2022-11-28', ...(options.headers ?? {}) },
  });
  const text = await response.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(text); } catch { /* response may have no JSON body */ }
  if (!response.ok) {
    const detail = redact(body?.message ?? text.slice(0, 160) ?? 'no body').slice(0, 160);
    const reqId = response.headers.get('x-github-request-id') ?? 'no-request-id';
    throw new Error(`GitHub notification failed (HTTP ${response.status} ${options.method ?? 'GET'} ${path}: ${detail}; gh-request=${reqId})`);
  }
  return body;
}

export async function notifyGithub(event, { env = process.env, fetchImpl = fetch, requestTimeoutMs = GITHUB_REQUEST_TIMEOUT_MS } = {}) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('GitHub notification token is missing');
  const repository = env.GITHUB_REPOSITORY ?? OBSERVATION_REPOSITORY;
  const slash = repository.indexOf('/');
  assert.ok(slash > 0, 'GITHUB_REPOSITORY must be owner/name');
  const owner = repository.slice(0, slash), repo = repository.slice(slash + 1);
  const headers = { authorization: `Bearer ${token}` };
  let issue = null;
  for (let page = 1; page <= MAX_GITHUB_PAGES && !issue; page++) {
    const issues = await request(fetchImpl, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&sort=created&direction=desc&per_page=100&page=${page}`, { headers }, requestTimeoutMs);
    if (!Array.isArray(issues)) break;
    issue = issues.find(item => item.title === OBSERVATION_ISSUE_TITLE && !item.pull_request) ?? null;
    if (issues.length < 100) break;
  }
  if (!issue) {
    try {
      await request(fetchImpl, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`, {
        method: 'POST', headers, body: JSON.stringify({ name: OBSERVATION_LABEL, color: '6f42c1', description: 'Automated release observation events' }),
      }, requestTimeoutMs);
    } catch (error) {
      if (!/HTTP 422/.test(error.message)) throw error;
    }
    issue = await request(fetchImpl, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: OBSERVATION_ISSUE_TITLE, body: 'Automated post-release observation events.', labels: [OBSERVATION_LABEL] }),
    }, requestTimeoutMs);
  }
  const services = Array.isArray(event.services) ? event.services.map(item => typeof item === 'string' ? item : (item.service ?? item.script ?? 'unknown')).join(', ') : 'unknown';
  const timestamp = event.at ?? new Date().toISOString();
  const eventId = redact(event.event_id ?? `${event.releaseId ?? event.release_id}-${event.severity ?? 'event'}`);
  const body = [
    `release_id: ${redact(event.releaseId ?? event.release_id)}`,
    `services: ${redact(services)}`,
    `severity: ${redact(event.severity)}`,
    `summary: ${redact(event.summary)}`,
    `time: ${redact(timestamp)}`,
    `event_id: ${eventId}`,
  ].join('\n');
  for (let page = 1; page <= MAX_GITHUB_PAGES; page++) {
    const comments = await request(fetchImpl, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue.number}/comments?direction=desc&per_page=100&page=${page}`, { headers }, requestTimeoutMs);
    if (!Array.isArray(comments)) break;
    if (comments.some(comment => typeof comment.body === 'string' && comment.body.includes(`event_id: ${eventId}`))) {
      return { issueNumber: issue.number, commentId: null, deduplicated: true };
    }
    if (comments.length < 100) break;
  }
  const comment = await request(fetchImpl, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue.number}/comments`, {
    method: 'POST', headers, body: JSON.stringify({ body }),
  }, requestTimeoutMs);
  return { issueNumber: issue.number, commentId: comment?.id ?? null };
}
