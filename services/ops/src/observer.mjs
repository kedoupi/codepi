import assert from 'node:assert/strict';
import { runMonitor } from '../../../scripts/cloudflare/monitor-core.mjs';
import { activeWorkerVersion } from '../../../scripts/cloudflare/worker-api.mjs';
import { notifyGithub } from '../../../scripts/cloudflare/github-notify.mjs';

export const OBSERVATION_STATES = new Set(['created', 'notified', 'observing', 'awaiting_user_confirmation', 'healthy_reported', 'degraded_notified', 'critical_detected', 'rollback_pending', 'rolled_back', 'rollback_verified', 'rollback_blocked', 'observation_failed', 'superseded']);
const TERMINAL = new Set(['healthy_reported', 'rollback_verified', 'rollback_blocked', 'observation_failed', 'superseded']);

const transitions = {
  created: new Set(['notified', 'observing', 'observation_failed', 'superseded']),
  notified: new Set(['observing', 'observation_failed', 'superseded']),
  observing: new Set(['degraded_notified', 'critical_detected', 'healthy_reported', 'observation_failed', 'superseded']),
  degraded_notified: new Set(['observing', 'critical_detected', 'observation_failed', 'superseded']),
  critical_detected: new Set(['rollback_pending', 'rollback_blocked', 'observation_failed', 'superseded']),
  rollback_pending: new Set(['rolled_back', 'rollback_blocked', 'observation_failed']),
  rolled_back: new Set(['rollback_verified', 'rollback_blocked', 'observation_failed']),
};

export function transitionState(state, next, eventId, seen = new Set()) {
  assert.ok(OBSERVATION_STATES.has(state), `unknown observer state: ${state}`);
  assert.ok(OBSERVATION_STATES.has(next), `unknown observer state: ${next}`);
  if (seen.has(eventId)) return { state, changed: false };
  seen.add(eventId);
  if (state === next) return { state, changed: false };
  if (TERMINAL.has(state)) return { state, changed: false };
  assert.ok(transitions[state]?.has(next), `invalid observer transition ${state} -> ${next}`);
  return { state: next, changed: true };
}

function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function serviceName(item) { return item.service ?? item.scriptName ?? item.script ?? 'unknown'; }

export function classifySeverity({ metrics = {}, baseline = {}, hardFailure = false, versionMismatch = false, criticalRounds = 0 } = {}) {
  if (versionMismatch) return 'critical';
  if (hardFailure && criticalRounds >= 1) return 'critical';
  const invocations = number(metrics.invocations) ?? 0;
  const errors = number(metrics.errors) ?? 0;
  const rate = number(metrics.errorRate);
  const p99 = number(metrics.p99LatencyMs);
  const baselineP99 = number(metrics.baselineP99LatencyMs) ?? number(baseline.p99LatencyMs);
  const degraded = invocations >= 20 && ((rate !== null && rate >= 0.05) || (p99 !== null && baselineP99 !== null && p99 >= 2 * baselineP99));
  if (degraded && (rate !== null && rate >= 0.20) && errors >= 20 && criticalRounds >= 1) return 'critical';
  return degraded ? 'degraded' : 'healthy';
}

function safeValue(value) {
  if (typeof value === 'string') return value.replace(/([?&](?:token|key|secret|password|authorization|signature|code)=)[^&\s]*/gi, '$1[REDACTED]').replace(/(?:bearer\s+)[^\s]+/gi, 'Bearer [REDACTED]').replace(/(?:-----BEGIN )[\s\S]*?(?:-----END [^-]+-----)/g, '[REDACTED]').slice(0, 1000);
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|password|authorization|private.?key|sql|query)/i.test(key)).map(([key, item]) => [key, safeValue(item)]));
  return value;
}

export async function observeReleaseRound({ manifest, round, observability, coreCheck = async () => [], activeVersionCheck = activeWorkerVersion, env = {}, priorCritical = new Map() }) {
  assert.ok(observability && typeof observability.listIssues === 'function' && typeof observability.queryWorkerMetrics === 'function', 'observability client is required');
  const services = [];
  let coreResults = [];
  try { coreResults = await coreCheck({ env, manifest }); } catch (error) { coreResults = [{ name: 'core contract', ok: false, detail: error.message }]; }
  for (const item of manifest.services) {
    const script = item.script;
    let active = null, versionMismatch = false;
    try { active = await activeVersionCheck(script, { env }); versionMismatch = active !== item.new_version; } catch (error) { versionMismatch = true; }
    let metrics = null, issues = [];
    try {
      metrics = await observability.queryWorkerMetrics({ scriptName: script, versionId: item.new_version, sinceMinutes: 5 });
      issues = await observability.listIssues({ scriptName: script, sinceMinutes: 5 });
    } catch (error) { issues = [{ title: 'observability unavailable', message: error.message }]; }
    const hardFailure = coreResults.some(result => result && result.ok === false);
    const highCritical = (number(metrics?.invocations) ?? 0) >= 20 && (number(metrics?.errorRate) ?? 0) >= 0.20 && (number(metrics?.errors) ?? 0) >= 20;
    const previousCritical = priorCritical.get(script) ?? 0;
    const severity = classifySeverity({ metrics: metrics ?? {}, baseline: item.baseline ?? {}, hardFailure, versionMismatch, criticalRounds: previousCritical });
    if (highCritical || hardFailure) priorCritical.set(script, previousCritical + 1); else priorCritical.set(script, 0);
    services.push({ service: serviceName(item), script, active_version: active, expected_version: item.new_version, version_mismatch: versionMismatch, metrics, issues: safeValue(issues), hard_failure: hardFailure, severity });
  }
  return safeValue({ round, services, core: coreResults, criticalRounds: Object.fromEntries(priorCritical) });
}

