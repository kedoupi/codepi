/**
 * Health frontend Worker. Serves the Svelte SPA from Static Assets and forwards
 * API traffic to the codepi-health-api Worker via the WORKER service
 * binding. The API Worker keeps all logic and secrets; this Worker only
 * translates upstream faults into JSON so the Svelte client gets a parsable
 * error.
 *
 * Retired connector URLs return 404 instead of the SPA fallback. All MCP
 * discovery, authorization and transport live at mcp.codepi.app.
 */
interface Env {
  ASSETS: Fetcher;
  WORKER?: Fetcher;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
function isRetiredConnectorPath(pathname: string): boolean {
  return pathname === "/mcp"
    || pathname.startsWith("/oauth/")
    || pathname.startsWith("/.well-known/")
    || pathname.startsWith("/well-known/");
}

function errorResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (isRetiredConnectorPath(url.pathname)) {
      return errorResponse("not_found", 404);
    }
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    const worker = env.WORKER;
    if (!worker) {
      return errorResponse("service_not_configured", 503);
    }
    try {
      return await worker.fetch(request);
    } catch {
      return errorResponse("upstream_unreachable", 502);
    }
  },
} satisfies ExportedHandler<Env>;
