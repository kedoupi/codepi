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
    response({ code: 0, tenant_access_token: ['tenant', '-a'].join(''), expire: 7200 }),
    response({ code: 99991663 }),
    response({ code: 0, tenant_access_token: ['tenant', '-b'].join(''), expire: 7200 }),
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

test('Feishu card is JSON 2.0, bounded and uses grouped markdown', () => {
  const card = buildFeishuCard(notificationParts({ ...event, facts: Array.from({ length: 12 }, (_, index) => ({ label: `fact-${index}`, value: 'x'.repeat(4000) })) }));
  const json = JSON.stringify(card);
  const markdown = card.body.elements.filter(element => element.tag === 'markdown');
  const facts = card.body.elements.find(element => element.tag === 'column_set');
  const button = card.body.elements.find(element => element.tag === 'button');
  const unsupported = [];
  const walk = value => { if (Array.isArray(value)) return value.forEach(walk); if (!value || typeof value !== 'object') return; if (['note', 'action', 'div'].includes(value.tag)) unsupported.push(value.tag); Object.values(value).forEach(walk); };
  walk(card);
  assert.equal(card.schema, '2.0');
  assert.equal(card.header.template, 'red');
  assert.equal(card.header.title.content, 'stuck');
  assert.equal(card.header.text_tag_list[0].text.content, '严重');
  assert.equal(card.body.elements[0].tag, 'markdown');
  assert.ok(new TextEncoder().encode(json).byteLength <= 30 * 1024);
  assert.ok(markdown.length <= 2);
  assert.ok(facts);
  assert.deepEqual(unsupported, []);
  assert.equal(button.text.tag, 'plain_text');
  assert.equal(button.text.content, '查看详情');
  assert.equal(button.behaviors[0].type, 'open_url');
});

test('Feishu classifies retryable provider and transport errors', async () => {
  const retryable = [
    ['99991400', 'E_FEISHU_99991400'], ['230020', 'E_FEISHU_230020'],
    ['HTTP 429', 'E_FEISHU_HTTP_429'], ['HTTP 500', 'E_FEISHU_HTTP_500'],
    ['network', 'E_FEISHU_NETWORK'], ['timeout', 'E_FEISHU_NETWORK'],
  ];
  for (const [label, expected] of retryable) {
    resetFeishuTokenCache();
    const fetchImpl = async url => {
      if (String(url).includes('/tenant_access_token/')) return response({ code: 0, tenant_access_token: 'token', expire: 7200 });
      if (label === 'network' || label === 'timeout') throw new Error(label);
      if (label.startsWith('HTTP')) return response({}, Number(label.slice(5)));
      return response({ code: label });
    };
    await assert.rejects(sendFeishu({ FEISHU_APP_ID: ['app', '-test'].join(''), FEISHU_APP_SECRET: ['sec', 'ret-test'].join(''), FEISHU_RECEIVE_OPEN_ID: ['open', '-test'].join('') }, {}, 'notify-1', fetchImpl), error => error.code === expected && error.retryable === true);
  }
});

test('Feishu classifies permanent and unknown provider errors', async () => {
  const permanent = ['230013', '230053', '99991543', '99991672', '99991401', '230006', '230025', '230099', '99999999'];
  for (const code of permanent) {
    resetFeishuTokenCache();
    const fetchImpl = async url => String(url).includes('/tenant_access_token/') ? response({ code: 0, tenant_access_token: ['tenant', '-test'].join(''), expire: 7200 }) : response({ code });
    await assert.rejects(sendFeishu({ FEISHU_APP_ID: ['app', '-test'].join(''), FEISHU_APP_SECRET: ['sec', 'ret-test'].join(''), FEISHU_RECEIVE_OPEN_ID: ['open', '-test'].join('') }, {}, 'notify-1', fetchImpl), error => error.code === `E_FEISHU_${code}` && error.retryable === false);
  }
});

