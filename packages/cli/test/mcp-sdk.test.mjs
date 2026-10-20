import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { callMcpTool } from "../dist/mcp.js";
import { CliError, EXIT } from "../dist/errors.js";
import {
  closeServer,
  json,
  listen,
  makeTempDir,
  readBody,
  removeTempDir,
  startAlways401Server,
  startFakeMcpServer,
  startForbiddenServer,
  writeCredentials,
} from "./helpers.mjs";

for (const json of [true, false]) {
  test(`official MCP client handles ${json ? "JSON" : "SSE"} tool responses`, async () => {
    const dir = await makeTempDir();
    const fake = await startFakeMcpServer({
      json,
      tools: {
        get_context: async () => ({
          content: [{ type: "text", text: JSON.stringify({ mode: json ? "json" : "sse" }) }],
          structuredContent: { mode: json ? "json" : "sse", sources: [] },
        }),
      },
    });
    try {
      await writeCredentials(dir, fake.server);
      const result = await callMcpTool({
        server: fake.server,
        name: "get_context",
        args: {},
        configDir: dir,
      });
      assert.deepEqual(result.structured, { mode: json ? "json" : "sse", sources: [] });
      assert.equal(fake.calls.length, 1);
    } finally {
      await fake.close();
      await removeTempDir(dir);
    }
  });
}

test("SDK retries a 401 exactly once after a serialized token refresh", async () => {
  const dir = await makeTempDir();
  const fake = await startAlways401Server();
  try {
    const store = await writeCredentials(dir, fake.server);
    await assert.rejects(
      callMcpTool({
        server: fake.server,
        name: "get_context",
        args: {},
        configDir: dir,
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, EXIT.AUTH);
        assert.doesNotMatch(error.message, /synthetic-refresh|rotated-refresh|synthetic-access/);
        return true;
      },
    );
    assert.equal(fake.tokenRequests, 1);
    assert.equal(fake.mcpRequests, 2, "initial request plus exactly one SDK retry");
    const saved = await store.read();
    assert.equal(saved.tokens.refresh_token, "rotated-refresh");
    assert.equal(saved.tokens.access_token, "rotated-access");
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

test("invalid refresh grant releases the held refresh lease and clears the token family", async () => {
  const dir = await makeTempDir();
  const serverRef = { value: "" };
  let tokenRequests = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/oauth/token") {
      tokenRequests += 1;
      const body = new URLSearchParams(await readBody(req));
      if (body.get("refresh_token") === "synthetic-refresh") {
        json(res, 200, {
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "context.read projects.read projects.write",
        });
        return;
      }
      json(res, 400, { error: "invalid_grant" });
      return;
    }
    if (req.url === "/mcp") {
      await readBody(req);
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${serverRef.value}/.well-known/oauth-protected-resource/mcp"`,
      }).end(JSON.stringify({ error: "invalid_token" }));
      return;
    }
    json(res, 404, { error: "not_found" });
  });
  await listen(server);
  const address = server.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  try {
    const store = await writeCredentials(dir, serverRef.value, {
      expiresAt: Date.now() + 20_000,
    });
    await assert.rejects(
      callMcpTool({
        server: serverRef.value,
        name: "get_context",
        args: {},
        configDir: dir,
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, EXIT.AUTH);
        return true;
      },
    );
    assert.equal(tokenRequests, 2);
    const saved = await store.read();
    assert.equal(saved.tokens, undefined);
  } finally {
    server.closeAllConnections();
    await closeServer(server);
    await removeTempDir(dir);
  }
});

test("maps HTTP 403 to exit code 3 without another auth retry", async () => {
  const dir = await makeTempDir();
  const fake = await startForbiddenServer("");
  const oldServer = fake.server;
  fake.server = fake.baseServer;
  try {
    await writeCredentials(dir, fake.baseServer);
    await assert.rejects(
      callMcpTool({
        server: fake.baseServer,
        name: "project_handoff_save",
        args: {},
        configDir: dir,
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, EXIT.SCOPE);
        assert.equal(error.scope, "projects.write");
        return true;
      },
    );
    assert.equal(fake.requests, 1);
  } finally {
    void oldServer;
    await fake.close();
    await removeTempDir(dir);
  }
});

