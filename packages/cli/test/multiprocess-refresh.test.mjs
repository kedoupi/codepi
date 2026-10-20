import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  closeServer,
  json,
  listen,
  makeTempDir,
  readBody,
  removeTempDir,
  writeCredentials,
} from "./helpers.mjs";

test("two real processes serialize refresh after the lock and do not replay the refresh family", async () => {
  const dir = await makeTempDir();
  const serverRef = { value: "" };
  let refreshRequests = 0;
  const tokenServer = createServer(async (req, res) => {
    if (req.url !== "/oauth/token") {
      json(res, 404, { error: "not_found" });
      return;
    }
    refreshRequests += 1;
    const body = new URLSearchParams(await readBody(req));
    if (body.get("refresh_token") !== "synthetic-refresh") {
      json(res, 400, { error: "invalid_grant", replay: true });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
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
    await writeCredentials(dir, serverRef.value, {
      expiresAt: Date.now() + 20_000,
    });
    const child = new URL("./fixtures/refresh-child.mjs", import.meta.url).pathname;
    const results = await Promise.all([
      runChild(child, dir, serverRef.value),
      runChild(child, dir, serverRef.value),
    ]);
    assert.deepEqual(results.map((result) => result.code), [0, 0]);
    assert.equal(refreshRequests, 1);
    assert.deepEqual(
      results.map((result) => JSON.parse(result.stdout).refreshed).sort(),
      [false, true],
    );
  } finally {
    tokenServer.closeAllConnections();
    await new Promise((resolve) => tokenServer.close(resolve));
    await removeTempDir(dir);
  }
});

test("two processes adopt a refresh completed by the other after concurrent 401s", {
  timeout: 20_000,
}, async () => {
  const dir = await makeTempDir();
  const fake = await startCrossProcess401Server();
  try {
    const store = await writeCredentials(dir, fake.server, {
      expiresAt: Date.now() + 3_600_000,
    });
    const child = new URL("./fixtures/mcp-401-child.mjs", import.meta.url).pathname;
    const results = await Promise.all([
      runChild(child, dir, fake.server, { CODEPI_TEST_CLIENT: "child-a" }),
      runChild(child, dir, fake.server, { CODEPI_TEST_CLIENT: "child-b" }),
    ]);
    assert.deepEqual(
      results.map((result) => result.code),
      [0, 0],
      results.map((result) => result.stderr).join("\n"),
    );
    for (const result of results) {
      assert.deepEqual(JSON.parse(result.stdout).structured, { ok: true });
    }
    assert.equal(fake.tokenRequests, 1);
    assert.deepEqual(fake.refreshTokens, ["synthetic-refresh"]);
    assert.equal(fake.unauthorizedClients, 2);
    const saved = await store.read();
    assert.equal(saved.tokens.access_token, "rotated-access");
    assert.equal(saved.tokens.refresh_token, "rotated-refresh");
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

async function startCrossProcess401Server() {
  let tokenRequests = 0;
  const refreshTokens = [];
  const unauthorized = new Set();
  let releaseBarrier;
  const barrier = new Promise((resolve) => {
    releaseBarrier = resolve;
  });
  const serverRef = { value: "" };

  const makeSdkServer = () => {
    const sdkServer = new Server(
      { name: "cross-process-401", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    sdkServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: "get_context",
        description: "Cross-process 401 fixture",
        inputSchema: { type: "object", properties: {}, additionalProperties: true },
      }],
    }));
    sdkServer.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: "text", text: '{"ok":true}' }],
      structuredContent: { ok: true },
    }));
    return sdkServer;
  };

  const server = createServer(async (req, res) => {
    const origin = serverRef.value;
    const url = new URL(req.url ?? "/", origin || "http://127.0.0.1");
    try {
      if (url.pathname === "/.well-known/oauth-authorization-server") {
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
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
          url.pathname === "/.well-known/oauth-protected-resource") {
        json(res, 200, {
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ["context.read", "projects.read", "projects.write"],
          bearer_methods_supported: ["header"],
        });
        return;
      }
      if (url.pathname === "/oauth/token") {
        tokenRequests += 1;
        const body = new URLSearchParams(await readBody(req));
        refreshTokens.push(body.get("refresh_token"));
        if (body.get("grant_type") !== "refresh_token" ||
            body.get("refresh_token") !== "synthetic-refresh") {
          json(res, 400, { error: "invalid_grant" });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        json(res, 200, {
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "context.read projects.read projects.write",
        });
        return;
      }
      if (url.pathname !== "/mcp") {
        json(res, 404, { error: "not_found" });
        return;
      }

      const body = await readBody(req);
      if (req.headers.authorization !== "Bearer rotated-access") {
        if (req.headers.authorization === "Bearer synthetic-access") {
          const client = String(req.headers["x-codepi-test-client"] ?? "unknown");
          unauthorized.add(client);
          if (unauthorized.size >= 2) releaseBarrier();
          await Promise.race([
            barrier,
            new Promise((resolve) => setTimeout(resolve, 5_000)),
          ]);
        }
        res.writeHead(401, {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        }).end(JSON.stringify({ error: "invalid_token" }));
        return;
      }

      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, value);
      }
      const request = new Request("http://127.0.0.1/mcp", {
        method: req.method,
        headers,
        ...(body.length > 0 ? { body } : {}),
      });
      const sdkServer = makeSdkServer();
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        keepAliveMs: 0,
      });
      await sdkServer.connect(transport);
      const response = await transport.handleRequest(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) {
        try {
          for await (const chunk of Readable.fromWeb(response.body)) {
            if (!res.write(chunk)) {
              await new Promise((resolve) => res.once("drain", resolve));
            }
          }
        } finally {
          res.end();
        }
      } else {
        res.end();
      }
      await sdkServer.close().catch(() => undefined);
    } catch {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    }
  });
  await listen(server);
  const address = server.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  return {
    server: serverRef.value,
    get tokenRequests() {
      return tokenRequests;
    },
    get refreshTokens() {
      return [...refreshTokens];
    },
    get unauthorizedClients() {
      return unauthorized.size;
    },
    async close() {
      server.closeAllConnections();
      await closeServer(server);
    },
  };
}

function runChild(script, configDir, server, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        CODEPI_CONFIG_DIR: configDir,
        CODEPI_TEST_SERVER: server,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`child exited from ${signal}`));
      else resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
