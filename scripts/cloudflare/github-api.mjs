import assert from 'node:assert/strict';

export const REPOSITORY = 'kedoupi/kdp.cool';

export async function githubApi(endpoint, { token, request = fetch, method = 'GET',
  body, upload = false, allow404 = false } = {}) {
  assert.ok(token, 'GITHUB_TOKEN with repository Contents access is required');
  const host = upload ? 'uploads.github.com' : 'api.github.com';
  let response;
  try {
    response = await request(`https://${host}/repos/${REPOSITORY}${endpoint}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(60000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
        'user-agent': 'codepi-ops', 'x-github-api-version': '2022-11-28',
        'content-type': upload ? 'application/octet-stream' : 'application/json' },
      ...(body === undefined ? {} : { body: upload ? body : JSON.stringify(body) }),
    });
  } catch {
    throw new Error('GitHub API request failed (network)');
  }
  if (allow404 && response.status === 404) return null;
  assert.ok(response.ok, `GitHub API failed (HTTP ${response.status})`);
  try { return await response.json(); }
  catch { throw new Error('GitHub API returned invalid JSON'); }
}