test('Feishu token cache is keyed by app id and request uses the message contract', async () => {
  resetFeishuTokenCache();
  const requests = [];
  let tokenNo = 0;
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/tenant_access_token/')) return response({ code: 0, tenant_access_token: `token-${tokenNo++}`, expire: 7200 });
    return response({ code: 0, data: { message_id: `message-${tokenNo}` } });
  };
  const first = { FEISHU_APP_ID: ['app', '-a'].join(''), FEISHU_APP_SECRET: ['sec', 'ret-a'].join(''), FEISHU_RECEIVE_OPEN_ID: ['open', '-a'].join('') };
  const second = { FEISHU_APP_ID: ['app', '-b'].join(''), FEISHU_APP_SECRET: ['sec', 'ret-b'].join(''), FEISHU_RECEIVE_OPEN_ID: ['open', '-b'].join('') };
  await sendFeishu(first, { schema: '2.0' }, 'notify-17', fetchImpl);
  await sendFeishu(first, { schema: '2.0' }, 'notify-18', fetchImpl);
  await sendFeishu(second, { schema: '2.0' }, 'notify-19', fetchImpl);
  assert.equal(requests.filter(request => request.url.includes('/tenant_access_token/')).length, 2);
  const message = requests.find(request => request.url.includes('/im/v1/messages'));
  assert.match(message.url, /receive_id_type=open_id/);
  const body = JSON.parse(message.init.body);
  assert.deepEqual({ receive_id: body.receive_id, msg_type: body.msg_type, uuid: body.uuid }, { receive_id: 'open-a', msg_type: 'interactive', uuid: 'notify-17' });
});

test('Feishu card colors cover warning, selftest/info and resolved', () => {
  assert.equal(buildFeishuCard(notificationParts({ ...event, severity: 'warning' })).header.template, 'orange');
  assert.equal(buildFeishuCard(notificationParts({ ...event, kind: 'notify.selftest', severity: 'info' })).header.template, 'blue');
  assert.equal(buildFeishuCard(notificationParts({ ...event, state: 'resolved', severity: 'warning' })).header.template, 'green');
});

test('Feishu classifies business codes in non-2xx bodies and refreshes once', async () => {
  resetFeishuTokenCache();
  const refreshReplies = [
    response({ code: 0, tenant_access_token: ['tenant', '-old'].join(''), expire: 7200 }),
    response({ code: 99991663, msg: 'expired' }, 400),
    response({ code: 0, tenant_access_token: ['tenant', '-new'].join(''), expire: 7200 }),
    response({ code: 0, data: { message_id: 'refreshed' } }),
  ];
  const fetchImpl = async url => String(url).includes('/tenant_access_token/') ? refreshReplies.shift() : refreshReplies.shift();
  assert.equal(await sendFeishu({ FEISHU_APP_ID: ['app', '-http'].join(''), FEISHU_APP_SECRET: ['sec', 'ret-http'].join(''), FEISHU_RECEIVE_OPEN_ID: ['open', '-http'].join('') }, {}, 'notify-400', fetchImpl), 'refreshed');

  resetFeishuTokenCache();
  const retryFetch = async url => String(url).includes('/tenant_access_token/') ? response({ code: 0, tenant_access_token: ['tenant', '-retry'].join(''), expire: 7200 }) : response({ code: 230020, msg: 'rate limited' }, 400);
  await assert.rejects(sendFeishu({ FEISHU_APP_ID: ['app', '-retry'].join(''), FEISHU_APP_SECRET: ['sec', 'ret-retry'].join(''), FEISHU_RECEIVE_OPEN_ID: ['open', '-retry'].join('') }, {}, 'notify-400', retryFetch), error => error.code === 'E_FEISHU_230020' && error.retryable === true);

  resetFeishuTokenCache();
  const permanentFetch = async url => String(url).includes('/tenant_access_token/') ? response({ code: 0, tenant_access_token: ['tenant', '-permanent'].join(''), expire: 7200 }) : response({ code: 230013, msg: 'not allowed' }, 400);
  await assert.rejects(sendFeishu({ FEISHU_APP_ID: ['app', '-permanent'].join(''), FEISHU_APP_SECRET: ['sec', 'ret-permanent'].join(''), FEISHU_RECEIVE_OPEN_ID: ['open', '-permanent'].join('') }, {}, 'notify-400', permanentFetch), error => error.code === 'E_FEISHU_230013' && error.retryable === false);
});

test('Feishu does not retry a second 99991663 after refresh', async () => {
  resetFeishuTokenCache();
  const replies = [
    response({ code: 0, tenant_access_token: ['tenant', '-first'].join(''), expire: 7200 }),
    response({ code: 99991663 }, 400),
    response({ code: 0, tenant_access_token: ['tenant', '-second'].join(''), expire: 7200 }),
    response({ code: 99991663 }, 400),
  ];
  const fetchImpl = async () => replies.shift();
  await assert.rejects(sendFeishu({ FEISHU_APP_ID: ['app', '-once'].join(''), FEISHU_APP_SECRET: ['sec', 'ret-once'].join(''), FEISHU_RECEIVE_OPEN_ID: ['open', '-once'].join('') }, {}, 'notify-once', fetchImpl), error => error.code === 'E_FEISHU_99991663');
  assert.equal(replies.length, 0);
});
