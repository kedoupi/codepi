import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { buildFeishuCard, feishuCardCategory, feishuKindLabel } from '@kedoupi/shared/email/notification';
import { mergeChannelEvent } from '../src/index.ts';

const base = {
  schema: 'notify.event/v1', event_id: 'template-test', source: 'synthetic.source', subject: 'subject',
  state: 'firing', severity: 'warning', occurred_at: '2026-11-14T01:30:00Z', title: '事件标题',
};
const makeEvent = (kind, extra = {}) => ({ ...base, kind, facts: [{ label: '项目', value: '合成值' }], link: 'https://tenant.feishu.cn/docx/demo', ...extra });
const body = card => card.body.elements;
const columns = card => body(card).filter(element => element.tag === 'column_set');
const button = card => body(card).find(element => element.tag === 'button');

function assertCardShape(card) {
  assert.equal(card.schema, '2.0');
  assert.ok(card.header.title?.content);
  assert.ok(card.header.subtitle?.content);
  assert.ok(card.header.template);
  assert.ok(Array.isArray(card.header.text_tag_list));
  assert.equal(body(card)[0].tag, 'markdown');
  assert.match(body(card)[0].content, /^\*\*/);
  assert.ok(new TextEncoder().encode(JSON.stringify(card)).byteLength <= 30 * 1024);
  for (const set of columns(card)) assert.equal(set.columns.length, 2);
  let previousMarkdown = false;
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    assert.ok(!['note', 'action', 'div'].includes(value.tag));
    if (value.tag === 'column' && value.elements) assert.ok(value.elements.every(element => element.tag === 'markdown'));
    Object.values(value).forEach(walk);
  };
  walk(card);
  for (const element of body(card)) {
    if (element.tag === 'markdown') {
      assert.ok(element.content.length <= 600);
      assert.ok(!(previousMarkdown && element.content.length > 0));
      previousMarkdown = true;
    } else previousMarkdown = false;
  }
}

test('all five templates expose the JSON 2.0 header, conclusion, facts and category button', () => {
  const cases = [
    ['agent.stuck', 'blue', '提醒', '通知', '查看详情', 'info'],
    ['agent.stuck', 'orange', '提醒', '注意', '查看详情', 'warning'],
    ['agent.stuck', 'green', '提醒', '已恢复', '查看详情', 'warning', { state: 'resolved' }],
    ['ledger.status', 'blue', '状态变化', '状态变化', '查看需求页', 'info'],
    ['approval.pending', 'yellow', '待批准', '待批准', '去处理', 'warning'],
    ['ledger.delivered', 'green', '已交付', '已交付', '查看交付', 'info'],
    ['notify.merged', 'red', '通知', '通知', '查看详情', 'critical'],
    ['notify.merged', 'orange', '通知', '通知', '查看详情', 'warning'],
    ['job.health', 'blue', '通知', '通知', '查看详情', 'info', { link: undefined }],
  ];
  for (const [kind, color, subtitle, tag, label, severity, extra = {}] of cases) {
    const card = buildFeishuCard(makeEvent(kind, { severity, ...extra }));
    assertCardShape(card);
    assert.equal(card.header.template, color);
    assert.equal(card.header.subtitle.content, subtitle);
    assert.ok(columns(card).length > 0);
    if (Object.hasOwn(extra, 'link') && extra.link === undefined) {
      assert.equal(button(card), undefined);
    } else {
      assert.equal(button(card).type, 'primary');
      assert.equal(button(card).text.tag, 'plain_text');
      assert.equal(button(card).text.content, label);
    }
  }
});

test('new MyBrain alert kinds use alert cards and their Chinese labels', () => {
  const cases = [['cert-expiry', '证书到期'], ['cf-d1-backup', '备份提醒'], ['report.failed', '提醒']];
  for (const [kind, label] of cases) {
    assert.equal(feishuCardCategory(kind), 'alert');
    assert.equal(feishuKindLabel(kind), label);
  }
});

test('status and delivery templates promote their special facts and fall back to ordinary columns', () => {
  const status = buildFeishuCard(makeEvent('ledger.status', { facts: [{ label: '旧状态', value: '待处理' }, { label: '新状态', value: '已核对' }, { label: '备注', value: '合成' }] }));
  assert.deepEqual(columns(status)[0].columns.map(column => column.elements[0].content), ['**旧状态**\n待处理', '**新状态**\n已核对']);
  const fallback = buildFeishuCard(makeEvent('ledger.status', { facts: [{ label: '旧状态', value: '待处理' }] }));
  assert.equal(columns(fallback)[0].columns[0].elements[0].content, '**旧状态**\n待处理');
  const delivery = buildFeishuCard(makeEvent('ledger.delivered', { facts: [{ label: '验收', value: '已通过' }, { label: '备注', value: '合成' }] }));
  assert.equal(columns(delivery)[0].columns[0].elements[0].content, '**验收**\n已通过');
});

