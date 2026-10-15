/**
 * Pages proxy at /api/*. Forwards matching API calls to the oura-kdp-api
 * Worker via the WORKER service binding that the Pages project ships with.
 *
 * The Worker still owns all real logic and secrets; this function only
 * translates upstream faults into JSON so the Svelte client receives a
 * parsable error.
 *
 * Pages Functions cannot bind a directory whose name starts with a dot,
 * so the Worker URL /.well-known/... has no function-side binding. The
 * routes /mcp, /oauth/* are likewise handled by sibling files in this
 * directory tree.
 */
interface Env {
  WORKER?: Fetcher;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const worker = env.WORKER;
  if (!worker) {
    return new Response(
      JSON.stringify({ error: "service_not_configured" }),
      { status: 503, headers: JSON_HEADERS },
    );
  }
  try {
    return await worker.fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ error: "upstream_unreachable" }),
      { status: 502, headers: JSON_HEADERS },
    );
  }
};
