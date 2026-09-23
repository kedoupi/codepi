/**
 * Encode a flat object of primitives to a URL query string (no leading "?").
 * undefined and null values are omitted. Numbers and strings are stringified.
 *
 * @param {Record<string, string|number|boolean|null|undefined>} state
 * @returns {string}
 */
export function encodeState(state) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  return params.toString();
}

/**
 * Decode a URL query string (with or without leading "?"), merging into defaults.
 * For each default value, the type guides parsing: numeric defaults yield numbers,
 * string defaults yield strings, boolean defaults yield booleans.
 *
 * @template T
 * @param {string} qs
 * @param {T} defaults
 * @returns {T}
 */
export function decodeState(qs, defaults) {
  const cleaned = (qs || '').replace(/^\?/, '');
  const params = new URLSearchParams(cleaned);
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (!params.has(key)) continue;
    const raw = params.get(key);
    const def = defaults[key];
    if (typeof def === 'number') {
      const n = Number(raw);
      out[key] = Number.isFinite(n) ? n : def;
    } else if (typeof def === 'boolean') {
      out[key] = raw === 'true' || raw === '1';
    } else {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * Browser-side: replaceState the URL with the encoded query string.
 * Debounce in the caller; this just performs the swap.
 *
 * @param {Record<string, any>} state
 */
export function pushUrlState(state) {
  if (typeof window === 'undefined') return;
  const qs = encodeState(state);
  const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', newUrl);
}
