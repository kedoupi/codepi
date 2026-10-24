import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ALLOWED, authed, loginAsAllowlisted } from "./helpers";

describe("request body limits", () => {
  it("rejects oversized OTP request and verification bodies", async () => {
    const oversized = "x".repeat(256 * 1024);
    const requestRes = await SELF.fetch("https://gzh.codepi.app/api/auth/request-otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": "6.6.6.6",
        Origin: "https://gzh.codepi.app",
      },
      body: JSON.stringify({ email: ALLOWED, oversized }),
    });
    expect(requestRes.status).toBe(400);

    const verifyRes = await SELF.fetch("https://gzh.codepi.app/api/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: "https://gzh.codepi.app" },
      body: JSON.stringify({ email: ALLOWED, code: "000000", oversized }),
    });
    expect(verifyRes.status).toBe(400);
  });

  it("rejects oversized bodies on all desk write endpoints", async () => {
    const cookie = await loginAsAllowlisted();
    const oversized = "x".repeat(256 * 1024);

    const upsert = await authed(cookie, "/api/posts", {
      method: "POST",
      body: JSON.stringify({ slug: "too-large", oversized }),
    });
    expect(upsert.status).toBe(400);

    const patch = await authed(cookie, "/api/posts/kdp-0917-zao", {
      method: "PATCH",
      body: JSON.stringify({ title: "too large", oversized }),
    });
    expect(patch.status).toBe(400);

    const review = await authed(cookie, "/api/review", {
      method: "POST",
      body: JSON.stringify({ slug: "kdp-0917-zao", action: "过", oversized }),
    });
    expect(review.status).toBe(400);
  });
});
