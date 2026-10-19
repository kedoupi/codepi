import assert from 'node:assert/strict';

export async function workerApi(endpoint, { env = process.env, request = fetch, method = 'GET', body } = {}) {
  assert.ok(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN,
    'CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN are required');
  let response, payload;
  try {
    response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/scripts/${endpoint}`,
      {
        method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    payload = await response.json();
  } catch {
    // Never echo a request body, provider message or a secret in a network error.
    throw new Error(`Workers ${method} ${endpoint} failed (network or invalid JSON)`);
  }
  assert.ok(response.ok && payload?.success === true,
    `Workers ${method} ${endpoint} failed (HTTP ${response.status})`);
  return payload.result;
}

export async function activeWorkerVersion(script, options) {
  const result = await workerApi(`${script}/deployments`, options);
  const versions = result?.deployments?.[0]?.versions;
  assert.ok(Array.isArray(versions) && versions.length === 1 && versions[0].percentage === 100,
    `${script} must have exactly one active version serving 100% of traffic`);
  const id = versions[0].version_id;
  assert.match(id ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i, 'invalid active Worker version ID');
  return id;
}
