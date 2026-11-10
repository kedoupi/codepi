import assert from 'node:assert/strict';
import snapshots from './email-snapshots.json' with { type: 'json' };
import test from 'node:test';
import { validateNotifyEvent } from '@kedoupi/shared/notify/contract';
import { buildNotificationEmail } from '@kedoupi/shared/email/notification';
import { decideNotification, quietEnd, retryAt } from '../src/decision.ts';
import { RULES } from '../src/rules.ts';

const valid = {
  schema: 'notify.event/v1', event_id: 'evt-1', source: 'surgeconf.watchdog', kind: 'agent.stuck',
  subject: 'agent:one', state: 'firing', severity: 'warning', occurred_at: '2026-11-10T01:00:00Z', title: 'stuck',
};

test('the shared contract rejects forbidden fields and malformed boundaries', () => {
  assert.equal(validateNotifyEvent(valid).event_id, 'evt-1');
  for (const field of ['to', 'from', 'html', 'attachments']) assert.throws(() => validateNotifyEvent({ ...valid, [field]: 'forbidden' }), /unknown field/);
  assert.throws(() => validateNotifyEvent({ ...valid, title: 'x'.repeat(81) }), /too long/);
  assert.throws(() => validateNotifyEvent({ ...valid, occurred_at: 'tomorrow' }), /ISO/);
  assert.throws(() => validateNotifyEvent({ ...valid, link: 'https://example.com/path' }), /https/);
  assert.throws(() => validateNotifyEvent({ ...valid, summary: 'x'.repeat(501) }), /summary is too long/);
  assert.throws(() => validateNotifyEvent({ ...valid, facts: [{ label: 'x', value: 1 }] }), /fact values must be strings/);
  assert.throws(() => validateNotifyEvent({ ...valid, facts: Array.from({ length: 13 }, (_, index) => ({ label: String(index), value: 'v' })) }), /at most 12/);
});

test('the rule table registers the five watchdog kinds with documented modes', () => {
  assert.deepEqual(RULES.map(rule => rule.kind), ['agent.stuck', 'approval.pending', 'plans.orphan_digest', 'notify.selftest', 'daily-review']);
  assert.equal(RULES.find(rule => rule.kind === 'plans.orphan_digest')?.mode, 'record');
  assert.equal(RULES.find(rule => rule.kind === 'notify.selftest')?.mode, 'immediate');
  assert.equal(RULES.find(rule => rule.kind === 'daily-review')?.infoMode, 'record');
});

test('delivery decisions cover cooldown, recovery and retry classes', () => {
  const rule = RULES.find(candidate => candidate.kind === 'agent.stuck');
  assert.ok(rule);
  const now = Date.parse('2026-11-10T02:00:00Z');
  assert.equal(decideNotification(valid, rule, { status: 'open', lastNotificationAt: '2026-11-10T00:00:00Z' }, now).decision, 'cooled_down');
  assert.equal(decideNotification({ ...valid, state: 'resolved' }, rule, { status: 'open', lastNotificationAt: '2026-11-10T00:00:00Z', pendingUntil: null }, Date.parse('2026-11-10T08:00:00Z')).decision, 'send_resolved');
  assert.equal(decideNotification({ ...valid, state: 'resolved' }, rule, { status: 'open', lastNotificationAt: null, pendingUntil: null }, Date.parse('2026-11-10T08:00:00Z')).reason, 'resolved_never_notified');
  const reopened = decideNotification(valid, rule, { status: 'closed', firstSeen: '2026-11-10T00:00:00Z', lastNotificationAt: '2026-11-10T01:30:00Z' }, now);
  assert.deepEqual([reopened.decision, reopened.reason], ['send_alert', 'rule_matched']);
  assert.equal(Date.parse(retryAt('E_DELIVERY_FAILED', 0, now)) - now, 5 * 60 * 1000);
  assert.equal(Date.parse(retryAt('E_DELIVERY_FAILED', 2, now)) - now, 60 * 60 * 1000);
  assert.equal(retryAt('E_DELIVERY_FAILED', 4, now), null);
  assert.equal(retryAt('E_RECIPIENT_NOT_ALLOWED', 0, now), null);
  assert.equal(quietEnd(new Date('2026-11-10T18:00:00Z')), '2026-11-11T00:00:00.000Z');
});

test('for and quiet rules suppress warning before the alert is due', () => {
  const rule = { ...RULES[0], forMs: 60 * 60 * 1000, cooldownMs: 0 };
  const now = Date.parse('2026-11-10T18:00:00Z');
  assert.equal(decideNotification(valid, rule, { status: 'open', firstSeen: '2026-11-10T17:30:00Z' }, now).decision, 'deferred_for');
  assert.equal(decideNotification(valid, { ...rule, forMs: 0 }, null, now).decision, 'deferred_quiet');
  assert.equal(decideNotification({ ...valid, severity: 'critical' }, { ...rule, forMs: 0 }, null, now).shouldSend, true);
  assert.equal(decideNotification({ ...valid, state: 'resolved' }, rule, { status: 'open', pendingUntil: '2026-11-10T19:00:00Z' }, now).reason, 'resolved_before_for');
});