export async function runObserver({ manifest, bucket, step, env = {}, observability, notify = notifyGithub, coreCheck, activeVersionCheck, now = () => new Date().toISOString() }) {
  assert.ok(manifest?.release_id && Array.isArray(manifest.services), 'release manifest is required');
  assert.ok(bucket && typeof bucket.put === 'function', 'observer report bucket is required');
  const releaseId = manifest.release_id;
  let state = 'created';
  const seen = new Set();
  const criticalRounds = new Map();
  const events = [];
  const emit = async (type, detail = {}) => {
    const eventId = `${releaseId}-${events.length}-${type}`;
    const transition = detail.nextState ? transitionState(state, detail.nextState, eventId, seen) : { state, changed: false };
    state = transition.state;
    const event = safeValue({ event_id: eventId, release_id: releaseId, type, state, at: now(), ...detail });
    delete event.nextState;
    events.push(event);
    await bucket.put(`reports/observer/${releaseId}/events/${eventId}.json`, JSON.stringify(event), { httpMetadata: { contentType: 'application/json' } });
  };
  const affectedServices = manifest.services.map(item => item.service);
  try {
    await notify({ event_id: `${releaseId}-started`, releaseId, services: affectedServices, severity: 'started', summary: `observation window started (${new Date(Date.now() + 30 * 60000).toISOString()})`, rollback_allowed: manifest.services.every(item => item.rollback_allowed === true) }, { env });
    await emit('notification_sent', { nextState: 'notified' });
  } catch (error) {
    await emit('notification_failed', { error: error.message, nextState: 'notified' });
  }
  await emit('observation_started', { nextState: 'observing' });
  const offsets = [0, 5, 10, 15, 20, 25, 30];
  for (let i = 0; i < offsets.length; i++) {
    if (i > 0 && step?.sleep) await step.sleep(`observer wait ${i}`, `${offsets[i] - offsets[i - 1]} minutes`);
    const poll = await (step?.do ? step.do(`observer poll ${i}`, async () => observeReleaseRound({ manifest, round: i, observability, coreCheck, activeVersionCheck, env, priorCritical: criticalRounds })) : observeReleaseRound({ manifest, round: i, observability, coreCheck, activeVersionCheck, env, priorCritical: criticalRounds }));
    await bucket.put(`reports/observer/${releaseId}/poll-${i}.json`, JSON.stringify(safeValue(poll)), { httpMetadata: { contentType: 'application/json' } });
    const critical = poll.services.some(item => item.severity === 'critical');
    const degraded = poll.services.some(item => item.severity === 'degraded');
    if (critical && state !== 'rollback_pending' && state !== 'rollback_blocked') {
      await emit('critical_detected', { nextState: 'critical_detected', services: poll.services.filter(item => item.severity === 'critical').map(item => item.service) });
      const rollbackAllowed = manifest.services.every(item => item.rollback_allowed === true);
      await emit(rollbackAllowed ? 'rollback_candidate' : 'rollback_blocked', { nextState: rollbackAllowed ? 'rollback_pending' : 'rollback_blocked', rollback_allowed: rollbackAllowed });
      try { await notify({ releaseId, services: poll.services.filter(item => item.severity === 'critical'), severity: 'critical', summary: 'critical release observation' }, { env }); } catch (error) { await emit('notification_failed', { error: error.message }); }
    } else if (degraded && state === 'observing') {
      await emit('degraded_detected', { nextState: 'degraded_notified', services: poll.services.filter(item => item.severity === 'degraded').map(item => item.service) });
      try { await notify({ releaseId, services: poll.services.filter(item => item.severity === 'degraded'), severity: 'degraded', summary: 'degraded release observation' }, { env }); } catch (error) { await emit('notification_failed', { error: error.message }); }
      await emit('degraded_observation_continued', { nextState: 'observing' });
    }
  }
  if (state === 'observing') await emit('healthy_reported', { nextState: 'healthy_reported' });
  const summary = safeValue({ release_id: releaseId, state, completed_at: now(), events: events.length, manifest: { release_id: releaseId, services: manifest.services.map(item => ({ service: item.service, script: item.script, new_version: item.new_version })) } });
  await bucket.put(`reports/observer/${releaseId}/summary.json`, JSON.stringify(summary), { httpMetadata: { contentType: 'application/json' } });
  try {
    await notify({ event_id: `${releaseId}-completed`, releaseId, services: affectedServices, severity: summary.state, summary: `observation complete; summary: reports/observer/${releaseId}/summary.json` }, { env });
    await emit('completion_notification_sent');
  } catch (error) { await emit('notification_failed', { error: error.message }); }
  return summary;
}

export { safeValue };
