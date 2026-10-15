/**
 * Pages proxy for /oauth/*. Forwards MCP OAuth endpoints to the
 * oura-kdp-api Worker.
 */
interface Env {
  WORKER?: Fetcher;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const worker = env.WORKER;
  if (!worker) {
    return new Response(JSON.stringify({ error: "service_not_configured" }), {
      status: 503,
      headers: JSON_HEADERS,
    });
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
