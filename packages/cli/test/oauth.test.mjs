import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import {
  pkcePair,
  startLoopbackCallback,
  validateAuthorizationMetadata,
  discoverAuthorizationMetadata,
  registerClient,
  refreshCredentialsIfNeeded,
  revokeAuthorization,
} from "../dist/oauth.js";
import {
  authorizationMetadata,
  json,
  listen,
  makeTempDir,
  readBody,
  removeTempDir,
  writeCredentials,
} from "./helpers.mjs";

test("computes the RFC 7636 S256 PKCE challenge", () => {
  const pair = pkcePair("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(pair.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("loopback callback ignores a mismatched state and accepts the expected one", async () => {
  const callback = await startLoopbackCallback("expected-state", { timeoutMs: 5_000 });
  try {
    const wrong = await fetch(
      `${callback.redirectUri}?state=wrong&code=malicious`,
      { redirect: "error" },
    );
    assert.equal(wrong.status, 400);
    const accepted = fetch(
      `${callback.redirectUri}?state=expected-state&code=synthetic-code`,
      { redirect: "error" },
    );
    assert.equal(await callback.waitForCode(), "synthetic-code");
    assert.equal((await accepted).status, 200);
    assert.equal(new URL(callback.redirectUri).hostname, "127.0.0.1");
    assert.equal(new URL(callback.redirectUri).pathname, "/callback");
  } finally {
    await callback.close();
  }
});

test("rejects authorization metadata whose endpoints leave the trusted origin", () => {
  const server = "https://trusted.example";
  assert.throws(() => validateAuthorizationMetadata({
    issuer: server,
    authorization_endpoint: `${server}/authorize`,
    token_endpoint: "https://attacker.example/token",
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
  }, server), /origin/);
});

test("discovery rejects cross-origin metadata before any token endpoint can receive a request", async () => {
  let attackerRequests = 0;
  const attacker = createServer((req, res) => {
    attackerRequests += 1;
    json(res, 200, { error: "must_not_be_called" });
  });
  await listen(attacker);
  const attackerAddress = attacker.address();
  const attackerOrigin = `http://127.0.0.1:${attackerAddress.port}`;
  const trusted = createServer((req, res) => {
    if (req.url === "/.well-known/oauth-authorization-server") {
      json(res, 200, {
        issuer: trustedOrigin,
        authorization_endpoint: `${trustedOrigin}/oauth/authorize`,
        token_endpoint: `${attackerOrigin}/oauth/token`,
        response_types_supported: ["code"],
      });
      return;
    }
    json(res, 404, { error: "not_found" });
  });
  await listen(trusted);
  const trustedAddress = trusted.address();
  const trustedOrigin = `http://127.0.0.1:${trustedAddress.port}`;
  try {
    await assert.rejects(
      discoverAuthorizationMetadata(trustedOrigin),
      /origin/,
    );
    assert.equal(attackerRequests, 0);
  } finally {
    attacker.closeAllConnections();
    trusted.closeAllConnections();
    await new Promise((resolve) => attacker.close(resolve));
    await new Promise((resolve) => trusted.close(resolve));
  }
});

test("dynamic registration uses a public PKCE loopback callback", async () => {
  let registration;
  const registrationServer = createServer(async (req, res) => {
    if (req.url !== "/oauth/register") {
      json(res, 404, { error: "not_found" });
      return;
    }
    registration = JSON.parse(await readBody(req));
    json(res, 201, {
      client_id: "synthetic-client",
      client_name: "codepi CLI",
      redirect_uris: ["http://127.0.0.1/callback"],
    });
  });
  await listen(registrationServer);
  const address = registrationServer.address();
  const server = `http://127.0.0.1:${address.port}`;
  try {
    const client = await registerClient(
      authorizationMetadata(server),
      ["context.read", "projects.read", "projects.write"],
    );
    assert.equal(client.client_id, "synthetic-client");
    assert.deepEqual(registration.redirect_uris, ["http://127.0.0.1/callback"]);
    assert.equal(registration.token_endpoint_auth_method, "none");
    assert.deepEqual(registration.grant_types, ["authorization_code", "refresh_token"]);
  } finally {
    registrationServer.closeAllConnections();
    await new Promise((resolve) => registrationServer.close(resolve));
  }
});

test("does not refresh when the access token is valid for more than 60 seconds", async () => {
  const dir = await makeTempDir();
  const now = Date.now();
  try {
    const store = await writeCredentials(dir, "https://fresh.example", {
      expiresAt: now + 61_000,
    });
    const result = await refreshCredentialsIfNeeded(store, {
      now,
      fetchImpl: async () => {
        throw new Error("must not refresh");
      },
    });
    assert.equal(result.refreshed, false);
  } finally {
    await removeTempDir(dir);
  }
});

test("refresh happens within 60 seconds, rotates the refresh token atomically, and keeps mode 600", { skip: process.platform === "win32" }, async () => {
  const dir = await makeTempDir();
  const serverRef = { value: "" };
  let refreshes = 0;
  const tokenServer = createServer(async (req, res) => {
    if (req.url !== "/oauth/token") {
      json(res, 404, { error: "not_found" });
      return;
    }
    const body = new URLSearchParams(await readBody(req));
    assert.equal(body.get("refresh_token"), "synthetic-refresh");
    refreshes += 1;
    json(res, 200, {
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "context.read projects.read projects.write",
    });
  });
  await listen(tokenServer);
  const address = tokenServer.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  try {
    const store = await writeCredentials(dir, serverRef.value, {
      expiresAt: Date.now() + 30_000,
    });
    const record = await store.read();
    record.metadata = authorizationMetadata(serverRef.value);
    await store.write(record);
    const result = await refreshCredentialsIfNeeded(store);
    assert.equal(result.refreshed, true);
    assert.equal(result.tokens.refresh_token, "rotated-refresh");
    const saved = await store.read();
    assert.equal(saved.tokens.refresh_token, "rotated-refresh");
    assert.equal(saved.tokens.access_token, "rotated-access");
    assert.equal(refreshes, 1);
    assert.equal((await stat(store.filePath)).mode & 0o777, 0o600);
  } finally {
    tokenServer.closeAllConnections();
    await new Promise((resolve) => tokenServer.close(resolve));
    await removeTempDir(dir);
  }
});

test("refresh preserves the current refresh token when the server does not rotate it", async () => {
  const dir = await makeTempDir();
  const serverRef = { value: "" };
  const tokenServer = createServer(async (req, res) => {
    if (req.url !== "/oauth/token") {
      json(res, 404, { error: "not_found" });
      return;
    }
    await readBody(req);
    json(res, 200, {
      access_token: "rotated-access",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "context.read projects.read projects.write",
    });
  });
  await listen(tokenServer);
  const address = tokenServer.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  try {
    const store = await writeCredentials(dir, serverRef.value, {
      expiresAt: Date.now() + 30_000,
    });
    const result = await refreshCredentialsIfNeeded(store);
    assert.equal(result.refreshed, true);
    assert.equal(result.tokens.refresh_token, "synthetic-refresh");
    assert.equal((await store.read()).tokens.refresh_token, "synthetic-refresh");
  } finally {
    tokenServer.closeAllConnections();
    await new Promise((resolve) => tokenServer.close(resolve));
    await removeTempDir(dir);
  }
});

test("revocation failures are surfaced without exposing the token", async () => {
  const serverRef = { value: "" };
  const server = createServer(async (req, res) => {
    if (req.url !== "/oauth/revoke") {
      json(res, 404, { error: "not_found" });
      return;
    }
    await readBody(req);
    json(res, 503, { error: "temporarily_unavailable" });
  });
  await listen(server);
  const address = server.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  try {
    await assert.rejects(
      revokeAuthorization(
        authorizationMetadata(serverRef.value),
        "synthetic-client",
        "synthetic-secret-refresh-token",
        serverRef.value,
      ),
      (error) => {
        assert.match(error.message, /HTTP 503/);
        assert.doesNotMatch(error.message, /synthetic-secret-refresh-token/);
        return true;
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
