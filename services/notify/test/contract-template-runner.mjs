import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
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

test('the rule table registers the four watchdog kinds with documented modes', () => {
  assert.deepEqual(RULES.map(rule => rule.kind), ['agent.stuck', 'approval.pending', 'plans.orphan_digest', 'notify.selftest']);
  assert.equal(RULES.find(rule => rule.kind === 'plans.orphan_digest')?.mode, 'record');
  assert.equal(RULES.find(rule => rule.kind === 'notify.selftest')?.mode, 'immediate');
});

test('delivery decisions cover cooldown, recovery and retry classes', () => {
  const rule = RULES.find(candidate => candidate.kind === 'agent.stuck');
  assert.ok(rule);
  const now = Date.parse('2026-11-10T02:00:00Z');
  assert.equal(decideNotification(valid, rule, { status: 'open', lastNotificationAt: '2026-11-10T00:00:00Z' }, now).decision, 'cooled_down');
  assert.equal(decideNotification({ ...valid, state: 'resolved' }, rule, { status: 'open', lastNotificationAt: null, pendingUntil: null }, Date.parse('2026-11-10T08:00:00Z')).decision, 'send_resolved');
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

test('the shared template escapes producer text and ships no remote assets', async () => {
  const template = await readFile(new URL('../../../packages/shared/email/notification.ts', import.meta.url), 'utf8');
  assert.match(template, /escapeHtml/);
  assert.equal(/https?:\/\/[^\"]*\.(?:png|jpe?g|gif|webp)/i.test(template), false);
  assert.equal(/tracking|pixel/i.test(template), false);
});