test('for applies to new and reopened incidents, measured from first_seen', () => {
  const rule = { ...RULES[0], forMs: 60 * 60 * 1000, cooldownMs: 0 };
  const now = Date.parse('2026-11-10T03:00:00Z');
  const at = iso => ({ ...valid, severity: 'critical', occurred_at: iso });
  assert.equal(decideNotification(at('2026-11-10T03:00:00Z'), rule, null, now).decision, 'deferred_for');
  assert.equal(decideNotification(at('2026-11-10T01:30:00Z'), rule, null, now).decision, 'send_alert');
  assert.equal(decideNotification(at('2026-11-10T03:00:00Z'), rule, { status: 'closed', firstSeen: '2026-11-09T00:00:00Z', lastNotificationAt: '2026-11-09T01:00:00Z' }, now).decision, 'deferred_for');
  assert.equal(decideNotification(at('2026-11-10T03:00:00Z'), rule, { status: 'open', firstSeen: '2026-11-10T02:30:00Z' }, now).decision, 'deferred_for');
  assert.equal(decideNotification(at('2026-11-10T03:00:00Z'), rule, { status: 'open', firstSeen: '2026-11-10T01:59:00Z' }, now).decision, 'send_alert');
  assert.equal(decideNotification({ ...at('2026-11-10T03:00:00Z'), state: 'resolved' }, { ...rule, notifyResolved: true }, { status: 'open', firstSeen: '2026-11-10T02:30:00Z', pendingUntil: '2026-11-10T03:30:00Z', lastNotificationAt: null }, now).reason, 'resolved_before_for');
});

test('buildNotificationEmail escapes producer text and ships no remote assets', () => {
  const event = {
    ...valid, title: '<script>alert(1)</script>', summary: '<img src="https://evil.example/x.png">',
    facts: [{ label: '<b>label</b>', value: '"quoted" & <i>' }], link: 'https://project.codepi.app/a?b=1&c="2"',
  };
  const email = buildNotificationEmail({ event, incidentId: '<incident>', reason: '<reason>', firstSeen: '<first>', lastSeen: '<last>', duration: '<duration>' });
  assert.equal(email.subject, '[注意] <script>alert(1)</script>');
  assert.equal(email.html.includes('<script'), false);
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(email.html.includes('<img'), false);
  assert.equal(/<(?:img|link|script|iframe|object|embed)\b/i.test(email.html), false);
  assert.equal(/<[^>]*\b(?:src|background|srcset)\s*=/i.test(email.html), false);
  assert.equal(/<[^>]*url\(/i.test(email.html), false);
  assert.match(email.html, /&lt;b&gt;label&lt;\/b&gt;/);
  assert.match(email.html, /&quot;quoted&quot; &amp; &lt;i&gt;/);
  assert.match(email.html, /href="https:\/\/project\.codepi\.app\/a\?b=1&amp;c=&quot;2&quot;"/);
  for (const value of ['&lt;incident&gt;', '&lt;reason&gt;', '&lt;first&gt;', '&lt;last&gt;', '&lt;duration&gt;']) assert.ok(email.html.includes(value), value);
  for (const value of ['<incident>', '<reason>', '<first>', '<last>', '<duration>']) assert.ok(email.text.includes(value), value);
  assert.match(buildNotificationEmail({ ...valid, severity: 'critical' }).subject, /^\[严重\]/);
  assert.match(buildNotificationEmail({ ...valid, state: 'resolved' }).subject, /^\[恢复\]/);
  assert.match(buildNotificationEmail({ ...valid, kind: 'notify.selftest', state: 'info', severity: 'info' }).subject, /^\[自检\]/);
});

test('notification email snapshots remain byte-for-byte stable', () => {
  const base = {
    schema: 'notify.event/v1', event_id: 'snapshot', source: 'surgeconf.watchdog', kind: 'agent.stuck', subject: 'agent:one',
    state: 'firing', severity: 'critical', occurred_at: '2026-11-10T01:00:00Z', title: 'CPU saturated', summary: 'CPU exceeded the threshold.',
    facts: [{ label: '主机', value: 'worker-1' }, { label: '持续', value: '5 分钟' }], link: 'https://project.codepi.app/details',
  };
  const actual = {
    firing: buildNotificationEmail(base),
    resolved: buildNotificationEmail({ ...base, event_id: 'snapshot-resolved', state: 'resolved', title: 'CPU recovered', summary: undefined }),
    selftest: buildNotificationEmail({ ...base, event_id: 'snapshot-selftest', kind: 'notify.selftest', state: 'info', severity: 'info', title: 'Notification selftest' }),
    options: buildNotificationEmail({ event: { ...base, event_id: 'snapshot-options', severity: 'warning', title: 'Approval pending' }, firstSeen: '2026-11-09T00:00:00Z', lastSeen: '2026-11-10T01:00:00Z', duration: '25 小时', incidentId: 'incident-42', reason: '测试快照' }),
  };
  assert.deepEqual(actual, snapshots);
});
