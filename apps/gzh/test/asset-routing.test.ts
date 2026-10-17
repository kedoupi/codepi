import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../worker/index";

describe("private asset path aliases", () => {
  it.each([
    "/%70reviews/kdp-0917-zao/",
    "/previews%2fkdp-0917-zao/",
    "/previews%5ckdp-0917-zao/",
    "//previews/kdp-0917-zao/",
    "/previews//kdp-0917-zao/",
    "/%2570reviews/kdp-0917-zao/",
    "/previews/%",
  ])("rejects %s before the asset binding can normalize it", async path => {
    const assets = vi.fn(async () => new Response("<html>private draft</html>"));
    const bindings = {
      ...env, SSO_ENABLED: "1", ASSETS: { fetch: assets } as unknown as Fetcher,
    };
    const response = await worker.fetch(
      new Request("https://gzh.codepi.app" + path), bindings, createExecutionContext(),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("private draft");
    expect(assets).not.toHaveBeenCalled();
  });

  it("allows encoded query parameters on canonical public paths", async () => {
    const assets = vi.fn(async () => new Response("<html>login</html>"));
    const response = await worker.fetch(
      new Request("https://gzh.codepi.app/login?next=%2Fp%2Fexample%2F"),
      { ...env, ASSETS: { fetch: assets } as unknown as Fetcher },
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(assets).toHaveBeenCalledOnce();
  });
});
