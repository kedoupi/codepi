import assert from 'node:assert/strict';

export const OBSERVATION_ISSUE_TITLE = 'codepi release observations';
export const OBSERVATION_REPOSITORY = 'kedoupi/codepi';
export const OBSERVATION_LABEL = 'codepi-release-observations';
function redact(value) {
  return String(value ?? '').replace(/([?&](?:token|key|secret|password|authorization|signature|code)=)[^&\s]*/gi, '$1[REDACTED]').replace(/\b(?:bearer\s+)[^\s]+/gi, 'Bearer [REDACTED]').slice(0, 2000);
}

async function request(api, path, options = {}) {
  const response = await api(`https://api.github.com${path}`, {
    ...options,
    headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  let body = null;
  try { body = await response.json(); } catch { /* response may have no body */ }
  if (!response.ok) throw new Error(`GitHub notification failed (HTTP ${response.status} ${options.method ?? 'GET'} ${path}: ${redact(body?.message ?? 'no message')})`);
  return body;
}

export async function notifyGithub(event, { env = process.env, fetchImpl = fetch } = {}) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('GitHub notification token is missing');
  const repository = env.GITHUB_REPOSITORY ?? OBSERVATION_REPOSITORY;
  const slash = repository.indexOf('/');
  assert.ok(slash > 0, 'GITHUB_REPOSITORY must be owner/name');
  const owner = repository.slice(0, slash), repo = repository.slice(slash + 1);
  const headers = { authorization: `Bearer ${token}` };
  const query = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=open&per_page=100`;
  const issues = await request(fetchImpl, query, { headers });
  let issue = Array.isArray(issues) ? issues.find(item => item.title === OBSERVATION_ISSUE_TITLE && !item.pull_request) : null;
  if (!issue) {
    try {
      await request(fetchImpl, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`, {
        method: 'POST', headers, body: JSON.stringify({ name: OBSERVATION_LABEL, color: '6f42c1', description: 'Automated release observation events' }),
      });
    } catch (error) {
      if (!/HTTP 422/.test(error.message)) throw error;
    }
    issue = await request(fetchImpl, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: OBSERVATION_ISSUE_TITLE, body: 'Automated post-release observation events.', labels: [OBSERVATION_LABEL] }),
    });
  }
  const services = Array.isArray(event.services) ? event.services.map(item => item.service ?? item.script ?? 'unknown').join(', ') : 'unknown';
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
  const comments = await request(fetchImpl, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue.number}/comments?per_page=100`, { headers });
  if (Array.isArray(comments) && comments.some(comment => typeof comment.body === 'string' && comment.body.includes(`event_id: ${eventId}`))) {
    return { issueNumber: issue.number, commentId: null, deduplicated: true };
  }
  const comment = await request(fetchImpl, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue.number}/comments`, {
    method: 'POST', headers, body: JSON.stringify({ body }),
  });
  return { issueNumber: issue.number, commentId: comment?.id ?? null };
}
