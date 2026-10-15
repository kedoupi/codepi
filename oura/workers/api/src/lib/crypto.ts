const te = new TextEncoder();
const td = new TextDecoder();

function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  return toBase64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return toBase64(bytes);
}

export function base64ToBytes(b64: string): Uint8Array {
  return fromBase64(b64);
}

async function aesKeyFromSecret(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", te.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export type EncryptedBlob = {
  /**
   * Envelope version. `undefined` means a legacy v1 blob: AES-GCM with a
   * random 12-byte IV and no additional authenticated data. v2 additionally
   * may bind the ciphertext to an AAD context (see `encryptJson`).
   */
  v?: number;
  iv: string;
  ciphertext: string;
};

/** Current envelope version written by `encryptJson`. */
export const BLOB_VERSION = 2;

/** Distinguishable decrypt failure (tampered blob, wrong key, or stale AAD). */
export class DecryptError extends Error {
  readonly code = "decrypt_failed";
  constructor(message = "decrypt_failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "DecryptError";
  }
}

/**
 * AES-GCM encrypt JSON. `secret` is hashed to 256-bit key material.
 *
 * `aad` (additional authenticated data) is authenticated but not encrypted, so
 * a blob encrypted with an AAD can only be decrypted by a caller that knows the
 * same AAD. Callers that bind a row to its owner pass a stable per-row string
 * such as `oura-oauth-tokens:<userId>`.
 */
export async function encryptJson(
  secret: string,
  data: unknown,
  aad?: string,
): Promise<EncryptedBlob> {
  const key = await aesKeyFromSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = te.encode(JSON.stringify(data));
  const ct = await crypto.subtle.encrypt(
    aesGcmParams(iv, aad),
    key,
    plaintext,
  );
  return { v: BLOB_VERSION, iv: toBase64(iv), ciphertext: toBase64(ct) };
}

/** v1 params omit `additionalData` entirely; v2 only adds it when an AAD is given. */
function aesGcmParams(iv: Uint8Array, aad?: string) {
  return aad === undefined
    ? { name: "AES-GCM" as const, iv }
    : { name: "AES-GCM" as const, iv, additionalData: te.encode(aad) };
}

export async function decryptJson<T>(
  secret: string,
  blob: EncryptedBlob,
  aad?: string,
): Promise<T> {
  const version = blob.v ?? 1;
  if (version > BLOB_VERSION) {
    throw new DecryptError(`unsupported_blob_version:${version}`);
  }
  const key = await aesKeyFromSecret(secret);
  const iv = fromBase64(blob.iv);
  const ct = fromBase64(blob.ciphertext);
  // v1 blobs were encrypted without AAD; supplying one here would always fail.
  const params = version >= BLOB_VERSION ? aesGcmParams(iv, aad) : { name: "AES-GCM", iv };
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt(params, key, ct);
  } catch (cause) {
    throw new DecryptError("decrypt_failed", { cause });
  }
  try {
    return JSON.parse(td.decode(pt)) as T;
  } catch (cause) {
    throw new DecryptError("malformed_plaintext", { cause });
  }
}

/**
 * `encrypted_tokens` stores the envelope in the legacy two-column shape
 * (`iv` + `ciphertext`), so the version travels as a `v<N>.` prefix on the
 * ciphertext (base64 never contains `.`).
 */
export function packEncryptedBlob(blob: EncryptedBlob): { iv: string; ciphertext: string } {
  const v = blob.v ?? 1;
  if (v < BLOB_VERSION) return { iv: blob.iv, ciphertext: blob.ciphertext };
  return { iv: blob.iv, ciphertext: `v${v}.${blob.ciphertext}` };
}

export function unpackEncryptedBlob(row: { iv: string; ciphertext: string }): EncryptedBlob {
  const match = /^v(\d+)\./.exec(row.ciphertext);
  if (!match) return { iv: row.iv, ciphertext: row.ciphertext };
  return {
    v: Number(match[1]),
    iv: row.iv,
    ciphertext: row.ciphertext.slice(match[0].length),
  };
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", te.encode(secret));
  return crypto.subtle.importKey(
    "raw",
    hash,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function hmacSign(secret: string, value: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(value));
  return toBase64Url(sig);
}

export async function hmacVerify(
  secret: string,
  value: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(secret, value);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function parseSignedCookie(
  raw: string | null,
): { id: string; sig: string } | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  return { id: raw.slice(0, i), sig: raw.slice(i + 1) };
}

export function formatSignedCookie(id: string, sig: string): string {
  return `${id}.${sig}`;
}
