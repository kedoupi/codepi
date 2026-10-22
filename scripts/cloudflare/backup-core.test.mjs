import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DATABASES,
  DATABASE_NAMES,
  parseDatabaseConfig,
  resolveProductionDatabases,
} from './backup-core.mjs';

const newIds = {
  'codepi-project': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'codepi-me': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'codepi-blog': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const completeMapping = Object.fromEntries(DATABASE_NAMES.map(name => [name, DATABASES[name] ?? newIds[name]]));
const env = { CLOUDFLARE_ACCOUNT_ID: 'synthetic-account', CLOUDFLARE_API_TOKEN: 'synthetic-token' };

function inventoryRequest(mutate = rows => rows) {
  const calls = [];
  const request = async url => {
    const target = new URL(url);
    calls.push(target);
    const page = Number(target.searchParams.get('page'));
    const all = mutate(DATABASE_NAMES.map((name, i) => ({
      name, uuid: completeMapping[name], marker: i,
    })));
    const start = (page - 1) * 100;
    return Response.json({
      success: true,
      result: all.slice(start, start + 100),
      result_info: { page, total_pages: Math.max(1, Math.ceil(all.length / 100)) },
    });
  };
  return { request, calls };
}

test('the required inventory keeps pinned IDs while resolving the new names', async () => {
  assert.equal(DATABASE_NAMES.length, 9);
  assert.equal(Object.keys(DATABASES).length, 7);
  assert.ok(!Object.hasOwn(DATABASES, 'codepi-project'));
  assert.ok(!Object.hasOwn(DATABASES, 'codepi-me'));
  const staged = inventoryRequest(rows => rows.reverse());
  const result = await resolveProductionDatabases({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_API_TOKEN,
    request: staged.request,
  });
  assert.deepEqual(result.map(item => item.name), [...DATABASE_NAMES]);
  assert.deepEqual(result.map(item => item.id),
    DATABASE_NAMES.map(name => completeMapping[name]));
  assert.ok(staged.calls.every(call => call.pathname.endsWith('/d1/database')));
});

test('exact-name resolution fails closed on missing, duplicate or changed managed identities', async () => {
  const cases = [
    rows => rows.filter(row => row.name !== 'codepi-me'),
    rows => [...rows, { name: 'codepi-project', uuid: newIds['codepi-project'] }],
    rows => rows.map(row => row.name === 'codepi-auth'
      ? { ...row, uuid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } : row),
    rows => rows.map(row => row.name === 'codepi-me' ? { ...row, name: 'codepi-me-preview' } : row),
  ];
  for (const mutate of cases) {
    const fixture = inventoryRequest(mutate);
    await assert.rejects(resolveProductionDatabases({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN,
      request: fixture.request,
    }),
      /required D1|managed production ID/);
  }
});

test('explicit launch configuration must cover every name exactly and preserve managed IDs', () => {
  assert.deepEqual(parseDatabaseConfig(JSON.stringify(completeMapping)),
    DATABASE_NAMES.map(name => ({ name, id: completeMapping[name] })));
  const missing = { ...completeMapping };
  delete missing['codepi-me'];
  const extra = { ...completeMapping, unrelated: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  const duplicate = { ...completeMapping,
    'codepi-me': completeMapping['codepi-project'] };
  const changed = { ...completeMapping,
    'codepi-gu': 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };
  for (const value of [missing, extra, duplicate, changed]) {
    assert.throws(() => parseDatabaseConfig(value));
  }
  assert.throws(() => parseDatabaseConfig('{not json}'), /valid JSON/);
  assert.throws(() => parseDatabaseConfig([]), /map every required/);
});