test("only reports known scopes from a remote 403 challenge", async () => {
  const dir = await makeTempDir();
  const fake = await startForbiddenServer(
    "",
    "projects.write synthetic-access-secret",
  );
  fake.server = fake.baseServer;
  try {
    await writeCredentials(dir, fake.baseServer);
    await assert.rejects(
      callMcpTool({
        server: fake.baseServer,
        name: "project_handoff_save",
        args: {},
        configDir: dir,
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, EXIT.SCOPE);
        assert.equal(error.scope, "projects.write");
        assert.doesNotMatch(error.message, /synthetic-access-secret/);
        return true;
      },
    );
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

test("maps tool isError to a safe error code without echoing remote text", async () => {
  const dir = await makeTempDir();
  const fake = await startFakeMcpServer({
    tools: {
      project_handoff_save: async () => ({
        isError: true,
        content: [{
          type: "text",
          text: "synthetic-access-secret synthetic-refresh-secret Bearer synthetic-bearer-secret",
        }],
        structuredContent: { error: "invalid_arguments" },
      }),
    },
  });
  try {
    await writeCredentials(dir, fake.server);
    await assert.rejects(
      callMcpTool({
        server: fake.server,
        name: "project_handoff_save",
        args: {},
        configDir: dir,
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, EXIT.REMOTE);
        assert.match(error.message, /invalid_arguments/);
        assert.doesNotMatch(error.message, /synthetic-(?:access|refresh|bearer)-secret/);
        return true;
      },
    );
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

test("does not echo an unsafe MCP error code", async () => {
  const dir = await makeTempDir();
  const fake = await startFakeMcpServer({
    tools: {
      project_get: async () => ({
        isError: true,
        content: [{ type: "text", text: "synthetic-access-secret" }],
        structuredContent: { error: "synthetic-access-secret" },
      }),
    },
  });
  try {
    await writeCredentials(dir, fake.server);
    await assert.rejects(
      callMcpTool({
        server: fake.server,
        name: "project_get",
        args: { project: "synthetic/repo" },
        configDir: dir,
      }),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, EXIT.REMOTE);
        assert.equal(error.message, "MCP 工具返回错误。");
        assert.doesNotMatch(error.message, /synthetic-access-secret/);
        return true;
      },
    );
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

test("maps unified MCP tool permission errors to exit code 3 without a token retry", async () => {
  const dir = await makeTempDir();
  const fake = await startFakeMcpServer({
    tools: {
      project_get: async () => ({
        isError: true,
        content: [{ type: "text", text: '{"error":"tool_not_available"}' }],
        structuredContent: { error: "tool_not_available" },
      }),
    },
  });
  try {
    await writeCredentials(dir, fake.server);
    await assert.rejects(callMcpTool({
      server: fake.server, name: "project_get", args: { project: "synthetic/repo" }, configDir: dir,
    }), error => error instanceof CliError && error.exitCode === EXIT.SCOPE);
    assert.equal(fake.calls.length, 1);
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

test("concurrent GET and POST 401s share one in-process refresh", async () => {
  const dir = await makeTempDir();
  const fake = await startConcurrent401Server();
  try {
    const store = await writeCredentials(dir, fake.server);
    const result = await callMcpTool({
      server: fake.server,
      name: "get_context",
      args: {},
      configDir: dir,
    });
    assert.deepEqual(result.structured, { ok: true });
    assert.equal(fake.tokenRequests, 1);
    assert.equal(fake.getRequests, 2, "initial GET 401 plus the authorized retry");
    assert.equal(fake.toolRequests, 2, "initial tool call plus the SDK retry");
    const saved = await store.read();
    assert.equal(saved.tokens.access_token, "rotated-access");
    assert.equal(saved.tokens.refresh_token, "rotated-refresh");
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

test("concurrent GET and POST adopt credentials refreshed by another process without another token request", async () => {
  const dir = await makeTempDir();
  let store;
  const fake = await startConcurrent401Server({
    async beforeUnauthorized() {
      const current = await store.read();
      await store.write({
        ...current,
        tokens: { ...current.tokens, access_token: "rotated-access", refresh_token: "rotated-refresh" },
      });
    },
  });
  try {
    store = await writeCredentials(dir, fake.server);
    const result = await callMcpTool({
      server: fake.server, name: "get_context", args: {}, configDir: dir,
    });
    assert.deepEqual(result.structured, { ok: true });
    assert.equal(fake.tokenRequests, 0);
    assert.equal(fake.getRequests, 2);
    assert.equal(fake.toolRequests, 2);
    assert.equal((await store.read()).tokens.refresh_token, "rotated-refresh");
  } finally {
    await fake.close();
    await removeTempDir(dir);
  }
});

async function startConcurrent401Server({ beforeUnauthorized } = {}) {
  let tokenRequests = 0;
  let getRequests = 0;
  let toolRequests = 0;
  let getReached;
  let toolReached;
  let getRetried;
  const getStarted = new Promise((resolve) => {
    getReached = resolve;
  });
  const toolStarted = new Promise((resolve) => {
    toolReached = resolve;
  });
  const getRetryStarted = new Promise((resolve) => {
    getRetried = resolve;
  });
  const serverRef = { value: "" };
  let beforeUnauthorizedResult;
  const before401 = () => beforeUnauthorizedResult ??= Promise.resolve().then(() => beforeUnauthorized?.());

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", serverRef.value || "http://127.0.0.1");
    if (url.pathname === "/oauth/token") {
      tokenRequests += 1;
      const body = new URLSearchParams(await readBody(req));
      if (body.get("grant_type") !== "refresh_token" ||
          body.get("refresh_token") !== "synthetic-refresh") {
        json(res, 400, { error: "invalid_grant" });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
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
    const authorization = req.headers.authorization;
    if (req.method === "GET") {
      getRequests += 1;
      if (authorization === "Bearer rotated-access") {
        getRetried();
        res.writeHead(405).end();
        return;
      }
      if (authorization !== "Bearer synthetic-access") {
        unauthorized(res, serverRef.value);
        return;
      }
      getReached();
      await toolStarted;
      await before401();
      unauthorized(res, serverRef.value);
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const message = JSON.parse(await readBody(req));
    if (message.method === "initialize") {
      if (authorization !== "Bearer synthetic-access") {
        unauthorized(res, serverRef.value);
        return;
      }
      json(res, 200, {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "concurrent-401", version: "1.0.0" },
        },
      });
      return;
    }
    if (message.method?.startsWith("notifications/")) {
      res.writeHead(202).end();
      return;
    }
    if (message.method === "tools/call") {
      toolRequests += 1;
      if (authorization === "Bearer rotated-access") {
        // Keep this response pending until the GET retry is observed so the
        // test cannot close the transport before both single-flight paths run.
        await Promise.race([
          getRetryStarted,
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
        json(res, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: '{"ok":true}' }],
            structuredContent: { ok: true },
          },
        });
        return;
      }
      if (authorization !== "Bearer synthetic-access") {
        unauthorized(res, serverRef.value);
        return;
      }
      toolReached();
      await getStarted;
      await before401();
      unauthorized(res, serverRef.value);
      return;
    }
    json(res, 200, {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "Method not found" },
    });
  });
  await listen(server);
  const address = server.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  return {
    server: serverRef.value,
    get tokenRequests() {
      return tokenRequests;
    },
    get getRequests() {
      return getRequests;
    },
    get toolRequests() {
      return toolRequests;
    },
    async close() {
      server.closeAllConnections();
      await closeServer(server);
    },
  };
}

function unauthorized(res, server) {
  res.writeHead(401, {
    "Content-Type": "application/json",
    "WWW-Authenticate": `Bearer resource_metadata="${server}/.well-known/oauth-protected-resource/mcp"`,
  }).end(JSON.stringify({ error: "invalid_token" }));
}
