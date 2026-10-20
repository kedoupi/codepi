import { callMcpTool } from "../../dist/mcp.js";

const server = process.env.CODEPI_TEST_SERVER;
const configDir = process.env.CODEPI_CONFIG_DIR;
const clientId = process.env.CODEPI_TEST_CLIENT;
if (!server || !configDir || !clientId) throw new Error("missing fixture environment");

const baseFetch = globalThis.fetch;
const fetchImpl = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("x-codepi-test-client", clientId);
  return baseFetch(input, { ...init, headers });
};

try {
  const result = await callMcpTool({
    server,
    name: "get_context",
    args: {},
    fetchImpl,
    configDir,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    structured: result.structured,
  })}\n`);
} catch (error) {
  process.stderr.write(`${error?.code ?? "error"}: ${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
}
