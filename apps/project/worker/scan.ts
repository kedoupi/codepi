/**
 * Credential-shaped text must never be stored, even in a private database.
 * The pushing repository scans first; this is the second, independent check.
 * Matches report only the JSON path, never the matched text.
 */
const PATTERNS: RegExp[] = [
  /\b(?:vless|vmess|trojan|ssr?|hysteria2?|hy2|tuic|wireguard|socks5?):\/\/\S+/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /[?&](?:token|key|secret|password|passwd|sig|signature|auth)=[^&\s"']{8,}/i,
  /\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?[^\s"']{12,}/i,
];

export function findSecret(value: unknown, path = ""): string | null {
  if (typeof value === "string") {
    return PATTERNS.some(pattern => pattern.test(value)) ? path || "/" : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecret(value[i], `${path}/${i}`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const hit = findSecret(item, `${path}/${key}`);
      if (hit) return hit;
    }
  }
  return null;
}
