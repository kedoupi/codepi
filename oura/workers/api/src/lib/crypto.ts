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
  iv: string;
  ciphertext: string;
};

/** AES-GCM encrypt JSON. `secret` is hashed to 256-bit key material. */
export async function encryptJson(
  secret: string,
  data: unknown,
): Promise<EncryptedBlob> {
  const key = await aesKeyFromSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = te.encode(JSON.stringify(data));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: toBase64(iv), ciphertext: toBase64(ct) };
}

export async function decryptJson<T>(
  secret: string,
  blob: EncryptedBlob,
): Promise<T> {
  const key = await aesKeyFromSecret(secret);
  const iv = fromBase64(blob.iv);
  const ct = fromBase64(blob.ciphertext);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(td.decode(pt)) as T;
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
