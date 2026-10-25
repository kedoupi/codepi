/**
 * OAuth Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document-02,
 * the profile required by MCP authorization 2025-11-25).
 *
 * A successful result is metadata for the current request only. It is not stored and
 * must not be treated as a durable client registration: the caller has to fetch and
 * validate again for a later authorization.
 *
 * SSRF: the client identifier is an HTTPS URL with a non-root path and no userinfo or
 * fragment. Query strings are accepted, matching the draft (they are discouraged, not
 * forbidden). IP literals, localhost, and the special-use suffixes .local, .localhost,
 * .internal and .arpa are refused before any request. When Node's DNS resolver is
 * reachable through process.getBuiltinModule, every resolved address must be global
 * unicast or the fetch is skipped. That check is not a connection pin: a resolver can
 * rebind between lookup and connect.
 *
 * On Cloudflare Workers that builtin is absent, so a public DNS name is fetched without
 * an address check. Workers fetch is subject to the platform network, which is not
 * absolute SSRF protection. This module never logs the URL, the document, or secrets.
 */
import { registrableRedirect, type OAuthClient } from "./oauth-store.ts";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_DOCUMENT_BYTES = 32 * 1024;
const MAX_REDIRECTS = 10;
const MAX_CLIENT_NAME = 120;

const V4_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0000200, 24], // 192.0.2.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xc6336400, 24], // 198.51.100.0/24
  [0xcb007100, 24], // 203.0.113.0/24
  [0xe0000000, 4], // 224.0.0.0/4
  [0xf0000000, 4], // 240.0.0.0/4
];

type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address?: string }>>;

function builtinDnsLookup(): DnsLookup | undefined {
  const runtime = globalThis as unknown as {
    process?: { getBuiltinModule?: (name: string) => { lookup?: DnsLookup } | undefined };
  };
  const load = runtime.process?.getBuiltinModule;
  if (typeof load !== "function") return undefined;
  try {
    const loaded = load("node:dns/promises");
    return typeof loaded?.lookup === "function" ? loaded.lookup.bind(loaded) : undefined;
  } catch {
    return undefined;
  }
}

function ipv4Parts(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map(part => Number(part));
  return parts.every(part => part <= 255) ? parts : null;
}

