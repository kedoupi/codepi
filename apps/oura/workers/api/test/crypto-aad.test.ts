import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Env } from "../src/env.ts";
import {
  BLOB_VERSION,
  bytesToBase64,
  DecryptError,
  decryptJson,
  encryptJson,
  packEncryptedBlob,
  type EncryptedBlob,
} from "../src/lib/crypto.ts";
import {
  loadEncryptedTokens,
  tokenAad,
  upsertEncryptedTokens,
  type StoredTokens,
} from "../src/lib/tokens.ts";

const SECRET = "test-token-encryption-key";

const tokens: StoredTokens = {
  refresh_token: "rt_secret",
  access_token: "at_secret",
  expires_at: 1_700_000_000_000,
};

/** Mirrors the pre-AAD implementation: AES-GCM, random IV, no version field. */
async function legacyEncrypt(secret: string, data: unknown): Promise<EncryptedBlob> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ct) };
}

function flipByte(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  bytes[0] ^= 0x01;
  return bytesToBase64(bytes);
}

type Row = { ciphertext: string; iv: string };

/** Minimal D1 stand-in for the two `encrypted_tokens` statements tokens.ts uses. */
function fakeEnv(rows = new Map<string, Row>()): Env & { rows: Map<string, Row> } {
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              assert.match(sql, /INSERT INTO encrypted_tokens/i);
              const [userId, ciphertext, iv] = args as [string, string, string];
              rows.set(userId, { ciphertext, iv });
              return { success: true };
            },
            async first() {
              assert.match(sql, /SELECT ciphertext, iv FROM encrypted_tokens/i);
              return rows.get(args[0] as string) ?? null;
            },
          };
        },
      };
    },
  };
  return { DB, rows } as unknown as Env & { rows: Map<string, Row> };
}

describe("encryptJson / decryptJson with AAD", () => {
  it("round-trips a payload bound to an AAD and tags the blob as v2", async () => {
    const aad = tokenAad("user-a");
    const blob = await encryptJson(SECRET, tokens, aad);
    assert.equal(blob.v, BLOB_VERSION);
    assert.ok(!blob.ciphertext.includes("rt_secret"));
    assert.notEqual(blob.iv, blob.ciphertext);
    assert.deepEqual(await decryptJson<StoredTokens>(SECRET, blob, aad), tokens);
  });

  it("round-trips a payload without AAD (back-compat call shape)", async () => {
    const blob = await encryptJson(SECRET, tokens);
    assert.deepEqual(await decryptJson<StoredTokens>(SECRET, blob), tokens);
  });

  it("fails when a blob encrypted for one user is decrypted as another", async () => {
    const blob = await encryptJson(SECRET, tokens, tokenAad("user-a"));
    await assert.rejects(
      decryptJson<StoredTokens>(SECRET, blob, tokenAad("user-b")),
      (err: unknown) => {
        assert.ok(err instanceof DecryptError);
        assert.equal(err.code, "decrypt_failed");
        return true;
      },
    );
    await assert.rejects(decryptJson<StoredTokens>(SECRET, blob, tokenAad("user-a") + "x"));
    await assert.rejects(decryptJson<StoredTokens>(SECRET, blob));
  });

  it("still decrypts legacy unversioned blobs, with or without an AAD argument", async () => {
    const legacy = await legacyEncrypt(SECRET, tokens);
    assert.equal(legacy.v, undefined);
    // Legacy rows are read through the same AAD-aware path; the AAD is ignored.
    assert.deepEqual(await decryptJson<StoredTokens>(SECRET, legacy, tokenAad("user-a")), tokens);
    assert.deepEqual(await decryptJson<StoredTokens>(SECRET, legacy), tokens);
    // Both column packings of a legacy blob must survive a round trip.
    const packed = packEncryptedBlob(legacy);
    assert.equal(packed.ciphertext, legacy.ciphertext);
    assert.equal(packed.iv, legacy.iv);
  });

  it("fails on a tampered ciphertext instead of returning garbage", async () => {
    const aad = tokenAad("user-a");
    const blob = await encryptJson(SECRET, tokens, aad);
    await assert.rejects(
      decryptJson<StoredTokens>(SECRET, { ...blob, ciphertext: flipByte(blob.ciphertext) }, aad),
      DecryptError,
    );
    await assert.rejects(
      decryptJson<StoredTokens>(SECRET, { ...blob, iv: flipByte(blob.iv) }, aad),
      DecryptError,
    );
    const legacy = await legacyEncrypt(SECRET, tokens);
    await assert.rejects(
      decryptJson<StoredTokens>(SECRET, { ...legacy, ciphertext: flipByte(legacy.ciphertext) }),
      DecryptError,
    );
  });

  it("rejects a blob from a newer envelope version", async () => {
    const blob = await encryptJson(SECRET, tokens, tokenAad("user-a"));
    await assert.rejects(
      decryptJson<StoredTokens>(SECRET, { ...blob, v: BLOB_VERSION + 1 }, tokenAad("user-a")),
      DecryptError,
    );
  });
});

describe("encrypted_tokens storage is identity-bound", () => {
  it("stores a versioned, AAD-bound blob and reads it back for the same user", async () => {
    const env = fakeEnv();
    await upsertEncryptedTokens(env, "user-a", SECRET, tokens);
    const row = env.rows.get("user-a")!;
    assert.match(row.ciphertext, new RegExp(`^v${BLOB_VERSION}\\.`));
    assert.ok(!row.ciphertext.includes("rt_secret"));
    assert.deepEqual(await loadEncryptedTokens(env, "user-a", SECRET), tokens);
  });

  it("fails when a stored row is re-keyed to a different user id", async () => {
    const env = fakeEnv();
    await upsertEncryptedTokens(env, "user-a", SECRET, tokens);
    env.rows.set("user-b", env.rows.get("user-a")!);
    assert.deepEqual(await loadEncryptedTokens(env, "user-a", SECRET), tokens);
    await assert.rejects(
      loadEncryptedTokens(env, "user-b", SECRET),
      (err: unknown) => err instanceof DecryptError && err.code === "decrypt_failed",
    );
  });

  it("loads a legacy row written before the AAD change", async () => {
    const env = fakeEnv();
    const legacy = await legacyEncrypt(SECRET, tokens);
    env.rows.set("user-a", { ciphertext: legacy.ciphertext, iv: legacy.iv });
    assert.deepEqual(await loadEncryptedTokens(env, "user-a", SECRET), tokens);
    // Next refresh rewrites the row in the new AAD-bound format.
    await upsertEncryptedTokens(env, "user-a", SECRET, tokens);
    assert.match(env.rows.get("user-a")!.ciphertext, new RegExp(`^v${BLOB_VERSION}\\.`));
    assert.deepEqual(await loadEncryptedTokens(env, "user-a", SECRET), tokens);
  });

  it("returns null only when no row exists", async () => {
    assert.equal(await loadEncryptedTokens(fakeEnv(), "user-a", SECRET), null);
  });
});
