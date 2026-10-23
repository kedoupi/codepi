import assert from 'node:assert/strict';

export const REPOSITORY = 'kedoupi/codepi';

export async function githubApi(endpoint, { token, request = fetch, method = 'GET',
  body, upload = false, allow404 = false, contentLength,
  repository = REPOSITORY } = {}) {
  assert.ok(token, 'GITHUB_TOKEN with repository Contents access is required');
  if (contentLength !== undefined) assert.ok(upload && Number.isSafeInteger(contentLength) && contentLength >= 0,
    'GitHub upload requires a valid content length');
  const host = upload ? 'uploads.github.com' : 'api.github.com';
  const transfer = new AbortController();
  const signal = AbortSignal.any([transfer.signal, AbortSignal.timeout(60000)]);
  let response, pumping;
  if (upload && body instanceof ReadableStream && typeof globalThis.FixedLengthStream === 'function') {
    assert.ok(Number.isSafeInteger(contentLength), 'GitHub streaming upload requires a content length');
    // Workers derives Content-Length from the body, ignoring a manual header.
    const fixed = new globalThis.FixedLengthStream(contentLength);
    pumping = body.pipeTo(fixed.writable, { signal }).then(() => true, () => false);
    body = fixed.readable;
  }
  try {
    try {
      response = await request(`https://${host}/repos/${repository}${endpoint}`, {
        method, redirect: 'manual', signal,
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
          'user-agent': 'codepi-ops', 'x-github-api-version': '2022-11-28',
          'content-type': upload ? 'application/octet-stream' : 'application/json',
          ...(contentLength === undefined ? {} : { 'content-length': String(contentLength) }) },
        ...(body === undefined ? {} : { body: upload ? body : JSON.stringify(body) }),
        ...(upload && body instanceof ReadableStream ? { duplex: 'half' } : {}),
      });
      if (response.ok && pumping) assert.equal(await pumping, true, 'GitHub upload stream failed');
    } catch {
      throw new Error('GitHub API request failed (network)');
    }
    if (allow404 && response.status === 404) return null;
    assert.ok(response.ok, `GitHub API failed (HTTP ${response.status})`);
    try { return await response.json(); }
    catch { throw new Error('GitHub API returned invalid JSON'); }
  } finally {
    transfer.abort();
    if (pumping) await pumping;
  }
}
