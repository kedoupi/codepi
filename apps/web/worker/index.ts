import { handleDeskRequest, type DeskEnv } from "../server/desk";

interface Env extends DeskEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleDeskRequest(request, env);
    }
    const desk = url.pathname === "/desk" || url.pathname.startsWith("/desk/");
    let response: Response;
    // Static Assets does not support domain-level rules in _redirects.
    if (desk && url.hostname === "www.codepi.app") {
      url.hostname = "codepi.app";
      url.protocol = "https:";
      url.port = "";
      if (url.pathname === "/desk") url.pathname = "/desk/";
      response = new Response(null, { status: 302, headers: { Location: url.href } });
    } else {
      response = await env.ASSETS.fetch(request);
    }
    if (!desk) return response;
    const secured = new Response(response.body, response);
    secured.headers.set("Cache-Control", "no-store");
    secured.headers.set("X-Robots-Tag", "noindex, nofollow");
    secured.headers.set("Referrer-Policy", "no-referrer");
    return secured;
  },
} satisfies ExportedHandler<Env>;
