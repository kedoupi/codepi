import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { CredentialStore } from "../dist/config.js";
import {
  closeServer,
  json,
  listen,
  makeTempDir,
  readBody,
  refreshWithStore,
  removeTempDir,
} from "./helpers.mjs";

test("login completes DCR, PKCE and a random loopback callback without printing tokens", {
  skip: process.platform === "win32",
  timeout: 15_000,
}, async () => {
  const dir = await makeTempDir();
  const serverRef = { value: "" };
  let registration;
  let authorization;
  let tokenRequest;
  let upstreamError = null;
  const server = createServer(async (req, res) => {
    const origin = serverRef.value;
    try {
      if (req.url === "/.well-known/oauth-authorization-server") {
        json(res, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/oauth/token`,
          registration_endpoint: `${origin}/oauth/register`,
          scopes_supported: ["context.read", "projects.read", "projects.write"],
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
        return;
      }
      if (req.url === "/oauth/register") {
        registration = JSON.parse(await readBody(req));
        json(res, 201, {
          client_id: "synthetic-login-client",
          client_name: "codepi CLI",
          redirect_uris: ["http://127.0.0.1/callback"],
        });
        return;
      }
      if (req.url?.startsWith("/oauth/authorize?")) {
        const url = new URL(req.url, origin);
        authorization = {
          clientId: url.searchParams.get("client_id"),
          redirectUri: url.searchParams.get("redirect_uri"),
          state: url.searchParams.get("state"),
          challenge: url.searchParams.get("code_challenge"),
          challengeMethod: url.searchParams.get("code_challenge_method"),
          scope: url.searchParams.get("scope"),
          resource: url.searchParams.get("resource"),
          responseType: url.searchParams.get("response_type"),
        };
        assert.equal(authorization.clientId, "synthetic-login-client");
        assert.equal(authorization.responseType, "code");
        assert.equal(authorization.challengeMethod, "S256");
        assert.equal(authorization.scope, "context.read projects.read projects.write");
        assert.equal(authorization.resource, `${origin}/mcp`);
        const callback = new URL(authorization.redirectUri);
        assert.equal(callback.hostname, "127.0.0.1");
        assert.equal(callback.pathname, "/callback");
        assert.ok(Number(callback.port) > 0);
        callback.searchParams.set("code", "synthetic-code");
        callback.searchParams.set("state", authorization.state);
        res.writeHead(302, { Location: callback.href, "Cache-Control": "no-store" }).end();
        return;
      }
      if (req.url === "/oauth/token") {
        tokenRequest = new URLSearchParams(await readBody(req));
        assert.equal(tokenRequest.get("grant_type"), "authorization_code");
        assert.equal(tokenRequest.get("code"), "synthetic-code");
        assert.equal(tokenRequest.get("client_id"), "synthetic-login-client");
        assert.equal(tokenRequest.get("redirect_uri"), authorization.redirectUri);
        assert.equal(tokenRequest.get("resource"), `${origin}/mcp`);
        assert.equal(
          createHash("sha256").update(tokenRequest.get("code_verifier")).digest("base64url"),
          authorization.challenge,
        );
        json(res, 200, {
          access_token: "synthetic-login-access",
          refresh_token: "synthetic-login-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "context.read projects.read projects.write",
        });
        return;
      }
      json(res, 404, { error: "not_found" });
    } catch (error) {
      upstreamError = error;
      json(res, 400, { error: "synthetic_test_failure" });
    }
  });
  await listen(server);
  const address = server.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  const cli = new URL("../dist/codepi.mjs", import.meta.url).pathname;
  const child = spawn(process.execPath, [cli, "--server", serverRef.value, "login", "--json"], {
    env: {
      ...process.env,
      CODEPI_CONFIG_DIR: dir,
      PATH: "/nonexistent",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let resolveUrl;
  let rejectUrl;
  const authorizationUrl = new Promise((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    const match = stderr.match(/https?:\/\/[^\s]+/);
    if (match) resolveUrl(new URL(match[0]));
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === null) {
        rejectUrl(new Error(`login exited from ${signal}`));
        reject(new Error(`login exited from ${signal}`));
        return;
      }
      resolve(code);
    });
  });
  exited.catch(() => undefined);
  try {
    let urlTimeout;
    const url = await Promise.race([
      authorizationUrl,
      new Promise((_, reject) => {
        urlTimeout = setTimeout(
          () => reject(new Error("login did not print an authorization URL")),
          5_000,
        );
        urlTimeout.unref();
      }),
    ]);
    clearTimeout(urlTimeout);
    const authorizationResponse = await fetch(url, { redirect: "manual" });
    assert.equal(authorizationResponse.status, 302);
    const callbackUrl = authorizationResponse.headers.get("location");
    assert.ok(callbackUrl);
    assert.equal((await fetch(callbackUrl)).status, 200);
    assert.equal(await exited, 0, stderr);
    assert.equal(upstreamError, null);
    assert.deepEqual(registration.redirect_uris, ["http://127.0.0.1/callback"]);
    assert.equal(registration.token_endpoint_auth_method, "none");
    const output = JSON.parse(stdout);
    assert.equal(output.server, serverRef.value);
    assert.equal(output.scope, "context.read projects.read projects.write");
    assert.doesNotMatch(stdout, /synthetic-login-(?:access|refresh)/);
    assert.doesNotMatch(stderr, /synthetic-login-(?:access|refresh)/);

    const store = new CredentialStore(serverRef.value, { configDir: dir });
    const saved = await store.read();
    assert.equal(saved.tokens.access_token, "synthetic-login-access");
    assert.equal(saved.tokens.refresh_token, "synthetic-login-refresh");
    assert.equal(saved.client.client_id, "synthetic-login-client");
  } finally {
    child.kill();
    server.closeAllConnections();
    await closeServer(server);
    await removeTempDir(dir);
  }
});

test("concurrent first login shares one DCR client and keeps refresh credentials bound", {
  skip: process.platform === "win32",
  timeout: 20_000,
}, async () => {
  const dir = await makeTempDir();
  const serverRef = { value: "" };
  const exchanges = [];
  let registrations = 0;
  let upstreamError = null;
  const server = createServer(async (req, res) => {
    const origin = serverRef.value;
    try {
      if (req.url === "/.well-known/oauth-authorization-server") {
        json(res, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/oauth/token`,
          registration_endpoint: `${origin}/oauth/register`,
          scopes_supported: ["context.read", "projects.read", "projects.write"],
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
        return;
      }
      if (req.url === "/oauth/register") {
        const registration = ++registrations;
        await readBody(req);
        // Keep registration busy so both new processes reach the race.
        await new Promise((resolve) => setTimeout(resolve, registration === 1 ? 250 : 650));
        json(res, 201, {
          client_id: registration === 1
            ? "synthetic-concurrent-client"
            : `synthetic-concurrent-client-${registration}`,
          client_name: "codepi CLI",
          redirect_uris: ["http://127.0.0.1/callback"],
        });
        return;
      }
      if (req.url?.startsWith("/oauth/authorize?")) {
        const url = new URL(req.url, origin);
        const redirectUri = url.searchParams.get("redirect_uri");
        const state = url.searchParams.get("state");
        assert.ok(redirectUri);
        assert.ok(state);
        const callback = new URL(redirectUri);
        callback.searchParams.set("code", `code-${state}`);
        callback.searchParams.set("state", state);
        res.writeHead(302, { Location: callback.href, "Cache-Control": "no-store" }).end();
        return;
      }
      if (req.url === "/oauth/token") {
        const body = new URLSearchParams(await readBody(req));
        const clientId = body.get("client_id");
        if (body.get("grant_type") === "authorization_code") {
          const code = body.get("code");
          assert.ok(code);
          assert.ok(clientId);
          const refreshToken = `refresh-${code}`;
          exchanges.push({ code, clientId, refreshToken });
          json(res, 200, {
            access_token: `access-${code}`,
            refresh_token: refreshToken,
            token_type: "Bearer",
            expires_in: 3600,
            scope: "context.read projects.read projects.write",
          });
          return;
        }
        if (body.get("grant_type") === "refresh_token") {
          const issued = exchanges.find((item) => item.refreshToken === body.get("refresh_token"));
          if (!issued || issued.clientId !== clientId) {
            json(res, 400, { error: "invalid_grant" });
            return;
          }
          json(res, 200, {
            access_token: "rotated-access",
            refresh_token: "rotated-refresh",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "context.read projects.read projects.write",
          });
          return;
        }
      }
      json(res, 404, { error: "not_found" });
    } catch (error) {
      upstreamError = error;
      json(res, 400, { error: "synthetic_test_failure" });
    }
  });
  await listen(server);
  const address = server.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  const cli = new URL("../dist/codepi.mjs", import.meta.url).pathname;
  const first = startLoginProcess(cli, serverRef.value, dir);
  const second = startLoginProcess(cli, serverRef.value, dir);
  try {
    const [firstUrl, secondUrl] = await Promise.all([
      loginAuthorizationUrl(first),
      loginAuthorizationUrl(second),
    ]);
    const firstCallback = await authorizationCallback(firstUrl);
    const secondCallback = await authorizationCallback(secondUrl);
    assert.notEqual(firstCallback.searchParams.get("state"), secondCallback.searchParams.get("state"));

    // Finish authorizations in reverse order to exercise the old race.
    assert.equal((await fetch(secondCallback)).status, 200);
    assert.equal(await second.exited, 0, second.stderr);
    assert.equal((await fetch(firstCallback)).status, 200);
    assert.equal(await first.exited, 0, first.stderr);

    assert.equal(registrations, 1);
    assert.equal(exchanges.length, 2);
    assert.deepEqual([...new Set(exchanges.map((item) => item.clientId))], [
      "synthetic-concurrent-client",
    ]);
    const store = new CredentialStore(serverRef.value, { configDir: dir });
    const saved = await store.read();
    const lastExchange = exchanges.find(
      (item) => item.code === firstCallback.searchParams.get("code"),
    );
    assert.equal(saved.client.client_id, "synthetic-concurrent-client");
    assert.equal(saved.tokens.refresh_token, lastExchange.refreshToken);
    const refreshed = await refreshWithStore(store);
    assert.equal(refreshed.refresh_token, "rotated-refresh");
    assert.equal(upstreamError, null);
  } finally {
    first.child.kill();
    second.child.kill();
    server.closeAllConnections();
    await closeServer(server);
    await removeTempDir(dir);
  }
});

for (const denied of [
  { error: "access_denied", exitCode: 2, message: /授权已取消/ },
  { error: "synthetic-access-secret", exitCode: 4, message: /授权失败/ },
]) {
  test(`login callback error ${denied.error} uses a fixed message`, {
    skip: process.platform === "win32",
    timeout: 15_000,
  }, async () => {
    const result = await runDeniedLogin(denied.error);
    assert.equal(result.code, denied.exitCode, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, denied.message);
    assert.equal(result.stderr.includes(denied.error), false);
    assert.equal(result.tokenRequests, 0);
    assert.equal(result.saved?.tokens, undefined);
    assert.equal(result.upstreamError, null);
  });
}

function startLoginProcess(cli, server, configDir) {
  const child = spawn(process.execPath, [cli, "--server", server, "login", "--json"], {
    env: {
      ...process.env,
      CODEPI_CONFIG_DIR: configDir,
      PATH: "/nonexistent",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let urlSettled = false;
  let resolveUrl;
  let rejectUrl;
  const authorizationUrl = new Promise((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    const match = !urlSettled && stderr.match(/https?:\/\/[^\s]+/);
    if (match) {
      urlSettled = true;
      resolveUrl(new URL(match[0]));
    }
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === null) {
        if (!urlSettled) rejectUrl(new Error(`login exited from ${signal}`));
        reject(new Error(`login exited from ${signal}`));
        return;
      }
      resolve(code);
    });
  });
  exited.catch(() => undefined);
  return {
    child,
    authorizationUrl,
    exited,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function loginAuthorizationUrl(login) {
  let timeout;
  try {
    return await Promise.race([
      login.authorizationUrl,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("login did not print an authorization URL")),
          5_000,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function authorizationCallback(url) {
  const response = await fetch(url, { redirect: "manual" });
  assert.equal(response.status, 302);
  const location = response.headers.get("location");
  assert.ok(location);
  return new URL(location);
}

async function runDeniedLogin(errorCode) {
  const dir = await makeTempDir();
  const serverRef = { value: "" };
  let tokenRequests = 0;
  let upstreamError = null;
  const server = createServer(async (req, res) => {
    const origin = serverRef.value;
    try {
      if (req.url === "/.well-known/oauth-authorization-server") {
        json(res, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/oauth/token`,
          registration_endpoint: `${origin}/oauth/register`,
          scopes_supported: ["context.read", "projects.read", "projects.write"],
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
        return;
      }
      if (req.url === "/oauth/register") {
        await readBody(req);
        json(res, 201, {
          client_id: "synthetic-denied-client",
          client_name: "codepi CLI",
          redirect_uris: ["http://127.0.0.1/callback"],
        });
        return;
      }
      if (req.url?.startsWith("/oauth/authorize?")) {
        const url = new URL(req.url, origin);
        const redirectUri = url.searchParams.get("redirect_uri");
        const state = url.searchParams.get("state");
        assert.ok(redirectUri);
        assert.ok(state);
        const callback = new URL(redirectUri);
        callback.searchParams.set("error", errorCode);
        callback.searchParams.set("error_description", "synthetic-description-secret");
        callback.searchParams.set("state", state);
        res.writeHead(302, { Location: callback.href, "Cache-Control": "no-store" }).end();
        return;
      }
      if (req.url === "/oauth/token") {
        tokenRequests += 1;
        await readBody(req);
        json(res, 400, { error: "must_not_be_called" });
        return;
      }
      json(res, 404, { error: "not_found" });
    } catch (error) {
      upstreamError = error;
      json(res, 400, { error: "synthetic_test_failure" });
    }
  });
  await listen(server);
  const address = server.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  const cli = new URL("../dist/codepi.mjs", import.meta.url).pathname;
  const child = spawn(process.execPath, [cli, "--server", serverRef.value, "login", "--json"], {
    env: {
      ...process.env,
      CODEPI_CONFIG_DIR: dir,
      PATH: "/nonexistent",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let resolveUrl;
  let rejectUrl;
  const authorizationUrl = new Promise((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    const match = stderr.match(/https?:\/\/[^\s]+/);
    if (match) resolveUrl(new URL(match[0]));
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === null) {
        rejectUrl(new Error(`login exited from ${signal}`));
        reject(new Error(`login exited from ${signal}`));
        return;
      }
      resolve(code);
    });
  });
  exited.catch(() => undefined);
  let saved;
  try {
    let urlTimeout;
    const url = await Promise.race([
      authorizationUrl,
      new Promise((_, reject) => {
        urlTimeout = setTimeout(
          () => reject(new Error("login did not print an authorization URL")),
          5_000,
        );
        urlTimeout.unref();
      }),
    ]);
    clearTimeout(urlTimeout);
    const authorizationResponse = await fetch(url, { redirect: "manual" });
    assert.equal(authorizationResponse.status, 302);
    const callbackUrl = authorizationResponse.headers.get("location");
    assert.ok(callbackUrl);
    assert.equal((await fetch(callbackUrl)).status, 400);
    const code = await exited;
    saved = await new CredentialStore(serverRef.value, { configDir: dir }).read();
    return { code, stdout, stderr, tokenRequests, saved, upstreamError };
  } finally {
    child.kill();
    server.closeAllConnections();
    await closeServer(server);
    await removeTempDir(dir);
  }
}
