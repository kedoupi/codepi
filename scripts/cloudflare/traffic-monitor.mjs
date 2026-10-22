import assert from 'node:assert/strict';
import { graphqlApi } from './worker-api.mjs';

export const TRAFFIC_QUERY = `query TrafficHourly($zoneTag: string, $start: Time, $end: Time) {
  viewer { zones(filter: { zoneTag: $zoneTag }) {
    httpRequests1hGroups(limit: 100, orderBy: [datetime_ASC], filter: { datetime_geq: $start, datetime_lt: $end }) {
      dimensions { datetime } sum { requests threats bytes } uniq { uniques }
    }
  } }
}`;
export const TRAFFIC_THRESHOLDS = Object.freeze({ threats: Object.freeze({ absoluteMinimum: 25, multiplier: 4 }), requests: Object.freeze({ absoluteMinimum: 1000, multiplier: 4 }) });
const ZONE_TAG = '268a0acf9bae4e2e2cbc4d8a0ba2c342';
const KEY = 'reports/traffic/samples.json';
const HOUR = 3600000, WEEK = 7 * 24 * HOUR;
const names = { threats: 'zone traffic threats exceed threshold', requests: 'zone traffic requests surge' };

function isoHour(value) {
  const date = new Date(value);
  assert.ok(Number.isFinite(date.getTime()), 'traffic hour is invalid');
  assert.equal(date.getUTCMinutes(), 0, 'traffic hour must be UTC aligned');
  assert.equal(date.getUTCSeconds(), 0, 'traffic hour must be UTC aligned');
  assert.equal(date.getUTCMilliseconds(), 0, 'traffic hour must be UTC aligned');
  return date.toISOString().replace('.000Z', 'Z');
}
function metric(value, name) { assert.ok(Number.isSafeInteger(value) && value >= 0, `${name} must be a non-negative safe integer`); return value; }
function validateSample(sample) {
  assert.ok(sample && typeof sample === 'object', 'traffic sample is invalid');
  return { hour: isoHour(sample.hour), requests: metric(sample.requests, 'requests'), threats: metric(sample.threats, 'threats'), bytes: metric(sample.bytes, 'bytes'), uniques: metric(sample.uniques, 'uniques') };
}
function validateBaseline(value) {
  assert.ok(value && value.version === 1 && Array.isArray(value.samples), 'traffic baseline is invalid');
  const samples = value.samples.map(validateSample);
  assert.equal(new Set(samples.map(sample => sample.hour)).size, samples.length, 'traffic baseline has duplicate hours');
  return { version: 1, samples };
}

