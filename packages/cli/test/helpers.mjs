import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CredentialStore } from "../dist/config.js";
import { refreshAuthorization } from "../dist/oauth.js";

export async function makeTempDir(prefix = "codepi-cli-") {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTempDir(path) {
  await rm(path, { recursive: true, force: true });
}

export function authorizationMetadata(server) {
  return {
    issuer: server,
    authorization_endpoint: `${server}/oauth/authorize`,
    token_endpoint: `${server}/oauth/token`,
    registration_endpoint: `${server}/oauth/register`,
    revocation_endpoint: `${server}/oauth/revoke`,
    scopes_supported: ["context.read", "projects.read", "projects.write"],
    code_challenge_methods_supported: ["S256"],
    resource: `${server}/mcp`,
  };
}

export async function writeCredentials(configDir, server, {
  accessToken = "synthetic-access",
  refreshToken = "synthetic-refresh",
  expiresAt = Date.now() + 3_600_000,
  scope = "context.read projects.read projects.write",
  withTokens = true,
} = {}) {
  const store = new CredentialStore(server, { configDir });
  await store.write({
    version: 1,
    server: store.server,
    client: {
      client_id: "synthetic-client",
      client_name: "codepi CLI test",
      redirect_uris: ["http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none",
      issuer: server,
    },
    metadata: authorizationMetadata(server),
    ...(withTokens
      ? {
          tokens: {
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: "Bearer",
            scope,
            expires_at: expiresAt,
            issuer: server,
          },
        }
      : {}),
  });
  return store;
}

export async function startFakeMcpServer(options = {}) {
  const tools = options.tools ?? {
    get_context: async () => ({
      structuredContent: { as_of: "2026-10-20T00:00:00Z", sources: [] },
      content: [{ type: "text", text: "{}" }],
    }),
  };
  const calls = [];
  const makeServer = () => {
    const sdkServer = new Server(
      { name: "fake-codepi", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    sdkServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.keys(tools).map((name) => ({
        name,
        description: `${name} fixture`,
        inputSchema: { type: "object", properties: {}, additionalProperties: true },
      })),
    }));
    sdkServer.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const handler = tools[params.name];
      if (!handler) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: "unknown_tool" }) }],
        };
      }
      calls.push({ name: params.name, arguments: params.arguments ?? {} });
      return handler(params.arguments ?? {}, calls);
    });
    return sdkServer;
  };
  const token = options.token ?? "synthetic-access";

  const httpServer = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${options.publicServer}/.well-known/oauth-protected-resource/mcp"`,
      }).end(JSON.stringify({ error: "invalid_token" }));
      return;
    }
    const body = await readBody(req);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    const request = new Request(`http://127.0.0.1/mcp`, {
      method: req.method,
      headers,
      ...(body.length > 0 ? { body } : {}),
    });
    const sdkServer = makeServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: options.json !== false,
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
  });
  await listen(httpServer);
  const address = httpServer.address();
  const server = `http://127.0.0.1:${address.port}`;
  return {
    server,
    token,
    calls,
    async close() {
      httpServer.closeAllConnections();
      await closeServer(httpServer);
    },
  };
}

export async function startAlways401Server(clientId = "synthetic-client") {
  let mcpRequests = 0;
  let tokenRequests = 0;
  const serverRef = { value: "" };
  const server = createServer(async (req, res) => {
    const origin = serverRef.value;
    if (req.url === "/.well-known/oauth-authorization-server") {
      json(res, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        revocation_endpoint: `${origin}/oauth/revoke`,
        scopes_supported: ["context.read", "projects.read", "projects.write"],
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        grant_types_supported: ["authorization_code", "refresh_token"],
      });
      return;
    }
    if (req.url === "/.well-known/oauth-protected-resource/mcp" ||
        req.url === "/.well-known/oauth-protected-resource") {
      json(res, 200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ["context.read", "projects.read", "projects.write"],
        bearer_methods_supported: ["header"],
      });
      return;
    }
    if (req.url === "/oauth/token") {
      tokenRequests += 1;
      const body = new URLSearchParams(await readBody(req));
      if (body.get("grant_type") !== "refresh_token" ||
          body.get("refresh_token") !== "synthetic-refresh" ||
          body.get("client_id") !== clientId) {
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
    if (req.url === "/mcp") {
      mcpRequests += 1;
      await readBody(req);
      res.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      }).end(JSON.stringify({ error: "invalid_token" }));
      return;
    }
    res.writeHead(404).end();
  });
  await listen(server);
  const address = server.address();
  serverRef.value = `http://127.0.0.1:${address.port}`;
  return {
    server: serverRef.value,
    get mcpRequests() {
      return mcpRequests;
    },
    get tokenRequests() {
      return tokenRequests;
    },
    async close() {
      server.closeAllConnections();
      await closeServer(server);
    },
  };
}

export async function startForbiddenServer(publicServer, scope = "projects.write") {
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests += 1;
    await readBody(req);
    res.writeHead(403, {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scope}"`,
    }).end(JSON.stringify({ error: "insufficient_scope" }));
  });
  await listen(server);
  const address = server.address();
  return {
    server: publicServer,
    get requests() {
      return requests;
    },
    async close() {
      server.closeAllConnections();
      await closeServer(server);
    },
    baseServer: `http://127.0.0.1:${address.port}`,
  };
}

export async function refreshWithStore(store, fetchImpl = fetch) {
  const record = await store.read();
  return refreshAuthorization(
    record.metadata,
    record.client.client_id,
    record.tokens,
    store.server,
    fetchImpl,
  );
}

export async function spawnCli(args, options = {}) {
  const child = spawn(process.execPath, [new URL("../dist/codepi.mjs", import.meta.url).pathname, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
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
  if (options.input !== undefined) child.stdin.end(options.input);
  else child.stdin.end();
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) reject(new Error(`CLI exited from signal ${signal}`));
      else resolve(exitCode ?? 1);
    });
  });
  return { code, stdout, stderr };
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

export async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export async function closeServer(server) {
  await new Promise((resolve) => server.close(() => resolve()));
}
