import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFeishuCard, notificationParts } from '@kedoupi/shared/email/notification';
import { resetFeishuTokenCache, sendFeishu } from '../src/channels/feishu.ts';

const event = {
  schema: 'notify.event/v1', event_id: 'feishu-card-1', source: 'surgeconf.watchdog', kind: 'agent.stuck',
  subject: 'agent:one', state: 'firing', severity: 'critical', occurred_at: '2026-11-10T01:00:00Z', title: 'stuck',
  summary: 'summary', facts: [{ label: '状态', value: '运行中' }], link: 'https://project.codepi.app/details',
};

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('Feishu refreshes an invalid token once and reuses the refreshed token', async () => {
  resetFeishuTokenCache();
  const replies = [
    response({ code: 0, tenant_access_token: 'token-a', expire: 7200 }),
    response({ code: 99991663 }),
    response({ code: 0, tenant_access_token: 'token-b', expire: 7200 }),
    response({ code: 0, data: { message_id: 'message-1' } }),
    response({ code: 0, data: { message_id: 'message-2' } }),
  ];
  const requests = [];
  const env = { FEISHU_APP_ID: ['app', '-a'].join(''), FEISHU_APP_SECRET: ['sec', 'ret-a'].join(''), FEISHU_RECEIVE_OPEN_ID: ['open', '-a'].join('') };
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return replies.shift(); };
  assert.equal(await sendFeishu(env, { schema: '2.0' }, 'notify-1', fetchImpl), 'message-1');
  assert.equal(await sendFeishu(env, { schema: '2.0' }, 'notify-2', fetchImpl), 'message-2');
  assert.equal(requests.length, 5);
  assert.equal(requests.filter(request => request.url.includes('/tenant_access_token/')).length, 2);
  assert.equal(requests.filter(request => request.url.includes('/im/v1/messages')).length, 3);
});

test('missing Feishu configuration fails before fetch', async () => {
  let calls = 0;
  await assert.rejects(sendFeishu({}, {}, 'notify-1', async () => { calls += 1; return response({}); }), error => error.code === 'E_FEISHU_NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('Feishu card is JSON 2.0, colored, bounded and uses only open_url', () => {
  const card = buildFeishuCard(notificationParts({ ...event, facts: Array.from({ length: 12 }, (_, index) => ({ label: `fact-${index}`, value: 'x'.repeat(1800) })) }));
  const json = JSON.stringify(card);
  assert.equal(card.schema, '2.0');
  assert.equal(card.header.template, 'red');
  assert.match(json, /open_url/);
  assert.equal(json.includes('callback'), false);
  assert.ok(new TextEncoder().encode(json).byteLength <= 30 * 1024);
});