export async function queryTrafficSamples(env, { now = Date.now(), request = fetch, zoneTag = env.CLOUDFLARE_ZONE_TAG || ZONE_TAG } = {}) {
  const endDate = new Date(Math.floor(now / HOUR) * HOUR), startDate = new Date(endDate - 2 * HOUR);
  const start = startDate.toISOString().replace('.000Z', 'Z'), end = endDate.toISOString().replace('.000Z', 'Z');
  const data = await graphqlApi(TRAFFIC_QUERY, { zoneTag, start, end }, { env, request });
  const zones = data?.viewer?.zones;
  assert.ok(Array.isArray(zones) && zones.length === 1, 'Cloudflare GraphQL zone result is missing or ambiguous');
  const rows = zones[0]?.httpRequests1hGroups;
  assert.ok(Array.isArray(rows), 'Cloudflare GraphQL traffic rows are missing');
  const samples = rows.map(row => validateSample({ hour: row?.dimensions?.datetime, requests: row?.sum?.requests, threats: row?.sum?.threats, bytes: row?.sum?.bytes, uniques: row?.uniq?.uniques }));
  assert.equal(new Set(samples.map(sample => sample.hour)).size, samples.length, 'Cloudflare returned duplicate traffic hours');
  const latest = new Date(endDate - HOUR).toISOString().replace('.000Z', 'Z');
  assert.ok(samples.some(sample => sample.hour === latest), 'latest complete traffic hour is missing');
  assert.ok(samples.every(sample => sample.hour >= start && sample.hour < end), 'traffic hour is outside query window');
  return samples;
}
export async function readTrafficBaseline(bucket) {
  const object = await bucket.get(KEY);
  return object ? validateBaseline(await object.json()) : { version: 1, samples: [] };
}
export async function mergeTrafficBaseline(bucket, samples, { now = Date.now(), retries = 3 } = {}) {
  const incoming = samples.map(validateSample);
  for (let attempt = 0; attempt < retries; attempt++) {
    const object = await bucket.get(KEY);
    const baseline = object ? validateBaseline(await object.json()) : { version: 1, samples: [] };
    const merged = new Map(baseline.samples.map(sample => [sample.hour, sample]));
    for (const sample of incoming) merged.set(sample.hour, sample);
    const cutoff = new Date(Math.floor(now / HOUR) * HOUR - WEEK).toISOString().replace('.000Z', 'Z');
    const result = { version: 1, samples: [...merged.values()].filter(sample => sample.hour > cutoff).sort((a, b) => a.hour.localeCompare(b.hour)) };
    const options = { httpMetadata: { contentType: 'application/json' } };
    if (object?.etag) options.onlyIf = { etagMatches: object.etag };
    try { const written = await bucket.put(KEY, JSON.stringify(result), options); assert.ok(written !== null, 'traffic baseline conditional write conflict'); return result; }
    catch (error) { if (attempt + 1 >= retries) throw error; }
  }
  throw new Error('traffic baseline write failed');
}
function result(name, ok, detail) { return detail ? { name, ok, detail } : { name, ok }; }
export function evaluateTrafficAlerts(samples, { now = Date.now(), thresholds = TRAFFIC_THRESHOLDS } = {}) {
  const currentHour = new Date(Math.floor(now / HOUR) * HOUR - HOUR).toISOString().replace('.000Z', 'Z');
  const current = samples.find(sample => sample.hour === currentHour); assert.ok(current, 'latest complete traffic hour is missing');
  const currentTime = Date.parse(current.hour), history = samples.filter(sample => sample.hour !== current.hour && Date.parse(sample.hour) < currentTime && currentTime - Date.parse(sample.hour) <= WEEK);
  const cold = new Set(history.map(sample => sample.hour)).size < 24;
  return ['threats', 'requests'].map(metricName => {
    const config = thresholds[metricName], sameSlot = history.filter(sample => sample.hour.slice(11, 13) === current.hour.slice(11, 13));
    const mean = sameSlot.length ? sameSlot.reduce((sum, sample) => sum + sample[metricName], 0) / sameSlot.length : 0;
    const threshold = cold || !sameSlot.length ? config.absoluteMinimum : Math.max(config.absoluteMinimum, config.multiplier * mean);
    return result(names[metricName], current[metricName] <= threshold, `hour=${current.hour}; value=${current[metricName]}; threshold=${threshold}; baseline_samples=${sameSlot.length}`);
  });
}
export async function checkTraffic({ env = process.env, bucket = env.BACKUPS, ...options } = {}) {
  try {
    assert.ok(bucket, 'BACKUPS binding is required');
    const samples = await queryTrafficSamples(env, options), baseline = await readTrafficBaseline(bucket);
    const merged = await mergeTrafficBaseline(bucket, [...baseline.samples, ...samples], options);
    return evaluateTrafficAlerts(merged.samples, options);
  } catch (error) {
    const detail = `Cloudflare GraphQL traffic check failed (${String(error?.message || 'unknown failure').replace(/\bBearer\s+\S+\b/gi, 'Bearer [redacted]').slice(0, 180)})`;
    return [result(names.threats, false, detail), result(names.requests, false, detail)];
  }
}
