/**
 * Pages proxy for well-known URIs. Pages Functions cannot bind a directory
 * whose name starts with a dot, so the file lives at /well-known/[[path]].ts
 * but the matching URL prefix has to be /.well-known/ (RFC 8615). We
 * rewrite the path back to /.well-known/ for /well-known/* requests and
 * forward unchanged for /.well-known/* callers.
 */
interface Env {
  WORKER?: Fetcher;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const WELL_KNOWN_PREFIX = "/.well-known/";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const worker = env.WORKER;
  if (!worker) {
    return new Response(JSON.stringify({ error: "service_not_configured" }), {
      status: 503,
      headers: JSON_HEADERS,
    });
  }
  const incoming = new URL(request.url);
  if (incoming.pathname.startsWith("/well-known/")) {
    const rewritten = new URL(
      WELL_KNOWN_PREFIX + incoming.pathname.slice("/well-known/".length) + incoming.search,
      incoming,
    );
    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    request = new Request(rewritten.toString(), init);
  }
  try {
    return await worker.fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: "upstream_unreachable" }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }
};