function isNonGlobalIPv4(parts: number[]): boolean {
  const value = (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

/** Returns 16 bytes, or null when the text is not an IPv6 address. */
function parseIPv6(input: string): Uint8Array | null {
  let value = input.toLowerCase();
  if (value.includes("%") || value.includes(":::")) return null;
  if (value.includes(".")) {
    const last = value.lastIndexOf(":");
    const v4 = ipv4Parts(value.slice(last + 1));
    if (!v4 || last < 0) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    value = `${value.slice(0, last + 1)}${high}:${low}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (head.concat(tail).some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 && (missing < 1 || head.length + tail.length > 7)) return null;
  const groups = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const parsed = parseInt(group, 16);
    bytes[index * 2] = parsed >> 8;
    bytes[index * 2 + 1] = parsed & 0xff;
  });
  return bytes;
}

function isNonGlobalIPv6(address: string): boolean {
  const bytes = parseIPv6(address);
  if (!bytes) return true;
  const mapped = bytes[10] === 0xff && bytes[11] === 0xff && bytes.slice(0, 10).every(byte => byte === 0);
  const compatible = bytes.slice(0, 12).every(byte => byte === 0);
  if (mapped || compatible) return isNonGlobalIPv4([bytes[12], bytes[13], bytes[14], bytes[15]]);
  if (bytes.every(byte => byte === 0) || (bytes[15] === 1 && bytes.slice(0, 15).every(byte => byte === 0))) return true;
  if (bytes[0] === 0xff) return true; // multicast
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isNonGlobalIPv4([bytes[2], bytes[3], bytes[4], bytes[5]]);
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every(byte => byte === 0)) {
    return isNonGlobalIPv4([bytes[12], bytes[13], bytes[14], bytes[15]]);
  }
  return false;
}

function isNonGlobalAddress(address: string): boolean {
  const v4 = ipv4Parts(address);
  return v4 ? isNonGlobalIPv4(v4) : isNonGlobalIPv6(address);
}

function isPublicDnsName(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253 || hostname.includes(":") || ipv4Parts(hostname)) return false;
  const host = hostname.toLowerCase();
  if (host.endsWith(".") || host === "localhost" || host.endsWith(".localhost")
    || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".arpa")) return false;
  const labels = host.split(".");
  return labels.length >= 2 && labels.every(label =>
    label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

/** Accepts only an exact HTTPS URL whose WHATWG hostname is a public DNS name. */
function acceptableClientUrl(clientId: string): URL | null {
  if (clientId.length === 0 || clientId.length > 2048 || /[\u0000- \u007f\\@]/.test(clientId)) return null;
  let url: URL;
  try { url = new URL(clientId); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  const scheme = clientId.indexOf("://");
  const pathStart = clientId.indexOf("/", scheme + 3);
  if (scheme !== 5 || pathStart < 0) return null;
  const rawPath = clientId.slice(pathStart).split("?")[0];
  if (rawPath === "/") return null;
  let segments: string[];
  try { segments = rawPath.split("/").slice(1).map(segment => decodeURIComponent(segment)); }
  catch { return null; }
  if (segments.length === 0 || segments.every(segment => segment === "")) return null;
  if (segments.slice(0, -1).some(segment => segment === "") || segments.some(segment => segment === "." || segment === "..")) {
    return null;
  }
  return isPublicDnsName(url.hostname) ? url : null;
}

async function addressesArePublic(hostname: string, signal: AbortSignal): Promise<boolean> {
  const lookup = builtinDnsLookup();
  // No resolver in this runtime: the hostname checks above are the only pre-connect filter.
  if (!lookup) return true;
  if (signal.aborted) return false;
  try {
    const records = await new Promise<Array<{ address?: string }>>((resolve, reject) => {
      const onAbort = () => reject(new Error("metadata_timeout"));
      signal.addEventListener("abort", onAbort, { once: true });
      lookup(hostname, { all: true, verbatim: true }).then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
    });
    if (signal.aborted || !Array.isArray(records) || records.length === 0 || records.length > 16) return false;
    return records.every(record => typeof record?.address === "string" && !isNonGlobalAddress(record.address));
  } catch {
    return false;
  }
}

function jsonMediaType(value: string | null): boolean {
  const media = value?.split(";", 1)[0]?.trim().toLowerCase();
  return media === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(media ?? "");
}

async function limitedJson(response: Response, signal: AbortSignal): Promise<unknown | undefined> {
  if (response.status === 0 || response.status !== 200) return undefined;
  if (!jsonMediaType(response.headers.get("content-type"))) return undefined;
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_DOCUMENT_BYTES)) return undefined;
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) return undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOCUMENT_BYTES) return undefined;
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return undefined;
  }
}

function clientFromDocument(clientId: string, body: unknown): OAuthClient | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const document = body as Record<string, unknown>;
  if (Object.hasOwn(document, "client_secret") || Object.hasOwn(document, "client_secret_expires_at")) return null;
  if (document.client_id !== clientId || document.token_endpoint_auth_method !== "none") return null;
  const uris = document.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECTS || !uris.every(registrableRedirect)) {
    return null;
  }
  if (typeof document.client_name !== "string" || document.client_name.length === 0
    || document.client_name.length > MAX_CLIENT_NAME) return null;
  return {
    client_id: clientId,
    client_name: document.client_name,
    redirect_uris: JSON.stringify(uris),
    token_endpoint_auth_method: "none",
    client_secret_hash: null,
  };
}

/**
 * Fetch and validate one metadata document. Returns null for every reject path,
 * including a private or unresolvable target, redirect, timeout, or malformed document.
 * Nothing is written to the client registry.
 */
export async function resolveMetadataClient(
  clientId: string,
  request: typeof fetch = fetch,
  resolve: ((hostname: string) => Promise<string[]>) | undefined = undefined,
): Promise<OAuthClient | null> {
  const url = acceptableClientUrl(clientId);
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    if (resolve) {
      const addresses = await resolve(url.hostname).catch(() => []);
      if (!addresses.length || addresses.some(isNonGlobalAddress)) return null;
    } else if (!await addressesArePublic(url.hostname, controller.signal)) return null;
    const response = await request(clientId, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    // Draft §5: only HTTP 200 is a document. 3xx is an error and must not be followed.
    if (response.status >= 300 && response.status < 400) return null;
    const document = await limitedJson(response, controller.signal);
    return document === undefined ? null : clientFromDocument(clientId, document);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
