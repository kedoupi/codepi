/**
 * Health frontend Worker. Serves the Svelte SPA from Static Assets and forwards
 * API/MCP/OAuth traffic to the codepi-health-api Worker via the WORKER service
 * binding. The API Worker keeps all logic and secrets; this Worker only
 * translates upstream faults into JSON so the Svelte client gets a parsable
 * error.
 *
 * Static Assets has no Pages Functions directory restriction, so the legacy
 * /well-known/* → /.well-known/* workaround is kept here for compatibility with
 * clients that still call /well-known/* (the API Worker serves /.well-known/*).
 */
interface Env {
  ASSETS: Fetcher;
  WORKER?: Fetcher;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const WELL_KNOWN_PREFIX = "/.well-known/";

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/")
    || pathname === "/mcp"
    || pathname.startsWith("/oauth/")
    || pathname.startsWith(WELL_KNOWN_PREFIX)
    || pathname.startsWith("/well-known/");
}

function errorResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!isApiPath(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
    const worker = env.WORKER;
    if (!worker) {
      return errorResponse("service_not_configured", 503);
    }
    // Rewrite /well-known/* to /.well-known/*; leave /.well-known/* unchanged.
    if (url.pathname.startsWith("/well-known/")) {
      const rewritten = new URL(
        WELL_KNOWN_PREFIX + url.pathname.slice("/well-known/".length) + url.search,
        url,
      );
      request = new Request(rewritten.toString(), request);
    }
    try {
      return await worker.fetch(request);
    } catch {
      return errorResponse("upstream_unreachable", 502);
    }
  },
} satisfies ExportedHandler<Env>;
