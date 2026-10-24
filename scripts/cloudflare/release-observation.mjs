export const OBSERVATION_WINDOW_MINUTES = 30;
export const OBSERVATION_POLL_OFFSETS_MINUTES = Object.freeze([0, 5, 10, 15, 20, 25, 30]);

const SERVICE_FIELDS = Object.freeze([
  'service', 'script', 'previous_version', 'new_version', 'previous_build_sha',
  'new_build_sha', 'smoke', 'migration_applied', 'secret_changed',
  'binding_changed', 'external_side_effects', 'rollback_allowed',
]);
export const OBSERVATION_FACT_FIELDS = Object.freeze([
  'migration_applied', 'secret_changed', 'binding_changed', 'external_side_effects',
]);
const FORBIDDEN_KEYS = /token|password|secret_value|sql|body|business|query/i;

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  if (FORBIDDEN_KEYS.test(name)) throw new Error(`forbidden manifest field: ${name}`);
  return value;
}

function serviceEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('service entry must be an object');
  for (const key of Object.keys(input)) {
    if (!SERVICE_FIELDS.includes(key) || FORBIDDEN_KEYS.test(key)) throw new Error(`invalid service field: ${key}`);
  }
  const entry = {};
  for (const key of ['service', 'script', 'previous_version', 'new_version',
    'previous_build_sha', 'new_build_sha', 'smoke']) {
    const value = input[key];
    if (['previous_version', 'previous_build_sha'].includes(key) && (value === '' || value == null)) {
      entry[key] = '';
    } else {
      entry[key] = requiredString(value, key);
    }
  }
  for (const key of OBSERVATION_FACT_FIELDS) {
    if (typeof input[key] !== 'boolean') throw new Error(`${key} must be boolean`);
    entry[key] = input[key];
  }
  entry.rollback_allowed = !entry.migration_applied && !entry.secret_changed
    && !entry.binding_changed && !entry.external_side_effects && Boolean(entry.previous_version);
  return entry;
}

export function buildReleaseManifest({ sourceSha, services, startedAt, nonce }) {
  requiredString(sourceSha, 'source_sha');
  requiredString(startedAt, 'started_at');
  requiredString(nonce, 'nonce');
  if (!Array.isArray(services) || services.length === 0) throw new Error('services must be a non-empty array');
  const manifest = {
    version: 1,
    release_id: `release-${sourceSha.slice(0, 12)}-${nonce}`,
    source_sha: sourceSha,
    started_at: startedAt,
    nonce,
    observation_window_minutes: OBSERVATION_WINDOW_MINUTES,
    poll_offsets_minutes: [...OBSERVATION_POLL_OFFSETS_MINUTES],
    services: services.map(serviceEntry),
  };
  validateReleaseManifest(manifest);
  return manifest;
}

export function validateReleaseManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest must be an object');
  if (manifest.version !== 1) throw new Error('unsupported manifest version');
  requiredString(manifest.release_id, 'release_id');
  requiredString(manifest.source_sha, 'source_sha');
  requiredString(manifest.started_at, 'started_at');
  requiredString(manifest.nonce, 'nonce');
  if (manifest.observation_window_minutes !== OBSERVATION_WINDOW_MINUTES) throw new Error('invalid observation window');
  if (JSON.stringify(manifest.poll_offsets_minutes) !== JSON.stringify(OBSERVATION_POLL_OFFSETS_MINUTES)) throw new Error('invalid poll offsets');
  if (!Array.isArray(manifest.services) || manifest.services.length === 0) throw new Error('services must be a non-empty array');
  for (const key of Object.keys(manifest)) if (FORBIDDEN_KEYS.test(key)) throw new Error(`forbidden manifest field: ${key}`);
  const services = manifest.services.map(serviceEntry);
  if (JSON.stringify(services) !== JSON.stringify(manifest.services)) throw new Error('rollback_allowed is inconsistent');
  return true;
}