test('markdown facts escape controls, preserve real newlines in column markdown and cap values', () => {
  const card = buildFeishuCard(makeEvent('agent.stuck', { facts: [{ label: '危险*标签', value: '* _ ` [ ] < >\n下一行' }] }));
  const content = columns(card)[0].columns[0].elements[0].content;
  assert.equal(content, '**危险\\*标签**\n\\* \\_ \\` \\[ \\] \\< \\> 下一行');
  assert.equal(content.includes('\\\\n'), false);
  const long = buildFeishuCard(makeEvent('agent.stuck', { summary: 'x'.repeat(2000), facts: [{ label: '长值', value: 'x'.repeat(4000) }] }));
  assertCardShape(long);
  assert.ok(JSON.stringify(long).length < 30 * 1024);
});

test('long escaped values stay within the post-escape limit and end cleanly', () => {
  const card = buildFeishuCard(makeEvent('agent.stuck', { facts: [{ label: '长值', value: '*_`'.repeat(200) }] }));
  const value = columns(card)[0].columns[0].elements[0].content.split('\n')[1];
  assert.ok(value.length <= 300);
  assert.equal(value.endsWith('…'), true);
  assert.equal(value.endsWith('\\\\…'), false);
});

test('large and odd fact collections remain valid and add an empty final column', () => {
  const facts = Array.from({ length: 11 }, (_, index) => ({ label: `fact-${index}`, value: 'value' }));
  const card = buildFeishuCard(makeEvent('agent.stuck', { facts }));
  assertCardShape(card);
  assert.equal(columns(card).length, 6);
  assert.deepEqual(columns(card).at(-1).columns.at(-1).elements, []);
  const twelve = buildFeishuCard(makeEvent('agent.stuck', { facts: Array.from({ length: 12 }, (_, index) => ({ label: `fact-${index}`, value: 'value' })) }));
  assert.equal(columns(twelve).length, 6);
  const huge = buildFeishuCard(makeEvent('agent.stuck', { facts: Array.from({ length: 12 }, (_, index) => ({ label: `fact-${index}`, value: `${'x'.repeat(4000)}-${'y'.repeat(4000)}` })) }));
  assertCardShape(huge);
});

test('cards omit private metadata and show Beijing time and explicit quota reason only', () => {
  const card = buildFeishuCard({ event: makeEvent('job.health', { link: undefined, occurred_at: '2026-11-13T17:30:00Z' }), incidentId: 'incident-42' });
  const serialized = JSON.stringify(card);
  assert.equal(serialized.includes('incidentId'), false);
  assert.equal(serialized.includes('为什么收到'), false);
  assert.equal(serialized.includes('/Users/'), false);
  assert.equal(serialized.includes('~/'), false);
  assert.equal(serialized.includes('bin/'), false);
  assert.equal(serialized.includes('这是统一通知服务根据事件规则生成的提醒。'), false);
  assert.match(serialized, /北京时间 11-14 周六 01:30/);
  const withReason = buildFeishuCard({ event: makeEvent('job.health', { link: undefined }), reason: '有 2 条提醒因限额未单独发送。' });
  assert.match(JSON.stringify(withReason), /有 2 条提醒因限额未单独发送/);
  assert.equal(JSON.stringify(card).includes('incident-42'), false);
});

test('merged events use Chinese kind labels and preserve unknown kinds', () => {
  const event = makeEvent('agent.stuck');
  const row = (kind, title, severity = 'critical') => ({ event_id: kind, source: 'synthetic.source', kind, subject: kind, state: 'firing', severity, occurred_at: event.occurred_at, title, notification_type: 'initial' });
  const merged = mergeChannelEvent(event, [row('agent.stuck', '需要处理'), row('unknown.kind', '未知提醒')]);
  assert.equal(merged.kind, 'notify.merged');
  assert.deepEqual(merged.facts, [{ label: '提醒', value: '需要处理' }, { label: 'unknown.kind', value: '未知提醒' }]);
  assert.equal(buildFeishuCard(merged).header.template, 'red');
});

test('preview emits six cards that pass the same structural contract', () => {
  const output = execFileSync(process.execPath, ['--experimental-strip-types', '--experimental-loader', './test/cloudflare-loader.mjs', 'scripts/preview-feishu-cards.mjs'], { encoding: 'utf8' });
  const cards = JSON.parse(output);
  assert.deepEqual(Object.keys(cards), ['alert', 'status', 'approval', 'delivery', 'notice', 'merged']);
  Object.values(cards).forEach(assertCardShape);
});
